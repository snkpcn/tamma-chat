import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { backendFetch } from '../netlify/functions/_backend-fetch';

test('backend deadline aborts a stalled body after headers arrive', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.flushHeaders();
    res.write('[');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await backendFetch(`http://127.0.0.1:${address.port}`, {}, 100);
    await assert.rejects(response.json(), error =>
      error instanceof Error && ['TimeoutError','AbortError'].includes(error.name));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('caller cancellation is preserved and writes are never automatically retried', async () => {
  const original = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  global.fetch = (async (_input, init) => {
    calls++;
    assert.equal(init?.method, 'POST');
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once:true });
    });
  }) as typeof fetch;
  try {
    const result = backendFetch('https://backend.test', { method:'POST', signal:controller.signal });
    controller.abort();
    await assert.rejects(result, error => error instanceof Error && error.name === 'AbortError');
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});
