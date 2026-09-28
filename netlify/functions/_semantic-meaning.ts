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

/** WHAT KIND of thing the customer's current turn is focused on -- the
 *  structural signal CanonicalKnowledgeScope (see _canonical-knowledge-
 *  scope.ts) canonicalizes against real catalog/SOT relationships.
 *  'domain' -- the whole domain/catalog, nothing narrower named
 *    ("ที่นี่มีกิจกรรมอะไรบ้าง").
 *  'entity_type' -- a category/type of entity, not one specific instance
 *    ("มีม้าตัวไหนบ้าง", "ATV มีคันไหน").
 *  'entity' -- one specific, named/resolved instance ("เอาภาราดร").
 *  'category' -- reserved for a domain that groups entities under a label
 *    broader than entity_type but narrower than the whole domain (not
 *    used by activity today; kept for other domains to adopt later).
 *  'prior_reference' -- points at something from earlier context/state
 *    that hasn't (yet) resolved to a canonical id ("เอาอันเดิม").
 *  'unknown' -- not enough signal to say. */
export type SemanticFocusKind = 'domain' | 'entity_type' | 'entity' | 'category' | 'prior_reference' | 'unknown';

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

/** The closed owner-facing conversation class for the CURRENT turn.
 *  This is intentionally coarser than action/speechAct: downstream code
 *  should decide "may this transact?" from COMMIT, not by re-reading Thai
 *  text, free-form intent labels, or stale task state. */
export type SemanticConversationalMode =
  | 'CHAT'
  | 'ASK'
  | 'DISCOVER'
  | 'CONSIDER'
  | 'COMMIT'
  | 'INCIDENT';

/** The customer's own stated date/time for THIS turn, if any -- lifted
 *  structurally from entities.date/entities.time (never parsed from
 *  normalizedMeaning). null when the turn states neither. */
export type SemanticTemporalMeaning = { date?: string; time?: string } | null;

