// GATE 4 (owner-specified): restaurant preorder notification operational-
// contract gap. booking_allocations/cafe_inquiries/otop_order_items each
// have a real DB trigger -> enqueue_tamma_ops_notification() -> staff LINE
// notification (verified structurally against the live tamma-customer-data
// schema, read-only, in a prior session -- see THONGTHAI_HANDOFF.md).
// restaurant_preorder_items does not. The fix is prepared as a migration
// file in the repo (supabase/migrations/), re-verified read-only as still
// needed at Gate 4 time (zero triggers on restaurant_preorder_items as of
// this test's authoring). This file is a STATIC content check on that
// migration file -- it cannot execute SQL against a real Postgres instance
// (no local DB in this repo, and the whole point of this gate is NOT
// applying it without owner authorization) -- so it verifies the migration
// file exists, contains exactly the reviewed fix, mirrors the existing
// otop_order_items branch's shape, and preserves every existing branch of
// the dispatcher function byte-for-byte (a static guard against someone
// editing this migration file later and silently breaking an unrelated
// entity type's notification while touching the restaurant branch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20260922190000_restaurant_preorder_items_ops_notification_v1.sql';

function migrationSql(): string {
  return readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
}

test('the restaurant preorder notification migration file exists and is clearly marked NOT APPLIED', () => {
  const files = readdirSync(MIGRATIONS_DIR);
  assert.ok(files.includes(MIGRATION_FILE), `expected ${MIGRATION_FILE} in ${MIGRATIONS_DIR}`);
  const sql = migrationSql();
  assert.match(sql, /NOT APPLIED/);
  assert.match(sql, /OWNER APPROVAL REQUIRED/);
});

test('the migration adds a new restaurant_preorder_items branch mirroring the otop_order_items shape exactly', () => {
  const sql = migrationSql();
  assert.match(sql, /elsif tg_table_name = 'restaurant_preorder_items' then/);
  assert.match(sql, /v_entity := 'restaurant_preorder';/);
  assert.match(sql, /v_entity_id := new\.preorder_id;/);
  assert.match(sql, /select p\.environment into v_environment from public\.restaurant_preorders p where p\.id = new\.preorder_id;/);
});

test('the migration preserves every EXISTING dispatcher branch unchanged (booking_allocations, cafe_inquiries, otop_order_items)', () => {
  const sql = migrationSql();
  // Verified against the live schema's real pg_get_functiondef output in a
  // prior session -- these exact lines must survive untouched. A future
  // edit to this migration file that accidentally drops or reorders one of
  // these breaks this test, catching it before the file is ever applied.
  assert.match(sql, /if tg_table_name = 'booking_allocations' then\s*\n\s*v_entity := 'booking';\s*\n\s*v_entity_id := new\.booking_id;/);
  assert.match(sql, /elsif tg_table_name = 'cafe_inquiries' then\s*\n\s*v_entity := 'cafe_inquiry';\s*\n\s*v_entity_id := new\.id;\s*\n\s*v_environment := new\.environment;/);
  assert.match(sql, /elsif tg_table_name = 'otop_order_items' then\s*\n\s*v_entity := 'otop_order';\s*\n\s*v_entity_id := new\.order_id;/);
  assert.match(sql, /else\s*\n\s*return new;\s*\n\s*end if;/);
});

test('the migration creates exactly one new trigger, named and shaped like the existing ops_notify_* triggers', () => {
  const sql = migrationSql();
  assert.match(sql, /create trigger ops_notify_restaurant_after_item\s*\nafter insert on public\.restaurant_preorder_items\s*\nfor each row execute function public\.enqueue_tamma_ops_notification\(\);/);
  // Exactly one CREATE TRIGGER statement -- this migration must never grow
  // into a place someone piles on unrelated schema changes.
  const triggerMatches = sql.match(/create trigger/g) ?? [];
  assert.equal(triggerMatches.length, 1);
});

test('no code in this repo automatically applies migrations -- applying is a deliberate, separate, owner-authorized action', () => {
  // Sanity guard: this repo (application code) must never itself run
  // `supabase db push`/apply_migration/psql against production as a side
  // effect of a build, test, or deploy step. This is a structural check,
  // not a promise about tools outside this repo (like an MCP call a human
  // or agent makes explicitly).
  const packageJson = readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /supabase db push|apply_migration/);
  const netlifyToml = readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.doesNotMatch(netlifyToml, /supabase db push|apply_migration/);
});
