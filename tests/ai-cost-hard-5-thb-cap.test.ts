import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiCostPolicy,
  DEFAULT_MAX_CONVERSATION_AI_COST_THB,
  usdToThb,
} from '../netlify/functions/_ai-cost-policy';

test('owner hard cap is never above 5 THB per AI-cost conversation',()=>{
  const originalCap=process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  const originalRate=process.env.THONGTHAI_USD_TO_THB_RATE;
  delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  delete process.env.THONGTHAI_USD_TO_THB_RATE;
  try{
    const policy=aiCostPolicy();
    assert.equal(DEFAULT_MAX_CONVERSATION_AI_COST_THB,5);
    assert.equal(usdToThb(policy.maxConversationCostUsd),5);

    process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD='999';
    assert.equal(usdToThb(aiCostPolicy().maxConversationCostUsd),5);

    process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD='0.10';
    assert.equal(aiCostPolicy().maxConversationCostUsd,0.10);
    assert.equal(usdToThb(aiCostPolicy().maxConversationCostUsd),3.6);
  }finally{
    if(originalCap===undefined) delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
    else process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD=originalCap;
    if(originalRate===undefined) delete process.env.THONGTHAI_USD_TO_THB_RATE;
    else process.env.THONGTHAI_USD_TO_THB_RATE=originalRate;
  }
});

test('5 THB cap follows the active THB FX rate',()=>{
  const originalCap=process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  const originalRate=process.env.THONGTHAI_USD_TO_THB_RATE;
  delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  process.env.THONGTHAI_USD_TO_THB_RATE='40';
  try{
    const policy=aiCostPolicy();
    assert.equal(policy.maxConversationCostUsd,0.125);
    assert.equal(usdToThb(policy.maxConversationCostUsd),5);
  }finally{
    if(originalCap===undefined) delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
    else process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD=originalCap;
    if(originalRate===undefined) delete process.env.THONGTHAI_USD_TO_THB_RATE;
    else process.env.THONGTHAI_USD_TO_THB_RATE=originalRate;
  }
});
