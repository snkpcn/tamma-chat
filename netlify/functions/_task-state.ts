// Phase D of the Thongthai one-mind architecture program (see THONGTHAI_HANDOFF.md).
//
// Working/Task State: what Thongthai is currently trying to DO, as distinct
// from what the customer just said (Semantic Interpreter, Phase B) and from
// the bounded conversational memory of how the exchange got here
// (Conversation Continuity, Phase C). A SemanticTurn is an interpretation of
// one message. An ActiveTask is a standing, multi-turn goal that later turns
// update. The Dialog Manager (a later phase) is what actually merges a
// SemanticTurn into an ActiveTask -- this module only provides the container
// and its validated operations; it does not decide WHEN to apply them.
//
// Storage: extends the EXISTING guest_agent_state.state JSONB blob with a new
// `taskState` field -- additive, sibling to Phase C's `conversationContext`,
// same pattern as restaurantProposedSet/pendingPromotionRedemption. No new
// table, no migration.
//
// Core-stays-generic rule: this module does NOT embed per-domain business
// logic (e.g. "a horse booking requires a resourceCode, a date, a time and a
// party size"). That determination belongs to deterministic domain code (a
// later phase's Knowledge Resolver / domain layer), or -- for the three
// flows that already have real, tested business logic today -- to the
// EXISTING legacy functions (missingRestaurantPreorderFields,
// missingPromotionFields), which the adapters below call directly rather
// than re-deriving the same rule a second time. ActiveTaskType is only an
// identifier union; TASK_TRANSITIONS is only a generic status graph. Neither
// contains a branch on "what a horse booking needs."
//
// Strangler migration: booking_sessions, restaurantProposedSet and
// pendingPromotionRedemption are NOT touched, deleted, or written to by this
// module. The three adapters below are one-directional, read-only mappers
// (legacy state -> ActiveTask shape) for a future unified view; they do not
// feed back into the legacy flows, and the legacy flows keep running exactly
// as they do today until a later phase proves full equivalence. This module
// is also not yet wired into thongthai-chat.ts's request handling, matching
// how Phase C's conversation-context module was landed -- see
// THONGTHAI_HANDOFF.md's "Known gap" note.
import type { SemanticContextEntity, SemanticDomain } from './_semantic-interpreter';
import { missingPromotionFields, type PendingPromotionRedemption } from './_promotion-dialog';
import { missingRestaurantPreorderFields, type RestaurantProposedSetState } from './_restaurant-preorder-dialog';

export const TASK_STATE_SCHEMA_VERSION = 'task-state-v1';
export const MAX_RECENT_EVENT_IDS = 8;
export const MAX_CONSTRAINTS = 10;

export type ActiveTaskType =
  | 'activity_booking' | 'stay_booking' | 'restaurant_booking' | 'restaurant_preorder'
  | 'promotion_redemption' | 'otop_order' | 'cafe_inquiry' | 'membership' | 'journey_planning';

/** `superseded` is a distinct terminal status from `cancelled`: `cancelled`
 *  means the CUSTOMER explicitly cancelled; `superseded` means the SYSTEM
 *  evicted a bounded-stack suspended task to make room for a newer one. The
 *  two must never be conflated -- see D.1 in THONGTHAI_HANDOFF.md. */
export type ActiveTaskStatus =
  | 'collecting' | 'ready' | 'executing' | 'requested' | 'completed' | 'cancelled' | 'failed' | 'superseded';

