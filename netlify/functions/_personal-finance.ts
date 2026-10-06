// SNK MONEY x THONGTHAI -- private personal-finance channel (scope PERSONAL_FINANCE_PRIVATE).
//
// Entry point for the LINE webhook.  Responsibilities:
//   * secure group binding   join -> PENDING (no permission) -> owner verification -> ACTIVE
//   * exclusive routing      an ACTIVE finance group is never seen by any business handler
//   * authorization          OWNER / AUTHORIZED_FINANCE_MEMBER / UNAUTHORIZED_MEMBER
//   * conversation state     confirmation, clarification, slip follow-up (stored server side)
//   * confidence policy      high -> act, medium -> one question, low -> no mutation
//
// It never computes a balance (Postgres does) and never talks to a bank.

import {
  PF_CONFIRM_THRESHOLD,
  addDays,
  bangkokToday,
  describeBalance,
  extractAmount,
  finalizeReply,
  findAccountMention,
  guessCategory,
  isNo,
  isYes,
  knownAccountFromText,
  money,
  monthEnd,
  monthStart,
  normalizeText,
  numberOrNull,
  pfEnabled,
  pfRoleFor,
  previousMonthRange,
  resolveAccount,
  thaiDate,
  weekRange,
  type PfRole,
} from './_personal-finance-core';
import { handleCoachText } from './_personal-finance-coach';
import { handleSecretaryText } from './_personal-secretary';
import {
  interpret,
  openAiInterpreter,
  type Horizon,
  type Interpretation,
  type LlmInterpreter,
  type NluContext,
  type PfIntent,
} from './_personal-finance-nlu';
import {
  PfBindingClient,
  PfLedger,
  PfLedgerError,
  assertLedgerConfigured,
  configuredOwnerId,
  supabaseRpc,
  type Rpc,
  type BindingLookup,
  type LedgerAccount,
  type LedgerTransaction,
  type UpcomingItem,
} from './_personal-finance-ledger';

export type PfEvent = {
  type?: string;
  replyToken?: string;
  timestamp?: number;
  webhookEventId?: string;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type?: string; text?: string };
};

export type SlipExtraction = {
  document_type: string;
  amount_total: number | null;
  document_date_local: string | null;
  merchant: string | null;
  reference_number: string | null;
  bank: string | null;
  confidence: number;
};

export type PfDeps = {
  /** Transport to the SNK LIFE OS ledger RPCs.  The owner is resolved from the verified binding, never from LINE. */
  rpc: Rpc;
  /** Optional operator-pinned owner (SNK_MONEY_OWNER_ID); enables the "owner types the phrase" activation path. */
  envOwnerId?: string | null;
  llm: LlmInterpreter | null;
  now: () => Date;
  env: Record<string, string | undefined>;
  hash: (value: string) => string | null;
  encrypt: (value: string) => string | null;
  isBusinessBound: (groupId: string) => Promise<boolean>;
  fetchImage?: (messageId: string) => Promise<{ bytes: Buffer; mimeType: string; sha256: string }>;
  extractSlip?: (bytes: Buffer, mimeType: string) => Promise<SlipExtraction>;
  /** Informational label only (never an identity): stored with the binding when LINE can tell us. */
  groupName?: (groupId: string) => Promise<string | null>;
  log?: (event: string, data: Record<string, unknown>) => void;
};

/** Dependencies with the owner-scoped ledger resolved (the shape every handler below works with). */
type PfRuntime = PfDeps & { ledger: PfLedger };

export type PfOutcome = { handled: boolean; reply: string | null };

const ACTIVATE_RE = /^(?:ยืนยันกลุ่มการเงิน|ยืนยัน\s*กลุ่ม\s*snk\s*money|ผูก(?:กลุ่ม)?\s*snk\s*money|ยืนยัน\s*snk\s*money)\s*(SNK-\d{6,8})?$/i;
const CODE_ONLY_RE = /^(SNK-\d{6,8})$/i;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

type Ctx = {
  deps: PfRuntime;
  actor: string;
  role: PfRole;
  messageId: string;
  today: string;
  confirmed: boolean;
};

const HELP_TEXT = [
  'ผมช่วยดูแลบัญชีส่วนตัวของคุณในกลุ่มนี้ได้ครับ พิมพ์แบบธรรมชาติได้เลย เช่น',
  '• “บัญชีใช้จ่ายตอนนี้เหลือ 85,000” – บอกยอดจริงของบัญชี',
  '• “จ่ายประกัน 18500” / “ได้เงินค่าเช่า 25000 เข้า SCB” – บันทึกรายจ่ายรายรับ',
  '• “ค่าเน็ต 599 ทุกวันที่ 5” – รายการที่ต้องจ่ายประจำ (ผมเตือน 7/3/1/0 วันก่อนครบกำหนด)',
  '• “จ่ายแล้ว” – ปิดรายการที่ครบกำหนด',
  '• “เดือนนี้หมดไปเท่าไหร่” / “อาทิตย์หน้ามีอะไรต้องจ่าย” – สรุป',
  '• “ยกเลิกรายการล่าสุด” / “เปลี่ยนจากค่าอาหารเป็นค่าเดินทาง” – แก้ไข (มีประวัติทุกครั้ง)',
  'ผมไม่เชื่อมธนาคาร ยอดทั้งหมดมาจากที่คุณบอกและรายการที่บันทึกเท่านั้นครับ',
].join('\n');

const FRIENDLY_FAILURE = 'ขออภัยครับ ตอนนี้บันทึกไม่สำเร็จ ผมยังไม่ได้บันทึกรายการนี้ กรุณาส่งอีกครั้งในอีกสักครู่ครับ';

// ================================================================== entry point

