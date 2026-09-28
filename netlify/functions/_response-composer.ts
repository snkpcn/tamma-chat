// Phase I — the ONE customer-facing Response Composer.
//
// Inputs are already-decided, already-grounded machine state. This module does
// not interpret intent, query business data, mutate task state, or execute a
// transaction. It only turns DialogDecision + KnowledgeBundle +
// DegradationPlan + optional VERIFIED operational outcome into natural copy.
//
// Normal turns use the shared provider stack for natural language. Degraded
// turns have centralized deterministic copy so channel handlers never grow
// their own fallback sentences.
import type { BrainChannel } from './_thongthai-brain-v3';
import type { SemanticTurn } from './_semantic-interpreter';
import type { DialogDecision } from './_dialog-manager';
import type { KnowledgeBundle, GroundedFact } from './_knowledge-resolver';
import {
  planModelDegradation,
  type DegradationPlan,
} from './_graceful-degradation';
import { stripCodeFences, callResponseComposer } from './_thongthai-model-provider';
import type { AiCallContext } from './_ai-cost-ledger';
import type { ConversationContextState } from './_conversation-context';
import { THONGTHAI_BIBLE_SECTIONS, THONGTHAI_BIBLE_VERSION } from './_thongthai-bible-generated';
import { polishCustomerMessage } from './_chat-copy-style';
import { THONGTHAI_HUMAN_SERVICE_VOICE } from './_thongthai-service-voice';
import { resolveActivityDurationOptions, type ActivityDurationPolicyResult } from './_activity-catalog-policy';
import { extractTime } from './_slot-parsers';
import {
  renderActivityAvailability,
  renderActivityCareResponse,
  renderActivityRecommendation,
  renderCafeUnavailableSourceResponse,
  renderStayResponse,
  renderRestaurantRecommendation,
  renderPromotionRecommendation,
  renderJourneyPlan,
} from './_human-grounded-response';

export const RESPONSE_COMPOSER_VERSION = 'response-composer-v1';
const MAX_FACTS_IN_PROMPT = 100;
const PRICE_QUESTION_RE = /ราคา|เท่าไร|เท่าไหร่|กี่บาท/iu;
const HOW_IT_WORKS_RE = /(?:ยังไง|อย่างไร|ไง|วิธี|ทำยังไง|เล่นยังไง|ขี่.*ไง)/iu;

export type ResponseLanguage = 'th' | 'en' | 'zh' | 'lo' | 'vi';

export type VerifiedOperationalOutcome = {
  executed: boolean;
  success: boolean;
  status?: string | null;
  referenceCode?: string | null;
  duplicate?: boolean;
};

export type ResponseComposerInput = {
  channel: BrainChannel;
  language: ResponseLanguage;
  userMessage?: string;
  /** Already-decided machine meaning. Rendering may consume this structured
   *  object, but must never reinterpret raw customer language. */
  semanticTurn?: SemanticTurn;
  /** Bounded/redacted canonical conversation working memory. Used only for
   * state readback (for example a considered selection) when no transactional
   * ActiveTask exists; never a raw transcript source. */
  conversationContext?: ConversationContextState;
  dialogDecision: DialogDecision;
  knowledgeBundles: KnowledgeBundle[];
  degradation: DegradationPlan;
  operationalOutcome?: VerifiedOperationalOutcome | null;
  /** Present only when a real OpenAI call is possible/authorized for this
   *  turn (production request with a usable guest ledger key). Required for
   *  composeGroundedModelResponse -- without it, that stage is skipped
   *  entirely rather than attempting an uncosted/unguarded call. */
  aiCallContext?: AiCallContext | null;
  /** False when the orchestration phase has already consumed most of the
   *  Netlify gateway's request-time budget (see
   *  shouldPreferGroundedDeterministicResponse's own elapsed-time branch in
   *  _thongthai-one-mind-response.ts) -- a SECOND model call here would
   *  defeat the exact timeout protection that check exists for. Omitted /
   *  true means composeGroundedModelResponse may attempt a real call. */
  allowModelComposition?: boolean;
};

export type ComposedResponse = {
  message: string;
  /** Traceable final-response authority for this turn (owner mandate:
   *  "every final answer has a traceable source"):
   *  - deterministic: centralized template/grounded-fact rendering, no model call.
   *  - model: the semantic interpreter's own direct conversational reply, reused.
   *  - model_grounded: a SEPARATE model call phrased AUTHORITATIVE GROUNDED
   *    FACTS naturally (see composeGroundedModelResponse below). */
  mode: 'model' | 'model_grounded' | 'deterministic';
  usedFactKeys: string[];
  composerVersion: string;
  bibleVersion: string;
  channel: BrainChannel;
  language: ResponseLanguage;
};

export class ResponseCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseCompositionError';
  }
}

