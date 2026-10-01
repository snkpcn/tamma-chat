import { randomUUID } from 'node:crypto';
import type { BrainChannel } from './_thongthai-brain-v3';
import { loadActivityWorldFacts } from './_activity-sot';
import { createBooking, formatActivityAssetNote, listBookingOptions } from './_operations-db';
import { dispatchCreatedTransactionNotification } from './_transaction-notifications';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { hasCancelMarker, hasCommitMarker, hasExplicitNoTransactionMarker, hasStandaloneTransactionRequest } from './_slot-parsers';

export type ThongthaiAgentTransactionMode = 'off' | 'test' | 'live';

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
    description: 'Prepare an activity booking for explicit customer review. This NEVER creates a booking. After this tool returns, summarize the exact details and ask the customer to reply with the exact phrase "ยืนยันจอง" if they want the booking request submitted.',
    parameters: objectSchema({
      activity_code: { type: 'string', description: 'Canonical activity code from get_activity_catalog, for example horse.' },
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
] as const;

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

function modeAllowed(context: ThongthaiAgentTransactionContext): { ok: true; environment: 'live'|'test' } | { ok: false; error: string } {
  if (context.transactionMode === 'off') return { ok: false, error: 'transaction_tools_disabled' };
  if (context.transactionMode === 'test') return { ok: true, environment: 'test' };
  if (process.env.THONGTHAI_AGENT_LIVE_TRANSACTION_ENABLED !== '1') {
    return { ok: false, error: 'live_transaction_tools_not_enabled' };
  }
  return { ok: true, environment: 'live' };
}

export function currentTurnExplicitlyConfirmsPreparedBooking(message: string): boolean {
  if (hasExplicitNoTransactionMarker(message) || hasCancelMarker(message)) return false;
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

export async function executeThongthaiTransactionTool(
  name: string,
  rawArgs: unknown,
  context: ThongthaiAgentTransactionContext,
): Promise<string> {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {};

  let result: Record<string, unknown>;
  if (name === 'prepare_activity_booking') {
    result = await prepareActivityBooking(args, context);
  } else if (name === 'get_prepared_activity_booking') {
    result = await getPreparedActivityBooking(context);
  } else if (name === 'commit_prepared_activity_booking') {
    result = await commitPreparedActivityBooking(args, context);
  } else {
    result = { ok: false, error: 'unknown_transaction_tool' };
  }
  return JSON.stringify(result);
}
