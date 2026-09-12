import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

type LineSource = {
  type?: 'user' | 'group' | 'room';
  userId?: string;
};

type LineMessage = {
  id?: string;
  type?: string;
  text?: string;
};

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
};

type LineWebhookBody = {
  destination?: string;
  events?: LineWebhookEvent[];
};

type ThongthaiResponse = {
  message?: string;
  intent?: string;
  contextUpdates?: Record<string, unknown>;
  journeyAction?: {
    type?: 'none' | 'create' | 'modify' | 'replace';
    journey?: unknown;
  };
  suggestedActions?: Array<{ label?: string; action?: string }>;
};

const TAMMA_SITE_URL = 'https://tamma-chat.netlify.app';
const THONGTHAI_ENDPOINT = '/.netlify/functions/thongthai-chat';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const MAX_LINE_TEXT = 4500;
const MAX_LINE_MESSAGES = 5;

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

/**
 * Stable UUID-shaped anonymous ID for a LINE user.
 * We never persist or log the raw LINE user ID. The existing customer-memory
 * layer only requires a valid UUID anonymous_id, so this lets LINE use the
 * exact same guests / guest_memory / journeys pipeline as the website.
 */
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

async function askThongthai(message: string, userId: string): Promise<ThongthaiResponse> {
  const response = await fetch(siteBaseUrl() + THONGTHAI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestId: lineGuestId(userId),
      message,
      language: detectLanguage(message),
      chatHistory: [],
      guestContext: {
        tripDuration: null,
        travelerType: null,
        group: { adults: null, children: null, elderly: null },
        interests: [],
        pace: null,
        budget: null,
        constraints: [],
      },
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

  if (!response.ok) {
    throw new Error(`Thongthai endpoint returned ${response.status}`);
  }

  return await response.json() as ThongthaiResponse;
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

function buildReplyTexts(result: ThongthaiResponse): string[] {
  let text = typeof result.message === 'string' && result.message.trim()
    ? result.message.trim()
    : 'ทองไทยได้รับข้อความแล้วครับ ลองพิมพ์ใหม่อีกครั้งได้เลยครับ';

  if (result.journeyAction?.type && result.journeyAction.type !== 'none') {
    text += `\n\nดู Journey และบันทึกแผนแบบเต็มได้ที่ ${TAMMA_SITE_URL}/`;
  }

  return splitText(text);
}

async function replyToLine(replyToken: string, texts: string[], accessToken: string): Promise<void> {
  const messages = texts
    .filter(Boolean)
    .slice(0, MAX_LINE_MESSAGES)
    .map(text => ({ type: 'text', text }));

  if (!messages.length) return;

  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE reply failed ${response.status}: ${body.slice(0, 240)}`);
  }
}

async function handleEvent(event: LineWebhookEvent, accessToken: string): Promise<void> {
  const replyToken = event.replyToken;
  if (!replyToken) return;

  if (event.type !== 'message') return;

  const userId = event.source?.userId;
  if (!userId) return;

  if (event.message?.type !== 'text' || typeof event.message.text !== 'string') {
    await replyToLine(
      replyToken,
      ['ตอนนี้ทองไทยคุยผ่านข้อความตัวอักษรก่อนนะครับ พิมพ์สิ่งที่อยากรู้หรือให้ช่วยวาง Journey มาได้เลยครับ'],
      accessToken,
    );
    return;
  }

  const result = await askThongthai(event.message.text, userId);
  await replyToLine(replyToken, buildReplyTexts(result), accessToken);
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

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
  if (!events.length) {
    return { statusCode: 200, body: 'OK' };
  }

  const results = await Promise.allSettled(events.map(item => handleEvent(item, accessToken)));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        const message = failure.reason instanceof Error ? failure.reason.message : 'Unknown LINE webhook error';
        console.error('LINE_WEBHOOK_EVENT_ERROR', message.slice(0, 300));
      }
    }
  }

  // LINE expects a 2xx response for a successfully received webhook. Individual
  // event errors are logged server-side so a transient AI failure does not cause
  // LINE to redeliver the same user message repeatedly.
  return { statusCode: 200, body: 'OK' };
};
