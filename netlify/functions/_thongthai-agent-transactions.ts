import { randomUUID } from 'node:crypto';
import type { BrainChannel } from './_thongthai-brain-v3';
import { loadActivityWorldFacts } from './_activity-sot';
import { createBooking, createCafeInquiry, createOtopOrder, formatActivityAssetNote, listBookingOptions, listOtopProducts, listServiceResources, listStayBookingOptions, upsertCustomerAccount } from './_operations-db';
import { createRestaurantPreorder, listRestaurantMenu } from './_restaurant-sot';
import { dispatchCreatedTransactionNotification } from './_transaction-notifications';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { hasCancelMarker, hasCommitMarker, hasCorrectionMarker, hasExplicitNoTransactionMarker, hasStandaloneTransactionRequest } from './_slot-parsers';

export type ThongthaiAgentTransactionMode = 'off' | 'prepare' | 'test' | 'live';

export type ThongthaiAgentTransactionContext = {
  guestDbId: string | null;
  channel: BrainChannel;
  environment: 'live' | 'test';
  eventId: string;
  message: string;
  transactionMode: ThongthaiAgentTransactionMode;
};

export type ThongthaiAgentTransactionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const STATE_KEY = 'thongthaiAgentPreparedTransactionV1';
const STAY_STATE_KEY = 'thongthaiAgentPreparedStayBookingV1';
const RESTAURANT_PREORDER_STATE_KEY = 'thongthaiAgentPreparedRestaurantPreorderV1';
const OTOP_ORDER_STATE_KEY = 'thongthaiAgentPreparedOtopOrderV1';
const CAFE_INQUIRY_STATE_KEY = 'thongthaiAgentPreparedCafeInquiryV1';
const PREPARED_TTL_MS = 30 * 60 * 1000;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const THONGTHAI_STAGING_TRANSACTION_TOOLS: readonly ThongthaiAgentTransactionTool[] = [
  {
    type: 'function',
    name: 'prepare_activity_booking',
    description: 'Prepare an activity booking for explicit customer review. This NEVER creates a booking. IMPORTANT: this prepare tool already validates the canonical activity/asset, offered duration, live availability/options, and price. If the customer message already contains the required booking fields, call this tool DIRECTLY; do NOT call get_activity_catalog or check_activity_availability first. After it returns, summarize the exact details and ask for "ยืนยันจอง".',
    parameters: objectSchema({
      activity_code: { type: 'string', description: 'Canonical activity code, for example horse. For an obvious named activity, use the known canonical code directly; no separate catalog call is required.' },
      asset_name: { type: 'string', description: 'Optional canonical named asset, for example ภาราดร. Required for horse booking.' },
      date: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      time: { type: 'string', description: 'Optional local time HH:MM.' },
      duration_minutes: { type: 'integer', minimum: 5, maximum: 600 },
      party_size: { type: 'integer', minimum: 1, maximum: 50 },
      customer_name: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      note: { type: 'string' },
    }, ['activity_code', 'date', 'duration_minutes', 'party_size', 'customer_name', 'phone']),
  },
  {
    type: 'function',
    name: 'get_prepared_activity_booking',
    description: 'Read the currently prepared activity booking for this guest, including its confirmation_id and exact details. This never creates or modifies a booking. Use it when the customer returns to a previously prepared booking or explicitly confirms after saying not yet.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'commit_prepared_activity_booking',
    description: 'Submit the previously prepared activity booking request. This is consequential and is server-gated: it succeeds only on a later customer turn that explicitly confirms booking. Pass the confirmation_id returned by prepare_activity_booking. Never call in the same turn as prepare.',
    parameters: objectSchema({
      confirmation_id: { type: 'string' },
    }, ['confirmation_id']),
  },
  {
    type: 'function',
    name: 'prepare_stay_booking',
    description: 'Prepare a stay booking request for explicit customer review. This NEVER creates a booking. This prepare tool itself validates the canonical stay resource and checks live stay options. If the customer already identified an unambiguous stay resource and supplied all required fields, call this tool directly; use get_stay_catalog first only when resource identity/code is genuinely unresolved. Then summarize and ask for "ยืนยันจอง".',
    parameters: objectSchema({
      resource_code: { type: 'string', description: 'Canonical stay resource code from get_stay_catalog.' },
      resource_name: { type: 'string', description: 'Optional canonical stay resource name.' },
      check_in: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      check_out: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      party_size: { type: 'integer', minimum: 1, maximum: 50 },
      quantity: { type: 'integer', minimum: 1, maximum: 6, description: 'Number of villas/rooms requested. Defaults to 1.' },
      customer_name: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      note: { type: 'string' },
    }, ['resource_code', 'check_in', 'check_out', 'party_size', 'customer_name', 'phone']),
  },
  {
    type: 'function',
    name: 'get_prepared_stay_booking',
    description: 'Read the currently prepared stay booking for this guest. This never creates or modifies a booking. Use it when the customer returns to a prepared stay request or explicitly confirms after saying not yet.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'commit_prepared_stay_booking',
    description: 'Submit the previously prepared stay booking request. Server-gated: it succeeds only on a later customer turn with explicit booking confirmation. Pass the confirmation_id returned by prepare_stay_booking. Never call in the same turn as prepare.',
    parameters: objectSchema({
      confirmation_id: { type: 'string' },
    }, ['confirmation_id']),
  },
  {
    type: 'function',
    name: 'prepare_restaurant_preorder',
    description: 'Prepare a restaurant preorder for explicit customer review. This NEVER creates an order or payment request. This prepare tool itself validates every item against the live menu/orderability and calculates the total. If the customer already supplied the complete item list, date/time, name and phone, call this tool directly rather than pre-reading the menu again. Then ask for "ยืนยันสั่ง".',
    parameters: objectSchema({
      date: { type: 'string', description: 'Local date YYYY-MM-DD.' },
      time: { type: 'string', description: 'Local time HH:MM.' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: objectSchema({
          name: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 50 },
        }, ['name','quantity']),
      },
      customer_name: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      note: { type: 'string' },
    }, ['date','time','items','customer_name','phone']),
  },
  {
    type: 'function',
    name: 'get_prepared_restaurant_preorder',
    description: 'Read this guest\'s currently prepared restaurant preorder. This never creates or modifies an order. Use it when the customer returns to a prepared preorder or explicitly confirms after saying not yet.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'commit_prepared_restaurant_preorder',
    description: 'Submit the previously prepared restaurant preorder. Server-gated: it succeeds only on a later customer turn with explicit ordering confirmation. Pass the confirmation_id returned by prepare_restaurant_preorder. Never call in the same turn as prepare.',
    parameters: objectSchema({
      confirmation_id: { type: 'string' },
    }, ['confirmation_id']),
  },
  {
    type: 'function',
    name: 'prepare_otop_order',
    description: 'Prepare an OTOP product order for explicit customer review. This NEVER creates an order or changes stock. This prepare tool itself validates the SKU, current stock and price. If the SKU is already known from the conversation/tool context, call this tool directly; use get_otop_catalog first only when SKU/product identity is genuinely unresolved. Then ask for "ยืนยันสั่ง".',
    parameters: objectSchema({
      sku: { type: 'string', description: 'Canonical OTOP SKU from get_otop_catalog.' },
      quantity: { type: 'integer', minimum: 1, maximum: 99 },
      fulfillment_type: { type: 'string', enum: ['pickup','shipping'] },
      shipping_address: { type: 'string' },
      customer_name: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      note: { type: 'string' },
    }, ['sku','quantity','fulfillment_type','customer_name','phone']),
  },
  {
    type: 'function',
    name: 'get_prepared_otop_order',
    description: 'Read this guest\'s currently prepared OTOP order. This never creates an order or changes stock. Use it when the customer returns to a prepared order or explicitly confirms after saying not yet.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'commit_prepared_otop_order',
    description: 'Submit the previously prepared OTOP order. Server-gated: succeeds only on a later customer turn with explicit ordering confirmation. Pass confirmation_id from prepare_otop_order. Never call in the same turn as prepare.',
    parameters: objectSchema({
      confirmation_id: { type: 'string' },
    }, ['confirmation_id']),
  },
  {
    type: 'function',
    name: 'prepare_cafe_inquiry',
    description: 'Prepare a cafe service inquiry/handoff for explicit customer review. This NEVER sends anything to staff. When the customer already supplied the inquiry text, name and phone, call this tool directly; no preliminary catalog/status tool is needed. Ask the customer to reply exactly "ยืนยันส่งคำถาม" to send it.',
    parameters: objectSchema({
      question: { type: 'string', description: 'The exact customer question/request to send to the cafe team.' },
      customer_name: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
    }, ['question','customer_name','phone']),
  },
  {
    type: 'function',
    name: 'get_prepared_cafe_inquiry',
    description: 'Read this guest\'s currently prepared cafe inquiry. This never sends or modifies the inquiry.',
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'commit_prepared_cafe_inquiry',
    description: 'Send the previously prepared cafe inquiry to operations. Server-gated: succeeds only on a later customer turn explicitly saying "ยืนยันส่งคำถาม" (or an equivalent explicit send-to-team confirmation). Pass confirmation_id from prepare_cafe_inquiry. Never call in the same turn as prepare.',
    parameters: objectSchema({
      confirmation_id: { type: 'string' },
    }, ['confirmation_id']),
  },
] as const;

