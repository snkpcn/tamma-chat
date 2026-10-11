import { createHmac, timingSafeEqual } from 'node:crypto';
import type { LineMessage } from './_ops-line-ui';

/** Stateless document intent only. This module does not create a payment draft or write data.
 * LINE postbacks: https://developers.line.biz/en/reference/messaging-api/#postback-action
 * Data is capped at 300 UTF-8 bytes (stricter than LINE's 300-character limit).
 */
const PREFIX = 'owner-doc:';
const LIFETIME_MS = 15 * 60 * 1000;
const ACTIONS = ['quotation', 'payment_evidence', 'other_document', 'outgoing_payment', 'incoming_funds'] as const;
export type OwnerDocumentActionName = typeof ACTIONS[number];
export type OwnerDocumentAction = { imageMessageId: string; action: OwnerDocumentActionName };
type DocumentChoiceInput = {
  targetId: string;
  userId: string;
  imageMessageId: string;
  step: 'kind' | 'direction';
  /** Unix milliseconds, matching Date.now(). */
  now?: number;
};
type DecodeInput = { data: unknown; targetId: string; userId: string; now?: number };
type SignedFields = [imageMessageId: string, action: OwnerDocumentActionName, issuedAt: number, expiresAt: number];

function secret(): string | null {
  const value = process.env.LINE_CHANNEL_SECRET;
  return value && value.trim() ? value : null;
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u0020\u007f-\u009f\ud800-\udfff]/u.test(value);
}

function validImageId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,64}$/.test(value);
}

function currentTimestamp(now: number | undefined): number | null {
  const value = now ?? Date.now();
  return Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - LIFETIME_MS ? value : null;
}

function signature(key: string, targetId: string, userId: string, fields: SignedFields): string {
  // Length-delimited JSON preserves both full identities without placing either in the payload.
  return createHmac('sha256', key).update(JSON.stringify(['owner-doc:v1', targetId, userId, ...fields]), 'utf8').digest('base64url');
}

function encode(input: DocumentChoiceInput, action: OwnerDocumentActionName, key: string, issuedAt: number): string {
  const fields: SignedFields = [input.imageMessageId, action, issuedAt, issuedAt + LIFETIME_MS];
  const data = PREFIX + JSON.stringify([...fields, signature(key, input.targetId, input.userId, fields)]);
  if (Buffer.byteLength(data, 'utf8') > 300) throw new RangeError('Document choice exceeds LINE postback limit');
  return data;
}

/** Verify identity binding, exact canonical serialization, action and lifetime before routing. */
export function decodeOwnerDocumentAction(input: DecodeInput): OwnerDocumentAction | null {
  const key = secret(), now = currentTimestamp(input.now), data = input.data;
  if (!key || now === null || !validIdentity(input.targetId) || !validIdentity(input.userId)) return null;
  if (typeof data !== 'string' || !data.startsWith(PREFIX) || Buffer.byteLength(data, 'utf8') > 300) return null;
  try {
    const parsed: unknown = JSON.parse(data.slice(PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [imageMessageId, action, issuedAt, expiresAt, receivedSignature] = parsed;
    if (!validImageId(imageMessageId) || !ACTIONS.includes(action)) return null;
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || Object.is(issuedAt, -0)
      || !Number.isSafeInteger(expiresAt) || expiresAt !== issuedAt + LIFETIME_MS) return null;
    if (now < issuedAt || now >= expiresAt) return null;
    if (typeof receivedSignature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receivedSignature)) return null;
    if (PREFIX + JSON.stringify(parsed) !== data) return null;
    const expected = signature(key, input.targetId, input.userId, [imageMessageId, action, issuedAt, expiresAt]);
    // Both buffers have the same validated length, so timingSafeEqual cannot throw on length.
    if (!timingSafeEqual(Buffer.from(receivedSignature, 'ascii'), Buffer.from(expected, 'ascii'))) return null;
    return { imageMessageId, action };
  } catch {
    return null;
  }
}

export function buildOwnerDocumentChoiceCard(input: DocumentChoiceInput): LineMessage {
  const key = secret(), issuedAt = currentTimestamp(input.now);
  if (!key) throw new Error('Document choice signing is not configured');
  if (issuedAt === null || !validIdentity(input.targetId) || !validIdentity(input.userId) || !validImageId(input.imageMessageId)) {
    throw new TypeError('Invalid document choice context');
  }
  if (input.step !== 'kind' && input.step !== 'direction') throw new TypeError('Invalid document choice step');
  const question = input.step === 'kind'
    ? 'รูปนี้เป็นเอกสารอะไรครับ?'
    : 'เงินในหลักฐานนี้เป็นเงินรับเข้าหรือจ่ายออกครับ?';
  const choices: Array<[label: string, action: OwnerDocumentActionName]> = input.step === 'kind'
    ? [['ใบเสนอราคา', 'quotation'], ['หลักฐานโอน', 'payment_evidence'], ['เอกสารอื่น', 'other_document']]
    : [['จ่ายออก', 'outgoing_payment'], ['รับเข้า', 'incoming_funds']];
  return {
    type: 'flex', altText: question,
    contents: {
      type: 'bubble', size: 'mega',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{ type: 'text', text: question, wrap: true, size: 'md', weight: 'bold', color: '#20352B' }],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: choices.map(([label, action]) => ({
          type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label, displayText: label, data: encode(input, action, key, issuedAt) },
        })),
      },
    },
  };
}
