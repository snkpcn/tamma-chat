// SNK MONEY x THONGTHAI -- typed client for the pf_* Postgres RPCs.
//
// Every balance, transaction, obligation and binding decision is made inside Postgres
// (see supabase/snk-os/*_snk_money_v1.sql, applied to the SNK LIFE OS project).  This file only calls those
// functions with the service-role key; it never computes a balance itself.
//
// The tool names mirror the finance.* contract the agent exposes:
//   get_accounts / get_balance / set_owner_balance / create_transaction / correct_transaction /
//   void_transaction / get_recent_transactions / create_recurring / update_recurring /
//   mark_due_paid / list_upcoming / get_summary / create_category

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export class PfLedgerError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'PfLedgerError';
  }
}

export type LedgerAccount = {
  id: string;
  name: string;
  kind: string;
  balance: number | string | null;
  balance_status: 'CONFIRMED' | 'DERIVED' | 'UNKNOWN';
  balance_confirmed_at: string | null;
};

export type LedgerTransaction = {
  id: string;
  kind: 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'ADJUSTMENT';
  status: 'CONFIRMED' | 'PENDING_CLARIFICATION' | 'VOIDED' | 'REVERSED';
  amount: number | string;
  occurred_on: string;
  account_id: string | null;
  account_name: string | null;
  to_account_id: string | null;
  to_account_name: string | null;
  category: string | null;
  payee: string | null;
  note: string | null;
  from_effect: number | string | null;
  balance_after: number | string | null;
  obligation_id: string | null;
  created_at: string;
};

export type LedgerObligation = {
  id: string;
  title: string;
  kind: 'EXPENSE' | 'INCOME';
  amount: number | string | null;
  frequency: string;
  next_due_date: string;
  default_account_id: string | null;
  default_account_name: string | null;
  category: string | null;
  reminder_days: number[];
  status: string;
  installments_paid: number;
  installments_total: number | null;
};

export type UpcomingItem = {
  obligation_id: string;
  title: string;
  kind: 'EXPENSE' | 'INCOME';
  amount: number | string | null;
  due_date: string;
  days_until: number;
  overdue: boolean;
  frequency: string;
  default_account_id: string | null;
  projected: boolean;
};

export type BindingLookup = {
  status: 'NONE' | 'PENDING' | 'ACTIVE';
  owner_id?: string | null;
  other_group_active?: boolean;
  failed_attempts?: number;
};

export type ActiveTarget = { id: string; owner_id: string; group_id_enc: string | null; group_id_hash: string };

type Json = Record<string, any>;

/**
 * The finance ledger lives in the SNK LIFE OS Supabase project (the one the Money dashboard reads), NOT in
 * the Thongthai/customer project.  Hence its own URL + service-role key; the Thongthai SUPABASE_* variables
 * are deliberately never used as a fallback.
 */
/** Public project URL of `snk-life-os-private` (not a secret); SNK_OS_SUPABASE_URL overrides it. */
export const SNK_OS_DEFAULT_URL = 'https://pbbihfipfbpiqbiqlagd.supabase.co';

