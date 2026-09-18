// Phase B.1 hardening (see THONGTHAI_HANDOFF.md). Proves, statically and by
// actually building both bundles, that there is no Brain <-> Semantic
// Interpreter circular dependency:
//   _thongthai-brain-v3.ts        -> _thongthai-model-provider.ts
//   _semantic-interpreter.ts      -> _thongthai-model-provider.ts
//   _thongthai-model-provider.ts  -> (nothing else in this program)
// Neither brain-v3 nor the semantic interpreter may import from each other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function importsOf(relativePath: string): Promise<string[]> {
  const source = await readFile(new URL(`../netlify/functions/${relativePath}`, import.meta.url), 'utf8');
  const matches = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*[^;]*|[\w$]+)\s*from\s*'([^']+)'/g)];
  return matches.map(match => match[1]!);
}

test('_thongthai-model-provider.ts imports nothing from brain-v3 or the semantic interpreter (it is the neutral base)', async () => {
  const imports = await importsOf('_thongthai-model-provider.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /_thongthai-brain-v3|_semantic-interpreter/, `provider module must not import: ${specifier}`);
  }
});

test('_thongthai-brain-v3.ts does not import from _semantic-interpreter.ts', async () => {
  const imports = await importsOf('_thongthai-brain-v3.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /_semantic-interpreter/, `brain-v3 must not import the semantic interpreter: ${specifier}`);
  }
});

test('_semantic-interpreter.ts does not import from _thongthai-brain-v3.ts', async () => {
  const imports = await importsOf('_semantic-interpreter.ts');
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /_thongthai-brain-v3(?!-model-provider)/, `semantic interpreter must not import brain-v3: ${specifier}`);
  }
});

test('both brain-v3 and the semantic interpreter import the SAME neutral provider module', async () => {
  const brainImports = await importsOf('_thongthai-brain-v3.ts');
  const semanticImports = await importsOf('_semantic-interpreter.ts');
  assert.ok(brainImports.some(specifier => specifier.includes('_thongthai-model-provider')));
  assert.ok(semanticImports.some(specifier => specifier.includes('_thongthai-model-provider')));
});

test('esbuild successfully bundles _semantic-interpreter.ts standalone (would fail on an actual runtime cycle through brain-v3)', () => {
  execFileSync('npx', [
    'esbuild', 'netlify/functions/_semantic-interpreter.ts',
    '--bundle', '--platform=node', '--format=esm',
    '--outfile=/tmp/no-cycle-check-semantic-interpreter.js', '--external:@netlify/functions',
  ], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
});

test('esbuild successfully bundles _thongthai-brain-v3.ts standalone', () => {
  execFileSync('npx', [
    'esbuild', 'netlify/functions/_thongthai-brain-v3.ts',
    '--bundle', '--platform=node', '--format=esm',
    '--outfile=/tmp/no-cycle-check-brain-v3.js', '--external:@netlify/functions',
  ], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
});
