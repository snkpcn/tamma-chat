import { normalizeThaiPhone } from './_member-delivery';
import { normalizeCountryCode } from './_worldwide-data-core';

export const WW2_ADDRESS_VERSION = 2 as const;

export type InternationalAddressInput = {
  addressVersion: typeof WW2_ADDRESS_VERSION;
  countryCode: string;
  label: string;
  recipientName: string;
  phone: string;
  organization: string | null;
  addressLine1: string;
  addressLine2: string | null;
  dependentLocality: string | null;
  locality: string;
  administrativeArea: string | null;
  postalCode: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function wantsInternationalAddressV2(value: unknown): boolean {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const countryCode = normalizeCountryCode(input.countryCode);
  return input.addressVersion === WW2_ADDRESS_VERSION || (countryCode !== null && countryCode !== 'TH');
}

export function normalizeE164Phone(value: unknown, countryCode: string): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  if (countryCode === 'TH') {
    const thai = normalizeThaiPhone(raw);
    if (thai) return `+66${thai.slice(1)}`;
  }

  const compact = raw.replace(/[\s().-]/g, '');
  return /^\+[1-9][0-9]{7,14}$/.test(compact) ? compact : null;
}

export function normalizeInternationalAddress(value: unknown): InternationalAddressInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const countryCode = normalizeCountryCode(input.countryCode);
  const label = text(input.label, 60) ?? 'Shipping address';
  const recipientName = text(input.recipientName, 120);
  const addressLine1 = text(input.addressLine1, 240);
  const locality = text(input.locality ?? input.city, 120);
  const phone = countryCode ? normalizeE164Phone(input.phone, countryCode) : null;

  if (!countryCode) throw new Error('invalid_country_code');
  if (!recipientName) throw new Error('recipient_name_required');
  if (!phone) throw new Error('invalid_international_phone');
  if (!addressLine1) throw new Error('address_line_required');
  if (!locality) throw new Error('locality_required');

  return {
    addressVersion: WW2_ADDRESS_VERSION,
    countryCode,
    label,
    recipientName,
    phone,
    organization: text(input.organization, 160),
    addressLine1,
    addressLine2: text(input.addressLine2, 240),
    dependentLocality: text(input.dependentLocality, 120),
    locality,
    administrativeArea: text(input.administrativeArea, 120),
    postalCode: text(input.postalCode, 32),
    deliveryInstructions: text(input.deliveryInstructions, 300),
    isDefault: input.isDefault === true,
  };
}

export function internationalAddressSnapshot(address: InternationalAddressInput): string {
  return [
    address.organization,
    address.addressLine1,
    address.addressLine2,
    address.dependentLocality,
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.countryCode,
    address.deliveryInstructions ? `Delivery note: ${address.deliveryInstructions}` : null,
  ].filter(Boolean).join(', ');
}
