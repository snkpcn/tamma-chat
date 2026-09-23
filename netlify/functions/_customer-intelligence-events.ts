// Master Roadmap Phase 2 -- Customer Intelligence Memory: aggregate
// (cross-guest) phrase/demand/risk signal log, for a future owner
// dashboard insight ("top repeated phrases", "common allergy mentions",
// "common mobility concerns"). This is DELIBERATELY a separate,
// additive table from guest_memory -- guest_memory is guest_id-scoped
// (one row per key, per guest, upserted -- correct for "what does THIS
// guest prefer"), which cannot represent "how many DIFFERENT guests
// said this phrase" without a schema change to every existing row.
// customer_intelligence_events is a plain append-only log (same
// design philosophy as the existing guest_events table): counting
// happens at QUERY time (a future dashboard groups by category), never
// by maintaining a running counter column here.
//
// Storage: supabase/migrations/<timestamp>_customer_intelligence_events_v1.sql
// -- NOT APPLIED, prepared for owner review only, same discipline as
// ops_feedback_events's own migration before it was applied. Until it's
// applied, every write here fails gracefully (caught below) -- nothing
// customer-facing ever depends on this table existing; preference
// memory (guest_memory, via _customer-db.ts) is the ONLY memory this
// round's customer-facing personalization actually reads.
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

/** Never the full raw message -- a short, truncated snippet only, per
 *  the roadmap's own privacy rule ("if examples are needed, store
 *  short redacted snippets only"). Capped well below any real message
 *  length, and never includes anything beyond the plain text itself
 *  (no PII fields exist to strip here -- this module never receives a
 *  phone/name/address, only the message text). */
function redactExample(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export async function recordIntelligenceEvent(input: {
  eventType: 'phrase' | 'demand' | 'risk';
  category: string;
  domain: string;
  guestDbId: string | null;
  message: string;
}): Promise<void> {
  try {
    await dbFetch('customer_intelligence_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        event_type: input.eventType,
        category: input.category,
        domain: input.domain,
        guest_id: input.guestDbId,
        redacted_example: redactExample(input.message),
      }),
    });
  } catch (error) {
    console.error('THONGTHAI_INTELLIGENCE_EVENT_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}