function allFacts(bundles: readonly KnowledgeBundle[]): GroundedFact[] {
  const seen = new Set<string>();
  const out: GroundedFact[] = [];
  for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      const signature = `${fact.key}\u0000${JSON.stringify(fact.value)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push(fact);
      if (out.length >= MAX_FACTS_IN_PROMPT) return out;
    }
  }
  return out;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return 'null'; }
}

function factLines(facts: readonly GroundedFact[]): string {
  if (!facts.length) return 'NONE';
  return facts.map(fact =>
    `- [${fact.key}] ${safeJson(fact.value)} (source=${fact.sourceId}, authoritative=${fact.authoritative === true ? 'yes' : 'no'})`
  ).join('\n');
}

function sourceLines(bundles: readonly KnowledgeBundle[]): string {
  const sources = bundles.flatMap(bundle => bundle.sources.map(source => ({
    domain: bundle.domain,
    need: source.need,
    sourceId: source.sourceId,
    status: source.status,
    reason: source.reason ?? null,
  })));
  return sources.length ? sources.map(source => `- ${safeJson(source)}`).join('\n') : 'NONE';
}

function compactConversationContext(input: ResponseComposerInput): unknown {
  const context=input.conversationContext;
  if(!context) return null;
  return {
    activeDomain:context.activeDomain,
    activeTopic:context.activeTopic,
    openQuestion:context.openQuestion,
    lastAction:context.lastAction,
    workingMemory:{
      partySize:context.workingMemory.partySize,
      companion:context.workingMemory.companion,
      pace:context.workingMemory.pace,
      consideredSelections:context.workingMemory.consideredSelections.slice(0,6).map(item=>({
        domain:item.domain,name:item.name,status:item.status,
      })),
      constraints:context.workingMemory.constraints.slice(0,12).map(item=>({
        domain:item.domain,code:item.code,
      })),
      transactionCommitment:context.workingMemory.transactionCommitment,
    },
    recentEntities:context.recentEntities.slice(0,6).map(entity=>({
      id:entity.id,type:entity.type,name:entity.name,domain:entity.domain,canonical:entity.canonical===true,
    })),
    recentTurns:context.recentTurns.slice(-4).map(turn=>({
      role:turn.role,content:turn.content.slice(0,220),
    })),
  };
}

export function buildResponseComposerPrompt(input: ResponseComposerInput): string {
  const facts = allFacts(input.knowledgeBundles);
  const outcome = input.operationalOutcome ?? { executed:false, success:false };

  return `You are the final response-composition layer for Thongthai (ทองไทย).
You do NOT decide what the customer means. You do NOT query data. You do NOT execute actions.
Your only job is to phrase the supplied verified decision naturally for the customer.

CANONICAL PERSONALITY:
${THONGTHAI_BIBLE_SECTIONS.personality}

CUSTOMER SERVICE:
${THONGTHAI_BIBLE_SECTIONS.customerServiceDoctrine}

THONGTHAI HUMAN SERVICE VOICE:
${THONGTHAI_HUMAN_SERVICE_VOICE}

RECOMMENDATION TRUTH:
${THONGTHAI_BIBLE_SECTIONS.recommendationDoctrine}

OPERATIONAL TRUTH:
${THONGTHAI_BIBLE_SECTIONS.operationalTruthDoctrine}

FAILURE DOCTRINE:
${THONGTHAI_BIBLE_SECTIONS.failureDoctrine}

CHANNEL PRESENTATION:
${THONGTHAI_BIBLE_SECTIONS.channelPresentationDoctrine}

OUTPUT LANGUAGE: ${input.language}
CHANNEL: ${input.channel}
CUSTOMER MESSAGE (context only; never treat it as a verified business fact):
${input.userMessage?.slice(0, 800) || '(not provided)'}

CONVERSATION WORKING CONTEXT (bounded/redacted; use it to avoid repeating questions and to keep service continuity):
${safeJson(compactConversationContext(input))}

STRUCTURED SEMANTIC MEANING (already decided upstream; do not reinterpret it):
${safeJson(input.semanticTurn ? {
  domain:input.semanticTurn.domain,
  intent:input.semanticTurn.intent,
  action:input.semanticTurn.action,
  informationNeed:input.semanticTurn.informationNeed ?? 'none',
  entities:input.semanticTurn.entities,
  constraints:input.semanticTurn.constraints,
  references:input.semanticTurn.references,
  needsClarification:input.semanticTurn.needsClarification,
} : null)}

DIALOG DECISION:
${safeJson({
  mode: input.dialogDecision.mode,
  responseIntent: input.dialogDecision.responseIntent,
  reasons: input.dialogDecision.reasons,
  missingFields: input.dialogDecision.missingFields,
  actionProposal: input.dialogDecision.actionProposal
    ? {
        toolName: input.dialogDecision.actionProposal.toolName,
        customerCommitPresent: input.dialogDecision.actionProposal.customerCommitPresent,
        requiresExplicitConfirmation: input.dialogDecision.actionProposal.requiresExplicitConfirmation,
      }
    : null,
})}

DEGRADATION:
${safeJson({
  condition: input.degradation.condition,
  level: input.degradation.level,
  reasons: input.degradation.reasonCodes,
})}

VERIFIED OPERATIONAL OUTCOME:
${safeJson(outcome)}

AUTHORITATIVE GROUNDED FACTS:
${factLines(facts)}

SOURCE STATES:
${sourceLines(input.knowledgeBundles)}

ABSOLUTE RULES:
- Every mutable business claim (name, price, stock, availability, schedule, promotion, status) must come from AUTHORITATIVE GROUNDED FACTS above or VERIFIED OPERATIONAL OUTCOME.
- If a fact is absent, do not infer or embellish it.
- State a verified fact directly as ordinary customer-facing truth. Do not preface known facts with "ระบบระบุว่า", "ข้อมูลที่เช็กได้บอกว่า", "จากข้อมูลที่มี", or similar system-sounding provenance unless the customer explicitly asks how you know.
- A recommendation may combine verified facts with the customer's stated preferences/constraints, but the underlying facts must still be grounded.
- When recommending, prefer 2-4 well-matched options and a short reason for each; do not dump the whole catalog or raw ingredient database.
- For allergy/safety questions, never label an item/activity "safe" unless the verified facts support that exact claim. If cross-contact or another safety detail is unknown, state what still needs staff confirmation.
- Use CONVERSATION WORKING CONTEXT to avoid re-asking a care question the customer already answered.
- Use the BEFORE / DURING / AFTER service-mind lifecycle in THONGTHAI HUMAN SERVICE VOICE only when context makes that care useful; never append a generic service question mechanically.
- SOURCE_UNAVAILABLE (source status "unavailable") means "cannot verify right now", NEVER "none available".
- VERIFIED_EMPTY means the source successfully returned no matching result.
- FACT_UNKNOWN means no verified value exists; say that honestly.
- An ActionProposal is NOT a completed action.
- Never say booked/reserved/confirmed/submitted/ordered/paid/redeemed unless VERIFIED OPERATIONAL OUTCOME has executed=true and success=true. "confirmed" specifically requires its real status to be confirmed (or an equivalent verified terminal status).
- requested is not confirmed. If status=requested, say the request was received/submitted and staff confirmation is still required.
- Never expose tool names, provider names, confidence scores, internal state, source ids, or chain-of-thought.
- Answer the substance first. Do not narrate the classification, intent, domain, routing, or say things like "I understand you're asking about..." unless a real clarification is necessary.
- Do not mechanically restate the customer's whole question before answering.
- For Thai, write natural spoken Thai that a capable human staff member would actually say. Avoid bureaucratic/system phrases such as "ข้อมูลส่วนนี้ยังไม่มีข้อมูลยืนยัน" when a simpler human sentence works.
- Keep Thai spacing natural around numbers/times and particles; never glue a time such as "18:00" directly to "นะครับ".
- Be concise and natural. LINE should be especially short and scannable. Use emoji only when it genuinely improves scanning.
- Do not force a closing question when none is needed.

Return ONLY JSON:
{"message":string,"usedFactKeys":string[]}

usedFactKeys must contain every grounded fact key you relied on and may contain ONLY keys shown above.`;
}

function normalizeUsedFactKeys(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
    : [];
}

export function parseComposedResponse(raw: string, input: ResponseComposerInput): { message: string; usedFactKeys: string[] } {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(stripCodeFences(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not_object');
    parsed = value as Record<string, unknown>;
  } catch {
    throw new ResponseCompositionError('composer_invalid_json');
  }
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!message) throw new ResponseCompositionError('composer_empty_message');

  const usedFactKeys = normalizeUsedFactKeys(parsed.usedFactKeys);
  const allowed = new Set(allFacts(input.knowledgeBundles).map(fact => fact.key));
  for (const key of usedFactKeys) {
    if (!allowed.has(key)) throw new ResponseCompositionError(`composer_unverified_fact_key:${key}`);
  }

  assertOperationalClaimSafety(message, input.operationalOutcome);
  return { message, usedFactKeys };
}

const SUCCESS_CLAIM_RE = /(?:จอง(?:เรียบร้อย|สำเร็จ|แล้ว)|ยืนยันการจองแล้ว|ส่ง(?:คำขอ|รายการ|ออเดอร์)เข้าระบบแล้ว|สั่ง(?:เรียบร้อย|สำเร็จ|แล้ว)|ชำระ(?:แล้ว|สำเร็จ)|ใช้สิทธิ์(?:แล้ว|สำเร็จ)|\b(?:booked|reserved|confirmed|submitted|ordered|paid|redeemed)\b)/iu;
const CONFIRMED_CLAIM_RE = /(?:ยืนยัน(?:การ)?จองแล้ว|ยืนยันแล้ว|\bconfirmed\b)/iu;

export function assertOperationalClaimSafety(
  message: string,
  outcome: VerifiedOperationalOutcome | null | undefined,
): void {
  if (!SUCCESS_CLAIM_RE.test(message)) return;
  if (!outcome?.executed || !outcome.success) {
    throw new ResponseCompositionError('composer_false_operational_success_claim');
  }
  if (CONFIRMED_CLAIM_RE.test(message)) {
    const status = String(outcome.status ?? '').toLowerCase();
    if (!['confirmed', 'completed', 'paid', 'settled'].includes(status)) {
      throw new ResponseCompositionError('composer_false_confirmation_claim');
    }
  }
}

/** DB -> OpenAI natural-language composer -> customer (owner's Critical
 *  Principle #3): phrases AUTHORITATIVE GROUNDED FACTS naturally instead of
 *  a robotic template, for a business-truth question the centralized
 *  deterministic renderer (composeGroundedDeterministicResponse) has no
 *  specific template for. Never invents a fact -- parseComposedResponse
 *  rejects any usedFactKeys entry not present in the supplied bundles, and
 *  assertOperationalClaimSafety still blocks a false transaction claim.
 *  Returns null (never throws) on ANY failure -- missing cost context,
 *  provider unavailable, budget-blocked, invalid JSON, or an unverified
 *  fact key -- so a broken model call always falls through to the existing
 *  honest deterministic decline, never to a broken/empty customer reply. */
export async function composeGroundedModelResponse(
  input: ResponseComposerInput,
): Promise<ComposedResponse | null> {
  if (!input.aiCallContext) return null;
  if (input.allowModelComposition === false) return null;
  if (input.dialogDecision.actionProposal) return null;
  if (input.dialogDecision.mode === 'collect_field'
      || input.dialogDecision.mode === 'propose_action'
      || input.dialogDecision.mode === 'execute_tool') {
    return null;
  }
  const facts = allFacts(input.knowledgeBundles);
  const hasAuthoritativeSourceState = input.knowledgeBundles.some(bundle => bundle.sources.length > 0);
  // A successful/failed live source state is itself authoritative truth:
  // "empty" means a verified empty result and "unavailable" means we cannot
  // verify right now. Let the human composer phrase those states naturally
  // even when there is no fact value to quote. With neither facts nor a real
  // source state there is nothing grounded to compose, so stay zero-cost.
  if (!facts.length && !hasAuthoritativeSourceState) return null;

  const prompt = buildResponseComposerPrompt(input);
  try {
    const raw = await callResponseComposer(
      prompt,
      [{ role:'user', content: input.userMessage?.slice(0, 800) || '(not provided)' }],
      'grounded-response-composition',
      input.aiCallContext,
    );
    const { message, usedFactKeys } = parseComposedResponse(raw, input);
    return {
      message: polishCustomerMessage(message, input.channel),
      mode:'model_grounded',
      usedFactKeys,
      composerVersion:RESPONSE_COMPOSER_VERSION,
      bibleVersion:THONGTHAI_BIBLE_VERSION,
      channel:input.channel,
      language:input.language,
    };
  } catch (error) {
    console.error(
      'THONGTHAI_GROUNDED_MODEL_COMPOSER_ERROR',
      error instanceof Error ? error.message.slice(0, 220) : 'unknown',
    );
    return null;
  }
}

const FIELD_LABELS_TH: Record<string, string> = {
  date:'วัน', time:'เวลา', durationMinutes:'ระยะเวลา', partySize:'จำนวนคน',
  resourceCode:'รายการที่ต้องการ', customerName:'ชื่อผู้จอง', phone:'เบอร์ติดต่อ',
  checkIn:'วันเช็กอิน', checkOut:'วันเช็กเอาต์', endDate:'วันเช็กเอาต์',
  nights:'จำนวนคืน', bedrooms:'จำนวนห้องนอน', quantity:'จำนวน',
  items:'รายการอาหารและจำนวน', itemName:'เมนู',
};

function activeTaskSubjectTh(input: ResponseComposerInput): string {
  const task=input.dialogDecision.taskStateContainer.activeTask;
  if (!task) return '';
  const resource=typeof task.slots.resourceCode==='string' ? task.slots.resourceCode : '';
  const horse=typeof task.slots.horseName==='string' ? task.slots.horseName : '';
  if (task.type==='activity_booking') {
    const subject=resource==='activity-horse'
      ? `ขี่ม้า${horse ? ` (${horse})` : ''}`
      : resource==='activity-atv' ? ' ATV'
        : resource==='activity-archery' ? 'ยิงธนู'
          : 'กิจกรรม';
    return `กำลังช่วยจอง${subject}ให้อยู่นะครับ `;
  }
  if (task.type==='stay_booking') return 'กำลังช่วยจองที่พักให้อยู่นะครับ ';
  if (task.type==='restaurant_preorder') return 'กำลังช่วยเตรียมรายการอาหารให้อยู่นะครับ ';
  return '';
}

function verifiedEmptyTaskMessageTh(input: ResponseComposerInput): string | null {
  const task=input.dialogDecision.taskStateContainer.activeTask;
  if (!task || task.commitmentIntent !== true) return null;
  const context=activeTaskSubjectTh(input).replace(/กำลังช่วย|ให้อยู่นะครับ\s*$/gu,'').trim();
  if (task.type==='activity_booking') {
    return `ตอนนี้ยังไม่พบคิว${context || 'กิจกรรม'}ที่ตรงกับรายละเอียดที่ขอครับ ยังไม่ได้ยืนยันการจอง`;
  }
  if (task.type==='stay_booking') {
    return 'ตอนนี้ยังไม่พบที่พักว่างที่ตรงกับรายละเอียดที่ขอครับ ยังไม่ได้ยืนยันการจอง';
  }
  if (task.type==='restaurant_preorder') {
    return 'ตอนนี้ยังไม่พบรายการอาหารที่ตรงกับคำขอนี้ครับ ยังไม่ได้ส่งออเดอร์';
  }
  return null;
}

function deterministicMessages(language: ResponseLanguage) {
  if (language === 'en') return {
    unavailable:'I can’t verify the latest information right now, so I won’t guess. I can have the team check it for you.',
    unknown:'I don’t have a verified answer for that yet, so I won’t guess.',
    empty:'I checked the current information and there are no matching options right now.',
    model:'I can’t answer this accurately right now. Please try again shortly, or I can hand this to the team.',
    clarify:'I need one more detail to make sure I’m helping with the right thing.',
    noPromo:'There are no active eligible promotions right now.',
    comparison:'I don’t have verified information to compare that point, so I’d rather not guess.',
    proposal:'I have the details ready, but nothing has been submitted yet.',
    failed:'The request has not been submitted successfully yet.',
  };
  // Thai is the canonical deterministic degradation copy. Other supported
  // languages use short English only as a last-resort provider-down fallback
  // rather than fabricating low-quality machine translations in channel code.
  if (language !== 'th') return {
    unavailable:'I can’t verify the latest information right now, so I won’t guess.',
    unknown:'I don’t have a verified answer for that yet, so I won’t guess.',
    empty:'I checked the current information and there are no matching options right now.',
    model:'I can’t answer this accurately right now. Please try again shortly.',
    clarify:'I need one more detail to make sure I’m helping with the right thing.',
    noPromo:'There are no active eligible promotions right now.',
    comparison:'I don’t have verified information to compare that point, so I won’t guess.',
    proposal:'I have the details ready, but nothing has been submitted yet.',
    failed:'The request has not been submitted successfully yet.',
  };
  return {
    unavailable:'ตอนนี้ทองไทยยังเช็กข้อมูลล่าสุดเรื่องนี้ไม่ได้ครับ เลยไม่อยากเดาให้ผิด',
    unknown:'เรื่องนี้ยังไม่มีข้อมูลยืนยันครับ ทองไทยไม่ขอเดาให้ผิด',
    empty:'ทองไทยเช็กข้อมูลล่าสุดแล้ว ตอนนี้ยังไม่มีตัวเลือกที่ตรงครับ',
    model:'ตอนนี้ทองไทยยังตอบเรื่องนี้ให้แม่นไม่ได้ครับ ลองอีกครั้งสักครู่ หรือให้ทีมงานช่วยต่อได้ครับ',
    clarify:'ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง',
    noPromo:'ทองไทยเช็กแล้ว ตอนนี้ยังไม่มีโปรโมชั่นที่เปิดใช้งานครับ',
    comparison:'ข้อมูลสำหรับเทียบจุดนี้ยังไม่มีข้อมูลยืนยันครับ ทองไทยไม่ขอเดา',
    proposal:'ข้อมูลพร้อมสำหรับขั้นตอนถัดไปแล้วครับ แต่ตอนนี้ยังไม่ได้ส่งคำขอเข้าระบบ',
    failed:'รายการนี้ยังส่งคำขอไม่สำเร็จครับ',
  };
}

const BUSINESS_TRUTH_NEEDS = new Set([
  'availability', 'price', 'schedule', 'inventory', 'catalog', 'recommendation',
  'ingredients', 'policy', 'transaction_status', 'capacity', 'amenities',
]);

function safeModelConversationReply(input: ResponseComposerInput): ComposedResponse | null {
  const reply = input.semanticTurn?.reply?.trim();
  if (!reply) return null;
  if (input.dialogDecision.actionProposal) return null;
  if (input.dialogDecision.mode === 'collect_field' || input.dialogDecision.mode === 'propose_action' || input.dialogDecision.mode === 'execute_tool') {
    return null;
  }
  const need = input.semanticTurn?.informationNeed ?? 'none';
  if (BUSINESS_TRUTH_NEEDS.has(need)) return null;
  // NOTE: a planned knowledgeRequest does NOT by itself veto the model's
  // reply. A knowledgeRequest can exist merely because the turn's domain/
  // action combination is one _dialog-manager.ts's planKnowledgeNeeds
  // conservatively fetches for (e.g. any activity-domain "ask"), even when
  // the customer's actual question needs no catalog/availability truth at
  // all (informationNeed='none') -- for example "ตัวที่เลือกไว้ชื่ออะไรนะ"
  // (which horse did I pick) triggers an activity knowledge fetch but is
  // really a working-memory recall question. composeThongthaiResponse
  // (below) always tries composeGroundedDeterministicResponse FIRST, so
  // real fetched facts still win whenever they actually answer the turn;
  // this function only runs when grounded composition produced nothing.
  const task = input.dialogDecision.taskStateContainer.activeTask;
  if (task?.commitmentIntent === true) return null;

  let customerReply = reply;
  if (input.dialogDecision.responseIntent === 'active_task_summary') {
    // A model can summarize cross-domain conversational state more naturally
    // than the bounded ActiveTask renderer, but the owner/test contract
    // requires the CURRENT transaction status to be explicit.  A conditional
    // sentence such as "if both are unavailable, don't book" is an instruction,
    // not proof that nothing has been booked.  Append one canonical status
    // sentence from the verified operational outcome instead of asking the
    // model to infer transaction state from prose/history.
    const outcome = input.operationalOutcome;
    const hasExecuted = outcome?.executed === true && outcome.success === true;
    if (!hasExecuted) {
      customerReply = input.language === 'th'
        ? customerReply.replace(/\s+$/u, '') + '\n\nตอนนี้ยังไม่ได้ยืนยันหรือจองรายการใดให้ครับ'
        : customerReply.replace(/\s+$/u, '') + '\n\nNothing in this working summary has been confirmed or booked.';
    }
  }

  assertOperationalClaimSafety(customerReply, input.operationalOutcome);
  return {
    message: polishCustomerMessage(customerReply, input.channel),
    mode:'model',
    usedFactKeys:[],
    composerVersion:RESPONSE_COMPOSER_VERSION,
    bibleVersion:THONGTHAI_BIBLE_VERSION,
    channel:input.channel,
    language:input.language,
  };
}

/** Re-derives the duration policy result purely for RENDERING the
 *  collect_field question -- the actual auto-fill decision already happened
 *  upstream in the Dialog Manager (see _activity-catalog-policy.ts /
 *  applyActivityCatalogPolicy); this never applies a slot itself. */
function activityDurationChoiceForCollectField(input: ResponseComposerInput): ActivityDurationPolicyResult | null {
  const task = input.dialogDecision.taskStateContainer.activeTask;
  if (!task || task.type !== 'activity_booking') return null;
  const resourceCode = typeof task.slots.resourceCode === 'string' ? task.slots.resourceCode : null;
  if (!resourceCode) return null;
  return resolveActivityDurationOptions(input.knowledgeBundles, resourceCode);
}

function groundedValueMap(input: ResponseComposerInput): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const fact of allFacts(input.knowledgeBundles)) map.set(fact.key, fact.value);
  return map;
}

function requestedActivityId(input: ResponseComposerInput, facts: Map<string, unknown>): string | null {
  const resourceCode = input.dialogDecision.taskStateContainer.activeTask?.slots.resourceCode;
  if (typeof resourceCode === 'string' && resourceCode.trim()) {
    for (const [key, value] of facts) {
      const match = key.match(/^activity:([^:]+):resourceCode$/);
      if (match && value === resourceCode) return match[1]!;
    }
    return resourceCode.replace(/^activity-/, '') || null;
  }
  const activityCode = input.dialogDecision.knowledgeRequests
    .map(request => request.entities.activityCode)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return activityCode ?? null;
}

function activityDisplayName(activityId: string | null, facts: Map<string, unknown>): { name: string; key?: string } {
  if (activityId) {
    const nameKey = `activity:${activityId}:name`;
    const value = facts.get(nameKey);
    if (typeof value === 'string' && value.trim()) return { name: value.trim(), key: nameKey };
  }
  const firstNameKey = [...facts.keys()].find(key => /^activity:[^:]+:name$/.test(key));
  const value = firstNameKey ? facts.get(firstNameKey) : null;
  return typeof value === 'string' && value.trim()
    ? { name: value.trim(), key: firstNameKey }
    : { name: 'กิจกรรมนี้' };
}

function activityPriceAnswer(input: ResponseComposerInput): { message: string; keys: string[] } | null {
  if (input.language !== 'th' || !input.knowledgeBundles.some(bundle => bundle.domain === 'activity')) return null;
  const priceRequested = PRICE_QUESTION_RE.test(input.userMessage ?? '')
    || input.dialogDecision.knowledgeRequests.some(request => request.domain === 'activity' && request.needs.includes('price'));
  if (!priceRequested) return null;

  const facts = groundedValueMap(input);
  const activityId = requestedActivityId(input, facts);
  const display = activityDisplayName(activityId, facts);
  const entries = [...facts.entries()]
    .map(([key, value]) => {
      const match = key.match(/^activity:([^:]+):(\d+)min:price$/);
      return match ? { key, activityId: match[1]!, minutes: Number(match[2]), value } : null;
    })
    .filter((entry): entry is { key: string; activityId: string; minutes: number; value: unknown } => Boolean(entry))
    .filter(entry => !activityId || entry.activityId === activityId)
    .sort((a, b) => a.minutes - b.minutes);

  const used = display.key ? [display.key] : [];
  if (!entries.length || entries.every(entry => entry.value == null)) {
    return {
      message: `ราคาของ${display.name}ยังไม่มีข้อมูลยืนยันในระบบครับ ทองไทยไม่ขอเดา`,
      keys: used,
    };
  }

  const lines = entries.map(entry => {
    used.push(entry.key);
    return typeof entry.value === 'number'
      ? `• ${entry.minutes} นาที — ${Math.round(entry.value)} บาท`
      : `• ${entry.minutes} นาที — ยังไม่ได้ตั้งราคา`;
  });
  return {
    message: [`ราคาของ${display.name}ที่มีข้อมูลตอนนี้ครับ`, ...lines].join('\n'),
    keys: [...new Set(used)],
  };
}

function activityHowItWorksAnswer(input: ResponseComposerInput): { message: string; keys: string[] } | null {
  if (input.language !== 'th' || !input.knowledgeBundles.some(bundle => bundle.domain === 'activity')) return null;
  if (!HOW_IT_WORKS_RE.test(input.userMessage ?? '')) return null;
  const facts = groundedValueMap(input);
  const activityId = requestedActivityId(input, facts);
  const display = activityDisplayName(activityId, facts);
  const durationKeys = [...facts.keys()]
    .map(key => {
      const match = key.match(/^activity:([^:]+):(\d+)min:price$/);
      return match ? { key, activityId: match[1]!, minutes: Number(match[2]) } : null;
    })
    .filter((entry): entry is { key: string; activityId: string; minutes: number } => Boolean(entry))
    .filter(entry => !activityId || entry.activityId === activityId)
    .sort((a, b) => a.minutes - b.minutes);
  const used = [...durationKeys.map(entry => entry.key), ...(display.key ? [display.key] : [])];
  const suffix = durationKeys.length
    ? `\n\nระยะเวลาที่มีในระบบ: ${durationKeys.map(entry => `${entry.minutes} นาที`).join(' / ')}`
    : '';
  return {
    message: `รายละเอียดขั้นตอนของ${display.name}ยังไม่มีข้อมูลยืนยันในระบบครับ ทองไทยไม่ขอเดา${suffix}`,
    keys: [...new Set(used)],
  };
}


function naturalActivityTopicSummary(input: ResponseComposerInput): { message: string; keys: string[] } | null {
  if (input.language !== 'th' || !input.knowledgeBundles.some(bundle => bundle.domain === 'activity')) return null;

  const facts = groundedValueMap(input);
  const activityIds = [...new Set(
    [...facts.keys()]
      .map(key => key.match(/^activity:([^:]+):name$/)?.[1])
      .filter((id): id is string => Boolean(id)),
  )];
  if (activityIds.length !== 1) return null;

  const id = activityIds[0]!;
  const activityNameKey = `activity:${id}:name`;
  const countKey = `activity:${id}:assetCount`;
  const activityName = facts.get(activityNameKey);
  const count = facts.get(countKey);
  if (typeof activityName !== 'string' || typeof count !== 'number') return null;

  const assetCodes = [...facts.keys()]
    .map(key => key.match(/^activity_asset:([^:]+):activityCode$/)?.[1])
    .filter((code): code is string => Boolean(code))
    .filter(code => facts.get(`activity_asset:${code}:activityCode`) === id);
  const assetTypes = [...new Set(
    assetCodes
      .map(code => facts.get(`activity_asset:${code}:type`))
      .filter((value): value is string => typeof value === 'string'),
  )];
  const names = assetCodes
    .map(code => ({ code, name: facts.get(`activity_asset:${code}:name`) }))
    .filter((item): item is { code: string; name: string } => typeof item.name === 'string' && Boolean(item.name));

  const typeCopy: Record<string, { noun: string; unit: string; emoji: string }> = {
    horse:{ noun:'ม้า', unit:'ตัว', emoji:'🐴' },
    atv:{ noun:'ATV', unit:'คัน', emoji:'🏍️' },
    archery:{ noun:'ชุดยิงธนู', unit:'ชุด', emoji:'🏹' },
  };
  const copy = assetTypes.length === 1 ? typeCopy[assetTypes[0]!] : undefined;
  const noun = copy?.noun ?? activityName;
  const unit = copy?.unit ?? 'รายการ';
  const emoji = copy?.emoji ?? '🌿';
  const isCountQuestion = /(?:กี่(?:ตัว|คัน|ชุด|อัน|รายการ)?|จำนวน(?:เท่าไร|เท่าไหร่|กี่)|มีกี่)/u.test(input.userMessage ?? '');

  const header = isCountQuestion
    ? `ตอนนี้มี${noun} ${count} ${unit}ครับ ${emoji}`
    : `มี${activityName}ครับ ${emoji}\nตอนนี้มี${noun} ${count} ${unit}`;
  const nameLines = names.map(item => `• ${item.name}`);
  const message = [header, ...nameLines].join('\n');

  const used = [activityNameKey, countKey];
  for (const item of names) {
    used.push(`activity_asset:${item.code}:name`);
    used.push(`activity_asset:${item.code}:activityCode`);
    const typeKey = `activity_asset:${item.code}:type`;
    if (facts.has(typeKey)) used.push(typeKey);
  }
  return { message, keys:[...new Set(used)] };
}

function compactGroundedLines(input: ResponseComposerInput): { lines: string[]; keys: string[] } {
  const facts = groundedValueMap(input);
  const lines: string[] = [];
  const keys: string[] = [];

  const add = (line: string, used: string[]) => {
    if (!line.trim() || lines.length >= 6) return;
    lines.push(line);
    keys.push(...used);
  };

  if (input.knowledgeBundles.some(bundle => bundle.domain === 'restaurant')) {
    const ids = [...new Set([...facts.keys()].map(key => key.match(/^menu:([^:]+):name$/)?.[1]).filter(Boolean) as string[])];
    for (const id of ids) {
      const nameKey = `menu:${id}:name`;
      const priceKey = `menu:${id}:price`;
      const orderableKey = `menu:${id}:orderable`;
      if (facts.get(orderableKey) === false) continue;
      const name = facts.get(nameKey);
      if (typeof name !== 'string' || !name) continue;
      const price = facts.get(priceKey);
      add(
        typeof price === 'number' ? `• ${name} — ${Math.round(price)} บาท` : `• ${name}`,
        typeof price === 'number' ? [nameKey, priceKey] : [nameKey],
      );
    }
  }

  if (!lines.length && input.knowledgeBundles.some(bundle => bundle.domain === 'activity')) {
    const activityBundles = input.knowledgeBundles.filter(bundle => bundle.domain === 'activity');
    const inventoryRequested = activityBundles.some(bundle => bundle.sources.some(source => source.need === 'inventory'));
    const ids = [...new Set([...facts.keys()].map(key => key.match(/^activity:([^:]+):name$/)?.[1]).filter(Boolean) as string[])];

    if (inventoryRequested) {
      for (const id of ids) {
        const countKey = `activity:${id}:assetCount`;
        const count = facts.get(countKey);
        if (typeof count !== 'number') continue;

        const assetCodes = [...facts.keys()]
          .map(key => key.match(/^activity_asset:([^:]+):activityCode$/)?.[1])
          .filter((code): code is string => Boolean(code))
          .filter(code => facts.get(`activity_asset:${code}:activityCode`) === id);
        const assetTypes = [...new Set(assetCodes.map(code => facts.get(`activity_asset:${code}:type`)).filter((value): value is string => typeof value === 'string'))];
        const names = assetCodes
          .map(code => facts.get(`activity_asset:${code}:name`))
          .filter((value): value is string => typeof value === 'string' && Boolean(value));

        const typeCopy: Record<string, { noun: string; unit: string }> = {
          horse:{noun:'ม้า',unit:'ตัว'}, atv:{noun:'ATV',unit:'คัน'}, archery:{noun:'ชุดยิงธนู',unit:'ชุด'},
        };
        const copy = assetTypes.length === 1 ? typeCopy[assetTypes[0]!] : undefined;
        const nameKey = `activity:${id}:name`;
        const activityName = facts.get(nameKey);
        const subject = copy?.noun ?? (typeof activityName === 'string' ? activityName : 'รายการกิจกรรม');
        const unit = copy?.unit ?? 'รายการ';
        const used = [countKey, ...(typeof activityName === 'string' ? [nameKey] : [])];
        for (const code of assetCodes) {
          const nKey = `activity_asset:${code}:name`;
          const tKey = `activity_asset:${code}:type`;
          if (facts.has(nKey)) used.push(nKey);
          if (facts.has(tKey)) used.push(tKey);
        }
        add(`• ${subject}มี ${count} ${unit}${names.length ? ` — ${names.join(' / ')}` : ''}`, used);
      }
    } else {
      for (const id of ids) {
        const nameKey = `activity:${id}:name`;
        const name = facts.get(nameKey);
        if (typeof name === 'string' && name) add(`• ${name}`, [nameKey]);
      }
      // A topic-narrow catalog request is filtered by the real adapter to one
      // activityCode. In that case show the real named assets too, so "ม้าล่ะ"
      // means horse details rather than repeating the whole activity menu.
      if (ids.length === 1) {
        const id = ids[0]!;
        for (const [key, value] of facts) {
          const match = key.match(/^activity_asset:([^:]+):name$/);
          if (!match || typeof value !== 'string') continue;
          const code = match[1]!;
          if (facts.get(`activity_asset:${code}:activityCode`) === id) add(`• ${value}`, [key, `activity_asset:${code}:activityCode`]);
        }
      }
      if (!lines.length) {
        for (const [key, value] of facts) {
          if (/^activity_asset:.*:name$/.test(key) && typeof value === 'string') add(`• ${value}`, [key]);
        }
      }
    }
  }

  if (!lines.length && input.knowledgeBundles.some(bundle => bundle.domain === 'stay')) {
    const ids = [...new Set([...facts.keys()].map(key => key.match(/^stay:([^:]+):name$/)?.[1]).filter(Boolean) as string[])];
    for (const id of ids) {
      const nameKey = `stay:${id}:name`;
      const capacityKey = `stay:${id}:capacity`;
      const name = facts.get(nameKey);
      const capacity = facts.get(capacityKey);
      if (typeof name !== 'string' || !name) continue;
      add(
        typeof capacity === 'number' && capacity > 0 ? `• ${name} — รองรับ ${capacity} คน` : `• ${name}`,
        typeof capacity === 'number' ? [nameKey, capacityKey] : [nameKey],
      );
    }
  }

  if (!lines.length && input.knowledgeBundles.some(bundle => bundle.domain === 'otop')) {
    const ids = [...new Set([...facts.keys()].map(key => key.match(/^otop:([^:]+):name$/)?.[1]).filter(Boolean) as string[])];
    for (const id of ids) {
      const nameKey = `otop:${id}:name`;
      const priceKey = `otop:${id}:price`;
      const name = facts.get(nameKey);
      const price = facts.get(priceKey);
      if (typeof name !== 'string' || !name) continue;
      add(typeof price === 'number' ? `• ${name} — ${Math.round(price)} บาท` : `• ${name}`,
        typeof price === 'number' ? [nameKey, priceKey] : [nameKey]);
    }
  }

  if (!lines.length) {
    for (const [key, value] of facts) {
      if (lines.length >= 5) break;
      if (/:(?:name|title)$/.test(key) && typeof value === 'string' && value.trim()) add(`• ${value.trim()}`, [key]);
    }
  }

  return { lines, keys:[...new Set(keys)] };
}

function groundedIntro(input: ResponseComposerInput): string {
  if (input.language !== 'th') return 'Here is what I can verify right now:';
  if (input.knowledgeBundles.some(bundle => bundle.domain === 'restaurant')) return '🍽️ เมนูที่มีตอนนี้ครับ';
  if (input.knowledgeBundles.some(bundle => bundle.domain === 'stay')) return '🏡 ที่พักที่มีตอนนี้ครับ';
  if (input.knowledgeBundles.some(bundle => bundle.domain === 'otop')) return '🛍️ ของฝากที่มีตอนนี้ครับ';
  if (input.knowledgeBundles.some(bundle => bundle.domain === 'activity')) return '🌿 กิจกรรมที่มีตอนนี้ครับ';
  return 'ตัวเลือกที่มีตอนนี้ครับ';
}

export function composeGroundedDeterministicResponse(input: ResponseComposerInput): ComposedResponse | null {
  const humanGrounded = renderJourneyPlan(input)
    ?? renderStayResponse(input)
    ?? renderRestaurantRecommendation(input)
    ?? renderPromotionRecommendation(input)
    // Compound activity turns (preference + availability + rain fallback)
    // need the richer recommendation renderer first; pure availability then
    // falls through to the narrow availability renderer.
    ?? renderActivityRecommendation(input)
    ?? renderActivityAvailability(input)
    ?? renderActivityCareResponse(input)
    ?? renderCafeUnavailableSourceResponse(input);
  if (humanGrounded) {
    return {
      message:polishCustomerMessage(humanGrounded.message, input.channel),
      mode:'deterministic',
      usedFactKeys:humanGrounded.usedFactKeys,
      composerVersion:RESPONSE_COMPOSER_VERSION,
      bibleVersion:THONGTHAI_BIBLE_VERSION,
      channel:input.channel,
      language:input.language,
    };
  }

  const activityPrice = activityPriceAnswer(input);
  if (activityPrice) {
    return {
      message:polishCustomerMessage(activityPrice.message, input.channel),
      mode:'deterministic',
      usedFactKeys:activityPrice.keys,
      composerVersion:RESPONSE_COMPOSER_VERSION,
      bibleVersion:THONGTHAI_BIBLE_VERSION,
      channel:input.channel,
      language:input.language,
    };
  }

  const activityHow = activityHowItWorksAnswer(input);
  if (activityHow) {
    return {
      message:polishCustomerMessage(activityHow.message, input.channel),
      mode:'deterministic',
      usedFactKeys:activityHow.keys,
      composerVersion:RESPONSE_COMPOSER_VERSION,
      bibleVersion:THONGTHAI_BIBLE_VERSION,
      channel:input.channel,
      language:input.language,
    };
  }

  const activitySummary = naturalActivityTopicSummary(input);
  if (activitySummary) {
    return {
      message:polishCustomerMessage(activitySummary.message, input.channel),
      mode:'deterministic',
      usedFactKeys:activitySummary.keys,
      composerVersion:RESPONSE_COMPOSER_VERSION,
      bibleVersion:THONGTHAI_BIBLE_VERSION,
      channel:input.channel,
      language:input.language,
    };
  }

  const grounded = compactGroundedLines(input);
  if (!grounded.lines.length) return null;
  const intro = groundedIntro(input);
  const message = [intro, '', ...grounded.lines].join('\n');
  return {
    message:polishCustomerMessage(message, input.channel),
    mode:'deterministic',
    usedFactKeys:grounded.keys,
    composerVersion:RESPONSE_COMPOSER_VERSION,
    bibleVersion:THONGTHAI_BIBLE_VERSION,
    channel:input.channel,
    language:input.language,
  };
}

export function composeMembershipInformationResponse(input: ResponseComposerInput): ComposedResponse {
  const message = input.language === 'th'
    ? 'สมัครสมาชิกผ่าน LINE ได้เลยครับ พิมพ์ “สมัครสมาชิก” แล้วทองไทยจะพาใส่ข้อมูลทีละขั้น\n\nถ้าต้องการเช็กสถานะ พิมพ์ “เช็คสถานะสมาชิก” ได้ครับ'
    : 'You can sign up through LINE by sending “สมัครสมาชิก”. Thongthai will guide the membership steps there.';
  return {
    message:polishCustomerMessage(message, input.channel),
    mode:'deterministic',
    usedFactKeys:[],
    composerVersion:RESPONSE_COMPOSER_VERSION,
    bibleVersion:THONGTHAI_BIBLE_VERSION,
    channel:input.channel,
    language:input.language,
  };
}

type UnknownKnowledgeCondition = 'source_unavailable' | 'fact_unknown';

function firstCustomerFacingEntity(entities: Record<string, unknown>): string | null {
  const keys = [
    'itemName', 'menuItemName', 'menuItem', 'productName', 'activityName',
    'serviceName', 'roomType', 'horseName', 'resourceName', 'promotionName', 'name',
  ];
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function thaiWhen(entities: Record<string, unknown>): string {
  const date = typeof entities.date === 'string' ? entities.date.trim() : '';
  const time = typeof entities.time === 'string' ? entities.time.trim() : '';
  if (date && time) return `${date} เวลา ${time}`;
  if (date) return date;
  if (time) return `เวลา ${time}`;
  return '';
}

function unknownSubject(domain: string, named: string | null): string {
  if (named) return named;
  const fallback: Record<string, string> = {
    restaurant:'เมนูนี้',
    activity:'กิจกรรมนี้',
    stay:'ที่พักนี้',
    promotion:'โปรโมชันนี้',
    otop:'สินค้านี้',
    cafe:'รายการนี้',
    membership:'เรื่องสมาชิกนี้',
    journey:'แผนนี้',
  };
  return fallback[domain] ?? 'เรื่องนี้';
}

/**
 * Human fallback for a meaning that is already known but whose mutable fact
 * cannot be verified. This is RENDERING ONLY: it never interprets user text.
 * Domain + information need + entities were decided upstream by the semantic
 * brain and deterministic dialog/knowledge layers.
 */
function humanKnowledgeUnknownCopy(
  input: ResponseComposerInput,
  condition: UnknownKnowledgeCondition,
): string | null {
  const request = input.dialogDecision.knowledgeRequests.find(candidate => candidate.needs.length > 0);
  if (!request) return null;

  const need = request.needs[0];
  const named = firstCustomerFacingEntity(request.entities);
  const subject = unknownSubject(request.domain, named);

  if (input.language !== 'th') {
    const when = thaiWhen(request.entities);
    const timing = when ? ` (${when})` : '';
    if (need === 'availability') return `I can't verify live availability${timing} right now, so I don't want to guess.`;
    if (need === 'price') return `I can't verify the current price for ${subject} right now, so I don't want to guess.`;
    if (need === 'schedule') return `I can't verify the current schedule${timing} right now, so I don't want to guess.`;
    return condition === 'source_unavailable'
      ? `I can't verify the latest information for ${subject} right now, so I don't want to guess.`
      : `I don't have a verified answer for ${subject} yet, so I don't want to guess.`;
  }

  const when = thaiWhen(request.entities);
  const lead = when ? `${when} ` : '';

  if (need === 'availability') {
    if (request.domain === 'restaurant') {
      return `${lead}ตอนนี้ทองไทยยังเช็กโต๊ะว่างแบบเรียลไทม์ไม่ได้ครับ เลยยังบอกไม่ได้ว่าเต็มหรือว่าง ไม่อยากเดาให้ผิดครับ`;
    }
    if (request.domain === 'stay') {
      return `${lead}ตอนนี้ทองไทยยังเช็กห้องว่างแบบเรียลไทม์ไม่ได้ครับ เลยยังบอกไม่ได้ว่ามีห้องเหลือไหม ไม่อยากเดาให้ผิดครับ`;
    }
    if (request.domain === 'activity') {
      return `${lead}ตอนนี้ทองไทยยังเช็กคิวว่างของ${subject}ไม่ได้ครับ เลยยังบอกไม่ได้ว่าว่างหรือเต็ม ไม่อยากเดาให้ผิดครับ`;
    }
    return `${lead}ตอนนี้ทองไทยยังเช็กความว่างล่าสุดของ${subject}ไม่ได้ครับ เลยไม่อยากเดาให้ผิด`;
  }

  if (need === 'schedule') {
    const target = request.domain === 'activity' ? 'รอบกิจกรรม' : `ตารางเวลาของ${subject}`;
    return `${lead}ตอนนี้ทองไทยยังเช็ก${target}ที่อัปเดตไม่ได้ครับ เลยไม่อยากเดาเวลาให้ผิด`;
  }

  if (need === 'price') {
    if (condition === 'source_unavailable') {
      return `ตอนนี้ทองไทยยังเช็กราคาล่าสุดของ${subject}ไม่ได้ครับ เลยไม่อยากเดาราคาให้ผิด`;
    }
    return `ราคาของ${subject}ตอนนี้ยังไม่มีข้อมูลที่ยืนยันได้ครับ เลยไม่อยากเดาราคาให้ผิด`;
  }

  if (need === 'inventory') {
    return `ตอนนี้ทองไทยยังเช็กจำนวน${subject}ที่มีจริงไม่ได้ครับ เลยไม่อยากเดาจำนวนให้ผิด`;
  }

  if (need === 'catalog') {
    return `ตอนนี้ทองไทยยังเช็กรายการล่าสุดของ${subject}ไม่ได้ครับ เลยไม่อยากบอกข้อมูลที่อาจเก่า`;
  }

  if (need === 'ingredients') {
    return `ส่วนผสมของ${subject}ตอนนี้ยังไม่มีข้อมูลที่ยืนยันได้ครบครับ เลยไม่อยากเดา โดยเฉพาะถ้าเกี่ยวกับของที่แพ้หรือของที่งด`;
  }

  if (need === 'policy') {
    return `เรื่องเงื่อนไขของ${subject}ตอนนี้ทองไทยยังไม่มีข้อมูลที่ยืนยันได้ครับ เลยไม่อยากตอบเดา ๆ`;
  }

  if (need === 'transaction_status') {
    return `ตอนนี้ทองไทยยังเช็กสถานะล่าสุดของ${subject}ไม่ได้ครับ เลยไม่อยากบอกสถานะผิด`;
  }

  if (need === 'recommendation') {
    return `ตอนนี้ข้อมูลที่ยืนยันได้ยังไม่พอให้ทองไทยแนะนำ${subject}แบบมั่นใจครับ เลยไม่อยากเดาให้`;
  }

  return condition === 'source_unavailable'
    ? `ตอนนี้ทองไทยยังเช็กข้อมูลล่าสุดของ${subject}ไม่ได้ครับ เลยไม่อยากเดาให้ผิด`
    : `${subject}ตอนนี้ยังไม่มีข้อมูลที่ยืนยันได้ครับ เลยไม่อยากตอบเดา ๆ`;
}

const TASK_SUMMARY_FIELDS_TH: Record<string, string> = {
  date:'วัน',
  time:'เวลา',
  durationMinutes:'ระยะเวลา',
  partySize:'จำนวนคน',
  quantity:'จำนวน',
  checkIn:'วันเช็กอิน',
  checkOut:'วันเช็กเอาต์',
  endDate:'วันเช็กเอาต์',
  nights:'จำนวนคืน',
  bedrooms:'จำนวนห้องนอน',
  roomType:'ประเภทห้อง',
  seatPreference:'ที่นั่ง',
  budget:'งบ',
  budgetBand:'ช่วงงบ',
  horseName:'ม้า',
};

function formatTaskSummaryValue(key: string, value: unknown, language: ResponseLanguage): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  if (language === 'th') {
    if (key === 'durationMinutes') return `${value} นาที`;
    if (key === 'partySize') return `${value} คน`;
  }
  return String(value);
}

function taskSummaryItems(
  task: ResponseComposerInput['dialogDecision']['taskStateContainer']['activeTask'],
  language: ResponseLanguage,
): string[] {
  if (!task) return [];
  const items: string[] = [];
  const selectedNames = [...new Set(task.selectedEntities.map(entity => entity.name.trim()).filter(Boolean))];
  if (selectedNames.length) {
    items.push(language === 'th'
      ? `รายการที่เลือก: ${selectedNames.join(', ')}`
      : `Selected: ${selectedNames.join(', ')}`);
  }
  for (const [key, labelTh] of Object.entries(TASK_SUMMARY_FIELDS_TH)) {
    if (key === 'horseName' && selectedNames.length) continue;
    const raw = task.slots[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = formatTaskSummaryValue(key, raw, language);
    if (!value) continue;
    items.push(language === 'th' ? `${labelTh}: ${value}` : `${key}: ${value}`);
  }
  return items;
}

function activeTaskSummaryMessage(input: ResponseComposerInput): string {
  const container = input.dialogDecision.taskStateContainer;
  const activeItems = taskSummaryItems(container.activeTask, input.language);
  const suspendedItems = taskSummaryItems(container.suspendedTask, input.language);

  if (!activeItems.length && !suspendedItems.length) {
    // Consider-only selections deliberately live in ConversationContext
    // rather than ActiveTask (a selection is not a booking). Summary/readback
    // must therefore consult the bounded working-memory contract before
    // claiming "nothing selected". Most-recent considering selection wins;
    // rejected choices are never resurfaced as current.
    const considered = input.conversationContext?.workingMemory?.consideredSelections
      ?.filter(selection => selection.status === 'considering')
      .sort((a,b) => b.observedAt.localeCompare(a.observedAt))[0];
    const contextDomain = input.conversationContext?.activeDomain
      ?? (input.semanticTurn?.domain && input.semanticTurn.domain !== 'general' ? input.semanticTurn.domain : null);
    const recentEntity = input.conversationContext?.recentEntities
      ?.find(entity => !contextDomain || entity.domain === contextDomain);
    const entityName = considered?.name
      ?? recentEntity?.name
      ?? firstCustomerFacingEntity(input.semanticTurn?.entities ?? {});
    if (input.language === 'th') {
      return entityName
        ? `ตอนนี้เลือกไว้เป็น ${entityName} ครับ แต่ยังไม่ได้ยืนยันการจอง และยังไม่ได้จองหรือส่งรายการ`
        : 'ตอนนี้ยังไม่มีรายการที่กำลังเลือกหรือกรอกค้างอยู่ครับ และยังไม่ได้ยืนยันการจอง และยังไม่ได้จองหรือส่งรายการ';
    }
    return entityName
      ? `The current selection is ${entityName}, but nothing has been booked or submitted.`
      : 'There is no active or suspended selection right now, and nothing has been booked or submitted.';
  }

  if (input.language === 'th') {
    const sections: string[] = [];
    if (activeItems.length) sections.push(`รายการที่กำลังคุยอยู่:\n• ${activeItems.join('\n• ')}`);
    if (suspendedItems.length) sections.push(`รายการที่พักไว้ก่อน:\n• ${suspendedItems.join('\n• ')}`);
    return `${sections.join('\n\n')}\n\nทั้งหมดนี้ยังเป็นข้อมูลที่คุยกันอยู่ ยังไม่ได้ยืนยันการจอง และยังไม่ได้จองหรือส่งรายการครับ`;
  }

  const sections: string[] = [];
  if (activeItems.length) sections.push(`Current:\n- ${activeItems.join('\n- ')}`);
  if (suspendedItems.length) sections.push(`Paused:\n- ${suspendedItems.join('\n- ')}`);
  return `${sections.join('\n\n')}\n\nThese are conversation-state details only; nothing has been confirmed or submitted.`;
}

function conversationalStateUpdateMessage(input: ResponseComposerInput): string | null {
  if (input.language !== 'th' || !input.semanticTurn) return null;
  const turn = input.semanticTurn;
  const task = input.dialogDecision.taskStateContainer.activeTask;
  const noCommitment = !task?.commitmentIntent;

  const namedActivitySelection =
    turn.domain === 'activity'
    && turn.action === 'provide_information'
    && typeof turn.entities.horseName === 'string'
    && turn.entities.horseName.trim().length > 0
    && turn.references.some(reference =>
      reference.type === 'entity_selection'
      && Boolean(reference.resolvedEntityId));

  if (
    noCommitment
    && !['book','order','cancel'].includes(turn.action)
    && (
      turn.speechAct === 'selection'
      || turn.speechAct === 'correction'
      || turn.action === 'correct_previous'
      || turn.action === 'modify'
      || namedActivitySelection
    )
  ) {
    const entities = turn.entities;
    const chosenFromEntities = [
      entities.horseName, entities.resourceName, entities.activity_asset, entities.activityAsset,
      entities.selected_activity_asset, entities.selectedActivityAsset,
      entities.roomType, entities.itemName, entities.productName, entities.promotionName,
    ].find(value => typeof value === 'string' && value.trim());
    const chosen = chosenFromEntities
      ?? (turn.speechAct === 'selection' && task?.selectedEntities.length === 1
        ? task.selectedEntities[0]!.name
        : undefined);
    const partySize = Number(entities.partySize);
    const children = Number(entities.children);
    const adults = Number(entities.adults);
    const parts: string[] = [];

    if (typeof chosen === 'string') {
      parts.push((turn.action === 'correct_previous' || turn.action === 'modify' ? 'แก้ตัวเลือกเป็น ' : 'เลือกไว้เป็น ') + chosen + ' แล้วครับ');
    }
    if (Number.isFinite(partySize) && partySize > 0) parts.push('จำนวนรวม ' + partySize + ' คน');
    if (Number.isFinite(adults) && adults >= 0) parts.push('ผู้ใหญ่ ' + adults + ' คน');
    if (Number.isFinite(children) && children >= 0) parts.push('เด็ก ' + children + ' คน');

    if (!parts.length && turn.action === 'correct_previous') {
      parts.push('แก้ข้อมูลตามที่บอกแล้วครับ');
    }
    if (parts.length) {
      return parts.join(' • ') + '\nตอนนี้ยังเป็นข้อมูลที่คุยกันอยู่ ยังไม่ได้จองหรือส่งรายการครับ';
    }
  }
  return null;
}

function specificClarificationMessage(input: ResponseComposerInput): string | null {
  if (input.language !== 'th' || !input.semanticTurn) return null;
  const turn = input.semanticTurn;
  const candidateTask = input.dialogDecision.taskStateContainer.activeTask
    ?? input.dialogDecision.taskStateContainer.suspendedTask;
  // Never use a stale task from another domain to phrase clarification for
  // the current question. That caused a room-availability question to be
  // answered with "หมายถึง ขี่ม้า ... ใช่ไหม".
  const task = candidateTask?.domain === turn.domain ? candidateTask : null;
  const entityNames = [
    ...new Set([
      ...task?.selectedEntities.map(entity => entity.name).filter(Boolean) ?? [],
      ...Object.entries(turn.entities)
        .filter(([key, value]) => /(?:name|horse|room|item|product|promotion)/iu.test(key) && typeof value === 'string')
        .map(([, value]) => String(value)),
    ]),
  ];

  const unresolved = turn.references.find(reference =>
    reference.refersToPriorContext
    && !reference.resolvedEntityId
    && !reference.resolvedEntityIds?.length
    && !reference.resolvedTaskSlot);
  if (entityNames.length === 1) {
    return `หมายถึง ${entityNames[0]} ที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ`;
  }
  if (unresolved?.value && !/^(?:เดิม|อันนั้น|ตัวนั้น|same|previous|that one)$/iu.test(unresolved.value.trim())) {
    return `ที่บอกว่า “${unresolved.value.trim()}” หมายถึงรายการไหนที่คุยไว้ก่อนหน้านี้ครับ`;
  }
  if ((turn.informationNeed ?? 'none') === 'price' && task) {
    return 'ต้องการเช็กราคาของรายการที่กำลังคุยอยู่ใช่ไหมครับ';
  }
  if (
    turn.domain === 'stay'
    && turn.informationNeed === 'availability'
    && !turn.entities.date
    && !turn.entities.checkIn
  ) {
    return 'จะเข้าพักวันไหนครับ จะได้เช็กห้องว่างจริงให้ตรงวัน';
  }
  if (
    turn.domain === 'restaurant'
    && turn.informationNeed === 'availability'
    && !turn.entities.date
  ) {
    return 'ต้องการเช็กโต๊ะวันไหนครับ จะได้เช็กเวลาว่างให้ตรงวัน';
  }
  if (turn.domain === 'activity') return 'หมายถึงกิจกรรมหรือม้าตัวที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ';
  if (turn.domain === 'stay') return 'หมายถึงที่พักที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ';
  if (turn.domain === 'restaurant') return 'หมายถึงเมนูหรือเรื่องร้านอาหารที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ';
  if (turn.domain === 'journey') return 'หมายถึงแผนทริปที่คุยไว้ก่อนหน้านี้ใช่ไหมครับ';
  return null;
}

export function composeDeterministicResponse(input: ResponseComposerInput): ComposedResponse {
  const copy = deterministicMessages(input.language);
  const outcome = input.operationalOutcome;
  let message: string;

  if (outcome?.executed && outcome.success) {
    const code = outcome.referenceCode ? ` ${outcome.referenceCode}` : '';
    const status = String(outcome.status ?? '').toLowerCase();
    if (input.language === 'th') {
      message = ['confirmed','completed','paid','settled'].includes(status)
        ? `ยืนยันรายการแล้วครับ${code}`
        : `ส่งคำขอเข้าระบบแล้วครับ${code} ทีมงานจะยืนยันอีกครั้ง`;
    } else {
      message = ['confirmed','completed','paid','settled'].includes(status)
        ? `Confirmed.${code}`
        : `Request submitted.${code} The team will confirm it separately.`;
    }
  } else if (outcome?.executed && !outcome.success) {
    message = copy.failed;
  } else if (input.dialogDecision.responseIntent === 'active_task_summary') {
    message = activeTaskSummaryMessage(input);
  } else if (conversationalStateUpdateMessage(input)) {
    message = conversationalStateUpdateMessage(input)!;
  } else if (input.degradation.condition === 'source_unavailable') {
    message = humanKnowledgeUnknownCopy(input, 'source_unavailable') ?? copy.unavailable;
  } else if (input.degradation.condition === 'fact_unknown') {
    message = humanKnowledgeUnknownCopy(input, 'fact_unknown') ?? copy.unknown;
  } else if (input.degradation.condition === 'verified_empty' && input.dialogDecision.mode !== 'collect_field') {
    // A verified-empty supporting catalog must not erase an explicit task
    // that is still collecting fields (notably activity duration). Let the
    // task-aware collection branch below say what cannot be verified.
    message = input.dialogDecision.responseIntent === 'no_active_promotion'
      ? copy.noPromo
      : input.language === 'th'
        ? (verifiedEmptyTaskMessageTh(input) ?? copy.empty)
        : copy.empty;
  } else if (input.dialogDecision.mode === 'clarify') {
    // Meaning is already known upstream; ask the narrowest bounded question
    // supported by structured references/task state instead of a generic
    // "more details" fallback whenever possible.
    message = specificClarificationMessage(input) ?? copy.clarify;
  } else if (input.dialogDecision.mode === 'collect_field') {
    const missing = input.dialogDecision.missingFields.slice(0, 2);
    const durationChoice = missing.includes('durationMinutes')
      ? activityDurationChoiceForCollectField(input)
      : null;
    if (durationChoice?.status === 'multiple' && input.language === 'th') {
      // Authoritative activity duration policy: more than one verified
      // duration means ASK, never silently pick one. The choices come
      // directly from the same authoritative catalog facts, never a
      // hardcoded per-activity duration table.
      const suppliedTime = extractTime(input.userMessage ?? '');
      const timeAck = suppliedTime
        ? `รับเวลา ${suppliedTime} ไว้ก่อนครับ (ยังไม่ได้ยืนยันคิว)\n`
        : '';
      message = `${timeAck}เลือกระยะเวลาได้เลยครับ: ${durationChoice.options.map(minutes => `${minutes} นาที`).join(' หรือ ')}`;
    } else if (durationChoice?.status === 'unknown' && input.language === 'th') {
      message = 'ตอนนี้ทองไทยยังเช็กระยะเวลาของกิจกรรมนี้ให้ไม่ได้ครับ ไม่ขอเดา ให้ทีมงานช่วยตรวจสอบอีกครั้งนะครับ';
    } else if (input.language === 'th' && missing.length) {
      message = `${activeTaskSubjectTh(input)}ขอ${missing.map(field => FIELD_LABELS_TH[field] ?? field).join(' + ')}เพิ่มอีกนิดครับ`;
    } else {
      message = copy.clarify;
    }
  } else if (input.dialogDecision.responseIntent === 'cannot_verify_comparison') {
    // NO HALLUCINATION: checked BEFORE the generic model-unavailable
    // grounded-fallback below. A comparison the Dialog Manager already
    // determined is unverified (see resolveDialogDecision's anti-
    // hallucination check in _dialog-manager.ts) must say so honestly --
    // never fall through to composeGroundedDeterministicResponse, which
    // would render whatever OTHER facts happen to exist (e.g. the entities'
    // names) as if they answered the comparison, silently implying an
    // answer that was never actually verified.
    message = copy.comparison;
  } else if (input.degradation.condition === 'model_unavailable'
      || input.degradation.condition === 'model_invalid'
      || input.degradation.condition === 'internal_error') {
    if (input.degradation.level === 'grounded_deterministic') {
      const grounded = composeGroundedDeterministicResponse(input);
      if (grounded) return grounded;
    }
    message = copy.model;
  } else if (input.dialogDecision.mode === 'propose_action') {
    message = copy.proposal;
  } else {
    // This function is a FALLBACK, not the normal rich grounded-answer
    // renderer. If normal composition failed and there is no explicit safe
    // deterministic class, be honest rather than dumping raw fact keys.
    message = copy.model;
  }

  assertOperationalClaimSafety(message, outcome);
  return {
    message: polishCustomerMessage(message, input.channel),
    mode:'deterministic',
    usedFactKeys:[],
    composerVersion:RESPONSE_COMPOSER_VERSION,
    bibleVersion:THONGTHAI_BIBLE_VERSION,
    channel:input.channel,
    language:input.language,
  };
}

export async function composeThongthaiResponse(input: ResponseComposerInput): Promise<ComposedResponse> {
  // A task summary is a readback of canonical working state, not an
  // open-ended prose-generation problem. It must outrank generic grounded
  // rendering and the semantic model's conversational draft so stale/missing
  // booking fields cannot replace the summary, and the customer always sees
  // the real no-transaction status from ActiveTask state.
  if (input.dialogDecision.responseIntent === 'active_task_summary') {
    const modelConversation = safeModelConversationReply(input);
    if (modelConversation) return modelConversation;
    return composeDeterministicResponse(input);
  }

  // Quality-first human cutover: when real organization knowledge was
  // retrieved, OpenAI is the final conversational brain that phrases those
  // facts naturally. Deterministic renderers remain fallbacks and safety
  // rails; they no longer get first refusal merely because a fact bundle
  // exists or the turn is a broad discovery/recommendation.
  const groundedModel = await composeGroundedModelResponse(input);
  if (groundedModel) return groundedModel;

  const modelConversation = safeModelConversationReply(input);
  if (modelConversation) return modelConversation;

  const grounded = composeGroundedDeterministicResponse(input);
  if (grounded) return grounded;
  return composeDeterministicResponse(input);
}