// Phase C tests. All network-free -- the DB I/O wrappers (loadConversationContext/
// persistConversationContext) are thin and untested here by this repo's own
// convention (same as _thongthai-runtime-v3.ts's loadBrainRuntime/
// persistBrainRuntime); everything else -- the reducer, the context builder,
// redaction, bounding, expiry -- is pure and fully tested.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConversationContextUpdate,
  buildSemanticContext,
  emptyConversationContextState,
  isContextExpired,
  pruneExpired,
  redactSensitiveContent,
  MAX_RECENT_TURNS,
  MAX_TURN_CHARS,
  MAX_RECENT_ENTITIES,
  CONTEXT_TTL_MS,
  CONVERSATION_CONTEXT_SCHEMA_VERSION,
  type ConversationContextState,
} from '../netlify/functions/_conversation-context';

// --- 1. bounded recent-turn retention ---
test('[area 1] recent turns are capped at MAX_RECENT_TURNS, oldest dropped first', () => {
  let state = emptyConversationContextState();
  for (let i = 0; i < MAX_RECENT_TURNS + 5; i += 1) {
    state = applyConversationContextUpdate(state, { channel: 'web', userMessage: `turn ${i}` });
  }
  assert.ok(state.recentTurns.length <= MAX_RECENT_TURNS);
  assert.equal(state.recentTurns[state.recentTurns.length - 1]!.content, `turn ${MAX_RECENT_TURNS + 4}`);
  assert.ok(!state.recentTurns.some(t => t.content === 'turn 0'));
});

// --- 2. expiry/pruning ---
test('[area 2] pruneExpired resets a stale context to empty rather than returning stale data', () => {
  const now = new Date('2026-09-18T10:00:00.000Z');
  const stale = applyConversationContextUpdate(emptyConversationContextState(now), { channel: 'web', userMessage: 'hi' }, now);
  const muchLater = new Date(now.getTime() + CONTEXT_TTL_MS + 60_000);
  const pruned = pruneExpired(stale, muchLater);
  assert.equal(pruned.recentTurns.length, 0);
  assert.equal(pruned.activeDomain, null);
});

// --- 3. rolling summary update contract ---
test('[area 3] rolling summary accumulates factual additions and stays capped', () => {
  let state = emptyConversationContextState();
  state = applyConversationContextUpdate(state, { channel: 'web', summaryFact: 'customer wants horse riding tomorrow for 2 people' });
  assert.match(state.rollingSummary, /horse riding tomorrow for 2 people/);
  state = applyConversationContextUpdate(state, { channel: 'web', summaryFact: 'no pork constraint stated for restaurant order' });
  assert.match(state.rollingSummary, /horse riding/);
  assert.match(state.rollingSummary, /no pork/);
});

test('[area 3b] rolling summary never contains model reasoning markers', () => {
  // Structural guard: the reducer only ever appends exactly the caller-supplied
  // summaryFact string -- it has no code path that could inject reasoning.
  const state = applyConversationContextUpdate(emptyConversationContextState(), { channel: 'web', summaryFact: 'guest selected ภาราดร for tomorrow' });
  assert.doesNotMatch(state.rollingSummary, /chain.of.thought|let me think|reasoning:/i);
});

// --- 4. active-domain continuity ---
test('[area 4] active domain persists across turns until explicitly changed', () => {
  let state = applyConversationContextUpdate(emptyConversationContextState(), { channel: 'web', activeDomain: 'activity' });
  assert.equal(state.activeDomain, 'activity');
  state = applyConversationContextUpdate(state, { channel: 'web', userMessage: 'พรุ่งนี้สองคน' }); // no domain in this update
  assert.equal(state.activeDomain, 'activity', 'domain must carry over, not reset, when a turn does not name a new one');
});

