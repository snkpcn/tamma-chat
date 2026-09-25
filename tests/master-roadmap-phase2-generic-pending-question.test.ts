// PHASE 2 CLOSEOUT — GENERIC PERSISTED PENDING-QUESTION CONTINUITY
//
// This test intentionally exercises the REAL signed LINE webhook with no
// transport chat history. The continuation contract must therefore live in
// server-side guest_agent_state, not in LINE chatHistory and not in a
// phrase-specific responder.
//
// RED proof expected before implementation:
// current main persists active_topic/unresolved_need for the ecosystem
// question, but no structured pending_question contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { withHarness, type Harness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const SECRET='phase2-generic-pending-question-secret';
type CapturedReply={messages:Array<{type:string;text?:string}>};

function installCapture(){
  const original=global.fetch;
  const replies:CapturedReply[]=[];
  global.fetch=(async(url:string|URL,init?:RequestInit)=>{
    if(String(url).includes('api.line.me/v2/bot/message/reply')){
      replies.push(JSON.parse(String(init?.body??'{}')) as CapturedReply);
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    }
    return original(url as never,init);
  }) as typeof fetch;
  return {replies,restore:()=>{global.fetch=original;}};
}

let seq=0;
function evt(text:string,userId:string){
  seq+=1;
  return {
    type:'message',
    replyToken:`reply-${seq}`,
    timestamp:Date.now()+seq,
    source:{type:'user',userId},
    message:{id:`msg-${seq}`,type:'text',text},
  };
}

async function callLine(text:string,userId:string){
  const body=JSON.stringify({destination:'test',events:[evt(text,userId)]});
  const signature=createHmac('sha256',SECRET).update(body,'utf8').digest('base64');
  return lineWebhookHandler({httpMethod:'POST',headers:{'x-line-signature':signature},body} as never,{} as never);
}

function textOf(reply:CapturedReply|undefined){
  return reply?.messages.map(m=>m.text??'').join('\n')??'';
}

function lineGuestId(userId:string):string{
  const hex=createHash('sha256').update('tamma-line:'+userId,'utf8').digest('hex').slice(0,32).split('');
  hex[12]='5';
  hex[16]=((parseInt(hex[16],16)&0x3)|0x8).toString(16);
  const v=hex.join('');
  return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20,32)}`;
}

function stateFor(h:Harness,userId:string):Record<string,unknown>{
  const guestDbId=h.guestDbId(lineGuestId(userId));
  assert.ok(guestDbId,'LINE guest should resolve to canonical guest row');
  return h.getState(guestDbId)?.state ?? {};
}

function menuRow(id:string,name:string,price:number,ingredients:string[]){
  return {
    menu_item_id:id,
    category_name:'อาหารจานหลัก',
    category_sort_order:1,
    sort_order:Number(id.replace(/\D/g,''))||1,
    name,
    selling_price:price,
    description:name,
    is_signature:id==='m1',
    ingredient_names:ingredients,
    unavailable_ingredients:[],
    available_servings:20,
    is_orderable:true,
    source_updated_at:new Date().toISOString(),
  };
}

test('full signed LINE: Thongthai persists a semantic pending question and resolves its own food answer with zero model calls',async()=>{
  const old=process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET=SECRET;
  try{
    await withHarness(async h=>{
      const capture=installCapture();
      try{
        const user='phase2-generic-pending-question-user';

        await callLine('แม่เดินไกลไม่ได้',user);
        await callLine('มีอะไรแนะนำ',user);

        const chooser=textOf(capture.replies[1]);
        assert.match(chooser,/อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา/u);

        const state=stateFor(h,user);
        const pending=state.pending_question as {
          domain?:string;
          kind?:string;
          choices?:Array<{value?:string}>;
        }|undefined;

        // Load-bearing architectural proof: deleting pending-question
        // persistence must make this fail even if a phrase-specific fallback
        // still happens to answer the next message.
        assert.ok(pending,'own clarification/choice question must persist pending_question');
        assert.equal(pending?.domain,'general_recommendation');
        assert.equal(pending?.kind,'preference_choice');
        assert.deepEqual(
          (pending?.choices??[]).map(choice=>choice.value),
          ['restaurant','cafe','light_activity'],
        );

        const modelCallsBefore=h.modelCallCount();
        await callLine('อยากเน้นกินข้าว',user);
        const answer=textOf(capture.replies[2]);

        assert.doesNotMatch(answer,/ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
        assert.match(answer,/คอหมูทอดสมุนไพร|ไข่เจียวหมูสับ|ร้านอาหาร|เมนู/u);
        assert.equal(h.modelCallCount(),modelCallsBefore,'pending-choice resolution must be deterministic');

        const stateAfter=stateFor(h,user);
        assert.equal(stateAfter.pending_question,undefined,'resolved question must be cleared');
      } finally { capture.restore(); }
    },{
      restaurantMenu:[
        menuRow('m1','คอหมูทอดสมุนไพร',169,['คอหมู','ตะไคร้']),
        menuRow('m2','ไข่เจียวหมูสับ',99,['ไข่ไก่','หมูสับ']),
      ],
    });
  } finally {
    if(old===undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET=old;
  }
});
