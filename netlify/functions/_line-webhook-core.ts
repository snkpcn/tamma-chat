import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { splitCustomerMessageForLine } from './_chat-copy-style';
import { processThongthaiChatCore } from './thongthai-chat';
import { isSimpleGreetingMessage, isCasualAttentionMessage, isShortUnclearTextMessage, categorizeDegradedFallback } from './thongthai-chat';
import { loadCustomerMemory, persistCustomerSnapshot } from './_customer-db';
import { claimCustomerTurn, persistCustomerTurnOutcome, type TurnClaimOutcome } from './_ai-cost-store';
import { loadLineDelivery, prepareLineDelivery, leaseLineDelivery, updateLineDelivery, lineDeliveryMessages } from './_line-delivery-store';
import { resolveCustomerLanguage } from './_customer-language';
import { isTransactionMessage, logFallback, retryLabel, turnUnfinishedMessage } from './_customer-fallback';
import {
  CUSTOMER_MIN_RETRY_BUDGET_MS,
  CUSTOMER_TURN_BUDGET_MS,
  CUSTOMER_TURN_HARD_DEADLINE_MS,
  TurnBudgetExhaustedError,
  remainingTurnBudgetMs,
  withinTurnBudget,
} from './_customer-turn-budget';

type LineSource = {
  type?: 'user' | 'group' | 'room';
  userId?: string;
};

type LineMessage = {
  id?: string;
  type?: string;
  text?: string;
};

type LinePostback = {
  data?: string;
};

type LineWebhookEvent = {
  type?: string;
  // Stable across LINE redeliveries of the same event, and present for every
  // event type (not just messages). This is the turn-dedupe key.
  webhookEventId?: string;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
  postback?: LinePostback;
};

type LineWebhookBody = {
  destination?: string;
  events?: LineWebhookEvent[];
};

type GuestContext = {
  tripDuration: string | null;
  travelerType: string | null;
  group: { adults: number | null; children: number | null; elderly: number | null };
  interests: string[];
  pace: string | null;
  budget: number | null;
  constraints: string[];
};

type ThongthaiResponse = {
  message?: string;
  media?: Array<{ type?:string; url?:string; deliveryUrl?:string; alt?:string }>;
  intent?: string;
  contextUpdates?: Partial<GuestContext>;
  journeyAction?: {
    type?: 'none' | 'create' | 'modify' | 'replace';
    journey?: unknown;
  };
  suggestedActions?: Array<{ label?: string; action?: string }>;
};

type CustomerLoadResponse = {
  guestContext?: GuestContext;
};

type LineTextMessage = { type: 'text'; text: string };
type LineFlexMessage = { type: 'flex'; altText: string; contents: Record<string, unknown> };
type LineImageMessage = { type:'image'; originalContentUrl:string; previewImageUrl:string };
type LineReplyMessage = LineTextMessage | LineFlexMessage | LineImageMessage;

const TAMMA_SITE_URL = 'https://tamma-chat.netlify.app';
const LINE_LINK_ENDPOINT = '/.netlify/functions/line-link';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const OFFICIAL_MAP_URL = 'https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic';
const MAX_LINE_MESSAGES = 5;
const LINK_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getHeader(event: HandlerEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === target);
  return entry?.[1];
}

