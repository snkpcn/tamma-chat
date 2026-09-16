import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Operations database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

function hash(value: string): string {
  return piiHash(value) || createHash('sha256').update(value).digest('hex');
}

export async function hasPendingLineFuelSession(targetId: string, userId?: string | null): Promise<boolean> {
  const c = dbConfig();
  const sender = userId || `ops-group:${targetId}`;
  const path = `activity_line_fuel_sessions?target_id_hash=eq.${encodeURIComponent(hash(targetId))}`
    + `&sender_id_hash=eq.${encodeURIComponent(hash(sender))}`
    + `&status=eq.pending_receipt&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id&limit=1`;
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Fuel session lookup failed ${response.status}`);
  const rows = await response.json() as Array<{ id: string }>;
  return Boolean(rows[0]?.id);
}
