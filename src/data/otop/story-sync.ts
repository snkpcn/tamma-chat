import type { OtopProduct } from './types';

export type OtopDbProductForStory = {
  id: string;
  name: string;
  metadata?: Record<string, unknown> | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeOtopProductName(value: string): string {
  return String(value || '')
    .toLocaleLowerCase('th')
    .replace(/[\s\-–—_/()[\]{}.,:;'"“”‘’]+/g, '')
    .replace(/สินค้าotop|otop/g, '')
    .trim();
}

function productProvinceId(row: OtopDbProductForStory): string {
  const metadata = record(row.metadata);
  return String(metadata.provinceId ?? metadata.province_id ?? 'chaiyaphum').trim().toLowerCase();
}

function matchScore(row: OtopDbProductForStory, story: OtopProduct): number {
  if (productProvinceId(row) !== story.provinceId) return 0;
  const metadata = record(row.metadata);
  if (metadata.catalogProductId === story.id) return 100;
  const live = normalizeOtopProductName(row.name);
  const catalog = normalizeOtopProductName(story.productName);
  if (!live || !catalog) return 0;
  if (live === catalog) return 50;
  if (live.includes(catalog) || catalog.includes(live)) return 20;
  const origin = normalizeOtopProductName(story.originPlace);
  if (origin && live.includes(catalog) && live.includes(origin)) return 30;
  return 0;
}

export function matchOtopStory(
  row: OtopDbProductForStory,
  stories: OtopProduct[],
): { product: OtopProduct | null; ambiguous: boolean; score: number } {
  const ranked = stories
    .map(product => ({ product, score: matchScore(row, product) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

  if (!ranked.length) return { product: null, ambiguous: false, score: 0 };
  const ambiguous = ranked.length > 1 && ranked[0].score === ranked[1].score;
  return { product: ambiguous ? null : ranked[0].product, ambiguous, score: ranked[0].score };
}

export function storyMetadataFromCatalog(
  existing: Record<string, unknown> | null | undefined,
  product: OtopProduct,
): Record<string, unknown> {
  const metadata = { ...record(existing) };
  metadata.provinceId = product.provinceId;
  metadata.catalogProductId = product.id;
  metadata.storyVerified = product.publicClaimSafe === true;
  metadata.story = {
    originPlace: product.originPlace,
    makerName: product.makerName ?? null,
    makerType: product.makerType,
    category: product.category,
    coreValue: product.coreValue,
    craftProcess: product.craftProcess,
    materialOrIngredient: product.materialOrIngredient,
    whyHere: product.whyHere,
    shortDescription: product.shortDescription,
    longStory: product.longStory ?? null,
    imageCaption: product.imageCaption,
    storyKeywords: product.storyKeywords,
    sourceConfidence: product.sourceConfidence,
    publicClaimSafe: product.publicClaimSafe,
    needsOwnerConfirmation: product.needsOwnerConfirmation,
  };
  return metadata;
}
