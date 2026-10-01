import { ALL_OTOP_PRODUCTS } from '../src/data/otop';
import { matchOtopStory, storyMetadataFromCatalog, type OtopDbProductForStory } from '../src/data/otop/story-sync';

const apply = process.argv.includes('--apply');
const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error('Supabase ' + response.status + ': ' + (await response.text()).slice(0, 500));
  return response;
}

const response = await db('otop_products?environment=eq.live&select=id,sku,name,description,metadata&order=sku.asc');
const products = await response.json() as Array<OtopDbProductForStory & { sku: string; description?: string | null }>;

const report: Array<Record<string, unknown>> = [];
let updated = 0;

for (const row of products) {
  const match = matchOtopStory(row, ALL_OTOP_PRODUCTS);
  if (!match.product) {
    report.push({ sku: row.sku, name: row.name, status: match.ambiguous ? 'ambiguous' : 'unmatched', score: match.score });
    continue;
  }

  const metadata = storyMetadataFromCatalog(row.metadata, match.product);
  report.push({
    sku: row.sku,
    name: row.name,
    status: apply ? 'updated' : 'would-update',
    catalogProductId: match.product.id,
    score: match.score,
  });

  if (!apply) continue;
  await db('otop_products?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      metadata,
      description: row.description || match.product.shortDescription,
    }),
  });
  updated += 1;
}

console.table(report);
console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN',
  products: products.length,
  matched: report.filter(row => String(row.status).includes('update')).length,
  updated,
  unmatched: report.filter(row => row.status === 'unmatched').length,
  ambiguous: report.filter(row => row.status === 'ambiguous').length,
}, null, 2));

if (apply && report.some(row => row.status === 'ambiguous')) {
  console.error('Backfill completed with ambiguous rows; review them manually.');
  process.exitCode = 2;
}
