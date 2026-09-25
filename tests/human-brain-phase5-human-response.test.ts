import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResponseComposerPrompt,
  composeDeterministicResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';

function decision(domain: string, need: string, entities: Record<string, unknown>): DialogDecision {
  return {
    mode: 'query_knowledge',
    taskStateContainer: emptyTaskStateContainer(),
    knowledgeRequests: [{ domain, needs: [need], entities } as any],
    missingFields: [],
    responseIntent: 'source_unavailable_apology',
    reasons: ['knowledge_unverified'],
  };
}

function degradation(condition: 'fact_unknown' | 'source_unavailable'): DegradationPlan {
  return {
    version: 'test',
    condition,
    level: 'human_handoff',
    reasonCodes: condition === 'fact_unknown' ? ['fact_not_verified'] : ['authoritative_source_unavailable'],
    retryable: condition === 'source_unavailable',
    safeToExecuteTransaction: false,
    sourceStates: [],
  };
}

function input(args: {
  domain: string;
  need: string;
  entities?: Record<string, unknown>;
  condition?: 'fact_unknown' | 'source_unavailable';
  userMessage?: string;
}): ResponseComposerInput {
  return {
    channel: 'line',
    language: 'th',
    userMessage: args.userMessage ?? '',
    dialogDecision: decision(args.domain, args.need, args.entities ?? {}),
    knowledgeBundles: [],
    degradation: degradation(args.condition ?? 'fact_unknown'),
  };
}

test('Human Response RED: restaurant availability answers like a person, not an intent-ack template', () => {
  const response = composeDeterministicResponse(input({
    domain: 'restaurant',
    need: 'availability',
    entities: { date: 'พรุ่งนี้', time: '18:00' },
    userMessage: 'ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ',
  }));

  assert.match(response.message, /พรุ่งนี้/u);
  assert.match(response.message, /18:00/u);
  assert.match(response.message, /โต๊ะ|ที่นั่ง/u);
  assert.doesNotMatch(response.message, /รับทราบครับ\s*ถามเรื่อง/u);
  assert.doesNotMatch(response.message, /ข้อมูลโต๊ะว่างแบบสดที่ยืนยันได้/u);
  assert.doesNotMatch(response.message, /18:00นะ/u);
  assert.match(response.message, /เช็ก|ตรวจ/u);
});

test('Human Response RED: unknown live facts use semantic domain/need copy beyond one restaurant sentence', () => {
  const cases = [
    {
      name: 'stay availability',
      response: composeDeterministicResponse(input({
        domain: 'stay',
        need: 'availability',
        entities: { date: 'วันเสาร์' },
        userMessage: 'เสาร์นี้ยังมีห้องไหม',
      })).message,
      must: [/วันเสาร์/u, /ห้อง|ที่พัก/u],
    },
    {
      name: 'activity schedule',
      response: composeDeterministicResponse(input({
        domain: 'activity',
        need: 'schedule',
        entities: { date: 'พรุ่งนี้', time: '15:00' },
        userMessage: 'พรุ่งนี้บ่ายสามยังมีรอบไหม',
      })).message,
      must: [/พรุ่งนี้/u, /15:00/u, /รอบ|เวลา/u],
    },
    {
      name: 'restaurant price',
      response: composeDeterministicResponse(input({
        domain: 'restaurant',
        need: 'price',
        entities: { itemName: 'คอหมูทอดสมุนไพร' },
        userMessage: 'คอหมูทอดสมุนไพรเท่าไหร่',
      })).message,
      must: [/ราคา/u, /คอหมูทอดสมุนไพร/u],
    },
  ];

  for (const item of cases) {
    for (const pattern of item.must) assert.match(item.response, pattern, item.name);
    assert.doesNotMatch(item.response, /ข้อมูลส่วนนี้ยังไม่มีข้อมูลยืนยัน/u, item.name);
    assert.doesNotMatch(item.response, /รับทราบครับ\s*ถามเรื่อง/u, item.name);
  }
});

test('Human Response RED: source unavailable says cannot check now, never implies verified empty', () => {
  const response = composeDeterministicResponse(input({
    domain: 'stay',
    need: 'availability',
    entities: { date: 'พรุ่งนี้' },
    condition: 'source_unavailable',
    userMessage: 'พรุ่งนี้มีห้องว่างไหม',
  }));

  assert.match(response.message, /พรุ่งนี้/u);
  assert.match(response.message, /ห้อง|ที่พัก/u);
  assert.match(response.message, /ตอนนี้|ขณะนี้/u);
  assert.match(response.message, /เช็ก|ตรวจ/u);
  assert.doesNotMatch(response.message, /ไม่มีห้อง|เต็มแล้ว/u);
});

test('Human Response RED: normal model composer doctrine forbids classification narration and robotic intent echo', () => {
  const prompt = buildResponseComposerPrompt(input({
    domain: 'restaurant',
    need: 'availability',
    entities: { date: 'พรุ่งนี้', time: '18:00' },
    userMessage: 'พรุ่งนี้หกโมงยังมีโต๊ะไหม',
  }));

  assert.match(prompt, /answer the substance first/i);
  assert.match(prompt, /do not narrate.*intent|do not restate.*intent/i);
  assert.match(prompt, /natural spoken thai/i);
});
