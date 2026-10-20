/** Normalize how a customer TYPED something, never what they meant.
 *
 * Two jobs, in this order:
 *  1. Typography: NFC, invisible separators, Thai digits, elongation.
 *  2. A deliberately CLOSED lexical map for the Isan register and the
 *     politeness spellings this ecosystem actually receives, so the
 *     downstream deterministic parsers and the semantic prompt both see the
 *     standard-Thai form of the SAME meaning.
 *
 * Negation is preserved, never dropped or inverted: "บ่มี" becomes "ไม่มี",
 * which makes the negation VISIBLE to parsers that only know "ไม่" instead
 * of silently invisible. Emoji joiners are kept.
 *
 * What this must never do: guess at a word that also exists in standard
 * Thai with a different meaning. Every entry below is justified against
 * that bar, and tests/customer-isan-text.test.ts pins the near-miss words.
 */

/** Isan negation. NOT a /บ่/ rule: บ่อ (pond), บ่อย (often), บ่าย
 *  (afternoon), บ่าว (young man), บ่ม (to ripen) and บ่น (to grumble) are
 *  ordinary standard-Thai words that any general prefix rule would corrupt
 *  into nonsense. Each entry here is "บ่" followed by a verb or adjective
 *  where the whole string is not a standard-Thai word. */
const ISAN_NEGATION: ReadonlyArray<readonly [RegExp, string]> = [
  [/บ่มี/gu, 'ไม่มี'],
  [/บ่ได้/gu, 'ไม่ได้'],
  [/บ่ต้อง/gu, 'ไม่ต้อง'],
  [/บ่เอา/gu, 'ไม่เอา'],
  [/บ่ใช่/gu, 'ไม่ใช่'],
  // Only the complete idiom. Review found the optional tail let a bare
  // "บ่เป็น" absorb whatever followed and gain a "ไร" that was never there:
  // "บ่เป็นไผ" -> "ไม่เป็นไรไผ", "บ่เป็นหนี้" -> "ไม่เป็นไรหนี้".
  // With the tail present the idiom is complete, so anything may follow
  // ("บ่เป็นหยังเด้อ").
  [/บ่เป็น(?:หยัง|อิหยัง|ไร)/gu, 'ไม่เป็นไร'],
  // Bare "บ่เป็น" only at the end of a clause. Anything else is "บ่" + a
  // different verb and must keep its own word.
  [/บ่เป็น(?![ก-๛])/gu, 'ไม่เป็นไร'],
  [/บ่ฮู้/gu, 'ไม่รู้'],
  [/บ่รู้/gu, 'ไม่รู้'],
  [/บ่ไหว/gu, 'ไม่ไหว'],
  [/บ่ทัน/gu, 'ไม่ทัน'],
  [/บ่ว่าง/gu, 'ไม่ว่าง'],
  [/บ่สะดวก/gu, 'ไม่สะดวก'],
  [/บ่พอ/gu, 'ไม่พอ'],
  [/บ่ดี/gu, 'ไม่ดี'],
  [/บ่แพง/gu, 'ไม่แพง'],
  [/บ่ไกล/gu, 'ไม่ไกล'],
  [/บ่แซบ/gu, 'ไม่อร่อย'],
  [/บ่ม่วน/gu, 'ไม่สนุก'],
  [/บ่อยาก/gu, 'ไม่อยาก'],
];

/** Everyday Isan vocabulary. Kept small on purpose: a word is only listed
 *  when the standard-Thai reading is absent or vanishingly unlikely in a
 *  restaurant / café / stay / activity conversation.
 *
 *  Two entries were REMOVED after review, and must not come back:
 *
 *  - "หม่ำ" -> "กิน". หม่ำ is an Isan fermented pork sausage, i.e. a real
 *    MENU ITEM here (and a nationally known performer's name). Rewriting it
 *    destroyed orders: "มีหม่ำไหม" became "มีกินไหม" and "สั่งหม่ำ 2 ไม้"
 *    became "สั่งกิน 2 ไม้", so the dish never reached the parser or the
 *    prompt. The model understands หม่ำ as food without help.
 *  - "เว้า" -> "พูด". "เว้า" is also standard Thai for concave, and it is a
 *    substring of "เว้าวอน" (to plead), which became "พูดวอน".
 *
 *  Both broke this file's own rule above: never rewrite a word that also
 *  exists in standard Thai with a different meaning. */
const ISAN_VOCABULARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/เบิ่ง/gu, 'ดู'],
  [/เฮ็ด/gu, 'ทำ'],
  [/แซ่บ/gu, 'อร่อย'],
  [/แซบ/gu, 'อร่อย'],
  [/ม่วน/gu, 'สนุก'],
  [/อีหลี/gu, 'จริง'],
  [/จั่งใด|จังได๋|จั่งได๋/gu, 'อย่างไร'],
  [/เท่าใด๋|เท่าได๋/gu, 'เท่าไหร่'],
  [/ยังใด๋/gu, 'อย่างไร'],
  [/สิไป/gu, 'จะไป'],
  [/กินข้าวแลง/gu, 'กินข้าวเย็น'],
  [/อิหยัง|หยัง/gu, 'อะไร'],
];

/** Politeness particles, anchored to the END of the message only, because
 *  "ค่า" mid-sentence is "ค่าอาหาร" (the food charge), not a particle.
 *
 *  "คับ" was REMOVED after review and must not come back. Anchoring is not
 *  enough for it: "คับ" is itself an ordinary word meaning tight, and it
 *  ends a sentence perfectly naturally --
 *
 *    "หมวกคับ" -> "หมวกครับ"
 *    "เสื้อคับ" -> "เสื้อครับ"
 *
 *  which silently deleted the customer's actual report. This ecosystem
 *  hands out riding helmets for the horse and ATV activities, so "หมวกคับ"
 *  is a safety message, not a greeting. Every remaining spelling here
 *  contains ร or a tone mark that no ordinary word shares. */
const TRAILING_POLITENESS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:คร้าบ|คร๊าบ|ค้าบ|คร่าบ|ครัช|ครัฟ|ขรับ)(?=[\s!?.…]*$)/u, 'ครับ'],
  [/(?:ค่าา|คร่า|ค๊ะ|ค้ะ|คะ่)(?=[\s!?.…]*$)/u, 'ค่ะ'],
];

/** Collapse an elongated run of the SAME character to one.
 *
 *  Threshold is 3, not 2: standard Thai really does place two identical
 *  consonants side by side across a syllable boundary ("บ้านนอก", "จันทร์",
 *  "ธรรมะ" patterns), and collapsing those would corrupt real words. Three
 *  or more of the same character is emphasis, not spelling. */
function collapseElongation(message: string): string {
  return message.replace(/([ก-๛A-Za-z])\1{2,}/gu, '$1');
}

function applyMap(
  message: string,
  entries: ReadonlyArray<readonly [RegExp, string]>,
): string {
  let value = message;
  for (const [pattern, replacement] of entries) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

export function normalizeCustomerText(message:string):string {
  const typography = collapseElongation(
    message.normalize('NFC')
      .replace(/[​⁠﻿]/gu, '')
      .replace(/[๐-๙]/gu, digit => String(digit.charCodeAt(0)-0x0E50)),
  ).trim();

  // Negation first: "บ่แซบ" must become "ไม่อร่อย", never "บ่อร่อย" via the
  // vocabulary map stripping its verb out from under the negation.
  return applyMap(
    applyMap(applyMap(typography, ISAN_NEGATION), ISAN_VOCABULARY),
    TRAILING_POLITENESS,
  ).trim();
}
