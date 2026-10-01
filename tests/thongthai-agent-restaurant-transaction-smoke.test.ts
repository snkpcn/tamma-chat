import test from 'node:test';import assert from 'node:assert/strict';import {handler} from '../netlify/functions/thongthai-agent-restaurant-transaction-smoke';
test('temporary restaurant transaction smoke is GET-only',async()=>{const r=await handler({httpMethod:'POST',headers:{}} as any,{} as any);assert.equal(r?.statusCode,405);});
