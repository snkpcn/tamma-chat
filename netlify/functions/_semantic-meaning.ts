// Human Core PR B -- the SemanticMeaning contract.
//
// SemanticTurn (see _semantic-interpreter.ts) is the model/deterministic
// interpreter's raw OUTPUT shape -- it has grown ad hoc fields over several
// phases (taskDirective, clarificationReason, semanticSource, ...) because
// each phase needed one more thing out of the interpreter. SemanticMeaning
// is a SEPARATE, narrower, CLOSED contract derived from a SemanticTurn: the
// one shape every downstream consumer that needs to make a DECISION (is this
// a real commitment? how broad is the customer's request? does the current
// turn correct something?) should read from, instead of each consumer
// re-deriving its own ad hoc reading of action/speechAct/entities.
//
// Two rules this contract exists to enforce:
//   1. normalizedMeaning (SemanticTurn's free-form paraphrase) is
//      observability-only. It is deliberately NOT a field on SemanticMeaning
//      and deriveSemanticMeaning never reads it to decide any other field --
//      a customer's own paraphrase must never be able to flip a closed
//      decision field through blob-substring matching (see PR A's
//      hasFoodSafetyConstraint fix, which closed exactly this class of bug
//      in one call site; this contract closes it structurally everywhere).
//   2. commitmentLevel is the ONE authoritative answer to "has the customer
//      explicitly committed to a transaction", replacing each consumer's own
//      ad hoc action-based check (_dialog-manager.ts's COMMIT_ACTIONS,
//      thongthai-chat.ts's various commit-marker checks, the orchestrator's
//      conflict guard). Deriving it once, here, from the same closed
//      SemanticTurn fields those checks already used, means every consumer
//      agrees by construction instead of by convention.
import type { SemanticAction, SemanticDomain, SemanticInformationNeed, SemanticReference, SemanticSpeechAct, SemanticTurn } from './_semantic-interpreter';

/** How committed the customer's CURRENT turn is to an actual transaction.
 *  'none' -- browsing/reading/managing state, no commitment signal at all.
 *  'exploratory' -- discovering/comparing/asking, no selection made yet.
 *  'planning' -- a selection/slot is being made (a real commitment is
 *    plausible soon, but nothing should execute yet).
 *  'explicit_transaction' -- the customer explicitly asked to book/order.
 *    This is the ONLY level a transaction executor may act on. */
export type SemanticCommitmentLevel = 'none' | 'exploratory' | 'planning' | 'explicit_transaction';

/** How broad the customer's current request is.
 *  'focused' -- a specific, resolved entity/topic.
 *  'domain_wide' -- the whole domain/catalog, no specific entity.
 *  'unknown' -- not enough signal to say either way. */
export type SemanticScopeBreadth = 'focused' | 'domain_wide' | 'unknown';

/** A closed, coarse label for WHY the customer is talking to Thongthai at
 *  all, independent of which business domain it's about -- lets a consumer
 *  ask "is this customer trying to get something done vs. get help vs.
 *  just browsing" without inspecting action/speechAct itself. */
export type SemanticUserGoal =
  | 'browse_or_decide'
  | 'commit'
  | 'manage_existing'
  | 'get_help'
  | 'unknown';

/** The customer's own stated date/time for THIS turn, if any -- lifted
 *  structurally from entities.date/entities.time (never parsed from
 *  normalizedMeaning). null when the turn states neither. */
export type SemanticTemporalMeaning = { date?: string; time?: string } | null;

export type SemanticMeaning = {
  domain: SemanticDomain;
  speechAct: SemanticSpeechAct;
  userGoal: SemanticUserGoal;
  action: SemanticAction;
  informationNeed: SemanticInformationNeed;
  commitmentLevel: SemanticCommitmentLevel;
  scopeBreadth: SemanticScopeBreadth;
  /** A short, closed-vocabulary label for what the turn is actually about --
   *  the resolved entity id when one exists, else `${domain}:${informationNeed}`.
   *  Never a free paraphrase. */
  semanticFocus: string;
  entities: Record<string, unknown>;
  references: SemanticReference[];
  constraints: string[];
  /** Entity/slot keys the CURRENT turn is correcting (only populated when
   *  the turn is itself a correction) -- never the full entity set of an
   *  unrelated turn. */
  corrections: string[];
  temporalMeaning: SemanticTemporalMeaning;
  /** True when ANY reference on this turn resolves against prior
   *  conversation/task state, at the turn level -- a convenience derived
   *  from references[].refersToPriorContext, not a new signal. */
  refersToPriorContext: boolean;
  confidence: number;
  needsClarification: boolean;
};

