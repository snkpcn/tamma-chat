import type { Handler } from '@netlify/functions';
import { pfEnabled } from './_personal-finance-core';
import { PfBindingClient, PfLedgerError, supabaseRpc } from './_personal-finance-ledger';

// Read-only SNK MONEY readiness probe: booleans only, never a secret, never group/ledger data.
// GET /.netlify/functions/snk-money-health
export type SnkMoneyHealth = {
  ok: boolean;
  flagEnabled: boolean;
  serviceKeyConfigured: boolean;
  urlSource: 'env' | 'default';
  ledgerReachable: boolean;
  migrationPresent: boolean;
  activeGroup: boolean;
  problem?: string;
};

export async function snkMoneyHealth(rpc = supabaseRpc, env: Record<string, string | undefined> = process.env): Promise<SnkMoneyHealth> {
  const health: SnkMoneyHealth = {
    ok: false,
    flagEnabled: pfEnabled(env),
    serviceKeyConfigured: Boolean((env.SNK_OS_SERVICE_ROLE_KEY ?? '').trim()),
    urlSource: env.SNK_OS_SUPABASE_URL ? 'env' : 'default',
    ledgerReachable: false,
    migrationPresent: false,
    activeGroup: false,
  };
  if (!health.serviceKeyConfigured) return { ...health, problem: 'SNK_OS_SERVICE_ROLE_KEY missing' };
  try {
    const targets = await new PfBindingClient(rpc).activeTargets();
    health.ledgerReachable = true;
    health.migrationPresent = true;
    health.activeGroup = targets.length > 0;
    health.ok = true;
  } catch (error) {
    if (error instanceof PfLedgerError && error.code === 'pf_rpc_missing') { health.ledgerReachable = true; health.problem = 'migration not applied'; }
    else health.problem = error instanceof PfLedgerError ? error.code : 'ledger unreachable';
  }
  return health;
}

export const handler: Handler = async () => {
  const body = await snkMoneyHealth();
  return { statusCode: body.ok ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
};
