// Shared direct-identifier redaction for customer-derived operational text.
//
// This intentionally targets deterministic direct identifiers that should
// never be copied into aggregate/customer-voice surfaces by default.
// It is NOT a general-purpose NER or de-identification system.
export function redactDirectIdentifiers(input: string, maxLength?: number): string {
  const redacted = String(input ?? '')
    .trim()
    .replace(/https?:\/\/\S+|www\.\S+/giu, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replace(/(?:\+?66|0)[\s.-]?[1-9](?:[\s.-]?\d){7,9}/gu, '[phone]')
    .replace(/(^|\s)@[A-Za-z0-9._-]{2,}/gu, '$1[handle]')
    .replace(/\s+/g, ' ');

  return typeof maxLength === 'number' && maxLength >= 0
    ? redacted.slice(0, maxLength)
    : redacted;
}
