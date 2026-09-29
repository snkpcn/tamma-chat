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
type ActivityResourceRow = {
  code: string;
  name: string;
  description: string | null;
  default_capacity: number | null;
  active: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
};

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
    const [offerRes, assetRes, resourceRes] = await Promise.all([
      dbFetch('activity_offerings?active=eq.true&select=activity_code,activity_name,duration_minutes,price,currency,metadata&order=sort_order.asc'),
      dbFetch('activity_assets?active=eq.true&select=activity_code,asset_code,name,asset_type,metadata&order=sort_order.asc'),
      dbFetch('service_resources?service_type=eq.activity&active=eq.true&select=code,name,description,default_capacity,active,metadata,updated_at&order=name.asc'),
    ]);
    const offerings = await offerRes.json() as Array<{ activity_code:string; activity_name:string; duration_minutes:number; price:number|null; currency:string; metadata:Record<string,unknown> }>;
    const assets = await assetRes.json() as Array<{ activity_code:string; asset_code:string; name:string; asset_type:string; metadata:Record<string,unknown> }>;
    const resources = await resourceRes.json() as ActivityResourceRow[];
    const resourceCode = (code:string) => {
      const direct = resources.find(row =>
        row.code === code
        || row.code === `activity-${code}`
        || row.metadata?.activityCode === code
        || row.metadata?.activity_code === code
      );
      if (direct) return direct.code;
      if (code === 'atv') return 'activity-atv';
      if (code === 'horse') return 'activity-horse';
      if (code === 'pedal_boat') return 'activity-pedal-boat';
      return `activity-${code}`;
    };
    const resourceByCode = new Map(resources.map(row => [row.code, row]));
    const activityCodeFromResource = (resource:ActivityResourceRow):string => {
      const fromMeta = [resource.metadata?.activityCode, resource.metadata?.activity_code]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (fromMeta) return fromMeta.trim();
      return resource.code.replace(/^activity-/, '').replace(/-/g, '_');
    };
    const codes = [...new Set([...offerings.map(row => row.activity_code), ...resources.map(activityCodeFromResource)])];
    const activities = codes.map(code => {
      const rows = offerings.filter(row => row.activity_code === code);
      const physical = assets.filter(row => row.activity_code === code);
      const rCode = resourceCode(code);
      const resource = resourceByCode.get(rCode);
      const metadata = resource?.metadata ?? {};
      const configuredInventory = Number(metadata.inventoryTotal ?? metadata.inventory_total ?? resource?.default_capacity);
      const inventoryTotal = Number.isFinite(configuredInventory) && configuredInventory >= 0
        ? configuredInventory
        : physical.length;
      const status = typeof metadata.status === 'string' && metadata.status.trim()
        ? metadata.status.trim()
        : resource?.active === false ? 'unavailable' : 'available';
      return {
        activityCode: code,
        resourceCode: rCode,
        name: rows[0]?.activity_name ?? resource?.name ?? code,
        status,
        inventoryTotal,
        activeInventory: physical.length,
        notes: typeof metadata.notes === 'string' ? metadata.notes : null,
        requirements: Array.isArray(metadata.requirements) ? metadata.requirements.filter((value): value is string => typeof value === 'string') : [],
        durations: rows.map(row => ({
          durationMinutes:Number(row.duration_minutes),
          price:row.price == null ? null : Number(row.price),
          currency:row.currency,
          status: typeof row.metadata?.status === 'string' ? row.metadata.status : status,
        })),
        // `metadata` is passed through untouched -- optional structured
        // attributes (temperament, beginner suitability, etc.) live here IF
        // and only if operations has actually recorded them for this asset.
        // See _dialog-source-adapters.ts's activityCatalogAdapter for which
        // keys are surfaced as facts, and _activity-catalog-policy.ts's
        // header for why nothing is ever defaulted/invented here.
        assets: physical.map(row => ({ code:row.asset_code, name:row.name, type:row.asset_type, metadata:row.metadata ?? {} })),
      };
    });
    const updatedAt = resources.map(row => row.updated_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .reduce((latest, value) => value > latest ? value : latest, new Date().toISOString());
    return [{
      fact_key:'activity_catalog_live', category:'operations',
      // Only values read from the operational tables plus stable timezone.
      // Operating hours / slot policy are deliberately absent until a
      // canonical configured source provides them.
      fact_value:{ timezone:'Asia/Bangkok', activities },
      source:'activity_offerings+activity_assets+service_resources', updated_at:updatedAt,
    }];
  } catch (error) {
    console.error('THONGTHAI_ACTIVITY_FACTS_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown');
    return [];
  }
}
