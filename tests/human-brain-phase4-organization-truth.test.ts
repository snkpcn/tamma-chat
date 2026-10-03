import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { resolveKnowledge, type KnowledgeRequest } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-26T02:00:00.000Z');

function request(overrides: Partial<KnowledgeRequest>): KnowledgeRequest {
  return {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    entities:{},
    constraints:[],
    needs:['catalog'],
    ...overrides,
  };
}

test('Human Brain Phase 4 RED: canonical Bible is a real stable organization knowledge source', async () => {
  const adapters = buildRealKnowledgeSourceAdapters('line', { environment:'test' });
  assert.equal(typeof adapters.bible?.stablePolicy, 'function',
    'One-Mind must ground stable organization relationships from the canonical Bible, not rely on prompt memory alone');

  const bundle = await resolveKnowledge(request({ domain:'ecosystem', needs:['catalog'] }), adapters, NOW);
  assert.equal(bundle.freshness, 'stable');
  assert.equal(bundle.sources[0]?.sourceType, 'bible');
  assert.equal(bundle.sources[0]?.status, 'ok');

  const vocabulary = bundle.facts.find(fact => fact.key === 'ecosystem:vocabulary');
  assert.ok(vocabulary);
  assert.equal(vocabulary?.authoritative, true);
  const text = String(vocabulary?.value ?? '');
  for (const expected of ['ตำมา-ชาติ','ทำมา-ชาติ ผจญภัย','ขี่ม้า','ATV','ยิงธนู','ทำมา-ชาติ เฮือนสเตย์','Inthanin','OTOP']) {
    assert.ok(text.includes(expected), expected);
  }
});

test('Human Brain Phase 4 guard: unsupported mutable sources stay explicitly unregistered instead of borrowing another source', async () => {
  const adapters = buildRealKnowledgeSourceAdapters('line', { environment:'test' });

  assert.equal(adapters.restaurant?.availability, undefined,
    'no real restaurant-table availability source exists yet; do not fake one');
  assert.equal(adapters.cafe?.facts, undefined,
    'no verified cafe menu/price/hours source exists yet; do not reintroduce fixture facts');

  const table = await resolveKnowledge(request({
    domain:'restaurant',
    intent:'table_availability_check',
    action:'status',
    needs:['availability'],
    entities:{date:'พรุ่งนี้',time:'18:00'},
  }), adapters, NOW);

  assert.equal(table.facts.length, 0);
  assert.deepEqual(table.missing, ['availability']);
  assert.equal(table.sources[0]?.status, 'unavailable');
  assert.equal(table.sources[0]?.reason, 'no_source_registered');
  assert.notEqual(table.sources[0]?.sourceId, 'restaurant_menu_live',
    'table availability must never be guessed from menu/orderability data');
});

test('Human Brain Phase 4 guard: stable Bible source is never treated as mutable live truth', async () => {
  const adapters = buildRealKnowledgeSourceAdapters('line', { environment:'test' });
  const mutableRestaurant = await resolveKnowledge(request({
    domain:'restaurant', intent:'ask_price', action:'ask', needs:['price'],
  }), {
    bible: adapters.bible,
  }, NOW);

  assert.equal(mutableRestaurant.facts.length, 0);
  assert.equal(mutableRestaurant.sources[0]?.status, 'unavailable');
  assert.equal(mutableRestaurant.sources[0]?.reason, 'no_source_registered');
  assert.notEqual(mutableRestaurant.sources[0]?.sourceType, 'bible');
});
