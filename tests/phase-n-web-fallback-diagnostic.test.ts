import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase N diagnostic: locate legacy web concierge fallback before cleanup',()=>{
  const html=readFileSync('index.html','utf8');
  const idx=html.indexOf('ConciergeProvider');
  assert.ok(idx>=0,'expected legacy ConciergeProvider from Phase 0 audit');
  console.log('PHASE_N_CONCIERGE_SNIPPET_START');
  console.log(html.slice(Math.max(0,idx-1800),Math.min(html.length,idx+6200)));
  console.log('PHASE_N_CONCIERGE_SNIPPET_END');
});
