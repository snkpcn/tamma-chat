import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConversationContextUpdate, emptyConversationContextState, buildSemanticContext,
  boundedTransportHistory, conversationContextFromAgentState,
} from '../netlify/functions/_conversation-context';
import { processThongthaiOneMindTurn } from '../netlify/functions/_thongthai-one-mind-orchestrator';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const now = new Date('2026-10-18T09:00:00Z');
const restaurantState = {
  active_topic:'restaurant',
  restaurantAdvisorContext:{updatedAt:now.toISOString(),recentMessages:['แนะนำเมนู ผู้ใหญ่ 2 คน งบรวม 500 บาท ไม่เผ็ด','เด็กเพิ่มอีก 1 คน']},
};

test('web history reaches the real orchestration semantic boundary when server discourse is absent',async()=>{
  let observed = false;
  await processThongthaiOneMindTurn({
    channel:'web',message:'ถ้ามีเด็กมาด้วยอีก 1 คนล่ะครับ',eventId:'history-bridge',
    guestDbId:'guest',canonicalAnonymousId:'anonymous',
    chatHistory:[{role:'user',content:'ผู้ใหญ่ 2 คน งบรวม 500 บาท ไม่เผ็ด โทร 0812345678'}],
  },{
    loadConversationContext:async()=>emptyConversationContextState(now),
    loadTaskState:async()=>emptyTaskStateContainer(),
    interpretSemanticTurn:async(_message,context)=>{
      observed=true;
      assert.match(context.recentTurns![0].content,/500 บาท/);
      assert.doesNotMatch(context.recentTurns![0].content,/0812345678/);
      return {domain:'restaurant',intent:'restaurant_recommendation',action:'recommend',entities:{partySize:3},references:[],constraints:['no_spicy'],confidence:0.95,needsClarification:false};
    },
    buildKnowledgeAdapters:()=>({}),
  },now);
  assert.ok(observed);
});

test('LINE semantic context can read fresh grounded restaurant state with no browser history',()=>{
  const context = conversationContextFromAgentState(restaurantState,now);
  assert.equal(context.activeDomain,null,'user history is evidence, not a fabricated semantic decision');
  assert.match(context.recentTurns[0].content,/500/);
  assert.match(context.recentTurns[1].content,/เด็ก/);
  assert.equal(context.workingMemory.transactionCommitment,'none');
});

test('the newer conversation wins and expired restaurant memory cannot resurrect a topic',()=>{
  const canonical=applyConversationContextUpdate(emptyConversationContextState(now),{
    channel:'line',userMessage:'อยากขี่ม้า',activeDomain:'activity',
  },new Date(now.getTime()+1000));
  assert.equal(conversationContextFromAgentState({...restaurantState,conversationContext:canonical},new Date(now.getTime()+2000)).activeDomain,'activity');
  const older=applyConversationContextUpdate(emptyConversationContextState(now),{
    channel:'line',userMessage:'อยากขี่ม้า',activeDomain:'activity',
  },new Date(now.getTime()-1000));
  const newerRestaurant = conversationContextFromAgentState({...restaurantState,conversationContext:older},now);
  assert.equal(newerRestaurant.activeDomain,null);
  assert.match(newerRestaurant.recentTurns[0].content,/500/);
  assert.equal(conversationContextFromAgentState(restaurantState,new Date(now.getTime()+2*60*60*1000)).activeDomain,null);
});

test('reset drops earlier transported messages and browser history cannot overwrite server context',()=>{
  const history=[
    {role:'user' as const,content:'ผู้ใหญ่ 2 คน งบ 500 บาท'},
    {role:'user' as const,content:'ลืมที่คุยกันไปก่อนนะครับ'},
    {role:'assistant' as const,content:'เริ่มใหม่ได้ครับ'},
    {role:'user' as const,content:'อยากขี่ม้า'},
  ];
  assert.doesNotMatch(JSON.stringify(boundedTransportHistory(history)),/500/);
  const state=applyConversationContextUpdate(emptyConversationContextState(now),{channel:'line',userMessage:'ห้องพักว่างไหม',activeDomain:'stay'},now);
  const semantic=buildSemanticContext(state,now,history);
  assert.equal(semantic.activeDomain,'stay');
  assert.deepEqual(semantic.recentTurns,[{role:'user',content:'ห้องพักว่างไหม'}]);
});