export type ActiveTask = {
  taskId: string;
  type: ActiveTaskType;
  domain: SemanticDomain;
  status: ActiveTaskStatus;
  slots: Record<string, unknown>;
  missingFields: string[];
  selectedEntities: SemanticContextEntity[];
  constraints: string[];
  sourceChannel: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskStateContainer = {
  schemaVersion: typeof TASK_STATE_SCHEMA_VERSION;
  activeTask: ActiveTask | null;
  suspendedTask: ActiveTask | null;
  /** The most recent task the system evicted from the (bounded, single-slot)
   *  suspended position -- never the customer's own cancellation. Holds only
   *  the latest one (not a growing log), same bounded-by-design posture as
   *  suspendedTask itself. Null when nothing has ever been evicted. */
  lastSupersededTask: ActiveTask | null;
  recentEventIds: string[];
};

/** Identifiers only -- never business logic. What a task of a given type
 *  actually requires is decided by domain code, not by this map. */
export const TASK_TYPE_DOMAIN: Record<ActiveTaskType, SemanticDomain> = {
  activity_booking: 'activity',
  stay_booking: 'stay',
  restaurant_booking: 'restaurant',
  restaurant_preorder: 'restaurant',
  promotion_redemption: 'promotion',
  otop_order: 'otop',
  cafe_inquiry: 'cafe',
  membership: 'membership',
  journey_planning: 'journey',
};

/** Generic status graph -- not domain-specific. `failed`, `completed` and
 *  `cancelled` are all terminal: reopening a finished task is explicitly not
 *  supported here (create a new task instead), matching the Phase D brief's
 *  "do not allow requested -> collecting / completed -> executing" rule. */
// `superseded` is deliberately NOT a listed target from any status here: the
// only way a task becomes `superseded` is the internal eviction path in
// suspendActiveTask (via supersedeTask below), never a caller-driven
// transitionTask call -- so a customer-initiated action can never produce it,
// and an eviction can never masquerade as a validated user transition.
const TASK_TRANSITIONS: Record<ActiveTaskStatus, ActiveTaskStatus[]> = {
  collecting: ['ready', 'cancelled'],
  ready: ['executing', 'collecting', 'cancelled'],
  executing: ['requested', 'completed', 'failed', 'cancelled'],
  requested: ['completed', 'failed', 'cancelled'],
  completed: [],
  cancelled: [],
  failed: [],
  superseded: [],
};

export class TaskTransitionError extends Error {
  constructor(from: ActiveTaskStatus, to: ActiveTaskStatus) {
    super(`invalid_task_transition:${from}->${to}`);
    this.name = 'TaskTransitionError';
  }
}

export class TaskStateError extends Error {}

function generateTaskId(now: Date): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `task_${now.getTime().toString(36)}_${random}`;
}

function recomputeMissingFields(slots: Record<string, unknown>, requiredFields: readonly string[]): string[] {
  return requiredFields.filter(field => {
    const value = slots[field];
    return value === null || value === undefined || value === '';
  });
}

export function emptyTaskStateContainer(): TaskStateContainer {
  return { schemaVersion: TASK_STATE_SCHEMA_VERSION, activeTask: null, suspendedTask: null, lastSupersededTask: null, recentEventIds: [] };
}