function configured(): { url: string; key: string } {
  const url = process.env.SNK_OS_SUPABASE_URL || SNK_OS_DEFAULT_URL;
  const key = process.env.SNK_OS_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PfLedgerError('pf_db_not_configured');
  return { url: url.replace(/\/$/, ''), key };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional operator-pinned owner (a Supabase auth user id configured server-side, never taken from LINE).  When unset the owner is
 * resolved from the verified binding, which a dashboard-issued one-time code created.  A malformed value is a configuration error.
 */
export function configuredOwnerId(): string | null {
  const id = (process.env.SNK_MONEY_OWNER_ID ?? '').trim();
  if (!id) return null;
  if (!UUID_RE.test(id)) throw new PfLedgerError('pf_db_not_configured');
  return id;
}

/** Fails fast when the service-role key is missing: the whole feature is inert until it is set. */
export function assertLedgerConfigured(): void {
  configured();
}

export type BindingActivation = { ok: boolean; error?: string; method?: string; already_active?: boolean; owner_id?: string };

/** Owner-less binding operations (a group is PENDING before any owner is known). */
export class PfBindingClient {
  constructor(private readonly rpc: Rpc) {}
  async lookup(groupHash: string): Promise<BindingLookup> {
    return (await this.rpc('finance_binding_lookup_any', { p_group_hash: groupHash })) as BindingLookup;
  }
  async capture(groupHash: string, groupEnc: string | null, eventId: string): Promise<Json> {
    return (await this.rpc('finance_binding_capture_pending', { p_group_hash: groupHash, p_group_enc: groupEnc, p_event_id: eventId })) as Json;
  }
  async activateWithCode(groupHash: string, groupEnc: string | null, actor: string, code: string, groupName: string | null): Promise<BindingActivation> {
    return (await this.rpc('finance_binding_activate_code', { p_group_hash: groupHash, p_group_enc: groupEnc, p_actor: actor, p_code: code, p_group_name: groupName })) as BindingActivation;
  }
  async revoke(groupHash: string, actor: string): Promise<Json> {
    return (await this.rpc('finance_binding_revoke_group', { p_group_hash: groupHash, p_actor: actor })) as Json;
  }
  async activeTargets(): Promise<ActiveTarget[]> {
    return ((await this.rpc('finance_active_targets', {})) as ActiveTarget[] | null) ?? [];
  }
}

/** Production RPC transport: PostgREST with the service-role key (server side only). */
export const supabaseRpc: Rpc = async (fn, args) => {
  const c = configured();
  const response = await fetch(`${c.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    let code = '';
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      message = parsed.message ?? text;
      code = parsed.code ?? '';
    } catch { /* keep raw text */ }
    if (response.status === 404 || code === 'PGRST202') throw new PfLedgerError('pf_rpc_missing', `${fn} not found`);
    // only a deliberate `raise exception 'xyz'` (SQLSTATE P0001) from the engine becomes a domain code; anything else is generic
    throw new PfLedgerError(code === 'P0001' && /^[a-z_]+$/.test(message) ? message : `pf_rpc_${response.status}`, `${fn}: ${message.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
};

export class PfLedger {
  constructor(private readonly rpc: Rpc, private readonly ownerId: string) {}

  /** Every call is scoped to the configured owner; the RPCs filter on it (they run as security definer). */
  private async call<T = Json>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.rpc(fn, { ...args, p_owner: this.ownerId })) as T;
  }

  // -- accounts -------------------------------------------------------------------------------
  async getAccounts(): Promise<{ accounts: LedgerAccount[]; known_total: number; known_count: number; unknown_count: number }> {
    return this.call('finance_get_accounts');
  }
  async getBalance(accountId: string): Promise<LedgerAccount> {
    return this.call('finance_get_balance', { p_account: accountId });
  }
  async createAccount(i: { name: string; kind?: string | null; actor: string; message: string; idem: string }): Promise<{ ok: boolean; created: boolean; account: LedgerAccount }> {
    return this.call('finance_create_account', { p_name: i.name, p_kind: i.kind ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async setOwnerBalance(i: { accountId: string; amount: number; actor: string; message: string; idem: string; note?: string | null }): Promise<{
    ok: boolean; duplicate?: boolean; account: LedgerAccount; previous_balance: number | string | null; previous_status: string; delta: number | string | null; adjustment_id: string;
  }> {
    return this.call('finance_set_balance', { p_account: i.accountId, p_amount: i.amount, p_actor: i.actor, p_message: i.message, p_idem: i.idem, p_note: i.note ?? null });
  }

  async createCategory(i: { name: string; kind?: string | null; actor: string; message: string; idem: string }): Promise<{ ok: boolean; created: boolean; category: { id: string; name: string; kind: string } }> {
    return this.call('finance_create_category', { p_name: i.name, p_kind: i.kind ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }

  // -- transactions --------------------------------------------------------------------------------
  async createTransaction(i: {
    kind: 'EXPENSE' | 'INCOME' | 'TRANSFER'; amount: number; accountId: string | null; toAccountId?: string | null;
    category?: string | null; payee?: string | null; note?: string | null; occurredOn?: string | null;
    actor: string; message: string; idem: string; slipRef?: string | null; fileHash?: string | null;
  }): Promise<{ ok: boolean; duplicate?: boolean; transaction: LedgerTransaction; account: LedgerAccount | null; to_account: LedgerAccount | null }> {
    return this.call('finance_record_transaction', {
      p_kind: i.kind, p_amount: i.amount, p_account: i.accountId, p_to_account: i.toAccountId ?? null,
      p_category_name: i.category ?? null, p_payee: i.payee ?? null, p_note: i.note ?? null,
      p_occurred_on: i.occurredOn ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem,
      p_slip_ref: i.slipRef ?? null, p_file_hash: i.fileHash ?? null, p_unassigned_ok: false,
    });
  }
  async assignAccount(i: { txId: string; accountId: string; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_assign_account', { p_tx: i.txId, p_account: i.accountId, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async confirmUnassigned(i: { txId: string; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_confirm_unassigned', { p_tx: i.txId, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async voidTransaction(i: { txId: string; reason: string; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_void_transaction', { p_tx: i.txId, p_reason: i.reason, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async countRange(from: string, to: string): Promise<{ count: number; total: number }> {
    return this.call('finance_count_range', { p_from: from, p_to: to });
  }
  async voidRange(i: { from: string; to: string; reason: string; actor: string; message: string; idem: string }): Promise<{ ok: boolean; voided: number }> {
    return this.call('finance_void_range', { p_from: i.from, p_to: i.to, p_reason: i.reason, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async correctTransaction(i: {
    txId: string; kind?: string | null; amount?: number | null; accountId?: string | null; toAccountId?: string | null;
    category?: string | null; payee?: string | null; note?: string | null; occurredOn?: string | null;
    actor: string; message: string; idem: string;
  }): Promise<Json> {
    return this.call('finance_correct_transaction', {
      p_tx: i.txId, p_kind: i.kind ?? null, p_amount: i.amount ?? null, p_account: i.accountId ?? null, p_to_account: i.toAccountId ?? null,
      p_category_name: i.category ?? null, p_payee: i.payee ?? null, p_note: i.note ?? null, p_occurred_on: i.occurredOn ?? null,
      p_actor: i.actor, p_message: i.message, p_idem: i.idem,
    });
  }
  async updateTransactionMeta(i: { txId: string; category?: string | null; note?: string | null; payee?: string | null; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_update_transaction_meta', { p_tx: i.txId, p_category_name: i.category ?? null, p_note: i.note ?? null, p_payee: i.payee ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async getRecentTransactions(limit = 10): Promise<LedgerTransaction[]> {
    return (await this.call<LedgerTransaction[]>('finance_get_recent_transactions', { p_limit: limit, p_include_voided: false })) ?? [];
  }
  async findDuplicateSlip(i: { fileHash?: string | null; slipRef?: string | null; amount?: number | null; date?: string | null; payee?: string | null }): Promise<{ duplicate: boolean; reason?: string; transaction?: LedgerTransaction }> {
    return this.call('finance_find_duplicate_slip', { p_file_hash: i.fileHash ?? null, p_slip_ref: i.slipRef ?? null, p_amount: i.amount ?? null, p_date: i.date ?? null, p_payee: i.payee ?? null });
  }

  // -- recurring obligations ----------------------------------------------------------------------------
  async createRecurring(i: {
    title: string; kind: 'EXPENSE' | 'INCOME'; amount: number | null; frequency: string; intervalDays?: number | null; dayOfMonth?: number | null;
    firstDue: string; endDate?: string | null; installments?: number | null; defaultAccountId?: string | null; category?: string | null;
    reminderDays?: number[] | null; note?: string | null; actor: string; message: string; idem: string;
  }): Promise<{ ok: boolean; created: boolean; obligation: LedgerObligation }> {
    return this.call('finance_create_obligation', {
      p_title: i.title, p_kind: i.kind, p_amount: i.amount, p_frequency: i.frequency, p_interval_days: i.intervalDays ?? null,
      p_day_of_month: i.dayOfMonth ?? null, p_first_due: i.firstDue, p_end_date: i.endDate ?? null, p_installments_total: i.installments ?? null,
      p_default_account: i.defaultAccountId ?? null, p_category_name: i.category ?? null, p_reminder_days: i.reminderDays ?? null,
      p_note: i.note ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem,
    });
  }
  async updateRecurring(i: { id: string; patch: Record<string, unknown>; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_update_obligation', { p_id: i.id, p_patch: i.patch, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async markDuePaid(i: { obligationId: string; accountId?: string | null; amount?: number | null; paidOn?: string | null; actor: string; message: string; idem: string }): Promise<Json> {
    return this.call('finance_mark_due_paid', { p_obligation: i.obligationId, p_account: i.accountId ?? null, p_amount: i.amount ?? null, p_paid_on: i.paidOn ?? null, p_actor: i.actor, p_message: i.message, p_idem: i.idem });
  }
  async listUpcoming(from: string, to: string, limit = 60): Promise<UpcomingItem[]> {
    return (await this.call<UpcomingItem[]>('finance_list_upcoming', { p_from: from, p_to: to, p_limit: limit })) ?? [];
  }
  async forecast(to: string): Promise<Json> {
    return this.call('finance_forecast', { p_to: to });
  }
  async getSummary(from: string, to: string): Promise<Json> {
    return this.call('finance_get_summary', { p_from: from, p_to: to });
  }
  async setReminderDays(days: number[], actor: string, message: string): Promise<Json> {
    return this.call('finance_set_reminder_days', { p_days: days, p_actor: actor, p_message: message });
  }

  // -- conversation state & audit ---------------------------------------------------------------------------
  async pendingSet(actor: string, kind: string, payload: Json, ttlMinutes = 30): Promise<void> {
    await this.call('finance_pending_set', { p_actor: actor, p_kind: kind, p_payload: payload, p_ttl_minutes: ttlMinutes });
  }
  async pendingGet(actor: string): Promise<{ id: string; kind: string; payload: Json } | null> {
    return (await this.call<{ id: string; kind: string; payload: Json } | null>('finance_pending_get', { p_actor: actor })) ?? null;
  }
  async pendingClear(actor: string): Promise<void> {
    await this.call('finance_pending_clear', { p_actor: actor });
  }
  async logAudit(action: string, entityType: string, entityId: string | null, actor: string | null, message: string | null, meta: Json = {}): Promise<void> {
    await this.call('finance_log_audit', { p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_actor: actor, p_message: message, p_meta: meta });
  }

  // -- channel binding -------------------------------------------------------------------------------------------
  async bindingLookup(groupHash: string): Promise<BindingLookup> {
    return this.call('finance_binding_lookup', { p_group_hash: groupHash });
  }
  async bindingCapture(groupHash: string, groupEnc: string | null, eventId: string): Promise<Json> {
    return this.call('finance_binding_capture', { p_group_hash: groupHash, p_group_enc: groupEnc, p_event_id: eventId });
  }
  async bindingActivate(groupHash: string, actor: string, ownerVerified: boolean, code: string | null, groupName: string | null = null): Promise<{ ok: boolean; error?: string; method?: string; already_active?: boolean }> {
    return this.call('finance_binding_activate', { p_group_hash: groupHash, p_actor: actor, p_owner_verified: ownerVerified, p_code: code, p_group_name: groupName });
  }
  async bindingRevoke(groupHash: string, actor: string): Promise<Json> {
    return this.call('finance_binding_revoke', { p_group_hash: groupHash, p_actor: actor });
  }
  async bindingActiveTarget(): Promise<{ id: string; group_id_enc: string | null; group_id_hash: string } | null> {
    return (await this.call<{ id: string; group_id_enc: string | null; group_id_hash: string } | null>('finance_binding_active_target')) ?? null;
  }

  // -- roles / coach ----------------------------------------------------------------------------------------------
  async memberRole(actor: string): Promise<'OWNER' | 'AUTHORIZED_FINANCE_MEMBER' | 'NONE'> {
    return (await this.call<'OWNER' | 'AUTHORIZED_FINANCE_MEMBER' | 'NONE'>('finance_member_role', { p_actor: actor })) ?? 'NONE';
  }
  async confirmBalance(accountId: string, expected: number | null, actor: string, message: string, idem: string): Promise<{
    ok: boolean; error?: string; duplicate?: boolean; balance?: number | string; account?: LedgerAccount;
  }> {
    return this.call('finance_confirm_balance', { p_account: accountId, p_expected: expected, p_actor: actor, p_message: message, p_idem: idem });
  }
  async taskSetToday(taskId: string, flag: boolean, actor: string, message: string, idem: string): Promise<{ ok: boolean; error?: string; duplicate?: boolean; task?: { id: string; title: string } }> {
    return this.call('finance_task_set_today', { p_task: taskId, p_flag: flag, p_actor: actor, p_message: message, p_idem: idem });
  }
  async coachMorningData(today: string): Promise<Json> { return this.call('finance_coach_morning_data', { p_today: today }); }
  async coachEveningData(today: string): Promise<Json> { return this.call('finance_coach_evening_data', { p_today: today }); }
  async coachOpenTasks(limit = 50): Promise<Array<{ id: string; title: string; due_date: string | null }>> {
    return (await this.call('finance_coach_open_tasks', { p_limit: limit })) ?? [];
  }
  async coachClaim(kind: 'MORNING' | 'EVENING', date: string): Promise<{ claimed: boolean; delivery_id?: string }> {
    return this.call('finance_coach_claim', { p_kind: kind, p_date: date });
  }
  async coachFinish(deliveryId: string, ok: boolean, error?: string | null): Promise<void> {
    await this.call('finance_coach_finish', { p_delivery: deliveryId, p_ok: ok, p_error: error ?? null });
  }
  async taskSetDone(taskId: string, done: boolean, actor: string, message: string, idem: string): Promise<{ ok: boolean; error?: string; duplicate?: boolean; task?: { id: string; title: string } }> {
    return this.call('finance_task_set_done', { p_task: taskId, p_done: done, p_actor: actor, p_message: message, p_idem: idem });
  }
  async taskDefer(taskId: string, to: string, actor: string, message: string, idem: string): Promise<{ ok: boolean; error?: string; duplicate?: boolean; task?: { id: string; title: string } }> {
    return this.call('finance_task_defer', { p_task: taskId, p_to: to, p_actor: actor, p_message: message, p_idem: idem });
  }
  async secretaryApplyBatch(items: Json[], actor: string, message: string, idem: string, today: string): Promise<{
    ok: boolean; count: number; items: Array<{ kind: 'task' | 'event' | 'goal' | 'obligation'; id: string; title: string; created: boolean }>;
  }> {
    return this.call('secretary_apply_batch', { p_items: items, p_actor: actor, p_message: message, p_idem: idem, p_today: today });
  }
  async secretaryUpdateTask(taskId: string, patch: Json, actor: string, message: string, idem: string): Promise<{
    ok: boolean; error?: string; task?: { id: string; title: string; state: string };
  }> {
    return this.call('secretary_update_task', { p_task: taskId, p_patch: patch, p_actor: actor, p_message: message, p_idem: idem });
  }
  async secretaryUpdateEvent(eventId: string, patch: Json, actor: string, message: string, idem: string): Promise<{
    ok: boolean; error?: string; event?: { id: string; title: string };
  }> {
    return this.call('secretary_update_event', { p_event: eventId, p_patch: patch, p_actor: actor, p_message: message, p_idem: idem });
  }
  async secretarySnapshot(actor: string, today: string): Promise<Json> {
    return this.call('secretary_state_snapshot', { p_actor: actor, p_today: today });
  }
  async secretaryMorningData(actor: string, today: string): Promise<Json> {
    return this.call('secretary_morning_data', { p_actor: actor, p_today: today });
  }
  async secretaryEveningData(actor: string, today: string): Promise<Json> {
    return this.call('secretary_evening_data', { p_actor: actor, p_today: today });
  }
  async dayCloseSetContext(date: string, context: Json): Promise<void> { await this.call('finance_day_close_set_context', { p_date: date, p_context: context }); }
  async dayCloseGet(since: string): Promise<{ local_date: string; status: 'OPEN' | 'CLOSED'; context: Json } | null> {
    return (await this.call<{ local_date: string; status: 'OPEN' | 'CLOSED'; context: Json } | null>('finance_day_close_get', { p_since: since })) ?? null;
  }
  async dayClose(date: string, note: string | null, actor: string, message: string): Promise<void> {
    await this.call('finance_day_close', { p_date: date, p_note: note, p_actor: actor, p_message: message });
  }

  // -- reminders ---------------------------------------------------------------------------------------------------
  async claimReminders(today: string, limit = 50): Promise<Array<{
    delivery_id: string; obligation_id: string; title: string; kind: string; amount: number | string | null; due_date: string;
    days_until: number; threshold: number; overdue: boolean; default_account: string | null;
  }>> {
    return (await this.call('finance_claim_reminders', { p_today: today, p_limit: limit })) ?? [];
  }
  async finishReminder(deliveryId: string, ok: boolean, error?: string | null): Promise<void> {
    await this.call('finance_finish_reminder', { p_delivery: deliveryId, p_ok: ok, p_error: error ?? null });
  }
}
