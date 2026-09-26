// Stateless live semantic certification harness.
//
// IMPORTANT:
// - No customer DB, memory, trace, booking/order/payment, or runtime state.
// - Calls ONLY the semantic language interpreter against repository-owned
//   non-personal golden evaluation cases.
// - The HTTP wrapper is token-gated and returns 404 when disabled/mismatched.

import {
  buildSemanticInterpreterPrompt,
  describeSemanticContext,
  emptySemanticContext,
  interpretSemanticTurn,
  parseSemanticTurnResponse,
  type SemanticTurn,
} from './_semantic-interpreter';
import {
  callPreferredModel,
  stripCodeFences,
  type ChatTurn,
  type ProviderAttemptDiagnostic,
  type ProviderAttemptOutcome,
} from './_thongthai-model-provider';
import {
  SEMANTIC_EVAL_CORPUS,
  type SemanticEvalCase,
} from '../../tests/fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from '../../tests/fixtures/phase-l-semantic-cases';

export type SemanticCertificationProfile = 'full' | 'production-smoke';

const PRODUCTION_SMOKE_IDS = new Set([
  'restaurant-table-availability-01',
  'restaurant-table-availability-02',
  'reference-03',
  'reference-07',
  'topic-switch-01',
  'typo-01',
  'typo-02',
  'stay-availability-01',
  'stay-availability-02',
  'l-activity-08',
  'l-activity-10',
  'l-restaurant-02',
  'l-restaurant-03',
  'l-restaurant-05',
  'l-restaurant-09',
  'l-stay-02',
  'l-stay-04',
  'l-stay-08',
  'l-promo-01',
  'l-promo-04',
  'l-member-01',
  'l-member-03',
  'l-otop-01',
  'l-otop-03',
  'l-cafe-02',
  'l-payment-03',
  'l-journey-01',
  'l-journey-02',
  'l-journey-05',
  'l-journey-07',
  'l-support-02',
]);

export type SemanticCertificationFailure = {
  id: string;
  category: string;
  expected: {
    domain: string;
    action: string | null;
    needsClarification: boolean | null;
    informationNeed: string | null;
  };
  actual: {
    domain: string;
    action: string;
    needsClarification: boolean;
    informationNeed: string;
    confidence: number;
  };
  providerError?: {
    name: string;
    attempts: ProviderAttemptDiagnostic[];
  };
  /** Model returned but semantic output could not be parsed/validated.
   *  Safe diagnostic only: error class name, never raw model output. */
  semanticError?: {
    name: string;
  };
};

export type SemanticCertificationResult = {
  kind: 'LIVE_MODEL_SEMANTIC_CERTIFICATION';
  profile: SemanticCertificationProfile;
  totalCorpusCases: number;
  start: number;
  evaluated: number;
  semanticEvaluated: number;
  pass: number;
  failed: number;
  semanticFailed: number;
  providerFailed: number;
  passPct: number;
  availabilityComplete: boolean;
  failures: SemanticCertificationFailure[];
};

function allCases(): SemanticEvalCase[] {
  return [...SEMANTIC_EVAL_CORPUS, ...PHASE_L_SEMANTIC_CASES];
}

function expectedInformationNeed(item: SemanticEvalCase): string | null {
  const value = item.simulatedModelOutput?.informationNeed;
  return typeof value === 'string' ? value : null;
}

function matchesExpected(item: SemanticEvalCase, turn: SemanticTurn): boolean {
  if (turn.domain !== item.expected.domain) return false;
  if (item.expected.action !== undefined && turn.action !== item.expected.action) return false;
  if (
    item.expected.needsClarification !== undefined
    && turn.needsClarification !== item.expected.needsClarification
  ) return false;

  const informationNeed = expectedInformationNeed(item);
  if (informationNeed !== null && (turn.informationNeed ?? 'none') !== informationNeed) return false;

  return true;
}