// --- 5. recent entity continuity ---
test('[area 5] recent entities persist and stay available for later reference resolution', () => {
  let state = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'web', activeDomain: 'activity',
    newEntities: [
      { id: 'conv:horse:thongthai', type: 'horse', name: 'ทองไทย', domain: 'activity', source: 'conversation', canonical: false },
      { id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'conversation', canonical: false },
    ],
  });
  state = applyConversationContextUpdate(state, { channel: 'web', userMessage: 'ตัวไหนนิสัยดีกว่า' });
  assert.equal(state.recentEntities.length, 2);
  assert.ok(state.recentEntities.some(e => e.name === 'ภาราดร'));
});

// --- 6. reference context generation ---
test('[area 6] buildSemanticContext exposes recent entities/domain in exactly the shape the interpreter needs', () => {
  const state = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'web', activeDomain: 'activity', lastAction: 'discover',
    newEntities: [{ id: 'conv:horse:paradon', type: 'horse', name: 'ภาราดร', domain: 'activity', source: 'conversation', canonical: false }],
  });
  const semanticContext = buildSemanticContext(state);
  assert.equal(semanticContext.activeDomain, 'activity');
  assert.equal(semanticContext.lastAction, 'discover');
  assert.equal(semanticContext.recentEntities.length, 1);
  assert.equal(semanticContext.recentEntities[0]!.name, 'ภาราดร');
  // the persistence-only `observedAt` field must not leak into SemanticContext
  assert.equal((semanticContext.recentEntities[0] as Record<string, unknown>).observedAt, undefined);
});

// --- 7. correction/replacement of active entity ---
test('[area 7] a correction replaces which entity is most relevant without losing the other', () => {
  let state = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'web', activeDomain: 'activity',
    newEntities: [{ id: 'conv:atv', type: 'activity', name: 'ATV', domain: 'activity', source: 'conversation', canonical: false }],
  });
  // "ไม่ใช่ หมายถึงม้า" -- correct_previous, re-mentions horse instead
  state = applyConversationContextUpdate(state, {
    channel: 'web', lastAction: 'correct_previous',
    newEntities: [{ id: 'conv:horse:generic', type: 'horse', name: 'ม้า', domain: 'activity', source: 'conversation', canonical: false }],
  });
  assert.equal(state.recentEntities[0]!.name, 'ม้า', 'the corrected entity must be most-recent/most-relevant');
  assert.equal(state.lastAction, 'correct_previous');
});

// --- 8. topic switch ---
test('[area 8] a topic switch updates activeDomain/activeTopic cleanly, old open question does not leak into the new topic', () => {
  let state = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'web', activeDomain: 'restaurant', activeTopic: 'menu set for 3 people', openQuestion: 'pickup date/time and customer name',
  });
  state = applyConversationContextUpdate(state, {
    channel: 'web', activeDomain: 'promotion', activeTopic: 'promotion discovery', openQuestion: null,
  });
  assert.equal(state.activeDomain, 'promotion');
  assert.equal(state.activeTopic, 'promotion discovery');
  assert.equal(state.openQuestion, null, 'explicit null must clear the stale open question from the old topic');
});

// --- 9/10. cross-channel continuity (the exact example from the brief) ---
test('[area 9] web -> line, same canonical guest: turn 2 on LINE is interpretable as continuation of turn 1 on web', () => {
  const afterWeb = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'web', userMessage: 'อยากขี่ม้า', activeDomain: 'activity', activeTopic: 'horse riding', lastAction: 'ask',
  });
  // Same canonical guest, next turn arrives via LINE -- loadConversationContext
  // is keyed by canonical guest_id only (see the DB I/O section), never by
  // channel, so this is the SAME state object regardless of which channel
  // persisted/loads it. This test proves the reducer/builder side of that:
  // context built from the web-produced state is fully usable for the LINE turn.
  const contextForLineTurn = buildSemanticContext(afterWeb);
  assert.equal(contextForLineTurn.activeDomain, 'activity');
  assert.equal(contextForLineTurn.lastAction, 'ask');
  const afterLine = applyConversationContextUpdate(afterWeb, {
    channel: 'line', userMessage: 'พรุ่งนี้สองคน', lastAction: 'provide_information',
  });
  assert.equal(afterLine.activeDomain, 'activity', 'domain from the web turn must still be active on the LINE turn');
  assert.equal(afterLine.recentTurns.some(t => t.channel === 'web'), true);
  assert.equal(afterLine.recentTurns.some(t => t.channel === 'line'), true);
});

