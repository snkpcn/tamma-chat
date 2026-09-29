// Canonical OpenAI pricing and hard-budget policy for customer production.
// No other module may contain model-rate or conversation-cap arithmetic.
//
// Owner production directive: OpenAI spend is a HARD <= 5 THB limit per
// customer AI-cost ledger session/conversation. The pre-call reservation
// guard in _ai-cost-ledger.ts uses maxConversationCostUsd before every paid
// request, so a call whose conservative worst-case reservation could cross
// this ceiling is blocked before the OpenAI network request is made.
//
// The canonical business limit is stored in THB. The USD value is derived
// using the same reporting FX rate so changing THONGTHAI_USD_TO_THB_RATE
// cannot accidentally make the customer-facing THB ceiling looser.
export const DEFAULT_MAX_CONVERSATION_AI_COST_THB = 5;
export const DEFAULT_MAX_CONVERSATION_AI_COST_USD =
  DEFAULT_MAX_CONVERSATION_AI_COST_THB / 36;
export const DEFAULT_MAX_AI_CALLS_PER_TURN = 3;
export const DEFAULT_MAX_AI_CALLS_PER_CONVERSATION = 2_000;
export const DEFAULT_SEMANTIC_MAX_OUTPUT_TOKENS = 900;
// Raised alongside the shared Thongthai human-service voice contract and
// the reference-resolution rules added to the semantic-interpreter prompt
// (see _thongthai-service-voice.ts) -- an owner-required persona block plus
// comprehension rules, not prompt bloat. Real measured sizes: ~3.7k
// (normal), ~5.5k (complex); these targets keep ~10-13% headroom above
// that, well inside the real enforced ceiling (ABSOLUTE_SEMANTIC_INPUT_TOKENS).
export const DEFAULT_NORMAL_SEMANTIC_INPUT_TOKENS = 4_200;
export const DEFAULT_COMPLEX_SEMANTIC_INPUT_TOKENS = 6_200;
// Grounded response composition (_response-composer.ts) prompts carry the
// full Bible voice contract plus authoritative facts -- structurally larger
// than a semantic-interpretation prompt. Raised well past the ~26-token
// headroom the pre-experiment ceiling left on production's own "complex"
// scenario (see PR #227's investigation), so a real facts+voice+context
// payload is never blocked by prompt size when cost is no longer the
// limiting concern this phase.
export const ABSOLUTE_SEMANTIC_INPUT_TOKENS = 16_000;
// THB conversion is used by both telemetry and the canonical 5 THB hard cap.
export const DEFAULT_USD_TO_THB_RATE = 36;

export type ModelPricing = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type AiUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type AiCostPolicy = {
  maxConversationCostUsd: number;
  maxCallsPerTurn: number;
  maxCallsPerConversation: number;
  semanticMaxOutputTokens: number;
  absoluteInputTokens: number;
  conversationIdleMs: number;
};

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Centrally updateable conservative defaults. Environment overrides are
  // supported below so pricing can be changed without code changes.
  'gpt-5.6-terra': {
    inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.2,
    outputUsdPerMillion: 12,
  },
  'gpt-5.6-sol': {
    inputUsdPerMillion: 4,
    cachedInputUsdPerMillion: 0.4,
    outputUsdPerMillion: 20,
  },
};

// Unknown production models fail closed: these deliberately conservative rates
// make one worst-case guarded request exceed the conversation ceiling. A new
// production model must first be added here with reviewed pricing rather than
// silently inheriting a cheap guess.
const UNKNOWN_MODEL_PRICING: ModelPricing = {
  inputUsdPerMillion: 100,
  cachedInputUsdPerMillion: 100,
  outputUsdPerMillion: 500,
};

function finiteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function conservativeRate(value: string | undefined, fallback: number): number {
  // Environment configuration may raise a known rate immediately if OpenAI
  // pricing increases, but it may not lower the baked-in reviewed rate. A
  // lower vendor price is safe to overestimate until the canonical table is
  // deliberately updated in code.
  return Math.max(finiteNumber(value, fallback), fallback);
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function modelEnvKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function pricingForModel(model: string): ModelPricing {
  const defaults = DEFAULT_PRICING[model] ?? UNKNOWN_MODEL_PRICING;
  const key = modelEnvKey(model);
  return {
    inputUsdPerMillion: conservativeRate(
      process.env[`THONGTHAI_AI_PRICE_${key}_INPUT_PER_MILLION`],
      defaults.inputUsdPerMillion,
    ),
    cachedInputUsdPerMillion: conservativeRate(
      process.env[`THONGTHAI_AI_PRICE_${key}_CACHED_INPUT_PER_MILLION`],
      defaults.cachedInputUsdPerMillion,
    ),
    outputUsdPerMillion: conservativeRate(
      process.env[`THONGTHAI_AI_PRICE_${key}_OUTPUT_PER_MILLION`],
      defaults.outputUsdPerMillion,
    ),
  };
}

export function aiCostPolicy(): AiCostPolicy {
  const reviewedUsdCap = DEFAULT_MAX_CONVERSATION_AI_COST_THB / usdToThbRate();
  return {
    // Owner hard cap: environment may make production stricter, but can never
    // raise the effective limit above 5 THB at the active reporting FX rate.
    maxConversationCostUsd: Math.min(
      finiteNumber(
        process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD,
        reviewedUsdCap,
      ),
      reviewedUsdCap,
    ),
    maxCallsPerTurn: boundedInteger(
      process.env.THONGTHAI_MAX_AI_CALLS_PER_TURN,
      DEFAULT_MAX_AI_CALLS_PER_TURN,
      0,
      DEFAULT_MAX_AI_CALLS_PER_TURN,
    ),
    maxCallsPerConversation: boundedInteger(
      process.env.THONGTHAI_MAX_AI_CALLS_PER_CONVERSATION,
      DEFAULT_MAX_AI_CALLS_PER_CONVERSATION,
      0,
      DEFAULT_MAX_AI_CALLS_PER_CONVERSATION,
    ),
    semanticMaxOutputTokens: boundedInteger(
      process.env.THONGTHAI_SEMANTIC_MAX_OUTPUT_TOKENS,
      DEFAULT_SEMANTIC_MAX_OUTPUT_TOKENS,
      64,
      DEFAULT_SEMANTIC_MAX_OUTPUT_TOKENS,
    ),
    absoluteInputTokens: boundedInteger(
      process.env.THONGTHAI_MAX_SEMANTIC_INPUT_TOKENS,
      ABSOLUTE_SEMANTIC_INPUT_TOKENS,
      500,
      ABSOLUTE_SEMANTIC_INPUT_TOKENS,
    ),
    conversationIdleMs: boundedInteger(
      process.env.THONGTHAI_AI_CONVERSATION_IDLE_MS,
      30 * 60 * 1000,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000,
    ),
  };
}

export function estimateInputTokens(parts: readonly string[]): number {
  // UTF-8 bytes / 3 is deliberately conservative for Thai while still
  // stable and network-free. Add fixed Responses/JSON-schema framing overhead.
  const bytes = parts.reduce((sum, part) => sum + Buffer.byteLength(part, 'utf8'), 0);
  return Math.max(1, Math.ceil(bytes / 3) + 256);
}

export function calculateAiCostUsd(
  model: string,
  usage: AiUsage,
  pricing: ModelPricing = pricingForModel(model),
): number {
  const inputTokens = Math.max(0, Math.floor(usage.inputTokens));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.floor(usage.cachedInputTokens)));
  const outputTokens = Math.max(0, Math.floor(usage.outputTokens));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return (
    uncachedInputTokens * pricing.inputUsdPerMillion
    + cachedInputTokens * pricing.cachedInputUsdPerMillion
    + outputTokens * pricing.outputUsdPerMillion
  ) / 1_000_000;
}

export function reserveWorstCaseCostUsd(
  model: string,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): number {
  return calculateAiCostUsd(model, {
    inputTokens: Math.max(0, Math.ceil(estimatedInputTokens)),
    cachedInputTokens: 0,
    outputTokens: Math.max(0, Math.ceil(maxOutputTokens)),
  });
}

export function roundUsd(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000_000) / 1_000_000_000;
}

export function usdToThbRate(): number {
  const configured = finiteNumber(process.env.THONGTHAI_USD_TO_THB_RATE, DEFAULT_USD_TO_THB_RATE);
  return configured > 0 ? configured : DEFAULT_USD_TO_THB_RATE;
}

export function usdToThb(usd: number): number {
  return Math.round(Math.max(0, usd) * usdToThbRate() * 10_000) / 10_000;
}
