#!/usr/bin/env python3
"""Build a test-only, source-verbatim financial schema bundle; never connect to a database."""
from pathlib import Path
import argparse
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
COMMIT = '910762af1bb548afb326e0ddbcf60a9a3857e049'
PROPOSAL_SHA256 = '741fab4f5304a13d31f87fbef25106f7de734784fa9d1aa948836a619444f7e8'
OUTPUT = HERE / 'employee-advance-actual-schema.sql'
MANIFEST = HERE / 'employee-advance-actual-schema.sources.json'
EXTERNAL = HERE / 'employee-advance-external-schema.sql'
SOURCES = [
    ('supabase/migrations/20261002092518_financial_daily_close_v1.sql', 166, 174),
    ('supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql', 99, 340),
    ('supabase/migrations/20261002141000_financial_cp8_payroll_pending_guard_v1.sql', 1, 51),
    ('supabase/migrations/20261005080000_owner_group_expense_inbox_v1.sql', 15, 574),
    ('supabase/migrations/20261005081000_owner_group_expense_deny_client_policy_v1.sql', 1, 19),
    ('supabase/migrations/20261005090000_investment_os_global_ledger_v1.sql', 1, 107),
    ('supabase/migrations/20261005093000_investment_legacy_correction_audit_v1.sql', 1, 74),
    ('supabase/migrations/20261005112859_owner_expense_backoffice_cancel_v1.sql', 1, 89),
    ('supabase/migrations/20261005145713_owner_project_task_os_v1.sql', 1, 885),
    ('supabase/migrations/20261005150008_owner_project_os_fk_indexes_v1.sql', 1, 33),
    ('supabase/migrations/20261006025000_owner_expense_line_reclassification_v1.sql', 1, 110),
    ('supabase/migrations/20261006081244_owner_project_bulk_tasks_v1.sql', 1, 271),
    ('supabase/migrations/20261006102000_owner_project_multi_task_state_v1.sql', 1, 81),
    ('supabase/migrations/20261006120000_owner_project_line_state_v1.sql', 1, 81),
    ('supabase/migrations/20261007083000_owner_paid_expense_line_v1.sql', 1, 74),
    ('supabase/migrations/20261008070000_owner_paid_expense_continuation_v1.sql', 1, 101),
    ('supabase/migrations/20261011052544_owner_slip_review_v1.sql', 1, 203),
]

