import test from 'node:test';
import assert from 'node:assert/strict';

import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

async function withEnv(values: Record<string,string|undefined>, fn: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key,value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
    await fn();
  } finally {
    for (const [key,value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
}

function facebookRequest(message:string, gid:string) {
  return {
    ...brainRequest(message,gid,'web'),
    pageContext:{section:'facebook'},
  };
}

function msg(result: Awaited<ReturnType<typeof processThongthaiChatCore>>):string {
  return String((result.payload as Record<string,unknown>).message ?? '');
}

test('Messenger/Inthanin: explicit cafe discovery bypasses 100% Agent and never leaks restaurant menu', async () => {
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK:'100',
  }, async () => {
    await withHarness(async harness => {
      const gid=guestId('messenger-inthanin-discovery');
      const before=harness.modelCallCount();
      const r=await processThongthaiChatCore(
        facebookRequest('อินทนินตรงตาดโตนมีอะไรแนะนำบ้างครับ',gid),
        'fb-cafe-1',
      );
      const reply=msg(r);
      assert.equal(r.statusCode,200);
      assert.match(reply,/Inthanin|อินทนิน/u);
      assert.match(reply,/ยังไม่มี|ไม่มี.*ยืนยัน|ไม่ขอเดา/u);
      assert.doesNotMatch(reply,/ลาบปลาช่อน|คอหมูย่าง|เสือร้องไห้/u);
      assert.equal(harness.modelCallCount(),before);
      assert.equal(harness.postsTo('cafe_inquiries').length,0);
      assert.equal(harness.postsTo('restaurant_preorders').length,0);
    });
  });
});

test('Messenger/Inthanin: natural preference chain stays grounded, remembers corrections, and never submits an order', async () => {
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK:'100',
  }, async () => {
    await withHarness(async harness => {
      const gid=guestId('messenger-inthanin-preferences');
      const turns=[
        'อินทนินตรงตาดโตนมีอะไรแนะนำบ้างครับ',
        'ผมหมายถึงเครื่องดื่มนะครับ ไม่ได้ถามของกิน',
        'อยากได้อะไรเย็นๆ ไม่หวานมาก แต่ก็ไม่เอาขมมากครับ',
        'ถ้าไม่กินกาแฟ มีอะไรแนะนำบ้างครับ',
        'ถามเผื่อแฟนนะครับ แต่วันนี้ผมมาคนเดียว',
        'เอาจริงๆ ยังไม่สั่งนะครับ แค่เลือกไว้ก่อน',
        'เมื่อกี้ตัวที่ไม่ใช่กาแฟ มีอะไรนะครับ',
        'แล้วถ้าไม่เอานมวัว มีตัวเลือกไหมครับ',
        'ไม่ใช่ครับ ผมไม่ได้แพ้นม แค่ช่วงนี้ไม่ค่อยอยากกินนมวัว',
        'งั้นกลับมาดูกาแฟก็ได้ครับ',
        'เอาเย็นนะครับ แต่ไม่ใส่น้ำตาลเลยทำได้ไหม',
        'เดี๋ยวก่อนครับ ยังไม่ต้องทำรายการนะ',
        'ร้านวันนี้เปิดถึงกี่โมงครับ',
        'ที่จอดรถสะดวกไหมครับ',
        'กลับมาเรื่องเครื่องดื่มครับ เมื่อกี้ผมสนใจอะไรไว้',
        'ตอนนี้มีรายการอะไรของผมถูกส่งไปที่ร้านหรือยังครับ',
      ];
      const replies:string[]=[];
      for(let i=0;i<turns.length;i+=1){
        const r=await processThongthaiChatCore(
          facebookRequest(turns[i]!,gid),
          `fb-cafe-chain-${i+1}`,
        );
        assert.equal(r.statusCode,200);
        replies.push(msg(r));
      }

      assert.ok(replies.every(reply=>!/ลาบปลาช่อน|คอหมูย่าง|เสือร้องไห้/u.test(reply)));
      assert.ok(replies.every(reply=>!/คิดช้ากว่าปกติ|ลองพิมพ์อีกครั้งในอีกสักครู่/u.test(reply)));
      assert.match(replies[2]!,/หวานน้อย/u);
      assert.match(replies[2]!,/ไม่ขมมาก/u);
      assert.match(replies[3]!,/ไม่เอากาแฟ/u);
      assert.match(replies[4]!,/มาคนเดียว/u);
      assert.match(replies[5]!,/ยังไม่ได้สั่ง|ไม่ได้สั่ง/u);
      assert.match(replies[7]!,/ไม่เอานมวัว/u);
      assert.match(replies[8]!,/ไม่ใช่อาการแพ้นม|ไม่ใช่.*แพ้/u);
      assert.doesNotMatch(replies[9]!,/ไม่เอากาแฟ/u);
      assert.match(replies[10]!,/ไม่ใส่น้ำตาล/u);
      assert.match(replies[12]!,/ยังไม่มีข้อมูล.*เวลา|ไม่มีข้อมูล.*เวลา|ไม่ขอเดา/u);
      assert.match(replies[13]!,/ที่จอดรถ/u);
      assert.match(replies[15]!,/ยังไม่มีคำสั่งให้ส่ง|ยังไม่ได้.*ส่ง/u);

      assert.equal(harness.postsTo('cafe_inquiries').length,0);
      assert.equal(harness.postsTo('bookings').length,0);
      assert.equal(harness.postsTo('restaurant_preorders').length,0);
    });
  });
});


