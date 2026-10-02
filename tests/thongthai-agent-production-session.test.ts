import test from 'node:test';
import assert from 'node:assert/strict';
import { agentInputText, shouldStartNewAgentConversation } from '../netlify/functions/_thongthai-agent-session';

test('Agent session continues inside the same active conversation window', () => {
  const now=new Date('2026-10-01T12:00:00.000Z');
  assert.equal(shouldStartNewAgentConversation({
    lastUsedAt:'2026-10-01T11:45:00.000Z',
    lastConversationId:'guest-1',
  },'guest-1',now),false);
});

test('Agent session resets after the canonical conversation idle window', () => {
  const now=new Date('2026-10-01T12:00:00.000Z');
  assert.equal(shouldStartNewAgentConversation({
    lastUsedAt:'2026-10-01T11:29:59.000Z',
    lastConversationId:'guest-1',
  },'guest-1',now),true);
});

test('Agent session resets when the caller explicitly changes conversation id', () => {
  const now=new Date('2026-10-01T12:00:00.000Z');
  assert.equal(shouldStartNewAgentConversation({
    lastUsedAt:'2026-10-01T11:59:00.000Z',
    lastConversationId:'conversation-a',
  },'conversation-b',now),true);
});


test('Agent input stays minimal when there is no durable memory', () => {
  assert.equal(agentInputText({
    guestDbId:'guest-db',
    conversationId:'conversation',
    eventId:'event',
    channel:'facebook',
    message:'มีอะไรแนะนำบ้างครับ',
  }), 'มีอะไรแนะนำบ้างครับ');
});

test('Agent receives compact durable context without replacing the current customer message', () => {
  const text=agentInputText({
    guestDbId:'guest-db',
    conversationId:'conversation',
    eventId:'event',
    channel:'facebook',
    message:'วันนี้เอาไม่หวานครับ',
    memoryContext:{
      travelerType:'couple',
      pace:'relaxed',
      constraints:['low_sweet','no_cow_milk'],
    },
  });
  assert.match(text,/PRIVATE CUSTOMER CONTEXT/u);
  assert.match(text,/"travelerType":"couple"/u);
  assert.match(text,/"low_sweet"/u);
  assert.match(text,/\[CURRENT CUSTOMER MESSAGE\]\nวันนี้เอาไม่หวานครับ/u);
});
