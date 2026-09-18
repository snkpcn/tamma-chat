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

const DISCOVERY_CANONICAL = [
  'มีอะไรทำบ้าง',
  'มีกิจกรรมอะไรบ้าง',
  'มีประสบการณ์อะไรบ้าง',
  'ที่นี่มีอะไรให้ทำบ้าง',
  'มีอะไรให้เล่นบ้าง',
  'มีอะไรให้เที่ยวบ้าง',
  'มาครั้งแรกมีอะไรแนะนำ',
];

function normalizeThaiDiscoveryText(message: string): string {
  let text = String(message ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[!?！？….,，。/\\|()[\]{}"'“”‘’:_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Common spoken/typed Thai forms. This is intent normalization, not reply
  // rewriting, so customers can type naturally without matching a literal
  // canned phrase.
  text = text
    .replace(/อารัย|อะรัย|อาไร/gu, 'อะไร')
    .replace(/มี(?:ไล|ลัย|อะไล)(?=\s|ทำ|เล่น|เที่ยว|บ้าง|มั่ง|มั้ง|$)/gu, 'มีอะไร')
    .replace(/มี(?:รัย|ไร)(?=\s|ทำ|เล่น|เที่ยว|บ้าง|มั่ง|มั้ง|$)/gu, 'มีอะไร')
    .replace(/ทำ(?:รัย|ไร)(?=\s|บ้าง|มั่ง|มั้ง|ได้|$)/gu, 'ทำอะไร')
    .replace(/เล่น(?:รัย|ไร)(?=\s|บ้าง|มั่ง|มั้ง|$)/gu, 'เล่นอะไร')
    .replace(/เที่ยว(?:รัย|ไร)(?=\s|บ้าง|มั่ง|มั้ง|$)/gu, 'เที่ยวอะไร')
    .replace(/(?:มั่ง|มั้ง)/gu, 'บ้าง')
    .replace(/(?:ครับ|คับ|ค่ะ|คะ|จ้า|จ๊ะ|นะครับ|นะคะ|หน่อยครับ|หน่อยค่ะ|หน่อย)$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function compactThai(value: string): string {
  return value.replace(/\s+/g, '');
}

function editDistanceWithin(a: string, b: string, maxDistance: number): boolean {
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  if (a === b) return true;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }
  return previous[b.length]! <= maxDistance;
}

export function isExperienceDiscoveryIntent(message: string): boolean {
  const text = normalizeThaiDiscoveryText(message);
  if (!text) return false;

  // Do not steal clearly restaurant-specific questions from the live menu
  // advisor just because they also contain "อะไร/แนะนำ".
  if (/(?:ที่ร้าน|ร้านอาหาร|เมนู|อาหารแนะนำ|กินอะไร|อะไรกิน)/u.test(text)) return false;

  if (DISCOVERY_PATTERNS.some(pattern => pattern.test(text))) return true;

  const compact = compactThai(text);
  const hasDiscoveryShape =
    /(กิจกรรม|ประสบการณ์)/u.test(text)
    || /(?:มี|ที่นี่).*(?:อะไร|ไร).*(?:ทำ|เล่น|เที่ยว)/u.test(text)
    || /(?:ทำ|เล่น|เที่ยว).*(?:อะไร|ไร).*(?:ได้|บ้าง)/u.test(text)
    || /(?:มาครั้งแรก|ครั้งแรก).*(?:แนะนำ|อะไร)/u.test(text);
  if (hasDiscoveryShape) return true;

  // Short Thai chat often has one or two key typos ("มีไลทำมั่ง",
  // "มีอะไลทำบ้าง"). For this narrow intent only, tolerate a tiny edit
  // distance from known semantic anchors instead of falling through to the
  // generic LLM-unavailable response.
  const maxDistance = compact.length <= 14 ? 2 : 3;
  return DISCOVERY_CANONICAL.some(candidate =>
    editDistanceWithin(compact, compactThai(candidate), maxDistance));
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