function safeProviderAttempts(error: unknown): ProviderAttemptDiagnostic[] {
  if (!error || typeof error !== 'object') return [];
  const raw = (error as { attempts?: unknown }).attempts;
  if (!Array.isArray(raw)) return [];

  const validOutcomes = new Set<ProviderAttemptOutcome>([
    'success',
    'timeout',
    'rate_limited',
    'server_error',
    'network_error',
    'request_error',
    'not_configured',
    'circuit_open',
  ]);

  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const attempt = item as Partial<ProviderAttemptDiagnostic>;
    if (
      (attempt.provider !== 'gemini' && attempt.provider !== 'openai')
      || typeof attempt.model !== 'string'
      || !validOutcomes.has(attempt.outcome as ProviderAttemptOutcome)
      || typeof attempt.elapsedMs !== 'number'
    ) {
      return [];
    }
    return [{
      provider:attempt.provider,
      model:attempt.model,
      outcome:attempt.outcome as ProviderAttemptOutcome,
      ...(typeof attempt.httpStatus === 'number' ? { httpStatus:attempt.httpStatus } : {}),
      elapsedMs:attempt.elapsedMs,
    }];
  });
}

function providerErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'unknown';
}

function retryableAvailabilityFailure(attempts: ProviderAttemptDiagnostic[]): boolean {
  if (!attempts.length) return false;
  const retryable = new Set<ProviderAttemptOutcome>([
    'timeout',
    'rate_limited',
    'server_error',
    'network_error',
    'circuit_open',
  ]);
  return attempts.some(attempt => retryable.has(attempt.outcome))
    && !attempts.some(attempt => attempt.outcome === 'request_error' || attempt.outcome === 'not_configured');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Certification pacing is a minimum START-to-START interval, not an
 *  unconditional post-call sleep. Slow provider calls therefore satisfy part
 *  or all of the quota spacing themselves instead of doubling build time. */
export function computeInterCaseWaitMs(
  minimumStartIntervalMs: number,
  elapsedSincePreviousStartMs: number,
): number {
  const minimum = Math.max(0, Math.floor(minimumStartIntervalMs));
  const elapsed = Math.max(0, Math.floor(elapsedSincePreviousStartMs));
  return Math.max(0, minimum - elapsed);
}

export async function runSemanticCertification(options: {
  profile?: SemanticCertificationProfile;
  start?: number;
  limit?: number;
  interpret?: typeof interpretSemanticTurn;
  availabilityRetries?: number;
  availabilityRetryDelayMs?: number;
  stopOnProviderFailure?: boolean;
  interCaseDelayMs?: number;
} = {}): Promise<SemanticCertificationResult> {
  const profile = options.profile ?? 'full';
  const corpus = allCases();
  const profileCases = profile === 'production-smoke'
    ? corpus.filter(item => PRODUCTION_SMOKE_IDS.has(item.id))
    : corpus;

  const start = Math.max(0, Math.min(profileCases.length, Math.floor(options.start ?? 0)));
  const requestedLimit = Math.floor(options.limit ?? 10);
  const limit = Math.max(1, Math.min(20, Number.isFinite(requestedLimit) ? requestedLimit : 10));
  const selected = profileCases.slice(start, start + limit);
  const interpret = options.interpret ?? interpretSemanticTurn;
  const availabilityRetries = Math.max(0, Math.min(3, Math.floor(options.availabilityRetries ?? 0)));
  const availabilityRetryDelayMs = Math.max(0, Math.min(90_000, Math.floor(options.availabilityRetryDelayMs ?? 0)));
  const stopOnProviderFailure = options.stopOnProviderFailure === true;
  const interCaseDelayMs = Math.max(0, Math.min(60_000, Math.floor(options.interCaseDelayMs ?? 0)));

  let pass = 0;
  let evaluated = 0;
  let providerFailed = 0;
  let semanticFailed = 0;
  const failures: SemanticCertificationFailure[] = [];
  let previousCaseStartedAt:number|null=null;

  for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
    const item = selected[selectedIndex]!;
    // Certification is observational, not a load test. Pace provider CALL
    // STARTS rather than adding a fixed sleep after already-slow calls.
    if (interCaseDelayMs > 0) {
      if (previousCaseStartedAt === null) {
        // A nonzero start means this is a resumed/new batch. Give the previous
        // batch one clean interval even though its local timestamp is gone.
        if (start > 0) await sleep(interCaseDelayMs);
      } else {
        const waitMs=computeInterCaseWaitMs(
          interCaseDelayMs,
          Date.now()-previousCaseStartedAt,
        );
        if (waitMs>0) await sleep(waitMs);
      }
    }
    previousCaseStartedAt=Date.now();
    let availabilityAttempt = 0;

    while (true) {
      try {
        const turn = await interpret(item.message, item.context ?? emptySemanticContext());
        evaluated += 1;
        if (matchesExpected(item, turn)) {
          pass += 1;
        } else {
          semanticFailed += 1;
          failures.push({
            id:item.id,
            category:item.category,
            expected:{
              domain:item.expected.domain,
              action:item.expected.action ?? null,
              needsClarification:item.expected.needsClarification ?? null,
              informationNeed:expectedInformationNeed(item),
            },
            actual:{
              domain:turn.domain,
              action:turn.action,
              needsClarification:turn.needsClarification,
              informationNeed:turn.informationNeed ?? 'none',
              confidence:turn.confidence,
            },
          });
        }
        break;
      } catch (error) {
        const attempts = safeProviderAttempts(error);
        const isProviderFailure = attempts.length > 0;
        const retryable = isProviderFailure && retryableAvailabilityFailure(attempts);

        if (
          retryable
          && availabilityAttempt < availabilityRetries
          && availabilityRetryDelayMs > 0
        ) {
          availabilityAttempt += 1;
          await sleep(availabilityRetryDelayMs);
          continue;
        }

        evaluated += 1;
        const baseFailure = {
          id:item.id,
          category:item.category,
          expected:{
            domain:item.expected.domain,
            action:item.expected.action ?? null,
            needsClarification:item.expected.needsClarification ?? null,
            informationNeed:expectedInformationNeed(item),
          },
          actual:{
            domain:'error',
            action:'error',
            needsClarification:true,
            informationNeed:'none',
            confidence:0,
          },
        };

        if (isProviderFailure) {
          providerFailed += 1;
          failures.push({
            ...baseFailure,
            providerError:{
              name:providerErrorName(error),
              attempts,
            },
          });
        } else {
          // A provider did return, but its semantic payload could not be
          // parsed/validated (e.g. malformed JSON). That is model-output
          // correctness, not provider availability, and must not stop the
          // remaining corpus when stopOnProviderFailure is enabled.
          semanticFailed += 1;
          failures.push({
            ...baseFailure,
            semanticError:{ name:providerErrorName(error) },
          });
        }
        break;
      }
    }

    if (stopOnProviderFailure && providerFailed > 0) break;
  }

  const failed = failures.length;
  const semanticEvaluated = pass + semanticFailed;
  return {
    kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
    profile,
    totalCorpusCases:profileCases.length,
    start,
    evaluated,
    semanticEvaluated,
    pass,
    failed,
    semanticFailed,
    providerFailed,
    passPct:semanticEvaluated ? Number((pass / semanticEvaluated * 100).toFixed(2)) : 0,
    availabilityComplete:providerFailed === 0,
    failures,
  };
}


