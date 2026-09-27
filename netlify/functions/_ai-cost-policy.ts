// Canonical OpenAI pricing and hard-budget policy for customer production.
// No other module may contain model-rate or conversation-cap arithmetic.

export const DEFAULT_MAX_CONVERSATION_AI_COST_USD = 0.05;
export const DEFAULT_MAX_AI_CALLS_PER_TURN = 1;
export const DEFAULT_MAX_AI_CALLS_PER_CONVERSATION = 6;
export const DEFAULT_SEMANTIC_MAX_OUTPUT_TOKENS = 400;
export const DEFAULT_NORMAL_SEMANTIC_INPUT_TOKENS = 2_500;
export const DEFAULT_COMPLEX_SEMANTIC_INPUT_TOKENS = 4_000;
export const ABSOLUTE_SEMANTIC_INPUT_TOKENS = 5_000;

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
  return {
    // Owner hard caps are one-way configurable: environment values may make
    // production stricter, never more expensive than the reviewed ceiling.
    maxConversationCostUsd: Math.min(
      finiteNumber(
        process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD,
        DEFAULT_MAX_CONVERSATION_AI_COST_USD,
      ),
      DEFAULT_MAX_CONVERSATION_AI_COST_USD,
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
      500,
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
