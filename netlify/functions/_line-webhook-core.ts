import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { handleLineBookingMessage, handleLineMembershipMessage } from './_operations-db';
import { splitCustomerMessageForLine } from './_chat-copy-style';
import { processThongthaiChatCore } from './thongthai-chat';
import { isSimpleGreetingMessage, isCasualAttentionMessage, isShortUnclearTextMessage, categorizeDegradedFallback } from './thongthai-chat';
import { loadCustomerMemory, persistCustomerSnapshot } from './_customer-db';

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
type LineReplyMessage = LineTextMessage | LineFlexMessage;

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

async function askThongthaiReliably(
  message: string,
  userId: string,
  eventId?: string,
  onAttemptError?: (errorType: string) => void,
): Promise<ThongthaiResponse> {
  try {
    return await askThongthai(message, userId, eventId);
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
  await delay(250);
  try {
    return await askThongthai(message, userId, eventId);
  } catch (secondError) {
    console.error(
      'LINE_THONGTHAI_SECOND_ATTEMPT_ERROR',
      secondError instanceof Error ? secondError.message.slice(0, 240) : 'unknown',
    );
    onAttemptError?.(secondError instanceof Error ? secondError.constructor.name : 'unknown');
    return {
      message: [
        'ทองไทยรับข้อความแล้วครับ แต่ระบบตอบกลับไม่ทันในรอบนี้',
        '',
        'ถ้าเพิ่งส่งคำสั่งเดิมซ้ำ ระบบจะไม่สร้างออเดอร์ซ้ำครับ',
        'ลองส่งข้อความเดิมอีกครั้ง หรือพิมพ์ “ดูออเดอร์ล่าสุด” ได้เลย',
      ].join('\n'),
      intent: 'support',
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [{ label: 'ลองอีกครั้ง', action: message.slice(0, 180) }],
    };
  }
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

  const textLimit = isJourney ? MAX_LINE_MESSAGES - 1 : MAX_LINE_MESSAGES;
  const messages: LineReplyMessage[] = splitCustomerMessageForLine(baseText, 1800, textLimit)
    .map(text => ({ type: 'text', text }));

  if (isJourney) messages.push(buildJourneyFlex(result, userId, channelSecret));
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

async function replyToLine(replyToken: string, messages: LineReplyMessage[], accessToken: string): Promise<void> {
  if (!messages.length) return;
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, MAX_LINE_MESSAGES) }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE reply failed ${response.status}: ${body.slice(0, 240)}`);
  }
}

async function handleEvent(
  event: LineWebhookEvent,
  accessToken: string,
  channelSecret: string,
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
    await replyToLine(replyToken, splitText(text).map(value => ({ type: 'text', text:value })), accessToken);
    return;
  }

  if (event.type !== 'message') return;

  if (event.message?.type !== 'text' || typeof event.message.text !== 'string') {
    await replyToLine(
      replyToken,
      [{ type: 'text', text: 'ตอนนี้ทองไทยคุยผ่านข้อความตัวอักษรก่อนนะครับ\nพิมพ์สิ่งที่อยากรู้ หรือให้ทองไทยช่วยวาง Journey ได้เลยครับ' }],
      accessToken,
    );
    return;
  }

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

  try {
    const membershipReply = await handleLineMembershipMessage(lineGuestId(userId), userId, message);
    if (membershipReply) {
      deterministicResponder = 'membership';
      finalResponseKind = 'membership';
      logPrivateChatAttempt();
      await replyToLine(replyToken, splitText(membershipReply).map(text => ({ type: 'text', text })), accessToken);
      return;
    }
  } catch (error) {
    console.error('LINE_MEMBERSHIP_FLOW_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
  try {
    const bookingReply = await handleLineBookingMessage(lineGuestId(userId), userId, message);
    if (bookingReply) {
      deterministicResponder = 'booking';
      finalResponseKind = 'booking';
      console.log('LEGACY_BOOKING_CONSUMED', JSON.stringify({ replyPreview: bookingReply.slice(0, 80) }));
      console.log('FINAL_RESPONSE_SOURCE', JSON.stringify({ source: 'legacy_line_booking' }));
      logPrivateChatAttempt();
      await replyToLine(replyToken, splitText(bookingReply).map(text => ({ type: 'text', text })), accessToken);
      return;
    }
  } catch (error) {
    console.error('LINE_BOOKING_FLOW_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
  // deterministicResponder/llmAttempted were already set accurately above
  // for the casual/greeting case -- askThongthaiReliably is still called
  // either way (it's the single entry point into processThongthaiChatCore,
  // deterministic or not), but only overwrite llmAttempted here for every
  // OTHER category, where it genuinely is about to reach the LLM.
  if (!deterministicResponder) llmAttempted = true;
  const result = await askThongthaiReliably(message, userId, event.message.id, errorType => {
    llmErrorType = errorType;
  });
  if (!deterministicResponder) finalResponseKind = llmErrorType ? 'degraded_fallback' : 'thongthai_core';
  console.log('FINAL_RESPONSE_SOURCE', JSON.stringify({ source: deterministicResponder ?? finalResponseKind }));
  logPrivateChatAttempt();

  try {
    await reinforceStructuredMemory(message, userId, language);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown structured-memory error';
    console.error('LINE_STRUCTURED_MEMORY_ERROR', detail.slice(0, 240));
  }

  await replyToLine(replyToken, buildReplyMessages(result, userId, channelSecret), accessToken);
}

export const handler: Handler = async (event: HandlerEvent) => {
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
    events.map(item => handleEvent(item, accessToken, channelSecret)),
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

  return { statusCode: 200, body: 'OK' };
};
