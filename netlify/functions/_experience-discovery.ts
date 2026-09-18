import { EXPERIENCES } from '../../src/data/experiences';

type WorldFactLike = { fact_key?: unknown; fact_value?: unknown };

const DISCOVERY_PATTERNS = [
  /มีประสบการณ์อะไร(?:บ้าง)?/u,
  /มีกิจกรรมอะไร(?:บ้าง)?/u,
  /มีอะไร(?:ให้)?ทำ(?:บ้าง)?/u,
  /ทำอะไรได้(?:บ้าง)?/u,
  /ที่นี่(?:มี)?อะไร(?:ให้)?ทำ(?:บ้าง)?/u,
  /มีอะไร(?:ให้)?เล่น(?:บ้าง)?/u,
  /มีอะไร(?:ให้)?เที่ยว(?:บ้าง)?/u,
  /(?:มาครั้งแรก|ครั้งแรก).*(?:มีอะไรแนะนำ|แนะนำอะไร)/u,
];

export function isExperienceDiscoveryIntent(message: string): boolean {
  const text = String(message ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return DISCOVERY_PATTERNS.some(pattern => pattern.test(text));
}

function catalogName(id: string, fallback: string): string {
  return EXPERIENCES.find(item => item.id === id)?.name || fallback;
}

function liveActivityNames(worldFacts: WorldFactLike[]): string[] {
  const fact = worldFacts.find(item => item?.fact_key === 'activity_catalog_live');
  const value = fact?.fact_value;
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  const activities = Array.isArray(raw.activities) ? raw.activities : [];

  const names = activities
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
    .filter(item => {
      const inventory = Number(item.activeInventory);
      return Number.isFinite(inventory) && inventory > 0;
    })
    .map(item => typeof item.name === 'string' ? item.name.trim() : '')
    .filter(Boolean);

  return [...new Set(names)].slice(0, 6);
}

export function formatExperienceDiscoveryMessage(worldFacts: WorldFactLike[]): string {
  const activities = liveActivityNames(worldFacts);
  const activityLine = activities.length
    ? `🌿 กิจกรรม — ${activities.join(' / ')}`
    : `🌿 กิจกรรม — ${catalogName('adventure', 'ทำมา-ชาติ ผจญภัย')}`;

  return [
    'มีครับ 😊 ที่ทำมา-ชาติมีหลายแบบ',
    '',
    `🍽️ กิน — ${catalogName('dining', 'ตำมา-ชาติ')}`,
    activityLine,
    `🏡 พัก — ${catalogName('stay', 'ทำมา-ชาติ เฮือนสเตย์')}`,
    `🌅 ชิล — ${catalogName('landscape', 'เดินชมพื้นที่กลาง')} / ${catalogName('sunset', 'ชมพระอาทิตย์ตก')}`,
    `☕ แวะพัก — ${catalogName('inthanin', 'Inthanin')}`,
    '',
    'บอกจำนวนคน + เวลาที่มีได้เลย ทองไทยจัดเป็นแพลนสั้น ๆ ให้ได้ครับ',
  ].join('\n');
}
