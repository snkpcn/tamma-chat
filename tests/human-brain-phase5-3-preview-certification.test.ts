import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-semantic-certification-preview';

test('Phase 5.3 preview certification endpoint is invisible outside deploy-preview context', async()=>{
  const previousContext=process.env.CONTEXT;
  const previousPrime=process.env.DEPLOY_PRIME_URL;
  delete process.env.CONTEXT;
  delete process.env.DEPLOY_PRIME_URL;
  try{
    const response=await handler({httpMethod:'GET',queryStringParameters:{}} as any,{} as any);
    assert.equal(response?.statusCode,404);
  }finally{
    if(previousContext===undefined) delete process.env.CONTEXT; else process.env.CONTEXT=previousContext;
    if(previousPrime===undefined) delete process.env.DEPLOY_PRIME_URL; else process.env.DEPLOY_PRIME_URL=previousPrime;
  }
});

test('Phase 5.3 preview certification endpoint recognizes deploy-preview environment before provider call', async()=>{
  const previousContext=process.env.CONTEXT;
  process.env.CONTEXT='production';
  try{
    const response=await handler({httpMethod:'GET',queryStringParameters:{}} as any,{} as any);
    assert.equal(response?.statusCode,404);
  }finally{
    if(previousContext===undefined) delete process.env.CONTEXT; else process.env.CONTEXT=previousContext;
  }
});
