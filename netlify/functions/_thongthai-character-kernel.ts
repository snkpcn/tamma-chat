import type { BrainChannel, BrainRequest } from './_thongthai-brain-v3';

const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/gu;
const CRITICAL_RE = /(?:บาดเจ็บ|เลือดออก|หมดสติ|อุบัติเหตุ|จมน้ำ|ไฟไหม้|ไฟลุก|ไฟดูด|ไฟช็อต|อันตราย|เด็กหาย|คนหาย|คุกคาม|ข่มขู่|ทำร้าย|1669|191|199)/u;
const SOURCE_QUESTION_RE = /(?:ข้อมูล.*จากไหน|แหล่งข้อมูล|source|provider|ใช้.*(?:openweather|openai|gemini|supabase))/iu;
const SOURCE_JARGON_RE = /(?:จากข้อมูลล่าสุด\s*)?\((?:openweathermap|openweather|supabase|openai|gemini)\)\s*[:：]?\s*/giu;

function protectCanonicalNames(value: string): string {
  return value
    .replace(/การาดร/gu, 'ภาราดร')
    .replace(/ภาราดอน/gu, 'ภาราดร');
}

function removeUnaskedProviderJargon(value: string, customerMessage: string): string {
  if (SOURCE_QUESTION_RE.test(customerMessage)) return value;
  return value
    .replace(SOURCE_JARGON_RE, '')
    .replace(/^จากข้อมูลล่าสุด\s*[:：-]?\s*/u, '');
}

function emergencyPlainText(value: string): string {
  return value.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

function restrainDecorativeEmoji(value: string): string {
  let seen = 0;
  return value.replace(EMOJI_RE, token => {
    seen += 1;
    return seen <= 2 ? token : '';
  }).replace(/[ \t]{2,}/g, ' ');
}

function paragraphizeDenseThai(value: string): string {
  if (value.includes('\n') || value.length < 170) return value;
  const sentences = value
    .split(/(?<=ครับ)\s+(?=[^\s])/u)
    .map(item => item.trim())
    .filter(Boolean);
  if (sentences.length < 3) return value;
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2).join(' '));
  }
  return paragraphs.join('\n\n');
}

function ensureThaiMaleEnding(value: string): string {
  let text = value.trim();
  if (!text) return text;
  text = text.replace(/ครับ\s*([\p{Extended_Pictographic}\uFE0F]+)\s*$/u, '$1 ครับ');
  if (/ครับ[.!?…]?$/u.test(text)) return text;
  return `${text}ครับ`;
}

/**
 * Character Kernel: the final personality contract shared by every public
 * customer channel. It never changes prices, availability, transaction state
 * or business facts. It only protects identity, reading rhythm, source jargon,
 * emoji restraint and the owner-locked male Thai voice.
 */
export function applyThongthaiCharacterKernel(input: {
  message: string;
  customerMessage: string;
  language: BrainRequest['language'];
  channel: BrainChannel;
}): string {
  let value = String(input.message ?? '').trim();
  if (!value) return value;

  value = protectCanonicalNames(value);
  value = removeUnaskedProviderJargon(value, input.customerMessage);

  if (input.language === 'th') {
    value = CRITICAL_RE.test(input.customerMessage)
      ? emergencyPlainText(value)
      : restrainDecorativeEmoji(value);
    value = paragraphizeDenseThai(value);
    value = ensureThaiMaleEnding(value);
  }

  return value.trim();
}
