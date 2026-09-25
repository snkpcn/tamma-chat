import { createHash } from 'node:crypto';

// Phase 2.7 -- aggregate (cross-guest) customer intelligence event log.
//
// This is intentionally separate from guest_memory:
// - guest_memory answers "what should Thongthai remember about THIS guest?"
// - customer_intelligence_events answers "what patterns are customers showing
//   across many turns/guests?"
//
// Writes are best-effort and never customer-path critical. The table is
// service-role only and append-only from the application's point of view.
//
// IMPORTANT:
// A LINE/core retry can execute this module more than once for the SAME
// transport message. Counts must therefore be idempotent on a one-way
// source_event_key. Never persist the raw LINE/web transport event id.
function dbConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = dbConfig();
  if (!config) throw new Error('Customer intelligence events database is not configured');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`customer_intelligence_events request failed ${response.status}: ${body.slice(0, 200)}`);
  }
  return response;
}

function sourceEventKey(channel: string, sourceEventId: string): string {
  return createHash('sha256')
    .update(`${channel.trim().toLowerCase()}:${sourceEventId.trim()}`, 'utf8')
    .digest('hex');
}

/**
 * Keep only a short example and redact common direct identifiers before it
 * ever reaches storage. This is deliberately conservative: aggregate
 * intelligence needs customer wording patterns, not contact details.
 *
 * This is NOT presented as perfect NER. It removes the common direct
 * identifiers we can deterministically recognize (URL/email/phone/@handle)
 * and then hard-caps the result to 80 characters. Phase 3 should prefer the
 * normalized category/domain fields for dashboards and surface snippets only
 * when genuinely useful.
 */
export function redactIntelligenceExample(message: string): string {
  return message
    .trim()
    .replace(/https?:\/\/\S+|www\.\S+/giu, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/(?:\+?66|0)[\s.-]?[1-9](?:[\s.-]?\d){7,9}/gu, '[phone]')
    .replace(/(^|\s)@[A-Za-z0-9._-]{2,}/gu, '$1[handle]')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export async function recordIntelligenceEvent(input: {
  eventType: 'phrase' | 'demand' | 'risk';
  category: string;
  domain: string;
  guestDbId: string | null;
  message: string;
  channel: 'web' | 'line' | 'other';
  sourceEventId: string;
}): Promise<void> {
  try {
    const key = sourceEventKey(input.channel, input.sourceEventId);
    await dbFetch(
      'customer_intelligence_events'
      + '?on_conflict=source_event_key,event_type,category,domain',
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          event_type: input.eventType,
          category: input.category,
          domain: input.domain,
          guest_id: input.guestDbId,
          channel: input.channel,
          source_event_key: key,
          redacted_example: redactIntelligenceExample(input.message),
        }),
      },
    );
  } catch (error) {
    console.error(
      'THONGTHAI_INTELLIGENCE_EVENT_ERROR',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
  }
}
