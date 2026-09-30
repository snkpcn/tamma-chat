export type MemberAddressInput = {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  subdistrict: string | null;
  district: string;
  province: string;
  postalCode: string;
  deliveryInstructions: string | null;
  isDefault: boolean;
};

export type ShippingSettings = {
  enabled: boolean;
  domesticBaseFee: number;
  freeShippingThreshold: number | null;
  estimatedMinDays: number;
  estimatedMaxDays: number;
};

export type ShippingStatus =
  | 'awaiting_payment'
  | 'packing'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'
  | 'delivery_failed'
  | 'returned'
  | 'cancelled';

const SHIPPING_STATUSES = new Set<ShippingStatus>([
  'awaiting_payment', 'packing', 'ready_to_ship', 'shipped',
  'delivered', 'delivery_failed', 'returned', 'cancelled',
]);

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function normalizeThaiPhone(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  let digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+66')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  digits = digits.replace(/\D/g, '');
  return /^0[1-9][0-9]{8}$/.test(digits) ? digits : null;
}

export function normalizeMemberAddress(value: unknown): MemberAddressInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const label = text(input.label, 60) ?? 'ที่อยู่จัดส่ง';
  const recipientName = text(input.recipientName, 120);
  const phone = normalizeThaiPhone(input.phone);
  const addressLine1 = text(input.addressLine1, 240);
  const district = text(input.district, 120);
  const province = text(input.province, 80);
  const postalCode = typeof input.postalCode === 'string' ? input.postalCode.replace(/\D/g, '') : '';

  if (!recipientName) throw new Error('recipient_name_required');
  if (!phone) throw new Error('invalid_phone');
  if (!addressLine1) throw new Error('address_line_required');
  if (!district) throw new Error('district_required');
  if (!province) throw new Error('province_required');
  if (!/^\d{5}$/.test(postalCode)) throw new Error('invalid_postal_code');

  return {
    label,
    recipientName,
    phone,
    addressLine1,
    addressLine2: text(input.addressLine2, 240),
    subdistrict: text(input.subdistrict, 120),
    district,
    province,
    postalCode,
    deliveryInstructions: text(input.deliveryInstructions, 300),
    isDefault: input.isDefault === true,
  };
}

export function addressSnapshot(address: MemberAddressInput): string {
  return [
    address.addressLine1,
    address.addressLine2,
    address.subdistrict ? `ต./แขวง ${address.subdistrict}` : null,
    `อ./เขต ${address.district}`,
    `จ. ${address.province}`,
    address.postalCode,
    address.deliveryInstructions ? `หมายเหตุ: ${address.deliveryInstructions}` : null,
  ].filter(Boolean).join(' ');
}

export function calculateShippingQuote(subtotal: number, settings: ShippingSettings) {
  if (!settings.enabled) throw new Error('shipping_temporarily_unavailable');
  if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error('invalid_subtotal');
  const free = settings.freeShippingThreshold !== null && subtotal >= settings.freeShippingThreshold;
  const fee = free ? 0 : Math.max(0, settings.domesticBaseFee);
  return {
    subtotal,
    shippingFee: fee,
    total: subtotal + fee,
    freeShipping: free,
    estimatedMinDays: settings.estimatedMinDays,
    estimatedMaxDays: settings.estimatedMaxDays,
  };
}

export function isShippingStatus(value: unknown): value is ShippingStatus {
  return typeof value === 'string' && SHIPPING_STATUSES.has(value as ShippingStatus);
}

export function shippingStatusLabel(value: unknown): string {
  const labels: Record<ShippingStatus, string> = {
    awaiting_payment: 'รอตรวจสอบการชำระเงิน',
    packing: 'กำลังเตรียมสินค้า',
    ready_to_ship: 'พร้อมส่ง',
    shipped: 'ส่งแล้ว',
    delivered: 'จัดส่งสำเร็จ',
    delivery_failed: 'นำจ่ายไม่สำเร็จ',
    returned: 'พัสดุตีกลับ',
    cancelled: 'ยกเลิกการจัดส่ง',
  };
  return isShippingStatus(value) ? labels[value] : '-';
}

export function safeTrackingUrl(value: unknown): string | null {
  const candidate = text(value, 500);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
