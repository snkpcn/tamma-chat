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
  | 'transaction_status';

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
  /** Runtime provenance; never customer-facing and never business truth. */
  semanticSource?: 'openai_supervisor' | 'deterministic_fallback' | 'provider_unavailable';
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
  const resolved = turn.references.filter(reference => Boolean(reference.resolvedEntityId) || Boolean(reference.resolvedEntityIds?.length)).length;
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

export function buildSemanticInterpreterPrompt(
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
- Conversation task directives cancel_active/suspend_active/resume_suspended affect working state only, never a real transaction.
- Catalog existence differs from live availability. recommendation differs from neutral discovery. correction differs from a new modification.
- Unknown or ambiguous references require clarification; never guess an entity or fact.
- Open world: general=ordinary non-business conversation; local=surrounding area; incident=loss/damage/injury/adverse event; support=service help not owned by a narrower domain.
- Domain nouns identify subject; preserve the actual predicate, dates, times, party size, constraints, negation, and stated preferences.
- IDs may only come from canonical context below. Otherwise leave unresolved.

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
  const speechAct = VALID_SPEECH_ACTS.includes(parsed.speechAct as SemanticSpeechAct)
    ? parsed.speechAct as SemanticSpeechAct
    : 'unknown';
  const domain = VALID_DOMAINS.includes(parsed.domain as SemanticDomain) ? parsed.domain as SemanticDomain : 'unknown';
  const parsedAction = VALID_ACTIONS.includes(parsed.action as SemanticAction) ? parsed.action as SemanticAction : 'unknown';
  const taskDirective = VALID_TASK_DIRECTIVES.includes(parsed.taskDirective as SemanticTaskDirective)
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
  );
  const contextCouldResolve = Boolean(
    context.recentEntities.length
    || context.activeTask
    || context.suspendedTask
    || context.activeDomain
  );

  return turn.confidence < 0.72
    || turn.action === 'unknown'
    || (turn.domain === 'unknown' && meaningfulText && !turn.needsClarification)
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
  const prompt = buildSemanticInterpreterPrompt(context, message);
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
