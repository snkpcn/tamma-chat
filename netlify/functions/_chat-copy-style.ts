export type CustomerChatChannel = 'line' | 'web' | 'facebook' | 'backoffice';

const MARKDOWN_HEADING = /^\s*#{1,6}\s+/;
const MARKDOWN_BULLET = /^\s*[-*]\s+/;
const MARKDOWN_RULE = /^\s*(?:[-*_]\s*){3,}$/;
const MARKDOWN_TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const BULLET_LINE = /^\s*•\s+/;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u;

function plainInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function plainTableLine(value: string): string {
  if (!/^\s*\|.*\|\s*$/.test(value)) return value;
  if (MARKDOWN_TABLE_DIVIDER.test(value)) return '';
  const cells = value
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
    .filter(Boolean);
  return cells.join(' · ');
}

function decorateOperationalLabel(value: string): string {
  const line = value.trim();
  if (!line || EMOJI_RE.test(line) || BULLET_LINE.test(line)) return value;
  if (/^(?:สถานะ|status)\s*:/iu.test(line)) return `📌 ${line}`;
  if (/^(?:รวม|ยอด|ราคา|ค่าใช้จ่าย|total|price)(?:\s|:|$)/iu.test(line)) return `💰 ${line}`;
  if (/^(?:รับอาหาร|เช็กอิน|เช็คอิน|เวลา|time|check[- ]?in)(?:\s|:|$)/iu.test(line)) return `🕑 ${line}`;
  if (/^(?:ที่ตั้ง|พิกัด|แผนที่|location|map)(?:\s|:|$)/iu.test(line)) return `📍 ${line}`;
  return value;
}

function wrapLongPlainLine(value: string, softLimit: number): string[] {
  const line = value.trim();
  if (!line || line.length <= softLimit || /^https?:\/\/\S+$/i.test(line) || BULLET_LINE.test(line)) return [value];

  // Thai customer copy usually contains spaces between clauses even when it has
  // no Western sentence punctuation. Prefer those natural boundaries rather
  // than rendering a single tall, dense mobile paragraph.
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 3) return [value];

  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > softLimit) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 1 ? chunks : [value];
}

function addStructuralSpacing(lines: string[], softLimit: number): string[] {
  const out: string[] = [];
  for (const sourceLine of lines) {
    for (const line of wrapLongPlainLine(sourceLine, softLimit)) {
      const previous = out.length ? out[out.length - 1] : '';
      const previousIsBullet = BULLET_LINE.test(previous);
      const currentIsBullet = BULLET_LINE.test(line);
      const previousIsContent = Boolean(previous.trim());
      const currentIsContent = Boolean(line.trim());

      // Give lists visual breathing room without scattering blank lines between
      // every bullet. This is much easier to scan in a LINE bubble and on web.
      if (previousIsContent && currentIsContent && previousIsBullet !== currentIsBullet) out.push('');
      out.push(line);
    }
  }
  return out;
}

/**
 * Last-mile presentation cleanup for customer-facing Thongthai copy.
 * Facts, URLs, prices, names and operational status are never rewritten.
 * This only normalizes presentation: plain text, spacing, restrained emoji,
 * and mobile-friendly line length.
 */
export function polishCustomerMessage(
  input: string,
  channel: CustomerChatChannel,
): string {
  const normalized = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();

  if (!normalized) return '';

  const plainTextChannel = channel === 'line' || channel === 'facebook' || channel === 'web';
  const lines = normalized.split('\n').map(rawLine => {
    let line = rawLine.trimEnd();
    if (plainTextChannel) {
      line = plainInlineMarkdown(line);
      line = line.replace(MARKDOWN_HEADING, '');
      if (MARKDOWN_RULE.test(line)) return '';
      line = plainTableLine(line);
      line = line.replace(MARKDOWN_BULLET, '• ');
      line = decorateOperationalLabel(line);
    }
    return line;
  });

  const softLimit = channel === 'line' ? 180 : 260;
  const structured = plainTextChannel ? addStructuralSpacing(lines, softLimit) : lines;
  return structured
    .join('\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeSliceEnd(text: string, requested: number): number {
  let end = Math.min(requested, text.length);
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
  }
  return Math.max(1, end);
}

function bestReadableCut(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const minimum = Math.floor(limit * 0.55);
  const candidates = [
    text.lastIndexOf('\n\n', limit),
    text.lastIndexOf('\n', limit),
    text.lastIndexOf('。', limit),
    text.lastIndexOf('. ', limit),
    text.lastIndexOf('! ', limit),
    text.lastIndexOf('? ', limit),
    text.lastIndexOf(' ', limit),
  ].filter(index => index >= minimum);
  return safeSliceEnd(text, candidates.length ? Math.max(...candidates) : limit);
}

/**
 * Keep customer LINE replies phone-sized. Callers may request a larger limit,
 * but customer-facing bubbles are capped at 1100 characters so a valid LINE
 * payload cannot accidentally become a wall of text. Content is never silently
 * dropped; it is split across up to five messages at readable boundaries.
 */
export function splitCustomerMessageForLine(
  input: string,
  maxChars = 1100,
  maxMessages = 5,
): string[] {
  const text = polishCustomerMessage(input, 'line');
  if (!text) return [];
  const readableLimit = Math.max(480, Math.min(1100, maxChars));
  const messageBudget = Math.max(1, Math.min(5, maxMessages));
  if (text.length <= readableLimit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining && chunks.length < Math.max(1, messageBudget - 1)) {
    if (remaining.length <= readableLimit) break;
    const cut = bestReadableCut(remaining, readableLimit);
    const chunk = remaining.slice(0, cut).trim();
    if (!chunk) break;
    chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.slice(0, messageBudget);
}
