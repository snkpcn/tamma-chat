/** A claimed total already paid is a reconciliation signal, not another payment. */
export function parseOwnerReportedPaidTotal(rawText: string): number | null {
  const text = rawText.trim()
    .replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
    .replace(/\s+/g, ' ');
  const match = text.match(/^(?:@?ทองไทย[\s,:：]*)?(?:(?:ยอด|รวม)\s*)?(?:จ่ายไปแล้ว|จ่ายแล้ว|จ่ายทั้งหมดแล้ว)\s*(?:ประมาณ\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:บาท)?\s*(?:ครับ|ค่ะ|คับ)?$/u);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000000 ? amount : null;
}
