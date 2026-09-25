import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('semantic live certification is one-shot and is not permanently enabled in Netlify build config', () => {
  const toml=readFileSync(new URL('../netlify.toml',import.meta.url),'utf8');
  const script=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');

  assert.doesNotMatch(toml,/RUN_SEMANTIC_CERTIFICATION\s*=\s*"1"/);
  assert.match(script,/\[semantic-cert\]/);
  assert.match(script,/CONTEXT === 'production'/);
  assert.match(script,/BRANCH === 'main'/);
});