export type SemanticMeaning = {
  domain: SemanticDomain;
  speechAct: SemanticSpeechAct;
  conversationalMode: SemanticConversationalMode;
  userGoal: SemanticUserGoal;
  action: SemanticAction;
  informationNeed: SemanticInformationNeed;
  commitmentLevel: SemanticCommitmentLevel;
  scopeBreadth: SemanticScopeBreadth;
  focusKind: SemanticFocusKind;
  /** The concrete value behind focusKind -- a resolved canonical entity id
   *  (focusKind 'entity'), a closed SOT-aligned type code (focusKind
   *  'entity_type', e.g. 'horse'/'atv'/'archery'), a customer-stated name
   *  not yet canonicalized (focusKind 'entity' before SOT resolution), or
   *  bounded prior-context evidence (focusKind 'prior_reference'). null for
   *  'domain'/'unknown'. NEVER a fabricated operational id -- only what the
   *  customer actually said or what a reference already resolved to. See
   *  _canonical-knowledge-scope.ts for turning this into real catalog
   *  identities. */
  focusValue: string | null;
  /** A short, closed-vocabulary label for what the turn is actually about --
   *  the resolved entity id when one exists, else `${domain}:${informationNeed}`.
   *  Never a free paraphrase. Superseded by focusKind/focusValue for scope
   *  decisions; kept for existing observability consumers. */
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

// Human Core PR C: scopeBreadth used to come from only two signals (a
// resolved reference => focused; action==='discover' => domain_wide),
// which is not real human semantic scope understanding -- "มีม้าตัวไหนบ้าง"
// (a specific activity TYPE) and "ที่นี่มีกิจกรรมอะไรบ้าง" (the whole
// domain) both reached action='discover' with no resolved reference, so
// both collapsed to the SAME breadth. deriveFocus below reads every
// structural signal the turn actually carries -- a resolved entity
// reference, a customer-named entity (horseName), a stated entity-type/
// category code (activityCode, canonicalized in
// canonicalizeEntityAliases), bounded prior-context evidence, or a bare
// domain-wide browse -- and scopeBreadth is derived FROM that single
// focus decision, never independently re-guessed.
function deriveFocus(turn: SemanticTurn): { focusKind: SemanticFocusKind; focusValue: string | null } {
  const resolvedRef = turn.references.find(reference => Boolean(reference.resolvedEntityId) || Boolean(reference.resolvedEntityIds?.length));
  if (resolvedRef) return { focusKind: 'entity', focusValue: resolvedRef.resolvedEntityId ?? resolvedRef.resolvedEntityIds![0]! };

  if (typeof turn.entities.horseName === 'string' && turn.entities.horseName.trim()) {
    return { focusKind: 'entity', focusValue: turn.entities.horseName.trim() };
  }

  if (typeof turn.entities.activityCode === 'string' && turn.entities.activityCode.trim()) {
    return { focusKind: 'entity_type', focusValue: turn.entities.activityCode.trim().toLowerCase() };
  }

  if (turn.domain === 'restaurant') {
    const menuItemId = typeof turn.entities.menuItemId === 'string' ? turn.entities.menuItemId.trim() : '';
    if (menuItemId) return { focusKind: 'entity', focusValue: menuItemId.startsWith('menu:') ? menuItemId : `menu:${menuItemId}` };

    const itemName = typeof turn.entities.itemName === 'string' ? turn.entities.itemName.trim() : '';
    if (itemName) return { focusKind: 'entity', focusValue: itemName };

    const menuCategory = typeof turn.entities.menuCategory === 'string' ? turn.entities.menuCategory.trim() : '';
    if (menuCategory) return { focusKind: 'category', focusValue: `menu_category:${menuCategory}` };

    const items = Array.isArray(turn.entities.items) ? turn.entities.items : [];
    if (items.length === 1 && items[0] && typeof items[0] === 'object' && !Array.isArray(items[0])) {
      const name = (items[0] as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return { focusKind: 'entity', focusValue: name.trim() };
    }
  }

  if (turn.domain === 'promotion') {
    const campaignId = typeof turn.entities.campaignId === 'string' ? turn.entities.campaignId.trim() : '';
    if (campaignId) return { focusKind:'entity', focusValue:campaignId.startsWith('promo:') ? campaignId : `promo:${campaignId}` };

    const campaignCode = typeof turn.entities.campaignCode === 'string' ? turn.entities.campaignCode.trim() : '';
    if (campaignCode) return { focusKind:'entity', focusValue:`promo_code:${campaignCode}` };

    const promotionName = typeof turn.entities.promotionName === 'string' ? turn.entities.promotionName.trim() : '';
    if (promotionName) return { focusKind:'entity', focusValue:promotionName };
  }

  if (turn.domain === 'stay') {
    const resourceCode = typeof turn.entities.resourceCode === 'string' ? turn.entities.resourceCode.trim() : '';
    if (resourceCode) return { focusKind: 'entity', focusValue: resourceCode.startsWith('stay:') ? resourceCode : `stay:${resourceCode}` };

    const statedName = [turn.entities.accommodationName, turn.entities.resourceName]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (statedName) return { focusKind: 'entity', focusValue: statedName.trim() };

    const bedrooms = Number(turn.entities.bedrooms);
    if (Number.isInteger(bedrooms) && bedrooms > 0) {
      return { focusKind: 'entity_type', focusValue: `bedrooms:${bedrooms}` };
    }
    const roomType = typeof turn.entities.roomType === 'string' ? turn.entities.roomType.trim() : '';
    if (roomType) return { focusKind: 'entity_type', focusValue: `room_type:${roomType}` };
  }

  const priorRef = turn.references.find(reference => reference.refersToPriorContext);
  if (priorRef) return { focusKind: 'prior_reference', focusValue: priorRef.value ?? null };

  if (turn.action === 'discover' || turn.informationNeed === 'catalog') {
    return { focusKind: 'domain', focusValue: null };
  }

  return { focusKind: 'unknown', focusValue: null };
}

function deriveScopeBreadth(focusKind: SemanticFocusKind): SemanticScopeBreadth {
  switch (focusKind) {
    case 'entity':
    case 'entity_type':
    case 'category':
    case 'prior_reference':
      return 'focused';
    case 'domain':
      return 'domain_wide';
    default:
      return 'unknown';
  }
}

function deriveUserGoal(turn: SemanticTurn, commitmentLevel: SemanticCommitmentLevel): SemanticUserGoal {
  if (commitmentLevel === 'explicit_transaction') return 'commit';
  if (turn.speechAct && HELP_SPEECH_ACTS.has(turn.speechAct)) return 'get_help';
  if (MANAGE_EXISTING_ACTIONS.has(turn.action)) return 'manage_existing';
  if (EXPLORATORY_ACTIONS.has(turn.action) || commitmentLevel === 'planning') return 'browse_or_decide';
  return 'unknown';
}

function deriveConversationalMode(turn: SemanticTurn, commitmentLevel: SemanticCommitmentLevel): SemanticConversationalMode {
  if (turn.domain === 'incident' || turn.speechAct === 'incident_report' || turn.speechAct === 'complaint' || turn.speechAct === 'request_help') {
    return 'INCIDENT';
  }
  if (commitmentLevel === 'explicit_transaction') return 'COMMIT';
  if (commitmentLevel === 'planning' || turn.speechAct === 'preference_update' || turn.action === 'provide_information') {
    return 'CONSIDER';
  }
  if (turn.action === 'discover' || turn.action === 'recommend' || turn.action === 'compare') return 'DISCOVER';
  if (turn.action === 'ask' || turn.action === 'status') return 'ASK';
  return 'CHAT';
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
  const { focusKind, focusValue } = deriveFocus(turn);
  return {
    domain: turn.domain,
    speechAct: turn.speechAct ?? 'unknown',
    conversationalMode: deriveConversationalMode(turn, commitmentLevel),
    userGoal: deriveUserGoal(turn, commitmentLevel),
    action: turn.action,
    informationNeed: turn.informationNeed ?? 'none',
    commitmentLevel,
    scopeBreadth: deriveScopeBreadth(focusKind),
    focusKind,
    focusValue,
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
