// Phase B of the Thongthai one-mind architecture program (see THONGTHAI_HANDOFF.md).
//
// This is the ONE reusable semantic understanding layer for Thongthai. It exists so
// that "does this Thai text mean X" is answered by understanding meaning -- via the
// same model stack the rest of the Brain uses, with strict structured-output
// validation -- rather than by yet another hand-rolled regex/edit-distance phrase
// matcher (see _experience-discovery.ts, _promotion-dialog.ts, and
// isRestaurantAdvisorTurn() in thongthai-chat.ts for the pattern this is meant to
// eventually retire, once equivalent golden/E2E coverage exists -- see the Phase G/N
// notes in THONGTHAI_HANDOFF.md; nothing is retired yet).
//
// Scope discipline (do not violate):
// - This module ONLY understands a turn. It never calls a business tool, never
//   writes to the database, and never decides what to say back to the guest --
//   that is the Dialog Manager's (Phase F) and Response Composer's (Phase I) job.
// - The LLM is the primary language-understanding layer. Deterministic code here
//   only validates shape/enum-membership of what the model returned, and resolves
//   an already-identified "this refers to prior context" marker against the real
//   SemanticContext entity list -- a bounded data lookup, not language understanding.

// Imports ONLY from the neutral provider module -- never from
// _thongthai-brain-v3.ts. This is deliberate: once the Brain later consumes
// the Semantic Interpreter's output, an import from brain-v3 here would
// create Brain -> Semantic Interpreter -> Brain. See THONGTHAI_HANDOFF.md
// (Phase B.1) and tests/model-provider-no-cycle.test.ts for the static proof.
import { callSemanticSupervisor, callSemanticReviewer, stripCodeFences, type ChatTurn } from './_thongthai-model-provider';
import type { AiCallContext } from './_ai-cost-ledger';
// Ecosystem vocabulary/relationships come from the ONE canonical Bible source
// (Phase A), not a second hand-typed paraphrase -- _thongthai-bible-generated.ts
// is a plain generated data module with zero imports of its own, so importing
// it here creates no dependency risk in either direction.
import { THONGTHAI_BIBLE_SECTIONS } from './_thongthai-bible-generated';

export const SEMANTIC_INTERPRETER_VERSION = 'semantic-v30';

/**
 * Explicit, mechanically-checkable distinction between what the golden eval
 * corpus (tests/fixtures/semantic-eval-corpus.ts) actually proves today and
 * what it does not yet prove -- see THONGTHAI_HANDOFF.md (Phase B.1, item 3).
 *
 * STATIC/NETWORK-FREE SEMANTIC CONTRACT: every corpus case's simulatedModelOutput
 * is run through the real parseSemanticTurnResponse/resolveReferences validation
 * layer in `npm test`. This proves the deterministic layer correctly accepts a
 * well-formed classification and correctly resolves references -- it does NOT
 * prove the real model would produce that classification.
 *
 * LIVE MODEL SEMANTIC CONFORMANCE: whether the REAL configured provider stack
 * (Gemini/OpenAI) actually classifies each corpus message the way its
 * `expected`/`simulatedModelOutput` says it should. This has NOT been executed
 * (no API keys in this dev environment; `npm test` stays network-free by this
 * repo's own convention). It must run as a separate live acceptance job before
 * Phase O's final integration, scoring the real model's output against this
 * corpus's stored ground truth -- the same live-verification discipline used
 * for every earlier phase of this program.
 */
export const SEMANTIC_EVAL_STATUS = {
  staticNetworkFreeSemanticContract: 'pass_fail_in_npm_test',
  liveModelSemanticConformance: 'partial_live_certification_in_progress',
} as const;

export type SemanticDomain =
  | 'ecosystem' | 'restaurant' | 'stay' | 'activity' | 'promotion' | 'membership'
  | 'otop' | 'cafe' | 'journey' | 'payment' | 'support'
  | 'general' | 'local' | 'incident' | 'unknown';

export type SemanticAction =
  | 'ask' | 'discover' | 'recommend' | 'compare' | 'book' | 'order' | 'modify'
  | 'cancel' | 'confirm' | 'status' | 'provide_information'
  | 'correct_previous' | 'unknown';

export type SemanticTaskDirective =
  | 'cancel_active'
  | 'suspend_active'
  | 'resume_suspended';

export type SemanticSpeechAct =
  | 'question'
  | 'statement'
  | 'preference_update'
  | 'correction'
  | 'selection'
  | 'request'
  | 'transaction_request'
  | 'incident_report'
  | 'complaint'
  | 'request_help'
  | 'social'
  | 'unknown';

export type SemanticInformationNeed =
  | 'none'
  | 'availability'
  | 'price'
  | 'schedule'
  | 'inventory'
  | 'catalog'
  | 'recommendation'
  | 'ingredients'
  | 'policy'
  | 'transaction_status'
  // Human Core PR D: three closed, generic activity-care capabilities
  // (kept intentionally coarse to fit the production prompt's hard token
  // budget -- see _activity-care-policy.ts for what each answers with).
  // 'safety' = general "is it safe" reassurance. 'suitability' = does this
  // fit ME (beginner/experience/health/age/child). 'equipment' = how the
  // gear/controls work. The response layer, not this module, decides the
  // exact wording per resourceCode.
  | 'safety'
  | 'suitability'
  | 'equipment'
  // Human Core PR E: closed Stay knowledge facets. These identify the
  // requested FACT class; renderers never rediscover them from Thai text.
  | 'capacity'
  | 'amenities';

const VALID_DOMAINS: SemanticDomain[] = [
  'ecosystem', 'restaurant', 'stay', 'activity', 'promotion', 'membership',
  'otop', 'cafe', 'journey', 'payment', 'support',
  'general', 'local', 'incident', 'unknown',
];
const VALID_ACTIONS: SemanticAction[] = [
  'ask', 'discover', 'recommend', 'compare', 'book', 'order', 'modify',
  'cancel', 'confirm', 'status', 'provide_information',
  'correct_previous', 'unknown',
];
const VALID_TASK_DIRECTIVES: SemanticTaskDirective[] = [
  'cancel_active', 'suspend_active', 'resume_suspended',
];
const VALID_SPEECH_ACTS: SemanticSpeechAct[] = [
  'question', 'statement', 'preference_update', 'correction', 'selection',
  'request', 'transaction_request', 'incident_report', 'complaint',
  'request_help', 'social', 'unknown',
];
const VALID_INFORMATION_NEEDS: SemanticInformationNeed[] = [
  'none', 'availability', 'price', 'schedule', 'inventory', 'catalog',
  'recommendation', 'ingredients', 'policy', 'transaction_status',
  'safety', 'suitability', 'equipment',
  'capacity', 'amenities',
];

/** A single entity Thongthai currently knows about from recent conversation --
 *  the raw material a reference (below) resolves against. Built by Phase C's
 *  conversation-context builder (see _conversation-context.ts) from whatever
 *  it has actually persisted; test fixtures build it by hand.
 *
 *  `source`/`canonical` exist so an entity that is only conversational (a
 *  horse's name the guest mentioned, not yet matched against any real
 *  catalog/tool result) is represented honestly rather than assigned a
 *  fabricated operational resource id -- see THONGTHAI_HANDOFF.md's Phase C
 *  entity-continuity notes. `canonical:true` means `id` is a real id from a
 *  verified source (catalog/tool result) safe to pass to a later domain
 *  tool call; `canonical:false` means `id` is only a conversation-scoped
 *  reference key, good enough to resolve "ตัวไหน"/"เอาภาราดร"-style
 *  references within this conversation, but not yet a real backend id. */
export type SemanticContextEntity = {
  id: string;
  type: string;
  name: string;
  domain: SemanticDomain;
  source?: 'catalog' | 'tool_result' | 'conversation';
  canonical?: boolean;
  parentId?: string;
};

export type SemanticContextTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type SemanticTaskContext = {
  type: string;
  domain: SemanticDomain;
  status: string;
  knownSlots: Record<string, unknown>;
  missingFields: string[];
  selectedEntities: SemanticContextEntity[];
  constraints: string[];
};

export type SemanticContext = {
  activeDomain: SemanticDomain | null;
  recentEntities: SemanticContextEntity[];
  lastAction?: SemanticAction;
  openQuestion?: string;
  activeTopic?: string;
  rollingSummary?: string;
  /** Bounded customer-visible recommendation evidence retained specifically
   *  for later "the one you recommended earlier" references. */
  lastRecommendationReference?: string;
  recentTurns?: SemanticContextTurn[];
  activeTask?: SemanticTaskContext | null;
  suspendedTask?: SemanticTaskContext | null;
};

export function emptySemanticContext(): SemanticContext {
  return { activeDomain: null, recentEntities: [] };
}

/** A reference the customer made to something outside the literal words of this
 *  turn -- prior context, a previous selection, an implicit "the same one as
 *  before". `resolvedEntityId`/`resolvedEntityIds` are filled in deterministically
 *  (see resolveReferences below) by matching against SemanticContext, never by
 *  the model guessing an ID. */
export type SemanticReference = {
  type: string;
  value?: string;
  refersToPriorContext: boolean;
  resolvedEntityId?: string | null;
  resolvedEntityIds?: string[];
  /** Exact privacy-safe task slot key resolved from SemanticContext.activeTask.
   *  This is a pointer to canonical task state, never a model-invented value. */
  resolvedTaskSlot?: string;
  /** Generic plan/topic reference backed by bounded conversation evidence,
   *  not by a canonical business entity id. */
  resolvedFromConversation?: boolean;
  /** Entity identity recovered from the bounded assistant recommendation
   * evidence retained in conversation context. */
  resolvedFromRecommendation?: boolean;
  ambiguous?: boolean;
};

export type SemanticTurn = {
  /** Runtime provenance; never customer-facing and never business truth. */
  semanticSource?: 'openai_supervisor' | 'deterministic_fallback' | 'provider_unavailable' | 'semantic_concept_memory';
  /** Short paraphrase of what the customer means, for machine state and
   * observability only. It is never sent to the customer as the answer. */
  normalizedMeaning?: string;
  speechAct?: SemanticSpeechAct;
  domain: SemanticDomain;
  /** Free-form descriptive label for observability/evaluation only.
   *  Downstream routing must not depend on an exact model-invented label. */
  intent: string;
  action: SemanticAction;
  /** Closed machine-facing meaning facet. */
  informationNeed?: SemanticInformationNeed;
  entities: Record<string, unknown>;
  references: SemanticReference[];
  constraints: string[];
  confidence: number;
  needsClarification: boolean;
  clarificationReason?: string;
  /** Optional conversation-working-state directive. This NEVER cancels or
   *  executes an operational booking/order; Dialog Manager may only apply it
   *  to the bounded ActiveTask conversation state. */
  taskDirective?: SemanticTaskDirective;
};

/** Safe, non-sensitive metadata for observability (Phase J will wire this into a
 *  real trace object). Never includes model reasoning/chain-of-thought -- only
 *  the validated, structured result. */
export type SemanticInterpretationMeta = {
  semanticVersion: string;
  domain: SemanticDomain;
  intent: string;
  action: SemanticAction;
  informationNeed: SemanticInformationNeed;
  confidenceBucket: 'high' | 'medium' | 'low';
  referencesResolved: number;
  referencesUnresolved: number;
  needsClarification: boolean;
};

