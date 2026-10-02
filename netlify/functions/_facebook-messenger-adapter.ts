import { createHash, createHmac, timingSafeEqual } from 'node:crypto';


export const THONGTHAI_FACEBOOK_PERSONA_NAME = 'ทองไทย';
export const THONGTHAI_FACEBOOK_PERSONA_PROFILE_URL =
  'https://tamma-chat.netlify.app/assets/thongthai/thongthai-default.webp';

export function findThongthaiPersonaId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; name?: unknown };
    if (row.name === THONGTHAI_FACEBOOK_PERSONA_NAME && typeof row.id === 'string' && row.id.trim()) {
      return row.id.trim();
    }
  }
  return null;
}

export type FacebookTextEvent = {
  senderPsid: string;
  pageId: string;
  text: string;
  eventId: string;
  timestamp: number | null;
};

type MetaMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
};

type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MetaMessage;
};

type MetaEntry = {
  id?: string;
  messaging?: MetaMessagingEvent[];
};

type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

export function facebookGuestId(psid: string): string {
  const hex = createHash('sha256')
    .update('tamma-facebook:' + psid, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  const variant = parseInt(hex[16]!, 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function detectFacebookLanguage(text: string): 'th' | 'en' | 'zh' | 'lo' | 'vi' {
  if (/[\u0E00-\u0E7F]/u.test(text)) return 'th';
  if (/[\u0E80-\u0EFF]/u.test(text)) return 'lo';
  if (/[\u3400-\u9FFF]/u.test(text)) return 'zh';
  if (/[ăâđêôơưĂÂĐÊÔƠƯ]/u.test(text)) return 'vi';
  return 'en';
}

export function verifyFacebookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const received = Buffer.from(match[1]!, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function extractFacebookTextEvents(payload: unknown, targetPageId: string): FacebookTextEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as MetaWebhookPayload;
  if (body.object !== 'page' || !Array.isArray(body.entry)) return [];

  const events: FacebookTextEvent[] = [];
  const seenEventIds = new Set<string>();
  for (const entry of body.entry) {
    const pageId = typeof entry.id === 'string' ? entry.id : '';
    if (!pageId || pageId !== targetPageId || !Array.isArray(entry.messaging)) continue;

    for (const item of entry.messaging) {
      const psid = typeof item.sender?.id === 'string' ? item.sender.id.trim() : '';
      const recipientId = typeof item.recipient?.id === 'string' ? item.recipient.id.trim() : '';
      const text = typeof item.message?.text === 'string' ? item.message.text.trim() : '';
      if (!psid || !text || item.message?.is_echo === true) continue;
      if (recipientId && recipientId !== targetPageId) continue;

      const timestamp = Number.isFinite(item.timestamp) ? Number(item.timestamp) : null;
      const eventId = typeof item.message?.mid === 'string' && item.message.mid.trim()
        ? item.message.mid.trim().slice(0, 180)
        : `facebook:${facebookGuestId(psid)}:${timestamp ?? Date.now()}`;

      if (seenEventIds.has(eventId)) continue;
      seenEventIds.add(eventId);
      events.push({
        senderPsid: psid,
        pageId,
        text: text.slice(0, 8000),
        eventId,
        timestamp,
      });
    }
  }
  return events;
}

export function splitFacebookText(value: string, maxLength = 1900): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const breakAt = Math.max(
      candidate.lastIndexOf('\n\n'),
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf(' '),
    );
    const cut = breakAt >= Math.floor(maxLength * 0.55) ? breakAt : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
