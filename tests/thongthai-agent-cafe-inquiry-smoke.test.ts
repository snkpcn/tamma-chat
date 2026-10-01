import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../netlify/functions/thongthai-agent-cafe-inquiry-smoke';

test('temporary cafe inquiry smoke is GET-only',async()=>{
  const r=await handler({httpMethod:'POST',headers:{}} as any,{} as any);
  assert.equal(r?.statusCode,405);
});