const TRANSACTION_ACTIONS: ReadonlySet<SemanticAction> = new Set(['book', 'order']);
const PLANNING_ACTIONS: ReadonlySet<SemanticAction> = new Set(['confirm', 'modify', 'provide_information']);
const EXPLORATORY_ACTIONS: ReadonlySet<SemanticAction> = new Set(['ask', 'discover', 'recommend', 'compare']);
const MANAGE_EXISTING_ACTIONS: ReadonlySet<SemanticAction> = new Set(['cancel', 'correct_previous', 'modify']);
const HELP_SPEECH_ACTS: ReadonlySet<SemanticSpeechAct> = new Set(['complaint', 'incident_report', 'request_help']);

function deriveCommitmentLevel(turn: SemanticTurn): SemanticCommitmentLevel {
  if (TRANSACTION_ACTIONS.has(turn.action) || turn.speechAct === 'transaction_request') return 'explicit_transaction';
  if (PLANNING_ACTIONS.has(turn.action) || turn.speechAct === 'selection') return 'planning';
  if (EXPLORATORY_ACTIONS.has(turn.action)) return 'exploratory';
  return 'none';
}

function deriveScopeBreadth(turn: SemanticTurn): SemanticScopeBreadth {
  const hasResolvedEntity = turn.references.some(reference => Boolean(reference.resolvedEntityId) || Boolean(reference.resolvedEntityIds?.length));
  if (hasResolvedEntity) return 'focused';
  if (turn.action === 'discover') return 'domain_wide';
  return 'unknown';
}

function deriveUserGoal(turn: SemanticTurn, commitmentLevel: SemanticCommitmentLevel): SemanticUserGoal {
  if (commitmentLevel === 'explicit_transaction') return 'commit';
  if (turn.speechAct && HELP_SPEECH_ACTS.has(turn.speechAct)) return 'get_help';
  if (MANAGE_EXISTING_ACTIONS.has(turn.action)) return 'manage_existing';
  if (EXPLORATORY_ACTIONS.has(turn.action) || commitmentLevel === 'planning') return 'browse_or_decide';
  return 'unknown';
}

function deriveSemanticFocus(turn: SemanticTurn): string {
  const resolvedId = turn.references.find(reference => reference.resolvedEntityId)?.resolvedEntityId;
  if (resolvedId) return resolvedId;
  return `${turn.domain}:${turn.informationNeed ?? turn.action}`;
}

function deriveCorrections(turn: SemanticTurn): string[] {
  const isCorrection = turn.action === 'correct_previous' || turn.speechAct === 'correction';
  return isCorrection ? Object.keys(turn.entities) : [];
}

function deriveTemporalMeaning(turn: SemanticTurn): SemanticTemporalMeaning {
  const date = typeof turn.entities.date === 'string' ? turn.entities.date : undefined;
  const time = typeof turn.entities.time === 'string' ? turn.entities.time : undefined;
  if (!date && !time) return null;
  return { ...(date ? { date } : {}), ...(time ? { time } : {}) };
}

/** Pure, deterministic mapping from a SemanticTurn (whatever produced it --
 *  the real model, the deterministic outage fallback, a cached/reused turn)
 *  to the one authoritative SemanticMeaning every decision-making consumer
 *  should read. Never performs I/O, never calls a model, never reads
 *  normalizedMeaning. */
export function deriveSemanticMeaning(turn: SemanticTurn): SemanticMeaning {
  const commitmentLevel = deriveCommitmentLevel(turn);
  return {
    domain: turn.domain,
    speechAct: turn.speechAct ?? 'unknown',
    userGoal: deriveUserGoal(turn, commitmentLevel),
    action: turn.action,
    informationNeed: turn.informationNeed ?? 'none',
    commitmentLevel,
    scopeBreadth: deriveScopeBreadth(turn),
    semanticFocus: deriveSemanticFocus(turn),
    entities: turn.entities,
    references: turn.references,
    constraints: turn.constraints,
    corrections: deriveCorrections(turn),
    temporalMeaning: deriveTemporalMeaning(turn),
    refersToPriorContext: turn.references.some(reference => reference.refersToPriorContext),
    confidence: turn.confidence,
    needsClarification: turn.needsClarification,
  };
}
