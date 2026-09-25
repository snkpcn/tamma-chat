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

export const SEMANTIC_INTERPRETER_VERSION = 'semantic-v1';

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
  liveModelSemanticConformance: 'not_yet_executed',
} as const;

export type SemanticDomain =
  | 'ecosystem' | 'restaurant' | 'stay' | 'activity' | 'promotion' | 'membership'
  | 'otop' | 'cafe' | 'journey' | 'payment' | 'support' | 'unknown';

export type SemanticAction =
  | 'ask' | 'discover' | 'recommend' | 'compare' | 'book' | 'order' | 'modify'
  | 'cancel' | 'confirm' | 'status' | 'provide_information'
  | 'correct_previous' | 'unknown';

const VALID_DOMAINS: SemanticDomain[] = [
  'ecosystem', 'restaurant', 'stay', 'activity', 'promotion', 'membership',
  'otop', 'cafe', 'journey', 'payment', 'support', 'unknown',
];
const VALID_ACTIONS: SemanticAction[] = [
  'ask', 'discover', 'recommend', 'compare', 'book', 'order', 'modify',
  'cancel', 'confirm', 'status', 'provide_information',
  'correct_previous', 'unknown',
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
  intent: string;
  action: SemanticAction;
  entities: Record<string, unknown>;
  references: SemanticReference[];
  constraints: string[];
  confidence: number;
  needsClarification: boolean;
  clarificationReason?: string;
};

/** Safe, non-sensitive metadata for observability (Phase J will wire this into a
 *  real trace object). Never includes model reasoning/chain-of-thought -- only
 *  the validated, structured result. */
export type SemanticInterpretationMeta = {
  semanticVersion: string;
  domain: SemanticDomain;
  intent: string;
  action: SemanticAction;
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

function describeContext(context: SemanticContext): string {
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

CONVERSATION CONTEXT: ${describeContext(context)}
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

domain: one of ecosystem | restaurant | stay | activity | promotion | membership | otop | cafe | journey | payment | support | unknown
intent: a short snake_case label naming the specific thing being asked (e.g. "broad_experience_discovery", "menu_recommendation_request", "select_prior_entity", "booking_time_confirmation")
action: one of ask | discover | recommend | compare | book | order | modify | cancel | confirm | status | provide_information | correct_previous | unknown
entities: an object of whatever concrete values the message actually states (e.g. {"partySize":2}, {"date":"พรุ่งนี้"}, {"time":"บ่ายสาม"}, {"horseName":"ภาราดร"}) -- never invent a value that wasn't stated
references: an array of {"type":string,"value"?:string,"refersToPriorContext":boolean} for anything in the message that points at something from context rather than being fully self-contained (a pronoun/deictic like "ตัวไหน", "อันนั้น", "อันเมื่อกี้", a bare correction, an implicit continuation). Omit entirely if the message is fully self-contained.
constraints: array of strings for any stated limitation/preference (e.g. "no_pork", "budget_700", "no_stairs")
confidence: 0 to 1, your genuine confidence in this classification
needsClarification: true only if the message is genuinely too ambiguous to act on even with the given context
clarificationReason: short string, only present if needsClarification is true

Return ONLY this JSON object, nothing else:
{"domain":string,"intent":string,"action":string,"entities":object,"references":array,"constraints":array,"confidence":number,"needsClarification":boolean,"clarificationReason"?:string}`;
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
    if (inDomain.length > 1) return { ...reference, resolvedEntityIds: inDomain.map(entity => entity.id) };
    return reference;
  });
}

export function parseSemanticTurnResponse(rawText: string, context: SemanticContext): SemanticTurn {
  const parsed = JSON.parse(stripCodeFences(rawText)) as Record<string, unknown>;

  const domain = VALID_DOMAINS.includes(parsed.domain as SemanticDomain) ? parsed.domain as SemanticDomain : 'unknown';
  const action = VALID_ACTIONS.includes(parsed.action as SemanticAction) ? parsed.action as SemanticAction : 'unknown';
  const intent = typeof parsed.intent === 'string' && /^[a-z][a-z0-9_]{1,79}$/.test(parsed.intent) ? parsed.intent : 'unknown';
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;

  const references = resolveReferences(normalizeReferences(parsed.references), context);
  const entities = asRecord(parsed.entities);

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

  return {
    domain,
    intent,
    action,
    entities,
    references,
    constraints: asStringArray(parsed.constraints),
    confidence,
    // An unresolved prior-context reference (the model thinks this points at
    // something, but nothing in the real context matches) forces clarification
    // even if the model itself didn't flag needsClarification -- this is the
    // deterministic-validation layer catching a case the model may miss.
    needsClarification: parsed.needsClarification === true || hasUnresolvedReference,
    clarificationReason: typeof parsed.clarificationReason === 'string' && parsed.clarificationReason.trim()
      ? parsed.clarificationReason.trim()
      : (hasUnresolvedReference ? 'unresolved_reference' : undefined),
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