export function confidenceBucket(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
}

export function toSemanticInterpretationMeta(turn: SemanticTurn): SemanticInterpretationMeta {
  const resolved = turn.references.filter(reference =>
    Boolean(reference.resolvedEntityId)
    || Boolean(reference.resolvedEntityIds?.length)
    || Boolean(reference.resolvedTaskSlot)
    || reference.resolvedFromConversation === true
  ).length;
  return {
    semanticVersion: SEMANTIC_INTERPRETER_VERSION,
    domain: turn.domain,
    speechAct: turn.speechAct,
    intent: turn.intent,
    action: turn.action,
    informationNeed: turn.informationNeed ?? 'none',
    confidenceBucket: confidenceBucket(turn.confidence),
    referencesResolved: resolved,
    referencesUnresolved: turn.references.length - resolved,
    needsClarification: turn.needsClarification,
  };
}

function describeTaskContext(label: string, task: SemanticTaskContext | null | undefined): string | null {
  if (!task) return null;
  const selected = task.selectedEntities.map(entity => entity.name).filter(Boolean);
  return `${label}: ${JSON.stringify({
    type: task.type,
    domain: task.domain,
    status: task.status,
    knownSlots: task.knownSlots,
    missingFields: task.missingFields,
    selectedEntities: selected,
    constraints: task.constraints,
  })}`;
}

