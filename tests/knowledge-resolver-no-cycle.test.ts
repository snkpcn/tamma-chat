// Phase E architecture guards, statically proven (same technique as
// tests/model-provider-no-cycle.test.ts and tests/task-state-no-cycle.test.ts):
//   - Semantic Interpreter does not import the resolver (layers stay
//     separated: Resolver consumes Semantic Interpreter's types, never the
//     reverse).
//   - The resolver does not import a Response Composer (doesn't exist yet;
//     guards against it being added prematurely) or the runtime/brain layer.
//   - The resolver executes ZERO transactional writes and makes ZERO direct
//     DB calls of its own -- proven by the literal absence of `fetch(`
//     anywhere in its source (all real I/O is injected).
//   - _task-state.ts (Phase D's core) remains domain-agnostic: it still does
//     not import the resolver or the new domain policy module.
//   - The ecosystem entity graph describes STRUCTURE only, never a specific
//     mutable resource instance/price (Bible is not used as mutable
//     inventory).
//   - No circular dependency across the new Phase E modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ECOSYSTEM_ENTITY_GRAPH, type EcosystemNode } from '../netlify/functions/_ecosystem-entity-graph';

async function sourceOf(relativePath: string): Promise<string> {
  return readFile(new URL(`../netlify/functions/${relativePath}`, import.meta.url), 'utf8');
}
async function importsOf(relativePath: string): Promise<string[]> {
  const source = await sourceOf(relativePath);
  const matches = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;]*|[\w$]+)\s*from\s*'([^']+)'/g)];
  return matches.map(match => match[1]!);
}

test('_semantic-interpreter.ts does not import the Knowledge Resolver', async () => {
  const imports = await importsOf('_semantic-interpreter.ts');
  for (const specifier of imports) assert.doesNotMatch(specifier, /_knowledge-resolver/, `semantic interpreter must not import the resolver: ${specifier}`);
});

test('_knowledge-resolver.ts does not import a Response Composer or the runtime/brain/model-provider layer', async () => {
  const imports = await importsOf('_knowledge-resolver.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /response-composer/i, `resolver must not import a response composer: ${specifier}`);
    assert.doesNotMatch(specifier, /_thongthai-runtime|_thongthai-brain|_thongthai-model-provider/, `resolver must stay decoupled from the runtime/brain layer: ${specifier}`);
  }
});

test('_knowledge-resolver.ts makes zero direct DB calls / transactional writes -- no bare global `fetch(` call anywhere in its code (comments aside; `route.fetch(request)` calling an INJECTED adapter is fine and expected)', async () => {
  const source = await sourceOf('_knowledge-resolver.ts');
  const codeOnly = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  // Negative lookbehind excludes `.fetch(` (a property/method call on an
  // injected adapter object, e.g. `route.fetch(request)`) and `dbFetch(`
  // (a different identifier) -- only a bare global `fetch(...)` call (a
  // real network request) would match.
  assert.doesNotMatch(codeOnly, /(?<![.\w])fetch\(/, 'the resolver must have no bare fetch() calls of its own -- all real I/O is injected via KnowledgeSourceAdapters');
});

test('_task-state.ts (Phase D core) still does not import the resolver or domain policy module -- it remains domain-agnostic', async () => {
  const imports = await importsOf('_task-state.ts');
  for (const specifier of imports) assert.doesNotMatch(specifier, /_knowledge-resolver|_domain-task-policy/, `_task-state.ts must not import Phase E modules: ${specifier}`);
});

test('_domain-task-policy.ts only imports the expected leaf modules (task-state types + the two real dialog modules), and nothing imports it back into a cycle', async () => {
  const imports = await importsOf('_domain-task-policy.ts');
  const allowed = new Set(['./_promotion-dialog', './_restaurant-preorder-dialog', './_task-state']);
  for (const specifier of imports) assert.ok(allowed.has(specifier), `unexpected import in _domain-task-policy.ts: ${specifier}`);
  for (const file of ['_promotion-dialog.ts', '_restaurant-preorder-dialog.ts', '_task-state.ts']) {
    const theirImports = await importsOf(file);
    for (const specifier of theirImports) assert.doesNotMatch(specifier, /_domain-task-policy/, `${file} must not import _domain-task-policy.ts back`);
  }
});

test('_knowledge-resolver.ts only imports the expected leaf modules', async () => {
  const imports = await importsOf('_knowledge-resolver.ts');
  const allowed = new Set(['./_semantic-interpreter', './_task-state']);
  for (const specifier of imports) assert.ok(allowed.has(specifier), `unexpected import in _knowledge-resolver.ts: ${specifier}`);
});

function collectResourceSlotLabels(node: EcosystemNode, out: string[] = []): string[] {
  if (node.type === 'resource_slot') out.push(node.label);
  for (const child of node.children ?? []) collectResourceSlotLabels(child, out);
  return out;
}

test('the ecosystem entity graph describes structure only -- no hardcoded specific horse/room/product name or price (Bible must not become mutable inventory)', () => {
  const labels = collectResourceSlotLabels(ECOSYSTEM_ENTITY_GRAPH);
  assert.ok(labels.length > 0, 'sanity: the graph must actually have resource_slot nodes to check');
  for (const label of labels) {
    assert.doesNotMatch(label, /ทองไทย|ภาราดร/, `resource_slot label must not hardcode a specific named instance: "${label}"`);
    assert.doesNotMatch(label, /\d+\s*(บาท|บาทถ้วน|THB)/i, `resource_slot label must not hardcode a price: "${label}"`);
    assert.match(label, /live/i, `resource_slot label must point to a live source, not a static fact: "${label}"`);
  }
});
