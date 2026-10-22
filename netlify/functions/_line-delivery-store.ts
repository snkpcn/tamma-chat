import { createHash, randomUUID } from 'node:crypto';
import { backendFetch } from './_backend-fetch';
import { encryptPii, decryptPii } from './_operations-db';
import { CUSTOMER_TURN_HARD_DEADLINE_MS } from './_customer-turn-budget';

// Separate from customer_turn_outcomes: completing the brain is not delivery.
// Payloads contain customer replies and are encrypted with the existing PII key.
export type LineDelivery = {
  event_id: string;
  target_hash: string;
  payload_enc: string;
  status: 'pending' | 'sending' | 'delivered';
  mode: 'reply' | 'reply_uncertain' | 'push';
  lease_id: string | null;
  leased_at: string | null;
};

const targetHash = (userId: string) => createHash('sha256').update(userId).digest('hex');
async function store(query: URLSearchParams, method = 'GET', body?: unknown): Promise<LineDelivery[]> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/u, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('LINE delivery store not configured');
  const response = await backendFetch(`${url}/rest/v1/line_customer_deliveries?${query}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, 750);
  if (!response.ok) throw new Error(`LINE delivery store ${response.status}`);
  return await response.json() as LineDelivery[];
}
const identity = (eventId: string, userId: string) => new URLSearchParams({
  event_id: `eq.${eventId}`, target_hash: `eq.${targetHash(userId)}`,
});

export async function loadLineDelivery(eventId: string, userId: string): Promise<LineDelivery | null> {
  const query = identity(eventId, userId);
  query.set('expires_at', `gt.${new Date().toISOString()}`);
  return (await store(query))[0] ?? null;
}

export async function prepareLineDelivery(eventId: string, userId: string, messages: unknown[]): Promise<void> {
  await store(new URLSearchParams({ on_conflict: 'event_id' }), 'POST', {
    event_id: eventId, target_hash: targetHash(userId),
    payload_enc: encryptPii(JSON.stringify(messages)), status: 'pending', mode: 'reply',
  });
}

export function lineDeliveryMessages<T>(row: LineDelivery): T[] {
  const decoded = decryptPii(row.payload_enc);
  if (!decoded) throw new Error('LINE delivery payload unavailable');
  const messages = JSON.parse(decoded);
  if (!Array.isArray(messages) || !messages.length) throw new Error('Invalid LINE delivery payload');
  return messages as T[];
}

export async function leaseLineDelivery(eventId: string, userId: string): Promise<LineDelivery | null> {
  const query = identity(eventId, userId);
  const now = new Date();
  query.set('expires_at', `gt.${now.toISOString()}`);
  const stale = new Date(now.getTime() - CUSTOMER_TURN_HARD_DEADLINE_MS - 1000).toISOString();
  query.set('or', `(status.eq.pending,and(status.eq.sending,leased_at.lt.${stale}))`);
  return (await store(query, 'PATCH', {
    status: 'sending', lease_id: randomUUID(), leased_at: now.toISOString(),
  }))[0] ?? null;
}

export async function updateLineDelivery(row: LineDelivery, userId: string, patch: Partial<Pick<LineDelivery, 'status' | 'mode'>>): Promise<void> {
  const query = identity(row.event_id, userId);
  query.set('lease_id', `eq.${row.lease_id}`);
  if (!(await store(query, 'PATCH', patch)).length) throw new Error('LINE delivery lease lost');
}
