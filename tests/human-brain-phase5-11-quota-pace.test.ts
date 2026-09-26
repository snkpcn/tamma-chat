import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';

test('Phase 5.11: production cert default stays below observed ~10 RPM quota',()=>{
  const source=readFileSync(new URL('../scripts/write-semantic-certification-artifact.ts',import.meta.url),'utf8');
  assert.match(source,/SEMANTIC_CERT_INTER_CASE_DELAY_MS \?\? '6500'/);
  assert.match(source,/: 6_500;/);
});

test('Phase 5.11: quota pacing change does not invalidate semantic-v6 resume evidence',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v6');
});
