import { spawnSync } from 'node:child_process';

// Presence-only gate: this script never reads THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN's
// value, only whether it exists. Nobody needs to type, transmit, or relay the
// secret to trigger this -- only whoever already controls this site's Netlify
// environment variables (the same trust boundary as GEMINI_API_KEY/OPENAI_API_KEY).
// The diagnostic itself only console.logs a safe, structured result -- no file
// is written, no HTTP endpoint of any kind exists to read it back; the result
// is visible only in Netlify's own build log.
if (!process.env.THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN) {
  console.log('PHASE_P_DIAGNOSTIC_SKIPPED');
  process.exit(0);
}

console.log('PHASE_P_DIAGNOSTIC_START');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'scripts/phase-p-run-diagnostic.ts'],
  { stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
// Never fail the production build over a diagnostic.
process.exit(0);