export const THONGTHAI_PREPARE_ONLY_TRANSACTION_TOOLS: readonly ThongthaiAgentTransactionTool[] =
  THONGTHAI_STAGING_TRANSACTION_TOOLS.filter(tool =>
    tool.name.startsWith('prepare_') || tool.name.startsWith('get_prepared_')
  );

const COMMIT_TRANSACTION_TOOL_NAMES = new Set(
  THONGTHAI_STAGING_TRANSACTION_TOOLS
    .map(tool => tool.name)
    .filter(name => name.startsWith('commit_prepared_')),
);

type ActivityCatalog = {
  activityCode: string;
  resourceCode: string;
  name: string;
  durations: Array<{ durationMinutes: number; price: number | null; currency?: string; status?: string }>;
  assets: Array<{ code: string; name: string; type: string; metadata?: Record<string, unknown> }>;
};

type PreparedActivityBooking = {
  version: 1;
  kind: 'activity_booking';
  status: 'prepared' | 'committed';
  confirmationId: string;
  preparedEventId: string;
  preparedAt: string;
  expiresAt: string;
  environment: 'live' | 'test';
  payload: {
    activityCode: string;
    resourceCode: string;
    assetCode: string | null;
    assetName: string | null;
    date: string;
    time: string | null;
    durationMinutes: number;
    partySize: number;
    customerName: string;
    phone: string;
    email: string | null;
    note: string | null;
    expectedPrice: number | null;
    currency: string;
  };
  preview: {
    availabilityStatus: 'slot_found' | 'options_available' | 'staff_confirmation_required';
    availableOptionCount: number;
  };
  result?: {
    bookingId: string;
    bookingCode: string;
    status: string;
    startAt: string | null;
    endAt: string | null;
    notificationStatus: string;
  };
};

type PreparedStayBooking = {
  version: 1;
  kind: 'stay_booking';
  status: 'prepared' | 'committed';
  confirmationId: string;
  preparedEventId: string;
  preparedAt: string;
  expiresAt: string;
  environment: 'live' | 'test';
  payload: {
    resourceCode: string;
    resourceName: string;
    checkIn: string;
    checkOut: string;
    partySize: number;
    quantity: number;
    customerName: string;
    phone: string;
    email: string | null;
    note: string | null;
  };
  preview: {
    availabilityStatus: 'full_stay_available' | 'options_available' | 'staff_confirmation_required';
    availableOptionCount: number;
  };
  result?: {
    bookingId: string;
    bookingCode: string;
    status: string;
    startAt: string | null;
    endAt: string | null;
    notificationStatus: string;
  };
};

type PreparedRestaurantPreorder = {
  version: 1;
  kind: 'restaurant_preorder';
  status: 'prepared' | 'committed';
  confirmationId: string;
  preparedEventId: string;
  preparedAt: string;
  expiresAt: string;
  environment: 'live' | 'test';
  payload: {
    date: string;
    time: string;
    items: Array<{ name: string; quantity: number; unitPrice: number; lineTotal: number }>;
    customerName: string;
    phone: string;
    email: string | null;
    note: string | null;
    expectedTotal: number;
  };
  result?: {
    preorderId: string;
    preorderCode: string;
    status: string;
    totalAmount: number;
    notificationStatus: string;
  };
};

type PreparedOtopOrder = {
  version: 1;
  kind: 'otop_order';
  status: 'prepared' | 'committed';
  confirmationId: string;
  preparedEventId: string;
  preparedAt: string;
  expiresAt: string;
  environment: 'live' | 'test';
  payload: {
    sku: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    expectedTotal: number;
    fulfillmentType: 'pickup' | 'shipping';
    shippingAddress: string | null;
    customerName: string;
    phone: string;
    email: string | null;
    note: string | null;
  };
  result?: {
    orderId: string;
    orderCode: string;
    total: number;
    notificationStatus: string;
  };
};

type PreparedCafeInquiry = {
  version: 1;
  kind: 'cafe_inquiry';
  status: 'prepared' | 'committed';
  confirmationId: string;
  preparedEventId: string;
  preparedAt: string;
  expiresAt: string;
  environment: 'live' | 'test';
  payload: {
    question: string;
    customerName: string;
    phone: string;
    email: string | null;
  };
  result?: {
    inquiryId: string;
    inquiryCode: string;
    notificationStatus: string;
  };
};

