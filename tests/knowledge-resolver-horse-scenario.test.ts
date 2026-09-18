// Phase E golden continuation of the canonical horse-booking scenario,
// exercising the Knowledge Resolver on the exact lines from the brief:
//   "ตัวไหนนิสัยดีกว่า" -> no verified temperament fact exists -> the
//     resolver must return an explicit unverified state, NEVER invent one
//     (the critical anti-hallucination acceptance case).
//   "เอาภาราดร" -> canonical horse identity resolution from a real
//     activity_assets-shaped candidate list.
//   "บ่ายสามได้ปะ" -> this need is LIVE availability, not static catalog/
//     Bible knowledge -- routed to the live activity source, and no
//     booking is executed (no transactional adapter is even provided).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGroundedFactValue, resolveEntityIdentity, resolveKnowledge,
  type CanonicalCandidate, type GroundedFact, type KnowledgeRequest, type SourceResult,
} from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function baseRequest(overrides: Partial<KnowledgeRequest>): KnowledgeRequest {
  return { domain: 'activity', intent: 'ask', action: 'ask', entities: {}, constraints: [], needs: [], ...overrides };
}
function fact(key: string, value: unknown, sourceId: string): GroundedFact {
  return { key, value, domain: 'activity', sourceId, sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() };
}

test('"ตัวไหนนิสัยดีกว่า": no verified temperament fact exists for either horse -- the resolver reports unverified, never invents "ภาราดรใจเย็นกว่า" or any other plausible-sounding claim', async () => {
  // A real activity_assets-shaped source: name, code, activity-level metadata
  // -- exactly what loadActivityWorldFacts()'s real shape carries today.
  // No temperament/personality field exists anywhere in this source.
  const activityCatalogFacts = [
    fact('activity_asset:horse:thongthai:name', 'ทองไทย', 'activity_assets'),
    fact('activity_asset:horse:paradon:name', 'ภาราดร', 'activity_assets'),
    fact('activity:horse:60min:price', 450, 'activity_offerings'),
  ];
  const bundle = await resolveKnowledge(baseRequest({ needs: ['entity_details'] }), {
    activity: { catalog: async () => ({ status: 'ok', data: activityCatalogFacts, sourceId: 'activity_assets', sourceType: 'activity_live', fetchedAt: NOW.toISOString() } satisfies SourceResult) },
  }, NOW);

  const thongthaiTemperament = getGroundedFactValue(bundle, 'temperament:horse:thongthai');
  const paradonTemperament = getGroundedFactValue(bundle, 'temperament:horse:paradon');
  assert.deepEqual(thongthaiTemperament, { status: 'unverified' });
  assert.deepEqual(paradonTemperament, { status: 'unverified' });

  // The resolver must never have synthesized a temperament value under any
  // key -- prove no fact in the whole bundle even mentions "temperament".
  assert.equal(bundle.facts.some(f => f.key.includes('temperament')), false, 'the resolver must not invent a temperament fact from a source that never provided one');
});

test('"เอาภาราดร": resolves to the canonical horse identity from a real activity_assets-shaped candidate list', () => {
  const candidates: CanonicalCandidate[] = [
    { canonicalId: 'activity_asset:horse:thongthai', name: 'ทองไทย', domain: 'activity' },
    { canonicalId: 'activity_asset:horse:paradon', name: 'ภาราดร', domain: 'activity' },
  ];
  const resolved = resolveEntityIdentity({ id: 'conv:horse:paradon', name: 'ภาราดร', domain: 'activity' }, candidates);
  assert.equal(resolved.canonical, true);
  assert.equal(resolved.canonicalId, 'activity_asset:horse:paradon');
  assert.equal(resolved.ambiguous, false);
});

test('"บ่ายสามได้ปะ": this need is LIVE availability, not static catalog/Bible knowledge -- routed to the live source, and no booking is ever executed', async () => {
  const availabilityFetch = async (): Promise<SourceResult> => ({
    status: 'ok', sourceId: 'schedule_rows', sourceType: 'activity_live', fetchedAt: NOW.toISOString(),
    data: [{ key: 'activity:horse:paradon:2026-09-19:15:00:available', value: true, domain: 'activity', sourceId: 'schedule_rows', sourceType: 'activity_live', authoritative: true, fetchedAt: NOW.toISOString() }],
  });
  const bundle = await resolveKnowledge(baseRequest({ needs: ['availability'] }), { activity: { availability: availabilityFetch } }, NOW);
  assert.equal(bundle.sources[0]?.sourceType, 'activity_live', 'availability must come from the LIVE source, never Bible/static catalog');
  assert.equal(bundle.freshness, 'live');
  // No booking/transactional adapter was ever supplied or called -- the
  // resolver has no mechanism to create a booking at all, by construction.
  assert.equal(getGroundedFactValue(bundle, 'activity:horse:paradon:2026-09-19:15:00:available').status, 'known');
});
