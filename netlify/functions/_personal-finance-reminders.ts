// SNK MONEY x THONGTHAI -- due-date reminders.
//
// Reminders go ONLY to the single verified finance group (the one ACTIVE binding in the
// ledger).  Never to the owner group, customer chats, arbitrary users, web or Messenger.
// Claiming happens inside Postgres, so concurrent / repeated cron runs cannot double-send.

import { bangkokToday, finalizeReply, money, pfEnabled, thaiDate } from './_personal-finance-core';
import { PfBindingClient, PfLedger, assertLedgerConfigured, supabaseRpc, type Rpc } from './_personal-finance-ledger';

type Claimed = Awaited<ReturnType<PfLedger['claimReminders']>>[number];

export type ReminderDeps = {
  rpc: Rpc;
  push: (groupId: string, text: string) => Promise<void>;
  decrypt: (value: string) => string | null;
  hash: (value: string) => string | null;
  now: () => Date;
  enabled: boolean;
};

export type ReminderResult = { skipped?: string; claimed: number; sent: number; failed: number };

function when(item: Claimed): string {
  if (item.overdue) return `⚠ เลยกำหนด ${Math.abs(item.days_until)} วันแล้ว`;
  if (item.days_until === 0) return '⏰ ครบกำหนดวันนี้';
  if (item.days_until === 1) return '⏰ พรุ่งนี้ครบกำหนด';
  return `อีก ${item.days_until} วัน (${thaiDate(item.due_date)})`;
}

export function composeReminder(items: Claimed[]): string[] {
  const lines = items.map(item => {
    const sign = item.kind === 'INCOME' ? 'จะได้รับ' : 'ต้องจ่าย';
    const amount = item.amount !== null ? money(item.amount) : 'ยังไม่ระบุจำนวน';
    return `• ${when(item)} — ${item.title} ${sign} ${amount}${item.default_account ? ` (${item.default_account})` : ''}`;
  });
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 10) {
    const head = i === 0 ? 'แจ้งเตือนรายการการเงินครับ' : 'แจ้งเตือนต่อครับ';
    const tail = i + 10 >= lines.length ? '\nจ่ายแล้วพิมพ์ “จ่ายแล้ว” ได้เลยครับ ผมจะปิดรายการและขยับงวดถัดไปให้' : '';
    chunks.push(finalizeReply(`${head}\n${lines.slice(i, i + 10).join('\n')}${tail}`));
  }
  return chunks;
}

export async function runPersonalFinanceReminders(deps: ReminderDeps): Promise<ReminderResult> {
  const total: ReminderResult = { claimed: 0, sent: 0, failed: 0 };
  if (!deps.enabled) return { ...total, skipped: 'disabled' };
  const targets = await new PfBindingClient(deps.rpc).activeTargets();
  if (!targets.length) return { ...total, skipped: 'no_active_group' };

  for (const target of targets) {
    const groupId = target.group_id_enc ? deps.decrypt(target.group_id_enc) : null;
    // Defence in depth: the decrypted id must hash to the ACTIVE binding it came from.
    if (!groupId || deps.hash(groupId) !== target.group_id_hash) { total.skipped = 'target_mismatch'; continue; }
    const ledger = new PfLedger(deps.rpc, target.owner_id);
    const claimed = await ledger.claimReminders(bangkokToday(deps.now()), 50);
    if (!claimed.length) continue;
    total.claimed += claimed.length;
    try {
      for (const message of composeReminder(claimed)) await deps.push(groupId, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : 'push_failed';
      for (const item of claimed) await ledger.finishReminder(item.delivery_id, false, reason);
      total.failed += claimed.length;
      continue;
    }
    for (const item of claimed) await ledger.finishReminder(item.delivery_id, true);
    total.sent += claimed.length;
  }
  return total;
}

export async function defaultReminderDeps(): Promise<ReminderDeps> {
  const { piiHash, decryptPii } = await import('./_operations-db');
  assertLedgerConfigured();
  return {
    rpc: supabaseRpc,
    decrypt: decryptPii,
    hash: piiHash,
    now: () => new Date(),
    enabled: pfEnabled(),
    push: async (groupId, text) => {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
      });
      if (!response.ok) throw new Error(`line_push_${response.status}`);
    },
  };
}