export async function handlePersonalFinanceEvent(event: PfEvent, deps: PfDeps): Promise<PfOutcome> {
  const none: PfOutcome = { handled: false, reply: null };
  if (event.source?.type !== 'group' || !event.source.groupId) return none;
  const groupId = event.source.groupId;
  const groupHash = deps.hash(groupId);
  if (!groupHash) return none;
  const log = deps.log ?? (() => undefined);

  const binding = new PfBindingClient(deps.rpc);
  let lookup: BindingLookup;
  try {
    lookup = await binding.lookup(groupHash);
  } catch (error) {
    if (error instanceof PfLedgerError && (error.code === 'pf_rpc_missing' || error.code === 'pf_db_not_configured')) {
      // Feature flag on but the ledger is not set up (migration / env): no finance group can exist yet,
      // so business groups must keep working untouched.
      log('PF_LEDGER_NOT_AVAILABLE', { code: error.code });
      return none;
    }
    // Cannot prove this is not the private finance group: fail closed (business chain must not see it).
    log('PF_BINDING_LOOKUP_FAILED', { error: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return { handled: true, reply: null };
  }

  const userId = event.source.userId ?? null;
  const actor = deps.hash(userId ?? 'unknown') ?? 'unknown';
  let role: PfRole = pfRoleFor(userId, deps.env);
  // Once ACTIVE the owner is the one that issued the dashboard code; bind the ledger to it.
  let runtime: PfRuntime | null = null;
  if (lookup.status === 'ACTIVE') {
    if (!lookup.owner_id) { log('PF_ACTIVE_WITHOUT_OWNER', {}); return { handled: true, reply: null }; }
    runtime = { ...deps, ledger: new PfLedger(deps.rpc, lookup.owner_id) };
    if (role === 'UNAUTHORIZED_MEMBER') {
      try {
        const dbRole = await runtime.ledger.memberRole(actor);
        if (dbRole === 'OWNER') role = 'OWNER';
        else if (dbRole === 'AUTHORIZED_FINANCE_MEMBER') role = 'AUTHORIZED_FINANCE_MEMBER';
      } catch (error) {
        log('PF_ROLE_LOOKUP_FAILED', { error: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
        return { handled: true, reply: null };
      }
    }
  }

  // -- bot added to a group: capture only, never grants anything -----------------------------------
  if (event.type === 'join') {
    if (lookup.status === 'NONE' && !(await deps.isBusinessBound(groupId))) {
      try {
        await binding.capture(groupHash, deps.encrypt(groupId), event.webhookEventId ?? `join:${event.timestamp ?? 0}`);
      } catch (error) {
        log('PF_BINDING_CAPTURE_FAILED', { error: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
      }
    }
    // Joining an arbitrary LINE group is never consent to disclose that the
    // bot has a private-finance capability. Capture a PENDING candidate
    // silently so an owner-initiated dashboard code can still activate it,
    // while unrelated/customer/business groups receive no SNK MONEY copy.
    return { handled: lookup.status === 'ACTIVE', reply: null };
  }

  if (event.type === 'leave') {
    if (lookup.status !== 'NONE') {
      try { await binding.revoke(groupHash, 'system:leave'); } catch { /* best effort */ }
    }
    return { handled: lookup.status !== 'NONE', reply: null };
  }

  if (event.type !== 'message') return { handled: lookup.status === 'ACTIVE', reply: null };

  const rawText = event.message?.type === 'text' ? (event.message.text ?? '') : null;
  const text = rawText === null ? null : normalizeText(rawText);

  // -- activation: only an exact phrase / code ------------------------------------------------------------
  if (text) {
    const act = ACTIVATE_RE.exec(text);
    const codeOnly = CODE_ONLY_RE.exec(text);
    if (act || codeOnly) {
      return handleActivation({ deps, binding, groupId, groupHash, lookup, role, actor, code: (act?.[1] ?? codeOnly?.[1] ?? null)?.toUpperCase() ?? null, explicit: Boolean(act) });
    }
  }

  if (lookup.status !== 'ACTIVE' || !runtime) return none;

  // From here the group is the verified finance group: nothing below may leak to or from business handlers.
  const messageId = event.message?.id ?? deps.hash(`${event.timestamp ?? 0}:${text ?? event.message?.type ?? ''}:${actor}`) ?? 'unknown';
  const base = { deps: runtime, actor, role, messageId, today: bangkokToday(deps.now()), confirmed: false } satisfies Ctx;

  try {
    if (role === 'UNAUTHORIZED_MEMBER') {
      if (text && /[0-9๐-๙]|บาท|บัญชี|ยอด|จ่าย|เงิน|โอน|สรุป|ล่าสุด|ยกเลิก/.test(text)) {
        await runtime.ledger.logAudit('UNAUTHORIZED_ATTEMPT', 'channel', null, actor, messageId, { kind: 'text' });
        return { handled: true, reply: finalizeReply('ขออภัยครับ เรื่องบัญชีในกลุ่มนี้ผมคุยได้เฉพาะเจ้าของและผู้ที่ได้รับสิทธิ์เท่านั้นครับ') };
      }
      if (event.message?.type === 'image') {
        await runtime.ledger.logAudit('UNAUTHORIZED_ATTEMPT', 'channel', null, actor, messageId, { kind: 'image' });
      }
      return { handled: true, reply: null };
    }
    if (event.message?.type === 'image') return { handled: true, reply: await handleImage(base) };
    if (text) return { handled: true, reply: await handleText(base, text, rawText ?? text) };
    return { handled: true, reply: null };
  } catch (error) {
    log('PF_HANDLER_ERROR', { error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return { handled: true, reply: finalizeReply(FRIENDLY_FAILURE) };
  }
}

// ================================================================== binding

async function handleActivation(i: {
  deps: PfDeps; binding: PfBindingClient; groupId: string; groupHash: string; lookup: BindingLookup; role: PfRole; actor: string; code: string | null; explicit: boolean;
}): Promise<PfOutcome> {
  const { deps, binding, groupId, groupHash, lookup, role, actor, code } = i;
  if (lookup.status === 'ACTIVE') {
    return { handled: true, reply: role === 'UNAUTHORIZED_MEMBER' ? null : finalizeReply('กลุ่มนี้ยืนยันเป็นกลุ่มการเงินส่วนตัวไว้แล้วครับ') };
  }
  // An already business-bound group can never become the finance group.
  if (await deps.isBusinessBound(groupId)) {
    return { handled: role === 'OWNER', reply: role === 'OWNER' ? finalizeReply('กลุ่มนี้ผูกกับทีมธุรกิจอยู่แล้ว จึงใช้เป็นกลุ่มการเงินส่วนตัวไม่ได้ครับ ให้สร้างกลุ่ม SNK MONEY ใหม่แยกต่างหากครับ') : null };
  }
  const ownerPinned = Boolean(deps.envOwnerId) && role === 'OWNER';
  // Without a dashboard code the only accepted proof is an env-configured owner LINE id AND an env-pinned owner id.
  if (!code && !ownerPinned) {
    return role !== 'OWNER'
      ? { handled: false, reply: null }
      : { handled: true, reply: finalizeReply('ต้องใช้รหัสยืนยันจากหน้า Money ใน SNK LIFE OS ครับ ขอรหัสแล้วพิมพ์ “ยืนยันกลุ่มการเงิน SNK-xxxxxxxx” ที่นี่ได้เลยครับ') };
  }

  if (lookup.status === 'NONE') {
    // Recover from a missed join event; the code (or the pinned owner) is the proof, not the group name.
    await binding.capture(groupHash, deps.encrypt(groupId), 'activation');
  }
  const groupName = deps.groupName ? await deps.groupName(groupId).catch(() => null) : null;
  let result: { ok: boolean; error?: string };
  if (deps.envOwnerId) {
    result = await new PfLedger(deps.rpc, deps.envOwnerId).bindingActivate(groupHash, actor, role === 'OWNER', code, groupName);
  } else {
    result = await binding.activateWithCode(groupHash, deps.encrypt(groupId), actor, code ?? '', groupName);
  }
  if (result.ok) {
    return {
      handled: true,
      reply: finalizeReply([
        'ยืนยันกลุ่ม SNK MONEY เรียบร้อยครับ ตั้งแต่นี้ผมจะดูแลบัญชีส่วนตัวและงานประจำวันในกลุ่มนี้เท่านั้น แยกจากงานธุรกิจทั้งหมด',
        'ผมไม่เชื่อมธนาคาร ยอดทั้งหมดมาจากที่คุณบอก เริ่มได้เลยครับ เช่น “บัญชีใช้จ่ายตอนนี้เหลือ 85,000”',
      ].join('\n')),
    };
  }
  if (result.error === 'another_group_active') {
    return { handled: true, reply: finalizeReply('มีกลุ่มการเงินที่ยืนยันไว้แล้วอยู่ครับ ใช้ได้ทีละกลุ่มเดียว ถ้าต้องการย้ายกลุ่มต้องยกเลิกกลุ่มเดิมก่อนครับ') };
  }
  if (result.error === 'no_pending_binding') return { handled: false, reply: null };
  return { handled: true, reply: finalizeReply('ยืนยันกลุ่มนี้ยังไม่ได้ครับ ต้องใช้รหัสยืนยันที่ถูกต้องและยังไม่หมดอายุจากหน้า Money ใน SNK LIFE OS ครับ') };
}

// ================================================================== text

const MUTATING = new Set([
  'SET_BALANCE', 'EXPENSE', 'INCOME', 'TRANSFER', 'CREATE_RECURRING', 'MARK_PAID', 'VOID_LAST', 'CORRECT_LAST',
  'CHANGE_CATEGORY_LAST', 'CHANGE_ACCOUNT_LAST', 'CREATE_ACCOUNT', 'CREATE_CATEGORY', 'SET_REMINDER_DAYS',
  'BULK_VOID', 'SET_BALANCES', 'OBLIGATION_REMINDERS', 'OBLIGATION_SILENCE', 'OBLIGATION_RESCHEDULE', 'CHANGE_DATE_LAST',
]);
// Members may record and read; the owner alone sets balances, edits history and changes structure/settings.
const OWNER_ONLY = new Set(['SET_BALANCE', 'SET_BALANCES', 'VOID_LAST', 'BULK_VOID', 'CORRECT_LAST', 'CHANGE_CATEGORY_LAST', 'CHANGE_ACCOUNT_LAST', 'CHANGE_DATE_LAST', 'CREATE_ACCOUNT', 'CREATE_CATEGORY', 'SET_REMINDER_DAYS', 'OBLIGATION_REMINDERS', 'OBLIGATION_SILENCE', 'OBLIGATION_RESCHEDULE']);

async function handleText(c: Ctx, text: string, rawText = text): Promise<string | null> {
  const { ledger } = c.deps;
  const [accountsRes, recent, pending] = await Promise.all([
    ledger.getAccounts(),
    ledger.getRecentTransactions(5),
    ledger.pendingGet(c.actor),
  ]);
  const accounts = accountsRes.accounts;

  if (pending) {
    const handled = await resolvePending(c, text, pending, accounts);
    if (handled.done) return handled.reply;
    await ledger.pendingClear(c.actor);
  }

  const secretary = await handleSecretaryText({
    ledger, actor: c.actor, messageId: c.messageId, today: c.today, isOwner: c.role === 'OWNER',
  }, rawText);
  if (secretary) return secretary.reply;

  const coach = await handleCoachText({ ledger, actor: c.actor, messageId: c.messageId, today: c.today, isOwner: c.role === 'OWNER' }, text, accounts);
  if (coach) {
    if ('reply' in coach) return coach.reply;
    return reply(await route(c, { intent: coach.delegate, confidence: 'high', source: 'rules' }, accounts, recent));
  }

  const ctx: NluContext = { today: c.today, accounts, hasLastTransaction: recent.some(t => t.kind !== 'ADJUSTMENT') || recent.length > 0 };
  const interp = await interpret(text, ctx, c.deps.llm);
  return reply(await route(c, interp, accounts, recent));
}

function reply(text: string | null): string | null {
  return text ? finalizeReply(text) : null;
}

async function askConfirm(c: Ctx, interp: Interpretation, question: string, strict = false): Promise<string> {
  await c.deps.ledger.pendingSet(c.actor, 'CONFIRM', { interp, messageId: c.messageId, strict }, 20);
  return `${question}\nพิมพ์ “ยืนยัน” เพื่อดำเนินการ หรือ “ไม่” เพื่อยกเลิก`;
}

async function route(c: Ctx, interp: Interpretation, accounts: LedgerAccount[], recent: LedgerTransaction[]): Promise<string | null> {
  const intent = interp.intent;

  if (OWNER_ONLY.has(intent.kind) && c.role !== 'OWNER') {
    return 'ขออภัยครับ รายการนี้เจ้าของกลุ่มเป็นผู้ทำได้เท่านั้น (ผู้ที่ได้รับสิทธิ์บันทึกรายจ่าย/รายรับและดูสรุปได้ครับ)';
  }

  if (intent.kind === 'UNCLEAR') {
    if (!intent.financeCue) return null;                       // ordinary chat: stay silent
    if (intent.hint === 'amount_only') return 'ตัวเลขนี้คือรายจ่าย รายรับ หรือยอดคงเหลือของบัญชีไหนครับ ผมยังไม่ได้บันทึกอะไร';
    return 'ขอรายละเอียดอีกนิดครับ เช่น จำนวนเงินและเป็นรายจ่ายหรือรายรับ ผมยังไม่ได้บันทึกอะไร (พิมพ์ “ช่วยอะไรได้บ้าง” ดูตัวอย่างได้ครับ)';
  }

  // A model-proposed write (capped at medium) always asks first.
  if (MUTATING.has(intent.kind) && interp.confidence !== 'high' && !c.confirmed) {
    return askConfirm(c, interp, `ผมเข้าใจว่า: ${describeIntent(intent)} ถูกต้องไหมครับ`);
  }

  // Large amounts are never executed on a single message.
  if (!c.confirmed && 'amount' in intent && typeof intent.amount === 'number' && intent.amount >= PF_CONFIRM_THRESHOLD && MUTATING.has(intent.kind)) {
    return askConfirm(c, interp, `จำนวนเงินสูง: ${describeIntent(intent)}`);
  }

  return execute(c, intent, accounts, recent);
}

function describeIntent(intent: PfIntent): string {
  switch (intent.kind) {
    case 'SET_BALANCE': return `ยอดบัญชี ${intent.accountHint ?? '(ยังไม่ระบุ)'} = ${money(intent.amount)}`;
    case 'EXPENSE': return `รายจ่าย ${intent.title ?? ''} ${money(intent.amount)}${intent.accountHint ? ` จาก ${intent.accountHint}` : ''}`.replace(/\s+/g, ' ');
    case 'INCOME': return `รายรับ ${intent.title ?? ''} ${money(intent.amount)}${intent.accountHint ? ` เข้า ${intent.accountHint}` : ''}`.replace(/\s+/g, ' ');
    case 'TRANSFER': return `โอน ${money(intent.amount)} จาก ${intent.fromHint} ไป ${intent.toHint}`;
    case 'MARK_PAID': return `ปิดรายการที่จ่ายแล้ว${intent.titleHint ? ` “${intent.titleHint}”` : ''}`;
    case 'VOID_LAST': return 'ยกเลิกรายการล่าสุด';
    case 'SET_BALANCES': return `ตั้งยอดเริ่มต้น ${intent.items.map(i => `${i.name} ${money(i.amount)}`).join(', ')}`;
    default: return intent.kind;
  }
}

// ================================================================== execution

type AcctResult = { kind: 'one'; account: LedgerAccount } | { kind: 'none' } | { kind: 'ambiguous'; candidates: LedgerAccount[] };

async function accountForHint(c: Ctx, hint: string | null, accounts: LedgerAccount[], opts: { create: boolean; kind?: string | null; useSingle?: boolean }): Promise<AcctResult> {
  // Only one tracked account exists: that is the reliable default, so don't ask.
  if (!hint) return opts.useSingle && accounts.length === 1 ? { kind: 'one', account: accounts[0] } : { kind: 'none' };
  const m = resolveAccount(hint, accounts);
  if (m.kind === 'one') return { kind: 'one', account: m.account as LedgerAccount };
  if (m.kind === 'ambiguous') return { kind: 'ambiguous', candidates: m.candidates as LedgerAccount[] };
  if (!opts.create) return { kind: 'none' };
  const known = knownAccountFromText(hint);
  const name = (known?.name ?? hint).slice(0, 80);
  const created = await c.deps.ledger.createAccount({
    name, kind: opts.kind ?? known?.kind ?? guessAccountKind(name), actor: c.actor, message: c.messageId, idem: `${c.messageId}:acct:${name.toLowerCase()}`,
  });
  accounts.push(created.account);
  return { kind: 'one', account: created.account };
}

function guessAccountKind(name: string): string {
  if (/เงินสด|cash/i.test(name)) return 'CASH';
  if (/กอง|ออม|เก็บ|ฉุกเฉิน|ภาษี|ประกัน/.test(name)) return 'POOL';
  return 'BANK';
}

function balanceNote(account: LedgerAccount | null): string {
  if (!account) return '';
  if (account.balance_status === 'UNKNOWN' || numberOrNull(account.balance) === null) {
    return `\n${account.name} ยังไม่มียอดที่คุณยืนยัน ผมเลยไม่คำนวณยอดคงเหลือให้ครับ (บอกยอดล่าสุดได้ เช่น “${account.name} เหลือ …”)`;
  }
  return `\nยอด ${account.name} ตอนนี้ (คำนวณจากยอดที่ยืนยัน + รายการ) ${money(account.balance)}`;
}

async function pickAccount(c: Ctx, candidates: LedgerAccount[], intent: PfIntent, side: 'from' | 'to' | null = null): Promise<string> {
  await c.deps.ledger.pendingSet(c.actor, 'PICK_ACCOUNT', { intent, side, messageId: c.messageId }, 20);
  return `มีบัญชีที่ใกล้เคียงหลายบัญชีครับ: ${candidates.map(a => a.name).join(', ')}\nหมายถึงบัญชีไหนครับ`;
}

async function execute(c: Ctx, intent: PfIntent, accounts: LedgerAccount[], recent: LedgerTransaction[]): Promise<string | null> {
  const { ledger } = c.deps;
  const idem = (op: string) => `${c.messageId}:${op}`;

  switch (intent.kind) {
    case 'NONE': return null;
    case 'HELP': return HELP_TEXT;
    case 'NEGATED': return 'รับทราบครับ ผมไม่ได้บันทึกอะไรเพิ่ม';
    case 'UNSUPPORTED_BULK':
      return 'ผมลบหรือล้างข้อมูลทั้งหมดให้ไม่ได้ครับ เพื่อความปลอดภัยของบัญชี ยกเลิกทีละรายการได้ เช่น “ยกเลิกรายการล่าสุด” (ทุกการแก้ไขมีประวัติเก็บไว้)';
    case 'UNCLEAR': return null;

    // -- owner states a balance ------------------------------------------------------------------------------
    case 'SET_BALANCE': {
      if (!intent.accountHint) {
        await ledger.pendingSet(c.actor, 'BALANCE_ACCOUNT', { amount: intent.amount, messageId: c.messageId }, 20);
        const names = accounts.map(a => a.name);
        return `ยอด ${money(intent.amount)} นี้เป็นของบัญชีไหนครับ${names.length ? ` (${names.join(', ')})` : ' (พิมพ์ชื่อบัญชีได้เลย)'} ผมยังไม่ได้บันทึกอะไร`;
      }
      const target = await accountForHint(c, intent.accountHint, accounts, { create: true, kind: intent.accountKind });
      if (target.kind === 'ambiguous') return pickAccount(c, target.candidates, intent);
      if (target.kind === 'none') return 'ไม่พบบัญชีนี้ครับ';
      const acct = target.account;
      const old = numberOrNull(acct.balance);
      if (!c.confirmed && old !== null && old >= 10_000 && Math.abs(intent.amount - old) / old >= 0.8) {
        return askConfirm(c, { intent, confidence: 'high', source: 'rules' }, `ยอด ${acct.name} เดิม ${money(old)} แต่คุณบอก ${money(intent.amount)} ต่างกันมาก`);
      }
      const res = await ledger.setOwnerBalance({ accountId: acct.id, amount: intent.amount, actor: c.actor, message: c.messageId, idem: idem('bal') });
      const delta = numberOrNull(res.delta);
      const lines = [`บันทึกยอด ${acct.name} = ${money(intent.amount)} (ยอดที่คุณยืนยัน) เรียบร้อยครับ`];
      if (delta !== null && delta !== 0 && res.previous_balance !== null) {
        lines.push(`ต่างจากยอดที่ระบบมีไว้เดิม (${money(res.previous_balance)}) ${money(Math.abs(delta))} ผมบันทึกเป็นรายการ “ปรับยอด” เท่านั้น ไม่ได้สร้างรายจ่ายหรือรายรับให้ครับ`);
      }
      return lines.join('\n');
    }

    // -- expense / income -------------------------------------------------------------------------------------------
    case 'EXPENSE':
    case 'INCOME': {
      const target = await accountForHint(c, intent.accountHint, accounts, { create: true, useSingle: true });
      if (target.kind === 'ambiguous') return pickAccount(c, target.candidates, intent);
      const accountId = target.kind === 'one' ? target.account.id : null;

      if (intent.kind === 'EXPENSE') {
        const matched = await matchObligation(c, intent.title ?? intent.category, intent.amount);
        if (matched) {
          const paid = await ledger.markDuePaid({ obligationId: matched.obligation_id, accountId, amount: intent.amount, paidOn: intent.date, actor: c.actor, message: c.messageId, idem: idem('paid') });
          if (paid.ok) return paidReply(paid);
          if (paid.error === 'account_required') {
            await ledger.pendingSet(c.actor, 'ASK_PAID_ACCOUNT', { obligationId: matched.obligation_id, amount: intent.amount, messageId: c.messageId }, 30);
            return `ตรงกับรายการ “${matched.title}” ที่ครบกำหนด ${thaiDate(matched.due_date)} ครับ จะปิดรายการนี้ให้ ตัดจากบัญชีไหนครับ`;
          }
        }
      }
      const res = await ledger.createTransaction({
        kind: intent.kind, amount: intent.amount, accountId, category: intent.category, payee: intent.title,
        occurredOn: intent.date ?? c.today, actor: c.actor, message: c.messageId, idem: idem('tx'),
      });
      const tx = res.transaction;
      const label = tx.category ?? intent.title ?? (intent.kind === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ');
      if (tx.status === 'PENDING_CLARIFICATION') {
        await ledger.pendingSet(c.actor, 'ASSIGN_ACCOUNT', { txId: tx.id, messageId: c.messageId }, 60);
        const names = accounts.map(a => a.name);
        return `บันทึก${intent.kind === 'EXPENSE' ? 'จ่าย' : 'รับ'} ${label} ${money(intent.amount)} ไว้ก่อนแล้วครับ ยังไม่ได้ตัดยอดบัญชีไหน\n${intent.kind === 'EXPENSE' ? 'ตัดจากบัญชีไหน' : 'เข้าบัญชีไหน'}ครับ${names.length ? ` (${names.join(', ')})` : ''} หรือพิมพ์ “ไม่ระบุ” ถ้าไม่เกี่ยวกับบัญชีที่ติดตามไว้`;
      }
      return `บันทึก${intent.kind === 'EXPENSE' ? 'จ่าย' : 'รับ'} ${label} ${money(intent.amount)}${res.account ? ` (${intent.kind === 'EXPENSE' ? 'จาก' : 'เข้า'} ${res.account.name})` : ''} เรียบร้อยครับ${balanceNote(res.account)}`;
    }

    case 'TRANSFER': {
      const from = await accountForHint(c, intent.fromHint, accounts, { create: true });
      const to = await accountForHint(c, intent.toHint, accounts, { create: true });
      if (from.kind === 'ambiguous') return pickAccount(c, from.candidates, intent, 'from');
      if (to.kind === 'ambiguous') return pickAccount(c, to.candidates, intent, 'to');
      if (from.kind !== 'one' || to.kind !== 'one' || from.account.id === to.account.id) return 'ระบุบัญชีต้นทางและปลายทางที่ต่างกันให้ชัดอีกนิดครับ ผมยังไม่ได้บันทึกอะไร';
      const res = await ledger.createTransaction({
        kind: 'TRANSFER', amount: intent.amount, accountId: from.account.id, toAccountId: to.account.id,
        occurredOn: c.today, actor: c.actor, message: c.messageId, idem: idem('tx'),
      });
      return `บันทึกโอนภายใน ${money(intent.amount)} จาก ${from.account.name} ไป ${to.account.name} เรียบร้อยครับ (เป็นการย้ายเงินในบัญชีของคุณ ไม่นับเป็นรายจ่าย)${balanceNote(res.account)}${balanceNote(res.to_account)}`;
    }

    // -- recurring ------------------------------------------------------------------------------------------------------------
    case 'CREATE_RECURRING': {
      if (!intent.firstDue) {
        await ledger.pendingSet(c.actor, 'ASK_DUE_DATE', { intent, messageId: c.messageId }, 30);
        return `“${intent.title}” ครบกำหนดวันที่เท่าไหร่ครับ (เช่น “วันที่ 5” หรือ “25/11”) ผมยังไม่ได้บันทึกอะไร`;
      }
      const target = await accountForHint(c, intent.accountHint, accounts, { create: true });
      const res = await ledger.createRecurring({
        title: intent.title, kind: intent.direction, amount: intent.amount, frequency: intent.frequency, intervalDays: intent.intervalDays,
        dayOfMonth: intent.dayOfMonth, firstDue: intent.firstDue, installments: intent.installments, category: intent.category,
        defaultAccountId: target.kind === 'one' ? target.account.id : null, actor: c.actor, message: c.messageId, idem: idem('rec'),
      });
      const o = res.obligation;
      const when = FREQUENCY_TH[o.frequency] ?? o.frequency;
      return [
        res.created ? `บันทึกรายการ “${o.title}” ${o.amount !== null ? money(o.amount) : '(ยังไม่ระบุจำนวน)'} ${when} ครบกำหนดถัดไป ${thaiDate(o.next_due_date)} เรียบร้อยครับ` : `มีรายการ “${o.title}” อยู่แล้ว ครบกำหนดถัดไป ${thaiDate(o.next_due_date)} ผมไม่สร้างซ้ำครับ`,
        `ผมจะเตือนในกลุ่มนี้ล่วงหน้า ${o.reminder_days.join('/')} วันก่อนครบกำหนด${o.default_account_name ? ` • ตัดจาก ${o.default_account_name}` : ''}`,
      ].join('\n');
    }

    case 'MARK_PAID': {
      const upcoming = await ledger.listUpcoming(c.today, addDays(c.today, 45), 100);
      const firsts = firstPerObligation(upcoming.filter(u => u.kind === 'EXPENSE'));
      let candidates = intent.titleHint ? firsts.filter(u => titleOverlap(u.title, intent.titleHint!)) : firsts.filter(u => u.overdue || u.days_until <= 7);
      if (!candidates.length && intent.titleHint && intent.amount === null) {
        return `ไม่พบรายการที่ต้องจ่ายชื่อ “${intent.titleHint}” ครับ ผมยังไม่ได้ปิดรายการใด`;
      }
      if (!candidates.length && intent.titleHint && intent.amount !== null) {
        return execute(c, { kind: 'EXPENSE', amount: intent.amount, accountHint: intent.accountHint, category: guessCategory(intent.titleHint), title: intent.titleHint, date: null }, accounts, recent);
      }
      if (!candidates.length) return 'ตอนนี้ไม่มีรายการที่ครบกำหนดหรือใกล้ครบกำหนดครับ ถ้าจ่ายอะไรไปบอกได้เลย เช่น “จ่ายประกัน 18500”';
      if (candidates.length > 1) {
        candidates = candidates.slice(0, 6);
        await ledger.pendingSet(c.actor, 'PICK_OBLIGATION', { candidates: candidates.map(u => ({ id: u.obligation_id, title: u.title, due: u.due_date })), accountHint: intent.accountHint, amount: intent.amount, messageId: c.messageId }, 30);
        return `จ่ายรายการไหนครับ\n${candidates.map((u, n) => `${n + 1}. ${u.title} ${u.amount !== null ? money(u.amount) : ''} (${thaiDate(u.due_date)}${u.overdue ? ' เลยกำหนด' : ''})`).join('\n')}\nตอบเป็นเลขหรือชื่อได้เลยครับ`;
      }
      return payObligation(c, candidates[0].obligation_id, candidates[0].title, intent.accountHint, intent.amount, accounts);
    }

    // -- corrections ----------------------------------------------------------------------------------------------------------------
    case 'VOID_LAST': {
      const tx = recent[0];
      if (!tx) return 'ยังไม่มีรายการให้ยกเลิกครับ';
      if (tx.kind === 'ADJUSTMENT') return 'รายการล่าสุดเป็นการปรับยอดบัญชี ยกเลิกย้อนไม่ได้ครับ แต่บอกยอดที่ถูกต้องใหม่ได้เลย เช่น “SCB เหลือ 70000”';
      if (!c.confirmed && Date.now() - Date.parse(tx.created_at) > SEVEN_DAYS_MS) {
        return askConfirm(c, { intent, confidence: 'high', source: 'rules' }, `รายการล่าสุดเป็นของวันที่ ${thaiDate(tx.occurred_on)}: ${txLine(tx)}`);
      }
      const res = await ledger.voidTransaction({ txId: tx.id, reason: 'owner_requested', actor: c.actor, message: c.messageId, idem: idem('void') });
      if (!res.ok) return res.error === 'already_voided' ? 'รายการนี้ถูกยกเลิกไปแล้วครับ' : 'ยกเลิกรายการนี้ไม่ได้ครับ';
      const reversalNote = res.reversal?.account_reversed === false ? '\n(ยอดบัญชีไม่ถูกปรับ เพราะคุณยืนยันยอดใหม่หลังรายการนี้แล้วครับ)' : '';
      return `ยกเลิกรายการ ${txLine(tx)} แล้วครับ (เก็บประวัติไว้ ไม่ได้ลบทิ้ง)${reversalNote}${balanceNote(res.account ?? null)}`;
    }

    case 'CORRECT_LAST': {
      const tx = recent.find(t => t.kind !== 'ADJUSTMENT');
      if (!tx) return 'ยังไม่มีรายการให้แก้ไขครับ';
      const res = await ledger.correctTransaction({ txId: tx.id, amount: intent.amount, actor: c.actor, message: c.messageId, idem: idem('fix') });
      if (!res.ok) return 'แก้ไขรายการนี้ไม่ได้ครับ';
      return `แก้จำนวนเงินจาก ${money(tx.amount)} เป็น ${money(intent.amount)} แล้วครับ (รายการเดิมเก็บไว้เป็นประวัติ)${balanceNote(res.account ?? null)}`;
    }

    case 'CHANGE_CATEGORY_LAST': {
      const tx = recent.find(t => t.kind !== 'ADJUSTMENT');
      if (!tx) return 'ยังไม่มีรายการให้แก้ไขครับ';
      const res = await ledger.updateTransactionMeta({ txId: tx.id, category: intent.category, actor: c.actor, message: c.messageId, idem: idem('cat') });
      if (!res.ok) return 'แก้หมวดรายการนี้ไม่ได้ครับ';
      return `เปลี่ยนหมวดของ ${money(tx.amount)} จาก “${tx.category ?? 'ไม่ระบุ'}” เป็น “${intent.category}” แล้วครับ`;
    }

    case 'CHANGE_ACCOUNT_LAST': {
      const tx = recent.find(t => t.kind !== 'ADJUSTMENT');
      if (!tx) return 'ยังไม่มีรายการให้แก้ไขครับ';
      const target = await accountForHint(c, intent.accountHint, accounts, { create: true });
      if (target.kind !== 'one') return 'ไม่แน่ใจว่าเป็นบัญชีไหนครับ ผมยังไม่ได้แก้อะไร';
      if (tx.status === 'PENDING_CLARIFICATION') {
        const res = await ledger.assignAccount({ txId: tx.id, accountId: target.account.id, actor: c.actor, message: c.messageId, idem: idem('acc') });
        return res.ok ? `ตั้งบัญชีของรายการ ${txLine(tx)} เป็น ${target.account.name} แล้วครับ${balanceNote(res.account ?? null)}` : 'แก้บัญชีไม่ได้ครับ';
      }
      const res = await ledger.correctTransaction({ txId: tx.id, accountId: target.account.id, actor: c.actor, message: c.messageId, idem: idem('acc') });
      return res.ok ? `ย้ายรายการ ${txLine(tx)} ไปบัญชี ${target.account.name} แล้วครับ (รายการเดิมเก็บไว้เป็นประวัติ)${balanceNote(res.account ?? null)}` : 'แก้บัญชีไม่ได้ครับ';
    }

    // -- high-risk bulk action -------------------------------------------------------------------------------------------------------
    case 'BULK_VOID': {
      const range = summaryRange(intent.period, c.today);
      const n = await ledger.countRange(range.from, range.to);
      if (!n.count) return `ไม่มีรายการใน${range.label}ให้ยกเลิกครับ`;
      if (!c.confirmed) {
        return askConfirm(c, { intent, confidence: 'high', source: 'rules' },
          `⚠ จะยกเลิก ${n.count} รายการของ${range.label} (${thaiDate(range.from)} – ${thaiDate(range.to)}) ยอดรวม ${money(n.total)} และคืนยอดบัญชีตามรายการ (ประวัติยังเก็บไว้ ไม่ได้ลบทิ้ง)`, true);
      }
      const res = await ledger.voidRange({ from: range.from, to: range.to, reason: 'owner_bulk_void', actor: c.actor, message: c.messageId, idem: idem('bulkvoid') });
      return `ยกเลิก ${res.voided} รายการของ${range.label}แล้วครับ (เก็บประวัติครบ ตรวจย้อนหลังได้)`;
    }

    // -- initial setup of several accounts -----------------------------------------------------------------------------------------------
    case 'SET_BALANCES': {
      const lines: string[] = [];
      let total = 0;
      for (const [n, item] of intent.items.entries()) {
        const known = knownAccountFromText(item.name);
        const target = await accountForHint(c, known?.name ?? item.name, accounts, { create: true, kind: known?.kind ?? null });
        if (target.kind !== 'one') { lines.push(`• ${item.name}: ไม่แน่ใจว่าบัญชีไหน (ข้าม)`); continue; }
        await ledger.setOwnerBalance({ accountId: target.account.id, amount: item.amount, actor: c.actor, message: c.messageId, idem: idem(`bal${n}`) });
        lines.push(`• ${target.account.name}: ${money(item.amount)}`);
        total += item.amount;
      }
      return [`ตั้งยอดเริ่มต้นเรียบร้อยครับ (เป็นยอดที่คุณยืนยัน)`, ...lines, `รวม ${money(total)}`].join('\n');
    }

    // -- per-bill reminder management ------------------------------------------------------------------------------------------------
    case 'ACK_MORNING': return 'ผมส่งแจ้งเตือนตอนเช้าประมาณ 08:00 น. (เวลาไทย) ทุกวันอยู่แล้วครับ';
    case 'OBLIGATION_REMINDERS':
    case 'OBLIGATION_SILENCE':
    case 'OBLIGATION_RESCHEDULE': {
      const found = await resolveObligation(c, intent.titleHint);
      if (found.kind === 'none') return intent.titleHint ? `ไม่พบรายการ “${intent.titleHint}” ครับ ผมยังไม่ได้แก้อะไร` : 'ไม่แน่ใจว่าหมายถึงรายการไหนครับ ระบุชื่อรายการด้วยได้ไหมครับ (เช่น “ค่ารถ”) ผมยังไม่ได้แก้อะไร';
      if (found.kind === 'many') return `หมายถึงรายการไหนครับ: ${found.items.map(i => i.title).join(', ')} (พิมพ์ชื่อรายการมาด้วยครับ) ผมยังไม่ได้แก้อะไร`;
      const item = found.item;
      if (intent.kind === 'OBLIGATION_REMINDERS') {
        await ledger.updateRecurring({ id: item.obligation_id, patch: { reminder_days: intent.days }, actor: c.actor, message: c.messageId, idem: idem('remind') });
        return `ตั้งเตือน “${item.title}” ก่อนครบกำหนด ${intent.days.join('/')} วันแล้วครับ`;
      }
      if (intent.kind === 'OBLIGATION_SILENCE') {
        await ledger.updateRecurring({ id: item.obligation_id, patch: { reminder_days: [] }, actor: c.actor, message: c.messageId, idem: idem('silence') });
        return `โอเคครับ ไม่เตือน “${item.title}” อีกแล้ว (รายการยังอยู่ ดูได้ในสรุปและปิดด้วย “จ่ายแล้ว” ได้ตามปกติ)`;
      }
      const [y, m] = item.due_date.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const nextDue = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(intent.dayOfMonth, last)).padStart(2, '0')}`;
      await ledger.updateRecurring({ id: item.obligation_id, patch: { next_due_date: nextDue, day_of_month: intent.dayOfMonth }, actor: c.actor, message: c.messageId, idem: idem('move') });
      return `เลื่อน “${item.title}” เป็นครบกำหนด ${thaiDate(nextDue)} แล้วครับ (รอบถัดไปจะยึดวันที่ ${intent.dayOfMonth})`;
    }

    case 'CHANGE_DATE_LAST': {
      const tx = recent.find(t => t.kind !== 'ADJUSTMENT');
      if (!tx) return 'ยังไม่มีรายการให้แก้ไขครับ';
      const res = await ledger.correctTransaction({ txId: tx.id, occurredOn: intent.date, actor: c.actor, message: c.messageId, idem: idem('date') });
      return res.ok ? `แก้วันที่ของรายการ ${txLine(tx)} เป็น ${thaiDate(intent.date)} แล้วครับ (รายการเดิมเก็บไว้เป็นประวัติ)${balanceNote(res.account ?? null)}` : 'แก้วันที่รายการนี้ไม่ได้ครับ';
    }

    // -- structure / settings ------------------------------------------------------------------------------------------------------------
    case 'CREATE_ACCOUNT': {
      const res = await ledger.createAccount({ name: intent.name, kind: intent.accountKind, actor: c.actor, message: c.messageId, idem: idem('acct') });
      return res.created
        ? `เพิ่มบัญชี “${res.account.name}” แล้วครับ ยังไม่ทราบยอด (ไม่ใช่ 0) บอกยอดจริงได้เลย เช่น “${res.account.name} เหลือ …”`
        : `มีบัญชี “${res.account.name}” อยู่แล้วครับ`;
    }
    case 'CREATE_CATEGORY': {
      const res = await ledger.createCategory({ name: intent.name, kind: null, actor: c.actor, message: c.messageId, idem: idem('cat') });
      return res.created ? `เพิ่มหมวด “${res.category.name}” แล้วครับ` : `มีหมวด “${res.category.name}” อยู่แล้วครับ`;
    }
    case 'SET_REMINDER_DAYS': {
      await ledger.setReminderDays(intent.days, c.actor, c.messageId);
      return `ตั้งค่าเตือนล่วงหน้า ${intent.days.join('/')} วันก่อนครบกำหนดแล้วครับ (ใช้กับรายการที่สร้างใหม่หลังจากนี้ รายการเดิมไม่เปลี่ยน)`;
    }

    // -- queries (read only) -------------------------------------------------------------------------------------------------------------------
    case 'QUERY_BALANCE': {
      if (intent.accountHint) {
        const m = resolveAccount(intent.accountHint, accounts);
        if (m.kind === 'one') return describeBalance(m.account);
        if (m.kind === 'ambiguous') return m.candidates.map(describeBalance).join('\n');
        return `ยังไม่มีบัญชี “${intent.accountHint}” ในระบบครับ บอกยอดเช่น “${intent.accountHint} เหลือ …” เพื่อเริ่มติดตามได้เลย`;
      }
      if (!accounts.length) return 'ยังไม่มีบัญชีที่ติดตามครับ บอกยอดได้เลย เช่น “บัญชีใช้จ่ายตอนนี้เหลือ 85,000”';
      const known = accounts.filter(a => a.balance_status !== 'UNKNOWN');
      const total = known.reduce((s, a) => s + (numberOrNull(a.balance) ?? 0), 0);
      const unknown = accounts.filter(a => a.balance_status === 'UNKNOWN');
      return [
        ...accounts.map(describeBalance),
        known.length ? `รวมเฉพาะบัญชีที่ทราบยอด ${known.length} บัญชี: ${money(total)}` : null,
        unknown.length ? `${unknown.length} บัญชียังไม่ทราบยอด จึงไม่นับรวม (ไม่ใช่ 0) ครับ` : null,
      ].filter(Boolean).join('\n');
    }

    case 'QUERY_SUMMARY': {
      const range = summaryRange(intent.period, c.today);
      const s = await ledger.getSummary(range.from, range.to);
      const cats = (s.by_category as Array<{ category: string; kind: string; total: number }>).filter(x => x.kind === 'EXPENSE').slice(0, 3);
      return [
        `สรุป${range.label} (${thaiDate(range.from)} – ${thaiDate(range.to)})`,
        `รายจ่าย ${money(s.expense)} • รายรับ ${money(s.income)} • สุทธิ ${money(s.net)}`,
        cats.length ? `หมวดที่จ่ายมากสุด: ${cats.map(x => `${x.category} ${money(x.total)}`).join(', ')}` : null,
        Number(s.pending_clarification_count) > 0 ? `มี ${s.pending_clarification_count} รายการที่ยังไม่ได้ระบุบัญชี (ตอบ “ไม่ระบุ” หรือบอกบัญชีได้ครับ)` : null,
        'ตัวเลขนี้มาจากรายการที่บันทึกไว้ ไม่ใช่ยอดจากธนาคารครับ',
      ].filter(Boolean).join('\n');
    }

    case 'QUERY_UPCOMING': {
      const to = horizonEnd(intent.horizon, intent.days, c.today);
      const items = await ledger.listUpcoming(c.today, to, 40);
      if (!items.length) return `ไม่มีรายการที่ต้องจ่ายถึง ${thaiDate(to)} ครับ`;
      const lines = items.slice(0, 12).map(u => `• ${thaiDate(u.due_date)} ${u.title} ${u.amount !== null ? money(u.amount) : '(ยังไม่ระบุจำนวน)'}${u.overdue ? ' ⚠ เลยกำหนด' : u.days_until === 0 ? ' (วันนี้)' : ''}`);
      const out = items.filter(u => u.kind === 'EXPENSE' && u.amount !== null).reduce((s, u) => s + (numberOrNull(u.amount) ?? 0), 0);
      return [`รายการที่ต้องจ่ายถึง ${thaiDate(to)}`, ...lines, `รวมรายจ่ายที่ระบุจำนวน ${money(out)}${items.some(u => u.amount === null) ? ' (บางรายการยังไม่ระบุจำนวน)' : ''}`].join('\n');
    }

    case 'QUERY_RECENT': {
      if (!recent.length) return 'ยังไม่มีรายการที่บันทึกไว้ครับ';
      return ['รายการล่าสุด', ...recent.slice(0, 8).map(t => `• ${thaiDate(t.occurred_on)} ${txLine(t)}`)].join('\n');
    }

    case 'QUERY_FORECAST': {
      const to = horizonEnd(intent.horizon === 'days' && !intent.days ? 'this_month' : intent.horizon, intent.days, c.today);
      const f = await ledger.forecast(to);
      return [
        `คาดการณ์ถึง ${thaiDate(to)} (เป็นการประมาณ ไม่ใช่ยอดจริง)`,
        `ยอดที่ทราบรวม ${money(f.known_balance_total)} (${f.known_account_count} บัญชี) + รายรับที่จะเข้า ${money(f.upcoming_inflow)} − รายจ่ายที่ต้องจ่าย ${money(f.upcoming_outflow)}`,
        `≈ ${money(f.projected_known_balance)}`,
        f.partial ? `ตัวเลขนี้ยังไม่ครบ: ${f.unknown_account_count} บัญชียังไม่ทราบยอด และ ${f.items_without_amount} รายการยังไม่ระบุจำนวนครับ` : null,
      ].filter(Boolean).join('\n');
    }
  }
}

type ObligationLookup = { kind: 'one'; item: UpcomingItem } | { kind: 'many'; items: UpcomingItem[] } | { kind: 'none' };

async function resolveObligation(c: Ctx, titleHint: string | null): Promise<ObligationLookup> {
  const all = firstPerObligation(await c.deps.ledger.listUpcoming(c.today, addDays(c.today, 400), 200));
  const pool = titleHint ? all.filter(u => titleOverlap(u.title, titleHint)) : all.filter(u => u.overdue || u.days_until <= 7);
  if (pool.length === 1) return { kind: 'one', item: pool[0] };
  if (pool.length > 1) return { kind: 'many', items: pool.slice(0, 6) };
  return { kind: 'none' };
}

const FREQUENCY_TH: Record<string, string> = {
  ONE_TIME: '(ครั้งเดียว)', WEEKLY: 'ทุกสัปดาห์', MONTHLY: 'ทุกเดือน', YEARLY: 'ทุกปี', CUSTOM_DAYS: 'ตามรอบที่กำหนด', INSTALLMENT: 'ผ่อนรายเดือน',
};

function txLine(t: LedgerTransaction): string {
  const kind = t.kind === 'EXPENSE' ? 'จ่าย' : t.kind === 'INCOME' ? 'รับ' : t.kind === 'TRANSFER' ? 'โอนภายใน' : 'ปรับยอด';
  const where = t.kind === 'TRANSFER' ? ` ${t.account_name ?? ''}→${t.to_account_name ?? ''}` : t.account_name ? ` (${t.account_name})` : t.status === 'PENDING_CLARIFICATION' ? ' (ยังไม่ระบุบัญชี)' : '';
  return `${kind} ${t.category ?? t.payee ?? ''} ${money(t.amount)}${where}`.replace(/\s+/g, ' ').trim();
}

function summaryRange(period: string, today: string): { from: string; to: string; label: string } {
  if (period === 'today') return { from: today, to: today, label: 'วันนี้' };
  if (period === 'this_week') { const w = weekRange(today); return { from: w.from, to: w.to, label: 'สัปดาห์นี้' }; }
  if (period === 'last_month') { const p = previousMonthRange(today); return { ...p, label: 'เดือนที่แล้ว' }; }
  return { from: monthStart(today), to: monthEnd(today), label: 'เดือนนี้' };
}

function horizonEnd(h: Horizon, days: number | null, today: string): string {
  switch (h) {
    case 'today': return today;
    case 'tomorrow': return addDays(today, 1);
    case 'this_week': return weekRange(today).to;
    case 'next_week': return addDays(weekRange(today).to, 7);
    case 'this_month': return monthEnd(today);
    case 'next_month': return monthEnd(addDays(monthEnd(today), 1));
    default: return addDays(today, days ?? 14);
  }
}

function firstPerObligation(items: UpcomingItem[]): UpcomingItem[] {
  const seen = new Set<string>();
  const out: UpcomingItem[] = [];
  for (const item of items) {
    if (item.projected || seen.has(item.obligation_id)) continue;
    seen.add(item.obligation_id);
    out.push(item);
  }
  return out;
}

function titleOverlap(a: string, b: string): boolean {
  const norm = (s: string) => normalizeText(s).toLowerCase().replace(/^ค่า/, '').replace(/\s+/g, '');
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

async function matchObligation(c: Ctx, title: string | null, amount: number): Promise<UpcomingItem | null> {
  if (!title) return null;
  const items = firstPerObligation((await c.deps.ledger.listUpcoming(c.today, addDays(c.today, 14), 60)).filter(u => u.kind === 'EXPENSE'));
  const hits = items.filter(u => titleOverlap(u.title, title) && u.amount !== null && Math.abs(Number(u.amount) - amount) < 0.005);
  return hits.length === 1 ? hits[0] : null;
}

function paidReply(res: Record<string, any>): string {
  const o = res.obligation;
  const next = o.status === 'COMPLETED' ? 'รายการนี้ครบแล้ว ปิดเรียบร้อยครับ' : `งวดถัดไป ${thaiDate(o.next_due_date)}`;
  return `ปิดรายการ “${o.title}” (ครบกำหนด ${thaiDate(res.paid_due_date)}) แล้วครับ ${money(res.transaction.amount)}${res.account ? ` ตัดจาก ${res.account.name}` : ''}\n${next}${balanceNote(res.account ?? null)}`;
}

async function payObligation(c: Ctx, obligationId: string, title: string, accountHint: string | null, amount: number | null, accounts: LedgerAccount[]): Promise<string> {
  const target = await accountForHint(c, accountHint, accounts, { create: true, useSingle: true });
  if (target.kind === 'ambiguous') {
    await c.deps.ledger.pendingSet(c.actor, 'ASK_PAID_ACCOUNT', { obligationId, amount, messageId: c.messageId }, 30);
    return `ตัดจากบัญชีไหนครับ: ${target.candidates.map(a => a.name).join(', ')}`;
  }
  const res = await c.deps.ledger.markDuePaid({
    obligationId, accountId: target.kind === 'one' ? target.account.id : null, amount, actor: c.actor, message: c.messageId, idem: `${c.messageId}:paid`,
  });
  if (res.ok) return paidReply(res);
  if (res.error === 'account_required') {
    await c.deps.ledger.pendingSet(c.actor, 'ASK_PAID_ACCOUNT', { obligationId, amount, messageId: c.messageId }, 30);
    const names = accounts.map(a => a.name);
    return `จ่าย “${title}” ตัดจากบัญชีไหนครับ${names.length ? ` (${names.join(', ')})` : ''} ผมยังไม่ได้ปิดรายการจนกว่าจะรู้บัญชี`;
  }
  if (res.error === 'amount_required') {
    await c.deps.ledger.pendingSet(c.actor, 'ASK_PAID_AMOUNT', { obligationId, accountId: target.kind === 'one' ? target.account.id : null, messageId: c.messageId }, 30);
    return `“${title}” จ่ายไปเท่าไหร่ครับ (รายการนี้ยังไม่ได้ระบุจำนวนไว้)`;
  }
  if (res.error === 'already_paid') return `งวดนี้ของ “${title}” ปิดไปแล้วครับ`;
  return `ปิดรายการ “${title}” ไม่ได้ครับ (${res.error ?? 'ไม่ทราบสาเหตุ'})`;
}

// ================================================================== pending conversation state

type Pending = { id: string; kind: string; payload: Record<string, any> };

async function resolvePending(c: Ctx, text: string, pending: Pending, accounts: LedgerAccount[]): Promise<{ done: boolean; reply: string | null }> {
  const { ledger } = c.deps;
  const clear = () => ledger.pendingClear(c.actor);
  const idem = (op: string) => `${c.messageId}:${op}`;
  const done = (r: string | null) => ({ done: true, reply: reply(r) });
  const t = normalizeText(text);

  switch (pending.kind) {
    case 'CONFIRM': {
      // high-risk actions accept only the explicit word "ยืนยัน", never a casual "ok"/"ใช่"
      if (pending.payload.strict ? /^ยืนยัน(?:ครับ)?[\s!.]*$/.test(t) : isYes(t)) {
        await clear();
        const original = pending.payload.interp as Interpretation;
        const cc: Ctx = { ...c, messageId: String(pending.payload.messageId ?? c.messageId), confirmed: true };
        return done(await execute(cc, original.intent, accounts, await ledger.getRecentTransactions(5)));
      }
      if (isNo(t)) { await clear(); return done('รับทราบครับ ยกเลิกแล้ว ผมไม่ได้บันทึกอะไร'); }
      return { done: false, reply: null };
    }

    case 'ASSIGN_ACCOUNT': {
      if (/^(?:ไม่ระบุ|ไม่ต้อง|ไม่เกี่ยว|ไม่ใช่บัญชี|ไม่มีบัญชี)/.test(t)) {
        const res = await ledger.confirmUnassigned({ txId: pending.payload.txId, actor: c.actor, message: c.messageId, idem: idem('unassigned') });
        await clear();
        return done(res.ok ? 'โอเคครับ เก็บรายการนี้ไว้โดยไม่ผูกกับบัญชีไหน (ไม่กระทบยอดบัญชีที่ติดตาม)' : 'รายการนี้ถูกจัดการไปแล้วครับ');
      }
      const target = await accountForHint(c, accountHintIn(t, accounts), accounts, { create: true });
      if (target.kind === 'ambiguous') return done(`หมายถึงบัญชีไหนครับ: ${target.candidates.map(a => a.name).join(', ')}`);
      if (target.kind !== 'one') return { done: false, reply: null };
      const res = await ledger.assignAccount({ txId: pending.payload.txId, accountId: target.account.id, actor: c.actor, message: c.messageId, idem: idem('assign') });
      await clear();
      return done(res.ok ? `ตั้งบัญชีเป็น ${target.account.name} แล้วครับ${balanceNote(res.account ?? null)}` : 'รายการนี้ถูกจัดการไปแล้วครับ');
    }

    case 'ASK_PAID_ACCOUNT': {
      const target = await accountForHint(c, accountHintIn(t, accounts), accounts, { create: true });
      if (target.kind === 'ambiguous') return done(`หมายถึงบัญชีไหนครับ: ${target.candidates.map(a => a.name).join(', ')}`);
      if (target.kind !== 'one') return { done: false, reply: null };
      const res = await ledger.markDuePaid({ obligationId: pending.payload.obligationId, accountId: target.account.id, amount: pending.payload.amount ?? null, actor: c.actor, message: c.messageId, idem: idem('paid') });
      await clear();
      return done(res.ok ? paidReply(res) : res.error === 'amount_required' ? 'รายการนี้ยังไม่ระบุจำนวน บอกจำนวนที่จ่ายด้วยครับ เช่น “จ่ายแล้ว 3,000 จาก SCB”' : `ปิดรายการไม่ได้ครับ (${res.error})`);
    }

    case 'ASK_PAID_AMOUNT': {
      const amt = extractAmount(t);
      if (amt === null) return { done: false, reply: null };
      const res = await ledger.markDuePaid({ obligationId: pending.payload.obligationId, accountId: pending.payload.accountId ?? null, amount: amt, actor: c.actor, message: c.messageId, idem: idem('paid') });
      await clear();
      if (res.ok) return done(paidReply(res));
      if (res.error === 'account_required') {
        await ledger.pendingSet(c.actor, 'ASK_PAID_ACCOUNT', { obligationId: pending.payload.obligationId, amount: amt, messageId: c.messageId }, 30);
        return done('ตัดจากบัญชีไหนครับ');
      }
      return done(`ปิดรายการไม่ได้ครับ (${res.error})`);
    }

    case 'PICK_OBLIGATION': {
      const list = pending.payload.candidates as Array<{ id: string; title: string }>;
      const n = Number(t.match(/^\s*(\d{1,2})\s*$/)?.[1] ?? NaN);
      const chosen = Number.isFinite(n) && list[n - 1] ? list[n - 1] : list.find(x => titleOverlap(x.title, t));
      if (!chosen) return { done: false, reply: null };
      await clear();
      return done(await payObligation(c, chosen.id, chosen.title, pending.payload.accountHint ?? accountHintIn(t, accounts), pending.payload.amount ?? null, accounts));
    }

    case 'PICK_ACCOUNT': {
      const hint = accountHintIn(t, accounts);
      if (!hint) return { done: false, reply: null };
      const intent = { ...(pending.payload.intent as PfIntent) } as any;
      if ('accountHint' in intent) intent.accountHint = hint;
      if (intent.kind === 'TRANSFER') { if (pending.payload.side === 'to') intent.toHint = hint; else intent.fromHint = hint; }
      await clear();
      return done(await execute({ ...c, messageId: String(pending.payload.messageId ?? c.messageId) }, intent, accounts, await ledger.getRecentTransactions(5)));
    }

    case 'BALANCE_ACCOUNT': {
      const known = accountHintIn(t, accounts) ?? (t.length <= 40 && !/\d/.test(t) ? t.replace(/^บัญชี\s*/, 'บัญชี') : null);
      if (!known) return { done: false, reply: null };
      await clear();
      return done(await execute({ ...c, messageId: String(pending.payload.messageId ?? c.messageId) }, { kind: 'SET_BALANCE', amount: Number(pending.payload.amount), accountHint: known, accountKind: null }, accounts, []));
    }

    case 'ASK_DUE_DATE': {
      const { parseDueDate } = await import('./_personal-finance-nlu');
      const due = parseDueDate(t, c.today);
      if (!due.date) return { done: false, reply: null };
      await clear();
      const intent = { ...(pending.payload.intent as PfIntent), firstDue: due.date, dayOfMonth: due.dayOfMonth } as PfIntent;
      return done(await execute({ ...c, messageId: String(pending.payload.messageId ?? c.messageId) }, intent, accounts, []));
    }

    case 'SLIP': return resolveSlip(c, t, pending, accounts);
    default: await clear(); return { done: false, reply: null };
  }
}

function accountHintIn(text: string, accounts: LedgerAccount[]): string | null {
  const m = findAccountMention(text, accounts);
  if (m.kind === 'one') return m.account.name;
  if (m.kind === 'ambiguous') return text;
  return knownAccountFromText(text)?.name ?? null;
}

// ================================================================== slips

async function handleImage(c: Ctx): Promise<string | null> {
  const { deps } = c;
  if (!deps.fetchImage || !deps.extractSlip) return reply('ตอนนี้ผมอ่านสลิปไม่ได้ครับ พิมพ์รายการมาแทนได้เลย เช่น “จ่ายประกัน 18500”');
  const img = await deps.fetchImage(c.messageId);

  const dupFile = await deps.ledger.findDuplicateSlip({ fileHash: img.sha256 });
  if (dupFile.duplicate && dupFile.transaction) {
    return reply(`สลิปนี้ผมบันทึกไว้แล้วครับ: ${txLine(dupFile.transaction)} ไม่บันทึกซ้ำ`);
  }

  let ext: SlipExtraction;
  try {
    ext = await deps.extractSlip(img.bytes, img.mimeType);
  } catch {
    await deps.ledger.logAudit('SLIP_UNREADABLE', 'slip', null, c.actor, c.messageId, { reason: 'extraction_failed' });
    return reply('อ่านสลิปนี้ไม่สำเร็จครับ ผมยังไม่ได้บันทึกอะไร พิมพ์มาได้เลย เช่น “จ่ายประกัน 18500 จาก SCB”');
  }
  const reliableAmount = ext.confidence >= 0.7 && ext.amount_total !== null && ext.amount_total > 0 && ['transfer_slip', 'purchase_receipt', 'expense_receipt'].includes(ext.document_type);
  if (!reliableAmount) {
    await deps.ledger.logAudit('SLIP_UNREADABLE', 'slip', null, c.actor, c.messageId, { reason: 'low_confidence', confidence: ext.confidence });
    return reply('อ่านยอดจากภาพนี้ไม่ชัดพอครับ ผมยังไม่ได้บันทึกอะไร พิมพ์ยอดมาได้เลย เช่น “จ่ายประกัน 18500”');
  }
  const amount = ext.amount_total as number;
  const dup = await deps.ledger.findDuplicateSlip({ slipRef: ext.reference_number, amount, date: ext.document_date_local, payee: ext.merchant });
  if (dup.duplicate && dup.transaction) {
    return reply(`เหมือนว่าสลิปนี้เคยบันทึกไว้แล้วครับ (${dup.reason === 'slip_ref' ? 'เลขอ้างอิงตรงกัน' : 'ยอด วันที่ และผู้รับตรงกัน'}): ${txLine(dup.transaction)} ผมไม่บันทึกซ้ำ ถ้าเป็นคนละรายการบอกได้เลยครับ`);
  }

  const upcoming = firstPerObligation((await deps.ledger.listUpcoming(c.today, addDays(c.today, 21), 60)).filter(u => u.kind === 'EXPENSE'));
  const match = upcoming.filter(u => u.amount !== null && Math.abs(Number(u.amount) - amount) < 0.005);
  const matchObligation = match.length === 1 ? match[0] : null;

  await deps.ledger.pendingSet(c.actor, 'SLIP', {
    amount, date: ext.document_date_local, payee: ext.merchant, ref: ext.reference_number, bank: ext.bank, fileHash: img.sha256,
    messageId: c.messageId, matchObligationId: matchObligation?.obligation_id ?? null, matchTitle: matchObligation?.title ?? null,
  }, 60);
  await deps.ledger.logAudit('SLIP_RECEIVED', 'slip', null, c.actor, c.messageId, { amount, has_ref: Boolean(ext.reference_number), confidence: ext.confidence });

  const facts = [`${money(amount)}`, ext.merchant ? `ถึง ${ext.merchant}` : null, ext.bank ? `(${ext.bank})` : null, ext.document_date_local ? `วันที่ ${thaiDate(ext.document_date_local)}` : null].filter(Boolean).join(' ');
  return reply([
    `เห็นสลิป ${facts} ครับ`,
    matchObligation ? `ยอดนี้ตรงกับรายการ “${matchObligation.title}” ที่ครบกำหนด ${thaiDate(matchObligation.due_date)} ถ้าใช่ตอบ “ใช่” (และบอกบัญชีที่ตัดถ้ายังไม่ได้ตั้งไว้) หรือบอกว่าเป็นค่าอะไรก็ได้ครับ` : 'รายการนี้เป็นค่าอะไร และตัดจากบัญชีไหนครับ (ผมไม่เดาวัตถุประสงค์เอง) ถ้าเป็นรายรับให้บอกว่า “รายรับ”',
  ].join('\n'));
}

async function resolveSlip(c: Ctx, t: string, pending: Pending, accounts: LedgerAccount[]): Promise<{ done: boolean; reply: string | null }> {
  const { ledger } = c.deps;
  const p = pending.payload;
  const done = (r: string | null) => ({ done: true, reply: reply(r) });
  if (isNo(t) || /^(?:ไม่ต้องบันทึก|ข้าม|ช่างมัน)/.test(t)) {
    await ledger.pendingClear(c.actor);
    return done('รับทราบครับ ไม่บันทึกสลิปนี้');
  }
  const hint = accountHintIn(t, accounts);
  if (isYes(t) || (p.matchObligationId && /(?:ใช่|ตรง|จ่ายแล้ว)/.test(t))) {
    if (p.matchObligationId) {
      await ledger.pendingClear(c.actor);
      return done(await payObligation(c, p.matchObligationId, p.matchTitle ?? 'รายการ', hint, p.amount, accounts));
    }
    return done('บอกด้วยครับว่าเป็นค่าอะไร และตัดจากบัญชีไหน');
  }
  const income = /(รายรับ|ได้รับ|รับเงิน|เงินเข้า|โอนเข้า)/.test(t);
  const purpose = t.replace(/(?:จาก|ด้วย|ผ่าน|ตัด|เข้า)\s*\S+/g, ' ').replace(/(?:รายรับ|รายจ่าย|ค่า(?=\S)|นะ|ครับ)/g, m => (m === 'ค่า' ? 'ค่า' : ' ')).replace(/\s+/g, ' ').trim();
  if (!purpose && !hint) return { done: false, reply: null };
  const target = await accountForHint(c, hint, accounts, { create: true, useSingle: true });
  if (target.kind === 'ambiguous') return done(`หมายถึงบัญชีไหนครับ: ${target.candidates.map(a => a.name).join(', ')}`);
  const accountId = target.kind === 'one' ? target.account.id : null;
  const title = purpose || null;
  const res = await ledger.createTransaction({
    kind: income ? 'INCOME' : 'EXPENSE', amount: Number(p.amount), accountId, category: guessCategory(t) ?? (title ? title.slice(0, 40) : null),
    payee: p.payee ?? title, note: title && p.payee ? title : null, occurredOn: p.date ?? null, actor: c.actor, message: c.messageId,
    idem: `${p.messageId ?? c.messageId}:slip`, slipRef: p.ref ?? null, fileHash: p.fileHash ?? null,
  });
  await ledger.pendingClear(c.actor);
  if (res.transaction.status === 'PENDING_CLARIFICATION') {
    await ledger.pendingSet(c.actor, 'ASSIGN_ACCOUNT', { txId: res.transaction.id, messageId: c.messageId }, 60);
    return done(`บันทึกสลิป ${money(p.amount)}${title ? ` (${title})` : ''} ไว้แล้วครับ ตัดจากบัญชีไหนครับ หรือพิมพ์ “ไม่ระบุ”`);
  }
  return done(`บันทึกสลิป${income ? 'รายรับ' : 'รายจ่าย'} ${money(p.amount)}${title ? ` (${title})` : ''} ${res.account ? `${income ? 'เข้า' : 'จาก'} ${res.account.name} ` : ''}เรียบร้อยครับ${balanceNote(res.account)}`);
}

// ================================================================== production wiring

/** Real dependencies.  Imported lazily so unit tests never load LINE/AI/business modules. */
export async function defaultPersonalFinanceDeps(): Promise<PfDeps> {
  const { piiHash, encryptPii } = await import('./_operations-db');
  assertLedgerConfigured();
  return {
    rpc: supabaseRpc,
    envOwnerId: configuredOwnerId(),
    llm: openAiInterpreter,
    now: () => new Date(),
    env: process.env,
    hash: piiHash,
    encrypt: encryptPii,
    isBusinessBound: async (groupId: string) => {
      const { boundLineOpsTeam } = await import('./_ops-notifications');
      return Boolean(await boundLineOpsTeam(groupId));
    },
    fetchImage: async messageId => (await import('./_inthanin-daily-close-image')).fetchLineImage(messageId),
    extractSlip: async (bytes, mimeType) => (await import('./_inthanin-daily-close-image')).extractFinancialEvidence(bytes, mimeType),
    groupName: async groupId => {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) return null;
      const res = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const body = await res.json() as { groupName?: string };
      return typeof body.groupName === 'string' ? body.groupName : null;
    },
    log: (event, data) => console.log(event, JSON.stringify(data)),
  };
}

/**
 * Called by line-webhook for every group event.  Returns true when the event belongs to the
 * finance channel, in which case the business handlers must not see it.
 */
export async function routePersonalFinanceEvent(
  event: PfEvent,
  send: (replyToken: string, text: string) => Promise<void>,
  deps?: PfDeps,
): Promise<boolean> {
  if (!deps && !pfEnabled()) return false;
  if (event.source?.type !== 'group') return false;
  let d: PfDeps;
  try {
    d = deps ?? await defaultPersonalFinanceDeps();
  } catch (error) {
    // Flag on but the ledger is not configured (env missing): inert, and business groups carry on untouched.
    console.warn('PF_NOT_CONFIGURED', error instanceof PfLedgerError ? error.code : 'unknown');
    return false;
  }
  let outcome: PfOutcome;
  try {
    outcome = await handlePersonalFinanceEvent(event, d);
  } catch (error) {
    // Could not prove this is not the private finance group: fail closed rather than leak it onward.
    (d.log ?? (() => undefined))('PF_ROUTE_ERROR', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return true;
  }
  if (outcome.reply && event.replyToken) {
    try {
      await send(event.replyToken, outcome.reply);
    } catch (error) {
      (d.log ?? (() => undefined))('PF_REPLY_FAILED', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    }
  }
  return outcome.handled;
}
