/** Normalize typography only. Never rewrite negation, names or intent. Keep
 * emoji joiners; invisible word separators can otherwise break Thai routing. */
export function normalizeCustomerText(message:string):string {
  return message.normalize('NFC')
    .replace(/[\u200B\u2060\uFEFF]/gu, '')
    .replace(/[๐-๙]/gu, digit => String(digit.charCodeAt(0)-0x0E50))
    .trim();
}
