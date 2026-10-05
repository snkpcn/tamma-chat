// Runs the REAL SNK OS migration (on top of a faithful copy of the existing SNK schema) against an in-process PostgreSQL (PGlite) so tests
// exercise the actual balance engine, constraints, triggers and grants -- not a re-implementation.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PfLedger, PfLedgerError, type Rpc } from '../../netlify/functions/_personal-finance-ledger';

export const MIGRATION = join(process.cwd(), 'supabase/snk-os/20261005130000_snk_money_v1.sql');
export const MIGRATION_V2 = join(process.cwd(), 'supabase/snk-os/20261005140000_snk_money_v2_coach_binding.sql');
export const MIGRATION_V3 = join(process.cwd(), 'supabase/snk-os/20261005150000_snk_secretary_v3.sql');
export const BASE_SCHEMA = join(process.cwd(), 'tests/fixtures/snk-os-base.sql');
export const OWNER_ID = '11111111-1111-4111-8111-111111111111';

function param(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    // PostgREST sends arrays of objects to jsonb RPC parameters as JSON, while
    // primitive arrays in the money contract are native Postgres arrays.
    return value.some(item => item !== null && typeof item === 'object') ? JSON.stringify(value) : `{${value.join(',')}}`;
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export async function freshDb(): Promise<{ db: PGlite; rpc: Rpc; ledger: PfLedger; owner: string }> {
  const db = new PGlite();
  await db.exec('create role service_role; create role anon; create role authenticated;');
  await db.exec(readFileSync(BASE_SCHEMA, 'utf8'));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(readFileSync(MIGRATION_V2, 'utf8'));
  await db.exec(readFileSync(MIGRATION_V3, 'utf8'));
  await db.query('insert into auth.users(id) values($1)', [OWNER_ID]);
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
  return { db, rpc, ledger: new PfLedger(rpc, OWNER_ID), owner: OWNER_ID };
}

export const A = 'actor_hash_owner';
let n = 0;
export const ids = (label = 'm') => ({ message: `${label}-${++n}`, idem: `${label}-${n}:op` });
