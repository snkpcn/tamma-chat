/** Which language to answer the customer's LATEST message in.
 *
 *  Both channels pass a starting language that is not about the message:
 *  the web sends the page's UI language, LINE used "any Thai character means
 *  Thai". A customer on a Thai page who types "Hi" was answered in Thai, and
 *  "Is the spicy soup available?" with one Thai dish name became Thai on LINE.
 *
 *  The message decides when it clearly can: other scripts first (Lao, CJK,
 *  Hangul, Vietnamese diacritics), then a word count of Thai against Latin
 *  words. Upper-case acronyms (ATV, OTOP, LINE) are names, not language, and
 *  are not counted. A tie -- including a message with no words at all, such
 *  as "555" or an emoji -- keeps the caller's fallback (the web UI language,
 *  or Thai on LINE), because the message does not say. */
export type CustomerLanguage = 'th' | 'en' | 'zh' | 'lo' | 'vi' | 'ja' | 'ko';

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
const THAI_RE = /[ก-๎]/u;
const LATIN_WORD_RE = /^[A-Za-z][A-Za-z'’-]*$/u;
const ACRONYM_RE = /^[A-Z0-9]{2,}$/u;
/** "ok" is typed the same way in every language here, so it says nothing
 *  about which one: a Thai customer's "ok" keeps the page's language. */
const NEUTRAL_WORDS = new Set(['ok', 'okay', 'oke', 'okie', 'okey']);

/** Vietnamese words that carry no Vietnamese-only letter ("Xin chào" has
 *  only "à", which French or Spanish also use). One of these together with
 *  a shared accent letter, or two of them, is Vietnamese. */
const VI_WORDS = new Set(['xin', 'chào', 'chao', 'cảm', 'cám', 'ơn', 'không', 'có', 'giá', 'bao', 'nhiêu', 'mấy', 'giờ',
  'tôi', 'bạn', 'ngày', 'mai', 'cho', 'được', 'là', 'gì', 'nào', 'ạ', 'ở', 'đâu', 'thế', 'vậy', 'của', 'và', 'với']);
const SHARED_ACCENT_RE = /[àáãèéìíòóõùúý]/iu;

/** The language the message itself shows, or null when it does not say
 *  (a tie, a number, an emoji). */
export function detectMessageLanguage(message: string): CustomerLanguage | null {
  const text = message.replace(/https?:\/\/\S+|\S+@\S+\.\S+/gu, ' ');
  if (/[຀-໿]/u.test(text)) return 'lo';
  if (/[぀-ヿ]/u.test(text)) return 'ja';
  if (/[가-힯]/u.test(text)) return 'ko';
  if (/[㐀-鿿]/u.test(text)) return 'zh';
  if (/[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u.test(text)) return 'vi';
  const latinWords = text.toLowerCase().normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean);
  const viWords = latinWords.filter(word => VI_WORDS.has(word)).length;
  if (viWords >= 2 || (viWords >= 1 && SHARED_ACCENT_RE.test(text))) return 'vi';

  let thai = 0;
  let latin = 0;
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    if (THAI_RE.test(part.segment)) thai += 1;
    else if (LATIN_WORD_RE.test(part.segment) && !ACRONYM_RE.test(part.segment) && !NEUTRAL_WORDS.has(part.segment.toLowerCase())) latin += 1;
  }
  if (thai > latin) return 'th';
  if (latin > thai) return 'en';
  return null;
}

export function resolveCustomerLanguage(message: string, fallback: CustomerLanguage): CustomerLanguage {
  return detectMessageLanguage(message) ?? fallback;
}