type GroupedSemanticRawResult = {
  id?: unknown;
  semantic?: unknown;
};

type GroupedSemanticEnvelope = {
  results?: unknown;
};

export type GroupedSemanticClassifier = (
  items: SemanticEvalCase[],
) => Promise<Map<string, Record<string, unknown>>>;

function parseGroupedSemanticEnvelope(rawText:string): Map<string,Record<string,unknown>> {
  const cleaned=stripCodeFences(rawText).replace(/^\uFEFF/,'').trim();
  let parsed:GroupedSemanticEnvelope;
  try{
    parsed=JSON.parse(cleaned) as GroupedSemanticEnvelope;
  }catch(firstError){
    const firstBrace=cleaned.indexOf('{');
    const lastBrace=cleaned.lastIndexOf('}');
    if(firstBrace<0 || lastBrace<=firstBrace) throw firstError;
    const slice=cleaned.slice(firstBrace,lastBrace+1);
    try{
      parsed=JSON.parse(slice) as GroupedSemanticEnvelope;
    }catch{
      parsed=JSON.parse(slice.replace(/,\s*([}\]])/g,'$1')) as GroupedSemanticEnvelope;
    }
  }

  if(!Array.isArray(parsed.results)) throw new SyntaxError('Grouped semantic response missing results array');
  const out=new Map<string,Record<string,unknown>>();
  for(const item of parsed.results as GroupedSemanticRawResult[]){
    if(!item || typeof item!=='object') continue;
    if(typeof item.id!=='string') continue;
    if(!item.semantic || typeof item.semantic!=='object' || Array.isArray(item.semantic)) continue;
    out.set(item.id,item.semantic as Record<string,unknown>);
  }
  return out;
}

