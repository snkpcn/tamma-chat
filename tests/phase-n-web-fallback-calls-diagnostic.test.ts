import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase N diagnostic: locate every legacy ConciergeProvider call site',()=>{
  const html=readFileSync('index.html','utf8');
  const needle='ConciergeProvider.';
  const hits:number[]=[];
  let i=0;
  while((i=html.indexOf(needle,i))>=0){hits.push(i);i+=needle.length}
  assert.ok(hits.length>0);
  console.log('PHASE_N_CONCIERGE_CALLS_START');
  hits.forEach((idx,n)=>{
    console.log('---CALL '+(n+1)+'---');
    console.log(html.slice(Math.max(0,idx-1200),Math.min(html.length,idx+2600)));
  });
  console.log('PHASE_N_CONCIERGE_CALLS_END');
});