export function createActiveTask(params: {
  type: ActiveTaskType;
  sourceChannel: string;
  initialSlots?: Record<string, unknown>;
  requiredFields?: readonly string[];
  domain?: SemanticDomain;
  now?: Date;
}): ActiveTask {
  const now = params.now ?? new Date();
  const slots = { ...(params.initialSlots ?? {}) };
  const requiredFields = params.requiredFields ?? [];
  const timestamp = now.toISOString();
  return {
    taskId: generateTaskId(now),
    type: params.type,
    domain: params.domain ?? TASK_TYPE_DOMAIN[params.type],
    status: 'collecting',
    slots,
    missingFields: recomputeMissingFields(slots, requiredFields),
    selectedEntities: [],
    constraints: [],
    sourceChannel: params.sourceChannel,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Shallow-merges slotPatch into task.slots. A key set to null/undefined in
 *  the patch DELETES that key (this is how a correction "replaces" a value
 *  rather than accumulating a second one -- slots is a keyed object, not an
 *  array, so there is nothing to deduplicate; overwrite IS the replace). */
export function mergeTaskSlots(
  task: ActiveTask, slotPatch: Record<string, unknown>, requiredFields: readonly string[] = [], now: Date = new Date(),
): ActiveTask {
  const slots = { ...task.slots };
  for (const [key, value] of Object.entries(slotPatch)) {
    if (value === null || value === undefined) delete slots[key];
    else slots[key] = value;
  }
  return { ...task, slots, missingFields: recomputeMissingFields(slots, requiredFields), updatedAt: now.toISOString() };
}

/** Replaces the full selected-entities list (a correction like "ไม่ใช่ เอา
 *  ภาราดร" means the NEW selection, not an addition to the old one). */
export function setSelectedEntities(task: ActiveTask, entities: SemanticContextEntity[], now: Date = new Date()): ActiveTask {
  return { ...task, selectedEntities: entities.slice(0, 6), updatedAt: now.toISOString() };
}

export function addTaskConstraint(task: ActiveTask, constraint: string, now: Date = new Date()): ActiveTask {
  const trimmed = constraint.trim();
  if (!trimmed) return task;
  if (task.constraints.includes(trimmed)) return task;
  return { ...task, constraints: [...task.constraints, trimmed].slice(-MAX_CONSTRAINTS), updatedAt: now.toISOString() };
}

export function transitionTask(task: ActiveTask, nextStatus: ActiveTaskStatus, now: Date = new Date()): ActiveTask {
  if (!TASK_TRANSITIONS[task.status].includes(nextStatus)) throw new TaskTransitionError(task.status, nextStatus);
  return { ...task, status: nextStatus, updatedAt: now.toISOString() };
}

export function canTransitionTask(from: ActiveTaskStatus, to: ActiveTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

const TERMINAL_STATUSES: ReadonlySet<ActiveTaskStatus> = new Set(['completed', 'cancelled', 'failed', 'superseded']);

/** System-internal eviction transformation -- NOT exposed via transitionTask
 *  and NOT reachable through TASK_TRANSITIONS. This is the ONLY function
 *  that produces `superseded`, and it is only ever called from
 *  suspendActiveTask when a bounded-stack eviction happens, never from a
 *  customer-driven action. A task already terminal is returned unchanged
 *  (idempotent, never resurrects or relabels a real customer cancellation). */
export function supersedeTask(task: ActiveTask, now: Date = new Date()): ActiveTask {
  if (TERMINAL_STATUSES.has(task.status)) return task;
  return { ...task, status: 'superseded', updatedAt: now.toISOString() };
}

/** Starts a brand-new task. Throws if an unfinished (non-terminal) task is
 *  already active -- the caller must suspend or cancel it first, so an
 *  in-progress task is never silently overwritten/contaminated by a new
 *  unrelated one. Starting a task while the PREVIOUS one is terminal is
 *  fine: it gets fresh slots/entities, proving no leakage between tasks. */
export function startNewActiveTask(
  container: TaskStateContainer,
  params: Parameters<typeof createActiveTask>[0],
  now: Date = new Date(),
): TaskStateContainer {
  if (container.activeTask && !TERMINAL_STATUSES.has(container.activeTask.status)) {
    throw new TaskStateError('active_task_already_in_progress');
  }
  return { ...container, activeTask: createActiveTask({ ...params, now }) };
}

/** Suspends the active task (a topic switch). No-op if nothing is active.
 *  Bounded to exactly one suspended slot: if a task is already suspended, it
 *  is EVICTED -- transitioned to `superseded`, never `cancelled` -- to make
 *  room, rather than growing an unlimited stack. This is a SYSTEM decision,
 *  not the customer's; conflating it with a customer-initiated cancellation
 *  would misreport intent (see D.1 in THONGTHAI_HANDOFF.md). The evicted
 *  task is preserved (not silently dropped) as `lastSupersededTask`, so a
 *  caller can still see what happened to it. */
export function suspendActiveTask(container: TaskStateContainer, now: Date = new Date()): TaskStateContainer {
  if (!container.activeTask) return container;
  const priorSuspended = container.suspendedTask;
  const lastSupersededTask = priorSuspended && !TERMINAL_STATUSES.has(priorSuspended.status)
    ? supersedeTask(priorSuspended, now)
    : container.lastSupersededTask;
  return { ...container, activeTask: null, suspendedTask: container.activeTask, lastSupersededTask };
}

/** Resumes the suspended task. No-op if nothing is suspended. If another
 *  task is currently active, the two swap (the current active task becomes
 *  suspended in turn) so neither is destroyed. */
export function resumeSuspendedTask(container: TaskStateContainer, now: Date = new Date()): TaskStateContainer {
  void now;
  if (!container.suspendedTask) return container;
  return { ...container, activeTask: container.suspendedTask, suspendedTask: container.activeTask };
}

// ---------------------------------------------------------------------------
// Idempotent event entry point (mirrors _conversation-context.ts's
// applyConversationContextUpdate). One dispatch point, one place duplicate
// webhook/message delivery is made a safe no-op.
// ---------------------------------------------------------------------------

export type TaskStateEvent =
  | { kind: 'start'; eventId: string; params: Parameters<typeof createActiveTask>[0] }
  | { kind: 'update_slots'; eventId: string; slotPatch: Record<string, unknown>; requiredFields?: readonly string[] }
  | { kind: 'set_entities'; eventId: string; entities: SemanticContextEntity[] }
  | { kind: 'add_constraint'; eventId: string; constraint: string }
  | { kind: 'transition'; eventId: string; nextStatus: ActiveTaskStatus }
  | { kind: 'suspend'; eventId: string }
  | { kind: 'resume'; eventId: string };

function recordEvent(container: TaskStateContainer, eventId: string): string[] {
  return [...container.recentEventIds, eventId].slice(-MAX_RECENT_EVENT_IDS);
}

export function applyTaskStateEvent(container: TaskStateContainer, event: TaskStateEvent, now: Date = new Date()): TaskStateContainer {
  if (container.recentEventIds.includes(event.eventId)) return container;
  const withEvent: TaskStateContainer = { ...container, recentEventIds: recordEvent(container, event.eventId) };

  switch (event.kind) {
    case 'start':
      return startNewActiveTask(withEvent, event.params, now);
    case 'update_slots': {
      if (!withEvent.activeTask) return withEvent;
      return { ...withEvent, activeTask: mergeTaskSlots(withEvent.activeTask, event.slotPatch, event.requiredFields ?? [], now) };
    }
    case 'set_entities': {
      if (!withEvent.activeTask) return withEvent;
      return { ...withEvent, activeTask: setSelectedEntities(withEvent.activeTask, event.entities, now) };
    }
    case 'add_constraint': {
      if (!withEvent.activeTask) return withEvent;
      return { ...withEvent, activeTask: addTaskConstraint(withEvent.activeTask, event.constraint, now) };
    }
    case 'transition': {
      if (!withEvent.activeTask) return withEvent;
      return { ...withEvent, activeTask: transitionTask(withEvent.activeTask, event.nextStatus, now) };
    }
    case 'suspend':
      return suspendActiveTask(withEvent, now);
    case 'resume':
      return resumeSuspendedTask(withEvent, now);
    default:
      return withEvent;
  }
}

// ---------------------------------------------------------------------------
// Serialization -- defensive parsing, since guest_agent_state.state is a
// JSONB blob that could in principle hold something malformed.
// ---------------------------------------------------------------------------

function isActiveTaskStatus(value: unknown): value is ActiveTaskStatus {
  return typeof value === 'string' && value in TASK_TRANSITIONS;
}
function isActiveTaskType(value: unknown): value is ActiveTaskType {
  return typeof value === 'string' && value in TASK_TYPE_DOMAIN;
}
function isValidActiveTask(value: unknown): value is ActiveTask {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<ActiveTask>;
  return typeof t.taskId === 'string' && isActiveTaskType(t.type) && isActiveTaskStatus(t.status)
    && typeof t.slots === 'object' && t.slots !== null && Array.isArray(t.missingFields) && Array.isArray(t.selectedEntities)
    && Array.isArray(t.constraints) && typeof t.sourceChannel === 'string' && typeof t.createdAt === 'string' && typeof t.updatedAt === 'string';
}

export function serializeTaskState(container: TaskStateContainer): string {
  return JSON.stringify(container);
}

export function parseTaskState(raw: unknown): TaskStateContainer {
  if (!raw || typeof raw !== 'object') return emptyTaskStateContainer();
  const candidate = raw as Partial<TaskStateContainer>;
  if (candidate.schemaVersion !== TASK_STATE_SCHEMA_VERSION) return emptyTaskStateContainer();
  const activeTask = isValidActiveTask(candidate.activeTask) ? candidate.activeTask : null;
  const suspendedTask = isValidActiveTask(candidate.suspendedTask) ? candidate.suspendedTask : null;
  const lastSupersededTask = isValidActiveTask(candidate.lastSupersededTask) ? candidate.lastSupersededTask : null;
  const recentEventIds = Array.isArray(candidate.recentEventIds) ? candidate.recentEventIds.filter((x): x is string => typeof x === 'string').slice(-MAX_RECENT_EVENT_IDS) : [];
  return { schemaVersion: TASK_STATE_SCHEMA_VERSION, activeTask, suspendedTask, lastSupersededTask, recentEventIds };
}

// ---------------------------------------------------------------------------
// Legacy adapters -- ONE-DIRECTIONAL, read-only mappers from existing state
// shapes into the ActiveTask shape. They reuse the REAL business logic that
// already exists (missingRestaurantPreorderFields, missingPromotionFields)
// rather than re-deriving a second copy of it. They do not write back to the
// legacy tables/fields and are not wired into any request handler yet.
// ---------------------------------------------------------------------------

const LEGACY_BOOKING_SESSION_STATUS: Record<string, ActiveTaskStatus> = {
  collecting: 'collecting', awaiting_phone: 'collecting', awaiting_special_request: 'collecting', needs_slot: 'collecting',
  ready: 'ready', submitted: 'completed', failed: 'failed', cancelled: 'cancelled',
};
const LEGACY_SERVICE_TYPE_TASK: Record<string, ActiveTaskType> = {
  restaurant: 'restaurant_booking', stay: 'stay_booking', activity: 'activity_booking',
};

export type LegacyBookingSessionRow = {
  service_type: string | null; resource_code: string | null; requested_date: string | null; requested_time: string | null;
  end_date: string | null; party_size: number | null; quantity: number; special_request: string | null;
  status: string; booking_code: string | null;
};

export function adaptBookingSessionToTask(row: LegacyBookingSessionRow, sourceChannel: string, now: Date = new Date()): ActiveTask | null {
  const type = row.service_type ? LEGACY_SERVICE_TYPE_TASK[row.service_type] : undefined;
  if (!type) return null;
  const slots: Record<string, unknown> = {};
  if (row.resource_code) slots.resourceCode = row.resource_code;
  if (row.requested_date) slots.date = row.requested_date;
  if (row.requested_time) slots.time = row.requested_time;
  if (row.end_date) slots.endDate = row.end_date;
  if (row.party_size != null) slots.partySize = row.party_size;
  if (row.quantity) slots.quantity = row.quantity;
  if (row.special_request) slots.specialRequest = row.special_request;
  if (row.booking_code) slots.bookingCode = row.booking_code;
  const timestamp = now.toISOString();
  const missingFields: string[] = [];
  if (!row.resource_code) missingFields.push('resourceCode');
  if (!row.requested_date) missingFields.push('date');
  if (!row.requested_time) missingFields.push('time');
  if (row.party_size == null && !row.quantity) missingFields.push('partySize');
  return {
    taskId: `legacy:booking_session:${sourceChannel}`,
    type, domain: TASK_TYPE_DOMAIN[type],
    status: LEGACY_BOOKING_SESSION_STATUS[row.status] ?? 'collecting',
    slots, missingFields, selectedEntities: [], constraints: [],
    sourceChannel, createdAt: timestamp, updatedAt: timestamp,
  };
}

export function adaptRestaurantProposedSetToTask(state: RestaurantProposedSetState, sourceChannel: string, now: Date = new Date()): ActiveTask {
  const timestamp = now.toISOString();
  const slots: Record<string, unknown> = { items: state.items, total: state.total ?? null, budget: state.budget ?? null, partySize: state.partySize ?? null };
  const draft = state.preorderDraft;
  const missingFields = draft ? missingRestaurantPreorderFields(draft) : ['date', 'time', 'customerName', 'phone'];
  if (draft) {
    slots.date = draft.date; slots.time = draft.time; slots.customerName = draft.customerName; slots.phone = draft.phone; slots.email = draft.email;
  }
  return {
    taskId: `legacy:restaurant_proposed_set:${sourceChannel}`,
    type: 'restaurant_preorder', domain: TASK_TYPE_DOMAIN.restaurant_preorder, status: 'collecting',
    slots, missingFields, selectedEntities: [], constraints: [],
    sourceChannel, createdAt: state.createdAt ?? timestamp, updatedAt: timestamp,
  };
}

export function adaptPendingPromotionRedemptionToTask(pending: PendingPromotionRedemption, sourceChannel: string, now: Date = new Date()): ActiveTask {
  const timestamp = now.toISOString();
  return {
    taskId: `legacy:pending_promotion_redemption:${pending.campaignId}`,
    type: 'promotion_redemption', domain: TASK_TYPE_DOMAIN.promotion_redemption, status: 'collecting',
    slots: {
      campaignId: pending.campaignId, campaignCode: pending.campaignCode, title: pending.title, items: pending.items,
      promoTotal: pending.promoTotal, date: pending.draft.date, time: pending.draft.time,
      customerName: pending.draft.customerName, phone: pending.draft.phone, email: pending.draft.email,
    },
    missingFields: missingPromotionFields(pending),
    selectedEntities: [], constraints: [],
    sourceChannel, createdAt: pending.draft.acceptedAt ?? timestamp, updatedAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// DB I/O -- same guest_agent_state.state JSONB blob Phase C extends, under a
// sibling `taskState` key. Deliberately duplicated dbFetch/configuration/eq
// helpers per file, matching this codebase's existing convention.
// ---------------------------------------------------------------------------

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}
async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = configuration(); if (!c) throw new Error('Supabase configuration missing');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Supabase ${res.status}: ${body.slice(0, 180)}`); }
  return res;
}
function eq(value: string): string { return encodeURIComponent(value); }

export async function loadTaskState(guestDbId: string | null): Promise<TaskStateContainer> {
  if (!guestDbId || !configuration()) return emptyTaskStateContainer();
  try {
    const res = await dbFetch(`guest_agent_state?guest_id=eq.${eq(guestDbId)}&select=state&limit=1`);
    const rows = await res.json() as Array<{ state?: Record<string, unknown> }>;
    return parseTaskState(rows[0]?.state?.taskState);
  } catch (error) {
    console.error('TASK_STATE_LOAD_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return emptyTaskStateContainer();
  }
}

export async function persistTaskState(guestDbId: string | null, container: TaskStateContainer): Promise<void> {
  if (!guestDbId || !configuration()) return;
  try {
    const res = await dbFetch(`guest_agent_state?guest_id=eq.${eq(guestDbId)}&select=state&limit=1`);
    const rows = await res.json() as Array<{ state?: Record<string, unknown> }>;
    const next = { ...(rows[0]?.state ?? {}), taskState: container };
    await dbFetch('guest_agent_state?on_conflict=guest_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ guest_id: guestDbId, state: next, updated_at: new Date().toISOString() }),
    });
  } catch (error) {
    console.error('TASK_STATE_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}
