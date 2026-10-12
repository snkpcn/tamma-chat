import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const guardPath = path.resolve(process.env.GUARD_SQL || path.join(here, '../guard-repair.sql'));
export const saved = path.resolve(here, '../../deployment-preflight');
const digest = (s) => createHash('sha256').update(s).digest('hex');
export function buildFixture() {
  const files = [
    path.join(here, 'fixture-schema.sql'),
    guardPath,
    path.join(saved, 'financial_daily_closes_touch_updated_at.sql'),
    path.join(saved, 'financial_daily_adjustment_guard.sql'),
    path.join(saved, 'financial_reconcile_daily_close_v1.sql'),
    path.join(saved, 'financial_confirm_inthanin_live_daily_close_v1.sql'),
    path.join(saved, 'remote-wrapper.sql'),
    path.join(here, 'fixture-triggers.sql'),
  ];
  const manifest = [];
  const parts = files.map((f) => {
    const source = fs.readFileSync(f, 'utf8');
    manifest.push({path: path.relative(here, f), sha256: digest(source)});
    // ACL references are not relevant to this owner-run isolated behavior test.
    // Do not create or alter cluster roles in the runnable PostgreSQL fixture.
    const sql = path.basename(f) === 'remote-wrapper.sql'
      ? source.replace(/^(?:revoke|grant)\s[^\n]*;\s*$/gmi, '')
      : source;
    return `\n-- SOURCE: ${path.relative(here, f)}\n${sql.trim()}\n;\n`;
  });
  return {sql: parts.join(''), manifest};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {sql, manifest} = buildFixture();
  fs.writeFileSync(path.join(here, 'generated-fixture.sql'), sql);
  fs.writeFileSync(path.join(here, 'fixture-source-manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  console.log('Created local generated-fixture.sql and source hashes. No database connection made.');
}
