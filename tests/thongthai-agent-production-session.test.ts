import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartNewAgentConversation } from '../netlify/functions/_thongthai-agent-session';

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
