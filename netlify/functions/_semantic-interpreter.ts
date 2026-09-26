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
import { callPreferredModel as callPreferredModelFromProvider, stripCodeFences, type ChatTurn } from './_thongthai-model-provider';
// Ecosystem vocabulary/relationships come from the ONE canonical Bible source
// (Phase A), not a second hand-typed paraphrase -- _thongthai-bible-generated.ts
// is a plain generated data module with zero imports of its own, so importing
// it here creates no dependency risk in either direction.
import { THONGTHAI_BIBLE_SECTIONS } from './_thongthai-bible-generated';

function callPreferredModel(systemPrompt: string, messages: ChatTurn[]): Promise<string> {
  return callPreferredModelFromProvider(systemPrompt, messages, 'semantic-interpreter');
}

export const SEMANTIC_INTERPRETER_VERSION = 'semantic-v11';

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
  | 'otop' | 'cafe' | 'journey' | 'payment' | 'support' | 'unknown';

export type SemanticAction =
  | 'ask' | 'discover' | 'recommend' | 'compare' | 'book' | 'order' | 'modify'
  | 'cancel' | 'confirm' | 'status' | 'provide_information'
  | 'correct_previous' | 'unknown';

export type SemanticTaskDirective =
  | 'cancel_active'
  | 'suspend_active'
  | 'resume_suspended';

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
  | 'transaction_status';

const VALID_DOMAINS: SemanticDomain[] = [
  'ecosystem', 'restaurant', 'stay', 'activity', 'promotion', 'membership',
  'otop', 'cafe', 'journey', 'payment', 'support', 'unknown',
];
const VALID_ACTIONS: SemanticAction[] = [
  'ask', 'discover', 'recommend', 'compare', 'book', 'order', 'modify',
  'cancel', 'confirm', 'status', 'provide_information',
  'correct_previous', 'unknown',
];
const VALID_TASK_DIRECTIVES: SemanticTaskDirective[] = [
  'cancel_active', 'suspend_active', 'resume_suspended',
];
const VALID_INFORMATION_NEEDS: SemanticInformationNeed[] = [
  'none', 'availability', 'price', 'schedule', 'inventory', 'catalog',
  'recommendation', 'ingredients', 'policy', 'transaction_status',
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
  ambiguous?: boolean;
};

