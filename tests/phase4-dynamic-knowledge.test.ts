import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { getGroundedFactValue, resolveKnowledge, type KnowledgeRequest } from '../netlify/functions/_knowledge-resolver';

const NOW = new Date('2026-09-29T08:00:00.000Z');

type MockDbState = {
  menuCanRemoveChili: boolean | null;
  pedalBoatInventory: number;
  pedalBoat30Price: number;
};

function request(domain: KnowledgeRequest['domain'], needs: KnowledgeRequest['needs'], entities: Record<string, unknown> = {}): KnowledgeRequest {
  return { domain, intent: 'ask', action: 'ask', entities, constraints: [], needs };
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function withMockSupabase<T>(state: MockDbState, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://phase4.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = decodeURIComponent(url.split('/rest/v1/')[1] ?? '');
    if (path.startsWith('restaurants?')) return json([{ id: 'restaurant-1' }]);
    if (path.startsWith('restaurant_menu_live?')) return json([{
      menu_item_id: 'menu-tam-lao',
      category_name: 'ตำ',
      category_sort_order: 1,
      sort_order: 1,
      name: 'ตำลาว',
      selling_price: 79,
      description: null,
      is_signature: false,
      ingredient_names: ['มะละกอดิบ', 'น้ำปลาร้า', 'พริก'],
      unavailable_ingredients: [],
      available_servings: 20,
      is_orderable: true,
      source_updated_at: '2026-09-29T07:00:00.000Z',
    }]);
    if (path.startsWith('restaurant_menu_intelligence_profiles?')) return json([{
      menu_item_id: 'menu-tam-lao',
      updated_at: '2026-09-29T07:01:00.000Z',
      profile: {
        safety: {
          allergens: { shrimp: 'contains', peanut: 'does_not_contain', fish: 'may_contain', egg: 'unknown' },
          contains: ['พริก'],
          mayContain: ['ปลา'],
          crossContaminationRisk: 'unknown',
          dietaryTags: [],
        },
        customization: {
          spiceAdjustable: true,
          allowedSpiceLevels: ['none', 'mild', 'medium', 'hot'],
          canRemoveChili: state.menuCanRemoveChili,
          canRemoveFermentedFish: true,
          canRemoveMsg: null,
          canReduceOrRemoveSugar: true,
          removableIngredients: ['พริก', 'น้ำปลาร้า'],
          addableIngredients: [],
          substitutions: [],
          kitchenNote: 'owner editable',
        },
      },
    }]);
    if (path.startsWith('activity_offerings?')) return json([
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 30, price: 300, currency: 'THB', metadata: {}, updated_at: '2026-09-29T07:00:00.000Z' },
      { activity_code: 'horse', activity_name: 'ขี่ม้า', duration_minutes: 45, price: 500, currency: 'THB', metadata: {}, updated_at: '2026-09-29T07:00:00.000Z' },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 30, price: state.pedalBoat30Price, currency: 'THB', metadata: {}, updated_at: '2026-09-29T07:00:00.000Z' },
      { activity_code: 'pedal_boat', activity_name: 'ปั่นเรือเป็ดน้ำ', duration_minutes: 60, price: 100, currency: 'THB', metadata: {}, updated_at: '2026-09-29T07:00:00.000Z' },
    ]);
    if (path.startsWith('activity_assets?')) return json([
      { activity_code: 'horse', asset_code: 'horse:thongthai', name: 'ทองไทย', asset_type: 'horse', metadata: { temperament: 'playful' } },
      { activity_code: 'horse', asset_code: 'horse:paradon', name: 'ภาราดร', asset_type: 'horse', metadata: { temperament: 'soft_ride' } },
    ]);
    if (path.startsWith('service_resources?service_type=eq.activity')) return json([
      { code: 'activity-horse', name: 'ขี่ม้า', description: null, default_capacity: 1, active: true, metadata: { activityCode: 'horse', status: 'available' }, updated_at: '2026-09-29T07:00:00.000Z' },
      { code: 'activity-pedal-boat', name: 'ปั่นเรือเป็ดน้ำ', description: null, default_capacity: state.pedalBoatInventory, active: true, metadata: { activityCode: 'pedal_boat', inventoryTotal: state.pedalBoatInventory, status: 'available' }, updated_at: '2026-09-29T07:00:00.000Z' },
    ]);
    return new Response(`unexpected path ${path}`, { status: 500 });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

