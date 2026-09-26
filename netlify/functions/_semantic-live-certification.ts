// Stateless live semantic certification harness.
//
// IMPORTANT:
// - No customer DB, memory, trace, booking/order/payment, or runtime state.
// - Calls ONLY the semantic language interpreter against repository-owned
//   non-personal golden evaluation cases.
// - The HTTP wrapper is token-gated and returns 404 when disabled/mismatched.

import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticTurn,
} from './_semantic-interpreter';
import type {
  ProviderAttemptDiagnostic,
  ProviderAttemptOutcome,
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

export function computeAvailabilityRetryDelayMs(
  attempts: ProviderAttemptDiagnostic[],
  rateLimitDelayMs: number,
  transientDelayMs: number,
): number {
  const hasRateLimit = attempts.some(attempt =>
    attempt.outcome === 'rate_limited' || attempt.outcome === 'circuit_open');
  return hasRateLimit
    ? Math.max(0, Math.floor(rateLimitDelayMs))
    : Math.max(0, Math.floor(transientDelayMs));
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
  transientAvailabilityRetryDelayMs?: number;
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
  const transientAvailabilityRetryDelayMs = Math.max(
    0,
    Math.min(30_000, Math.floor(options.transientAvailabilityRetryDelayMs ?? availabilityRetryDelayMs)),
  );
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

        const retryDelayMs = computeAvailabilityRetryDelayMs(
          attempts,
          availabilityRetryDelayMs,
          transientAvailabilityRetryDelayMs,
        );
        if (
          retryable
          && availabilityAttempt < availabilityRetries
          && retryDelayMs > 0
        ) {
          availabilityAttempt += 1;
          await sleep(retryDelayMs);
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
