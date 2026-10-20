import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerGuestIdentity } from '../netlify/functions/_thongthai-runtime-v3';

const CHAT_SOURCE = readFileSync(
  new URL('../netlify/functions/thongthai-chat.ts', import.meta.url),
  'utf8',
);
const RUNTIME_SOURCE = readFileSync(
  new URL('../netlify/functions/_thongthai-runtime-v3.ts', import.meta.url),
  'utf8',
);

test('a failing identity write does not reject today', async () => {
  // Documents the CURRENT inner guarantee this call site must not depend on:
  // _thongthai-runtime-v3.ts catches its own write errors. If this ever
  // starts rejecting, the call-site guard asserted below is what keeps the
  // customer reply alive.
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const originalError = console.error;
  const logged: string[] = [];
  process.env.SUPABASE_URL = 'https://identity.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  global.fetch = (async () => new Response('boom', { status:500 })) as typeof fetch;
  console.error = (name?:unknown) => { logged.push(String(name ?? '')); };
  try {
    await registerGuestIdentity('11111111-1111-5111-8111-111111111111', 'line', 'user-key');
    assert.ok(
      logged.includes('THONGTHAI_IDENTITY_ERROR'),
      'the write failure must still be reported somewhere',
    );
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('an unconfigured store makes identity registration a no-op', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await registerGuestIdentity('11111111-1111-5111-8111-111111111111', 'line', 'user-key');
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('the customer turn survives a rejecting identity write', async () => {
  // The shape thongthai-chat.ts uses. Unguarded, one rejection in a
  // Promise.all takes down every sibling write and the whole reply.
  const settled = await Promise.all([
    Promise.reject(new Error('guest_identities unavailable'))
      .catch(() => undefined),
    Promise.resolve('heartbeat'),
    Promise.resolve('preferences'),
  ]);
  assert.deepEqual(settled, [undefined, 'heartbeat', 'preferences']);
});

test('source guard: every independent write in the turn is guarded', () => {
  // Anchor on the batch that actually carries the turn's independent writes,
  // not merely the file's first Promise.all.
  const anchor = CHAT_SOURCE.indexOf('registerGuestIdentity(guestDbId');
  assert.ok(anchor > 0, 'the turn must still register guest identity');
  const start = CHAT_SOURCE.lastIndexOf('Promise.all([', anchor);
  assert.ok(start > 0, 'the batched turn writes must still exist');
  const block = CHAT_SOURCE.slice(start, CHAT_SOURCE.indexOf('  ]);', anchor) + 5);

  for (const call of [
    'registerGuestIdentity(',
    'touchAiConversation(',
    'capturePreferenceSignals(',
  ]) {
    const at = block.indexOf(call);
    assert.ok(at > 0, `${call} must still be in the batched writes`);
    const tail = block.slice(at, at + 700);
    assert.match(
      tail, /\.catch\(/u,
      `${call} must be .catch()-guarded so it cannot take down the customer reply`,
    );
  }
  assert.match(block, /THONGTHAI_GUEST_IDENTITY_REGISTER_ERROR/u);
  assert.match(block, /THONGTHAI_AI_CONVERSATION_HEARTBEAT_ERROR/u);
});

test('source guard: identity registration stays a bookkeeping write', () => {
  // The guard above is only safe because nothing in the turn reads
  // guest_identities: the memory, ledger and state reads all key off
  // guestDbId, which is resolved before this batch runs.
  const fn = RUNTIME_SOURCE.slice(
    RUNTIME_SOURCE.indexOf('export async function registerGuestIdentity'),
    RUNTIME_SOURCE.indexOf('export async function loadBrainRuntime'),
  );
  assert.match(fn, /guest_identities/u);
  assert.match(fn, /last_seen_at/u);
  assert.ok(
    !/return\s+[^;]*guest_id/u.test(fn),
    'registerGuestIdentity must stay void: a caller that needed its result could not ignore a failure',
  );
  const runtimeLoad = RUNTIME_SOURCE.slice(RUNTIME_SOURCE.indexOf('export async function loadBrainRuntime'));
  assert.ok(
    !runtimeLoad.slice(0, 1_400).includes('guest_identities'),
    'the runtime load must not depend on the identity row this turn just wrote',
  );
});
