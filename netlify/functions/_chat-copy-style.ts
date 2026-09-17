export type CustomerChatChannel = 'line' | 'web' | 'facebook' | 'backoffice';

const MARKDOWN_HEADING = /^\s*#{1,6}\s+/;
const MARKDOWN_BULLET = /^\s*[-*]\s+/;
const MARKDOWN_RULE = /^\s*(?:[-*_]\s*){3,}$/;
const MARKDOWN_TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const BULLET_LINE = /^\s*•\s+/;
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u;
const LINE_PLATFORM_TEXT_LIMIT = 4900;

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

      if (previousIsContent && currentIsContent && previousIsBullet !== currentIsBullet) out.push('');
      out.push(line);
    }
  }
  return out;
}

/**
 * Last-mile presentation cleanup for customer-facing Thongthai copy.
 * It does not rewrite facts, URLs, prices, names or operational status.
 * It only normalizes presentation: plain text, spacing, restrained emoji,
 * and phone-friendly line length.
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
 * Split LINE copy into readable phone-sized bubbles while always staying under
 * LINE's real text limit. A caller can ask for a larger target, but customer
 * bubbles are capped at 1100 characters unless more space is mathematically
 * necessary to preserve all content within the five-message platform budget.
 */
export function splitCustomerMessageForLine(
  input: string,
  maxChars = 1100,
  maxMessages = 5,
): string[] {
  const text = polishCustomerMessage(input, 'line');
  if (!text) return [];

  const messageBudget = Math.max(1, Math.min(5, Math.floor(maxMessages)));
  const requestedTarget = Math.max(200, Math.min(1100, Math.floor(maxChars)));
  const requiredTarget = Math.ceil(text.length / messageBudget);
  const target = Math.min(LINE_PLATFORM_TEXT_LIMIT, Math.max(requestedTarget, requiredTarget));

  if (text.length <= target) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > target && chunks.length < messageBudget - 1) {
    const cut = bestReadableCut(remaining, target);
    const chunk = remaining.slice(0, cut).trim();
    if (!chunk) break;
    chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);

  if (chunks.some(chunk => chunk.length > LINE_PLATFORM_TEXT_LIMIT)) {
    throw new Error('line_message_exceeds_platform_limit');
  }
  return chunks;
}
