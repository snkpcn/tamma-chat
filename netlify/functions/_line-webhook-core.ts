import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { handleLineBookingMessage, handleLineMembershipMessage } from './_operations-db';

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
const THONGTHAI_ENDPOINT = '/.netlify/functions/thongthai-chat';
const CUSTOMER_MEMORY_ENDPOINT = '/.netlify/functions/customer-memory';
const LINE_LINK_ENDPOINT = '/.netlify/functions/line-link';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const OFFICIAL_MAP_URL = 'https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic';
const MAX_LINE_TEXT = 4500;
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

function siteBaseUrl(): string {
  const candidate = process.env.URL || process.env.DEPLOY_PRIME_URL || TAMMA_SITE_URL;
  return candidate.replace(/\/$/, '');
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

async function reinforceStructuredMemory(message: string, userId: string, language: string): Promise<void> {
  const inferredConstraints = deterministicConstraints(message);
  if (!inferredConstraints.length) return;

  const guestId = lineGuestId(userId);
  const baseUrl = siteBaseUrl();
  const loadResponse = await fetch(baseUrl + CUSTOMER_MEMORY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'load', guestId, language, guestContext: emptyGuestContext() }),
  });

  if (!loadResponse.ok) throw new Error(`Customer memory load returned ${loadResponse.status}`);

  const loaded = await loadResponse.json() as CustomerLoadResponse;
  const current = loaded.guestContext ?? emptyGuestContext();
  const merged: GuestContext = {
    ...current,
    group: current.group ?? { adults: null, children: null, elderly: null },
    interests: Array.isArray(current.interests) ? current.interests : [],
    constraints: [...new Set([
      ...(Array.isArray(current.constraints) ? current.constraints : []),
      ...inferredConstraints,
    ])],
  };

  const saveResponse = await fetch(baseUrl + CUSTOMER_MEMORY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'profile', guestId, language, guestContext: merged }),
  });

  if (!saveResponse.ok) throw new Error(`Customer memory save returned ${saveResponse.status}`);
  console.log('LINE_STRUCTURED_MEMORY_REINFORCED', inferredConstraints.join(','));
}

async function askThongthai(message: string, userId: string): Promise<ThongthaiResponse> {
  const response = await fetch(siteBaseUrl() + THONGTHAI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) throw new Error(`Thongthai endpoint returned ${response.status}`);
  return await response.json() as ThongthaiResponse;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function askThongthaiReliably(message: string, userId: string): Promise<ThongthaiResponse> {
  try {
    return await askThongthai(message, userId);
  } catch (firstError) {
    console.error(
      'LINE_THONGTHAI_FIRST_ATTEMPT_ERROR',
      firstError instanceof Error ? firstError.message.slice(0, 240) : 'unknown',
    );
  }

  // A retry is safe for write actions because operational creates (including restaurant preorders)
  // are idempotent at the database layer. This closes the failure window where a write succeeds
  // but the model/final response times out and the customer otherwise sees silence.
  await delay(250);
  try {
    return await askThongthai(message, userId);
  } catch (secondError) {
    console.error(
      'LINE_THONGTHAI_SECOND_ATTEMPT_ERROR',
      secondError instanceof Error ? secondError.message.slice(0, 240) : 'unknown',
    );
    return {
      message: [
        'ทองไทยรับข้อความแล้วครับ แต่ระบบตอบกลับไม่ทันในรอบนี้',
        'หากเป็นคำสั่งเดิมที่เพิ่งส่งซ้ำ ระบบจะไม่สร้างออเดอร์ซ้ำครับ',
        'ลองส่งข้อความเดิมอีกครั้งได้เลย หรือพิมพ์ “ดูออเดอร์ล่าสุด” เพื่อให้ทองไทยตรวจให้อีกครั้งครับ',
      ].join('\n'),
      intent: 'support',
      journeyAction: { type: 'none', journey: null },
      suggestedActions: [{ label: 'ลองอีกครั้ง', action: message.slice(0, 180) }],
    };
  }
}

function splitText(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.length <= MAX_LINE_TEXT) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_LINE_TEXT && chunks.length < MAX_LINE_MESSAGES - 1) {
    let cut = remaining.lastIndexOf('\n', MAX_LINE_TEXT);
    if (cut < MAX_LINE_TEXT * 0.6) cut = remaining.lastIndexOf(' ', MAX_LINE_TEXT);
    if (cut < MAX_LINE_TEXT * 0.6) cut = MAX_LINE_TEXT;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining.slice(0, MAX_LINE_TEXT));
  return chunks.slice(0, MAX_LINE_MESSAGES);
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
  const messages: LineReplyMessage[] = splitText(baseText)
    .slice(0, textLimit)
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
      ? 'บันทึก Journey นี้ให้แล้วครับ ✅ กลับมาคุยกับทองไทยเมื่อไรก็เรียกแผนนี้ต่อได้ครับ'
      : status === 'already_saved'
        ? 'Journey นี้ถูกบันทึกไว้แล้วครับ ✅'
        : 'ยังไม่พบ Journey ล่าสุดให้บันทึกครับ ลองให้ทองไทยวางแผนก่อนนะครับ';
    await replyToLine(replyToken, [{ type: 'text', text }], accessToken);
    return;
  }

  if (event.type !== 'message') return;

  if (event.message?.type !== 'text' || typeof event.message.text !== 'string') {
    await replyToLine(
      replyToken,
      [{ type: 'text', text: 'ตอนนี้ทองไทยคุยผ่านข้อความตัวอักษรก่อนนะครับ พิมพ์สิ่งที่อยากรู้หรือให้ช่วยวาง Journey มาได้เลยครับ' }],
      accessToken,
    );
    return;
  }

  const message = event.message.text;
  const language = detectLanguage(message);
  try {
    const membershipReply = await handleLineMembershipMessage(lineGuestId(userId), userId, message);
    if (membershipReply) {
      await replyToLine(replyToken, splitText(membershipReply).map(text => ({ type: 'text', text })), accessToken);
      return;
    }
  } catch (error) {
    console.error('LINE_MEMBERSHIP_FLOW_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
  try {
    const bookingReply = await handleLineBookingMessage(lineGuestId(userId), userId, message);
    if (bookingReply) {
      await replyToLine(replyToken, splitText(bookingReply).map(text => ({ type: 'text', text })), accessToken);
      return;
    }
  } catch (error) {
    console.error('LINE_BOOKING_FLOW_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
  const result = await askThongthaiReliably(message, userId);

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
