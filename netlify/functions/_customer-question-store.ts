import { backendFetch } from './_backend-fetch';

export const CUSTOMER_QUESTION_MAX_CHARS = 4000;

/** Keep the customer's wording, but remove common contact details and secrets.
 * This is a redacted question history, not a complete transcript or PII store. */
export function redactCustomerQuestion(value: string): string {
  return value
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)\b/giu, '[secret]')
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/giu, 'Bearer [secret]')
    .replace(/((?:password|passwd|api[_ -]?key|access[_ -]?token|รหัสผ่าน|รหัสบัตร|เลขบัตร)\s*[:=]?\s*)\S+/giu, '$1[secret]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/(?:\+?66|0)[\d\s-]{8,13}/gu, '[phone]')
    .replace(/\d{6,}/gu, '[number]')
    .trim();
}

export async function persistCustomerQuestion(row: {
  conversationId: string | null; eventId: string; channel: string;
  message: string; environment?: 'live' | 'test';
}): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !row.eventId.trim()) return;
  const redacted = redactCustomerQuestion(row.message);
  const characters = [...redacted];
  if (!redacted) return;
  try {
    const response = await backendFetch(url.replace(/\/$/, '')
      + '/rest/v1/customer_question_history?on_conflict=channel,event_id,environment', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        // A transport retry must not duplicate a question or extend its retention.
        Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        conversation_id: row.conversationId?.slice(0, 180) || null,
        event_id: row.eventId.slice(0, 180), channel: row.channel.slice(0, 40),
        question_text: characters.slice(0, CUSTOMER_QUESTION_MAX_CHARS).join(''),
        text_truncated: characters.length > CUSTOMER_QUESTION_MAX_CHARS,
        environment: row.environment ?? 'live',
      }),
    }, 1000);
    if (!response.ok) console.error('CUSTOMER_QUESTION_PERSIST_ERROR', response.status);
  } catch {
    // History availability never changes the customer's answer; no text or key in logs.
    console.error('CUSTOMER_QUESTION_PERSIST_ERROR', 'unavailable');
  }
}

export async function pruneCustomerQuestions(now = new Date()): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const response = await backendFetch(url.replace(/\/$/, '')
      + '/rest/v1/customer_question_history?expires_at=lte.' + encodeURIComponent(now.toISOString()), {
      method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    });
    return response.ok;
  } catch { return false; }
}