function groupedSemanticSystemPrompt():string {
  const runtimePrompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  const commonPrompt=runtimePrompt.replace(
    'CONVERSATION CONTEXT: none',
    'CONVERSATION CONTEXT: supplied independently inside each certification case below',
  );

  return `${commonPrompt}

BATCH CERTIFICATION MODE:
- You will receive multiple INDEPENDENT semantic cases in one user message.
- Treat every case as a separate conversation. NEVER let one case influence another.
- For each case, use case.context as that case's CONVERSATION CONTEXT and case.message as its CURRENT customer message.
- Apply exactly the same taxonomy and rules above to each case.
- Return every requested case exactly once.
- Return ONLY this JSON object:
{"results":[{"id":string,"semantic":{"domain":string,"intent":string,"action":string,"informationNeed":string,"taskDirective"?:string,"entities":object,"references":array,"constraints":array,"confidence":number,"needsClarification":boolean,"clarificationReason"?:string}}]}`;
}

export async function classifySemanticCasesGrouped(
  items:SemanticEvalCase[],
):Promise<Map<string,Record<string,unknown>>>{
  const payload=items.map(item=>({
    id:item.id,
    context:describeSemanticContext(item.context ?? emptySemanticContext()),
    message:item.message,
  }));
  const raw=await callPreferredModel(
    groupedSemanticSystemPrompt(),
    [{role:'user',content:JSON.stringify({cases:payload})} as ChatTurn],
    'semantic-certification-group',
  );
  return parseGroupedSemanticEnvelope(raw);
}

