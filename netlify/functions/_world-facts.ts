export type VerifiedWorldFactRow = {
  fact_key: string;
  category: string;
  fact_value: unknown;
  source: string | null;
  updated_at: string;
};

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

export async function loadVerifiedWorldFacts(category?: string | null): Promise<VerifiedWorldFactRow[]> {
  const c = configuration();
  if (!c) return [];
  const filter = category?.trim() ? `&category=eq.${encodeURIComponent(category.trim())}` : '';
  const response = await fetch(
    `${c.url}/rest/v1/world_facts?active=eq.true&verified=eq.true${filter}&select=fact_key,category,fact_value,source,updated_at&order=fact_key.asc&limit=300`,
    {
      headers: {
        apikey: c.key,
        Authorization: `Bearer ${c.key}`,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 180)}`);
  }
  return response.json() as Promise<VerifiedWorldFactRow[]>;
}