test('Phase 4 gateway returns owner-editable activity prices and pedal boat inventory', async () => {
  await withMockSupabase({ menuCanRemoveChili: true, pedalBoatInventory: 2, pedalBoat30Price: 50 }, async () => {
    const bundle = await resolveKnowledge(
      request('activity', ['catalog', 'price', 'inventory']),
      buildRealKnowledgeSourceAdapters('web'),
      NOW,
    );
    assert.equal(getGroundedFactValue(bundle, 'activity:horse:30min:price').status === 'known' && getGroundedFactValue(bundle, 'activity:horse:30min:price').value, 300);
    assert.equal(getGroundedFactValue(bundle, 'activity:horse:45min:price').status === 'known' && getGroundedFactValue(bundle, 'activity:horse:45min:price').value, 500);
    assert.equal(getGroundedFactValue(bundle, 'activity:pedal_boat:30min:price').status === 'known' && getGroundedFactValue(bundle, 'activity:pedal_boat:30min:price').value, 50);
    assert.equal(getGroundedFactValue(bundle, 'activity:pedal_boat:60min:price').status === 'known' && getGroundedFactValue(bundle, 'activity:pedal_boat:60min:price').value, 100);
    assert.equal(getGroundedFactValue(bundle, 'activity:pedal_boat:inventoryTotal').status === 'known' && getGroundedFactValue(bundle, 'activity:pedal_boat:inventoryTotal').value, 2);
  });
});

test('Phase 4 gateway reflects owner data changes without code changes', async () => {
  await withMockSupabase({ menuCanRemoveChili: false, pedalBoatInventory: 1, pedalBoat30Price: 75 }, async () => {
    const bundle = await resolveKnowledge(
      request('activity', ['catalog', 'price', 'inventory']),
      buildRealKnowledgeSourceAdapters('line'),
      NOW,
    );
    assert.equal(getGroundedFactValue(bundle, 'activity:pedal_boat:inventoryTotal').status === 'known' && getGroundedFactValue(bundle, 'activity:pedal_boat:inventoryTotal').value, 1);
    assert.equal(getGroundedFactValue(bundle, 'activity:pedal_boat:30min:price').status === 'known' && getGroundedFactValue(bundle, 'activity:pedal_boat:30min:price').value, 75);
  });
});

test('Phase 4 restaurant customization/allergen facts are structured and tri-state', async () => {
  await withMockSupabase({ menuCanRemoveChili: true, pedalBoatInventory: 2, pedalBoat30Price: 50 }, async () => {
    const bundle = await resolveKnowledge(
      request('restaurant', ['catalog', 'ingredients']),
      buildRealKnowledgeSourceAdapters('web'),
      NOW,
    );
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:customization:canRemoveChili').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:customization:canRemoveChili').value, true);
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:shrimp').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:shrimp').value, 'contains');
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:peanut').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:peanut').value, 'does_not_contain');
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:fish').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:fish').value, 'may_contain');
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:egg').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:allergen:egg').value, 'unknown');
  });
});

test('Phase 4 restaurant owner change overrides stale local assumptions', async () => {
  await withMockSupabase({ menuCanRemoveChili: false, pedalBoatInventory: 2, pedalBoat30Price: 50 }, async () => {
    const bundle = await resolveKnowledge(
      request('restaurant', ['catalog']),
      buildRealKnowledgeSourceAdapters('line'),
      NOW,
    );
    assert.equal(getGroundedFactValue(bundle, 'menu:menu-tam-lao:customization:canRemoveChili').status === 'known' && getGroundedFactValue(bundle, 'menu:menu-tam-lao:customization:canRemoveChili').value, false);
  });
});

test('Phase 4 web and LINE adapters read the same canonical business truth', async () => {
  await withMockSupabase({ menuCanRemoveChili: true, pedalBoatInventory: 2, pedalBoat30Price: 50 }, async () => {
    const web = await resolveKnowledge(request('activity', ['catalog']), buildRealKnowledgeSourceAdapters('web'), NOW);
    const line = await resolveKnowledge(request('activity', ['catalog']), buildRealKnowledgeSourceAdapters('line'), NOW);
    assert.equal(getGroundedFactValue(web, 'activity:pedal_boat:inventoryTotal').status === 'known' && getGroundedFactValue(web, 'activity:pedal_boat:inventoryTotal').value, 2);
    assert.equal(getGroundedFactValue(line, 'activity:pedal_boat:inventoryTotal').status === 'known' && getGroundedFactValue(line, 'activity:pedal_boat:inventoryTotal').value, 2);
  });
});
