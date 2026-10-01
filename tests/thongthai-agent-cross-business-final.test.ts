import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../netlify/functions/thongthai-agent-cross-business-final';

test('temporary cross-business final endpoint is GET-only',async()=>{
  const response=await handler({httpMethod:'POST',headers:{}} as any,{} as any);
  assert.equal(response?.statusCode,405);
});

test('temporary cross-business final endpoint requires an ordered turn number',async()=>{
  const response=await handler({httpMethod:'GET',headers:{},queryStringParameters:{turn:'9'}} as any,{} as any);
  assert.equal(response?.statusCode,400);
});