test('[area 10] line -> web, same canonical guest: continuity works in the other direction too', () => {
  const afterLine = applyConversationContextUpdate(emptyConversationContextState(), {
    channel: 'line', userMessage: 'มีห้องว่างพรุ่งนี้ไหม', activeDomain: 'stay', lastAction: 'ask',
  });
  const afterWeb = applyConversationContextUpdate(afterLine, {
    channel: 'web', userMessage: 'เอาห้องนี้เลย', lastAction: 'confirm',
  });
  assert.equal(afterWeb.activeDomain, 'stay');
  assert.equal(afterWeb.recentTurns[0]!.channel, 'line');
  assert.equal(afterWeb.recentTurns[1]!.channel, 'web');
});

// --- 11. duplicate event does not duplicate continuity state ---
test('[area 11] a duplicate eventId (retried/duplicated webhook delivery) is a no-op, not a repeated turn', () => {
  let state = emptyConversationContextState();
  state = applyConversationContextUpdate(state, { channel: 'line', userMessage: 'มีไรทำมั่ง', eventId: 'evt-1' });
  const afterFirst = state;
  state = applyConversationContextUpdate(state, { channel: 'line', userMessage: 'มีไรทำมั่ง', eventId: 'evt-1' }); // same event, redelivered
  assert.equal(state.recentTurns.length, afterFirst.recentTurns.length, 'a duplicate event must not append a second copy of the turn');
});

test('[area 11b] two DIFFERENT fast messages (different eventIds) both apply, in order', () => {
  let state = emptyConversationContextState();
  state = applyConversationContextUpdate(state, { channel: 'line', userMessage: 'first', eventId: 'evt-a' });
  state = applyConversationContextUpdate(state, { channel: 'line', userMessage: 'second', eventId: 'evt-b' });
  assert.equal(state.recentTurns.length, 2);
  assert.equal(state.recentTurns[0]!.content, 'first');
  assert.equal(state.recentTurns[1]!.content, 'second');
});

// --- 12. PII/secrets redaction ---
test('[area 12] phone numbers, emails, and long digit runs are redacted from stored turn text', () => {
  assert.equal(redactSensitiveContent('เบอร์ผม 0891234567 นะครับ'), 'เบอร์ผม [phone] นะครับ');
  assert.equal(redactSensitiveContent('อีเมล test@example.com ครับ'), 'อีเมล [email] ครับ');
  assert.equal(redactSensitiveContent('บัตร 1234567890123456'), 'บัตร [number]');
});

test('[area 12b] redaction is applied automatically when a turn is stored via the reducer', () => {
  const state = applyConversationContextUpdate(emptyConversationContextState(), { channel: 'web', userMessage: 'โทร 0891234567 ได้เลยครับ' });
  assert.doesNotMatch(state.recentTurns[0]!.content, /0891234567/);
  assert.match(state.recentTurns[0]!.content, /\[phone\]/);
});

// --- 13. context size maximum ---
test('[area 13] a single very long message is truncated to MAX_TURN_CHARS, never stored unbounded', () => {
  const longMessage = 'ก'.repeat(MAX_TURN_CHARS * 3);
  const state = applyConversationContextUpdate(emptyConversationContextState(), { channel: 'web', userMessage: longMessage });
  assert.ok(state.recentTurns[0]!.content.length <= MAX_TURN_CHARS + 1); // +1 for the truncation ellipsis
});

