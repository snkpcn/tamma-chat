// Phase F architecture guards, statically proven (same technique as every
// earlier phase's no-cycle test):
//   - Semantic Interpreter, Task core, and Knowledge Resolver do NOT import
//     the Dialog Manager (it depends on them, never the reverse).
//   - The Dialog Manager imports only what it's allowed to: Semantic
//     contracts, Task-state functions, the domain policy, and Knowledge
//     contracts -- never a Response Composer (doesn't exist yet), a raw
//     database client, the LINE webhook, the web frontend, or payment
//     transport code.
//   - No circular dependency across any of Phase F's new modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function sourceOf(relativePath: string): Promise<string> {
  return readFile(new URL(`../netlify/functions/${relativePath}`, import.meta.url), 'utf8');
}
async function importsOf(relativePath: string): Promise<string[]> {
  const source = await sourceOf(relativePath);
  const matches = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;]*|[\w$]+)\s*from\s*'([^']+)'/g)];
  return matches.map(match => match[1]!);
}

test('_semantic-interpreter.ts, _task-state.ts and _knowledge-resolver.ts do not import the Dialog Manager', async () => {
  for (const file of ['_semantic-interpreter.ts', '_task-state.ts', '_knowledge-resolver.ts']) {
    const imports = await importsOf(file);
    for (const specifier of imports) assert.doesNotMatch(specifier, /_dialog-manager/, `${file} must not import the Dialog Manager: ${specifier}`);
  }
});

test('_dialog-manager.ts imports no Response Composer, raw DB client, LINE webhook, web frontend, or payment transport code', async () => {
  const imports = await importsOf('_dialog-manager.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /response-composer/i, `Dialog Manager must not import a response composer: ${specifier}`);
    assert.doesNotMatch(specifier, /line-webhook|_line-webhook-core/, `Dialog Manager must not import the LINE webhook: ${specifier}`);
    assert.doesNotMatch(specifier, /_payments|_settlements/, `Dialog Manager must not import payment transport code: ${specifier}`);
    assert.doesNotMatch(specifier, /_thongthai-runtime|_thongthai-brain|_thongthai-model-provider|_operations-db|_restaurant-sot|_promotions-runtime|_activity-sot|_customer-db/, `Dialog Manager must not import a raw database client / runtime module directly: ${specifier}`);
  }
});

test('_dialog-manager.ts makes zero direct DB calls -- no bare global `fetch(` call anywhere in its code', async () => {
  const source = await sourceOf('_dialog-manager.ts');
  const codeOnly = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(codeOnly, /(?<![.\w])fetch\(/, 'Dialog Manager must have no bare fetch() calls of its own -- all real I/O flows through _knowledge-resolver.ts\'s injected adapters');
});

test('_dialog-manager.ts only imports the expected leaf modules', async () => {
  const imports = await importsOf('_dialog-manager.ts');
  const allowed = new Set(['./_semantic-interpreter', './_conversation-context', './_task-state', './_domain-task-policy', './_knowledge-resolver', './_activity-catalog-policy']);
  for (const specifier of imports) assert.ok(allowed.has(specifier), `unexpected import in _dialog-manager.ts: ${specifier}`);
});

test('_dialog-source-adapters.ts (real adapters) does not import the Dialog Manager, and nothing it wraps imports it back', async () => {
  const imports = await importsOf('_dialog-source-adapters.ts');
  for (const specifier of imports) assert.doesNotMatch(specifier, /_dialog-manager/, `real adapters module must not import the Dialog Manager: ${specifier}`);
  for (const file of ['_restaurant-sot.ts', '_activity-sot.ts', '_promotions-runtime.ts', '_operations-db.ts']) {
    const theirImports = await importsOf(file);
    for (const specifier of theirImports) assert.doesNotMatch(specifier, /_dialog-manager|_dialog-source-adapters/, `${file} must not import Phase F modules back`);
  }
});

test('no circular dependency: _knowledge-resolver.ts, _task-state.ts, _domain-task-policy.ts, _semantic-interpreter.ts do not import _dialog-manager.ts even indirectly through each other', async () => {
  const filesToCheck = ['_knowledge-resolver.ts', '_task-state.ts', '_domain-task-policy.ts', '_semantic-interpreter.ts', '_ecosystem-entity-graph.ts', '_conversation-context.ts'];
  for (const file of filesToCheck) {
    const imports = await importsOf(file);
    for (const specifier of imports) assert.doesNotMatch(specifier, /_dialog-manager|_dialog-source-adapters/, `${file} must not import Phase F's orchestration layer: ${specifier}`);
  }
});
