import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn } from '../netlify/functions/_dialog-manager';
import {
  applyConversationContextUpdate,
  buildSemanticContext,
  emptyConversationContextState,
  type ConversationContextState,
} from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeSourceAdapters, SourceResult } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-28T09:10:00.000Z');

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    semanticSource: 'openai_supervisor',
    domain: 'general',
    intent: 'phase2_long_conversation',
    action: 'ask',
    informationNeed: 'none',
    speechAct: 'question',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.96,
    needsClarification: false,
    ...overrides,
  };
}

function emptyResult(sourceId: string, sourceType: SourceResult['sourceType']): SourceResult {
  return { status: 'empty', sourceId, sourceType, fetchedAt: NOW.toISOString() };
}

test('Kernel V2 Phase 2: 34-turn working conversation memory survives switches, references, and non-commit planning', async () => {
  let conversationContext: ConversationContextState = emptyConversationContextState(NOW);
  let taskState: TaskStateContainer = emptyTaskStateContainer();
  const adapters: KnowledgeSourceAdapters = {
    activity: {
      catalog: async () => ({
        status: 'ok',
        sourceId: 'activity-catalog',
        sourceType: 'activity_live',
        fetchedAt: NOW.toISOString(),
        data: [
          { key: 'activity_asset:horse:paradon:name', value: 'ภาราดร', domain: 'activity', sourceId: 'activity-catalog', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
          { key: 'activity_asset:horse:thongthai:name', value: 'ทองไทย', domain: 'activity', sourceId: 'activity-catalog', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
          { key: 'activity:horse:resourceCode', value: 'activity-horse', domain: 'activity', sourceId: 'activity-catalog', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
          { key: 'activity:horse:45min:price', value: 500, domain: 'activity', sourceId: 'activity-catalog', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() },
        ],
      }),
      availability: async () => ({
        status: 'ok',
        sourceId: 'activity-schedule',
        sourceType: 'activity_live',
        fetchedAt: NOW.toISOString(),
        data: [{ key: 'availability:activity-horse:2026-09-29T15:00:00+07:00:available', value: true, domain: 'activity', sourceId: 'activity-schedule', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }],
      }),
    },
    restaurant: {
      catalog: async () => emptyResult('restaurant-menu', 'restaurant_live'),
      availability: async () => emptyResult('restaurant-table', 'restaurant_live'),
      recommendations: async () => emptyResult('restaurant-reco', 'restaurant_live'),
    },
    cafe: { catalog: async () => emptyResult('cafe-catalog', 'cafe_live') },
    stay: { catalog: async () => emptyResult('stay-catalog', 'stay_live'), availability: async () => emptyResult('stay-availability', 'stay_live') },
    otop: { catalog: async () => emptyResult('otop-catalog', 'otop_live') },
  };

  const turns: Array<{ message: string; semantic: SemanticTurn }> = [
    { message: 'มีอะไรทำบ้าง', semantic: turn({ domain: 'activity', intent: 'browse_activities', action: 'discover', informationNeed: 'catalog' }) },
    { message: 'ม้าล่ะ', semantic: turn({ domain: 'activity', intent: 'browse_horses', action: 'discover', informationNeed: 'catalog', entities: { activityCode: 'horse' } }) },
    { message: 'ตัวไหนเหมาะกับมือใหม่', semantic: turn({ domain: 'activity', intent: 'recommend_beginner_horse', action: 'recommend', informationNeed: 'recommendation', constraints: ['beginner_friendly'] }) },
    { message: 'เอาภาราดรไว้ก่อน แต่ยังไม่จองนะ', semantic: turn({ domain: 'activity', intent: 'consider_horse', action: 'confirm', speechAct: 'selection', entities: { horseName: 'ภาราดร', resourceCode: 'activity-horse' }, constraints: ['not_yet_booking'] }) },
    { message: 'มากับแฟนสองคน', semantic: turn({ domain: 'activity', intent: 'share_party_context', action: 'provide_information', speechAct: 'preference_update', entities: { partySize: 2, companion: 'partner' } }) },
    { message: 'ไม่อยากเหนื่อยมาก', semantic: turn({ domain: 'activity', intent: 'share_pace', action: 'provide_information', speechAct: 'preference_update', entities: { pace: 'relaxed' }, constraints: ['low_exertion'] }) },
    { message: 'ร้านมีอะไรกิน', semantic: turn({ domain: 'restaurant', intent: 'browse_menu', action: 'discover', informationNeed: 'catalog' }) },
    { message: 'แฟนกินเผ็ดไม่ค่อยได้', semantic: turn({ domain: 'restaurant', intent: 'share_food_constraint', action: 'provide_information', speechAct: 'preference_update', constraints: ['mild_spice'] }) },
    { message: 'ไม่เอากุ้งด้วย', semantic: turn({ domain: 'restaurant', intent: 'share_food_constraint', action: 'provide_information', speechAct: 'preference_update', constraints: ['no_shrimp'] }) },
    { message: 'โต๊ะพรุ่งนี้หกโมงเต็มไหม', semantic: turn({ domain: 'restaurant', intent: 'check_table_availability', action: 'status', informationNeed: 'availability', entities: { date: '2026-09-29', time: '18:00' } }) },
    { message: 'กาแฟมีอะไร', semantic: turn({ domain: 'cafe', intent: 'browse_cafe', action: 'discover', informationNeed: 'catalog' }) },
    { message: 'ของฝากมีไหม', semantic: turn({ domain: 'otop', intent: 'browse_otop', action: 'discover', informationNeed: 'catalog' }) },
    { message: 'เช็คอินที่พักกี่โมง', semantic: turn({ domain: 'stay', intent: 'ask_checkin', action: 'ask', informationNeed: 'policy' }) },
    { message: 'กลับไปเรื่องม้า', semantic: turn({ domain: 'activity', intent: 'resume_activity', action: 'ask', references: [{ type: 'topic', value: 'horse', refersToPriorContext: true, resolvedFromConversation: true }] }) },
    { message: 'ตัวนั้นจำไว้ไหม', semantic: turn({ domain: 'activity', intent: 'ask_considered_horse', action: 'ask', references: [{ type: 'entity_selection', value: 'ตัวนั้น', refersToPriorContext: true, resolvedEntityId: 'activity_asset:horse:paradon' }] }) },
    { message: 'ยังไม่จองนะ', semantic: turn({ domain: 'activity', intent: 'deny_commitment', action: 'correct_previous', speechAct: 'correction', constraints: ['not_yet_booking'] }) },
    { message: 'ทองไทยล่ะ', semantic: turn({ domain: 'activity', intent: 'ask_other_horse', action: 'ask', informationNeed: 'recommendation', entities: { horseName: 'ทองไทย' } }) },
    { message: 'ไม่เอาทองไทย ขออีกตัว', semantic: turn({ domain: 'activity', intent: 'reject_horse', action: 'correct_previous', speechAct: 'correction', entities: { excludedHorse: 'ทองไทย' } }) },
    { message: 'งั้นภาราดรเหมือนเดิม', semantic: turn({ domain: 'activity', intent: 'return_to_considered_horse', action: 'confirm', speechAct: 'selection', references: [{ type: 'entity_selection', value: 'ภาราดร', refersToPriorContext: true, resolvedEntityId: 'activity_asset:horse:paradon' }], entities: { horseName: 'ภาราดร' }, constraints: ['not_yet_booking'] }) },
    { message: 'ร้านอาหารพรุ่งนี้หกโมงถามอีกที', semantic: turn({ domain: 'restaurant', intent: 'check_table_availability_again', action: 'status', informationNeed: 'availability', entities: { date: '2026-09-29', time: '18:00' } }) },
    { message: 'เมนูไม่เผ็ดแนะนำหน่อย', semantic: turn({ domain: 'restaurant', intent: 'recommend_mild_food', action: 'recommend', informationNeed: 'recommendation', constraints: ['mild_spice'] }) },
    { message: 'คาเฟ่เปิดกี่โมง', semantic: turn({ domain: 'cafe', intent: 'ask_cafe_hours', action: 'ask', informationNeed: 'schedule' }) },
    { message: 'มีโปรอะไรไหม', semantic: turn({ domain: 'promotion', intent: 'ask_promotions', action: 'discover', informationNeed: 'catalog' }) },
    { message: 'สมาชิกได้อะไร', semantic: turn({ domain: 'membership', intent: 'ask_membership', action: 'ask', informationNeed: 'policy' }) },
    { message: 'ที่พักมีห้องกี่คน', semantic: turn({ domain: 'stay', intent: 'ask_capacity', action: 'ask', informationNeed: 'capacity' }) },
    { message: 'กลับม้าอีกที', semantic: turn({ domain: 'activity', intent: 'resume_activity_again', action: 'ask', references: [{ type: 'topic', value: 'horse', refersToPriorContext: true, resolvedFromConversation: true }] }) },
    { message: 'ตัวเดิมบ่ายสามว่างไหม', semantic: turn({ domain: 'activity', intent: 'check_considered_horse_availability', action: 'status', informationNeed: 'availability', entities: { date: '2026-09-29', time: '15:00' }, references: [{ type: 'entity_selection', value: 'ตัวเดิม', refersToPriorContext: true, resolvedEntityId: 'activity_asset:horse:paradon' }] }) },
    { message: 'ยังไม่ต้องทำรายการ', semantic: turn({ domain: 'activity', intent: 'deny_commitment_again', action: 'correct_previous', speechAct: 'correction', constraints: ['not_yet_booking'] }) },
    { message: 'สรุปที่จำไว้มีอะไร', semantic: turn({ domain: 'general', intent: 'summarize_working_memory', action: 'ask', informationNeed: 'none' }) },
    { message: 'ลืมเรื่องร้านก่อน', semantic: turn({ domain: 'restaurant', intent: 'suspend_restaurant_topic', action: 'correct_previous', speechAct: 'correction' }) },
    { message: 'กลับไปตัวม้า', semantic: turn({ domain: 'activity', intent: 'resume_activity_final', action: 'ask', references: [{ type: 'topic', value: 'horse', refersToPriorContext: true, resolvedFromConversation: true }] }) },
    { message: 'ขอเช็คราคาไว้ก่อน', semantic: turn({ domain: 'activity', intent: 'ask_price_before_booking', action: 'ask', informationNeed: 'price', entities: { resourceCode: 'activity-horse' } }) },
    { message: 'โอเค ยังไม่จอง', semantic: turn({ domain: 'activity', intent: 'final_no_commit', action: 'correct_previous', speechAct: 'correction', constraints: ['not_yet_booking'] }) },
    { message: 'โอเค จองภาราดรพรุ่งนี้บ่ายสาม 2 คน 45 นาทีให้เลย', semantic: turn({ domain: 'activity', intent: 'book_horse', action: 'book', speechAct: 'transaction_request', entities: { resourceCode: 'activity-horse', date: '2026-09-29', time: '15:00', partySize: 2, durationMinutes: 45 } }) },
  ];

  for (const [index, step] of turns.entries()) {
    const decision = await processDialogTurn({
      semanticTurn: step.semantic,
      conversationContext,
      taskState,
      channel: 'line',
      eventId: `phase2-long-${index + 1}`,
    }, adapters, new Date(NOW.getTime() + index * 1000));
    taskState = decision.taskStateContainer;

    if (index < turns.length - 1) {
      assert.equal(decision.actionProposal, undefined, `turn ${index + 1} must not transact`);
      assert.equal(taskState.activeTask, null, `turn ${index + 1} must keep planning out of transaction state`);
    }

    conversationContext = applyConversationContextUpdate(conversationContext, {
      channel: 'line',
      eventId: `phase2-long-${index + 1}`,
      userMessage: step.message,
      semanticTurn: step.semantic,
      activeDomain: step.semantic.domain === 'unknown' ? undefined : step.semantic.domain,
      newEntities: index === 1
        ? [
            { id: 'activity_asset:horse:paradon', type: 'activity_asset', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true },
            { id: 'activity_asset:horse:thongthai', type: 'activity_asset', name: 'ทองไทย', domain: 'activity', source: 'catalog', canonical: true },
          ]
        : undefined,
    }, new Date(NOW.getTime() + index * 1000));
  }

  assert.equal(conversationContext.workingMemory.partySize, 2);
  assert.equal(conversationContext.workingMemory.companion, 'partner');
  assert.equal(conversationContext.workingMemory.pace, 'relaxed');
  assert.ok(conversationContext.workingMemory.constraints.some(constraint => constraint.code === 'mild_spice'));
  assert.ok(conversationContext.workingMemory.constraints.some(constraint => constraint.code === 'no_shrimp'));
  assert.ok(conversationContext.workingMemory.consideredSelections.some(selection => selection.name === 'ภาราดร' && selection.status === 'considering'));
  assert.ok(conversationContext.workingMemory.consideredSelections.some(selection => selection.name === 'ทองไทย' && selection.status === 'rejected'));
  assert.equal(taskState.activeTask?.type, 'activity_booking');
  assert.equal(taskState.activeTask?.commitmentIntent, true);
});
