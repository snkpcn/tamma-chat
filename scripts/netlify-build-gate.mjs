import { spawnSync } from 'node:child_process';

const NODE = process.execPath;
const steps = [
  ['apply-isan-boutique-phase1', NODE, ['scripts/apply-isan-boutique-phase1.mjs']],
  ['public-i18n-build-gate', NODE, ['scripts/public-i18n-build-gate.mjs']],
  ['apply-chat-polish', NODE, ['scripts/apply-chat-polish.mjs']],
  ['apply-restaurant-constraint-copy', NODE, ['scripts/apply-restaurant-constraint-copy.mjs']],
  ['phase-o-build-gate', NODE, ['scripts/phase-o-build-gate.mjs']],
  ['audit-preww', 'npm', ['run', 'audit:preww']],
  ['audit-ww0', 'npm', ['run', 'audit:ww0']],
  ['audit-ww1', 'npm', ['run', 'audit:ww1']],
  ['audit-ww2', 'npm', ['run', 'audit:ww2']],
  ['audit-ww3', 'npm', ['run', 'audit:ww3']],
  ['audit-ww4', 'npm', ['run', 'audit:ww4']],
  ['audit-ww5', 'npm', ['run', 'audit:ww5']],
  ['audit-ww6', 'npm', ['run', 'audit:ww6']],
  ['audit-ww7', 'npm', ['run', 'audit:ww7']],
  ['audit-ww8', 'npm', ['run', 'audit:ww8']],
  ['audit-ww9', 'npm', ['run', 'audit:ww9']],
  ['semantic-certification-artifact', NODE, ['--import', 'tsx', 'scripts/write-semantic-certification-artifact.ts']],
];

async function recordNetlifyDiagnostic(stageCode, stageName, childExit) {
  if (process.env.NETLIFY !== 'true') return;
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/ww9_build_diagnostics`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        commit_sha: process.env.COMMIT_REF ?? null,
        deploy_context: process.env.CONTEXT ?? null,
        stage_code: stageCode,
        stage_name: stageName,
        child_exit: childExit,
        node_version: process.version,
      }),
    });
  } catch {
    // Diagnostics must never change build outcome.
  }
}

await recordNetlifyDiagnostic(10, 'runner-started', null);

for (let index = 0; index < steps.length; index += 1) {
  const [name, command, args] = steps[index];
  const code = 21 + index;
  console.log(`NETLIFY_BUILD_STAGE_START:${code}:${name}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? `child_exit=${result.status ?? 'null'}`;
    console.error(`NETLIFY_BUILD_STAGE_FAIL:${code}:${name}:${detail}`);
    await recordNetlifyDiagnostic(code, name, result.status ?? null);
    process.exit(code);
  }
  console.log(`NETLIFY_BUILD_STAGE_OK:${code}:${name}`);
}

await recordNetlifyDiagnostic(99, 'runner-completed', 0);
console.log('NETLIFY_BUILD_GATE_OK');
