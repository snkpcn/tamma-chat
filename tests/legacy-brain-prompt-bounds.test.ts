import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase P — production UAT found that the legacy brain's full-conversation
// LLM call (runThongthaiBrain, reached whenever One-Mind's G.2 cutover does
// not yet complete a turn) was failing with LLMAvailabilityError on nearly
// every real non-discovery production turn, reproducibly across multiple
// clean runs including after a cooldown with no other LLM traffic -- while
// lighter, smaller-prompt calls (semantic interpreter, grounded-deterministic
// composer) kept succeeding. The base world_facts query embedded into every
// such prompt had no LIMIT at all, so it grows unbounded as more verified
// facts accumulate over time. This locks in the bound.
test('Phase P base world_facts query embedded in the legacy brain prompt is bounded', () => {
  const source = readFileSync('netlify/functions/_thongthai-runtime-v3.ts', 'utf8');
  const match = source.match(/dbFetch\('world_facts\?[^']*'\)/);
  assert.ok(match, 'expected the base world_facts dbFetch call to still exist');
  assert.match(match![0], /[?&]limit=\d+/, 'unbounded world_facts query embedded directly into an LLM prompt');
});
