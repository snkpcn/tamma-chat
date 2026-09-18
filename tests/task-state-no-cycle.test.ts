// Phase D/G.2: statically proves _task-state.ts's semantic/domain dependencies
// (_semantic-interpreter.ts, _promotion-dialog.ts, _restaurant-preorder-dialog.ts)
// do not import back from _task-state.ts, and that _task-state.ts stays
// decoupled from the heavy runtime/brain layer (_thongthai-runtime-v3.ts,
// _thongthai-brain-v3.ts) -- it is a plain state container, not a consumer
// of the model-calling machinery. Same static-import-graph technique as
// tests/model-provider-no-cycle.test.ts (Phase B.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function importsOf(relativePath: string): Promise<string[]> {
  const source = await readFile(new URL(`../netlify/functions/${relativePath}`, import.meta.url), 'utf8');
  const matches = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;]*|[\w$]+)\s*from\s*'([^']+)'/g)];
  return matches.map(match => match[1]!);
}

test('_semantic-interpreter.ts, _promotion-dialog.ts and _restaurant-preorder-dialog.ts do not import _task-state.ts (no cycle back into it)', async () => {
  for (const file of ['_semantic-interpreter.ts', '_promotion-dialog.ts', '_restaurant-preorder-dialog.ts']) {
    const imports = await importsOf(file);
    for (const specifier of imports) assert.doesNotMatch(specifier, /_task-state/, `${file} must not import _task-state.ts: ${specifier}`);
  }
});

test('_task-state.ts does not import the runtime/brain/model-provider layer -- it is a plain state container', async () => {
  const imports = await importsOf('_task-state.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /_thongthai-runtime|_thongthai-brain|_thongthai-model-provider/, `_task-state.ts must stay decoupled from the runtime/brain layer: ${specifier}`);
  }
});

test('_task-state.ts only imports from the expected leaf modules', async () => {
  const imports = await importsOf('_task-state.ts');
  const allowed = new Set(['./_semantic-interpreter', './_promotion-dialog', './_restaurant-preorder-dialog', './_guest-agent-state-store']);
  for (const specifier of imports) assert.ok(allowed.has(specifier), `unexpected import in _task-state.ts: ${specifier}`);
});
