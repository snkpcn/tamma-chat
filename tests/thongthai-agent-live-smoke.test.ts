import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-agent-live-smoke';

test('temporary live Agent smoke endpoint is GET-only before any network work', async () => {
  const response = await handler({ httpMethod: 'POST', headers: {} } as any, {} as any);
  assert.equal(response?.statusCode, 405);
  assert.match(String(response?.body), /method_not_allowed/);
});
