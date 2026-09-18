import { createHash } from 'node:crypto';

// The canonical doctrine section order. The compiler matches these H2
// headers exactly in THONGTHAI_BRAIN.md -- renaming a section here requires
// renaming the matching '## ...' header in the doc, and vice versa.
export const SECTION_ORDER = [
  ['identity', 'Identity'],
  ['personality', 'Personality'],
  ['conversationDoctrine', 'Conversation Doctrine'],
  ['ecosystemVocabulary', 'Ecosystem Vocabulary & Relationships'],
  ['customerServiceDoctrine', 'Customer Service Doctrine'],
  ['recommendationDoctrine', 'Recommendation Doctrine'],
  ['operationalTruthDoctrine', 'Operational Truth Doctrine'],
  ['memoryPrivacyDoctrine', 'Memory & Privacy Doctrine'],
  ['failureDoctrine', 'Failure Doctrine'],
  ['channelPresentationDoctrine', 'Channel Presentation Doctrine'],
];

// A best-effort guard against a mutable business fact leaking into doctrine.
// Not exhaustive -- doctrine is meant to describe principles, not quote
// numbers -- but it catches the obvious cases (a literal price, a literal
// promo/campaign code, a literal stock count sentence).
const MUTABLE_FACT_PATTERNS = [
  { name: 'literal Thai baht price', re: /\d+(?:[.,]\d+)?\s*บาท/u },
  { name: 'literal promo/campaign code', re: /PROMO-\d{6}-[A-Z0-9]{6,}/u },
  { name: 'literal preorder/booking/payment code', re: /\b(?:PO|BK|PAY)-\d{6}-[A-Z0-9]{6,}\b/ },
  { name: 'a currency amount with THB/USD suffix', re: /\d+(?:[.,]\d+)?\s*(?:THB|USD)\b/i },
];

/**
 * Extracts the canonical doctrine sections from THONGTHAI_BRAIN.md's raw
 * text. Throws if a required section is missing so a renamed/removed
 * heading fails loudly instead of silently compiling an empty doctrine.
 */
export function extractSections(markdown) {
  const sections = {};
  for (const [key, heading] of SECTION_ORDER) {
    const headingRe = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mu');
    const match = headingRe.exec(markdown);
    if (!match) throw new Error(`BIBLE_COMPILE_MISSING_SECTION:${heading}`);
    const start = match.index + match[0].length;
    const rest = markdown.slice(start);
    // Ends at the next '## ' heading or '---' divider, whichever comes first.
    const endMatch = /\n(?:## |---)/u.exec(rest);
    const body = (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
    if (!body) throw new Error(`BIBLE_COMPILE_EMPTY_SECTION:${heading}`);
    sections[key] = body;
  }
  return sections;
}

/** Flags any doctrine section that looks like it contains a mutable business fact. */
export function findMutableFactViolations(sections) {
  const violations = [];
  for (const [key, text] of Object.entries(sections)) {
    for (const { name, re } of MUTABLE_FACT_PATTERNS) {
      if (re.test(text)) violations.push(`${key}: matched pattern "${name}"`);
    }
  }
  return violations;
}

export function compileBible(markdown) {
  const sections = extractSections(markdown);
  const violations = findMutableFactViolations(sections);
  if (violations.length) {
    throw new Error(`BIBLE_COMPILE_MUTABLE_FACT_VIOLATION:\n${violations.join('\n')}`);
  }

  const fullText = SECTION_ORDER
    .map(([key, heading]) => `${heading.toUpperCase()}\n${sections[key]}`)
    .join('\n\n');

  const hash = createHash('sha256').update(fullText, 'utf8').digest('hex').slice(0, 16);
  const version = `bible-v1-${hash}`;

  return { sections, fullText, version, hash };
}

export function renderGeneratedModule(compiled) {
  const { sections, fullText, version, hash } = compiled;
  const sectionEntries = SECTION_ORDER
    .map(([key]) => `  ${key}: ${JSON.stringify(sections[key])},`)
    .join('\n');

  return `// GENERATED FILE -- do not hand-edit.
// Source: THONGTHAI_BRAIN.md, compiled by scripts/compile-thongthai-bible.mjs
// Regenerate with: node scripts/compile-thongthai-bible.mjs
// tests/bible-sync.test.ts fails the build if this drifts from the source.

export const THONGTHAI_BIBLE_VERSION = ${JSON.stringify(version)};
export const THONGTHAI_BIBLE_HASH = ${JSON.stringify(hash)};

export const THONGTHAI_BIBLE_SECTIONS = {
${sectionEntries}
} as const;

export const THONGTHAI_BIBLE_TEXT = ${JSON.stringify(fullText)};
`;
}
