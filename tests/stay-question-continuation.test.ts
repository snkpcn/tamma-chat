import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { applyConversationContextUpdate, emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { extractDate } from '../netlify/functions/_slot-parsers';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { continueStayInquiry } from '../netlify/functions/_stay-inquiry-continuation';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';

for (const channel of ['web','line'] as const) {
  test(`${channel}: restaurant -> stay -> date and couple -> short acknowledgements never returns to the old menu`, async () => {
    await withHarness(async h => {
      const gid = guestId(`stay-question-${channel}`);
      await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, channel), 'init');
      const db = h.guestDbId(gid)!;
      const now = new Date();
      h.setState(db, {
        active_topic:'restaurant',restaurantAdvisorContext:{source:'restaurant_menu_advisor_v1',recentMessages:['ร้านอาหารมีอะไรแนะนำ'],updatedAt:now.toISOString()},
        conversationContext:applyConversationContextUpdate(emptyConversationContextState(now), {
          channel,userMessage:'ร้านอาหารมีอะไรแนะนำ',assistantMessage:'สนใจเมนูไหนครับ',activeDomain:'restaurant',activeTopic:'restaurant',
        }, now),
        pending_question:{domain:'restaurant',kind:'party_size',slot:'partySize'},
      });
      const history:Array<{role:'user'|'assistant';content:string}> = [];
      for (const [index, text] of ['อยากพัก','พักวันพรุ่งนี้ สองคนกับแฟน','จ้ะ','ใช่'].entries()) {
        const r = await processThongthaiChatCore(brainRequest(text, gid, channel, channel === 'web' ? history : []), `stay-${index}`);
        const answer = String(r.payload.message);
        assert.doesNotMatch(answer, /หมายถึงเมนู|เรื่องร้านอาหาร|ที่คุยไว้ก่อนหน้านี้ใช่ไหม|ตอบไม่ทัน/u);
        assert.equal(h.getState(db)?.state.active_topic, 'stay');
        const context = h.getState(db)?.state.conversationContext as {activeDomain:string};
        assert.equal(context.activeDomain, 'stay', 'our actual stay question must be durable before the next answer');
        if (index > 0) {
          assert.match(answer, /2 คน/u);
          assert.match(answer, /กี่คืน|จำนวนคืน/u);
          const inquiry = h.getState(db)?.state.stayInquiry as {date:string;partySize:number;nights:number|null};
          assert.equal(inquiry.date, extractDate('พรุ่งนี้', now));
          assert.equal(inquiry.partySize, 2);
          assert.equal(inquiry.nights, null, 'yes is not a number of nights');
        }
        history.push({role:'user',content:text},{role:'assistant',content:answer});
      }
      assert.equal(h.modelCallCount(), 0, 'answering our own bounded details question needs no paid interpretation');
      assert.equal(h.postsTo('bookings').length, 0);
      assert.equal(h.postsTo('restaurant_preorders').length, 0);
    });
  });
}

test('stay inquiry keeps supplied details, pauses old planning, and never treats yes as booking consent', async () => {
  await withHarness(async h => {
    const gid = guestId('stay-inquiry-boundaries');
    await processThongthaiChatCore(brainRequest('สวัสดีครับ', gid, 'web'), 'init');
    const db = h.guestDbId(gid)!;
    const oldTask = createActiveTask({type:'restaurant_booking',sourceChannel:'web',initialSlots:{partySize:4}}, new Date());
    h.setState(db, {active_topic:'restaurant',taskState:{...emptyTaskStateContainer(),activeTask:oldTask}});
    const turn = (message:string, id:string) => continueStayInquiry(brainRequest(message, gid, 'web'),db,'web',id);
    assert.equal(await turn('สองคน', 'unrelated-party'), null, 'a party answer outside our own stay question belongs to its current topic');
    const recovered = await turn('พักวันพรุ่งนี้ สองคนกับแฟน', 'recover');
    assert.match(recovered?.message ?? '', /2 คน.*กี่คืน/u);
    const paused = h.getState(db)?.state.taskState as ReturnType<typeof emptyTaskStateContainer>;
    assert.equal(paused.activeTask, null);
    assert.equal(paused.suspendedTask?.taskId, oldTask.taskId);
    for (const [index, message] of ['พรุ่งนี้ฝนตกไหม','ขอดูเมนูร้านอาหาร','ยกเลิกก่อน','เริ่มใหม่','ยืนยันจอง 1 คืน'].entries()) {
      const before = structuredClone(h.getState(db)?.state);
      assert.equal(await turn(message, `yield-${index}`), null, message);
      assert.deepEqual(h.getState(db)?.state, before, 'unrelated questions and transaction intent must not be consumed');
    }
    const completed = await turn('หนึ่งคืนครับ', 'nights');
    assert.match(completed?.canonicalMessage ?? '', /2 คน 1 คืน ยังไม่จอง/u);
    const state = h.getState(db)!.state;
    assert.equal((state.stayInquiry as {nights:number}).nights, 1);
    assert.equal((state.conversationContext as {openQuestion:null}).openQuestion, null);
    assert.equal((state.taskState as ReturnType<typeof emptyTaskStateContainer>).activeTask, null);
    assert.equal(h.postsTo('bookings').length, 0);
  });
});