HEADER = f'''-- TEST ONLY: original financial DDL at snkpcn/tamma-chat@{COMMIT}.
-- No proposal is applied by this file. No production/customer/employee data is copied.
-- Use only in an empty disposable database with the exact external prerequisite schema.
-- This is a bounded database-test fixture, not a Supabase service replica.
-- Source blocks below are byte-for-byte slices; their boundaries/hashes are in the manifest.

'''
PREFLIGHT = '''-- Harness precondition only. This does not stand in for any application function.
DO $employee_advance_fixture_preflight$
DECLARE required_name text;
BEGIN
  FOREACH required_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=required_name) THEN
      RAISE EXCEPTION 'actual_schema_platform_role_missing: %', required_name;
    END IF;
  END LOOP;
  FOREACH required_name IN ARRAY ARRAY[
    'tamma_chart_os.employees', 'tamma_chart_os.restaurants',
    'tamma_chart_os.investments', 'tamma_chart_os.investment_categories'
  ] LOOP
    IF pg_catalog.to_regclass(required_name) IS NULL THEN
      RAISE EXCEPTION 'actual_schema_prerequisite_missing: %; supply actual schema-only DDL, never a stub', required_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regclass('public.financial_employee_payroll_events') IS NOT NULL
    OR pg_catalog.to_regclass('public.financial_owner_expense_intakes') IS NOT NULL
    OR pg_catalog.to_regclass('public.financial_investment_entries') IS NOT NULL
    OR pg_catalog.to_regclass('public.owner_projects') IS NOT NULL THEN
    RAISE EXCEPTION 'actual_schema_fixture_requires_empty_financial_schema';
  END IF;
END;
$employee_advance_fixture_preflight$;

'''


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify existing output without changing files.')
    args = parser.parse_args()
    tree_path = ROOT / 'repo-tree.json'
    tree = json.loads(tree_path.read_text()) if tree_path.exists() else None
    if tree:
        assert tree['sha'] == COMMIT and tree.get('truncated') is False
        expected = {item['path']: item['sha'] for item in tree['tree']}
    else:
        saved = json.loads(MANIFEST.read_text())
        expected = {item['path']: item['git_blob_sha1'] for item in saved['sources']}
    proposal = ROOT / 'supabase/proposals/owner_employee_advance_v1.sql'
    assert sha256(proposal.read_bytes()) == PROPOSAL_SHA256, 'Frozen proposal changed'
    chunks = [HEADER.encode()]
    external = None
    if EXTERNAL.exists():
        external_manifest = json.loads((HERE / 'employee-advance-external-schema.sources.json').read_text())
        assert external_manifest.get('complete') is True, 'External schema metadata is incomplete'
        content = EXTERNAL.read_bytes()
        assert external_manifest['fixture_sha256'] == sha256(content), 'External prerequisite hash mismatch'
        external = {'path': str(EXTERNAL.relative_to(ROOT)), 'sha256': sha256(content)}
        chunks.extend([b'-- BEGIN EXACT EXTERNAL PREREQUISITES / SYNTHETIC PRE-EXISTING EMPLOYEE\n', content,
                       b'\n-- END EXACT EXTERNAL PREREQUISITES\n\n'])
    else:
        chunks.append(b'-- External prerequisite DDL is missing. Preflight intentionally fails closed.\n\n')
    chunks.append(PREFLIGHT.encode())
    sources = []
    for path, start, end in SOURCES:
        local = HERE / 'upstream' / path
        if not local.exists():
            local = ROOT / path
        content = local.read_bytes()
        assert git_blob(content) == expected[path], f'Pinned source mismatch: {path}'
        lines = content.splitlines(keepends=True)
        assert 1 <= start <= end <= len(lines), f'Invalid lines: {path}'
        block = b''.join(lines[start - 1:end])
        marker = f'-- BEGIN UPSTREAM {path}:L{start}-L{end}\n'.encode()
        chunks.append(marker)
        output_start = sum(chunk.count(b'\n') for chunk in chunks) + 1
        chunks.append(block)
        chunks.append(f'\n-- END UPSTREAM {path}:L{start}-L{end}\n\n'.encode())
        sources.append({
            'path': path,
            'url': f'https://github.com/snkpcn/tamma-chat/blob/{COMMIT}/{path}#L{start}-L{end}',
            'git_blob_sha1': expected[path], 'file_sha256': sha256(content),
            'source_start_line': start, 'source_end_line': end,
            'slice_sha256': sha256(block), 'slice_bytes': len(block),
            'output_start_line': output_start, 'output_end_line': output_start + end - start,
        })
    result = b''.join(chunks)
    manifest = {
        'repository': 'snkpcn/tamma-chat', 'commit': COMMIT,
        'status': 'external_schema_supplied_static_verification_only' if external else 'blocked_missing_external_schema',
        'proposal_path': str(proposal.relative_to(ROOT)), 'proposal_sha256': PROPOSAL_SHA256,
        'proposal_applied_by_fixture': False, 'database_execution_performed_by_builder': False,
        'fixture_path': str(OUTPUT.relative_to(ROOT)), 'fixture_sha256': sha256(result),
        'external_prerequisite': external,
        'sources': sources,
        'omissions': [
            {'path': SOURCES[0][0], 'lines': '1-165, 175-end', 'reason': 'Unrelated daily-close application tables, functions, triggers, views and business-branch seed; only the unchanged shared touch trigger function is required by payroll.'},
            {'path': SOURCES[1][0], 'lines': '1-98', 'reason': 'Unrelated Inthanin live daily-close RPC cloning/grants and owner-payroll storage bucket configuration; payroll table DDL, all payroll functions/triggers/indexes/grants and view remain unchanged.'},
            {'path': SOURCES[3][0], 'lines': '1-14', 'reason': 'Header and storage.buckets configuration only; complete expense table/audit/index/function/view/privilege DDL remains unchanged.'},
        ],
        'boundary': 'Existing employee and financial workflows only. Provider service behavior and unrelated customer-signup subsystem execution are not emulated. Exact prerequisites and any synthetic seed order are documented separately.',
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    if args.check:
        assert OUTPUT.read_bytes() == result, 'Generated fixture does not match source slices'
        assert MANIFEST.read_bytes() == manifest_bytes, 'Source manifest is stale'
    else:
        OUTPUT.write_bytes(result)
        MANIFEST.write_bytes(manifest_bytes)
    # Independently verify every output span, including its terminating newline.
    output_lines = result.splitlines(keepends=True)
    for source in sources:
        selected = b''.join(output_lines[source['output_start_line'] - 1:source['output_end_line']])
        assert sha256(selected) == source['slice_sha256']
    print(json.dumps({'status': manifest['status'], 'source_blocks': len(sources),
                      'source_bytes': sum(item['slice_bytes'] for item in sources),
                      'fixture_sha256': manifest['fixture_sha256'], 'proposal_unchanged': True}))


if __name__ == '__main__':
    main()