export type SemanticTurn = {
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
  const resolved = turn.references.filter(reference => Boolean(reference.resolvedEntityId) || Boolean(reference.resolvedEntityIds?.length)).length;
  return {
    semanticVersion: SEMANTIC_INTERPRETER_VERSION,
    domain: turn.domain,
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

DOMAIN-SCOPE TAXONOMY:
- ecosystem = generic whole-property discovery/recommendation when the customer asks broadly what there is to do, play, visit, or
  experience and does NOT ask to compose a trip/plan/sequence and does not name a narrower primary business subject.
- Generic verbs such as do/play/visit are NOT enough by themselves to narrow the domain to activity. They can describe the whole
  TAMMA ecosystem. Use activity only when a specific activity/activity entity is stated (horse, ATV, archery, etc.) or the relevant
  conversation context unambiguously establishes activity.
- promotion is cross-cutting. When the PRIMARY subject is a promotion/discount/offer, keep domain "promotion" even when the promotion
  is for restaurant, activity, stay, cafe, OTOP, or multiple business units. Put the named business unit in entities; do not replace
  the primary promotion domain with that sub-business domain.
- journey = itinerary/plan/trip composition: the customer asks Thongthai to arrange, continue, restore, or structure a trip/plan, or
  to sequence multiple experiences/businesses over time. Use ecosystem for broad browse/discovery/recommendation without plan
  composition; use journey when composition/sequence itself is the customer goal.
- Never hallucinate a business domain for an elliptical question such as a bare date + "available?". If neither the message nor
  relevant context identifies what should be available, use unknown and needsClarification=true.

ACTION TAXONOMY (apply by meaning, not keywords):
- discover = the customer asks what options/catalog/items/categories EXIST or are available to browse. Asking what menu/items/options
  are there is discover, even inside restaurant/cafe/OTOP. discovery does not mean the assistant should choose one for them.
- recommend = the customer asks the assistant to HELP CHOOSE, suggest, personalize, or say what is suitable/better for them.
- status = the customer asks the CURRENT STATE of something: whether a table/room/activity/resource is available, free, full, open,
  still available, or the current status of an existing transaction. Pair resource availability with informationNeed=availability;
  pair an existing booking/order/payment status with informationNeed=transaction_status.
- ask = an informational/factual question that is not better represented by status, compare, recommend, or discover.
- Selecting a previously presented option while supplying extra scheduling or quantity slots remains confirm. Added date, time, party size, quantity, or similar slot values refine the selected option; this does not become book/order unless the CURRENT utterance explicitly commits to submit the transaction now.
- When the CURRENT utterance explicitly names a canonical business category such as activities, stay, restaurant, cafe, OTOP, promotion, or membership as the catalog being requested, that category owns the domain rather than ecosystem. Ecosystem is for broad cross-business discovery when no specific business category is itself the requested catalog.
- Permission meaning outranks mutation wording: asking whether a change is allowed is ask + policy even when phrased with a polite change verb. A real modify action requires the customer to instruct that the value/choice actually be changed now.
- A support request like "help me investigate/check this problem" is ask unless the CURRENT utterance actually asks what state an existing transaction is in. Do not manufacture transaction_status merely because an order/payment is mentioned.
- For preference adjustments, dissatisfaction plus a requested new preference is modify, not correct_previous. Reserve correct_previous for explicit claims that the earlier value/statement itself was mistaken or wrong.
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
  "how do these differ?") stay compare even if the answer may help the customer choose. recommend is for asking the assistant to choose/suggest
  what suits the customer, not for a direct comparison between known options.
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

domain: one of ecosystem | restaurant | stay | activity | promotion | membership | otop | cafe | journey | payment | support | unknown
intent: a short snake_case label naming the specific thing being asked (e.g. "broad_experience_discovery", "menu_recommendation_request", "select_prior_entity", "booking_time_confirmation")
action: one of ask | discover | recommend | compare | book | order | modify | cancel | confirm | status | provide_information | correct_previous | unknown
informationNeed: one of none | availability | price | schedule | inventory | catalog | recommendation | ingredients | policy | transaction_status
- informationNeed is a CLOSED machine-facing meaning facet, independent of the free-form intent label.
- Use availability when the customer asks whether a table/room/activity/time/resource is free, full, open, or available.
- Use inventory for current physical-product stock/quantity existence (for example an OTOP product or packaged retail item). Do not
  collapse physical stock into generic availability.
- Use catalog when asking whether a menu/item/type/category/configuration exists in the offering, without asking current live
  stock/time state. A room/house TYPE or bedroom configuration with no date/current-state predicate is catalog, not availability.
- Use transaction_status only when asking the status of an already-existing booking/order/payment/member transaction.
- Use none when the turn is conversational or the question is not an information lookup.
taskDirective: OPTIONAL one of cancel_active | suspend_active | resume_suspended, only for the bounded conversational working task as described above
entities: an object of whatever concrete values the message actually states (e.g. {"partySize":2}, {"date":"พรุ่งนี้"}, {"time":"บ่ายสาม"}, {"horseName":"ภาราดร"}) -- never invent a value that wasn't stated
references: an array of {"type":string,"value"?:string,"refersToPriorContext":boolean} for anything in the message that points at something from context rather than being fully self-contained (a pronoun/deictic like "ตัวไหน", "อันนั้น", "อันเมื่อกี้", a bare correction, an implicit continuation). Omit entirely if the message is fully self-contained.
constraints: array of strings for any stated limitation/preference (e.g. "no_pork", "budget_700", "no_stairs")
confidence: 0 to 1, your genuine confidence in this classification
needsClarification: true only if the message is genuinely too ambiguous to act on even with the given context
clarificationReason: short string, only present if needsClarification is true

Return ONLY this JSON object, nothing else:
{"domain":string,"intent":string,"action":string,"informationNeed":string,"taskDirective"?:string,"entities":object,"references":array,"constraints":array,"confidence":number,"needsClarification":boolean,"clarificationReason"?:string}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

    if (!context.recentEntities.length) return reference;
    const byExactName = value
      ? context.recentEntities.filter(entity => entity.name === value || entity.name.includes(value) || value.includes(entity.name))
      : [];

    if (byExactName.length === 1) {
      return { ...reference, resolvedEntityId: byExactName[0]!.id };
    }
    if (byExactName.length > 1) {
      return { ...reference, ambiguous: true, resolvedEntityIds: byExactName.map(entity => entity.id) };
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

  const domain = VALID_DOMAINS.includes(parsed.domain as SemanticDomain) ? parsed.domain as SemanticDomain : 'unknown';
  const parsedAction = VALID_ACTIONS.includes(parsed.action as SemanticAction) ? parsed.action as SemanticAction : 'unknown';
  const taskDirective = VALID_TASK_DIRECTIVES.includes(parsed.taskDirective as SemanticTaskDirective)
    ? parsed.taskDirective as SemanticTaskDirective
    : undefined;
  const intent = typeof parsed.intent === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(parsed.intent) ? parsed.intent : 'unknown';
  const informationNeed = VALID_INFORMATION_NEEDS.includes(parsed.informationNeed as SemanticInformationNeed)
    ? parsed.informationNeed as SemanticInformationNeed
    : 'none';
  let action = canonicalizeReadOnlyAction(parsedAction, informationNeed);
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;

  let references = resolveReferences(normalizeReferences(parsed.references), context);
  const entities = asRecord(parsed.entities);

  const structuredEntityNames = new Set(
    Object.values(entities)
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean),
  );
  if (structuredEntityNames.size && context.recentEntities.length) {
    references = references.map(reference => {
      if (
        !reference.refersToPriorContext
        || !['entity_selection','previous_selection','selected_entity'].includes(reference.type)
      ) return reference;
      const matches = context.recentEntities.filter(entity => structuredEntityNames.has(entity.name));
      if (matches.length !== 1) return reference;
      return {
        ...reference,
        resolvedEntityId:matches[0]!.id,
        resolvedEntityIds:undefined,
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
    && !reference.resolvedTaskSlot);
  const SINGLE_ENTITY_REFERENCE_TYPES = new Set([
    'entity_selection','previous_selection','selected_entity',
  ]);
  const hasAmbiguousReference = references.some(reference =>
    reference.ambiguous === true
    || (
      SINGLE_ENTITY_REFERENCE_TYPES.has(reference.type)
      && (reference.resolvedEntityIds?.length ?? 0) > 1
    ));

  // Structure-only semantic validation. The model owns language meaning; these
  // rules only reconcile its closed fields/references against canonical context.
  const multiCandidateIdentityReference = references.some(reference =>
    SINGLE_ENTITY_REFERENCE_TYPES.has(reference.type)
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

  const noUsableContext = !context.activeDomain
    && context.recentEntities.length === 0
    && !context.activeTask
    && !context.suspendedTask;
  const validatedDomain: SemanticDomain = hasUnresolvedReference && noUsableContext ? 'unknown' : domain;

  return {
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
    needsClarification: parsed.needsClarification === true || hasUnresolvedReference || ambiguousReferenceRequiresClarification,
    clarificationReason: typeof parsed.clarificationReason === 'string' && parsed.clarificationReason.trim()
      ? parsed.clarificationReason.trim()
      : (ambiguousReferenceRequiresClarification ? 'ambiguous_reference'
        : (hasUnresolvedReference ? 'unresolved_reference' : undefined)),
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
export async function interpretSemanticTurn(
  message: string,
  context: SemanticContext = emptySemanticContext(),
): Promise<SemanticTurn> {
  const prompt = buildSemanticInterpreterPrompt(context);
  const raw = await callPreferredModel(prompt, [{ role: 'user', content: message } as ChatTurn]);
  return parseSemanticTurnResponse(raw, context);
}
