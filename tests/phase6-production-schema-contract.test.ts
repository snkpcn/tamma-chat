import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const customerDb = readFileSync(new URL('../netlify/functions/_customer-db.ts', import.meta.url), 'utf8');
const canonicalSchema = readFileSync(new URL('../netlify/functions/supabase/schema.sql', import.meta.url), 'utf8');
const memoryMigration = readFileSync(
  new URL('../supabase/migrations/20261002112500_guest_memory_cafe_preferences.sql', import.meta.url),
  'utf8',
);
const catalogMigration = readFileSync(
  new URL('../supabase/migrations/20260929204213_phase6_disable_unsupported_horse_durations.sql', import.meta.url),
  'utf8',
);

test('production guest_memory CHECK constraint covers every runtime-normalized customer constraint', () => {
  const runtimeBlock = customerDb.match(/const CONSTRAINTS = new Set\(\[([\s\S]*?)\n\]\);/u)?.[1];
  assert.ok(runtimeBlock, 'runtime CONSTRAINTS declaration must remain discoverable');
  const executableRuntimeBlock = runtimeBlock.replace(/\/\/.*$/gmu, '');
  const runtimeConstraints = [...executableRuntimeBlock.matchAll(/'([^']+)'/gu)].map(match => match[1]!);
  assert.ok(runtimeConstraints.includes('shrimp_allergy'));
  assert.ok(runtimeConstraints.includes('mild_spice'));

  for (const constraint of runtimeConstraints) {
    assert.match(canonicalSchema, new RegExp(`"${constraint}"`, 'u'), `${constraint} missing from canonical schema`);
    assert.match(memoryMigration, new RegExp(`"${constraint}"`, 'u'), `${constraint} missing from production migration`);
  }
});

test('production catalog migration retires only superseded 60/90-minute horse rows without deleting history', () => {
  assert.match(catalogMigration, /update public\.activity_offerings/u);
  assert.match(catalogMigration, /set\s+active\s*=\s*false/u);
  assert.match(catalogMigration, /activity_code\s*=\s*'horse'/u);
  assert.match(catalogMigration, /duration_minutes\s+in\s*\(60,\s*90\)/u);
  assert.doesNotMatch(catalogMigration, /\bdelete\s+from\b/iu);
  const executableCatalogMigration = catalogMigration.replace(/^\s*--.*$/gmu, '');
  assert.doesNotMatch(executableCatalogMigration, /duration_minutes\s+in\s*\([^)]*(?:30|45)/u);
});
