export type PublicOtopStory = {
  originPlace?: string;
  makerName?: string;
  makerType?: string;
  category?: string;
  coreValue?: string;
  craftProcess?: string;
  materialOrIngredient?: string;
  whyHere?: string;
  shortDescription?: string;
  longStory?: string;
  imageCaption?: string;
  storyKeywords?: string[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function clean(value: unknown, max = 5000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, max) : undefined;
}

function list(value: unknown, maxItems = 20): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]+/) : [];
  return raw.map(item => clean(item, 180)).filter((item): item is string => Boolean(item)).slice(0, maxItems);
}

export function publicOtopStory(metadata: unknown): PublicOtopStory | null {
  const meta = record(metadata);
  if (meta.storyVerified !== true) return null;

  const raw = record(meta.story);
  if (raw.publicClaimSafe !== true) return null;

  const story: PublicOtopStory = {};
  const textFields: Array<keyof Omit<PublicOtopStory, 'storyKeywords'>> = [
    'originPlace', 'makerName', 'makerType', 'category', 'coreValue',
    'craftProcess', 'materialOrIngredient', 'whyHere', 'shortDescription',
    'longStory', 'imageCaption',
  ];
  for (const key of textFields) {
    const value = clean(raw[key], key === 'longStory' ? 5000 : 1200);
    if (value) story[key] = value;
  }
  const keywords = list(raw.storyKeywords);
  if (keywords.length) story.storyKeywords = keywords;

  return Object.keys(story).length ? story : null;
}

export function otopStorySearchText(story: PublicOtopStory | null): string {
  if (!story) return '';
  return [
    story.originPlace, story.makerName, story.makerType, story.category, story.coreValue,
    story.craftProcess, story.materialOrIngredient, story.whyHere, story.shortDescription,
    story.longStory, story.imageCaption, ...(story.storyKeywords ?? []),
  ].filter(Boolean).join(' ');
}
