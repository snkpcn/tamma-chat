// Phase 1 hidden holdout acceptance.
// Created only after the runtime implementation was frozen and branch CI was green.
// These utterances are intentionally separate from the development/regression corpora.
// This runner calls the semantic interpreter only: no DB, no business tool, no transaction executor.

import {
  interpretSemanticTurn,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';

type HoldoutCase = {
  id: string;
  message: string;
  context: SemanticContext;
  check: (turn: SemanticTurn) => string[];
};

const empty = (): SemanticContext => ({ activeDomain: null, recentEntities: [] });

const horsePha = {
  id: 'holdout-horse-pha',
  type: 'horse',
  name: 'ภาราดร',
  domain: 'activity' as const,
  source: 'conversation' as const,
  canonical: false,
};

const horseThong = {
  id: 'holdout-horse-thong',
  type: 'horse',
  name: 'ทองไทย',
  domain: 'activity' as const,
  source: 'conversation' as const,
  canonical: false,
};

const stayTaskContext: SemanticContext = {
  activeDomain: 'stay',
  recentEntities: [{
    id: 'holdout-house-two-bed',
    type: 'stay',
    name: 'บ้านสองห้องนอน',
    domain: 'stay',
    source: 'conversation',
    canonical: false,
  }],
  recentTurns: [
    { role: 'assistant', content: 'เมื่อกี้เราคุยเรื่องบ้านพักสองห้องนอนกันอยู่' },
  ],
  activeTask: {
    type: 'stay_booking',
    domain: 'stay',
    status: 'collecting',
    knownSlots: { stayType: 'บ้านสองห้องนอน' },
    missingFields: ['date', 'time'],
    selectedEntities: [],
    constraints: [],
  },
  suspendedTask: null,
};

const horseContext: SemanticContext = {
  activeDomain: 'activity',
  recentEntities: [horsePha, horseThong],
  recentTurns: [
    { role: 'assistant', content: 'ทองไทยเป็นม้าสีทอง ส่วนภาราดรเป็นม้าสีน้ำตาลขาว' },
  ],
};

const singleHorseContext: SemanticContext = {
  activeDomain: 'activity',
  recentEntities: [horsePha],
  recentTurns: [
    { role: 'assistant', content: 'ตัวที่เพิ่งคุยกันคือภาราดร' },
  ],
};

const suspendedHorseContext: SemanticContext = {
  activeDomain: 'general',
  recentEntities: [horsePha],
  recentTurns: [
    { role: 'assistant', content: 'พักเรื่องเลือกม้าไว้ก่อน แล้วค่อยกลับมาคุยต่อได้' },
  ],
  activeTask: null,
  suspendedTask: {
    type: 'activity_booking',
    domain: 'activity',
    status: 'suspended',
    knownSlots: { activityType: 'horse' },
    missingFields: ['date', 'time'],
    selectedEntities: [horsePha],
    constraints: [],
  },
};

function noTransaction(turn: SemanticTurn): string[] {
  const errors: string[] = [];
  if (['book', 'order', 'confirm'].includes(turn.action)) {
    errors.push(`unexpected transaction-like action=${turn.action}`);
  }
  return errors;
}

const cases: HoldoutCase[] = [
  {
    id: 'h01-slang-social',
    message: 'โคตรเบื่ออะ คุยเป็นเพื่อนหน่อยดิ',
    context: empty(),
    check: turn => [
      ...(turn.domain === 'general' ? [] : [`domain=${turn.domain}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h02-local-colloquial',
    message: 'ตรงละแวกนั้นหมาจรเยอะปะ',
    context: empty(),
    check: turn => [
      ...(turn.domain === 'local' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'question' ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h03-incident-ellipsis',
    message: 'น่าจะทำแว่นหล่นไว้ตอนแวะเมื่อเช้า',
    context: empty(),
    check: turn => [
      ...(turn.domain === 'incident' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'incident_report' ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h04-unseen-dietary',
    message: 'เนื้อหมูนี่ขอเว้นละกัน',
    context: { activeDomain: 'restaurant', recentEntities: [] },
    check: turn => [
      ...(turn.domain === 'restaurant' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'preference_update' ? [] : [`speechAct=${turn.speechAct}`]),
      ...(turn.action === 'provide_information' ? [] : [`action=${turn.action}`]),
      ...(turn.constraints.includes('no_pork') ? [] : [`constraints=${JSON.stringify(turn.constraints)}`]),
    ],
  },
  {
    id: 'h05-incomplete-stay-catalog',
    message: 'บ้าน2ห้องนอนมีปะ',
    context: { activeDomain: 'stay', recentEntities: [] },
    check: turn => [
      ...(turn.domain === 'stay' ? [] : [`domain=${turn.domain}`]),
      ...(['catalog', 'availability'].includes(turn.informationNeed ?? '') ? [] : [`informationNeed=${turn.informationNeed}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h06-descriptive-reference',
    message: 'ตัวน้ำตาลขาวนั่นแหละ เอาตัวนั้น',
    context: horseContext,
    check: turn => [
      ...(turn.domain === 'activity' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'selection' ? [] : [`speechAct=${turn.speechAct}`]),
      ...(turn.references.some(r => r.resolvedEntityId === horsePha.id) ? [] : ['ภาราดร reference unresolved']),
    ],
  },
  {
    id: 'h07-pronoun-reference',
    message: 'เอาตัวนั้น',
    context: singleHorseContext,
    check: turn => [
      ...(turn.domain === 'activity' ? [] : [`domain=${turn.domain}`]),
      ...(turn.references.some(r => r.resolvedEntityId === horsePha.id) ? [] : ['single known horse reference unresolved']),
    ],
  },
  {
    id: 'h08-correction-not-booking',
    message: 'เดี๋ยวก่อน ถามเฉยๆ ยังไม่ได้จะจองนะ',
    context: stayTaskContext,
    check: turn => [
      ...(turn.speechAct === 'correction' ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h09-resume-suspended-topic',
    message: 'กลับไปเรื่องม้าที่ค้างไว้เมื่อกี้',
    context: suspendedHorseContext,
    check: turn => [
      ...(turn.domain === 'activity' ? [] : [`domain=${turn.domain}`]),
      ...(turn.taskDirective === 'resume_suspended' ? [] : [`taskDirective=${turn.taskDirective}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h10-open-world-general',
    message: 'ดาวเสาร์มีวงแหวนทำไมอะ',
    context: empty(),
    check: turn => [
      ...(turn.domain === 'general' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'question' ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h11-help-request-colloquial',
    message: 'wifi แถวนี้ต่อไม่ติดอะ ช่วยดูหน่อย',
    context: empty(),
    check: turn => [
      ...(['support', 'local'].includes(turn.domain) ? [] : [`domain=${turn.domain}`]),
      ...(['request_help', 'request'].includes(turn.speechAct ?? '') ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
  {
    id: 'h12-current-turn-outranks-stale-context',
    message: 'แล้วแถวนี้มีร้านขายยามั้ย',
    context: {
      activeDomain: 'restaurant',
      recentEntities: [],
      rollingSummary: 'ลูกค้าเคยบอกว่าไม่กินเผ็ด',
      recentTurns: [{ role: 'assistant', content: 'เมื่อกี้คุยเรื่องอาหารกันอยู่' }],
    },
    check: turn => [
      ...(turn.domain === 'local' ? [] : [`domain=${turn.domain}`]),
      ...(turn.speechAct === 'question' ? [] : [`speechAct=${turn.speechAct}`]),
      ...noTransaction(turn),
    ],
  },
];

async function main():Promise<void>{
  if (!process.env.OPENAI_API_KEY) {
    console.error('PHASE1_HIDDEN_HOLDOUT_NOT_RUN: OPENAI_API_KEY is required.');
    process.exitCode = 2;
    return;
  }

  const failures: Array<{ id: string; errors: string[] }> = [];
  const results: Array<{ id: string; domain: string; action: string; speechAct?: string; reviewed: boolean }> = [];

  for (const item of cases) {
    try {
      const turn = await interpretSemanticTurn(item.message, item.context);
      const errors = item.check(turn);
      results.push({
        id: item.id,
        domain: turn.domain,
        action: turn.action,
        speechAct: turn.speechAct,
        reviewed: Boolean(turn.needsClarification),
      });
      if (errors.length) failures.push({ id: item.id, errors });
    } catch (error) {
      failures.push({
        id: item.id,
        errors: [error instanceof Error ? error.message.slice(0, 240) : 'unknown error'],
      });
    }
  }

  const pass = cases.length - failures.length;
  console.log(JSON.stringify({
    kind: 'PHASE1_HIDDEN_OPEN_WORLD_HOLDOUT',
    total: cases.length,
    pass,
    failed: failures.length,
    passPct: Number((pass / cases.length * 100).toFixed(2)),
    failures,
    results,
  }, null, 2));

  if (failures.length) process.exitCode = 1;
}

main().catch(error=>{
  console.error('PHASE1_HIDDEN_HOLDOUT_CRASH',error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
