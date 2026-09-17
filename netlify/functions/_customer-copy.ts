export type CustomerCopyChannel = 'line' | 'web' | 'facebook' | 'backoffice';

const BULLET_RE = /^(?:[-–—*•]|\d+[.)])\s+/u;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u;
const URL_RE = /https?:\/\/\S+/giu;

function protectUrls(text: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  return {
    text: text.replace(URL_RE, value => {
      const index = urls.push(value) - 1;
      return `__URL_${index}__`;
    }),
    urls,
  };
}

function restoreUrls(text: string, urls: string[]): string {
  return text.replace(/__URL_(\d+)__/g, (_, raw: string) => urls[Number(raw)] ?? '');
}

function normalizeLine(line: string): string {
  const trimmed = line
    .replace(/[\t\u00A0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/^\*\*(.+)\*\*$/u, '$1')
    .trim();
  if (!trimmed) return '';
  if (/^[-–—*]\s+/u.test(trimmed)) return `• ${trimmed.replace(/^[-–—*]\s+/u, '')}`;
  return trimmed;
}

function softBreakLongParagraph(paragraph: string, target = 180): string[] {
  if (paragraph.length <= target || BULLET_RE.test(paragraph)) return [paragraph];

  const protectedValue = protectUrls(paragraph);
  const candidate = protectedValue.text
    .replace(/(ครับ|ค่ะ|คะ|นะครับ|นะคะ)(?=\s+[ก-๙A-Za-z0-9])/gu, '$1\n')
    .replace(/([.!?！？。])(?=\s+\S)/gu, '$1\n');
  const sentences = candidate.split(/\n+/).map(part => part.trim()).filter(Boolean);
  if (sentences.length <= 1) return [paragraph];

  const lines: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current.length + 1 + sentence.length) <= target) current += ` ${sentence}`;
    else {
      lines.push(restoreUrls(current, protectedValue.urls));
      current = sentence;
    }
  }
  if (current) lines.push(restoreUrls(current, protectedValue.urls));
  return lines;
}

function addUsefulEmoji(line: string): string {
  if (!line || EMOJI_RE.test(line) || BULLET_RE.test(line)) return line;
  if (/^(?:สถานะ|status)\s*:/iu.test(line)) return `📌 ${line}`;
  if (/^(?:รวม|ยอด|ราคา|ค่าใช้จ่าย|total|price)(?:\s|:|$)/iu.test(line)) return `💰 ${line}`;
  if (/^(?:รับอาหาร|เช็กอิน|เช็คอิน|check[- ]?in|เวลา|time)(?:\s|:|$)/iu.test(line)) return `🕑 ${line}`;
  if (/^(?:ที่ตั้ง|พิกัด|แผนที่|location|map)(?:\s|:|$)/iu.test(line)) return `📍 ${line}`;
  return line;
}

function normalizeSpacing(lines: string[]): string[] {
  const out: string[] = [];
  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      pushBlank();
      continue;
    }
    const isBullet = BULLET_RE.test(line);
    const prev = out[out.length - 1] ?? '';
    const prevBullet = BULLET_RE.test(prev);
    if (isBullet && out.length && prev && !prevBullet) pushBlank();
    if (!isBullet && prevBullet) pushBlank();
    out.push(line);
  }

  while (out[0] === '') out.shift();
  while (out[out.length - 1] === '') out.pop();
  return out.filter((line, index) => line !== '' || out[index - 1] !== '');
}

export function formatCustomerCopy(
  value: string,
  options: { channel?: CustomerCopyChannel; decorate?: boolean } = {},
): string {
  const channel = options.channel ?? 'line';
  const decorate = options.decorate ?? true;
  const rawLines = value
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(normalizeLine);

  const expanded = rawLines.flatMap(line => line ? softBreakLongParagraph(line, channel === 'line' ? 150 : 220) : ['']);
  const decorated = expanded.map(line => decorate ? addUsefulEmoji(line) : line);
  return normalizeSpacing(decorated).join('\n').trim();
}

function findCut(text: string, maxChars: number): number {
  const window = text.slice(0, maxChars + 1);
  const preferred = [
    window.lastIndexOf('\n\n'),
    window.lastIndexOf('\n'),
    window.lastIndexOf(' '),
  ];
  const cut = preferred.find(value => value >= Math.floor(maxChars * 0.55));
  return cut == null || cut < 1 ? maxChars : cut;
}

export function splitCustomerCopyForLine(
  value: string,
  options: { maxChars?: number; maxMessages?: number } = {},
): string[] {
  const maxChars = Math.max(480, Math.min(1800, options.maxChars ?? 1050));
  const maxMessages = Math.max(1, Math.min(5, options.maxMessages ?? 5));
  const text = formatCustomerCopy(value, { channel:'line' });
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars && chunks.length < maxMessages - 1) {
    const cut = findCut(remaining, maxChars);
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);

  if (chunks.length > maxMessages) {
    const head = chunks.slice(0, maxMessages - 1);
    head.push(chunks.slice(maxMessages - 1).join('\n\n'));
    return head;
  }
  return chunks;
}

export function customerCopyLooksMobileSafe(value: string): boolean {
  const formatted = formatCustomerCopy(value, { channel:'line' });
  const lines = formatted.split('\n');
  const noRunawayBlankSpace = !/\n{3,}/.test(formatted);
  const noMarkdownWall = !/(^|\n)#{1,6}\s|\*\*[^*]+\*\*/u.test(formatted);
  const noUnbrokenLongToken = lines.every(line => line.split(/\s+/).every(token => token.length <= 220 || /^https?:\/\//i.test(token)));
  return noRunawayBlankSpace && noMarkdownWall && noUnbrokenLongToken;
}
