import type { Handler } from '@netlify/functions';
import { pfEnabled } from './_personal-finance-core';
import { PfLedgerError } from './_personal-finance-ledger';
import { defaultCoachDeps, runCoach, type CoachKind } from './_personal-finance-coach';

// Scheduled hourly (see netlify.toml).  The morning brief only goes out 07:00-10:59 and the evening close 21:00-23:59
// (Asia/Bangkok) and Postgres claims each (owner, kind, local day) once, so repeated runs never double-send.
// While the feature is off or not configured this is a quiet no-op (never a failing scheduled run).
const ok = (body: Record<string, unknown>) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ...body }) });

export const handler: Handler = async () => {
  if (!pfEnabled()) return ok({ skipped: 'disabled' });
  try {
    const deps = await defaultCoachDeps();
    const results: Record<string, unknown> = {};
    for (const kind of ['MORNING', 'EVENING'] as CoachKind[]) results[kind] = await runCoach(kind, deps);
    console.log('PF_COACH_RUN', JSON.stringify(results));
    return ok(results);
  } catch (error) {
    if (error instanceof PfLedgerError && (error.code === 'pf_db_not_configured' || error.code === 'pf_rpc_missing')) {
      console.warn('PF_COACH_NOT_CONFIGURED', error.code);
      return ok({ skipped: error.code });
    }
    console.error('PF_COACH_ERROR', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
    return { statusCode: 500, body: 'Personal finance coach failed' };
  }
};
