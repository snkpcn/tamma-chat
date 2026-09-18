import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const OUTPUT_PATH = 'phase-p-diagnostic-result.json';
const ALLOWED_TOP_LEVEL_KEYS = new Set(['result', 'stage', 'totalElapsedMs', 'errorClass', 'attempts', 'calls']);
const ALLOWED_CALL_KEYS = new Set(['result', 'stage', 'totalElapsedMs', 'errorClass', 'attempts']);
const ALLOWED_ATTEMPT_KEYS = new Set(['provider', 'model', 'outcome', 'httpStatus', 'elapsedMs']);
const FORBIDDEN_SUBSTRINGS = ['AIza', 'sk-', 'Bearer', 'THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN', 'มากันสองคน'];

function assertAttempts(attempts: unknown) {
  if (!Array.isArray(attempts)) return;
  for (const attempt of attempts as Record<string, unknown>[]) {
    for (const key of Object.keys(attempt)) {
      assert.ok(ALLOWED_ATTEMPT_KEYS.has(key), `unexpected attempt key "${key}" in diagnostic artifact`);
    }
  }
}

test('the build-time diagnostic artifact contains only the strictly safe schema, never a prompt/output/credential', () => {
  if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);
  try {
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/phase-p-run-diagnostic.ts'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, `diagnostic script must never fail the build: stderr=${result.stderr}`);
    assert.ok(existsSync(OUTPUT_PATH), 'diagnostic script must always write the artifact');

    const raw = readFileSync(OUTPUT_PATH, 'utf8');
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      assert.ok(!raw.includes(forbidden), `artifact must never contain "${forbidden}" (a secret, token, prompt, or customer text)`);
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(parsed)) {
      assert.ok(ALLOWED_TOP_LEVEL_KEYS.has(key), `unexpected top-level key "${key}" in diagnostic artifact`);
    }
    assert.ok(typeof parsed.result === 'string');
    assert.ok(typeof parsed.totalElapsedMs === 'number');
    assertAttempts(parsed.attempts);

    if (Array.isArray(parsed.calls)) {
      for (const call of parsed.calls as Record<string, unknown>[]) {
        for (const key of Object.keys(call)) {
          assert.ok(ALLOWED_CALL_KEYS.has(key), `unexpected call key "${key}" in diagnostic artifact`);
        }
        assertAttempts(call.attempts);
      }
    }
  } finally {
    if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);
  }
});