test('Messenger/local concierge: complete solo chill request bypasses Agent and generic One-Mind fallback', async () => {
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK:'100',
    THONGTHAI_ONE_MIND_CUTOVER:'1',
  }, async () => {
    await withHarness(async harness => {
      // Reproduce the real production shape. If semantic supervision runs,
      // this scripted result would otherwise compose the generic "ตอบเรื่องนี้
      // ให้แม่นไม่ได้" response seen by the owner in Messenger.
      harness.programGeminiReply({
        normalizedMeaning:'solo visitor near Tad Tone wants a relaxed ninety-minute recommendation and explicitly does not want to book yet',
        reply:'ตอนนี้ทองไทยยังตอบเรื่องนี้ให้แม่นไม่ได้ครับ ลองอีกครั้งสักครู่ หรือให้ทีมงานช่วยต่อได้ครับ',
        speechAct:'request',
        domain:'local',
        intent:'request_relaxed_recommendation',
        action:'recommend',
        informationNeed:'recommendation',
        entities:{},
        references:[],
        constraints:[],
        confidence:0.99,
        needsClarification:true,
      });

      const gid=guestId('messenger-local-chill-owner-repro');
      const before=harness.modelCallCount();
      const r=await processThongthaiChatCore(
        facebookRequest(
          'ผมมาแถวตาดโตนคนเดียว มีเวลาประมาณชั่วโมงครึ่ง อยากได้อะไรชิลๆ ไม่รีบ ช่วยแนะนำหน่อยครับ แต่ยังไม่จองอะไรนะ',
          gid,
        ),
        'fb-local-chill-1',
      );
      const reply=msg(r);

      assert.equal(r.statusCode,200);
      assert.doesNotMatch(reply,/ตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่/u);
      assert.match(reply,/Inthanin|อินทนิน/u);
      assert.match(reply,/ขี่ม้า|ATV|ยิงธนู/u);
      assert.match(reply,/ยังไม่.*จอง|ไม่ส่งจอง/u);
      assert.equal(harness.modelCallCount(),before,'proven local-concierge class must not pay for Agent/semantic supervision');
      assert.equal(harness.postsTo('bookings').length,0);
      assert.equal(harness.postsTo('cafe_inquiries').length,0);
      assert.equal(harness.postsTo('restaurant_preorders').length,0);
    });
  });
});


test('Messenger topic switch: restaurant topic switch outranks stale cafe context', async () => {
  await withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK:'100',
    THONGTHAI_ONE_MIND_CUTOVER:'1',
  }, async () => {
    await withHarness(async harness => {
      const gid=guestId('messenger-cafe-to-restaurant-switch');

      const cafe=await processThongthaiChatCore(
        facebookRequest('แล้วร้านกาแฟละครับ',gid),
        'fb-topic-switch-cafe',
      );
      assert.equal(cafe.statusCode,200);
      assert.match(msg(cafe),/Inthanin|อินทนิน/u);

      const restaurant=await processThongthaiChatCore(
        facebookRequest('แล้วที่ร้านอาหารมีเมนูอะไรแนะนำครับ',gid),
        'fb-topic-switch-restaurant',
      );
      const reply=msg(restaurant);

      assert.equal(restaurant.statusCode,200);
      assert.match(reply,/ลาบปลาช่อน|คอหมูย่างจิ้มแจ่ว|เสือร้องไห้/u);
      assert.match(reply,/บาท/u);
      assert.doesNotMatch(reply,/Inthanin|อินทนิน|คาเฟ่/u);
      assert.doesNotMatch(reply,/ตอนนี้คุณยังไม่ได้บอกรสชาติ|ความชอบที่จำไว้/u);
      assert.equal(harness.postsTo('restaurant_preorders').length,0);
      assert.equal(harness.postsTo('cafe_inquiries').length,0);
    });
  });
});
