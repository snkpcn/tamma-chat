/**
 * WW-0 Foundation Lock
 *
 * This module is intentionally side-effect free. It defines the worldwide
 * rollout contract without changing any domestic production behavior.
 *
 * Rules:
 * - Thailand remains the production baseline.
 * - The worldwide master switch defaults OFF.
 * - Every capability has its own switch and also requires the master switch.
 * - Importing this module must never enable a capability by itself.
 */

export const WW0_FOUNDATION_VERSION = 'ww0-foundation-lock-2026-10-03';

export const DOMESTIC_COMMERCE_BASELINE = Object.freeze({
  countryCode: 'TH',
  currencyCode: 'THB',
} as const);

export const WORLDWIDE_MASTER_ENV = 'TAMMA_WW_ENABLED' as const;

export const WORLDWIDE_CAPABILITY_ENV = Object.freeze({
  dataCore: 'TAMMA_WW_DATA_CORE_ENABLED',
  addressV2: 'TAMMA_WW_ADDRESS_V2_ENABLED',
  storefront: 'TAMMA_WW_STOREFRONT_ENABLED',
  multiCurrency: 'TAMMA_WW_MULTI_CURRENCY_ENABLED',
  globalPayments: 'TAMMA_WW_GLOBAL_PAYMENTS_ENABLED',
  globalShipping: 'TAMMA_WW_GLOBAL_SHIPPING_ENABLED',
  customs: 'TAMMA_WW_CUSTOMS_ENABLED',
  checkout: 'TAMMA_WW_CHECKOUT_ENABLED',
  fulfillment: 'TAMMA_WW_FULFILLMENT_ENABLED',
  thongthaiWorldwide: 'TAMMA_WW_THONGTHAI_ENABLED',
} as const);

export type WorldwideCapability = keyof typeof WORLDWIDE_CAPABILITY_ENV;
export type WorldwideEnv = Readonly<Record<string, string | undefined>>;

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes']);

function netlifyEnvValue(name: string): string | undefined {
  const runtime = (globalThis as typeof globalThis & {
    Netlify?: { env?: { get?: (key: string) => unknown } };
  }).Netlify?.env;
  const value = runtime?.get?.(name);
  return typeof value === 'string' ? value : undefined;
}

export function runtimeWorldwideEnv(): WorldwideEnv {
  const names = [
    WORLDWIDE_MASTER_ENV,
    ...Object.values(WORLDWIDE_CAPABILITY_ENV),
  ];
  return Object.fromEntries(names.map(name => [name, netlifyEnvValue(name)]));
}

export function explicitFeatureFlag(value: unknown): boolean {
  return typeof value === 'string' && TRUE_VALUES.has(value.trim().toLowerCase());
}

export function isWorldwideMasterEnabled(env: WorldwideEnv = runtimeWorldwideEnv()): boolean {
  return explicitFeatureFlag(env[WORLDWIDE_MASTER_ENV]);
}

export function isWorldwideCapabilityEnabled(
  capability: WorldwideCapability,
  env: WorldwideEnv = runtimeWorldwideEnv(),
): boolean {
  if (!isWorldwideMasterEnabled(env)) return false;
  return explicitFeatureFlag(env[WORLDWIDE_CAPABILITY_ENV[capability]]);
}

export function worldwideFeatureSnapshot(env: WorldwideEnv = runtimeWorldwideEnv()) {
  const master = isWorldwideMasterEnabled(env);
  const capabilities = Object.fromEntries(
    (Object.keys(WORLDWIDE_CAPABILITY_ENV) as WorldwideCapability[])
      .map(capability => [capability, isWorldwideCapabilityEnabled(capability, env)]),
  ) as Record<WorldwideCapability, boolean>;

  return {
    version: WW0_FOUNDATION_VERSION,
    master,
    domesticBaseline: DOMESTIC_COMMERCE_BASELINE,
    capabilities,
    anyWorldwideExposure: master && Object.values(capabilities).some(Boolean),
  };
}
