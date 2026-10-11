import { piiHash } from './_operations-db';
import type { FinancialDocumentKind, FinancialFundsDirection, FinancialImageExtraction } from './_inthanin-daily-close-image';

export type OwnerExpenseImageIntent = 'payment_review' | 'document_help';
export type OwnerPaymentDocumentGate = {
  kind: 'non_payment' | 'needs_document_kind' | 'needs_funds_direction' | 'incoming_funds' | 'payment_evidence' | 'multiple_payment_evidence';
  documentKind: FinancialDocumentKind;
  paymentCount?: number;
};

export const OWNER_DOCUMENT_KIND_QUESTION = 'ต้องการให้ช่วยดูรูปนี้เป็นเอกสารประเภทไหนครับ: หลักฐานเงินออก หลักฐานเงินเข้า หรือใบเสนอราคา/สัญญา?';
export const OWNER_FUNDS_DIRECTION_QUESTION = 'หลักฐานนี้เป็นเงินออกของกิจการ หรือเงินเข้าจากผู้ลงทุน/ผู้โอนครับ?';
export const OWNER_NON_PAYMENT_REPLY = 'รูปนี้เป็นใบเสนอราคา สัญญา หรือเอกสารที่ยังไม่ยืนยันการชำระครับ จึงยังไม่สร้างรายการจ่าย';
export const OWNER_INCOMING_FUNDS_REPLY = 'หลักฐานนี้เป็นเงินเข้าครับ จึงยังไม่สร้างรายการรายจ่าย';
export const OWNER_MULTIPLE_PAYMENTS_REPLY = 'รูปนี้มีหลักฐานการจ่ายหลายรายการครับ กรุณาส่งแยกรูปละสลิปพร้อมโน้ต เพื่อจับคู่ยอดและงวดให้ถูกต้อง ยังไม่บันทึกรายจ่ายครับ';

/** Group membership, investor status and possession of a draft are not owner authorization. */
export function isAuthorizedOwnerPaymentActor(
  userId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (typeof userId !== 'string' || !userId.trim() || userId !== userId.trim()) return false;
  // Dedicated financial authority only; ops admins and group bindings grant no access.
  const owners = (env.OWNER_FINANCE_LINE_USER_HASHES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!owners.length || owners.some(hash => !/^[a-f0-9]{64}$/u.test(hash))) return false;
  const actorHash = piiHash(userId);
  return actorHash !== null && owners.includes(actorHash);
}

/**
 * Fail closed before capture. Payment metadata and owner direction are independent:
 * a quotation cannot be converted into payment evidence by choosing "outgoing".
 * The legacy exception is read compatibility only. New OCR normalization always supplies
 * both semantic fields, including explicit unknown, and cannot take that exception.
 */
export function ownerPaymentDocumentGate(
  extraction: FinancialImageExtraction,
  context: { fundsDirection?: Exclude<FinancialFundsDirection, 'unknown'> } = {},
): OwnerPaymentDocumentGate {
  if (!extraction || typeof extraction !== 'object') return { kind: 'needs_document_kind', documentKind: 'unknown' };
  const legacy = extraction.document_kind === undefined;
  const documentKind: FinancialDocumentKind = extraction.document_kind
    ?? (extraction.document_type === 'transfer_slip' ? 'transfer_evidence'
      : ['purchase_receipt','expense_receipt'].includes(extraction.document_type) ? 'paid_receipt' : 'unknown');
  if (['quotation','unpaid_invoice','contract'].includes(documentKind)) return { kind: 'non_payment', documentKind };
  const validPaymentKind = documentKind === 'transfer_evidence' && extraction.document_type === 'transfer_slip'
    || documentKind === 'paid_receipt' && ['purchase_receipt','expense_receipt'].includes(extraction.document_type);
  if (!validPaymentKind || (!legacy && (!Number.isFinite(extraction.confidence) || extraction.confidence < 0.8))
    || extraction.payment_document_count === 0) return { kind: 'needs_document_kind', documentKind: 'unknown' };
  const count = extraction.payment_document_count;
  if (Number.isSafeInteger(count) && count! > 1) return { kind: 'multiple_payment_evidence', documentKind, paymentCount: count! };
  // An explicit incoming extraction cannot be overwritten to outgoing by unrelated context.
  if (extraction.funds_direction === 'incoming' || context.fundsDirection === 'incoming') return { kind: 'incoming_funds', documentKind };
  if (extraction.funds_direction !== 'outgoing' && context.fundsDirection !== 'outgoing'
    && !(legacy && extraction.funds_direction === undefined)) return { kind: 'needs_funds_direction', documentKind };
  return { kind: 'payment_evidence', documentKind };
}

export function ownerPaymentDocumentClarification(gate: OwnerPaymentDocumentGate): string {
  switch (gate.kind) {
    case 'non_payment': return OWNER_NON_PAYMENT_REPLY;
    case 'needs_document_kind': return OWNER_DOCUMENT_KIND_QUESTION;
    case 'needs_funds_direction': return OWNER_FUNDS_DIRECTION_QUESTION;
    case 'incoming_funds': return OWNER_INCOMING_FUNDS_REPLY;
    case 'multiple_payment_evidence': return OWNER_MULTIPLE_PAYMENTS_REPLY;
    case 'payment_evidence': return 'พบหลักฐานการชำระครับ ต้องการให้ตรวจรายการจ่ายจากรูปนี้ไหมครับ?';
  }
}
