import type { Handler } from '@netlify/functions';
import { defaultReminderDeps, runPersonalFinanceReminders } from './_personal-finance-reminders';

// Scheduled (see netlify.toml).  Safe to run repeatedly: Postgres claims each reminder exactly once.
export const handler: Handler = async () => {
  try {
    const result = await runPersonalFinanceReminders(await defaultReminderDeps());
    console.log('PF_REMINDERS_RUN', JSON.stringify(result));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ...result }) };
  } catch (error) {
    console.error('PF_REMINDERS_ERROR', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
    return { statusCode: 500, body: 'Personal finance reminders failed' };
  }
};
