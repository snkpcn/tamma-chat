import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-agent-live-smoke';

test('temporary live Agent smoke is fail-closed unless explicitly enabled', async () => {
  const previous = process.env.THONGTHAI_AGENT_LIVE_SMOKE_ENABLED;
  delete process.env.THONGTHAI_AGENT_LIVE_SMOKE_ENABLED;
  try {
    const response = await handler({ httpMethod: 'GET', headers: {} } as any, {} as any);
    assert.equal(response?.statusCode, 404);
    assert.match(String(response?.body), /live_smoke_disabled/);
  } finally {
    if (previous === undefined) delete process.env.THONGTHAI_AGENT_LIVE_SMOKE_ENABLED;
    else process.env.THONGTHAI_AGENT_LIVE_SMOKE_ENABLED = previous;
  }
});
