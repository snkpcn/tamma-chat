import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-agent-shadow';

test('agent shadow endpoint is unavailable unless explicitly enabled', async () => {
  const previous = process.env.THONGTHAI_AGENT_SHADOW_ENABLED;
  delete process.env.THONGTHAI_AGENT_SHADOW_ENABLED;
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: {},
      body: '{}',
    } as any, {} as any);
    assert.equal(response?.statusCode, 404);
    assert.match(String(response?.body), /agent_shadow_disabled/);
  } finally {
    if (previous === undefined) delete process.env.THONGTHAI_AGENT_SHADOW_ENABLED;
    else process.env.THONGTHAI_AGENT_SHADOW_ENABLED = previous;
  }
});

test('enabled shadow endpoint still requires an operator token before any OpenAI work', async () => {
  const oldEnabled = process.env.THONGTHAI_AGENT_SHADOW_ENABLED;
  const oldToken = process.env.THONGTHAI_AGENT_SHADOW_TOKEN;
  process.env.THONGTHAI_AGENT_SHADOW_ENABLED = '1';
  process.env.THONGTHAI_AGENT_SHADOW_TOKEN = 'expected-test-token';
  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'x-thongthai-shadow-token': 'wrong' },
      body: JSON.stringify({
        guestDbId: 'guest',
        conversationId: 'conversation',
        eventId: 'event',
        message: 'hello',
      }),
    } as any, {} as any);
    assert.equal(response?.statusCode, 401);
    assert.match(String(response?.body), /unauthorized/);
  } finally {
    if (oldEnabled === undefined) delete process.env.THONGTHAI_AGENT_SHADOW_ENABLED;
    else process.env.THONGTHAI_AGENT_SHADOW_ENABLED = oldEnabled;
    if (oldToken === undefined) delete process.env.THONGTHAI_AGENT_SHADOW_TOKEN;
    else process.env.THONGTHAI_AGENT_SHADOW_TOKEN = oldToken;
  }
});
