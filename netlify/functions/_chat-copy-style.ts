export type CustomerChatChannel = 'line' | 'web' | 'facebook' | 'backoffice';

const MARKDOWN_HEADING = /^\s*#{1,6}\s+/;
const MARKDOWN_BULLET = /^\s*[-*]\s+/;
const MARKDOWN_RULE = /^\s*(?:[-*_]\s*){3,}$/;
const MARKDOWN_TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;

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

/**
 * Last-mile presentation cleanup for customer-facing Thongthai copy.
 * It does not rewrite facts, URLs, prices, names or operational status.
 * Its only job is to make model/deterministic copy render consistently
 * as clean plain text across the website, LINE and Messenger.
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
    }
    return line;
  });

  return lines
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
 * LINE supports very long text messages, but a single near-limit bubble is
 * unpleasant to scan on a phone. Split only when necessary, favouring paragraph
 * and line boundaries. Never silently drops the tail.
 */
export function splitCustomerMessageForLine(
  input: string,
  maxChars = 1800,
  maxMessages = 5,
): string[] {
  const text = polishCustomerMessage(input, 'line');
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining && chunks.length < Math.max(1, maxMessages - 1)) {
    if (remaining.length <= maxChars) break;
    const cut = bestReadableCut(remaining, maxChars);
    const chunk = remaining.slice(0, cut).trim();
    if (!chunk) break;
    chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
    } else {
      // Preserve all content when the configured message budget is exhausted.
      // The final chunk may be longer than the readability target but remains
      // below LINE's actual platform limit in normal Thongthai responses.
      chunks.push(remaining);
    }
  }
  return chunks.slice(0, maxMessages);
}