export async function runGroupedSemanticCertification(options:{
  profile?:SemanticCertificationProfile;
  start?:number;
  limit?:number;
  classifyGroup?:GroupedSemanticClassifier;
  availabilityRetries?:number;
  availabilityRetryDelayMs?:number;
}={}):Promise<SemanticCertificationResult>{
  const profile=options.profile ?? 'full';
  const corpus=allCases();
  const profileCases=profile==='production-smoke'
    ? corpus.filter(item=>PRODUCTION_SMOKE_IDS.has(item.id))
    : corpus;
  const start=Math.max(0,Math.min(profileCases.length,Math.floor(options.start ?? 0)));
  const requestedLimit=Math.floor(options.limit ?? 20);
  const limit=Math.max(1,Math.min(20,Number.isFinite(requestedLimit)?requestedLimit:20));
  const selected=profileCases.slice(start,start+limit);
  const classifyGroup=options.classifyGroup ?? classifySemanticCasesGrouped;
  const availabilityRetries=Math.max(0,Math.min(3,Math.floor(options.availabilityRetries ?? 0)));
  const availabilityRetryDelayMs=Math.max(0,Math.min(90_000,Math.floor(options.availabilityRetryDelayMs ?? 0)));

  let availabilityAttempt=0;
  let rawResults:Map<string,Record<string,unknown>>;
  while(true){
    try{
      rawResults=await classifyGroup(selected);
      break;
    }catch(error){
      const attempts=safeProviderAttempts(error);
      const isProviderFailure=attempts.length>0;
      const retryable=isProviderFailure && retryableAvailabilityFailure(attempts);
      if(retryable && availabilityAttempt<availabilityRetries && availabilityRetryDelayMs>0){
        availabilityAttempt+=1;
        await sleep(availabilityRetryDelayMs);
        continue;
      }

      const first=selected[0];
      if(!first) {
        return {
          kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
          profile,
          totalCorpusCases:profileCases.length,
          start,
          evaluated:0,
          semanticEvaluated:0,
          pass:0,
          failed:0,
          semanticFailed:0,
          providerFailed:0,
          passPct:0,
          availabilityComplete:true,
          failures:[],
        };
      }

      const providerFailure=isProviderFailure;
      const failure:SemanticCertificationFailure={
        id:first.id,
        category:first.category,
        expected:{
          domain:first.expected.domain,
          action:first.expected.action ?? null,
          needsClarification:first.expected.needsClarification ?? null,
          informationNeed:expectedInformationNeed(first),
        },
        actual:{
          domain:'error',
          action:'error',
          needsClarification:true,
          informationNeed:'none',
          confidence:0,
        },
        ...(providerFailure
          ? {providerError:{name:providerErrorName(error),attempts}}
          : {semanticError:{name:providerErrorName(error)}}),
      };
      return {
        kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
        profile,
        totalCorpusCases:profileCases.length,
        start,
        evaluated:providerFailure?1:selected.length,
        semanticEvaluated:providerFailure?0:selected.length,
        pass:0,
        failed:1,
        semanticFailed:providerFailure?0:1,
        providerFailed:providerFailure?1:0,
        passPct:0,
        availabilityComplete:!providerFailure,
        failures:[failure],
      };
    }
  }

  let pass=0;
  let semanticFailed=0;
  const failures:SemanticCertificationFailure[]=[];

  for(const item of selected){
    const raw=rawResults.get(item.id);
    if(!raw){
      semanticFailed+=1;
      failures.push({
        id:item.id,
        category:item.category,
        expected:{
          domain:item.expected.domain,
          action:item.expected.action ?? null,
          needsClarification:item.expected.needsClarification ?? null,
          informationNeed:expectedInformationNeed(item),
        },
        actual:{
          domain:'error',
          action:'error',
          needsClarification:true,
          informationNeed:'none',
          confidence:0,
        },
        semanticError:{name:'MissingGroupedSemanticResult'},
      });
      continue;
    }

    try{
      const turn=parseSemanticTurnResponse(JSON.stringify(raw),item.context ?? emptySemanticContext());
      if(matchesExpected(item,turn)){
        pass+=1;
      }else{
        semanticFailed+=1;
        failures.push({
          id:item.id,
          category:item.category,
          expected:{
            domain:item.expected.domain,
            action:item.expected.action ?? null,
            needsClarification:item.expected.needsClarification ?? null,
            informationNeed:expectedInformationNeed(item),
          },
          actual:{
            domain:turn.domain,
            action:turn.action,
            needsClarification:turn.needsClarification,
            informationNeed:turn.informationNeed ?? 'none',
            confidence:turn.confidence,
          },
        });
      }
    }catch(error){
      semanticFailed+=1;
      failures.push({
        id:item.id,
        category:item.category,
        expected:{
          domain:item.expected.domain,
          action:item.expected.action ?? null,
          needsClarification:item.expected.needsClarification ?? null,
          informationNeed:expectedInformationNeed(item),
        },
        actual:{
          domain:'error',
          action:'error',
          needsClarification:true,
          informationNeed:'none',
          confidence:0,
        },
        semanticError:{name:providerErrorName(error)},
      });
    }
  }

  const semanticEvaluated=selected.length;
  return {
    kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
    profile,
    totalCorpusCases:profileCases.length,
    start,
    evaluated:semanticEvaluated,
    semanticEvaluated,
    pass,
    failed:failures.length,
    semanticFailed,
    providerFailed:0,
    passPct:semanticEvaluated?Number((pass/semanticEvaluated*100).toFixed(2)):0,
    availabilityComplete:true,
    failures,
  };
}
