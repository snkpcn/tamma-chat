import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase P — production UAT found that the legacy brain's full-conversation
// LLM call (runThongthaiBrain, reached whenever One-Mind's G.2 cutover does
// not yet complete a turn) was failing with LLMAvailabilityError on nearly
// every real non-discovery production turn, reproducibly across multiple
// clean runs including after a cooldown with no other LLM traffic -- while
// lighter, smaller-prompt calls (semantic interpreter, grounded-deterministic
// composer) kept succeeding. A production diagnostic (thongthai-brain-prompt-
// diagnostic.ts) measured the real prompt at ~77KB, with a single fact --
// restaurant_menu_live, embedded unconditionally on every turn regardless of
// topic -- alone accounting for ~34KB (44%) via a full per-item ingredient
// list + recommendation profile object that the brain's own doctrine already
// says to fetch on demand via the list_restaurant_menu tool instead. These
// tests lock in both size-reduction fixes found during that investigation.

test('Phase P base world_facts query embedded in the legacy brain prompt is bounded', () => {
  const source = readFileSync('netlify/functions/_thongthai-runtime-v3.ts', 'utf8');
  const match = source.match(/dbFetch\('world_facts\?[^']*'\)/);
  assert.ok(match, 'expected the base world_facts dbFetch call to still exist');
  assert.match(match![0], /[?&]limit=\d+/, 'unbounded world_facts query embedded directly into an LLM prompt');
});

test('Phase P restaurant_menu_live world fact stays a lean summary, not the full per-item ingredient/profile dump', () => {
  const source = readFileSync('netlify/functions/_restaurant-sot.ts', 'utf8');
  const start = source.indexOf('export async function loadRestaurantWorldFacts');
  assert.ok(start >= 0, 'expected loadRestaurantWorldFacts to still exist');
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  assert.doesNotMatch(
    body,
    /ingredients:\s*item\.ingredient_names/,
    'the passive restaurant_menu_live fact must not carry the full ingredient list on every turn -- ' +
    'list_restaurant_menu/restaurantMenuAdvice already return it on demand, per the brain\'s own doctrine',
  );
  assert.doesNotMatch(
    body,
    /profile:\s*normalizeRestaurantProfile/,
    'the passive restaurant_menu_live fact must not carry the full recommendation profile object on every turn',
  );
  assert.match(
    body,
    /unavailableIngredients:\s*item\.unavailable_ingredients/,
    'unavailableIngredients must stay, since the doctrine names it for the orderable=false case',
  );
});