function verifyLineSignature(rawBody: string, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  try {
    const expected = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest();
    const received = Buffer.from(signature, 'base64');
    return received.length === expected.length && timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

/** Stable UUID-shaped anonymous ID for a LINE user. Raw LINE user IDs are never persisted or logged. */
function lineGuestId(userId: string): string {
  const hex = createHash('sha256').update('tamma-line:' + userId, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function detectLanguage(text: string): 'th' | 'en' | 'zh' | 'lo' | 'vi' {
  if (/[\u0E00-\u0E7F]/u.test(text)) return 'th';
  if (/[\u0E80-\u0EFF]/u.test(text)) return 'lo';
  if (/[\u3400-\u9FFF]/u.test(text)) return 'zh';
  if (/[ăâđêôơưĂÂĐÊÔƠƯ]/u.test(text)) return 'vi';
  return 'en';
}

function emptyGuestContext(): GuestContext {
  return {
    tripDuration: null,
    travelerType: null,
    group: { adults: null, children: null, elderly: null },
    interests: [],
    pace: null,
    budget: null,
    constraints: [],
  };
}

function deterministicConstraints(text: string): string[] {
  const normalized = text.trim();
  const limitedWalking = [
    /เดิน(?:เยอะ|ไกล|นาน).{0,12}(?:ไม่(?:ค่อย)?ไหว|ไม่ได้|ลำบาก|ไม่สะดวก)/u,
    /(?:เดินไม่ไหว|เดินลำบาก|เดินไม่ได้|เดินไกลไม่ได้|เดินเยอะไม่ได้|เดินนานไม่ได้)/u,
    /(?:เดิน.{0,8}ไม่ค่อยสะดวก|มีปัญหาเรื่องการเดิน)/u,
    /(?:limited walking|mobility (?:issue|issues|limitation|limitations)|can't walk (?:far|much|long)|cannot walk (?:far|much|long)|unable to walk (?:far|much|long))/i,
  ].some(pattern => pattern.test(normalized));

  return limitedWalking ? ['limited_walking'] : [];
}

// Direct in-process calls into _customer-db.ts, not an HTTP self-fetch to
// customer-memory.ts. Deliberately mirrors that handler's own 'profile'
// action exactly -- including its two separate loadCustomerMemory calls
// (once to read the current context, once more implicitly before the
// write, which is what customer-memory.ts's handler does for every action)
// -- so this refactor changes only the transport, never the behavior.
async function reinforceStructuredMemory(message: string, userId: string, language: string): Promise<void> {
  const inferredConstraints = deterministicConstraints(message);
  if (!inferredConstraints.length) return;

  const guestId = lineGuestId(userId);
  const loaded = await loadCustomerMemory(guestId, language, emptyGuestContext());
  if (!loaded) throw new Error('Customer memory load unavailable');

  const current = loaded.guestContext;
  const merged: GuestContext = {
    ...current,
    group: current.group ?? { adults: null, children: null, elderly: null },
    interests: Array.isArray(current.interests) ? current.interests : [],
    constraints: [...new Set([
      ...(Array.isArray(current.constraints) ? current.constraints : []),
      ...inferredConstraints,
    ])],
  };

  const reloaded = await loadCustomerMemory(guestId, language, merged);
  if (!reloaded) throw new Error('Customer memory unavailable');
  const saved = await persistCustomerSnapshot(
    reloaded.guestDbId,
    { guestContext: merged, visitedExperiences: undefined, favorites: undefined, savedPlan: null },
    language,
    'profile',
  );
  if (!saved) throw new Error('Customer memory save returned false');
  console.log('LINE_STRUCTURED_MEMORY_REINFORCED', inferredConstraints.join(','));
}

// Direct in-process call into thongthai-chat.ts's canonical core, not an
// HTTP self-fetch to this same site's own thongthai-chat function. This is
// the SAME function the web HTTP handler calls -- see
// processThongthaiChatCore's own doc comment and THONGTHAI_HANDOFF.md's
// "LINE self-fetch" finding for why the old HTTP round-trip mattered.
async function askThongthai(message: string, userId: string, eventId?: string): Promise<ThongthaiResponse> {
  const result = await processThongthaiChatCore({
    guestId: lineGuestId(userId),
    message,
    language: detectLanguage(message),
    chatHistory: [],
    guestContext: emptyGuestContext(),
    journeyContext: {
      currentPlan: null,
      savedPlan: null,
      visitedExperiences: [],
      favorites: [],
      journalEntries: [],
    },
    pageContext: { section: 'line' },
  }, eventId ?? null);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Thongthai core returned ${result.statusCode}`);
  }
  return result.payload as ThongthaiResponse;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The LINE turn budget is the shared customer turn budget. Re-exported
 *  under the original names so existing callers and tests keep working;
 *  the web path consumes the same constants from
 *  _customer-turn-budget.ts directly. */
export const LINE_TURN_BUDGET_MS = CUSTOMER_TURN_BUDGET_MS;
export const LINE_MIN_RETRY_BUDGET_MS = CUSTOMER_MIN_RETRY_BUDGET_MS;

export async function askThongthaiReliably(
  message: string,
  userId: string,
  eventId?: string,
  onAttemptError?: (errorType: string) => void,
  turnStartedAt: number = Date.now(),
): Promise<ThongthaiResponse> {
  const remainingMs = () => remainingTurnBudgetMs(turnStartedAt, LINE_TURN_BUDGET_MS);

  try {
    // The clock starts at function entry, so webhook-level work may already
    // have spent the budget. Do not start a core turn nobody will wait for.
    if (remainingMs() <= 0) throw new TurnBudgetExhaustedError(remainingMs());
    return await withinTurnBudget(askThongthai(message, userId, eventId), remainingMs());
  } catch (firstError) {
    console.error(
      'LINE_THONGTHAI_FIRST_ATTEMPT_ERROR',
      firstError instanceof Error ? firstError.message.slice(0, 240) : 'unknown',
    );
    onAttemptError?.(firstError instanceof Error ? firstError.constructor.name : 'unknown');
  }

  // A retry is safe for write actions because operational creates (including restaurant preorders)
  // are idempotent at the database layer. This closes the failure window where a write succeeds
  // but the model/final response times out and the customer otherwise sees silence.
  // It is now also gated on there being enough budget left to finish: a retry
  // that cannot land before the function is killed produces silence, which is
  // the exact symptom the retry exists to prevent.
  if (remainingMs() >= LINE_MIN_RETRY_BUDGET_MS) {
    await delay(250);
    try {
      return await withinTurnBudget(askThongthai(message, userId, eventId), remainingMs());
    } catch (secondError) {
      console.error(
        'LINE_THONGTHAI_SECOND_ATTEMPT_ERROR',
        secondError instanceof Error ? secondError.message.slice(0, 240) : 'unknown',
      );
      onAttemptError?.(secondError instanceof Error ? secondError.constructor.name : 'unknown');
    }
  } else {
    console.log('LINE_THONGTHAI_RETRY_SKIPPED_NO_BUDGET', JSON.stringify({
      remaining_ms: Math.max(0, remainingMs()),
      turn_budget_ms: LINE_TURN_BUDGET_MS,
    }));
    onAttemptError?.('TurnBudgetExhaustedError');
  }

  // In the customer's language, and orders are mentioned only when this
  // message was a transaction: a menu question used to be told that "no
  // duplicate order will be created" for an order it never placed.
  const language = resolveCustomerLanguage(message, detectLanguage(message));
  logFallback({ cause: 'turn_unfinished', reason: 'line_turn_not_answered', channel: 'line', language, eventId: eventId ?? null });
  return {
    message: turnUnfinishedMessage(language, isTransactionMessage(message), 'line'),
    intent: 'support',
    journeyAction: { type: 'none', journey: null },
    suggestedActions: [{ label: retryLabel(language), action: message.slice(0, 180) }],
  };
}

function splitText(value: string): string[] {
  return splitCustomerMessageForLine(value, 1800, MAX_LINE_MESSAGES);
}

function createLinkToken(userId: string, channelSecret: string): string {
  const guestId = lineGuestId(userId);
  const expiresAt = Date.now() + LINK_TOKEN_TTL_MS;
  const payload = `${guestId}.${expiresAt}`;
  const signature = createHmac('sha256', channelSecret).update(payload, 'utf8').digest('base64url');
  return `${payload}.${signature}`;
}

function buildJourneyFlex(result: ThongthaiResponse, userId: string, channelSecret: string): LineFlexMessage {
  const summaryRaw = typeof result.message === 'string' ? result.message.replace(/\s+/g, ' ').trim() : '';
  const summary = summaryRaw.length > 260 ? summaryRaw.slice(0, 257) + '…' : summaryRaw;
  const linkToken = encodeURIComponent(createLinkToken(userId, channelSecret));
  const linkedJourneyUrl = `${TAMMA_SITE_URL}${LINE_LINK_ENDPOINT}?token=${linkToken}&next=journey`;

  return {
    type: 'flex',
    altText: 'Journey จากทองไทยพร้อมแล้ว',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#3B2A20',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ทำมา-ชาติ', color: '#DDB66F', size: 'sm', weight: 'bold' },
          { type: 'text', text: 'Journey ของคุณ', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm' },
          { type: 'text', text: 'วางโดยทองไทย AI Local Host', color: '#E8DED4', size: 'xs', margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: summary || 'แผนของคุณพร้อมแล้วครับ', wrap: true, color: '#4A4039', size: 'sm' },
          { type: 'separator', margin: 'lg', color: '#E8E0D7' },
          { type: 'text', text: 'ปรับแผนได้ต่อในแชตนี้ และความจำของทองไทยจะตามไปบนเว็บเมื่อเปิดแผนเต็ม', wrap: true, color: '#7B6C61', size: 'xs', margin: 'lg' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#7A5A32',
            action: { type: 'uri', label: 'ดู Journey เต็ม', uri: linkedJourneyUrl },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'บันทึก Journey', data: 'action=save_journey', displayText: 'บันทึก Journey นี้' },
          },
          {
            type: 'button',
            style: 'link',
            action: { type: 'uri', label: 'เปิดแผนที่ ทำมา-ชาติ', uri: OFFICIAL_MAP_URL },
          },
        ],
      },
    },
  };
}

function buildReplyMessages(result: ThongthaiResponse, userId: string, channelSecret: string): LineReplyMessage[] {
  const baseText = typeof result.message === 'string' && result.message.trim()
    ? result.message.trim()
    : 'ทองไทยได้รับข้อความแล้วครับ ลองพิมพ์ใหม่อีกครั้งได้เลยครับ';

  const isJourney = Boolean(
    result.journeyAction?.type
    && result.journeyAction.type !== 'none'
    && result.journeyAction.journey,
  );
  const media = (Array.isArray(result.media) ? result.media : [])
    .filter(item => item?.type === 'image' && typeof item.deliveryUrl === 'string' && /^https:\/\//iu.test(item.deliveryUrl))
    .slice(0,4);
  const reserved = media.length + (isJourney ? 1 : 0);
  const textLimit = Math.max(1, MAX_LINE_MESSAGES - reserved);
  const messages: LineReplyMessage[] = splitCustomerMessageForLine(baseText, 1800, textLimit)
    .map(text => ({ type: 'text', text }));

  for (const item of media) {
    if (messages.length >= MAX_LINE_MESSAGES - (isJourney ? 1 : 0)) break;
    messages.push({
      type:'image',
      originalContentUrl:item.deliveryUrl!,
      previewImageUrl:item.deliveryUrl!,
    });
  }
  if (isJourney && messages.length < MAX_LINE_MESSAGES) messages.push(buildJourneyFlex(result, userId, channelSecret));
  return messages.slice(0, MAX_LINE_MESSAGES);
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function supabaseFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabaseConfig();
  if (!config) throw new Error('Supabase configuration missing');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed ${response.status}`);
  return response;
}

async function saveLatestJourney(userId: string): Promise<'saved' | 'already_saved' | 'missing'> {
  const anonymousId = lineGuestId(userId);
  const guestResponse = await supabaseFetch(
    `guests?anonymous_id=eq.${encodeURIComponent(anonymousId)}&select=id&limit=1`,
  );
  const guests = await guestResponse.json() as Array<{ id: string }>;
  const guestDbId = guests[0]?.id;
  if (!guestDbId) return 'missing';

  const journeyResponse = await supabaseFetch(
    `journeys?guest_id=eq.${encodeURIComponent(guestDbId)}&select=action,intent,journey&order=created_at.desc&limit=1`,
  );
  const journeys = await journeyResponse.json() as Array<{ action: string; intent: string | null; journey: unknown }>;
  const latest = journeys[0];
  if (!latest?.journey) return 'missing';
  if (latest.action === 'save') return 'already_saved';

  await supabaseFetch('journeys', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: guestDbId,
      action: 'save',
      intent: 'save_journey',
      journey: latest.journey,
    }),
  });

  await supabaseFetch('guest_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: guestDbId,
      event_type: 'journey_saved',
      intent: 'save_journey',
      metadata: { source: 'line_flex' },
    }),
  });

  return 'saved';
}

