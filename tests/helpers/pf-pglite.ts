// Runs the REAL production migration against an in-process PostgreSQL (PGlite) so tests
// exercise the actual balance engine, constraints, triggers and grants -- not a re-implementation.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PfLedger, PfLedgerError, type Rpc } from '../../netlify/functions/_personal-finance-ledger';

export const MIGRATION = join(process.cwd(), 'supabase/migrations/20261005120000_snk_money_personal_finance_v1.sql');

function param(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return `{${value.join(',')}}`;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export async function freshDb(): Promise<{ db: PGlite; rpc: Rpc; ledger: PfLedger }> {
  const db = new PGlite();
  await db.exec('create role service_role; create role anon; create role authenticated;');
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  const rpc: Rpc = async (fn, args) => {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, n) => `${k} => $${n + 1}`).join(', ')}) as r`;
    try {
      const res = await db.query<{ r: unknown }>(sql, keys.map(k => param(args[k])));
      return res.rows[0]?.r ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PfLedgerError(/^[a-z_]+$/.test(message) ? message : 'pf_rpc_error', message);
    }
  };
  return { db, rpc, ledger: new PfLedger(rpc) };
}

export const A = 'actor_hash_owner';
let n = 0;
export const ids = (label = 'm') => ({ message: `${label}-${++n}`, idem: `${label}-${n}:op` });
