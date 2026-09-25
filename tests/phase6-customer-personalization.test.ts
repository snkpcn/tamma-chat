import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { handler as customerMemoryHandler } from '../netlify/functions/customer-memory';

function messageOf(result: { payload: Record<string, unknown> }): string {
  return String(result.payload.message ?? '');
}

async function turn(gid: string, id: string, message: string) {
  return processThongthaiChatCore(brainRequest(message, gid, 'web'), id);
}

async function saveMemory(gid: string, body: Record<string, unknown>) {
  const result = await customerMemoryHandler({
    httpMethod:'POST',
    body:JSON.stringify({
      guestId:gid,
      language:'th',
      guestContext:{
        tripDuration:null,
        travelerType:null,
        group:{ adults:null, children:null, elderly:null },
        interests:[],
        pace:null,
        budget:null,
        constraints:[],
      },
      ...body,
    }),
  } as never, {} as never, () => undefined as never);
  return result as { statusCode?: number; body?: string };
}

test('Phase 6: remembered child/family context shapes a later broad recommendation without fake certainty', async () => {
  await withHarness(async () => {
    const gid = guestId('phase6-child');
    await turn(gid, 'phase6-child-1', 'พาลูกมา');
    const later = await turn(gid, 'phase6-child-2', 'มีอะไรแนะนำ');
    assert.equal(later.statusCode, 200);
    const text = messageOf(later);
    assert.match(text, /เด็ก|ครอบครัว|น้อง/u, 'durable child context must shape the later host recommendation');
    assert.doesNotMatch(text, /ปลอดภัยแน่นอน|รับประกัน/u);
  });
});

test('Phase 6: remembered relaxed pace softly prioritizes a chill path on a later visit', async () => {
  await withHarness(async () => {
    const gid = guestId('phase6-pace');
    await turn(gid, 'phase6-pace-1', 'ขอแบบชิลๆ');
    const later = await turn(gid, 'phase6-pace-2', 'มีอะไรแนะนำ');
    assert.equal(later.statusCode, 200);
    const text = messageOf(later);
    assert.match(text, /ถ้ายัง.*ชิล|แนวชิล|ชิล.*ก่อน/u, 'remembered pace should be used softly, not ignored');
    assert.match(text, /คาเฟ่|อาหาร|พัก/u);
  });
});

test('Phase 6: remembered beginner/fear context prevents re-asking the same horse-care question', async () => {
  await withHarness(async () => {
    const gid = guestId('phase6-beginner-fear');
    await turn(gid, 'phase6-beginner-fear-1', 'ไม่เคยขี่ม้า กลัวตก');
    const later = await turn(gid, 'phase6-beginner-fear-2', 'อยากขี่ม้า');
    assert.equal(later.statusCode, 200);
    const text = messageOf(later);
    assert.match(text, /มือใหม่|เริ่ม.*ช้า|เริ่ม.*ชิล|ทีม.*ช่วย/u);
    assert.doesNotMatch(text, /เคยขี่ม้ามาก่อนไหม/u, 'known durable beginner context must not be asked again as if unknown');
    assert.doesNotMatch(text, /ปลอดภัยแน่นอน|รับประกัน/u);
  });
});

test('Phase 6: remembered couple context can shape a later broad host recommendation', async () => {
  await withHarness(async () => {
    const gid = guestId('phase6-couple');
    await turn(gid, 'phase6-couple-1', 'มากับแฟน');
    const later = await turn(gid, 'phase6-couple-2', 'มีอะไรแนะนำ');
    assert.equal(later.statusCode, 200);
    assert.match(messageOf(later), /แฟน|สองคน|คู่|พระอาทิตย์ตก/u);
  });
});

test('Phase 6: favorites and visited experiences survive the memory endpoint and influence broad host wording', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase6-favorite-visited');

    const saved = await saveMemory(gid, {
      action:'favorite',
      favorites:['sunset'],
      visitedExperiences:['inthanin'],
    });
    assert.equal(saved.statusCode, 200);

    const internalId = harness.guestDbId(gid);
    assert.ok(internalId);
    assert.deepEqual(harness.getGuestMemory(internalId!, 'favorites'), ['sunset']);
    assert.deepEqual(harness.getGuestMemory(internalId!, 'visited_experiences'), ['inthanin']);

    const later = await turn(gid, 'phase6-favorite-visited-2', 'มีอะไรแนะนำ');
    const text = messageOf(later);
    assert.match(text, /พระอาทิตย์ตก/u, 'favorite must be usable as a soft starting point');
    assert.match(text, /Inthanin|คาเฟ่/u, 'visited experience should be acknowledged only as an optional avoid-repeat hint');
    assert.match(text, /เคย|ซ้ำ|ถ้าอยาก/u);
  });
});

test('Phase 6: preferred language is durable, but an explicit new-language turn still wins over stale memory', async () => {
  await withHarness(async harness => {
    const gid = guestId('phase6-language');
    const result = await customerMemoryHandler({
      httpMethod:'POST',
      body:JSON.stringify({
        guestId:gid,
        language:'en',
        action:'profile',
        guestContext:{
          tripDuration:null,
          travelerType:null,
          group:{ adults:null, children:null, elderly:null },
          interests:[],
          pace:null,
          budget:null,
          constraints:[],
        },
      }),
    } as never, {} as never, () => undefined as never) as { statusCode?: number };
    assert.equal(result.statusCode, 200);
    const internalId = harness.guestDbId(gid)!;
    assert.equal(harness.getGuestMemory(internalId, 'preferred_language'), 'en');

    // Current explicit request language/message must win; stored language cannot
    // drag a new Thai intent back into English.
    const thai = await turn(gid, 'phase6-language-2', 'ทำมา-ชาติอยู่ที่ไหน');
    assert.match(messageOf(thai), /ปักหมุด|แผนที่|maps\.app\.goo\.gl/u);
  });
});

test('Phase 6: explicit new intent always beats personalization memory', async () => {
  await withHarness(async () => {
    const gid = guestId('phase6-explicit-wins');
    await turn(gid, 'phase6-explicit-wins-1', 'ขอแบบชิลๆ มากับแฟน');
    const location = await turn(gid, 'phase6-explicit-wins-2', 'ทำมา-ชาติอยู่ที่ไหน');
    const text = messageOf(location);
    assert.match(text, /maps\.app\.goo\.gl|ปักหมุด/u);
    assert.doesNotMatch(text, /สายชิล|พระอาทิตย์ตก|มากับแฟน/u, 'explicit current intent must not be hijacked by durable memory');
  });
});