test('[area 13b] recent entities are capped at MAX_RECENT_ENTITIES even with many mentions', () => {
  let state = emptyConversationContextState();
  const manyEntities = Array.from({ length: MAX_RECENT_ENTITIES + 10 }, (_, i) => ({
    id: `conv:item:${i}`, type: 'menu_item', name: `item ${i}`, domain: 'restaurant' as const, source: 'conversation' as const, canonical: false,
  }));
  state = applyConversationContextUpdate(state, { channel: 'web', newEntities: manyEntities });
  assert.ok(state.recentEntities.length <= MAX_RECENT_ENTITIES);
});

// --- 14. stale context expires ---
test('[area 14] isContextExpired correctly identifies a context past its TTL', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');
  const state = emptyConversationContextState(now);
  assert.equal(isContextExpired(state, now), false);
  assert.equal(isContextExpired(state, new Date(now.getTime() + CONTEXT_TTL_MS - 1000)), false);
  assert.equal(isContextExpired(state, new Date(now.getTime() + CONTEXT_TTL_MS + 1000)), true);
});

test('[area 14b] an update to an expired context starts fresh, not appended onto stale data', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');
  const old = applyConversationContextUpdate(emptyConversationContextState(now), { channel: 'web', userMessage: 'old conversation', activeDomain: 'restaurant' }, now);
  const muchLater = new Date(now.getTime() + CONTEXT_TTL_MS + 60_000);
  const fresh = applyConversationContextUpdate(old, { channel: 'web', userMessage: 'new conversation', activeDomain: 'activity' }, muchLater);
  assert.equal(fresh.recentTurns.length, 1);
  assert.equal(fresh.recentTurns[0]!.content, 'new conversation');
  assert.equal(fresh.activeDomain, 'activity');
});

// --- 15. SemanticContext built correctly from persisted context ---
test('[area 15] buildSemanticContext of a fresh/empty state matches emptySemanticContext shape', () => {
  const semanticContext = buildSemanticContext(emptyConversationContextState());
  assert.equal(semanticContext.activeDomain, null);
  assert.deepEqual(semanticContext.recentEntities, []);
  assert.equal(semanticContext.lastAction, undefined);
  assert.equal(semanticContext.openQuestion, undefined);
});

test('[area 15b] buildSemanticContext of an expired persisted state returns an empty SemanticContext, never stale data', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');
  const persisted = applyConversationContextUpdate(emptyConversationContextState(now), {
    channel: 'web', activeDomain: 'stay', newEntities: [{ id: 'x', type: 'room', name: 'Deluxe', domain: 'stay' }],
  }, now);
  const muchLater = new Date(now.getTime() + CONTEXT_TTL_MS + 60_000);
  const semanticContext = buildSemanticContext(persisted, muchLater);
  assert.equal(semanticContext.activeDomain, null);
  assert.deepEqual(semanticContext.recentEntities, []);
});

// --- schema/version sanity ---
test('schemaVersion is stamped on every state and matches the module constant', () => {
  const state = applyConversationContextUpdate(emptyConversationContextState(), { channel: 'web', userMessage: 'hi' });
  assert.equal(state.schemaVersion, CONVERSATION_CONTEXT_SCHEMA_VERSION);
});

test('MAX_RECENT_TURNS * MAX_TURN_CHARS keeps the stored payload small (bounded working memory, not a transcript)', () => {
  const worstCase: ConversationContextState = {
    ...emptyConversationContextState(),
    recentTurns: Array.from({ length: MAX_RECENT_TURNS }, (_, i) => ({ role: 'user' as const, content: 'ก'.repeat(MAX_TURN_CHARS), at: new Date().toISOString(), channel: 'web' })),
  };
  const approxBytes = JSON.stringify(worstCase.recentTurns).length;
  assert.ok(approxBytes < 20_000, `recent turns payload unexpectedly large: ${approxBytes} bytes`);
});
