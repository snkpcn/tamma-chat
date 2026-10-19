import test from 'node:test';
import assert from 'node:assert/strict';
import { persistCustomerTurnOutcome } from '../netlify/functions/_ai-cost-store';

test('failed customer turns persist bounded machine diagnostics and telemetry failure never throws',async()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,original=global.fetch;
  process.env.SUPABASE_URL='https://outcomes.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
  const bodies:any[]=[];
  global.fetch=(async(_input,init)=>{
    assert.ok(init?.signal);
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('',{status:503});
  }) as typeof fetch;
  try {
    await assert.doesNotReject(persistCustomerTurnOutcome({conversationId:'c',eventId:'e',channel:'line',
      outcome:'failed',errorType:'TimeoutError',durationMs:2500,environment:'test'}));
    assert.equal(bodies.length,1,'diagnostics must not start a slow retry loop');
    assert.equal(bodies[0].outcome,'failed');
    assert.equal(bodies[0].environment,'test');
    assert.equal(bodies[0].error_type,'TimeoutError');
    assert.doesNotMatch(JSON.stringify(bodies[0]),/server-only|message|transcript|stack/);
  } finally {
    global.fetch=original;
    if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;
    if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;
  }
});
