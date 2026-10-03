export const WW5_GLOBAL_PAYMENT_VERSION = 'ww5-global-payment-core-2026-10-03';

export type PaymentProviderStatus = 'draft' | 'certification' | 'live' | 'suspended';
export type PaymentExecutionMode = 'legacy_v1' | 'global_v2';
export type GlobalPaymentIntentStatus =
  | 'created'
  | 'requires_action'
  | 'processing'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded';

export type GlobalPaymentProvider = {
  providerCode: string;
  adapterKey: string;
  status: PaymentProviderStatus;
  active: boolean;
};

export type GlobalMarketPaymentMethod = {
  marketCode: string;
  providerCode: string;
  currencyCode: string;
  paymentMethodCode: string;
  executionMode: PaymentExecutionMode;
  status: PaymentProviderStatus;
  enabled: boolean;
  priority: number;
};

export type GlobalPaymentIntentEvidence = {
  marketCode: string;
  currencyCode: string;
  amountMinor: bigint;
  capturedAmountMinor: bigint;
  refundedAmountMinor: bigint;
  providerCode: string;
  paymentMethodCode: string;
  status: GlobalPaymentIntentStatus;
};

export type GlobalPaymentMoneySemantics = 'none' | 'intent_total' | 'refund_delta';

export type GlobalPaymentEventEvidence = {
  providerCode: string;
  currencyCode: string | null;
  amountMinor: bigint | null;
  moneySemantics: GlobalPaymentMoneySemantics;
  signatureVerified: boolean;
};

const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$/;

export function normalizePaymentCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

export function normalizePaymentCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_RE.test(code) ? code : null;
}

export function normalizePaymentIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return IDEMPOTENCY_RE.test(key) ? key : null;
}

const TRANSITIONS: Readonly<Record<GlobalPaymentIntentStatus, readonly GlobalPaymentIntentStatus[]>> = Object.freeze({
  created: ['requires_action','processing','authorized','captured','failed','cancelled'],
  requires_action: ['processing','authorized','captured','failed','cancelled'],
  processing: ['requires_action','authorized','captured','failed','cancelled'],
  authorized: ['captured','failed','cancelled'],
  captured: ['partially_refunded','refunded'],
  partially_refunded: ['partially_refunded','refunded'],
  failed: [],
  cancelled: [],
  refunded: [],
});

export function canTransitionGlobalPaymentIntent(
  from: GlobalPaymentIntentStatus,
  to: GlobalPaymentIntentStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertGlobalPaymentEventMatchesIntent(
  intent: GlobalPaymentIntentEvidence,
  event: GlobalPaymentEventEvidence,
): void {
  if (!event.signatureVerified) throw new Error('provider_event_signature_not_verified');
  if (event.providerCode !== intent.providerCode) throw new Error('provider_event_provider_mismatch');

  if (event.moneySemantics === 'none') {
    if (event.currencyCode !== null || event.amountMinor !== null) {
      throw new Error('provider_event_money_semantics_invalid');
    }
    return;
  }

  if (event.currencyCode !== intent.currencyCode) {
    throw new Error('provider_event_currency_mismatch');
  }
  if (event.amountMinor === null || event.amountMinor <= 0n) {
    throw new Error('provider_event_amount_missing');
  }

  if (event.moneySemantics === 'intent_total') {
    if (event.amountMinor !== intent.amountMinor) throw new Error('provider_event_amount_mismatch');
    return;
  }

  if (intent.capturedAmountMinor <= 0n) throw new Error('refund_before_capture');
  if (intent.refundedAmountMinor + event.amountMinor > intent.capturedAmountMinor) {
    throw new Error('refund_exceeds_capture');
  }
}

export type PaymentMethodResolution =
  | {
      kind:'ready';
      provider:GlobalPaymentProvider;
      method:GlobalMarketPaymentMethod;
    }
  | {
      kind:'not_available';
      reason:
        | 'payment_method_not_configured'
        | 'provider_not_live'
        | 'method_not_live'
        | 'legacy_execution_mode';
    }
  | {
      kind:'invalid';
      reason:'ambiguous_payment_method';
    };

export function resolveGlobalPaymentMethod(input:{
  marketCode:string;
  currencyCode:string;
  requestedMethod?:string | null;
  providers:GlobalPaymentProvider[];
  methods:GlobalMarketPaymentMethod[];
}):PaymentMethodResolution{
  const requestedMethod=input.requestedMethod ? normalizePaymentCode(input.requestedMethod) : null;
  const candidates=input.methods
    .filter(method =>
      method.marketCode===input.marketCode
      && method.currencyCode===input.currencyCode
      && method.enabled
      && (!requestedMethod || method.paymentMethodCode===requestedMethod)
    )
    .sort((a,b)=>a.priority-b.priority);

  if(!candidates.length)return {kind:'not_available',reason:'payment_method_not_configured'};
  const live=candidates.filter(method=>method.status==='live');
  if(!live.length)return {kind:'not_available',reason:'method_not_live'};

  const global=live.filter(method=>method.executionMode==='global_v2');
  if(!global.length)return {kind:'not_available',reason:'legacy_execution_mode'};

  const usable=global
    .map(method=>({
      method,
      provider:input.providers.find(provider=>provider.providerCode===method.providerCode),
    }))
    .filter((row):row is {method:GlobalMarketPaymentMethod;provider:GlobalPaymentProvider}=>
      !!row.provider && row.provider.active && row.provider.status==='live'
    );

  if(!usable.length)return {kind:'not_available',reason:'provider_not_live'};
  if(!requestedMethod && usable.length>1 && usable[0]!.method.priority===usable[1]!.method.priority){
    return {kind:'invalid',reason:'ambiguous_payment_method'};
  }
  return {kind:'ready',provider:usable[0]!.provider,method:usable[0]!.method};
}

export function isGlobalPaymentTerminal(status: GlobalPaymentIntentStatus): boolean {
  return status==='failed' || status==='cancelled' || status==='refunded';
}
