import type { BrainChannel } from './_thongthai-brain-v3';
import { buildRealKnowledgeSourceAdapters } from './_dialog-source-adapters';
import { resolveKnowledge, type GroundedFact, type KnowledgeNeed, type KnowledgeRequest } from './_knowledge-resolver';
import type { SemanticDomain } from './_semantic-interpreter';
import { THONGTHAI_STAGING_TRANSACTION_TOOLS, executeThongthaiTransactionTool, type ThongthaiAgentTransactionMode } from './_thongthai-agent-transactions';

export type ThongthaiAgentFunctionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const THONGTHAI_READ_ONLY_TOOLS: readonly ThongthaiAgentFunctionTool[] = [
  {
    type: 'function',
    name: 'get_restaurant_menu',
    description: 'Read the canonical live restaurant menu, prices, ingredients, allergy flags, and customization facts. Read-only.',
    parameters: objectSchema({
      query: { type: 'string', description: 'Optional menu-name keyword.' },
      allergen: { type: 'string', description: 'Optional allergen key or keyword, for example shrimp, peanut, seafood.' },
    }),
  },
  {
    type: 'function',
    name: 'get_activity_catalog',
    description: 'Read canonical live activity facts, current prices, durations, inventory, and named activity assets. Read-only.',
    parameters: objectSchema({
      activity_code: { type: 'string', description: 'Optional canonical activity code.' },
    }),
  },
  {
    type: 'function',
    name: 'check_activity_availability',
    description: 'Check canonical live activity availability for a date and optional resource/duration/party size. Read-only.',
    parameters: objectSchema({
      date: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      resource_code: { type: 'string' },
      duration_minutes: { type: 'integer', minimum: 1 },
      party_size: { type: 'integer', minimum: 1 },
    }, ['date']),
  },
  {
    type: 'function',
    name: 'get_stay_catalog',
    description: 'Read canonical stay resource facts such as room type, bedrooms, capacity, amenities, and price when configured. Read-only.',
    parameters: objectSchema({
      resource_code: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'check_stay_availability',
    description: 'Check canonical stay availability for check-in/check-out and optional resource/party size. Read-only.',
    parameters: objectSchema({
      check_in: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      check_out: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      resource_code: { type: 'string' },
      party_size: { type: 'integer', minimum: 1 },
    }, ['check_in', 'check_out']),
  },
  {
    type: 'function',
    name: 'get_otop_catalog',
    description: 'Read canonical live OTOP product names, descriptions, prices, and stock. Read-only.',
    parameters: objectSchema({
      sku: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'get_active_promotions',
    description: 'Read promotions that are currently eligible for this customer channel. Read-only.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'get_booking_status',
    description: 'Read this guest\'s latest booking status or a specific booking code. Never reads another guest. Read-only.',
    parameters: objectSchema({
      booking_code: { type: 'string' },
      domain: { type: 'string', enum: ['activity', 'stay', 'restaurant'] },
    }),
  },
  {
    type: 'function',
    name: 'get_payment_status',
    description: 'Read this guest\'s latest payment status or a specific payment/booking/order reference. Never reads another guest. Read-only.',
    parameters: objectSchema({
      code: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'get_membership_status',
    description: 'Read this guest\'s membership status and whether the profile is complete. Read-only.',
    parameters: objectSchema({}),
  },
] as const;

export type ThongthaiAgentToolContext = {
  guestDbId: string | null;
  channel: BrainChannel;
  environment?: 'live' | 'test';
  eventId?: string;
  message?: string;
  transactionMode?: ThongthaiAgentTransactionMode;
};

type JsonObject = Record<string, unknown>;

function stringArg(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function numberArg(args: JsonObject, key: string): number | undefined {
  const value = Number(args[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function request(
  domain: SemanticDomain,
  needs: KnowledgeNeed[],
  entities: Record<string, unknown> = {},
): KnowledgeRequest {
  return { domain, intent: 'agent_read_only_tool', action: 'ask', entities, constraints: [], needs };
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function filterRestaurantFacts(facts: GroundedFact[], args: JsonObject): GroundedFact[] {
  const query = normalizeText(args.query);
  const allergen = normalizeText(args.allergen);
  if (!query && !allergen) {
    return facts.filter(fact => /:(?:name|category|price|orderable|signature)$/.test(fact.key)).slice(0, 180);
  }
  const ids = new Set<string>();
  for (const fact of facts) {
    const match = fact.key.match(/^menu:([^:]+):name$/);
    if (match && query && normalizeText(fact.value).includes(query)) ids.add(match[1]!);
    const allergyMatch = fact.key.match(/^menu:([^:]+):allergen:([^:]+)$/);
    if (allergyMatch && allergen && normalizeText(allergyMatch[2]).includes(allergen)) ids.add(allergyMatch[1]!);
  }
  if (!ids.size && allergen) {
    for (const fact of facts) {
      const allergyMatch = fact.key.match(/^menu:([^:]+):allergen:([^:]+)$/);
      if (allergyMatch) ids.add(allergyMatch[1]!);
    }
  }
  return facts.filter(fact => {
    const match = fact.key.match(/^menu:([^:]+):/);
    return Boolean(match && ids.has(match[1]!));
  }).slice(0, 260);
}

function filterByPrefix(facts: GroundedFact[], prefix?: string): GroundedFact[] {
  if (!prefix) return facts.slice(0, 220);
  const needle = prefix.toLowerCase();
  return facts.filter(fact => fact.key.toLowerCase().includes(needle) || normalizeText(fact.value).includes(needle)).slice(0, 220);
}

function safeResult(bundle: Awaited<ReturnType<typeof resolveKnowledge>>, facts: GroundedFact[]): string {
  return JSON.stringify({
    ok: bundle.missing.length === 0 || facts.length > 0,
    domain: bundle.domain,
    freshness: bundle.freshness,
    facts: facts.map(fact => ({
      key: fact.key,
      value: fact.value,
      source: fact.sourceId,
      updated_at: fact.updatedAt,
    })),
    missing: bundle.missing,
    warnings: bundle.warnings,
  });
}

export async function executeThongthaiReadOnlyTool(
  name: string,
  rawArgs: unknown,
  context: ThongthaiAgentToolContext,
): Promise<string> {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs as JsonObject : {};
  const adapters = buildRealKnowledgeSourceAdapters(context.channel, {
    guestDbId: context.guestDbId,
    environment: context.environment ?? 'live',
  });

  let req: KnowledgeRequest;
  switch (name) {
    case 'get_restaurant_menu':
      req = request('restaurant', ['catalog']);
      break;
    case 'get_activity_catalog':
      req = request('activity', ['catalog'], {
        activityCode: stringArg(args, 'activity_code'),
      });
      break;
    case 'check_activity_availability':
      req = request('activity', ['availability'], {
        date: stringArg(args, 'date'),
        resourceCode: stringArg(args, 'resource_code'),
        durationMinutes: numberArg(args, 'duration_minutes'),
        partySize: numberArg(args, 'party_size'),
      });
      break;
    case 'get_stay_catalog':
      req = request('stay', ['catalog'], {
        resourceCode: stringArg(args, 'resource_code'),
      });
      break;
    case 'check_stay_availability':
      req = request('stay', ['availability'], {
        date: stringArg(args, 'check_in'),
        endDate: stringArg(args, 'check_out'),
        resourceCode: stringArg(args, 'resource_code'),
        partySize: numberArg(args, 'party_size'),
      });
      break;
    case 'get_otop_catalog':
      req = request('otop', ['catalog']);
      break;
    case 'get_active_promotions':
      req = request('promotion', ['promotion_eligibility']);
      break;
    case 'get_booking_status':
      req = request((stringArg(args, 'domain') as SemanticDomain | undefined) ?? 'activity', ['booking_status'], {
        bookingCode: stringArg(args, 'booking_code'),
      });
      break;
    case 'get_payment_status':
      req = request('payment', ['payment_status'], {
        entityCode: stringArg(args, 'code'),
      });
      break;
    case 'get_membership_status':
      req = request('membership', ['membership_status']);
      break;
    default:
      return JSON.stringify({ ok: false, error: 'unknown_read_only_tool' });
  }

  const bundle = await resolveKnowledge(req, adapters);
  let facts = bundle.facts;
  if (name === 'get_restaurant_menu') facts = filterRestaurantFacts(facts, args);
  if (name === 'get_activity_catalog') facts = filterByPrefix(facts, stringArg(args, 'activity_code'));
  if (name === 'get_stay_catalog') facts = filterByPrefix(facts, stringArg(args, 'resource_code'));
  if (name === 'get_otop_catalog') facts = filterByPrefix(facts, stringArg(args, 'sku'));
  return safeResult(bundle, facts);
}


export const THONGTHAI_AGENT_TOOLS: readonly ThongthaiAgentFunctionTool[] = [
  ...THONGTHAI_READ_ONLY_TOOLS,
  ...THONGTHAI_STAGING_TRANSACTION_TOOLS,
];

const TRANSACTION_TOOL_NAMES = new Set(THONGTHAI_STAGING_TRANSACTION_TOOLS.map(tool => tool.name));

export async function executeThongthaiAgentTool(
  name: string,
  rawArgs: unknown,
  context: ThongthaiAgentToolContext,
): Promise<string> {
  if (TRANSACTION_TOOL_NAMES.has(name)) {
    return executeThongthaiTransactionTool(name, rawArgs, {
      guestDbId: context.guestDbId,
      channel: context.channel,
      environment: context.environment ?? 'live',
      eventId: context.eventId ?? '',
      message: context.message ?? '',
      transactionMode: context.transactionMode ?? 'off',
    });
  }
  return executeThongthaiReadOnlyTool(name, rawArgs, context);
}
