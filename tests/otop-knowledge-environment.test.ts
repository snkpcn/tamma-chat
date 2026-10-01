import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../netlify/functions/_dialog-source-adapters.ts', import.meta.url), 'utf8');

test('OTOP knowledge adapter reads the same environment as the Agent session', () => {
  assert.match(source, /async function otopCatalogAdapter\([\s\S]*environment: 'live' \| 'test'/);
  assert.match(source, /listOtopProducts\(environment\)/);
  assert.match(source, /otop:\s*\{ catalog: request => otopCatalogAdapter\(environment\) \}/);
});

test('OTOP adapter no longer hardcodes live catalog reads', () => {
  const start = source.indexOf('async function otopCatalogAdapter');
  const end = source.indexOf('\nfunction requestValue', start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /listOtopProducts\('live'\)/);
});
