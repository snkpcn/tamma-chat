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
};

export type SemanticCertificationResult = {
  kind: 'LIVE_MODEL_SEMANTIC_CERTIFICATION';
  profile: SemanticCertificationProfile;
  totalCorpusCases: number;
  start: number;
  evaluated: number;
  pass: number;
  failed: number;
  passPct: number;
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

export async function runSemanticCertification(options: {
  profile?: SemanticCertificationProfile;
  start?: number;
  limit?: number;
  interpret?: typeof interpretSemanticTurn;
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

  let pass = 0;
  const failures: SemanticCertificationFailure[] = [];

  for (const item of selected) {
    try {
      const turn = await interpret(item.message, item.context ?? emptySemanticContext());
      if (matchesExpected(item, turn)) {
        pass += 1;
        continue;
      }
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
    } catch {
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
      });
    }
  }

  const failed = failures.length;
  const evaluated = selected.length;
  return {
    kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
    profile,
    totalCorpusCases:profileCases.length,
    start,
    evaluated,
    pass,
    failed,
    passPct:evaluated ? Number((pass / evaluated * 100).toFixed(2)) : 0,
    failures,
  };
}
