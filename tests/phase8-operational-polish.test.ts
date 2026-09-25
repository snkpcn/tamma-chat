import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { withHarness, guestId, brainRequest, type Harness } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET='phase8-operational-polish-secret';

function installReplyCapture(){
  const original=global.fetch;
  const replies:Array<Record<string,unknown>>=[];
  global.fetch=(async(url:string|URL,init?:RequestInit)=>{
    if(String(url).includes('api.line.me/v2/bot/message/reply')){
      replies.push(JSON.parse(String(init?.body??'{}')) as Record<string,unknown>);
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    }
    return original(url as never,init);
  }) as typeof fetch;
  return {replies,restore:()=>{global.fetch=original}};
}

function fixedSafetyEvent(){
  return {
    type:'message',
    replyToken:'phase8-fixed-reply-token',
    timestamp:1790354000000,
    source:{type:'user',userId:'phase8-redelivery-user'},
    message:{id:'phase8-fixed-message-id',type:'text',text:'พื้นลื่นมาก ตอนเล่น ATV น่ากลัว'},
  };
}

async function callFixedWebhook(){
  const body=JSON.stringify({destination:'phase8-test',events:[fixedSafetyEvent()]});
  const signature=createHmac('sha256',SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler(
    {httpMethod:'POST',headers:{'x-line-signature':signature},body} as never,
    {} as never,
  );
}

async function withLine<T>(run:(harness:Harness)=>Promise<T>):Promise<T>{
  const oldSecret=process.env.LINE_CHANNEL_SECRET;
  const oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN='phase8-test-access-token';
  try{
    return await withHarness(async harness=>{
      const capture=installReplyCapture();
      try{return await run(harness)}finally{capture.restore()}
    });
  }finally{
    if(oldSecret===undefined)delete process.env.LINE_CHANNEL_SECRET;else process.env.LINE_CHANNEL_SECRET=oldSecret;
    if(oldToken===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN;else process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;
  }
}

test('Phase 8: canonical harness contains no synthetic cafe price/hours that do not exist in production',()=>{
  const source=readFileSync('tests/helpers/canonical-core-harness.ts','utf8');
  assert.doesNotMatch(source,/cafe_latte_price|07:00-18:00|fact_value:\s*65/u);
});

test('Phase 8: a redelivered LINE safety event creates one feedback case and one push per real target',async()=>{
  await withLine(async harness=>{
    harness.programOpsChannel('activity');
    harness.programOpsChannel('owner_general');

    await callFixedWebhook();
    await callFixedWebhook();

    assert.ok(harness.feedbackEventRow('feedback-event-1'),'first delivery creates the case');
    assert.equal(harness.feedbackEventRow('feedback-event-2'),undefined,'same LINE message.id must not create a second feedback case');

    assert.equal(harness.postsTo('line_push').filter(row=>row.to==='line-group-activity').length,1);
    assert.equal(harness.postsTo('line_push').filter(row=>row.to==='line-group-owner_general').length,1);
  });
});

test('Phase 8: retrying the same transport event never doubles accepted customer-intelligence signals',async()=>{
  await withHarness(async harness=>{
    const gid=guestId('phase8-intel-retry');
    const request=brainRequest('อยากขี่ม้า',gid,'web');
    await processThongthaiChatCore(request,'phase8-same-event');
    const first=harness.customerIntelligenceRows().length;
    await processThongthaiChatCore(request,'phase8-same-event');
    const second=harness.customerIntelligenceRows().length;
    assert.ok(first>0);
    assert.equal(second,first,'UNIQUE source-event contract must absorb retries');
  });
});
