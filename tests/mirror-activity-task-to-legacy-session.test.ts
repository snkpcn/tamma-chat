// Regression coverage for PRIORITY 2 of the One-Mind architecture
// consolidation (see THONGTHAI_HANDOFF.md): mirrorActivityTaskToLegacySession
// is the one-directional write-through that makes guest_agent_state.taskState
// canonical for a LINE-sourced activity_booking conversation while
// booking_sessions becomes a passive execution adapter the legacy
// transactional flow reads from -- never the reverse, and never a second
// interpreter of customer intent. This is the redesigned replacement for
// the reverted `ee2a315` approach (which added a live read to the legacy
// flow's own reply-critical path); this instead writes proactively from the
// One-Mind side, so the legacy flow's EXISTING read of its own session
// needs no companion fetch at all.
//
// Fully mocked Supabase REST layer, following the same pattern as
// create-booking-retry-idempotency.test.ts, so the guardrail logic (never
// clobber a legacy session that has already progressed past 'collecting',
// never steal a session that belongs to a different service type) is
// proven against the real function, not a re-implementation of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorActivityTaskToLegacySession } from '../netlify/functions/_operations-db';

const GUEST_DB_ID = '44444444-4444-4444-8444-444444444444';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockSupabase(existingSession: Record<string, unknown> | null) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let getCount = 0;

  const fetchMock = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';

    if (u.includes('/booking_sessions') && method === 'GET') {
      getCount += 1;
      return jsonResponse(existingSession ? [existingSession] : []);
    }
    if (u.includes('/booking_sessions') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      posts.push({ url: u, body });
      return jsonResponse([]);
    }
    throw new Error(`unexpected fetch in test: ${method} ${u}`);
  }) as typeof fetch;

  return { fetchMock, posts: () => posts, getCount: () => getCount };
}

async function withMockedSupabase<T>(
  existingSession: Record<string, unknown> | null,
  run: (mock: ReturnType<typeof mockSupabase>) => Promise<T>,
): Promise<T> {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const mock = mockSupabase(existingSession);
  global.fetch = mock.fetchMock;
  try {
    return await run(mock);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

test('mirrors a fresh activity task into a brand-new booking_sessions row when none exists yet', async () => {
  await withMockedSupabase(null, async mock => {
    await mirrorActivityTaskToLegacySession({
      guestDbId: GUEST_DB_ID,
      environment: 'live',
      resourceCode: 'activity-horse',
      durationMinutes: 30,
      date: null,
      time: null,
      partySize: null,
      asset: { name: 'ภาราดร', assetCode: 'horse-pharadon' },
    });
    const posts = mock.posts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.body.service_type, 'activity');
    assert.equal(posts[0]!.body.resource_code, 'activity-horse');
    assert.equal(posts[0]!.body.status, 'collecting');
    assert.equal(posts[0]!.body.special_request, 'activity_duration:30;activity_asset:horse-pharadon:%E0%B8%A0%E0%B8%B2%E0%B8%A3%E0%B8%B2%E0%B8%94%E0%B8%A3');
  });
});

test('updates an existing collecting activity session with the task\'s current slots', async () => {
  const existing = {
    service_type: 'activity', resource_code: 'activity-horse', requested_date: null, requested_time: null,
    end_date: null, party_size: null, quantity: 1, special_request: null, status: 'collecting', booking_code: null,
  };
  await withMockedSupabase(existing, async mock => {
    await mirrorActivityTaskToLegacySession({
      guestDbId: GUEST_DB_ID,
      resourceCode: 'activity-horse',
      durationMinutes: 60,
      date: '2026-10-03',
      time: '13:00',
      partySize: 2,
      asset: { name: 'ทองไทย', assetCode: 'horse-thongthai' },
    });
    const posts = mock.posts();
    assert.equal(posts.length, 1, 'a collecting session must be updated, not skipped');
    assert.equal(posts[0]!.body.requested_date, '2026-10-03');
    assert.equal(posts[0]!.body.requested_time, '13:00');
    assert.equal(posts[0]!.body.party_size, 2);
  });
});

test('GUARDRAIL: never overwrites a session the legacy flow has already progressed past collecting', async () => {
  for (const status of ['awaiting_phone', 'awaiting_special_request', 'submitted', 'ready', 'needs_slot', 'failed', 'cancelled']) {
    const existing = {
      service_type: 'activity', resource_code: 'activity-horse', requested_date: '2026-10-03', requested_time: '13:00',
      end_date: null, party_size: 2, quantity: 60, special_request: 'activity_duration:60', status, booking_code: status === 'submitted' ? 'BK-REAL-0001' : null,
    };
    await withMockedSupabase(existing, async mock => {
      await mirrorActivityTaskToLegacySession({
        guestDbId: GUEST_DB_ID,
        resourceCode: 'activity-horse',
        durationMinutes: 90,
        date: '2026-10-04',
        time: '14:00',
        partySize: 3,
        asset: { name: 'ภาราดร', assetCode: 'horse-pharadon' },
      });
      assert.equal(mock.posts().length, 0, `status=${status}: One-Mind must never override legacy-flow-specific progression`);
    });
  }
});

test('GUARDRAIL: never steals a legacy session already claimed by a different service type (e.g. an in-progress stay booking)', async () => {
  const existingStaySession = {
    service_type: 'stay', resource_code: 'stay-hueun', requested_date: '2026-10-05', requested_time: null,
    end_date: '2026-10-07', party_size: 2, quantity: 1, special_request: null, status: 'collecting', booking_code: null,
  };
  await withMockedSupabase(existingStaySession, async mock => {
    await mirrorActivityTaskToLegacySession({
      guestDbId: GUEST_DB_ID,
      resourceCode: 'activity-horse',
      durationMinutes: 30,
      date: null,
      time: null,
      partySize: null,
      asset: null,
    });
    assert.equal(mock.posts().length, 0, 'an in-progress stay session must never be overwritten with activity data');
  });
});

test('no-op with zero network calls when guestDbId is null', async () => {
  await withMockedSupabase(null, async mock => {
    await mirrorActivityTaskToLegacySession({
      guestDbId: null,
      resourceCode: 'activity-horse',
      durationMinutes: 30,
      date: null,
      time: null,
      partySize: null,
      asset: null,
    });
    assert.equal(mock.getCount(), 0);
    assert.equal(mock.posts().length, 0);
  });
});
