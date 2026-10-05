// SNK MONEY x THONGTHAI -- due-date reminders.
//
// Reminders go ONLY to the single verified finance group (the one ACTIVE binding in the
// ledger).  Never to the owner group, customer chats, arbitrary users, web or Messenger.
// Claiming happens inside Postgres, so concurrent / repeated cron runs cannot double-send.

import { bangkokToday, finalizeReply, money, pfEnabled, thaiDate } from './_personal-finance-core';
import { PfLedger, configuredOwnerId, supabaseRpc } from './_personal-finance-ledger';

type Claimed = Awaited<ReturnType<PfLedger['claimReminders']>>[number];

export type ReminderDeps = {
  ledger: PfLedger;
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
  if (!deps.enabled) return { skipped: 'disabled', claimed: 0, sent: 0, failed: 0 };
  const target = await deps.ledger.bindingActiveTarget();
  if (!target?.group_id_enc) return { skipped: 'no_active_group', claimed: 0, sent: 0, failed: 0 };
  const groupId = deps.decrypt(target.group_id_enc);
  // Defence in depth: the decrypted id must hash to the ACTIVE binding it came from.
  if (!groupId || deps.hash(groupId) !== target.group_id_hash) return { skipped: 'target_mismatch', claimed: 0, sent: 0, failed: 0 };

  const claimed = await deps.ledger.claimReminders(bangkokToday(deps.now()), 50);
  if (!claimed.length) return { claimed: 0, sent: 0, failed: 0 };

  try {
    for (const message of composeReminder(claimed)) await deps.push(groupId, message);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'push_failed';
    for (const item of claimed) await deps.ledger.finishReminder(item.delivery_id, false, reason);
    return { claimed: claimed.length, sent: 0, failed: claimed.length };
  }
  for (const item of claimed) await deps.ledger.finishReminder(item.delivery_id, true);
  return { claimed: claimed.length, sent: claimed.length, failed: 0 };
}

export async function defaultReminderDeps(): Promise<ReminderDeps> {
  const { piiHash, decryptPii } = await import('./_operations-db');
  return {
    ledger: new PfLedger(supabaseRpc, configuredOwnerId()),
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
