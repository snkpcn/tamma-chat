// Guards against the Bible drifting into two independently-maintained
// copies again: one committed generated artifact
// (_thongthai-bible-generated.ts) compiled from THONGTHAI_BRAIN.md, and
// _thongthai-brain-v3.ts must actually interpolate it into the live prompt
// rather than re-typing its own paraphrase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileBible, findMutableFactViolations } from '../scripts/_bible-compiler.mjs';
import {
  THONGTHAI_BIBLE_SECTIONS,
  THONGTHAI_BIBLE_TEXT,
  THONGTHAI_BIBLE_VERSION,
  THONGTHAI_BIBLE_HASH,
} from '../netlify/functions/_thongthai-bible-generated';

test('the generated Bible module exactly matches a fresh compile of THONGTHAI_BRAIN.md (no drift)', async () => {
  const markdown = await readFile(new URL('../THONGTHAI_BRAIN.md', import.meta.url), 'utf8');
  const fresh = compileBible(markdown);
  assert.equal(fresh.version, THONGTHAI_BIBLE_VERSION, 'run `node scripts/compile-thongthai-bible.mjs` -- the committed generated file is stale');
  assert.equal(fresh.hash, THONGTHAI_BIBLE_HASH);
  assert.equal(fresh.fullText, THONGTHAI_BIBLE_TEXT);
  for (const key of Object.keys(fresh.sections)) {
    assert.equal(fresh.sections[key], (THONGTHAI_BIBLE_SECTIONS as Record<string, string>)[key], `section drifted: ${key}`);
  }
});

test('all ten doctrine sections are present and non-empty', () => {
  const required = [
    'identity', 'personality', 'conversationDoctrine', 'ecosystemVocabulary',
    'customerServiceDoctrine', 'recommendationDoctrine', 'operationalTruthDoctrine',
    'memoryPrivacyDoctrine', 'failureDoctrine', 'channelPresentationDoctrine',
  ];
  for (const key of required) {
    const value = (THONGTHAI_BIBLE_SECTIONS as Record<string, string>)[key];
    assert.ok(typeof value === 'string' && value.length > 40, `missing/too-short section: ${key}`);
  }
});

test('no doctrine section contains a mutable business fact (price/stock/promo code)', () => {
  const violations = findMutableFactViolations(THONGTHAI_BIBLE_SECTIONS as unknown as Record<string, string>);
  assert.deepEqual(violations, []);
});

test('the runtime brain prompt actually contains the canonical Bible text, not a re-typed paraphrase', async () => {
  const brainSource = await readFile(new URL('../netlify/functions/_thongthai-brain-v3.ts', import.meta.url), 'utf8');
  // buildBrainPrompt must reference the generated Bible sections by name --
  // this is a static guard that the live prompt template actually
  // interpolates THONGTHAI_BIBLE_SECTIONS.* rather than hand-typed text.
  for (const key of Object.keys(THONGTHAI_BIBLE_SECTIONS)) {
    assert.match(brainSource, new RegExp(`THONGTHAI_BIBLE_SECTIONS\\.${key}\\b`), `buildBrainPrompt does not interpolate Bible section: ${key}`);
  }
  assert.match(brainSource, /THONGTHAI_BIBLE_VERSION/, 'buildBrainPrompt does not surface the Bible version');
});

test('Bible version is a stable content hash, not a hand-bumped string (changes iff doctrine text changes)', () => {
  assert.match(THONGTHAI_BIBLE_VERSION, /^bible-v1-[0-9a-f]{16}$/);
  assert.equal(THONGTHAI_BIBLE_VERSION, `bible-v1-${THONGTHAI_BIBLE_HASH}`);
});

test('Bible version is persisted into guest_agent_state diagnostics alongside the brain version', async () => {
  const runtimeSource = await readFile(new URL('../netlify/functions/_thongthai-runtime-v3.ts', import.meta.url), 'utf8');
  assert.match(runtimeSource, /updated_by_bible_version\s*:\s*THONGTHAI_BIBLE_VERSION/);
  assert.match(runtimeSource, /updated_by_brain_version\s*:\s*THONGTHAI_BRAIN_VERSION/, 'brain version should also be sourced from the constant, not a stale hardcoded string');
});
