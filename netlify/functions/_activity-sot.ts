// Activity source-of-truth reads. Mirrors _restaurant-sot.ts's role: a
// neutral domain module for the ACTIVITY business unit's live catalog data
// (activity_offerings + activity_assets), so it can be imported both by the
// Brain runtime (_thongthai-runtime-v3.ts) and by anything else that needs
// real activity data (e.g. Phase F's read-only Knowledge Resolver
// adapters) WITHOUT either side having to depend on the other. Extracted
// out of _thongthai-runtime-v3.ts (where it used to live inline) for
// exactly that reason -- importing the runtime/brain module just to reach
// one read-only catalog query would have pulled in the entire LLM-calling
// Brain as a transitive dependency, which the Dialog Manager must not have.
export type WorldFactRow = { fact_key: string; category: string; fact_value: unknown; source: string | null; updated_at: string };

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}
async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = configuration(); if (!c) throw new Error('Supabase configuration missing');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Supabase ${res.status}: ${body.slice(0,180)}`); }
  return res;
}

export async function loadActivityWorldFacts(): Promise<WorldFactRow[]> {
  try {
    const [offerRes, assetRes] = await Promise.all([
      dbFetch('activity_offerings?active=eq.true&select=activity_code,activity_name,duration_minutes,price,currency,metadata&order=sort_order.asc'),
      dbFetch('activity_assets?active=eq.true&select=activity_code,asset_code,name,asset_type,metadata&order=sort_order.asc'),
    ]);
    const offerings = await offerRes.json() as Array<{ activity_code:string; activity_name:string; duration_minutes:number; price:number|null; currency:string; metadata:Record<string,unknown> }>;
    const assets = await assetRes.json() as Array<{ activity_code:string; asset_code:string; name:string; asset_type:string; metadata:Record<string,unknown> }>;
    const resourceCode = (code:string) => code === 'atv' ? 'activity-atv' : code === 'horse' ? 'activity-horse' : 'activity-archery';
    const codes = [...new Set(offerings.map(row => row.activity_code))];
    const activities = codes.map(code => {
      const rows = offerings.filter(row => row.activity_code === code);
      const physical = assets.filter(row => row.activity_code === code);
      return {
        activityCode: code,
        resourceCode: resourceCode(code),
        name: rows[0]?.activity_name ?? code,
        durations: rows.map(row => ({ durationMinutes:Number(row.duration_minutes), price:row.price == null ? null : Number(row.price), currency:row.currency })),
        activeInventory: physical.length,
        assets: physical.map(row => ({ code:row.asset_code, name:row.name, type:row.asset_type })),
      };
    });
    const now = new Date().toISOString();
    return [{
      fact_key:'activity_catalog_live', category:'operations',
      fact_value:{ timezone:'Asia/Bangkok', serviceHours:{ start:'09:00', end:'17:00' }, bookingSlotMinutes:30, activities },
      source:'activity_offerings+activity_assets', updated_at:now,
    }];
  } catch (error) {
    console.error('THONGTHAI_ACTIVITY_FACTS_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown');
    return [];
  }
}
