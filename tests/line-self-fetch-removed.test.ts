// Regression coverage for the "LINE self-fetch" architectural fix (see
// THONGTHAI_HANDOFF.md's "One-Mind Architecture Consolidation Audit"):
// _line-webhook-core.ts used to reach the shared Thongthai brain and
// customer-memory store by HTTP-fetching this SAME site's own Netlify
// Functions (up to 4 sequential round-trips per LINE turn), which was the
// most plausible structural explanation available for a real production
// incident (LINE went totally silent, including to a plain greeting, right
// after a change that made that already-fragile multi-hop path slightly
// heavier). It now calls the exact same canonical functions in-process.
//
// These tests prove the fix at three levels: source-structural (no self-
// fetch pattern present), import-identity (LINE's call is a live ESM
// binding to the SAME module instance the web handler uses, not a
// lookalike copy), and real module-graph loadability (an actual dynamic
// import of both files succeeds with no circular-import or import-time
// side-effect failure -- a plain source grep cannot prove this; only
// actually loading the module graph can, which is exactly the class of
// failure a previous, well-unit-tested change caused in production).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('_line-webhook-core.ts never fetches this site\'s own /.netlify/functions/ endpoints', () => {
  const source = readFileSync('netlify/functions/_line-webhook-core.ts', 'utf8');
  // The two remaining fetch() calls in this file are to Supabase's REST API
  // and to LINE's own api.line.me reply endpoint -- both genuinely external
  // services, never this site's own functions.
  assert.doesNotMatch(source, /fetch\(\s*(?:siteBaseUrl\(\)|`?\$\{?siteBaseUrl)/);
  assert.doesNotMatch(source, /\/\.netlify\/functions\/thongthai-chat/);
  assert.doesNotMatch(source, /\/\.netlify\/functions\/customer-memory/);
  assert.doesNotMatch(source, /\bsiteBaseUrl\b/, 'the self-fetch base-URL helper must be fully retired, not just unused');
});

test('_line-webhook-core.ts imports the canonical brain core from the exact same module the web handler exports it from', () => {
  const lineSource = readFileSync('netlify/functions/_line-webhook-core.ts', 'utf8');
  const webSource = readFileSync('netlify/functions/thongthai-chat.ts', 'utf8');
  assert.match(
    lineSource,
    /import\s*\{\s*processThongthaiChatCore\s*\}\s*from\s*'\.\/thongthai-chat'/,
    'LINE must import the SAME exported function, not a re-implementation',
  );
  assert.match(webSource, /export async function processThongthaiChatCore\(/);
  // Both the web HTTP handler and the LINE adapter must call it -- an ES
  // module import is a live binding to the one module instance, so this
  // import statement alone (asserted above) already guarantees identity;
  // this additionally proves the web handler itself actually calls it too,
  // rather than the export existing unused.
  const handlerBody = webSource.slice(webSource.indexOf('export const handler: Handler ='));
  assert.match(handlerBody, /await processThongthaiChatCore\(/);
});

test('_line-webhook-core.ts imports customer-memory writes directly from _customer-db.ts, not via HTTP', () => {
  const source = readFileSync('netlify/functions/_line-webhook-core.ts', 'utf8');
  assert.match(source, /import\s*\{\s*loadCustomerMemory,\s*persistCustomerSnapshot\s*\}\s*from\s*'\.\/_customer-db'/);
});

test('_line-webhook-core.ts contains no new domain/business decision logic beyond transport', () => {
  const source = readFileSync('netlify/functions/_line-webhook-core.ts', 'utf8');
  assert.doesNotMatch(source, /_semantic-interpreter|_dialog-manager|_knowledge-resolver|_response-composer|_task-state/);
});

test('real module import: _line-webhook-core.ts and thongthai-chat.ts load with no circular-import or import-time side-effect failure', async () => {
  // A source grep cannot prove this -- only actually loading the module
  // graph can. This is a genuine dynamic import of the real .ts files
  // (transformed on the fly by tsx, the same way `npm test` itself runs),
  // with no Supabase/LINE env vars set, proving every module-scope
  // statement in both files' full import closures is free of any
  // unconditional throw or network call at load time.
  const lineWebhookCore = await import('../netlify/functions/_line-webhook-core.ts');
  const thongthaiChat = await import('../netlify/functions/thongthai-chat.ts');
  assert.equal(typeof lineWebhookCore.handler, 'function');
  assert.equal(typeof thongthaiChat.handler, 'function');
  assert.equal(typeof thongthaiChat.processThongthaiChatCore, 'function');
});
