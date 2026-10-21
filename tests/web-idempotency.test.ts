import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// The page now sends one eventId per message, and the web handler claims it
// with the same customer_turn_outcomes claim LINE uses: a request delivered
// twice is answered once.

async function send(body: Record<string, unknown>) {
  const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) } as never, {} as never) as { statusCode: number; body: string };
  return { status: response.statusCode, payload: JSON.parse(response.body) as { message?: string; duplicate?: boolean } };
}

const turnRows = (harness: Harness, eventId: string) =>
  harness.postsTo('ai_response_turns').filter(row => (row as { event_id?: unknown }).event_id === eventId).length;

test('the same message delivered twice is answered once; the second gets an honest "arrived twice"', async () => {
  await withHarness(async harness => {
    const body = { ...brainRequest('เปิดกี่โมง', guestId('web-idem'), 'web'), eventId: 'web:message-1' };
    const first = await send(body);
    assert.match(first.payload.message ?? '', /06:00–18:00/u);
    const rowsAfterFirst = turnRows(harness, 'web:message-1');
    assert.ok(rowsAfterFirst > 0, 'the first delivery ran the turn');

    const again = await send(body);
    assert.equal(again.status, 200);
    assert.equal(again.payload.duplicate, true);
    assert.match(again.payload.message ?? '', /ส่งเข้ามาซ้ำ/u);
    assert.equal(turnRows(harness, 'web:message-1'), rowsAfterFirst, 'the second delivery did not run the turn again');

    const english = await send({ ...body, message: 'What time do you open?', language: 'en' });
    assert.match(english.payload.message ?? '', /^This message arrived twice/u, 'in the customer’s language');
  });
});

test('different messages, a request without an eventId, and the same id on LINE are each answered', async () => {
  await withHarness(async harness => {
    const gid = guestId('web-idem-many');
    for (const eventId of ['web:a', 'web:b']) {
      const reply = await send({ ...brainRequest('เปิดกี่โมง', gid, 'web'), eventId });
      assert.match(reply.payload.message ?? '', /06:00–18:00/u, eventId);
    }
    for (let i = 0; i < 2; i += 1) {
      const reply = await send(brainRequest('เปิดกี่โมง', gid, 'web'));
      assert.match(reply.payload.message ?? '', /06:00–18:00/u, 'no eventId: nothing to claim, always answered');
    }
    // LINE claims its own events on channel "line": a web id never blocks it.
    const line = await deliverLineTexts(harness, { userId: 'U-web-idem', texts: ['เปิดกี่โมง'] });
    assert.match(line.replies[0]?.texts.join('\n') ?? '', /06:00–18:00/u);
  });
});
