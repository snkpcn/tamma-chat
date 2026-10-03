import { normalizeCurrencyCode } from './_worldwide-data-core';

export const WW4_MULTI_CURRENCY_VERSION = 'ww4-multi-currency-2026-10-03';

export type PriceSource = 'domestic_base' | 'manual' | 'fx_assisted';

export type ExplicitProductPrice = {
  id: string;
  productId: string;
  currencyCode: string;
  amountMinor: bigint;
  minorUnit: number;
  priceSource: PriceSource;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
};

export type PriceResolution =
  | { kind: 'ready'; price: ExplicitProductPrice }
  | { kind: 'not_available'; reason: 'invalid_currency' | 'price_not_configured' | 'price_not_current' }
  | { kind: 'invalid'; reason: 'ambiguous_active_price' };

function integer(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  } catch {}
  return null;
}

export function normalizeMinorUnit(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : null;
}

export function parseDecimalToMinor(value: unknown, minorUnit: number): bigint {
  const unit = normalizeMinorUnit(minorUnit);
  if (unit === null) throw new Error('invalid_minor_unit');
  const raw = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : '')
    : typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error('invalid_decimal_amount');
  const fraction = match[2] ?? '';
  if (fraction.length > unit && /[1-9]/.test(fraction.slice(unit))) {
    throw new Error('amount_exceeds_currency_precision');
  }
  const normalizedFraction = fraction.slice(0, unit).padEnd(unit, '0');
  const factor = 10n ** BigInt(unit);
  return BigInt(match[1]) * factor + BigInt(normalizedFraction || '0');
}

export function formatMinorAmount(value: bigint | number | string, minorUnit: number): string {
  const unit = normalizeMinorUnit(minorUnit);
  const minor = integer(value);
  if (unit === null) throw new Error('invalid_minor_unit');
  if (minor === null || minor < 0n) throw new Error('invalid_minor_amount');
  if (unit === 0) return minor.toString();
  const factor = 10n ** BigInt(unit);
  const major = minor / factor;
  const fraction = (minor % factor).toString().padStart(unit, '0');
  return `${major}.${fraction}`;
}

function decimalRateFraction(value: unknown): { numerator: bigint; denominator: bigint } {
  const raw = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : '')
    : typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d+)(?:\.(\d{1,12}))?$/);
  if (!match) throw new Error('invalid_fx_rate');
  const fraction = match[2] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * denominator + BigInt(fraction || '0');
  if (numerator <= 0n) throw new Error('invalid_fx_rate');
  return { numerator, denominator };
}

/**
 * Backoffice/reference helper only.
 *
 * This can suggest a target minor-unit amount from a quoted FX rate.
 * The result is NEVER a transaction price by itself. A final explicit
 * commerce_product_prices row must be written before checkout can use it.
 */
export function referenceFxConversion(input: {
  sourceAmountMinor: bigint | number | string;
  sourceMinorUnit: number;
  targetMinorUnit: number;
  rate: string | number;
}): bigint {
  const source = integer(input.sourceAmountMinor);
  const sourceUnit = normalizeMinorUnit(input.sourceMinorUnit);
  const targetUnit = normalizeMinorUnit(input.targetMinorUnit);
  if (source === null || source < 0n) throw new Error('invalid_minor_amount');
  if (sourceUnit === null || targetUnit === null) throw new Error('invalid_minor_unit');
  const { numerator, denominator } = decimalRateFraction(input.rate);
  const scaledNumerator = source * numerator * (10n ** BigInt(targetUnit));
  const scaledDenominator = denominator * (10n ** BigInt(sourceUnit));
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  return remainder * 2n >= scaledDenominator ? quotient + 1n : quotient;
}

export function resolveExplicitProductPrice(
  requestedCurrency: unknown,
  rows: ExplicitProductPrice[],
  now = new Date(),
): PriceResolution {
  const currencyCode = normalizeCurrencyCode(requestedCurrency);
  if (!currencyCode) return { kind: 'not_available', reason: 'invalid_currency' };
  const currencyRows = rows.filter(row => row.currencyCode === currencyCode && row.active);
  if (!currencyRows.length) return { kind: 'not_available', reason: 'price_not_configured' };
  const current = currencyRows.filter(row => {
    const from = Date.parse(row.validFrom);
    const until = row.validUntil ? Date.parse(row.validUntil) : Number.POSITIVE_INFINITY;
    return Number.isFinite(from) && from <= now.getTime() && until > now.getTime();
  });
  if (!current.length) return { kind: 'not_available', reason: 'price_not_current' };
  if (current.length !== 1) return { kind: 'invalid', reason: 'ambiguous_active_price' };
  return { kind: 'ready', price: current[0]! };
}
