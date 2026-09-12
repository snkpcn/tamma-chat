import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { decryptPii } from './_operations-db';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function getHeader(event: HandlerEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === target)?.[1];
}

function derivedKey(): Buffer | null {
  const raw = process.env.CUSTOMER_PII_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash('sha256').update('tamma-staff-line-contact-v1:' + raw, 'utf8').digest();
}

function verifyStaffRequest(event: HandlerEvent): boolean {
  const key = derivedKey();
  const timestampRaw = getHeader(event, 'x-tamma-timestamp');
  const signatureRaw = getHeader(event, 'x-tamma-signature');
  if (!key || !timestampRaw || !signatureRaw) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) return false;
  try {
    const expected = createHmac('sha256', key)
      .update(`${timestampRaw}.${event.body ?? ''}`, 'utf8')
      .digest();
    const received = Buffer.from(signatureRaw, 'base64url');
    return received.length === expected.length && timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!verifyStaffRequest(event)) return json(401, { error: 'Unauthorized' });

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return json(503, { error: 'LINE channel is not configured' });

  let body: { customerId?: string; message?: string; bookingId?: string; orderId?: string; inquiryId?: string; actor?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return json(400, { error: 'Malformed JSON' });
  }

  const customerId = typeof body.customerId === 'string' ? body.customerId : '';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4500) : '';
  if (!customerId || !message) return json(400, { error: 'customerId and message are required' });

  try {
    const contactRes = await dbFetch(
      `customer_channel_contacts?customer_id=eq.${encodeURIComponent(customerId)}`
      + '&provider=eq.line&reachable=eq.true&select=external_id_enc&order=last_seen_at.desc&limit=1',
    );
    const contacts = await contactRes.json() as Array<{ external_id_enc: string }>;
    const lineUserId = decryptPii(contacts[0]?.external_id_enc);
    if (!lineUserId) return json(404, { error: 'No reachable LINE contact for this customer' });

    const lineResponse = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: message }] }),
    });
    if (!lineResponse.ok) {
      const detail = await lineResponse.text().catch(() => '');
      throw new Error(`LINE push failed ${lineResponse.status}: ${detail.slice(0, 160)}`);
    }

    await dbFetch('customer_contact_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        customer_id: customerId,
        booking_id: body.bookingId ?? null,
        order_id: body.orderId ?? null,
        inquiry_id: body.inquiryId ?? null,
        channel: 'line',
        direction: 'outbound',
        status: 'sent',
        note: 'Sent from tamma backoffice',
        created_by: typeof body.actor === 'string' ? body.actor.slice(0, 120) : 'backoffice',
      }),
    });

    return json(200, { ok: true });
  } catch (error) {
    console.error('STAFF_LINE_CONTACT_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return json(503, { error: 'Could not send LINE follow-up' });
  }
};
