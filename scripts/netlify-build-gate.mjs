import { spawnSync } from 'node:child_process';

const NODE = process.execPath;
// Release verification uses existing production build credentials in place.
// It exposes no runtime endpoint and never prints secrets, bodies or financial rows.
if (process.env.CONTEXT === 'production') {
  const checks = [];
  try {
    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key || base.replace(/\/$/, '') !== 'https://upaokrprawzhgzeqsdke.supabase.co') {
      throw new Error('verification_environment');
    }
    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    for (const [name, path] of [
      ['review_columns', 'financial_owner_expense_intakes?select=id,review_state,review_revision,review_data,review_message_id&limit=0'],
      ['installment_task_relationship', 'owner_project_installments?select=id,task:owner_project_tasks(title)&limit=0'],
    ]) {
      const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/' + path, {
        method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      checks.push({ name, status: response.status, pass: response.ok && Array.isArray(data) && data.length === 0 });
    }
    const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/', {
      method: 'GET', headers: { ...headers, Accept: 'application/openapi+json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const spec = await response.json();
    for (const name of ['financial_capture_owner_slip_review_v1', 'financial_stage_owner_slip_review_v1',
      'financial_confirm_owner_slip_review_v1', 'financial_handoff_owner_slip_payroll_v1']) {
      checks.push({ name, status: response.status, pass: response.ok && Boolean(spec?.paths?.['/rpc/' + name]?.post) });
    }
    if (!checks.every(check => check.pass)) throw new Error('verification_failed');
    console.log('OWNER_SLIP_HOSTED_READONLY:' + JSON.stringify({ status: 'PASS', checks }));
  } catch {
    console.log('OWNER_SLIP_HOSTED_READONLY:' + JSON.stringify({ status: 'FAIL', checks }));
    process.exit(70);
  }
}

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
  ['audit-ww10', 'npm', ['run', 'audit:ww10']],
  ['audit-ww11', 'npm', ['run', 'audit:ww11']],
  ['audit-ww12', 'npm', ['run', 'audit:ww12']],
  ['audit-i18n7', 'npm', ['run', 'audit:i18n7']],
  ['worldwide-storefront-visual', NODE, ['--import', 'tsx', '--test', 'tests/worldwide-storefront-visual.test.ts']],
  ['semantic-certification-artifact', NODE, ['--import', 'tsx', 'scripts/write-semantic-certification-artifact.ts']],
  ['ww12-production-certification', NODE, ['scripts/ww12-production-certification.mjs']],
];

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
    process.exit(code);
  }
  console.log(`NETLIFY_BUILD_STAGE_OK:${code}:${name}`);
}

console.log('NETLIFY_BUILD_GATE_OK');