function textArg(args: Record<string, unknown>, key: string, max = 240): string | null {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function intArg(args: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const value = Number(args[key]);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00+07:00`).valueOf());
}

function validTime(value: string | null): value is string {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function validPhone(value: string | null): value is string {
  if (!value) return false;
  const cleaned = value.replace(/[^0-9+]/g, '');
  return cleaned.length >= 8 && cleaned.length <= 20;
}

function normalizeName(value: string): string {
  return value.trim().replace(/^น้อง/u, '').replace(/\s+/g, '').toLowerCase();
}

async function activityCatalog(): Promise<ActivityCatalog[]> {
  const rows = await loadActivityWorldFacts();
  const activities: ActivityCatalog[] = [];
  for (const row of rows) {
    const value = row.fact_value && typeof row.fact_value === 'object' && !Array.isArray(row.fact_value)
      ? row.fact_value as { activities?: ActivityCatalog[] }
      : {};
    for (const activity of value.activities ?? []) activities.push(activity);
  }
  return activities;
}

function bangkokHm(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(time));
  const h = parts.find(part => part.type === 'hour')?.value;
  const m = parts.find(part => part.type === 'minute')?.value;
  return h && m ? `${h}:${m}` : null;
}

async function loadPrepared(guestDbId: string): Promise<PreparedActivityBooking | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const raw = snapshot.state[STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<PreparedActivityBooking>;
  if (value.version !== 1 || value.kind !== 'activity_booking' || typeof value.confirmationId !== 'string') return null;
  return value as PreparedActivityBooking;
}

async function savePrepared(guestDbId: string, value: PreparedActivityBooking): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [STATE_KEY]: value } });
  if (!ok) throw new Error('prepared_transaction_state_unavailable');
}

async function loadPreparedStay(guestDbId: string): Promise<PreparedStayBooking | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const raw = snapshot.state[STAY_STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<PreparedStayBooking>;
  if (value.version !== 1 || value.kind !== 'stay_booking' || typeof value.confirmationId !== 'string') return null;
  return value as PreparedStayBooking;
}

async function savePreparedStay(guestDbId: string, value: PreparedStayBooking): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [STAY_STATE_KEY]: value } });
  if (!ok) throw new Error('prepared_stay_transaction_state_unavailable');
}

function nightsBetween(checkIn: string, checkOut: string): number | null {
  if (!validDate(checkIn) || !validDate(checkOut)) return null;
  const start = new Date(`${checkIn}T12:00:00+07:00`).getTime();
  const end = new Date(`${checkOut}T12:00:00+07:00`).getTime();
  const nights = Math.round((end - start) / 86_400_000);
  return Number.isInteger(nights) && nights >= 1 && nights <= 30 ? nights : null;
}

function modeAllowed(context: ThongthaiAgentTransactionContext): { ok: true; environment: 'live'|'test' } | { ok: false; error: string } {
  if (context.transactionMode === 'off') return { ok: false, error: 'transaction_tools_disabled' };
  if (context.transactionMode === 'test') return { ok: true, environment: 'test' };
  if (context.transactionMode === 'prepare') {
    if (context.environment !== 'live' || process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED !== '1') {
      return { ok: false, error: 'transaction_prepare_tools_not_enabled' };
    }
    return { ok: true, environment: 'live' };
  }
  if (process.env.THONGTHAI_AGENT_LIVE_TRANSACTION_ENABLED !== '1') {
    return { ok: false, error: 'live_transaction_tools_not_enabled' };
  }
  return { ok: true, environment: 'live' };
}

export function currentTurnExplicitlyConfirmsPreparedBooking(message: string): boolean {
  if (hasExplicitNoTransactionMarker(message) || hasCancelMarker(message) || hasCorrectionMarker(message)) return false;
  return hasCommitMarker(message) || hasStandaloneTransactionRequest(message);
}

async function prepareActivityBooking(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const activityCode = textArg(args, 'activity_code', 80);
  const requestedAssetName = textArg(args, 'asset_name', 120);
  const date = textArg(args, 'date', 10);
  const rawTime = textArg(args, 'time', 5);
  const durationMinutes = intArg(args, 'duration_minutes', 5, 600);
  const partySize = intArg(args, 'party_size', 1, 50);
  const customerName = textArg(args, 'customer_name', 160);
  const phone = textArg(args, 'phone', 40);
  const email = textArg(args, 'email', 200);
  const note = textArg(args, 'note', 600);

  const missing: string[] = [];
  if (!activityCode) missing.push('activity_code');
  if (!validDate(date)) missing.push('date');
  if (rawTime && !validTime(rawTime)) missing.push('time');
  if (!durationMinutes) missing.push('duration_minutes');
  if (!partySize) missing.push('party_size');
  if (!customerName) missing.push('customer_name');
  if (!validPhone(phone)) missing.push('phone');
  if (missing.length) return { ok: false, error: 'missing_or_invalid_fields', missing_fields: missing };

  const activities = await activityCatalog();
  const activity = activities.find(item => item.activityCode === activityCode);
  if (!activity) return { ok: false, error: 'activity_not_found' };

  let asset: ActivityCatalog['assets'][number] | null = null;
  if (requestedAssetName) {
    const matches = activity.assets.filter(item => normalizeName(item.name) === normalizeName(requestedAssetName));
    if (matches.length !== 1) return { ok: false, error: matches.length ? 'activity_asset_ambiguous' : 'activity_asset_not_found' };
    asset = matches[0]!;
  }
  if (activity.activityCode === 'horse' && !asset) {
    return { ok: false, error: 'horse_asset_required' };
  }

  const duration = activity.durations.find(item => Number(item.durationMinutes) === durationMinutes);
  if (!duration) return { ok: false, error: 'activity_duration_not_offered' };

  const options = await listBookingOptions(
    'activity',
    date!,
    mode.environment,
    activity.resourceCode,
    durationMinutes,
    partySize,
  ).catch(() => []);

  const matchingTime = rawTime
    ? options.filter(option => bangkokHm(option.startAt) === rawTime)
    : [];
  const availabilityStatus: PreparedActivityBooking['preview']['availabilityStatus'] =
    rawTime && matchingTime.length
      ? 'slot_found'
      : options.length
        ? 'options_available'
        : 'staff_confirmation_required';

  const now = new Date();
  const prepared: PreparedActivityBooking = {
    version: 1,
    kind: 'activity_booking',
    status: 'prepared',
    confirmationId: randomUUID(),
    preparedEventId: context.eventId,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREPARED_TTL_MS).toISOString(),
    environment: mode.environment,
    payload: {
      activityCode: activity.activityCode,
      resourceCode: activity.resourceCode,
      assetCode: asset?.code ?? null,
      assetName: asset?.name ?? null,
      date: date!,
      time: rawTime ?? null,
      durationMinutes: durationMinutes!,
      partySize: partySize!,
      customerName: customerName!,
      phone: phone!,
      email,
      note,
      expectedPrice: duration.price == null ? null : Number(duration.price),
      currency: duration.currency ?? 'THB',
    },
    preview: {
      availabilityStatus,
      availableOptionCount: options.length,
    },
  };
  await savePrepared(context.guestDbId, prepared);

  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      activity: activity.name,
      asset: prepared.payload.assetName,
      date: prepared.payload.date,
      time: prepared.payload.time,
      duration_minutes: prepared.payload.durationMinutes,
      party_size: prepared.payload.partySize,
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
      expected_price: prepared.payload.expectedPrice,
      currency: prepared.payload.currency,
      availability_status: prepared.preview.availabilityStatus,
    },
    confirmation_required: true,
    exact_confirmation_phrase_th: 'ยืนยันจอง',
    instruction: 'Do not call the commit tool in this same customer turn. Show the summary and ask for explicit confirmation.',
  };
}

async function getPreparedActivityBooking(
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const prepared = await loadPrepared(context.guestDbId);
  if (!prepared) return { ok: true, prepared: false };
  if (prepared.environment !== mode.environment) return { ok: true, prepared: false };
  if (Date.parse(prepared.expiresAt) <= Date.now()) {
    return { ok: true, prepared: false, expired: true };
  }
  if (prepared.status === 'committed') {
    return {
      ok: true,
      prepared: false,
      committed: true,
      confirmation_id: prepared.confirmationId,
      result: prepared.result ?? null,
    };
  }
  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      activity_code: prepared.payload.activityCode,
      resource_code: prepared.payload.resourceCode,
      asset_name: prepared.payload.assetName,
      date: prepared.payload.date,
      time: prepared.payload.time,
      duration_minutes: prepared.payload.durationMinutes,
      party_size: prepared.payload.partySize,
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
      expected_price: prepared.payload.expectedPrice,
      currency: prepared.payload.currency,
      availability_status: prepared.preview.availabilityStatus,
    },
    exact_confirmation_phrase_th: 'ยืนยันจอง',
  };
}

async function commitPreparedActivityBooking(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const confirmationId = textArg(args, 'confirmation_id', 80);
  if (!confirmationId) return { ok: false, error: 'confirmation_id_required' };
  const prepared = await loadPrepared(context.guestDbId);
  if (!prepared || prepared.confirmationId !== confirmationId) {
    return { ok: false, error: 'prepared_transaction_not_found' };
  }
  if (prepared.status === 'committed' && prepared.result) {
    return { ok: true, committed: true, replayed: true, ...prepared.result };
  }
  if (prepared.environment !== mode.environment) return { ok: false, error: 'prepared_transaction_environment_mismatch' };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok: false, error: 'prepared_transaction_expired' };
  if (prepared.preparedEventId === context.eventId) {
    return { ok: false, error: 'same_turn_commit_blocked', instruction: 'Wait for a later customer message that explicitly confirms.' };
  }
  if (!currentTurnExplicitlyConfirmsPreparedBooking(context.message)) {
    return { ok: false, error: 'explicit_customer_confirmation_required', exact_confirmation_phrase_th: 'ยืนยันจอง' };
  }

  const p = prepared.payload;
  const booking = await createBooking({
    guestDbId: context.guestDbId,
    channel: context.channel,
    serviceType: 'activity',
    resourceCode: p.resourceCode,
    date: p.date,
    time: p.time,
    durationMinutes: p.durationMinutes,
    partySize: p.partySize,
    customerName: p.customerName,
    phone: p.phone,
    email: p.email,
    note: [
      p.note,
      p.assetName && p.assetCode ? formatActivityAssetNote({ name: p.assetName, assetCode: p.assetCode }) : null,
    ].filter(Boolean).join(' | ') || null,
    environment: mode.environment,
  });

  const notificationStatus = mode.environment === 'live'
    ? await dispatchCreatedTransactionNotification('booking', booking.id)
    : 'ignored_test_mode';

  const result = {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    status: booking.status,
    startAt: booking.startAt ?? null,
    endAt: booking.endAt ?? null,
    notificationStatus,
  };
  await savePrepared(context.guestDbId, {
    ...prepared,
    status: 'committed',
    result,
  });

  return {
    ok: true,
    committed: true,
    replayed: false,
    booking_code: booking.bookingCode,
    booking_status: booking.status,
    start_at: booking.startAt,
    end_at: booking.endAt,
    notification_status: notificationStatus,
    customer_copy_rule: 'This is a booking request/status returned by the operational system. Do not call it paid or staff-confirmed unless that status is separately verified.',
  };
}

async function prepareStayBooking(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const resourceCode = textArg(args, 'resource_code', 120);
  const requestedResourceName = textArg(args, 'resource_name', 160);
  const checkIn = textArg(args, 'check_in', 10);
  const checkOut = textArg(args, 'check_out', 10);
  const partySize = intArg(args, 'party_size', 1, 50);
  const quantity = intArg(args, 'quantity', 1, 6) ?? 1;
  const customerName = textArg(args, 'customer_name', 160);
  const phone = textArg(args, 'phone', 40);
  const email = textArg(args, 'email', 200);
  const note = textArg(args, 'note', 600);

  const missing: string[] = [];
  if (!resourceCode) missing.push('resource_code');
  if (!validDate(checkIn)) missing.push('check_in');
  if (!validDate(checkOut)) missing.push('check_out');
  if (checkIn && checkOut && !nightsBetween(checkIn, checkOut)) missing.push('valid_stay_date_range');
  if (!partySize) missing.push('party_size');
  if (!customerName) missing.push('customer_name');
  if (!validPhone(phone)) missing.push('phone');
  if (missing.length) return { ok: false, error: 'missing_or_invalid_fields', missing_fields: missing };

  const resources = await listServiceResources('stay');
  const resource = resources.find(item => item.code === resourceCode);
  if (!resource) return { ok: false, error: 'stay_resource_not_found' };
  if (requestedResourceName && normalizeName(resource.name) !== normalizeName(requestedResourceName)) {
    return { ok: false, error: 'stay_resource_name_mismatch', canonical_name: resource.name };
  }
  if (resource.defaultCapacity != null && partySize! > resource.defaultCapacity) {
    return {
      ok: false,
      error: 'stay_party_exceeds_resource_capacity',
      resource_name: resource.name,
      capacity: resource.defaultCapacity,
    };
  }

  const nights = nightsBetween(checkIn!, checkOut!)!;
  const options = await listStayBookingOptions(
    checkIn!,
    checkOut!,
    mode.environment,
    resource.code,
    partySize,
  ).catch(() => []);
  const fullStayAvailable = options.length === nights
    && options.every(option => option.resourceCode === resource.code && option.available >= quantity);
  const availabilityStatus: PreparedStayBooking['preview']['availabilityStatus'] =
    fullStayAvailable ? 'full_stay_available' : options.length ? 'options_available' : 'staff_confirmation_required';

  const now = new Date();
  const prepared: PreparedStayBooking = {
    version: 1,
    kind: 'stay_booking',
    status: 'prepared',
    confirmationId: randomUUID(),
    preparedEventId: context.eventId,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREPARED_TTL_MS).toISOString(),
    environment: mode.environment,
    payload: {
      resourceCode: resource.code,
      resourceName: resource.name,
      checkIn: checkIn!,
      checkOut: checkOut!,
      partySize: partySize!,
      quantity,
      customerName: customerName!,
      phone: phone!,
      email,
      note,
    },
    preview: {
      availabilityStatus,
      availableOptionCount: options.length,
    },
  };
  await savePreparedStay(context.guestDbId, prepared);

  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      stay: resource.name,
      resource_code: resource.code,
      check_in: prepared.payload.checkIn,
      check_out: prepared.payload.checkOut,
      nights,
      party_size: prepared.payload.partySize,
      quantity: prepared.payload.quantity,
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
      availability_status: prepared.preview.availabilityStatus,
    },
    confirmation_required: true,
    exact_confirmation_phrase_th: 'ยืนยันจอง',
    instruction: 'Do not call the commit tool in this same customer turn. Show the summary and ask for explicit confirmation.',
  };
}

async function getPreparedStayBooking(
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const prepared = await loadPreparedStay(context.guestDbId);
  if (!prepared) return { ok: true, prepared: false };
  if (prepared.environment !== mode.environment) return { ok: true, prepared: false };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok: true, prepared: false, expired: true };
  if (prepared.status === 'committed') {
    return {
      ok: true,
      prepared: false,
      committed: true,
      confirmation_id: prepared.confirmationId,
      result: prepared.result ?? null,
    };
  }
  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      stay: prepared.payload.resourceName,
      resource_code: prepared.payload.resourceCode,
      check_in: prepared.payload.checkIn,
      check_out: prepared.payload.checkOut,
      party_size: prepared.payload.partySize,
      quantity: prepared.payload.quantity,
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
      availability_status: prepared.preview.availabilityStatus,
    },
    exact_confirmation_phrase_th: 'ยืนยันจอง',
  };
}

async function commitPreparedStayBooking(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const confirmationId = textArg(args, 'confirmation_id', 80);
  if (!confirmationId) return { ok: false, error: 'confirmation_id_required' };
  const prepared = await loadPreparedStay(context.guestDbId);
  if (!prepared || prepared.confirmationId !== confirmationId) {
    return { ok: false, error: 'prepared_stay_transaction_not_found' };
  }
  if (prepared.status === 'committed' && prepared.result) {
    return { ok: true, committed: true, replayed: true, ...prepared.result };
  }
  if (prepared.environment !== mode.environment) return { ok: false, error: 'prepared_transaction_environment_mismatch' };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok: false, error: 'prepared_transaction_expired' };
  if (prepared.preparedEventId === context.eventId) {
    return { ok: false, error: 'same_turn_commit_blocked', instruction: 'Wait for a later customer message that explicitly confirms.' };
  }
  if (!currentTurnExplicitlyConfirmsPreparedBooking(context.message)) {
    return { ok: false, error: 'explicit_customer_confirmation_required', exact_confirmation_phrase_th: 'ยืนยันจอง' };
  }

  const p = prepared.payload;
  const booking = await createBooking({
    guestDbId: context.guestDbId,
    channel: context.channel,
    serviceType: 'stay',
    resourceCode: p.resourceCode,
    date: p.checkIn,
    endDate: p.checkOut,
    partySize: p.partySize,
    quantity: p.quantity,
    customerName: p.customerName,
    phone: p.phone,
    email: p.email,
    note: p.note,
    environment: mode.environment,
  });

  const notificationStatus = mode.environment === 'live'
    ? await dispatchCreatedTransactionNotification('booking', booking.id)
    : 'ignored_test_mode';

  const result = {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    status: booking.status,
    startAt: booking.startAt ?? null,
    endAt: booking.endAt ?? null,
    notificationStatus,
  };
  await savePreparedStay(context.guestDbId, { ...prepared, status: 'committed', result });

  return {
    ok: true,
    committed: true,
    replayed: false,
    booking_code: booking.bookingCode,
    booking_status: booking.status,
    start_at: booking.startAt,
    end_at: booking.endAt,
    notification_status: notificationStatus,
    customer_copy_rule: 'This is a stay booking request returned by operations. Do not call it room-confirmed, paid, or staff-confirmed unless separately verified.',
  };
}

async function loadPreparedRestaurantPreorder(guestDbId: string): Promise<PreparedRestaurantPreorder | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const raw = snapshot.state[RESTAURANT_PREORDER_STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<PreparedRestaurantPreorder>;
  if (value.version !== 1 || value.kind !== 'restaurant_preorder' || typeof value.confirmationId !== 'string') return null;
  return value as PreparedRestaurantPreorder;
}

async function savePreparedRestaurantPreorder(guestDbId: string, value: PreparedRestaurantPreorder): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [RESTAURANT_PREORDER_STATE_KEY]: value } });
  if (!ok) throw new Error('prepared_restaurant_preorder_state_unavailable');
}

function normalizeMenuName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

async function prepareRestaurantPreorder(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const date = textArg(args, 'date', 10);
  const time = textArg(args, 'time', 5);
  const customerName = textArg(args, 'customer_name', 160);
  const phone = textArg(args, 'phone', 40);
  const email = textArg(args, 'email', 200);
  const note = textArg(args, 'note', 600);
  const rawItems = Array.isArray(args.items) ? args.items : [];

  const missing: string[] = [];
  if (!validDate(date)) missing.push('date');
  if (!validTime(time)) missing.push('time');
  if (!customerName) missing.push('customer_name');
  if (!validPhone(phone)) missing.push('phone');
  if (!rawItems.length) missing.push('items');
  if (missing.length) return { ok: false, error: 'missing_or_invalid_fields', missing_fields: missing };

  const menu = await listRestaurantMenu();
  const resolved: PreparedRestaurantPreorder['payload']['items'] = [];
  for (const raw of rawItems.slice(0, 20)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'invalid_preorder_item' };
    }
    const row = raw as Record<string, unknown>;
    const requestedName = textArg(row, 'name', 180);
    const quantity = intArg(row, 'quantity', 1, 50);
    if (!requestedName || !quantity) return { ok: false, error: 'invalid_preorder_item' };
    const needle = normalizeMenuName(requestedName);
    const exact = menu.find(item => normalizeMenuName(item.name) === needle);
    const candidates = exact ? [exact] : menu.filter(item =>
      normalizeMenuName(item.name).includes(needle) || needle.includes(normalizeMenuName(item.name))
    );
    if (candidates.length !== 1) {
      return { ok: false, error: candidates.length ? 'menu_item_ambiguous' : 'menu_item_not_found', requested_name: requestedName };
    }
    const item = candidates[0]!;
    if (!item.is_orderable || item.available_servings < quantity) {
      return {
        ok: false,
        error: 'menu_item_unavailable',
        menu_name: item.name,
        requested_quantity: quantity,
        available_servings: item.available_servings,
      };
    }
    const unitPrice = Number(item.selling_price);
    resolved.push({ name:item.name, quantity, unitPrice, lineTotal:unitPrice * quantity });
  }

  const now = new Date();
  const prepared: PreparedRestaurantPreorder = {
    version: 1,
    kind: 'restaurant_preorder',
    status: 'prepared',
    confirmationId: randomUUID(),
    preparedEventId: context.eventId,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREPARED_TTL_MS).toISOString(),
    environment: mode.environment,
    payload: {
      date: date!,
      time: time!,
      items: resolved,
      customerName: customerName!,
      phone: phone!,
      email,
      note,
      expectedTotal: resolved.reduce((sum,item) => sum + item.lineTotal, 0),
    },
  };
  await savePreparedRestaurantPreorder(context.guestDbId, prepared);

  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      date: prepared.payload.date,
      time: prepared.payload.time,
      items: prepared.payload.items,
      expected_total: prepared.payload.expectedTotal,
      currency: 'THB',
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
    },
    confirmation_required: true,
    exact_confirmation_phrase_th: 'ยืนยันสั่ง',
    instruction: 'Do not call commit_prepared_restaurant_preorder in this same customer turn. Show the exact summary and ask for explicit confirmation.',
  };
}

async function getPreparedRestaurantPreorder(
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;
  const prepared = await loadPreparedRestaurantPreorder(context.guestDbId);
  if (!prepared) return { ok: true, prepared: false };
  if (prepared.environment !== mode.environment) return { ok: true, prepared: false };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok: true, prepared: false, expired: true };
  if (prepared.status === 'committed') {
    return { ok:true, prepared:false, committed:true, confirmation_id:prepared.confirmationId, result:prepared.result ?? null };
  }
  return {
    ok: true,
    prepared: true,
    confirmation_id: prepared.confirmationId,
    expires_at: prepared.expiresAt,
    summary: {
      date: prepared.payload.date,
      time: prepared.payload.time,
      items: prepared.payload.items,
      expected_total: prepared.payload.expectedTotal,
      currency: 'THB',
      customer_name: prepared.payload.customerName,
      phone: prepared.payload.phone,
    },
    exact_confirmation_phrase_th: 'ยืนยันสั่ง',
  };
}

async function commitPreparedRestaurantPreorder(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok: false, error: 'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;
  const confirmationId = textArg(args, 'confirmation_id', 80);
  if (!confirmationId) return { ok: false, error: 'confirmation_id_required' };
  const prepared = await loadPreparedRestaurantPreorder(context.guestDbId);
  if (!prepared || prepared.confirmationId !== confirmationId) return { ok:false, error:'prepared_restaurant_preorder_not_found' };
  if (prepared.status === 'committed' && prepared.result) return { ok:true, committed:true, replayed:true, ...prepared.result };
  if (prepared.environment !== mode.environment) return { ok:false, error:'prepared_transaction_environment_mismatch' };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok:false, error:'prepared_transaction_expired' };
  if (prepared.preparedEventId === context.eventId) return { ok:false, error:'same_turn_commit_blocked' };
  if (!currentTurnExplicitlyConfirmsPreparedBooking(context.message)) {
    return { ok:false, error:'explicit_customer_confirmation_required', exact_confirmation_phrase_th:'ยืนยันสั่ง' };
  }

  if (mode.environment === 'test') {
    await upsertCustomerAccount({
      guestDbId: context.guestDbId,
      fullName: prepared.payload.customerName,
      phone: prepared.payload.phone,
      email: prepared.payload.email,
      isTest: true,
      testLabel: 'Thongthai Agent restaurant transaction certification',
    });
  }

  const created = await createRestaurantPreorder({
    guestDbId: context.guestDbId,
    channel: context.channel,
    date: prepared.payload.date,
    time: prepared.payload.time,
    items: prepared.payload.items.map(item => ({ name:item.name, quantity:item.quantity })),
    customerName: prepared.payload.customerName,
    phone: prepared.payload.phone,
    email: prepared.payload.email,
    note: prepared.payload.note,
  });

  const result = {
    preorderId: created.id,
    preorderCode: created.preorderCode,
    status: created.status,
    totalAmount: Number(created.totalAmount),
    notificationStatus: created.notificationStatus,
  };
  await savePreparedRestaurantPreorder(context.guestDbId, { ...prepared, status:'committed', result });
  return {
    ok: true,
    committed: true,
    replayed: Boolean(created.duplicate),
    preorder_code: created.preorderCode,
    preorder_status: created.status,
    total_amount: created.totalAmount,
    requested_for: created.requestedFor,
    environment: created.environment,
    notification_status: created.notificationStatus,
    customer_copy_rule: 'This is a preorder created by operations. Do not say payment is verified unless payment status separately confirms it.',
  };
}

async function loadPreparedOtopOrder(guestDbId: string): Promise<PreparedOtopOrder | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const raw = snapshot.state[OTOP_ORDER_STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<PreparedOtopOrder>;
  if (value.version !== 1 || value.kind !== 'otop_order' || typeof value.confirmationId !== 'string') return null;
  return value as PreparedOtopOrder;
}

async function savePreparedOtopOrder(guestDbId: string, value: PreparedOtopOrder): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [OTOP_ORDER_STATE_KEY]: value } });
  if (!ok) throw new Error('prepared_otop_order_state_unavailable');
}

async function prepareOtopOrder(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const sku = textArg(args, 'sku', 120);
  const quantity = intArg(args, 'quantity', 1, 99);
  const fulfillmentRaw = textArg(args, 'fulfillment_type', 16);
  const fulfillmentType = fulfillmentRaw === 'shipping' ? 'shipping' : fulfillmentRaw === 'pickup' ? 'pickup' : null;
  const shippingAddress = textArg(args, 'shipping_address', 800);
  const customerName = textArg(args, 'customer_name', 160);
  const phone = textArg(args, 'phone', 40);
  const email = textArg(args, 'email', 200);
  const note = textArg(args, 'note', 600);

  const missing:string[] = [];
  if (!sku) missing.push('sku');
  if (!quantity) missing.push('quantity');
  if (!fulfillmentType) missing.push('fulfillment_type');
  if (fulfillmentType === 'shipping' && !shippingAddress) missing.push('shipping_address');
  if (!customerName) missing.push('customer_name');
  if (!validPhone(phone)) missing.push('phone');
  if (missing.length) return { ok:false, error:'missing_or_invalid_fields', missing_fields:missing };

  const products = await listOtopProducts(mode.environment);
  const product = products.find(item => item.sku === sku);
  if (!product) return { ok:false, error:'product_not_available' };
  if (product.stock < quantity!) {
    return { ok:false, error:'insufficient_stock', available_stock:product.stock, requested_quantity:quantity };
  }

  const now = new Date();
  const prepared:PreparedOtopOrder = {
    version:1,
    kind:'otop_order',
    status:'prepared',
    confirmationId:randomUUID(),
    preparedEventId:context.eventId,
    preparedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+PREPARED_TTL_MS).toISOString(),
    environment:mode.environment,
    payload:{
      sku:product.sku,
      productName:product.name,
      quantity:quantity!,
      unitPrice:Number(product.price),
      expectedTotal:Number(product.price)*quantity!,
      fulfillmentType:fulfillmentType!,
      shippingAddress:fulfillmentType==='shipping' ? shippingAddress : null,
      customerName:customerName!,
      phone:phone!,
      email,
      note,
    },
  };
  await savePreparedOtopOrder(context.guestDbId, prepared);
  return {
    ok:true,
    prepared:true,
    confirmation_id:prepared.confirmationId,
    expires_at:prepared.expiresAt,
    summary:{
      sku:prepared.payload.sku,
      product_name:prepared.payload.productName,
      quantity:prepared.payload.quantity,
      unit_price:prepared.payload.unitPrice,
      expected_total:prepared.payload.expectedTotal,
      currency:'THB',
      fulfillment_type:prepared.payload.fulfillmentType,
      shipping_address:prepared.payload.shippingAddress,
      customer_name:prepared.payload.customerName,
      phone:prepared.payload.phone,
      stock_checked:true,
    },
    confirmation_required:true,
    exact_confirmation_phrase_th:'ยืนยันสั่ง',
    instruction:'Do not call commit_prepared_otop_order in this same customer turn. Show the exact summary and ask for explicit confirmation.',
  };
}

async function getPreparedOtopOrder(
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;
  const prepared = await loadPreparedOtopOrder(context.guestDbId);
  if (!prepared) return { ok:true, prepared:false };
  if (prepared.environment !== mode.environment) return { ok:true, prepared:false };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok:true, prepared:false, expired:true };
  if (prepared.status === 'committed') {
    return { ok:true, prepared:false, committed:true, confirmation_id:prepared.confirmationId, result:prepared.result ?? null };
  }
  return {
    ok:true,
    prepared:true,
    confirmation_id:prepared.confirmationId,
    expires_at:prepared.expiresAt,
    summary:{
      sku:prepared.payload.sku,
      product_name:prepared.payload.productName,
      quantity:prepared.payload.quantity,
      unit_price:prepared.payload.unitPrice,
      expected_total:prepared.payload.expectedTotal,
      currency:'THB',
      fulfillment_type:prepared.payload.fulfillmentType,
      shipping_address:prepared.payload.shippingAddress,
      customer_name:prepared.payload.customerName,
      phone:prepared.payload.phone,
    },
    exact_confirmation_phrase_th:'ยืนยันสั่ง',
  };
}

export function agentOtopCheckoutIdempotencyKey(confirmationId: string): string {
  return `thongthai-agent-otop:${confirmationId.trim()}`;
}

async function commitPreparedOtopOrder(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;
  const confirmationId = textArg(args, 'confirmation_id', 80);
  if (!confirmationId) return { ok:false, error:'confirmation_id_required' };
  const prepared = await loadPreparedOtopOrder(context.guestDbId);
  if (!prepared || prepared.confirmationId !== confirmationId) return { ok:false, error:'prepared_otop_order_not_found' };
  if (prepared.status === 'committed' && prepared.result) return { ok:true, committed:true, replayed:true, ...prepared.result };
  if (prepared.environment !== mode.environment) return { ok:false, error:'prepared_transaction_environment_mismatch' };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok:false, error:'prepared_transaction_expired' };
  if (prepared.preparedEventId === context.eventId) return { ok:false, error:'same_turn_commit_blocked' };
  if (!currentTurnExplicitlyConfirmsPreparedBooking(context.message)) {
    return { ok:false, error:'explicit_customer_confirmation_required', exact_confirmation_phrase_th:'ยืนยันสั่ง' };
  }

  const p=prepared.payload;
  const latestProducts=await listOtopProducts(mode.environment);
  const latest=latestProducts.find(item=>item.sku===p.sku);
  if (!latest) return { ok:false, error:'product_not_available' };
  if (latest.stock < p.quantity) return { ok:false, error:'insufficient_stock', available_stock:latest.stock };
  if (Number(latest.price)!==p.unitPrice) {
    return {
      ok:false,
      error:'product_price_changed_reprepare_required',
      previous_unit_price:p.unitPrice,
      current_unit_price:Number(latest.price),
    };
  }

  const created=await createOtopOrder({
    guestDbId:context.guestDbId,
    channel:context.channel,
    sku:p.sku,
    quantity:p.quantity,
    customerName:p.customerName,
    phone:p.phone,
    email:p.email,
    fulfillmentType:p.fulfillmentType,
    shippingAddress:p.shippingAddress,
    note:p.note,
    environment:mode.environment,
    checkoutIdempotencyKey:agentOtopCheckoutIdempotencyKey(prepared.confirmationId),
  });
  const notificationStatus=mode.environment==='live'
    ? await dispatchCreatedTransactionNotification('otop_order',created.id)
    : 'ignored_test_mode';
  const result={orderId:created.id,orderCode:created.orderCode,total:created.total,notificationStatus};
  await savePreparedOtopOrder(context.guestDbId,{...prepared,status:'committed',result});
  return {
    ok:true,
    committed:true,
    replayed:false,
    order_code:created.orderCode,
    total:created.total,
    notification_status:notificationStatus,
    customer_copy_rule:'This is an OTOP order created by operations. Do not say payment is verified or shipping has begun unless later status tools confirm it.',
  };
}

async function loadPreparedCafeInquiry(guestDbId: string): Promise<PreparedCafeInquiry | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const raw = snapshot.state[CAFE_INQUIRY_STATE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<PreparedCafeInquiry>;
  if (value.version !== 1 || value.kind !== 'cafe_inquiry' || typeof value.confirmationId !== 'string') return null;
  return value as PreparedCafeInquiry;
}

async function savePreparedCafeInquiry(guestDbId: string, value: PreparedCafeInquiry): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [CAFE_INQUIRY_STATE_KEY]: value } });
  if (!ok) throw new Error('prepared_cafe_inquiry_state_unavailable');
}

export function currentTurnExplicitlyConfirmsCafeInquiry(message: string): boolean {
  if (hasCancelMarker(message) || hasCorrectionMarker(message) || /ยังไม่ส่ง|ไม่ต้องส่ง|เอาไว้ก่อน|ไว้ก่อน/u.test(message)) return false;
  if (/[?？]|ไหม|มั้ย|หรือเปล่า|รึเปล่า|ได้ไหม|ได้มั้ย/u.test(message)) return false;
  return /ยืนยัน\s*ส่ง\s*(?:คำถาม|เรื่อง|ให้ทีม)?|ส่ง\s*(?:คำถาม|เรื่องนี้)?\s*ให้ทีม(?:เลย)?|ส่งให้ทีมเลย/u.test(message);
}

async function prepareCafeInquiry(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const question = textArg(args, 'question', 1800);
  const customerName = textArg(args, 'customer_name', 160);
  const phone = textArg(args, 'phone', 40);
  const email = textArg(args, 'email', 200);

  const missing:string[] = [];
  if (!question || question.length < 3) missing.push('question');
  if (!customerName) missing.push('customer_name');
  if (!validPhone(phone)) missing.push('phone');
  if (missing.length) return { ok:false, error:'missing_or_invalid_fields', missing_fields:missing };

  const now = new Date();
  const prepared:PreparedCafeInquiry = {
    version:1,
    kind:'cafe_inquiry',
    status:'prepared',
    confirmationId:randomUUID(),
    preparedEventId:context.eventId,
    preparedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+PREPARED_TTL_MS).toISOString(),
    environment:mode.environment,
    payload:{
      question:question!,
      customerName:customerName!,
      phone:phone!,
      email,
    },
  };
  await savePreparedCafeInquiry(context.guestDbId, prepared);
  return {
    ok:true,
    prepared:true,
    confirmation_id:prepared.confirmationId,
    expires_at:prepared.expiresAt,
    summary:{
      question:prepared.payload.question,
      customer_name:prepared.payload.customerName,
      phone:prepared.payload.phone,
      email:prepared.payload.email,
    },
    confirmation_required:true,
    exact_confirmation_phrase_th:'ยืนยันส่งคำถาม',
    instruction:'Do not call commit_prepared_cafe_inquiry in this same customer turn. Show the exact handoff summary and ask for explicit confirmation.',
  };
}

async function getPreparedCafeInquiry(
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;
  const prepared = await loadPreparedCafeInquiry(context.guestDbId);
  if (!prepared) return { ok:true, prepared:false };
  if (prepared.environment !== mode.environment) return { ok:true, prepared:false };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok:true, prepared:false, expired:true };
  if (prepared.status === 'committed') {
    return { ok:true, prepared:false, committed:true, confirmation_id:prepared.confirmationId, result:prepared.result ?? null };
  }
  return {
    ok:true,
    prepared:true,
    confirmation_id:prepared.confirmationId,
    expires_at:prepared.expiresAt,
    summary:{
      question:prepared.payload.question,
      customer_name:prepared.payload.customerName,
      phone:prepared.payload.phone,
      email:prepared.payload.email,
    },
    exact_confirmation_phrase_th:'ยืนยันส่งคำถาม',
  };
}

async function commitPreparedCafeInquiry(
  args: Record<string, unknown>,
  context: ThongthaiAgentTransactionContext,
): Promise<Record<string, unknown>> {
  if (!context.guestDbId) return { ok:false, error:'guest_identity_required' };
  const mode = modeAllowed(context);
  if (!mode.ok) return mode;

  const confirmationId = textArg(args, 'confirmation_id', 80);
  if (!confirmationId) return { ok:false, error:'confirmation_id_required' };
  const prepared = await loadPreparedCafeInquiry(context.guestDbId);
  if (!prepared || prepared.confirmationId !== confirmationId) return { ok:false, error:'prepared_cafe_inquiry_not_found' };
  if (prepared.status === 'committed' && prepared.result) return { ok:true, committed:true, replayed:true, ...prepared.result };
  if (prepared.environment !== mode.environment) return { ok:false, error:'prepared_transaction_environment_mismatch' };
  if (Date.parse(prepared.expiresAt) <= Date.now()) return { ok:false, error:'prepared_transaction_expired' };
  if (prepared.preparedEventId === context.eventId) return { ok:false, error:'same_turn_commit_blocked' };
  if (!currentTurnExplicitlyConfirmsCafeInquiry(context.message)) {
    return { ok:false, error:'explicit_customer_confirmation_required', exact_confirmation_phrase_th:'ยืนยันส่งคำถาม' };
  }

  const created = await createCafeInquiry({
    guestDbId:context.guestDbId,
    channel:context.channel,
    question:prepared.payload.question,
    customerName:prepared.payload.customerName,
    phone:prepared.payload.phone,
    email:prepared.payload.email,
    environment:mode.environment,
  });
  const notificationStatus = mode.environment === 'live'
    ? await dispatchCreatedTransactionNotification('cafe_inquiry', created.id)
    : 'ignored_test_mode';

  const result = {
    inquiryId:created.id,
    inquiryCode:created.inquiryCode,
    notificationStatus,
  };
  await savePreparedCafeInquiry(context.guestDbId, { ...prepared, status:'committed', result });

  const staffNotified = notificationStatus === 'sent' || notificationStatus === 'duplicate';
  return {
    ok:true,
    committed:true,
    replayed:false,
    inquiry_code:created.inquiryCode,
    notification_status:notificationStatus,
    staff_notified:staffNotified,
    customer_copy_rule: staffNotified
      ? 'The inquiry is recorded and staff notification was delivered. Do not imply a cafe order, payment, reservation, or staff response has been completed.'
      : 'The inquiry is recorded, but staff delivery is NOT confirmed. Do not say the team received it. Do not imply a cafe order, payment, reservation, or staff response has been completed.',
  };
}

export async function executeThongthaiTransactionTool(
  name: string,
  rawArgs: unknown,
  context: ThongthaiAgentTransactionContext,
): Promise<string> {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {};

  // Production prepare-only mode may persist a non-consequential draft for
  // customer review, but it must be impossible to cross the business-write
  // boundary even if an Agent somehow asks for a commit tool by name.
  if (context.transactionMode === 'prepare' && COMMIT_TRANSACTION_TOOL_NAMES.has(name)) {
    return JSON.stringify({
      ok: false,
      error: 'transaction_commit_disabled',
      prepared_only: true,
      instruction: 'Keep the prepared draft pending. Do not claim a booking/order/inquiry was submitted.',
    });
  }

  let result: Record<string, unknown>;
  if (name === 'prepare_activity_booking') {
    result = await prepareActivityBooking(args, context);
  } else if (name === 'get_prepared_activity_booking') {
    result = await getPreparedActivityBooking(context);
  } else if (name === 'commit_prepared_activity_booking') {
    result = await commitPreparedActivityBooking(args, context);
  } else if (name === 'prepare_stay_booking') {
    result = await prepareStayBooking(args, context);
  } else if (name === 'get_prepared_stay_booking') {
    result = await getPreparedStayBooking(context);
  } else if (name === 'commit_prepared_stay_booking') {
    result = await commitPreparedStayBooking(args, context);
  } else if (name === 'prepare_restaurant_preorder') {
    result = await prepareRestaurantPreorder(args, context);
  } else if (name === 'get_prepared_restaurant_preorder') {
    result = await getPreparedRestaurantPreorder(context);
  } else if (name === 'commit_prepared_restaurant_preorder') {
    result = await commitPreparedRestaurantPreorder(args, context);
  } else if (name === 'prepare_otop_order') {
    result = await prepareOtopOrder(args, context);
  } else if (name === 'get_prepared_otop_order') {
    result = await getPreparedOtopOrder(context);
  } else if (name === 'commit_prepared_otop_order') {
    result = await commitPreparedOtopOrder(args, context);
  } else if (name === 'prepare_cafe_inquiry') {
    result = await prepareCafeInquiry(args, context);
  } else if (name === 'get_prepared_cafe_inquiry') {
    result = await getPreparedCafeInquiry(context);
  } else if (name === 'commit_prepared_cafe_inquiry') {
    result = await commitPreparedCafeInquiry(args, context);
  } else {
    result = { ok: false, error: 'unknown_transaction_tool' };
  }
  return JSON.stringify(result);
}
