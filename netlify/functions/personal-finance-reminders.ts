import type { Handler } from '@netlify/functions';
import { pfEnabled } from './_personal-finance-core';
import { PfLedgerError } from './_personal-finance-ledger';
import { defaultReminderDeps, runPersonalFinanceReminders } from './_personal-finance-reminders';

// Scheduled (see netlify.toml).  Safe to run repeatedly: Postgres claims each reminder exactly once.
// While the feature is off or not configured this is a quiet no-op (never a failing scheduled run).
export const handler: Handler = async () => {
  if (!pfEnabled()) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, skipped: 'disabled' }) };
  }
  try {
    const result = await runPersonalFinanceReminders(await defaultReminderDeps());
    console.log('PF_REMINDERS_RUN', JSON.stringify(result));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ...result }) };
  } catch (error) {
    if (error instanceof PfLedgerError && (error.code === 'pf_db_not_configured' || error.code === 'pf_rpc_missing')) {
      console.warn('PF_REMINDERS_NOT_CONFIGURED', error.code);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, skipped: error.code }) };
    }
    console.error('PF_REMINDERS_ERROR', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
    return { statusCode: 500, body: 'Personal finance reminders failed' };
  }
};
