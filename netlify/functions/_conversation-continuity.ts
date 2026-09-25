// Phase 2 closeout — persisted semantic follow-up contract.
//
// LINE deliberately transports no chat history. A question Thongthai asks on
// one webhook therefore needs a small server-side continuation contract if a
// short answer on the next webhook is expected to make sense.
//
// This module is intentionally domain-agnostic. It knows how to resolve a
// bounded choice or numeric party-size answer from the state that THE
// QUESTION PRODUCER persisted. It does not know restaurant, horse, cafe, ATV,
// or any particular Thai sentence; domain handlers decide what a canonical
// resolution means after this layer returns it.

export type PendingQuestionKind =
  | 'preference_choice'
  | 'entity_choice'
  | 'party_size';

export type PendingQuestionChoice = {
  value: string;
  aliases: string[];
};

export type PendingQuestionState = {
  domain: string;
  kind: PendingQuestionKind;
  choices?: PendingQuestionChoice[];
  slot?: string;
};

export type PendingQuestionResolution = {
  domain: string;
  kind: PendingQuestionKind;
  slot: string | null;
  value: string | number;
};

const MAX_CHOICES = 8;
const MAX_ALIASES_PER_CHOICE = 12;

function shortString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeDigits(text: string): string {
  const thai = '๐๑๒๓๔๕๖๗๘๙';
  return [...text].map(char => {
    const index = thai.indexOf(char);
    return index >= 0 ? String(index) : char;
  }).join('');
}

export function normalizePendingAnswerText(value: string): string {
  return normalizeDigits(String(value ?? ''))
    .toLocaleLowerCase('th-TH')
    .replace(/[?？!！.,，。:;()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePendingQuestion(value: unknown): PendingQuestionState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const domain = shortString(raw.domain, 80);
  const kind = shortString(raw.kind, 40) as PendingQuestionKind | null;
  if (!domain || !kind || !['preference_choice', 'entity_choice', 'party_size'].includes(kind)) return null;

  const slot = shortString(raw.slot, 80) ?? undefined;
  if (kind === 'party_size') return { domain, kind, ...(slot ? { slot } : {}) };

  if (!Array.isArray(raw.choices)) return null;
  const choices: PendingQuestionChoice[] = [];
  for (const item of raw.choices.slice(0, MAX_CHOICES)) {
    if (!item || typeof item !== 'object') continue;
    const choice = item as Record<string, unknown>;
    const choiceValue = shortString(choice.value, 80);
    if (!choiceValue || !Array.isArray(choice.aliases)) continue;
    const aliases = choice.aliases
      .map(alias => shortString(alias, 80))
      .filter((alias): alias is string => Boolean(alias))
      .map(normalizePendingAnswerText)
      .filter(Boolean)
      .slice(0, MAX_ALIASES_PER_CHOICE);
    if (!aliases.length) continue;
    choices.push({ value: choiceValue, aliases: [...new Set(aliases)] });
  }
  if (!choices.length) return null;
  return { domain, kind, choices, ...(slot ? { slot } : {}) };
}

function resolveChoice(message: string, pending: PendingQuestionState): string | null {
  const text = normalizePendingAnswerText(message);
  if (!text) return null;

  const matched = (pending.choices ?? []).filter(choice =>
    choice.aliases.some(alias => {
      const normalizedAlias = normalizePendingAnswerText(alias);
      if (!normalizedAlias) return false;
      return text === normalizedAlias || text.includes(normalizedAlias);
    }),
  );

  // An answer that names more than one offered branch is a new question or
  // still ambiguous; do not guess which branch the customer meant.
  if (matched.length !== 1) return null;
  return matched[0].value;
}

function resolvePartySize(message: string): number | null {
  const text = normalizePendingAnswerText(message);
  const match = text.match(/(?:^|\s)(\d{1,2})(?:\s*(?:คน|ท่าน))?(?:\s|$)/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : null;
}

export function resolvePendingQuestionAnswer(
  message: string,
  rawPendingQuestion: unknown,
): PendingQuestionResolution | null {
  const pending = normalizePendingQuestion(rawPendingQuestion);
  if (!pending) return null;

  if (pending.kind === 'party_size') {
    const value = resolvePartySize(message);
    if (value === null) return null;
    return { domain: pending.domain, kind: pending.kind, slot: pending.slot ?? null, value };
  }

  const value = resolveChoice(message, pending);
  if (value === null) return null;
  return { domain: pending.domain, kind: pending.kind, slot: pending.slot ?? null, value };
}
