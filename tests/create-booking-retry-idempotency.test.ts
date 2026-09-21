// Real gap found while verifying the new deterministic committed-activity-
// booking path (thongthai-chat.ts's executeDeterministicActivityBooking,
// reached from a single "เอาภาราดร ... จองเลย" style message): `bookings`
// has no idempotency_key column (unlike restaurant_preorders' real
// create_restaurant_preorder_v2 RPC), yet the LINE webhook layer
// (_line-webhook-core.ts's askThongthaiReliably) explicitly retries once on
// ANY failure -- including one thrown by something AFTER a booking write
// already succeeded (e.g. the guest_agent_state CAS write) -- on the
// documented assumption that "operational creates... are idempotent at the
// database layer". That assumption was false for activity bookings created
// through this new stateless, no-session-guard path: calling createBooking()
// twice with the identical guest+resource+start_at would have silently
// created two real bookings for the same request.
//
// Fixed with a short-window duplicate check inside createBooking() itself
// (protects every caller, not just the new path, no schema change). This
// test proves it end-to-end with a fully mocked Supabase REST layer: two
// createBooking() calls with identical args -> exactly ONE POST to
// `bookings`, both calls resolve to the SAME booking_code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../netlify/functions/_operations-db';

const RESOURCE_ROW = { id: 'res-horse-1', code: 'activity-horse', name: 'ขี่ม้า' };
const GUEST_DB_ID = '11111111-1111-4111-8111-111111111111';
const START_AT = '2026-10-01T10:00:00+07:00';
const END_AT = '2026-10-01T11:00:00+07:00';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A single realistic mock of the full createBooking() call chain for one
 *  activity booking (2 horse-riding schedule slots -> 60 minutes), with an
 *  in-memory `bookings` table so a second createBooking() call actually
 *  sees whatever the first one already wrote -- the real condition the
 *  duplicate check has to work under, not just a canned single response. */
function mockSupabase() {
  let postCount = 0;
  const bookingsTable: Array<{ guest_id: string | null; booking_code: string; status: string; start_at: string; end_at: string; created_at: string }> = [];
  let bookingSeq = 0;

  const fetchMock = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';

    if (u.includes('/service_resources') && method === 'GET') {
      // Both scheduleRowsForBooking's own lookup and listBookingOptions'
      // internal one hit this same table with slightly different selects --
      // one row is correct for either.
      return jsonResponse([{ ...RESOURCE_ROW, metadata: {} }]);
    }
    if (u.includes('/service_schedules') && method === 'GET') {
      // Two contiguous 30-minute slots covering 10:00-11:00, full capacity.
      return jsonResponse([
        { id: 'sched-1', start_at: START_AT, end_at: '2026-10-01T10:30:00+07:00', capacity_total: 2, capacity_reserved: 0 },
        { id: 'sched-2', start_at: '2026-10-01T10:30:00+07:00', end_at: END_AT, capacity_total: 2, capacity_reserved: 0 },
      ]);
    }
    if (u.includes('/customer_accounts') && method === 'GET') {
      return jsonResponse([{ id: 'cust-1' }]);
    }
    if (u.includes('/customer_accounts') && method === 'PATCH') {
      return jsonResponse([]);
    }
    if (u.includes('/bookings?') && method === 'GET') {
      // The duplicate-check query: guest_id + resource_id + start_at match,
      // status != cancelled, within the recent window -- exactly what a
      // retry of the SAME request would look like. Parse guest_id out of
      // the querystring so two different guests booking the identical slot
      // are never conflated with each other.
      const guestMatch = decodeURIComponent(u).match(/guest_id=eq\.([^&]+)/)?.[1] ?? null;
      const match = bookingsTable.filter(b => b.status !== 'cancelled' && b.guest_id === guestMatch);
      return jsonResponse(match.length ? [match[match.length - 1]] : []);
    }
    if (u.endsWith('/bookings') && method === 'POST') {
      postCount += 1;
      bookingSeq += 1;
      const body = JSON.parse(String(init.body ?? '{}')) as { guest_id?: string | null };
      const row = {
        guest_id: body.guest_id ?? null,
        booking_code: `BK-TEST-${String(bookingSeq).padStart(4, '0')}`,
        status: 'requested',
        start_at: START_AT,
        end_at: END_AT,
        created_at: new Date().toISOString(),
      };
      bookingsTable.push(row);
      return jsonResponse([{ id: `booking-row-${bookingSeq}`, ...row }]);
    }
    if (u.includes('/booking_allocations') && method === 'POST') {
      return jsonResponse([]);
    }
    throw new Error(`unexpected fetch in test: ${method} ${u}`);
  }) as typeof fetch;

  return { fetchMock, postCount: () => postCount };
}

test('a retried committed-activity-booking turn never creates a second real booking', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const { fetchMock, postCount } = mockSupabase();
  global.fetch = fetchMock;

  try {
    const input = {
      guestDbId: GUEST_DB_ID,
      channel: 'line' as const,
      serviceType: 'activity' as const,
      resourceCode: 'activity-horse',
      date: '2026-10-01',
      time: '10:00',
      durationMinutes: 60,
      partySize: 2,
      note: 'เลือก: ภาราดร [asset:horse-pharadon]',
    };

    const first = await createBooking(input);
    assert.equal(first.status, 'requested', 'a new booking is REQUESTED, never silently CONFIRMED');
    assert.equal(postCount(), 1, 'the first genuine attempt writes exactly one bookings row');

    // Simulate askThongthaiReliably's retry-on-any-later-failure: the exact
    // same committed-booking args, reached a second time.
    const second = await createBooking(input);

    assert.equal(postCount(), 1, 'a retry of the identical request must NOT create a second bookings row');
    assert.equal(second.bookingCode, first.bookingCode, 'the retry resolves to the SAME booking, not a new one');
    assert.equal(second.status, first.status);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('two genuinely distinct bookings (different guests) for the same slot are never merged', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const { fetchMock, postCount } = mockSupabase();
  global.fetch = fetchMock;

  try {
    const baseInput = {
      channel: 'line' as const,
      serviceType: 'activity' as const,
      resourceCode: 'activity-horse',
      date: '2026-10-01',
      time: '10:00',
      durationMinutes: 60,
      partySize: 1,
    };
    const guestA = '22222222-2222-4222-8222-222222222222';
    const guestB = '33333333-3333-4333-8333-333333333333';

    const first = await createBooking({ ...baseInput, guestDbId: guestA });
    const second = await createBooking({ ...baseInput, guestDbId: guestB });

    assert.equal(postCount(), 2, 'a different guest booking the identical slot is a genuinely distinct booking');
    assert.notEqual(first.bookingCode, second.bookingCode);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