/** Bounded by the turn's absolute deadline: an unbounded reply could hold
 *  the function past its kill even after the answer itself was bounded. */
async function replyToLine(
  replyToken: string,
  messages: LineReplyMessage[],
  accessToken: string,
  turnStartedAt: number,
): Promise<void> {
  if (!messages.length) return;
  const timeoutMs = remainingTurnBudgetMs(turnStartedAt, CUSTOMER_TURN_HARD_DEADLINE_MS);
  if (timeoutMs <= 0) throw new Error(`LINE reply skipped: turn deadline passed ${-timeoutMs}ms ago`);
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, MAX_LINE_MESSAGES) }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LineReplyRejectedError(response.status, body);
  }
}

class LineReplyRejectedError extends Error {
  constructor(readonly status: number, body: string) {
    super(`LINE reply failed ${status}: ${body.slice(0, 240)}`);
  }
}

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

/** A UUID that is the same for every attempt at one turn, so LINE accepts
 *  at most one push per turn (X-Line-Retry-Key; a second gets 409). */
function lineRetryKey(turnId: string): string {
  const hex = createHash('sha256').update(`thongthai-line-push:${turnId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Send the persisted answer under a delivery lease. Retrying a push uses
 * the same LINE retry key, including when acceptance was lost to a timeout.
 * A reply timeout is uncertain: retry its token, but never infer from a later
 * 400 that it was not delivered and blindly push a second answer. */
async function deliverPreparedAnswer(
  replyToken: string, userId: string, turnId: string, accessToken: string, turnStartedAt: number,
): Promise<void> {
  const row = await leaseLineDelivery(turnId, userId);
  if (!row) {
    const current = await loadLineDelivery(turnId, userId);
    if (current?.status === 'delivered') return;
    throw new Error('LINE delivery is still in progress');
  }
  try {
    const messages = lineDeliveryMessages<LineReplyMessage>(row);
    if (row.mode !== 'push') {
      // Persist uncertainty BEFORE the call, including a process killed while
      // waiting for LINE or before saving the successful delivery status.
      await updateLineDelivery(row, userId, { mode: 'reply_uncertain' });
      try {
        await replyToLine(replyToken, messages, accessToken, turnStartedAt);
        await updateLineDelivery(row, userId, { status: 'delivered' });
        return;
      } catch (error) {
        if (!(error instanceof LineReplyRejectedError) || error.status !== 400 || row.mode === 'reply_uncertain') throw error;
      }
      // Definite initial token rejection: persist push mode before sending.
      await updateLineDelivery(row, userId, { mode: 'push' });
    }
    const timeoutMs = remainingTurnBudgetMs(turnStartedAt, CUSTOMER_TURN_HARD_DEADLINE_MS);
    if (timeoutMs <= 0) throw new Error('LINE delivery deadline passed');
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
        'X-Line-Retry-Key': lineRetryKey(turnId) },
      body: JSON.stringify({ to: userId, messages: messages.slice(0, MAX_LINE_MESSAGES) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok && response.status !== 409) throw new Error(`LINE push failed ${response.status}`);
    await updateLineDelivery(row, userId, { status: 'delivered' });
    console.log('LINE_PUSH_FALLBACK', JSON.stringify({ outcome: response.status === 409 ? 'already_pushed' : 'pushed' }));
  } catch (error) {
    await updateLineDelivery(row, userId, { status: 'pending' }).catch(() => {});
    throw error;
  }
}

async function handleEvent(
  event: LineWebhookEvent,
  accessToken: string,
  channelSecret: string,
  turnStartedAt: number,
): Promise<void> {
  const replyToken = event.replyToken;
  if (!replyToken) return;

  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'postback' && event.postback?.data === 'action=save_journey') {
    const status = await saveLatestJourney(userId);
    const text = status === 'saved'
      ? 'บันทึก Journey นี้ให้แล้วครับ ✅\nกลับมาคุยกับทองไทยเมื่อไรก็เรียกแผนนี้ต่อได้ครับ'
      : status === 'already_saved'
        ? 'Journey นี้ถูกบันทึกไว้แล้วครับ ✅'
        : 'ยังไม่พบ Journey ล่าสุดให้บันทึกครับ\nลองให้ทองไทยวางแผนก่อนนะครับ';
    await replyToLine(replyToken, splitText(text).map(value => ({ type: 'text', text:value })), accessToken, turnStartedAt);
    return;
  }

  if (event.type !== 'message') return;

  if (event.message?.type !== 'text' || typeof event.message.text !== 'string') {
    await replyToLine(
      replyToken,
      [{ type: 'text', text: 'ตอนนี้ทองไทยคุยผ่านข้อความตัวอักษรก่อนนะครับ\nพิมพ์สิ่งที่อยากรู้ หรือให้ทองไทยช่วยวาง Journey ได้เลยครับ' }],
      accessToken,
      turnStartedAt,
    );
    return;
  }

  // turnStartedAt is taken at function entry (line-webhook.ts) and handed
  // down, so webhook-level work, the dedupe claim and the answer all share
  // one LINE_TURN_BUDGET_MS, and the reply one CUSTOMER_TURN_HARD_DEADLINE_MS.
  const message = event.message.text;
  const language = detectLanguage(message);

  // Coarse pre-LLM category, purely for the LINE_PRIVATE_CHAT_ATTEMPT log --
  // never used to route the message, only to distinguish "casual message got
  // the generic fallback" from "a real booking/weather/feedback question got
  // it" after the fact. See THONGTHAI_HANDOFF.md's "LINE Full Audit" entry.
  const isGreeting = isSimpleGreetingMessage(message);
  const isCasualAttention = isCasualAttentionMessage(message);
  const isShortUnclearText = isShortUnclearTextMessage(message);
  const textCategory = isGreeting || isCasualAttention || isShortUnclearText
    ? 'casual_greeting' : categorizeDegradedFallback(message);
  // deterministicGreetingResponse/deterministicCasualChatResponse/
  // deterministicShortUnclearTextResponse are the FIRST three checks
  // processThongthaiChatCore runs, unconditionally, before any LLM call --
  // so isGreeting/isCasualAttention/isShortUnclearText being true here is a
  // guarantee the core will short-circuit deterministically, not a guess.
  // Logging this accurately (rather than always marking llmAttempted=true)
  // is what let this exact "casual message secretly still called the LLM"
  // production symptom get diagnosed in the first place.
  let deterministicResponder: string | null = isGreeting
    ? 'casual_greeting'
    : isCasualAttention ? 'casual_presence'
      : isShortUnclearText ? 'short_unclear_text' : null;
  let llmAttempted = deterministicResponder === null;
  let llmErrorType: string | null = null;
  let finalResponseKind: string = deterministicResponder ? 'deterministic' : 'thongthai_core';

  const logPrivateChatAttempt = () => {
    console.log('LINE_PRIVATE_CHAT_ATTEMPT', JSON.stringify({
      textCategory,
      deterministicResponder,
      llmAttempted,
      llmErrorType,
      finalResponseKind,
    }));
  };

  // All private customer text enters the same canonical web/LINE brain first.
  // Channel-specific presentation remains below; no LINE-only semantic router
  // may consume booking or membership language ahead of One-Mind.
  // deterministicResponder/llmAttempted were already set accurately above
  // for the casual/greeting case -- askThongthaiReliably is still called
  // either way (it's the single entry point into processThongthaiChatCore,
  // deterministic or not), but only overwrite llmAttempted here for every
  // OTHER category, where it genuinely is about to reach the LLM.
  if (!deterministicResponder) llmAttempted = true;
  // One id for dedupe, the cost ledger and the turn-outcome row, so a
  // redelivery lands on the SAME customer_turn_outcomes row the claim
  // created instead of leaving a phantom one behind. webhookEventId is
  // LINE's own stable per-event id; message.id stays as the fallback for
  // older/odd payloads that omit it.
  const turnId = event.webhookEventId ?? event.message.id;
  // Claim the turn BEFORE any tool, state write or reply. Fails open, so a
  // slow or unavailable claim never costs the customer their answer -- and
  // it is raced against what is left of the answer budget, so it can never
  // eat the slice reserved for the reply. With no budget left there is no
  // answer to protect, only the fallback, so it is not attempted.
  const claimBudgetMs = remainingTurnBudgetMs(turnStartedAt, LINE_TURN_BUDGET_MS);
  const claim: TurnClaimOutcome = claimBudgetMs > 0
    ? await withinTurnBudget(claimCustomerTurn({
      conversationId: lineGuestId(userId),
      eventId: turnId ?? `line:${Date.now()}`,
      channel: 'line',
    }), claimBudgetMs).catch((): TurnClaimOutcome => 'claim_failed_open')
    : 'claim_failed_open';
  if (turnId) {
    const delivery = await loadLineDelivery(turnId, userId);
    if (delivery) {
      if (delivery.status !== 'delivered') await deliverPreparedAnswer(replyToken, userId, turnId, accessToken, turnStartedAt);
      return;
    }
  }
  if (claim === 'duplicate_skipped') {
    // A live/abandoned processing claim with no durable answer is not a
    // delivered message. A 200 here would stop LINE's recovery redelivery.
    throw new Error('LINE answer is not yet durably prepared');
  }
  // Show "typing" while the answer is worked out; it runs alongside the turn
  // and is settled before the reply (see startLineLoadingAnimation).
  // Only with enough answer budget left that the request is settled before
  // that budget ends: it may never eat the slice reserved for the reply.
  const loading = remainingTurnBudgetMs(turnStartedAt, LINE_TURN_BUDGET_MS) > LINE_LOADING_TIMEOUT_MS
    ? startLineLoadingAnimation(userId, accessToken)
    : Promise.resolve();
  const result = await askThongthaiReliably(message, userId, turnId, errorType => {
    llmErrorType = errorType;
  }, turnStartedAt);
  if (!deterministicResponder) finalResponseKind = llmErrorType ? 'degraded_fallback' : 'thongthai_core';
  console.log('FINAL_RESPONSE_SOURCE', JSON.stringify({ source: deterministicResponder ?? finalResponseKind }));
  logPrivateChatAttempt();

  // Bounded by what is left of the answer budget, so it can never eat the
  // slice reserved for the reply.
  try {
    const memoryBudgetMs = remainingTurnBudgetMs(turnStartedAt, LINE_TURN_BUDGET_MS);
    if (memoryBudgetMs <= 0) throw new TurnBudgetExhaustedError(memoryBudgetMs);
    await withinTurnBudget(reinforceStructuredMemory(message, userId, language), memoryBudgetMs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown structured-memory error';
    console.error('LINE_STRUCTURED_MEMORY_ERROR', detail.slice(0, 240));
  }

  await loading;
  const messages = buildReplyMessages(result, userId, channelSecret);
  if (!turnId) throw new Error('LINE message has no stable delivery ID');
  await prepareLineDelivery(turnId, userId, messages);
  // Completion means the answer is durably prepared, not that LINE accepted it.
  // Leave the turn claim in progress if preparation fails, so a later delivery
  // can recover rather than being permanently skipped as a completed turn.
  await Promise.all([
    persistCustomerTurnOutcome({ conversationId: lineGuestId(userId), eventId: turnId,
      channel: 'line', outcome: 'completed', errorType: null, durationMs: Date.now() - turnStartedAt }),
    deliverPreparedAnswer(replyToken, userId, turnId, accessToken, turnStartedAt),
  ]);
}

const LINE_LOADING_ENDPOINT = 'https://api.line.me/v2/bot/chat/loading/start';
/** LINE accepts 5–60 in steps of 5. A turn ends within its 9 s hard
 *  deadline, and the animation stops by itself when the reply arrives. */
const LINE_LOADING_SECONDS = 10;
/** Short: the animation is a courtesy, and it must have landed before the
 *  reply is sent -- a late request would show "typing" after the answer. */
const LINE_LOADING_TIMEOUT_MS = 1_500;

/** The Messaging API loading animation (POST /v2/bot/chat/loading/start).
 *  Per the LINE reference: one-on-one chats only (a group or room id is a
 *  400), shown only while the user is viewing the chat (202 either way),
 *  ends after loadingSeconds or when the account sends a message, LINE
 *  13.16.0+. Called only for a user's own text turn. Never throws: a failed
 *  or slow request is logged and the turn goes on. */
async function startLineLoadingAnimation(userId: string, accessToken: string): Promise<void> {
  try {
    const response = await fetch(LINE_LOADING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ chatId: userId, loadingSeconds: LINE_LOADING_SECONDS }),
      signal: AbortSignal.timeout(LINE_LOADING_TIMEOUT_MS),
    });
    if (!response.ok) console.error('LINE_LOADING_ANIMATION_ERROR', JSON.stringify({ status: response.status }));
  } catch (error) {
    console.error('LINE_LOADING_ANIMATION_ERROR', JSON.stringify({ error: error instanceof Error ? error.name : 'unknown' }));
  }
}

/** `turnStartedAt` is the moment the outer webhook function was entered.
 *  line-webhook.ts passes its own entry time; the standalone handler below
 *  starts the clock itself. */
export async function handleLineCustomerWebhook(
  event: HandlerEvent,
  turnStartedAt: number = Date.now(),
): Promise<{ statusCode: number; body: string }> {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    console.error('LINE_WEBHOOK_CONFIGURATION_MISSING');
    return { statusCode: 500, body: 'LINE configuration missing' };
  }

  const rawBody = event.body ?? '';
  const signature = getHeader(event, 'x-line-signature');
  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    console.error('LINE_WEBHOOK_SIGNATURE_INVALID');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return { statusCode: 200, body: 'OK' };

  const results = await Promise.allSettled(
    events.map(item => {
      const remaining = remainingTurnBudgetMs(turnStartedAt, CUSTOMER_TURN_HARD_DEADLINE_MS);
      if (remaining <= 0) return Promise.reject(new TurnBudgetExhaustedError(remaining));
      return withinTurnBudget(handleEvent(item, accessToken, channelSecret, turnStartedAt), remaining);
    }),
  );
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        const message = failure.reason instanceof Error ? failure.reason.message : 'Unknown LINE webhook error';
        console.error('LINE_WEBHOOK_EVENT_ERROR', message.slice(0, 300));
      }
    }
  }

  return failures.length
    ? { statusCode: 503, body: 'LINE delivery incomplete' }
    : { statusCode: 200, body: 'OK' };
}

export const handler: Handler = async (event: HandlerEvent) => handleLineCustomerWebhook(event);