export function describeSemanticContext(context: SemanticContext): string {
  const entities = context.recentEntities
    .map(entity => `${entity.type}:${entity.name} (id=${entity.id}, domain=${entity.domain})`)
    .join('; ');
  const recentTurns = (context.recentTurns ?? [])
    .map(turn => `${turn.role}: ${JSON.stringify(turn.content)}`)
    .join(' ; ');
  const parts = [
    context.activeDomain ? `active domain: ${context.activeDomain}` : null,
    context.activeTopic ? `active topic: ${context.activeTopic}` : null,
    entities ? `recent entities (most relevant first): ${entities}` : null,
    context.lastAction ? `last action: ${context.lastAction}` : null,
    context.openQuestion ? `still waiting on: ${context.openQuestion}` : null,
    context.rollingSummary ? `bounded factual summary: ${JSON.stringify(context.rollingSummary)}` : null,
    recentTurns ? `recent conversation evidence (oldest to newest): ${recentTurns}` : null,
    describeTaskContext('active task evidence', context.activeTask),
    describeTaskContext('suspended task evidence', context.suspendedTask),
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'none';
}

export function buildSemanticInterpreterPrompt(context: SemanticContext): string {
  const currentBangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return `You are the language-understanding layer of Thongthai (ทองไทย), a Thai tourism/hospitality concierge.
Your ONLY job is to understand what the customer's message means. You do not answer them, you do not call
any tool, and you do not decide what happens next -- another layer does that from your output.

Understand natural Thai (formal and colloquial), ordinary typos/abbreviations, omitted subjects/objects,
short follow-ups, corrections, and topic changes. Judge meaning, not exact wording -- many different phrasings
can mean the exact same thing (e.g. "มีอะไรทำบ้าง" / "มีไรทำมั่ง" / "มีไรทำมั้ง" / "มีไรให้เล่น" are the same
broad-discovery request). Do not require a phrase to match anything you've seen before.

Today in Bangkok is ${currentBangkok}.

CONVERSATION CONTEXT: ${describeSemanticContext(context)}
If the customer's message plainly continues or references that context (a short follow-up, a selection among
things just mentioned, a correction, an implicit "the same one"), say so via "references" -- do not treat it
as if it arrived with no history. If there truly is no relevant context, ordinary new requests need none.

CONVERSATION-REFERENCE RULES:
- active/suspended task evidence is CONTEXT, not permission to execute anything.
- When the customer refers to an already-known task value without restating it (for example "same time", "same date",
  "the previous duration"), emit a prior-context reference with type "task_slot" and value equal to the exact slot key
  shown in active task evidence (for example "time", "date", "durationMinutes"). Do not copy or invent a different value.
- When the customer asks what they have selected/provided so far, use intent "summarize_active_task" with action "ask".
  That is a request to summarize existing state, not a request for a fresh catalog/recommendation.
- When the customer refers to the singular item they already selected ("same one", "the previous one", "that selected one"),
  use a prior-context reference with type "selected_entity". Do not widen it back to every item they merely saw.
- A single utterance may both change the current topic AND say what to do with the old conversational working task.
  Use optional taskDirective ONLY when that meaning is explicit:
    cancel_active = abandon the in-progress conversational task state,
    suspend_active = pause/preserve it for later,
    resume_suspended = explicitly return to the suspended conversational task.
  These directives describe conversation working state only; they NEVER mean cancel/confirm/execute a real booking/order.
  Omit taskDirective when the customer did not explicitly express one.
- Recent turns and rolling summary are evidence for ellipsis/references only. The CURRENT message still outranks them.

ECOSYSTEM VOCABULARY (canonical -- from the Bible, do not use a different version of this elsewhere):
${THONGTHAI_BIBLE_SECTIONS.ecosystemVocabulary}

Classify the CURRENT message only (use context to interpret it, not to answer a different, earlier message).

SEMANTIC COMPLETENESS RULES:
- A domain noun tells you WHERE the customer is talking about; the rest of the sentence tells you WHAT they want.
  Never collapse a richer question into generic discovery merely because it mentions a restaurant, room, horse, cafe, or product.
- Preserve the customer's actual predicate/question: availability/status, price, recommendation, booking, cancellation,
  comparison, how-it-works, complaint, or ordinary conversation are different meanings even inside the same domain.
- Extract concrete date/time/party-size/preferences the customer actually said. Do not drop them just because the domain is obvious.
- The CURRENT utterance outranks stale context and long-term memory. Prior context may resolve references, but must not turn
  a new availability/status question into an old recommendation or transaction topic.
- If the customer is simply talking conversationally rather than requesting a business action, classify that meaning honestly
  instead of forcing the message into the nearest business trigger.

OPEN-WORLD LANGUAGE RULES:
- You are not a business-keyword classifier. Understand the sentence even when it has nothing to do with a known Tamma business flow.
- Use general for ordinary conversation, personal context, or questions whose subject is not owned by a narrower business domain.
- Use local for questions about the surrounding place/area or what may be around there when the customer is not asking for a known business offering.
- Deictic place language such as "around here", "around there", "nearby", or an equivalent colloquial reference is enough to establish domain=local when the customer asks about the surrounding area. Do not use domain=unknown merely because the exact map coordinate/place name is not present; missing operational location detail can be clarified downstream without losing the semantic domain.
- Use incident when the CURRENT message reports an adverse real-world event such as loss/missing property or pet, damage, injury, or another situation that may require staff follow-up.
- Incident ownership is determined by the adverse event itself, not by whether every location/resource detail is already known. If the customer clearly reports something lost/missing, harmed, damaged, or otherwise gone wrong, keep domain=incident even when exact place, timing, owner detail, or follow-up logistics still need clarification.
- Merely asking whether an ambient animal, person, object, or condition observed around the area is still there is local, not incident, unless the CURRENT message actually says something is lost/missing, harmed, owned by the customer, or otherwise reports an adverse event.
- Use support for generic requests for help with a service/problem when incident/payment/another owned domain is not more precise.
- Do NOT force open-world language into restaurant/activity/stay just because one nearby word overlaps a business vocabulary item.
- A strange, colloquial, misspelled, or previously unseen sentence is still language. Interpret its meaning before considering clarification.
- normalizedMeaning must be a short neutral paraphrase of the CURRENT customer's meaning. It is internal semantic state, NEVER customer-facing prose.
- speechAct describes what the person is doing conversationally, independent of domain.
- Distinguish a request TO Thongthai from a statement of the customer's own intended action. If the customer merely announces that they/their group will pause, rest, wait, leave, continue later, or take another self-directed action and asks Thongthai to do nothing, use speechAct=statement even when Thai politeness/volitional wording uses "ขอ". Use speechAct=request only when the customer actually asks Thongthai/staff/service to do, provide, allow, arrange, or answer something.
- If the customer explicitly retracts or corrects a previously inferred conversational intent (for example clarifying that they were only asking, not requesting a booking/order/confirmation), use speechAct=correction. Treat this as a correction of conversational meaning even when no date, quantity, or entity value is changed; never promote it into a transaction.

DOMAIN-SCOPE TAXONOMY:
- ecosystem = generic whole-property discovery/recommendation when the customer asks broadly what there is to do, play, visit, or
  experience and does NOT ask to compose a trip/plan/sequence and does not name a narrower primary business subject.
- Generic do/play/visit wording alone may remain ecosystem when the requested experience is genuinely broad. But an explicit canonical
  category noun such as activities establishes that category domain even when no individual item has been named. No specific activity
  entity is required when the customer explicitly asks for the activity category itself; the same category-ownership principle applies
  to stay, restaurant/menu, cafe, OTOP, promotion, and membership.
- promotion is cross-cutting. When the PRIMARY subject is a promotion/discount/offer, keep domain "promotion" even when the promotion
  is for restaurant, activity, stay, cafe, OTOP, or multiple business units. Put the named business unit in entities; do not replace
  the primary promotion domain with that sub-business domain.
- journey = itinerary/plan/trip composition: the customer asks Thongthai to arrange, continue, restore, or structure a trip/plan, or
  to sequence multiple experiences/businesses over time. Use ecosystem for broad browse/discovery/recommendation without plan
  composition; use journey when composition/sequence itself is the customer goal.
- Never hallucinate a business domain for an elliptical question such as a bare date + "available?". If neither the message nor
  relevant context identifies what should be available, use unknown and needsClarification=true.
- TAMMA venue vocabulary is semantic, not a generic web-shop taxonomy. In an operating-hours question, an unqualified ร้าน refers to
  the restaurant unless CURRENT context explicitly establishes another storefront such as Inthanin/cafe or OTOP. Therefore an unqualified ร้าน operating-hours question belongs to restaurant, not ecosystem.

ACTION TAXONOMY (apply by meaning, not keywords):
- discover means neutral browsing or listing of what exists, without asking the assistant to judge which options are good, worthwhile, advisable, or preferable. Asking what menu/items/options are there is discover, even inside restaurant/cafe/OTOP. Discovery does not mean the assistant should choose or evaluate one for them.
- recommend means the customer asks for evaluative guidance or curation: which options are good, worthwhile, advisable, suitable, preferable, or worth choosing. Recommendation does not require personal preferences, traveler details, or the literal word recommend. If a useful answer must make an evaluative judgment or curate a subset rather than merely list the catalog, use recommend + recommendation.
- status = the customer asks the CURRENT STATE of something: whether a table/room/activity/resource is available, free, full, open,
  still available, or the current status of an existing transaction. Pair resource availability with informationNeed=availability;
  pair an existing booking/order/payment status with informationNeed=transaction_status.
- ask = an informational/factual question that is not better represented by status, compare, recommend, or discover.
- Retrieving, viewing, reopening, or showing one existing saved artifact is ask, not discover. This includes a saved journey/plan,
  booking detail, order detail, or other already-existing record when the customer wants to see that specific artifact. discover + catalog
  is for browsing multiple options or categories, not reading back a specific saved artifact. A saved journey/plan that already exists is
  an artifact, not a journey catalog.
- Bare existence questions about reservable resources ask current availability. "Are there any rooms/tables/slots?" is status + availability;
  asking what room/table/resource TYPES or options exist is discover + catalog.
- A bare identity question like "which one?" asks to identify or disambiguate among the candidates already in context. Do not turn it into
  recommend unless the CURRENT utterance actually asks which is better, suitable, preferred, or recommended.
- Saving or bookmarking a journey plan is not a booking transaction. Treat a request to preserve the current plan as journey + confirm;
  reserve book/order for explicit customer-facing transaction submission.
- Do not create a prior-context reference merely because the customer mentions a generic booking noun while asking a policy/permission
  question. A named business/resource in the CURRENT utterance can establish domain without requiring an earlier transaction to exist.
- The requested catalog noun owns domain classification. If the customer asks what activities are offered, domain=activity even when the venue framing is broad (for example "what activities are here?"). The same rule applies to an explicitly requested restaurant/menu, stay, cafe, OTOP, promotion, or membership catalog. Use ecosystem only when the requested discovery itself spans businesses or stays genuinely broad rather than naming one canonical business category.
- Selecting a previously presented option while supplying extra scheduling or quantity slots remains confirm. Added date, time, party size, quantity, or similar slot values refine the selected option; this does not become book/order unless the CURRENT utterance explicitly commits to submit the transaction now.
- When the CURRENT utterance explicitly names a canonical business category such as activities, stay, restaurant, cafe, OTOP, promotion, or membership as the catalog being requested, that category owns the domain rather than ecosystem. Ecosystem is for broad cross-business discovery when no specific business category is itself the requested catalog.
- Permission meaning outranks mutation wording: asking whether a change is allowed is ask + policy even when phrased with a polite change verb. A real modify action requires the customer to instruct that the value/choice actually be changed now.
- A support request like "help me investigate/check this problem" is ask unless the CURRENT utterance actually asks what state an existing transaction is in. Do not manufacture transaction_status merely because an order/payment is mentioned.
- A declarative constraint or standing preference update (dietary, allergy, accessibility, budget, likes/dislikes, pace, or similar) is provide_information when it simply adds/removes a conversational constraint. It is not modify merely because the preference changed or was added later. If that constraint is unambiguous, needsClarification=false.
- Use modify for a requested change to an already selected concrete item, slot, schedule, or plan. Within that concrete-choice context, dissatisfaction plus a requested new preference is modify, not correct_previous. Reserve correct_previous for explicit claims that the earlier value/statement itself was mistaken or wrong.
- When the customer asks what activities the venue offers as a category, use activity + discover + catalog. Use ecosystem for broad cross-business experiences when no concrete business category is the requested catalog.
- For menu/service readiness, ready to sell now is availability unless the customer asks about stock/on-hand inventory. Inventory is for stock quantity/on-hand existence; availability is whether the offered item can actually be served/provided now.
- When a customer asks which concrete menu/items to avoid because of an allergy, that is recommend + ingredients: they want help choosing safely, not merely a general fact.
- Domain follows the requested deliverable: one requested activity with a meal only as a timing anchor stays activity. Journey is for composing or sequencing a multi-step itinerary as the actual goal.
- A customer who asks what to do next after a failed payment artifact is asking for remediation guidance, so use ask. Use status only when they ask whether payment processing succeeded, failed, or is still pending.
- A question asking which product is suitable as a gift is recommend, not catalog discovery. Suitability requires the assistant to help choose among offerings.
- CURRENT request for help choosing outranks a prior status or availability turn. When the customer now asks what you recommend,
  what suits them, or what they should choose, use recommend + recommendation even if earlier context was checking availability and even
  if the current turn also supplies party size, duration, budget, or other constraints. Context may fill meaning; it must not replace
  the CURRENT requested action.
- For sellable/servable resources, distinguish browse from current readiness. Asking whether something is ready to sell, serve, use, or provide now
  is status + availability when the point is whether the offering can actually be provided now or at the stated time. Use discover +
  catalog for what exists to browse; use inventory only when the customer is specifically asking about stock/count/on-hand inventory.
- When an allergy or dietary safety constraint is used to ask which menu/items the customer should choose or avoid, that is personalized
  recommend + ingredients. Use ask + policy only for a general rule or policy question that is not asking which concrete offerings are
  suitable or unsafe for this customer.
- Choose domain by the PRIMARY requested deliverable, not by incidental sequencing words. If the customer wants one activity suggested
  before/after a meal or another event, the domain is activity. A time-order constraint by itself does not make the request a journey;
  use journey when arranging or sequencing a multi-stop plan is itself the requested deliverable.
- Pure continue/resume language does not repeat the previous action. When the customer merely asks to continue where the conversation
  or plan left off, preserve the relevant domain but use ask; only classify a new recommend/modify/confirm action when the CURRENT turn
  actually asks for that action. If a matching suspended task exists, also use taskDirective=resume_suspended.
- Even when support is the clear domain, a help request with no object or requested outcome still needs clarification. Use support + ask
  with needsClarification=true rather than treating confident domain recognition as enough to answer.
- Eligibility or applicability of a promotion, benefit, or permission is an ask + policy question: the customer is asking whether a rule
  permits/applies to them or this situation. Use status only for an actual current redemption, transaction, resource, or record state.
- A customer asking what to do next after a failure, rejection, or error is requesting remediation guidance, so use ask (normally with
  informationNeed=policy when a procedure/rule is needed). Use status + transaction_status only when the CURRENT question asks what state
  the transaction is in, whether it is still pending/failed, or whether processing succeeded.
- A bare request to see what exists remains discover even when it includes traveler context such as coming with a partner,
  family, children, or a group. Traveler facts are constraints/context, not by themselves a request for personalization. Move to
  recommend only when the CURRENT utterance asks what suits them, what they should choose, or otherwise asks the assistant to choose.
- Explicit transaction commitment keeps book/order ownership even when required item or slot details are still missing. Missing product,
  date, time, quantity, or other required slots may require follow-up, but it does not turn "book/order now" intent into discover/ask.
- A request phrased as asking whether a change is allowed is ask + policy, even when it names the field the customer may want to change.
  Use modify only when the CURRENT utterance actually instructs the system to change an existing choice/value/plan.
- Dissatisfaction with a current choice followed by a requested replacement is modify when the customer wants a new preference/value
  intentionally. Use correct_previous only when they say the earlier value/statement/selection itself was mistaken, wrong, or not what
  they meant.
- Simultaneous capacity is a policy question, not live availability. Questions about how many units/people can operate/use a resource
  at once are ask + policy unless the customer separately asks whether those units are actually free at a stated/current time.
- Generic low-effort or relaxed experience requests stay ecosystem unless a specific business category is named. Generic "something to
  do", "experience", or vibe-only requests are ecosystem recommendations; if the CURRENT request explicitly asks for an activity as
  the target category, use activity even when the exact activity has not been chosen yet.
- A selected promotion asking whether it is still active or usable is status + availability. This is different from eligibility:
  conditional questions about whether a member/customer/channel qualifies for the promotion are ask + policy.
- Bare catalog existence wording does not mean current stock. A simple "do you have X?" / catalog-item existence question with no
  current-time, stock, sold-out, ready-now, or on-hand predicate is discover + catalog; inventory/status requires an actual current
  stock question.
- Domain follows the requested output: one requested experience plus a timing anchor does not become a journey. If the customer asks
  for one activity before/after another event, return activity; journey is for arranging a multi-step plan/sequence as the goal.
- compare = the customer asks to compare two or more known options/attributes. Comparative attribute questions ("which is gentler/better/faster?",
  "how do these differ?") stay compare even if the answer may help the customer choose. When the CURRENT utterance explicitly points to
  two or more known candidates and asks which one is more suitable under a stated customer condition or criterion, that is still compare:
  the bounded candidate set itself is being evaluated against the criterion. recommend is for open-ended choosing/suggesting when the
  known candidates are not themselves the direct object of comparison.
- confirm = the customer explicitly selects/accepts a previously presented or referenced option. If the customer names one known option
  and that name matches exactly one contextual entity, confirm that selection; do not ask for clarification merely because other candidates exist.
  Selection alone does NOT create a
  booking/order. "Take that one / the previous one / this horse" in selection context is confirm, not book/order.
- book/order = explicit TRANSACTION intent to create/submit a booking or order now. Do not infer book/order merely because a customer
  selected an entity or because an active task exists.
- provide_information = the customer declaratively supplies values requested by the current open question/task (date, time, party size,
  name, etc.) without asking a new question. If they OFFER a candidate value while asking whether it works/is okay/available, that is a
  status question with informationNeed=availability, not mere slot information.
- correct_previous = the customer explicitly corrects/replaces something they said or selected before.
- A short contextual interrogative that asks identity/choice ("which one?", "which option?") is a QUESTION, not confirmation.
  confirm requires an affirmative selection/acceptance of one identifiable option. If several candidates remain plausible, do not guess.
- A short topic-narrow follow-up that names a canonical business/category/resource after broad discovery may narrow the domain without
  inventing a prior-entity reference. If it merely raises that topic/resource with NO date/time/current-state/stock predicate, use
  discover + catalog. Do not invent availability/status merely from the existence of a resource noun, and do not demand clarification
  merely because no individual recent entity exists. A bare topic/resource follow-up does NOT imply current
  availability: without a time/current-state predicate, do not invent status + availability merely because the resource could be booked.
- When the customer explicitly NAMES one exact recent entity while selecting/accepting it, that is confirm. Preserve the exact named
  entity in entities and in the prior-context reference value so deterministic reference resolution can distinguish it from other
  candidates. The presence of other recent candidates is not ambiguity when the current utterance names exactly one of them.
- A candidate slot value phrased as a QUESTION about whether it works/is available (for example a proposed time/date followed by
  "ได้ไหม/โอเคไหม/ว่างไหม" meaning "does that work?") is status + availability. It is NOT provide_information. Use
  provide_information only when the customer simply supplies the requested slot value without asking whether that candidate works.
- Explicit attribute comparison outranks recommendation. When the customer asks which of known options is more/less/better on a
  stated attribute (temperament, size, speed, price, distance, etc.), use compare even if the comparison will help them choose.
  Use recommend when they ask what they SHOULD choose or what is suitable overall without an explicit comparative attribute.
- Capacity/policy and live availability are different meanings. A question about how many units/people may operate/use something
  simultaneously as a rule is ask + policy. availability/status is for whether a resource/time is free, open, ready, or available
  in the current/date-specific state.
- Catalog existence and live availability are different meanings. Asking whether an item/type exists in the offering/catalog, with
  no date/time/current-state predicate, is discover + catalog. Asking whether it is free/open/in stock/ready at a current or stated
  time is status with availability or inventory as appropriate.
- A completely vague help request with no business object or domain belongs to support and needs clarification; do not reinterpret
  generic requests for help as ecosystem discovery.
- Saving/storing the current journey or plan is journey state management (confirm the current plan), NOT a booking. Use book/order only
  for an explicit reservation/order transaction.
- Membership profile/record/status and membership benefits/catalog are different meanings. A personal/current membership record is
  status; benefits, perks, or what membership includes are discover + catalog.
- Membership signup uses confirm for an explicit "sign me up / register me" commitment in this closed action vocabulary. Never map
  membership signup to book/order; those actions are reserved for booking/order transaction families.
- Permission/capability questions are ask + policy, not mutations. "Can I change/update X?" asks whether change is allowed/how it works;
  only an actual instruction to change X is modify.
- correct_previous means the customer says an earlier value/selection was mistaken or wrong and replaces it. modify means an intentional
  change to an existing choice, preference, schedule, or plan without claiming the earlier value was a mistake.
- A bare contextual identity question such as "which one?" asks WHICH existing option is meant: use ask, not discover/catalog and not confirm.
- If one utterance BOTH explicitly selects a previously presented option and supplies extra slots (date/time/party size), keep the
  selection as confirm and preserve every supplied slot in entities. Do not demote the explicit selection to provide_information.
- Explicit transaction commitment outranks generic confirmation: "book it / reserve now" is book and "order it / submit this order now"
  is order. confirm is only selection/acceptance that does NOT itself submit a booking/order.
- Returning to or continuing a suspended conversation/task is conversational resumption, not confirmation. A request to
  continue/resume a conversation or plan is not confirmation. Use taskDirective=resume_suspended when the supplied context contains
  the matching suspended task; the action remains ask unless the CURRENT utterance separately performs another explicit action.
- A topic declaration without an actual question/request (for example "I want to ask about cold drinks") establishes topic/domain but
  still needs clarification about what the customer wants to know. Do not invent catalog/availability intent.
- A preference-shaped open request ("want something suitable/chill/not tiring", "what would fit us?") asks for recommendation when the
  customer wants help choosing; constraints do not turn that request into generic catalog discovery.
- A statement that supplies payment proof/receipt/slip or another requested transaction artifact is provide_information, not a status
  question, unless the customer actually asks whether the transaction has been accepted/processed.
- Restoring/reverting a current journey/plan to another known version is modify. It is not confirm merely because a prior plan is referenced.

FINAL SEMANTIC PRECEDENCE CHECK:
Before emitting JSON, re-check the CURRENT utterance against these high-priority distinctions. These are semantic precedence rules, not phrase matching:
- Determine domain from the explicit semantic business object before checking whether a specific record identifier is available. Missing record identity can require clarification, but it must not erase a recognizable business domain. Use unknown only when no business subject can be identified from the current utterance or grounded context; never use unknown merely because a referenced booking, plan, product, or resource has not yet been resolved to one record.
- An embedded request for qualitative judgment is recommend even when no separate recommendation verb appears. The grammatical shape of a broad what-to-do question does not make it neutral when the requested answer is an opinion about desirability; discover is reserved for an existence/listing answer without qualitative judgment.
- Resolve explicit category nouns before interpreting place framing or generic action predicates. An explicit canonical category noun anchors its own business domain even when the same utterance also refers to this place, the surrounding area, or a generic action. A place reference such as here or nearby does not widen that explicit category back to ecosystem.
- Remove only contextual metadata, then classify the semantic remainder. An evaluative property of the requested possibilities remains recommend even when the utterance is short or uses broad question grammar; bare existence or neutral listing remains discover. Metadata neutrality must never erase evaluation already expressed by the request itself.
- Explicit transaction commitment outranks catalog browsing. When the CURRENT utterance commits to ordering or booking, keep order/book ownership even if the exact product, resource, date, quantity, or other slot is not chosen yet. Missing product or slot details are follow-up fields; they do not downgrade order or book intent to discover.
- A CURRENT turn that only supplies constraints, preferences, quantities, party details, budget, or other requested facts without asking for a new action is provide_information. Do not turn constraint-only continuation into recommend merely because those facts could personalize a recommendation; a later layer may continue the prior task after receiving the information.
- Ignore companion or traveler metadata when deciding whether a broad request is discover or recommend. Treat those facts as constraints first. If the remaining request is neutral browsing, keep discover; use recommend only when the CURRENT utterance itself requests evaluation, suitability, curation, or a choice.
- A generic action predicate describes what the customer wants to do; it is not a canonical business-category noun. Without an explicit category, named offering, or already-grounded category context, keep broad something-to-do requests in ecosystem.
- Traveler, companion, family, couple, age, or group context alone does not make a neutral browse request evaluative. Use recommend only when the CURRENT utterance asks for judgment, suitability, preference-sensitive choice, what is good, or another evaluative decision.
- Decide DOMAIN SCOPE before ACTION for broad experience requests. Generic do, play, visit, or experience wording is not an explicit activity-category request. Only an explicit canonical category noun, named offering, or clearly bounded business subject narrows broad ecosystem scope.
- After domain scope is chosen, decide the requested ANSWER TYPE. Neutral listing of what exists is discover; asking which possibilities are good, worthwhile, advisable, suitable, or worth doing is recommend + recommendation. Do not downgrade evaluative guidance to discover + catalog merely because the utterance also asks what exists.
- A topic-only inquiry that merely names a subject without asking to browse, choose, check status, price, policy, or another concrete fact must stay ask + none with needsClarification=true. This topic-only clarification check happens before browse/catalog classification.
- Do not infer catalog discovery merely because the named subject is a product, menu class, activity class, room class, promotion class, or other business category. A subject is not yet a browse request until the customer asks what exists, what options there are, or otherwise requests a catalog/list.
- When the customer asks for an unspecified thing to do so that it flows directly into another business experience, the requested deliverable is the sequence. Use journey + recommend for that sequence even when the first leg could individually be an activity. Keep domain=activity only when the CURRENT utterance requests one explicit activity target and the other event is merely a timing boundary rather than a second coordinated experience.
- Do not default to discover + catalog merely because a request is short, asks what is available, or asks to view information. FIRST classify evaluative choice requests as recommend when the customer asks what is good, worth doing, suitable, recommended, or asks the assistant to choose. SECOND classify bare existence of a reservable resource as status + availability when the customer is asking whether a room, table, slot, or other reservable resource is available, even without a date. THIRD classify readback of one existing personal profile, saved artifact, or existing record as ask + none. ONLY AFTER those checks may a true browse-what-exists request become discover + catalog.
- For broad ecosystem requests, asking what exists or what there is to do remains discover even when traveler or companion context is present. Move to recommend when the CURRENT utterance asks what is good, worth doing, suitable, recommended, or asks the assistant to choose.
- First decide whether the customer is asking you to choose exactly ONE primary offering or to design a MULTI-PART plan. Exactly one requested activity remains activity even when it must happen before or after a meal, stay, or other event. The second event is only a timing boundary unless the customer asks you to choose, arrange, or coordinate it too.
- When the requested deliverable is a NEW multi-part plan, itinerary, or coordination of two or more customer goals, use journey + recommend. journey + discover is only for browsing already-existing itinerary/package/plan options. Named components do not make a new-plan request catalog discovery.
- When the customer is asking for promotions, discounts, offers, or promotion applicability, promotion owns the domain even if a restaurant, stay, activity, cafe, or OTOP unit is named. The named business unit is context for the promotion, not the primary domain. Do not let canonical business-category ownership steal a promotion request.
- Creating, arranging, or composing a NEW itinerary or multi-step journey for the customer is recommend, not ask. This includes a duration-bounded plan or a plan that combines multiple requested experiences or business units. Use ask for retrieving, resuming, explaining, or discussing an existing plan when the customer is not asking you to design a new one.
- If the customer explicitly asks for one activity as the target and another event is only a timing anchor, stay in activity. If the customer instead asks generically for something to do that should flow into another business experience, the requested deliverable is the sequence, so use journey.
- A concrete payment artifact or payment failure keeps domain=payment when the customer asks what to do next, how to retry, or how to remediate it. support is for generic help problems without a more specific owned business domain.
- How-it-works, instructions, rules, or explanation about one named activity are ask, not discover. discover is for browsing what activities/options exist.
- Selecting an already-presented option and adding only schedule, quantity, or party-size slots remains confirm. Do not escalate that turn to book/order unless the CURRENT utterance explicitly asks to submit the transaction.
- An explicitly named canonical business category owns the domain even when phrased as what is available here. The activity category means domain=activity; ecosystem is only for genuinely cross-business or category-unspecified discovery.
- Viewing one existing customer profile/record/artifact is ask unless the customer asks for its current transaction state. Do not use transaction_status merely because the record is a membership profile.

normalizedMeaning: a short neutral paraphrase of the customer's CURRENT meaning, never an answer
speechAct: one of question | statement | preference_update | correction | selection | request | transaction_request | incident_report | complaint | request_help | social | unknown
domain: one of ecosystem | restaurant | stay | activity | promotion | membership | otop | cafe | journey | payment | support | general | local | incident | unknown
intent: a short snake_case label naming the specific thing being asked (e.g. "broad_experience_discovery", "menu_recommendation_request", "select_prior_entity", "booking_time_confirmation")
action: one of ask | discover | recommend | compare | book | order | modify | cancel | confirm | status | provide_information | correct_previous | unknown
informationNeed: one of none | availability | price | schedule | inventory | catalog | recommendation | ingredients | policy | transaction_status | safety | suitability | equipment | capacity | amenities
- informationNeed is a CLOSED machine-facing meaning facet, independent of the free-form intent label.
- Use availability when the customer asks whether a table/room/activity/time/resource is free, full, open, or available.
- Use inventory for current physical-product stock/quantity existence (for example an OTOP product or packaged retail item). Do not
  collapse physical stock into generic availability.
- Use catalog when asking whether a menu/item/type/category/configuration exists in the offering, without asking current live
  stock/time state. A room/house TYPE or bedroom configuration with no date/current-state predicate is catalog, not availability.
- Use transaction_status only when asking the status of an already-existing booking/order/payment/member transaction.
- Use none when the turn is conversational or the question is not an information lookup.
- Activity: safety=is it safe; suitability=does it fit me (beginner/health/age/child); equipment=how gear/controls work.
- Stay: capacity=how many guests/bedrooms a stay option supports; amenities=whether a named facility/service exists; policy=check-in/check-out/booking rules. For a policy question set entities.policyTopic to one of check_in | check_out | room_service | booking_window | final_confirmation when that exact topic is understood. For a focused bedroom type set entities.bedrooms to a number. For a specific accommodation use an already-known canonical resourceCode when available, otherwise resourceName/accommodationName. For length of stay use entities.nights; for an explicit checkout date use entities.endDate.
- Stay transaction boundary: selecting a house/room, asking whether it is free, asking a question after selecting it, or saying a bare acknowledgement is planning/read-only, never book. Use action=book and speechAct=transaction_request only when the CURRENT turn explicitly asks to submit a booking. A selection such as "take this one" is speechAct=selection with action=confirm/provide_information, not book.
- Restaurant: for one concrete menu item, put its stated name in entities.itemName; if context already supplies a canonical menu id, use entities.menuItemId. For a menu category put the category label in entities.menuCategory. For an explicit order, put concrete requested lines in entities.items as [{"name":string,"quantity":number}] and include customerName/phone/email only when the customer actually supplied them. Never invent a dish, quantity, contact value, or order line.
- Restaurant transaction type: when the customer explicitly wants a TABLE/SEAT reservation, set entities.restaurantTransactionType="table_booking" and action=book. When the customer explicitly wants FOOD prepared/ordered, set entities.restaurantTransactionType="preorder" and action=order. If it is genuinely unclear which transaction they mean, set needsClarification=true instead of guessing.
- Promotion: for one concrete promotion, put the stated title/name in entities.promotionName. If context already supplies verified promotion identity, put entities.campaignId and/or entities.campaignCode; never invent either. Merely showing interest or selecting a promotion ("สนใจอันนี้", "เอาโปรนี้") is action=confirm with speechAct=selection and is NOT redemption. Use action=order + speechAct=transaction_request only when the CURRENT turn explicitly instructs Thongthai to redeem/use/claim the selected promotion now. Eligibility/status questions remain read-only.
taskDirective: OPTIONAL one of cancel_active | suspend_active | resume_suspended, only for the bounded conversational working task as described above
entities: an object of whatever concrete values the message actually states (e.g. {"partySize":2}, {"date":"พรุ่งนี้"}, {"time":"บ่ายสาม"}, {"horseName":"ภาราดร"}) -- never invent a value that wasn't stated
references: an array of {"type":string,"value"?:string,"refersToPriorContext":boolean} for anything in the message that points at something from context rather than being fully self-contained (a pronoun/deictic like "ตัวไหน", "อันนั้น", "อันเมื่อกี้", a bare correction, an implicit continuation). Omit entirely if the message is fully self-contained.
constraints: array of strings for any stated limitation/preference (e.g. "no_pork", "budget_700", "no_stairs")
confidence: 0 to 1, your genuine confidence in this classification
needsClarification: true only if the message is genuinely too ambiguous to act on even with the given context
clarificationReason: short string, only present if needsClarification is true

MANDATORY TERMINAL DECISION CHECKLIST — apply this after all doctrine above and immediately before emitting JSON:
1. DOMAIN OWNERSHIP: identify the explicit semantic business subject first. A missing record id or missing slot does not erase a known domain, and an explicit canonical category noun owns its category domain even inside a general location frame. For a multi-clause turn, choose the domain of the primary requested deliverable. A secondary coordinated request does not widen a specific primary domain to ecosystem; retain the primary domain and represent the secondary interest in intent/entities.
2. CURRENT SPEECH ACT: classify what the customer is doing in this turn, not what a later business layer may do next.
3. REPAIR VERSUS CHANGE: when the customer contrastively rejects an earlier value as wrong and supplies its replacement, the speech act is correct_previous, not modify. Use modify for an intentional new change that does not claim the earlier value was mistaken.
4. CATALOG EXISTENCE VERSUS LIVE STATE: when the customer asks whether an offering type, configuration, capacity class, or attribute exists in the catalog, and there is no date, time, current-state, sold-out, free-slot, or booking-state predicate, use discover + catalog. Use status + availability only when the customer asks whether an actual unit or slot is free or usable now or for a stated time.
5. BROAD BROWSE VERSUS JUDGMENT: neutral existence/listing is discover + catalog. When the unknown answer itself is qualified as desirable, worthwhile, appealing, or good, the customer is requesting evaluative selection: recommend + recommendation. In Thai and other languages, sentence-final evaluative wording modifies the requested choice rather than acting as mere politeness; a qualitative predicate attached directly to a broad action question still asks for judgment even without a separate verb meaning recommend. Companion or traveler metadata is only context; remove that metadata without removing any qualitative judgment expressed by the remaining request. EXCEPTION: when the CURRENT utterance explicitly compares two or more already-known candidates against a stated criterion, use compare rather than recommend.
6. TRANSACTION COMMITMENT: an explicit commitment to place an order or booking now remains order/book even when product, resource, quantity, date, or time is missing. An indefinite object or missing item name after an explicit order-placement commitment is a missing slot, not catalog intent. Merely selecting a prior option without submission language remains confirm.
7. CONSTRAINT PAYLOAD: a declarative turn that only supplies facts, standing preferences, or constraints is provide_information. Do not classify a clear constraint-only update as modify and do not request clarification merely because it changes or extends prior constraints.
8. FIELD COHERENCE: informationNeed must mirror the action already chosen and must never reverse it. recommend pairs with recommendation; true browse/list pairs with catalog; transaction commitment stays order/book and is never changed to discover merely because details are missing.

Return ONLY this JSON object, nothing else:
{"normalizedMeaning":string,"speechAct":string,"domain":string,"intent":string,"action":string,"informationNeed":string,"taskDirective"?:string,"entities":object,"references":array,"constraints":array,"confidence":number,"needsClarification":boolean,"clarificationReason"?:string}`;
}


export function buildProductionSemanticInterpreterPrompt(
  context: SemanticContext,
  message = '',
): string {
  const currentBangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const compactEntities = context.recentEntities.slice(0, 6).map(entity => ({
    id:entity.id, type:entity.type, name:entity.name, domain:entity.domain,
    canonical:entity.canonical === true,
  }));
  const compactTurns = (context.recentTurns ?? []).slice(-4).map(turn => ({
    role:turn.role, content:turn.content.slice(0, 240),
  }));
  const task = (value:SemanticTaskContext | null | undefined) => value ? {
    type:value.type,
    domain:value.domain,
    status:value.status,
    knownSlots:value.knownSlots,
    missingFields:value.missingFields.slice(0, 8),
    selectedEntities:value.selectedEntities.slice(0, 4).map(entity => ({ id:entity.id, name:entity.name })),
    constraints:value.constraints.slice(0, 8),
  } : null;
  const referencesPrior = /(?:เดิม|เมื่อกี้|ก่อนหน้า|อันนั้น|ตัวนั้น|เหมือนเดิม|กลับไป|ต่อเรื่อง|same|previous|that one)/iu.test(message);
  const compactContext = {
    activeDomain:context.activeDomain,
    activeTopic:context.activeTopic?.slice(0, 100),
    lastAction:context.lastAction,
    openQuestion:context.openQuestion?.slice(0, 120),
    recentEntities:compactEntities,
    recentTurns:compactTurns,
    activeTask:task(context.activeTask),
    suspendedTask:referencesPrior ? task(context.suspendedTask) : null,
    rollingSummary:referencesPrior ? context.rollingSummary?.slice(0, 360) : undefined,
    lastRecommendationReference:referencesPrior ? context.lastRecommendationReference?.slice(0, 320) : undefined,
  };
  const vocabulary = [
    /(?:อาหาร|เมนู|โต๊ะ|กิน|ร้าน)/u.test(message) || context.activeDomain === 'restaurant'
      ? 'restaurant=food/menu/table/dining' : null,
    /(?:พัก|ห้อง|บ้าน|เช็คอิน|เช็คเอาท์)/u.test(message) || context.activeDomain === 'stay'
      ? 'stay=rooms/houses/check-in/check-out' : null,
    /(?:ม้า|ขี่|ATV|ยิงธนู|กิจกรรม)/iu.test(message) || context.activeDomain === 'activity'
      ? 'activity=horse riding/ATV/archery' : null,
    /(?:กาแฟ|คาเฟ่|อินทนิล)/u.test(message) || context.activeDomain === 'cafe'
      ? 'cafe=Inthanin/cafe/drinks' : null,
    /(?:สินค้า|ของฝาก|OTOP)/iu.test(message) || context.activeDomain === 'otop'
      ? 'otop=local products/souvenirs' : null,
    /(?:สมาชิก|สิทธิ|แต้ม)/u.test(message) || context.activeDomain === 'membership'
      ? 'membership=membership/status/benefits' : null,
    /(?:โปร|ส่วนลด|โปรโมชั่น)/u.test(message) || context.activeDomain === 'promotion'
      ? 'promotion=offers/discounts' : null,
  ].filter(Boolean);

  return `You are Thongthai's semantic supervisor. Understand the CURRENT customer message and return compact JSON. Never answer the customer, invent business facts, decide availability/price/policy, call tools, or execute/mutate booking/order/payment.

Core rules:
- Understand natural/colloquial Thai, typos, ellipsis, corrections, topic shifts, and multi-intent sentences by meaning.
- Current message outranks stale context. Use context only to resolve real references or continuation.
- Selection is not transaction commitment. Questions/catalog/availability are read-only. Use book/order only for an explicit request to transact now; missing slots do not erase explicit commitment.
- Current no-transaction wording keeps the turn read-only. Conditional "if A unavailable use B; if neither, do nothing" = status/availability, never immediate confirm/book/order.
- Current corrections/replacements outrank stale selections and task values.
- lastRecommendationReference is bounded evidence of what Thongthai previously recommended. Use it to resolve descriptive follow-ups across topic switches; if it uniquely identifies a recent entity, follow that entity's domain rather than stale activeDomain.
- Asking what is selected/provided so far => intent=summarize_active_task, action=ask, informationNeed=none; never transaction_status.
- Conversation task directives cancel_active/suspend_active/resume_suspended affect working state only, never a real transaction.
- Catalog existence differs from live availability. recommendation differs from neutral discovery. correction differs from a new modification.
- For reservable hospitality resources (room/house/table/activity slot), a bare existence-at-use question such as whether one "is available/มีไหม" is availability, not stock inventory. Use inventory only for explicit on-hand stock/count questions.
- A constraint/preference-only declaration is speechAct=preference_update and action=provide_information, never modify. Emit only newly stated constraints as short canonical snake_case values such as no_pork/no_shrimp/no_spicy.
- Unknown or ambiguous references require clarification; never guess an entity or fact. Missing business data does NOT make the customer's meaning ambiguous.
- Open world: general=ordinary non-business conversation; local=surrounding area; incident=loss/damage/injury/adverse event; support=service help not owned by a narrower domain.
- A report of loss, damage, injury, or another adverse event remains speechAct=incident_report even when the same sentence asks staff to help.
- Any adverse-event report uses domain=incident even when its subject is an animal, property, a local place, or an organization service; narrower domains apply only when no incident is being reported.
- When the customer explicitly contrasts two or more known alternatives against a criterion, action=compare (informationNeed may be recommendation). Use action=recommend for open-ended suggestions without a fixed comparison set.
- Domain nouns identify subject; preserve the actual predicate, dates, times, party size, constraints, negation, and stated preferences.
- Preserve all meaningful clauses in compound turns; do not drop later constraints, corrections, or fallback questions.
- A customer merely reporting their own plan, pause, state, or situation is speechAct=statement. Use request/request_help only when they ask the assistant or organization to do something.
- If the customer explicitly retracts/corrects a previously inferred intent (for example clarifying that they were only asking and were NOT requesting a booking/order/confirmation), use speechAct=correction. This is a correction of conversational meaning even when no slot value changes; keep it read-only and never infer a transaction.
- A question about conditions, places, animals, routes, or surroundings in the area uses domain=local even when the exact place needs clarification; missing location detail does not change the domain to unknown.
- For a descriptive reference, use bounded context evidence: when prior context uniquely links the description to a named entity, emit that canonical entity name as the reference value so the deterministic resolver can bind it. If several entities fit, keep it unresolved and request clarification.
- IDs may only come from canonical context below. Otherwise leave unresolved.
- Activity TYPE (not one named asset) named: set entities.activityCode to horse|atv|archery. Not for a whole-domain browse or a named asset (use horseName).

Today in Bangkok: ${currentBangkok}
Relevant organization vocabulary: ${vocabulary.length ? vocabulary.join('; ') : 'none needed'}
Bounded context: ${JSON.stringify(compactContext)}

Closed domains: ecosystem, restaurant, stay, activity, promotion, membership, otop, cafe, journey, payment, support, general, local, incident, unknown.
Closed actions: ask, discover, recommend, compare, book, order, modify, cancel, confirm, status, provide_information, correct_previous, unknown.
Information needs: none, availability, price, schedule, inventory, catalog, recommendation, ingredients, policy, transaction_status.
Speech acts: question, statement, preference_update, correction, selection, request, transaction_request, incident_report, complaint, request_help, social, unknown.

Return ONLY:
{"normalizedMeaning":string,"speechAct":string,"domain":string,"intent":snake_case_string,"action":string,"informationNeed":string,"taskDirective"?:string,"entities":object,"references":[{"type":string,"value"?:string,"refersToPriorContext":boolean}],"constraints":string[],"confidence":number_0_to_1,"needsClarification":boolean,"clarificationReason"?:string}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canonicalizeEntityAliases(
  value: Record<string, unknown>,
  domain: SemanticDomain,
): Record<string, unknown> {
  const entities={...value};
  const aliases:Record<string,string>={
    party_size:'partySize',
    guest_count:'partySize',
    child_count:'children',
    children_count:'children',
    adult_count:'adults',
    adults_count:'adults',
    time_of_day:'timeOfDay',
    excluded_horse:'excludedHorse',
    excludedHorseName:'excludedHorse',
    preferred_horse_trait:'preferredHorseTrait',
    horseTemperament:'preferredHorseTrait',
    primaryHorseName:'primaryHorse',
    fallbackHorseName:'fallbackHorse',
    preferredHorseName:'preferredHorse',
    weather_condition:'weatherCondition',
    resource_type:'resourceType',
    promotion_category:'promotionCategory',
    selection_criterion:'selectionCriterion',
    previous_party_size:'previousPartySize',
    guestCount:'partySize',
    childCount:'children',
    adultCount:'adults',
    budget_thb:'budgetAmount',
    startDate:'date',
    checkInDate:'date',
    check_in:'date',
    checkOutDate:'endDate',
    check_out:'endDate',
    end_date:'endDate',
    bedroomCount:'bedrooms',
    bedroom_count:'bedrooms',
    accommodation_name:'accommodationName',
    stayName:'accommodationName',
    stay_name:'accommodationName',
    resource_code:'resourceCode',
    policy_topic:'policyTopic',
    selected_activity_asset:'horseName',
    selectedActivityAsset:'horseName',
  };
  for(const [from,to] of Object.entries(aliases)){
    if(entities[to]===undefined && entities[from]!==undefined) entities[to]=entities[from];
  }
  const budget=entities.budget;
  if(budget && typeof budget==='object' && !Array.isArray(budget)){
    const amount=Number((budget as Record<string,unknown>).amount);
    if(Number.isFinite(amount) && entities.budgetAmount===undefined) entities.budgetAmount=amount;
  }

  // Models sometimes group ordinary slot facts under a semantic envelope
  // (e.g. reservation:{date,time,partySize}). Downstream dialog/task logic
  // consumes one canonical flat slot contract. Copy ONLY a bounded set of
  // generic structural fields, never arbitrary nested business objects.
  const structuralContainers=['reservation','booking','party','group','request','stay'] as const;
  const structuralAliases:Record<string,string>={
    date:'date',
    time:'time',
    partySize:'partySize',
    party_size:'partySize',
    guestCount:'partySize',
    guest_count:'partySize',
    adults:'adults',
    adultCount:'adults',
    adult_count:'adults',
    children:'children',
    childCount:'children',
    child_count:'children',
    durationMinutes:'durationMinutes',
    duration_minutes:'durationMinutes',
    quantity:'quantity',
    nights:'nights',
    endDate:'endDate',
    end_date:'endDate',
    checkOut:'endDate',
    bedrooms:'bedrooms',
    resourceCode:'resourceCode',
    resourceName:'resourceName',
    accommodationName:'accommodationName',
    roomType:'roomType',
    policyTopic:'policyTopic',
  };
  for(const containerKey of structuralContainers){
    const nested=entities[containerKey];
    if(!nested || typeof nested!=='object' || Array.isArray(nested)) continue;
    for(const [from,to] of Object.entries(structuralAliases)){
      if(entities[to]!==undefined) continue;
      const nestedValue=(nested as Record<string,unknown>)[from];
      if(nestedValue!==undefined) entities[to]=nestedValue;
    }
  }

  // Models naturally name a selected horse as activity_asset, or sometimes
  // just the bare "horse" field a correction turn uses ("เปลี่ยนใจละ เอา
  // ทองไทยเหมือนเดิม" produced entities:{horse:"ทองไทย",replacedHorse:...}
  // live). Downstream working-state code (and the response composer's own
  // "แก้ตัวเลือกเป็น <name>" acknowledgement) uses the canonical horseName
  // slot -- without this, a live-observed correction fell back to a generic
  // "แก้ข้อมูลตามที่บอกแล้วครับ" that never names which horse was chosen.
  // Copy the value only in the activity domain and only when the asset is a
  // plain string; nested operational entity objects remain untouched.
  if (domain==='activity' && entities.horseName===undefined) {
    const bareHorseSource = ['activity_asset','horse','selectedHorse','selected_horse']
      .map(key => entities[key])
      .find((v): v is string => typeof v==='string' && v.trim().length>0);
    if (bareHorseSource) entities.horseName=bareHorseSource.trim();
  }

  // Human Core PR C: activityCode is the ONE closed, SOT-aligned code
  // (see _activity-sot.ts's activity_offerings.activity_code) a turn about
  // a specific activity TYPE -- not a specific named asset -- carries. The
  // production prompt (buildProductionSemanticInterpreterPrompt) now asks
  // the model to set entities.activityCode directly when it identifies one;
  // this also normalizes whatever spelling/casing/nesting the model or an
  // older prompt path used, the same way horseName is normalized above.
  // Never Thai keyword matching here -- this only reshapes a value the
  // model/deterministic layer ALREADY stated into one canonical key.
  if (domain==='activity' && entities.activityCode===undefined) {
    const bareActivityCodeSource = ['activity_code','activityType','activity_type']
      .map(key => entities[key])
      .find((v): v is string => typeof v==='string' && v.trim().length>0);
    if (bareActivityCodeSource) entities.activityCode=bareActivityCodeSource.trim().toLowerCase();
  } else if (typeof entities.activityCode==='string') {
    entities.activityCode=entities.activityCode.trim().toLowerCase();
  }

  // Stay fields are structural model output, not renderer keyword matches.
  // Normalize aliases/types once so scope, dialog state, and execution all
  // consume the same closed values.
  if (domain==='restaurant') {
    if (entities.itemName===undefined) {
      const itemNameSource=['menuItemName','menu_item_name','dishName','dish_name','foodName','food_name']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(itemNameSource) entities.itemName=itemNameSource.trim();
    }
    if (entities.menuItemId===undefined) {
      const menuIdSource=['menu_item_id','menuId','menu_id']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(menuIdSource) entities.menuItemId=menuIdSource.trim();
    }
    if (entities.restaurantTransactionType===undefined) {
      const transactionSource=['restaurant_transaction_type','transactionType','transaction_type','restaurantActionType']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(transactionSource) entities.restaurantTransactionType=transactionSource.trim();
    }
    if (entities.menuCategory===undefined) {
      const categorySource=['menu_category','categoryName','category_name']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(categorySource) entities.menuCategory=categorySource.trim();
    }
    for(const key of ['itemName','menuItemId','menuCategory','restaurantTransactionType','customerName','phone','email'] as const){
      if(typeof entities[key]==='string') entities[key]=entities[key].trim();
    }
    if(Array.isArray(entities.items)){
      const normalizedItems=entities.items.flatMap(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value)) return [];
        const row=value as Record<string,unknown>;
        const name=typeof row.name==='string'?row.name.trim():'';
        const quantity=Number(row.quantity);
        if(!name) return [];
        const validQuantity=Number.isInteger(quantity)&&quantity>=1&&quantity<=50;
        return [validQuantity?{name,quantity}:{name}];
      });
      entities.items=normalizedItems;
    }
  }

  if (domain==='promotion') {
    if (entities.promotionName===undefined) {
      const nameSource=['promotion_name','promoName','promo_name','title']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(nameSource) entities.promotionName=nameSource.trim();
    }
    if (entities.campaignId===undefined) {
      const idSource=['campaign_id','promotionId','promotion_id']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(idSource) entities.campaignId=idSource.trim();
    }
    if (entities.campaignCode===undefined) {
      const codeSource=['campaign_code','promotionCode','promotion_code','promoCode','promo_code']
        .map(key=>entities[key])
        .find((v):v is string=>typeof v==='string'&&v.trim().length>0);
      if(codeSource) entities.campaignCode=codeSource.trim();
    }
    for(const key of ['promotionName','campaignId','campaignCode','customerName','phone','email'] as const){
      if(typeof entities[key]==='string') entities[key]=entities[key].trim();
    }
  }

  if (domain==='stay') {
    const bedroomCount=Number(entities.bedrooms);
    if (Number.isInteger(bedroomCount) && bedroomCount>0 && bedroomCount<=20) entities.bedrooms=bedroomCount;
    else if (entities.bedrooms!==undefined) delete entities.bedrooms;
    const nights=Number(entities.nights);
    if (Number.isInteger(nights) && nights>0 && nights<=30) entities.nights=nights;
    else if (entities.nights!==undefined) delete entities.nights;
    for (const key of ['resourceCode','resourceName','accommodationName','roomType','policyTopic','endDate'] as const) {
      if (typeof entities[key]==='string') entities[key]=entities[key].trim();
    }
  }

  return entities;
}

function normalizeCrossDomainJourney(
  domain:SemanticDomain,
  action:SemanticAction,
  informationNeed:SemanticInformationNeed,
  entities:Record<string,unknown>,
  references:readonly SemanticReference[],
  context:SemanticContext,
):SemanticDomain {
  if(domain!=='ecosystem') return domain;
  const crossDomainKeys=['stay','activity','restaurant','otop','cafe']
    .filter(key=>entities[key]!==undefined);
  const activities = Array.isArray(entities.activities)
    ? entities.activities.filter(item=>item && typeof item==='object')
    : [];
  const itinerary = Array.isArray(entities.itinerary)
    ? entities.itinerary.filter(item=>item && typeof item==='object')
    : [];
  const structuredSteps = [...activities, ...itinerary];
  const scheduledDays = new Set(
    structuredSteps
      .map(item=>Number((item as Record<string,unknown>).day))
      .filter(day=>Number.isFinite(day) && day > 0)
  );
  const hasStayStructure = entities.stay !== undefined
    || entities.stayNights !== undefined
    || entities.stayDurationNights !== undefined
    || entities.tripDurationDays !== undefined;
  const hasActivityStructure = structuredSteps.length > 0
    || entities.activity !== undefined;
  const hasDiningStructure = entities.dining !== undefined
    || entities.restaurant !== undefined
    || entities.meal !== undefined;
  const hasShoppingStructure = entities.shopping !== undefined
    || entities.otop !== undefined
    || entities.souvenir !== undefined;
  const hasCafeStructure = entities.cafe !== undefined;
  const structuredDomainFacetCount = [
    hasStayStructure,
    hasActivityStructure,
    hasDiningStructure,
    hasShoppingStructure,
    hasCafeStructure,
  ].filter(Boolean).length;
  const hasStructuredMultiStepPlan =
    (structuredSteps.length >= 2 && (scheduledDays.size >= 2 || hasStayStructure))
    || structuredDomainFacetCount >= 2;
  const isMultiDomainPlan = (crossDomainKeys.length >= 2 || hasStructuredMultiStepPlan)
    && (action==='recommend' || action==='discover' || action==='ask')
    && (informationNeed==='recommendation' || informationNeed==='catalog' || informationNeed==='none');
  if(isMultiDomainPlan) return 'journey';

  const continuesJourney = context.activeDomain==='journey'
    && ['modify','ask','recommend','provide_information'].includes(action)
    && references.some(reference=>reference.refersToPriorContext && (
      reference.resolvedFromConversation
      || Boolean(reference.resolvedTaskSlot)
      || Boolean(reference.resolvedEntityId)
    ));
  return continuesJourney ? 'journey' : domain;
}

function normalizeReferences(value: unknown): SemanticReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      type: typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'unknown',
      value: typeof item.value === 'string' ? item.value : undefined,
      refersToPriorContext: item.refersToPriorContext === true,
    }))
    .slice(0, 10);
}

/**
 * Deterministic resolution step: for each reference the model flagged as
 * pointing at prior context, look it up against the REAL SemanticContext
 * entity list. This is a bounded data match, not a guess -- if nothing in
 * context plausibly matches, the reference stays unresolved rather than
 * being filled with a fabricated id.
 */
export function resolveReferences(references: SemanticReference[], context: SemanticContext): SemanticReference[] {
  return references.map(reference => {
    if (!reference.refersToPriorContext) return reference;

    const value = (reference.value ?? '').trim();

    // Task-slot references are resolved against the privacy-safe, canonical
    // task evidence supplied by the orchestrator. The model names ONLY the
    // slot key; it never supplies/guesses the prior value.
    if (reference.type === 'task_slot' && value && context.activeTask?.knownSlots
        && Object.prototype.hasOwnProperty.call(context.activeTask.knownSlots, value)) {
      return { ...reference, resolvedTaskSlot:value };
    }

    if (reference.type === 'selected_entity' && context.activeTask?.selectedEntities.length === 1) {
      return { ...reference, resolvedEntityId:context.activeTask.selectedEntities[0]!.id };
    }

    // A prior plan/topic/promotion is conversation evidence, not a catalog
    // entity -- it will never appear in recentEntities, so a journey/
    // promotion-domain reference with no tracked entities at all must still
    // reach the bounded-evidence fallback below rather than bailing out here.
    const hasBoundedConversationEvidence =
      (context.recentTurns?.length ?? 0) > 0 || Boolean(context.rollingSummary) || Boolean(context.lastRecommendationReference);
    if (!context.recentEntities.length) {
      return hasBoundedConversationEvidence ? { ...reference, resolvedFromConversation:true } : reference;
    }
    const byExactName = value
      ? context.recentEntities.filter(entity => entity.name === value || entity.name.includes(value) || value.includes(entity.name))
      : [];

    if (byExactName.length === 1) {
      return { ...reference, resolvedEntityId: byExactName[0]!.id };
    }
    if (byExactName.length > 1) {
      return { ...reference, ambiguous: true, resolvedEntityIds: byExactName.map(entity => entity.id) };
    }

    // Descriptive follow-ups may omit the name entirely ("the calmer one you
    // recommended"). The assistant's bounded recommendation evidence is real
    // conversation context. If it names exactly ONE recent canonical entity,
    // bind that identity instead of letting the current active topic erase it.
    const recommendationMatches = context.lastRecommendationReference
      ? context.recentEntities.filter(entity =>
          context.lastRecommendationReference!.includes(entity.name))
      : [];
    if (recommendationMatches.length === 1) {
      return {
        ...reference,
        resolvedEntityId:recommendationMatches[0]!.id,
        resolvedFromRecommendation:true,
      };
    }

    // No named match (e.g. "ตัวไหน" names nothing specific) -- if context has
    // exactly one recent entity in the active domain, that's the plausible
    // antecedent; if there are several, it's a genuine multi-way reference
    // (e.g. "ตัวไหนนิสัยดีกว่า" comparing several) rather than an error.
    const inDomain = context.activeDomain
      ? context.recentEntities.filter(entity => entity.domain === context.activeDomain)
      : context.recentEntities;
    if (inDomain.length === 1) return { ...reference, resolvedEntityId: inDomain[0]!.id };
    if (inDomain.length > 1) return {
      ...reference,
      resolvedEntityIds:inDomain.map(entity => entity.id),
    };

    // No named business entity matched even though context HAS tracked
    // entities (e.g. an activity-domain horse list exists but this
    // reference is really about a prior plan/topic, not an entity). Same
    // bounded-evidence trust as the empty-recentEntities branch above.
    if (hasBoundedConversationEvidence) {
      return { ...reference, resolvedFromConversation:true };
    }
    return reference;
  });
}

const READ_ONLY_ACTIONS_FOR_FACET_NORMALIZATION: ReadonlySet<SemanticAction> = new Set([
  'ask','discover','recommend','status','provide_information',
]);

function canonicalizeReadOnlyAction(
  action: SemanticAction,
  informationNeed: SemanticInformationNeed,
): SemanticAction {
  // Policy is intrinsically read-only. If the model labels a permission/capability
  // question as modify merely because it contains a change verb, preserve the
  // policy facet and normalize the action back to ask. An actual mutation should
  // not carry informationNeed=policy.
  if (informationNeed === 'policy' && action === 'modify') return 'ask';

  if (!READ_ONLY_ACTIONS_FOR_FACET_NORMALIZATION.has(action)) return action;

  if (informationNeed === 'availability' || informationNeed === 'transaction_status') return 'status';
  if (informationNeed === 'catalog') return 'discover';
  if (informationNeed === 'recommendation') return 'recommend';
  return action;
}

function parseSemanticJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = stripCodeFences(rawText).replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (firstError) {
    // responseMimeType=application/json is already requested from Gemini, but
    // models can still occasionally wrap one valid object in stray text or
    // emit a harmless trailing comma. Recover ONLY bounded JSON syntax here;
    // never infer semantic fields from free text.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const objectSlice = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(objectSlice) as Record<string, unknown>;
      } catch {
        const withoutTrailingCommas = objectSlice.replace(/,\s*([}\]])/g, '$1');
        if (withoutTrailingCommas !== objectSlice) {
          return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
        }
      }
    }
    throw firstError;
  }
}

export function parseSemanticTurnResponse(rawText: string, context: SemanticContext): SemanticTurn {
  const parsed = parseSemanticJsonObject(rawText);

  const normalizedMeaning = typeof parsed.normalizedMeaning === 'string'
    ? parsed.normalizedMeaning.trim().slice(0, 360)
    : '';
  let speechAct = VALID_SPEECH_ACTS.includes(parsed.speechAct as SemanticSpeechAct)
    ? parsed.speechAct as SemanticSpeechAct
    : 'unknown';
  let domain = VALID_DOMAINS.includes(parsed.domain as SemanticDomain) ? parsed.domain as SemanticDomain : 'unknown';
  const parsedAction = VALID_ACTIONS.includes(parsed.action as SemanticAction) ? parsed.action as SemanticAction : 'unknown';
  let taskDirective = VALID_TASK_DIRECTIVES.includes(parsed.taskDirective as SemanticTaskDirective)
    ? parsed.taskDirective as SemanticTaskDirective
    : undefined;
  const intent = typeof parsed.intent === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(parsed.intent) ? parsed.intent : 'unknown';
  let informationNeed:SemanticInformationNeed = VALID_INFORMATION_NEEDS.includes(parsed.informationNeed as SemanticInformationNeed)
    ? parsed.informationNeed as SemanticInformationNeed
    : 'none';
  let action = canonicalizeReadOnlyAction(parsedAction, informationNeed);
  // A recommendation action is itself a recommendation information request.
  // Keep this facet coherent even if the model leaves the optional facet as none.
  if (action === 'recommend' && informationNeed === 'none') informationNeed = 'recommendation';
  // Closed-field consistency: a true request must ask the system to act/answer.
  // `provide_information` with no requested facet or task directive represents
  // the customer reporting their own state/plan, not an instruction to execute.
  if (speechAct === 'request' && action === 'provide_information'
      && informationNeed === 'none'
      && (taskDirective === undefined || (!context.activeTask && !context.suspendedTask))) {
    speechAct = 'statement';
    // A self-directed pause/plan cannot suspend a nonexistent conversational
    // task. Discard a stray model directive when there is no task to control.
    if (!context.activeTask && !context.suspendedTask) taskDirective = undefined;
  }

  // Closed-field coherence repair: an explicit incident_report already says
  // WHAT KIND of real-world event this is. Missing place/resource detail may
  // still require clarification, but it must not erase incident ownership.
  // Repair only UNKNOWN here; do not override a concrete business domain.
  if (speechAct === 'incident_report' && domain === 'unknown') {
    domain = 'incident';
  }
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;

  let references = resolveReferences(normalizeReferences(parsed.references), context);
  const entities = canonicalizeEntityAliases(asRecord(parsed.entities), domain);
  domain = normalizeCrossDomainJourney(domain, action, informationNeed, entities, references, context);

  // A request to summarize the current working state is answered from the
  // canonical task container itself. It must never become ambiguous merely
  // because the model also emitted a stale/unresolved prior-context reference.
  const isActiveTaskSummary = intent === 'summarize_active_task';
  if (isActiveTaskSummary) {
    references = [];
  }

  const structuredEntityNames = new Set(
    Object.values(entities)
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean),
  );
  if (structuredEntityNames.size && context.recentEntities.length) {
    references = references.map(reference => {
      if (!reference.refersToPriorContext) return reference;

      // The model owns language meaning, so a selection turn may legitimately
      // invent a descriptive reference type ("the brown-and-white one") while
      // ALSO emitting the canonical structured entity it understood
      // (e.g. horseName="ภาราดร"). Reference type labels are free-form; they
      // must not become a hidden keyword gate. When the structured entity name
      // matches exactly ONE real recent entity, binding that canonical id is a
      // bounded context lookup, not language inference. For non-selection
      // turns keep the narrower historical reference-type guard unchanged.
      const selectionTurn = action === 'confirm' || speechAct === 'selection';
      const knownSingleEntityReference = [
        'entity_selection','previous_selection','selected_entity',
      ].includes(reference.type);
      if (!selectionTurn && !knownSingleEntityReference) return reference;

      const matches = context.recentEntities.filter(entity => structuredEntityNames.has(entity.name));
      if (matches.length !== 1) return reference;
      return {
        ...reference,
        resolvedEntityId:matches[0]!.id,
        resolvedEntityIds:undefined,
        ambiguous:undefined,
      };
    });
  }

  // Deterministically materialize only task-slot references that were
  // validated against the real active-task context. This is analogous to
  // entity-id resolution above: the model identifies WHAT is being referred
  // to; canonical state supplies the actual value.
  for (const reference of references) {
    const slot = reference.resolvedTaskSlot;
    if (!slot || entities[slot] !== undefined) continue;
    const value = context.activeTask?.knownSlots?.[slot];
    if (value !== undefined && value !== null) entities[slot] = value;
  }

  const hasUnresolvedReference = references.some(reference =>
    reference.refersToPriorContext
    && !reference.resolvedEntityId
    && !reference.resolvedEntityIds?.length
    && !reference.resolvedTaskSlot
    && !reference.resolvedFromConversation);
  const SINGLE_ENTITY_REFERENCE_TYPES = new Set([
    'entity_selection','previous_selection','selected_entity',
  ]);
  const selectionTurnRequiresOneEntity = action === 'confirm' || speechAct === 'selection';
  const requiresSingleEntity = (reference:SemanticReference):boolean =>
    SINGLE_ENTITY_REFERENCE_TYPES.has(reference.type)
    || (selectionTurnRequiresOneEntity && reference.refersToPriorContext);
  const hasAmbiguousReference = references.some(reference =>
    reference.ambiguous === true
    || (
      requiresSingleEntity(reference)
      && (reference.resolvedEntityIds?.length ?? 0) > 1
    ));

  // Structure-only semantic validation. The model owns language meaning; these
  // rules only reconcile its closed fields/references against canonical context.
  // Reference "type" itself is free-form model output; on a selection turn,
  // ANY prior-context reference must resolve to one identity before it can
  // remain a confirm action.
  const multiCandidateIdentityReference = references.some(reference =>
    requiresSingleEntity(reference)
    && (reference.resolvedEntityIds?.length ?? 0) > 1);
  if (
    multiCandidateIdentityReference
    && (
      (action === 'discover' && informationNeed === 'catalog')
      || action === 'confirm'
    )
  ) {
    // With >1 canonical candidate, "which one?" cannot be an executable
    // selection. Preserve the candidate set and treat it as a question.
    action = 'ask';
  }

  const explicitSelectionReference = references.some(reference =>
    (reference.type === 'previous_selection' || reference.type === 'entity_selection')
    && Boolean(reference.resolvedEntityId));
  if (action === 'provide_information' && explicitSelectionReference) {
    action = 'confirm';
  }

  if (taskDirective === 'resume_suspended' && action === 'confirm') {
    action = 'ask';
  }

  const ambiguousReferenceRequiresClarification =
    hasAmbiguousReference
    && !(['ask','discover','recommend','compare'] as SemanticAction[]).includes(parsedAction);

  const recommendationResolvedEntity = references
    .find(reference => reference.resolvedFromRecommendation && reference.resolvedEntityId);
  if (
    recommendationResolvedEntity?.resolvedEntityId
    && (domain === 'ecosystem' || domain === 'general' || domain === 'unknown')
  ) {
    const canonical = context.recentEntities.find(entity =>
      entity.id === recommendationResolvedEntity.resolvedEntityId);
    if (canonical && canonical.domain !== 'unknown') domain = canonical.domain;
  }

  const allPriorReferencesResolved = references.length > 0
    && references.filter(reference => reference.refersToPriorContext).length > 0
    && references.filter(reference => reference.refersToPriorContext).every(reference =>
      Boolean(reference.resolvedEntityId)
      || Boolean(reference.resolvedEntityIds?.length)
      || Boolean(reference.resolvedTaskSlot)
      || reference.resolvedFromConversation === true);
  const resolvedSelectionClarification =
    allPriorReferencesResolved
    && references.some(reference => reference.resolvedFromRecommendation)
    && (
      speechAct === 'selection'
      || action === 'confirm'
      || action === 'provide_information'
      || action === 'modify'
      || action === 'correct_previous'
    );

  const taskForCurrentDomain = [context.activeTask, context.suspendedTask]
    .find(task => task?.domain === domain) ?? null;
  const taskBacksEllipticPriceQuestion =
    informationNeed === 'price'
    && Boolean(taskForCurrentDomain)
    && (
      (taskForCurrentDomain?.selectedEntities.length ?? 0) > 0
      || typeof taskForCurrentDomain?.knownSlots.resourceCode === 'string'
    )
    && !hasUnresolvedReference
    && !hasAmbiguousReference;

  const resolvedConversationContinuation =
    references.some(reference => reference.refersToPriorContext && reference.resolvedFromConversation === true)
    && references.filter(reference => reference.refersToPriorContext).every(reference =>
      Boolean(reference.resolvedEntityId)
      || Boolean(reference.resolvedEntityIds?.length)
      || Boolean(reference.resolvedTaskSlot)
      || reference.resolvedFromConversation === true
    )
    && Boolean(context.activeDomain)
    && context.activeDomain !== 'unknown'
    && ['ask','modify','recommend','provide_information','correct_previous'].includes(action)
    && confidence >= 0.7;

  // A generic "same plan / previous request" reference is backed by bounded
  // conversation evidence, not a canonical entity id. When that reference is
  // fully resolved, inherit only the prior DOMAIN if the model emitted a
  // noncommittal general/unknown domain. Current action/entities still come
  // from the language model, so old context cannot invent a transaction.
  if (
    resolvedConversationContinuation
    && (domain === 'general' || domain === 'unknown')
    && context.activeDomain
  ) {
    domain = context.activeDomain;
  }

  const noUsableContext = !context.activeDomain
    && context.recentEntities.length === 0
    && !context.activeTask
    && !context.suspendedTask;
  const validatedDomain: SemanticDomain =
    speechAct === 'incident_report' && domain === 'incident'
      ? 'incident'
      // A local-area question remains semantically LOCAL even when the exact
      // map/place referent ("around there", "nearby") is unresolved. Missing
      // location detail is a clarification problem, not a domain-erasure
      // problem. This mirrors the incident rule above without guessing any
      // location or business fact.
      : domain === 'local'
        ? 'local'
        : (hasUnresolvedReference && noUsableContext ? 'unknown' : domain);

  return {
    normalizedMeaning: normalizedMeaning || undefined,
    speechAct,
    domain:validatedDomain,
    intent,
    action,
    informationNeed,
    entities,
    references,
    constraints: asStringArray(parsed.constraints),
    confidence,
    // An unresolved prior-context reference (the model thinks this points at
    // something, but nothing in the real context matches) forces clarification
    // even if the model itself didn't flag needsClarification -- this is the
    // deterministic-validation layer catching a case the model may miss.
    needsClarification: (isActiveTaskSummary || resolvedSelectionClarification || taskBacksEllipticPriceQuestion || resolvedConversationContinuation)
      ? false
      : (parsed.needsClarification === true || hasUnresolvedReference || ambiguousReferenceRequiresClarification),
    clarificationReason: (isActiveTaskSummary || resolvedSelectionClarification || taskBacksEllipticPriceQuestion || resolvedConversationContinuation)
      ? undefined
      : (typeof parsed.clarificationReason === 'string' && parsed.clarificationReason.trim()
        ? parsed.clarificationReason.trim()
        : (ambiguousReferenceRequiresClarification ? 'ambiguous_reference'
          : (hasUnresolvedReference ? 'unresolved_reference' : undefined))),
    taskDirective,
  };
}

/**
 * The real, network-calling entry point. Uses the same provider stack
 * (Gemini -> OpenAI fallback) as the rest of the Brain -- see
 * _thongthai-brain-v3.ts's callPreferredModel -- so provider availability
 * behavior is identical, not a second independent integration.
 *
 * Not covered by npm test (no live model access in this environment, and this
 * repo's test convention keeps npm test free of network calls -- see
 * interpretStayBookingTurn for the same established pattern). The prompt
 * builder and response parser/validator above are the parts unit-tested;
 * live classification conformance against tests/fixtures/semantic-eval-corpus.ts
 * is verified by a live acceptance pass, the same way every previous phase's
 * conversational behavior in this program was verified against production.
 */
export function semanticTurnNeedsReview(
  turn: SemanticTurn,
  message: string,
  context: SemanticContext,
): boolean {
  const meaningfulText = message.trim().length >= 4;
  const unresolvedReference = turn.references.some(reference =>
    reference.refersToPriorContext
    && !reference.resolvedEntityId
    && !reference.resolvedEntityIds?.length
    && !reference.resolvedTaskSlot
    && !reference.resolvedFromConversation
  );
  const contextCouldResolve = Boolean(
    context.recentEntities.length
    || context.activeTask
    || context.suspendedTask
    || context.activeDomain
  );

  return turn.confidence < 0.72
    || turn.action === 'unknown'
    || (turn.domain === 'unknown' && meaningfulText)
    || (unresolvedReference && contextCouldResolve);
}

/**
 * OpenAI-only semantic supervisor.
 *
 * Terra reads every ordinary language turn. Sol is a bounded second opinion
 * only when the primary result is structurally weak/uncertain. Neither model
 * is allowed to answer the customer or execute a business action here.
 */
export type SemanticInterpretOptions = {
  callContext?: AiCallContext;
  certificationMode?: boolean;
};

export async function interpretSemanticTurn(
  message: string,
  context: SemanticContext = emptySemanticContext(),
  options: SemanticInterpretOptions = {},
): Promise<SemanticTurn> {
  const prompt = buildProductionSemanticInterpreterPrompt(context, message);
  const messages:ChatTurn[] = [{ role:'user', content:message }];
  const primaryRaw = await callSemanticSupervisor(
    prompt,
    messages,
    options.certificationMode ? 'semantic-certification-primary' : 'semantic-interpreter',
    options.callContext,
  );
  const primary = parseSemanticTurnResponse(primaryRaw, context);
  if (!options.certificationMode || !semanticTurnNeedsReview(primary, message, context)) return primary;

  const reviewPrompt = `${prompt}

SEMANTIC REVIEW MODE:
A cheaper first-pass supervisor already attempted this turn. Re-read the ORIGINAL customer message and context independently.
Use the candidate only as an error signal, not as truth. Fix missed open-world meaning, references, speech act, or constraints.
Do not become more eager to transact. Return the same JSON schema only.`;
  try {
    const reviewedRaw = await callSemanticReviewer(
      reviewPrompt,
      [
        { role:'user', content:message },
        { role:'assistant', content:primaryRaw },
        { role:'user', content:'Review the original message and return the corrected semantic JSON only.' },
      ],
      'semantic-certification-reviewer',
      undefined,
    );
    const reviewed = parseSemanticTurnResponse(reviewedRaw, context);

    // Review is allowed to replace the first pass only when it is actually
    // usable. Never replace a valid primary interpretation with a weaker
    // unknown/low-confidence candidate merely because the expensive model ran.
    if (
      reviewed.confidence >= 0.72
      && reviewed.action !== 'unknown'
      && (
        reviewed.domain !== 'unknown'
        || reviewed.needsClarification
        || primary.domain === 'unknown'
      )
    ) {
      return reviewed;
    }
  } catch (error) {
    console.error(
      'THONGTHAI_SEMANTIC_REVIEW_ERROR',
      error instanceof Error ? error.message.slice(0, 220) : 'unknown',
    );
  }
  return primary;
}
