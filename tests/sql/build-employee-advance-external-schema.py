#!/usr/bin/env python3
"""Reconstruct schema-only prerequisites from captured PostgreSQL catalog definitions.

No database or network calls. This file never applies a proposal or queries production data.
"""
from pathlib import Path
from collections import OrderedDict
import argparse
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
INPUTS = [HERE / 'schema-metadata/target-schema-metadata.json', HERE / 'schema-metadata/target-schema-extra.json']
SUPPLEMENTS = [HERE / 'schema-metadata/target-schema-supplement.json', HERE / 'schema-metadata/target-schema-profile.json']
OUTPUT = HERE / 'employee-advance-external-schema.sql'
MANIFEST = HERE / 'employee-advance-external-schema.sources.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def qualified(schema, table):
    return ident(schema) + '.' + ident(table)


def location(row):
    return row.get('schema', 'tamma_chart_os'), row['table']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    primary = json.loads(INPUTS[0].read_text())
    extra = json.loads(INPUTS[1].read_text())
    sources = INPUTS + SUPPLEMENTS
    supplement = {}
    for path in SUPPLEMENTS:
        for key, value in json.loads(path.read_text()).items():
            supplement.setdefault(key, []).extend(value or [])
    columns = OrderedDict()
    groups = [primary['employee_restaurant'], primary['dependencies']]
    all_columns = [c for group in groups for c in group['columns']] + extra['extra_columns'] + supplement.get('columns', [])
    for column in all_columns:
        key = (*location(column), column['column'])
        columns[key] = {**columns.get(key, {}), **column}
    constraints = [c for group in groups for c in group['constraints']] + extra['extra_constraints'] + supplement.get('constraints', [])
    triggers = [t for group in groups for t in group['triggers']] + extra['extra_triggers'] + supplement.get('triggers', [])
    indexes = extra['indexes'] + supplement.get('indexes', [])
    rls = extra['rls'] + supplement.get('rls', [])
    grants = extra['grants'] + supplement.get('grants', [])
    policies = extra['policies'] + supplement.get('policies', [])
    tables = OrderedDict()
    for (schema, table, column), row in columns.items():
        tables.setdefault((schema, table), []).append(row)
    required = {'auth.users', 'tamma_chart_os.restaurants', 'tamma_chart_os.employees',
                'tamma_chart_os.employee_positions', 'tamma_chart_os.projects',
                'tamma_chart_os.investments', 'tamma_chart_os.investment_categories',
                'tamma_chart_os.investment_payments', 'tamma_chart_os.investment_receipt_intakes',
                'tamma_chart_os.profiles'}
    found = {'.'.join(key) for key in tables}
    missing_tables = sorted(required - found)
    functions = OrderedDict()
    for trigger in triggers:
        definition = trigger['function_definition']
        functions[definition] = {'source': 'trigger.function_definition', 'definition': definition}
    for function in supplement.get('functions', []):
        definition = function['definition'] if isinstance(function, dict) else function
        functions[definition] = {'source': 'supplement.functions', 'definition': definition, 'catalog': function}
    required_functions = ['auth.uid()', 'tamma_chart_os.auth_restaurant_id()', 'tamma_chart_os.recalculate_investment_actual_v1(']
    function_text = '\n'.join(functions)
    assert all('catalog' in value and 'acl' in value['catalog'] for value in functions.values()), 'Missing exact function ACL metadata'
    assert {row['schema'] for row in supplement.get('schema_acls', [])} == {'auth', 'tamma_chart_os'}, 'Missing schema ACLs'
    missing_functions = [name for name in required_functions if not re.search(r'CREATE OR REPLACE FUNCTION\s+' + re.escape(name), function_text, re.I)]
    if missing_tables or missing_functions:
        raise SystemExit('Missing exact metadata: ' + json.dumps({'tables': missing_tables, 'functions': missing_functions}))

    chunks = ['''-- TEST ONLY: schema reconstructed from exact PostgreSQL catalog metadata.
-- All application constraint expressions, indexes, triggers and function definitions
-- are preserved. CREATE TABLE/ALTER TABLE wrappers and quoting are generated.
-- Provider prerequisites: existing anon, authenticated and service_role roles.
-- No credentials, real employees or real financial records are present.
-- The sole auth user below models a pre-existing principal; signup is not exercised.
-- Unrelated customer-signup function bodies are retained unchanged. Their external
-- customer subsystem is deliberately not emulated and must not be invoked here.

SET search_path = public;
CREATE SCHEMA auth;
CREATE SCHEMA tamma_chart_os;

''']
    records = []

    def append(label, sql, source=None, exact=False):
        start = sum(c.count('\n') for c in chunks) + 2
        chunks.append('-- ' + label + '\n')
        chunks.append(sql)
        # Catalog functions/indexes/triggers may not include an SQL terminator.
        if not sql.rstrip().endswith(';'):
            chunks.append(';')
        chunks.append('\n\n')
        records.append({'label': label, 'source': source, 'definition_sha256': digest(sql.encode()),
                        'verbatim_catalog_definition': exact, 'output_start_line': start,
                        'definition_line_count': len(sql.splitlines())})

    for (schema, table), table_columns in tables.items():
        definitions = []
        for col in table_columns:
            text = '  ' + ident(col['column']) + ' ' + col['type']
            if col.get('generated'):
                assert col['generated'] == 's', f'Unsupported generated kind: {col}'
                text += ' GENERATED ALWAYS AS (' + col['default'] + ') STORED'
            elif col.get('identity'):
                text += ' GENERATED ' + ('ALWAYS' if col['identity'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
            elif col['default'] is not None:
                text += ' DEFAULT ' + col['default']
            if col['not_null']:
                text += ' NOT NULL'
            definitions.append(text)
        append('TABLE FROM CATALOG: ' + schema + '.' + table,
               'CREATE TABLE ' + qualified(schema, table) + ' (\n' + ',\n'.join(definitions) + '\n);', 'columns')

    # Install every original key/check constraint, then every original foreign key.
    for foreign in (False, True):
        for con in constraints:
            if con['definition'].upper().startswith('FOREIGN KEY') != foreign:
                continue
            schema, table = location(con)
            append('EXACT CONSTRAINT: ' + schema + '.' + table + '.' + con['name'],
                   'ALTER TABLE ' + qualified(schema, table) + ' ADD CONSTRAINT ' + ident(con['name']) + ' ' + con['definition'] + ';', 'constraints')
    for row in indexes:
        append('EXACT INDEX: ' + '.'.join(location(row)), row['definition'], 'indexes', True)
    for value in functions.values():
        append('EXACT FUNCTION: ' + value['definition'].splitlines()[0], value['definition'], value['source'], True)
    for row in rls:
        table_name = qualified(*location(row))
        append('ROW SECURITY: ' + '.'.join(location(row)),
               'ALTER TABLE ' + table_name + (' ENABLE' if row['enabled'] else ' DISABLE') + ' ROW LEVEL SECURITY;\n' +
               'ALTER TABLE ' + table_name + (' FORCE' if row['forced'] else ' NO FORCE') + ' ROW LEVEL SECURITY;', 'rls')
    for row in policies:
        sql = 'CREATE POLICY ' + ident(row['policyname']) + ' ON ' + qualified(row['schemaname'], row['tablename'])
        sql += ' AS ' + row['permissive'] + ' FOR ' + row['cmd'] + ' TO '
        sql += ', '.join('PUBLIC' if role == 'public' else ident(role) for role in row['roles'])
        if row['qual'] is not None:
            sql += '\n  USING (' + row['qual'] + ')'
        if row['with_check'] is not None:
            sql += '\n  WITH CHECK (' + row['with_check'] + ')'
        append('EXACT POLICY EXPRESSIONS: ' + row['policyname'], sql + ';', 'policies')
    for row in grants:
        sql = 'GRANT ' + row['privilege_type'] + ' ON TABLE ' + qualified(row['table_schema'], row['table_name'])
        sql += ' TO ' + ('PUBLIC' if row['grantee'] == 'PUBLIC' else ident(row['grantee']))
        if row['is_grantable'] == 'YES':
            sql += ' WITH GRANT OPTION'
        append('CATALOG TABLE GRANT', sql + ';', 'grants')
    # Only service roles used by this isolated test exist. Provider-administration
    # identities and ownership are explicitly bounded rather than invented.
    tested_roles = {'', 'postgres', 'anon', 'authenticated', 'service_role'}
    omitted_provider_acls = []
    for row in supplement['schema_acls']:
        target = 'SCHEMA ' + ident(row['schema'])
        append('RESET SCHEMA ACL FOR TESTED ROLES', 'REVOKE ALL ON ' + target + ' FROM PUBLIC, anon, authenticated, service_role;', 'schema_acls')
        for acl in row['acl']:
            grantee, rest = acl.split('=', 1)
            privileges, grantor = rest.split('/', 1)
            if grantee not in tested_roles:
                omitted_provider_acls.append({'target': target, 'acl': acl})
                continue
            for flag, privilege in [('U', 'USAGE'), ('C', 'CREATE')]:
                if flag in privileges:
                    append('CATALOG SCHEMA GRANT FOR TESTED ROLE',
                           'GRANT ' + privilege + ' ON ' + target + ' TO ' + ('PUBLIC' if not grantee else ident(grantee)) +
                           (' WITH GRANT OPTION' if flag + '*' in privileges else '') + ';', 'schema_acls')
    for value in functions.values():
        row = value['catalog']
        signature = row.get('signature')
        if signature is None:
            raw = re.search(r'FUNCTION\s+[^ (]+\(([^)]*)\)', row['definition'], re.I).group(1)
            signature = re.sub(r'\bp_[A-Za-z0-9_]+\s+', '', raw)
        target = 'FUNCTION ' + qualified(row['schema'], row['name']) + '(' + signature + ')'
        append('RESET FUNCTION ACL FOR TESTED ROLES', 'REVOKE ALL ON ' + target + ' FROM PUBLIC, anon, authenticated, service_role;', 'functions.acl')
        for acl in row['acl']:
            grantee, rest = acl.split('=', 1)
            privileges, grantor = rest.split('/', 1)
            assert set(privileges) <= {'X', '*'}, 'Unexpected function privilege'
            if grantee not in tested_roles:
                omitted_provider_acls.append({'target': target, 'acl': acl})
                continue
            if 'X' in privileges:
                append('CATALOG FUNCTION GRANT FOR TESTED ROLE',
                       'GRANT EXECUTE ON ' + target + ' TO ' + ('PUBLIC' if not grantee else ident(grantee)) +
                       (' WITH GRANT OPTION' if 'X*' in privileges else '') + ';', 'functions.acl')
    for row in triggers:
        if row.get('schema') == 'auth':
            continue
        append('EXACT TRIGGER: ' + '.'.join(location(row)) + '.' + row['name'], row['definition'], 'triggers', True)

    append('SYNTHETIC EXISTING PRINCIPAL AND EMPLOYEE: no signup, password, token or real financial data', '''INSERT INTO auth.users(id, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000003', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
INSERT INTO tamma_chart_os.restaurants(id, owner_id, name, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003',
        'Synthetic Restaurant', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
INSERT INTO tamma_chart_os.employees(id, restaurant_id, full_name, nickname, wage_amount, employment_type, status, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
        'Synthetic Employee', 'Worker', 12000, 'เงินเดือน', 'ทำงานอยู่',
        '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');''', 'synthetic-test-fixture')
    for row in triggers:
        if row.get('schema') != 'auth':
            continue
        append('EXACT AUTH TRIGGER, ATTACHED AFTER PRE-EXISTING USER SEED: ' + row['name'], row['definition'], 'triggers', True)

    result = ''.join(chunks).encode()
    manifest = {
        'source': 'Approved PostgreSQL structural metadata capture, 2026-10-12; no source data rows included.',
        'metadata_sources': [{'path': str(path.relative_to(ROOT)), 'sha256': digest(path.read_bytes())} for path in sources],
        'fixture_sha256': digest(result), 'complete': True, 'tables': sorted(found),
        'counts': {'columns': len(columns), 'constraints': len(constraints), 'indexes': len(indexes),
                   'functions': len(functions), 'triggers': len(triggers), 'policies': len(policies), 'table_grants': len(grants)},
        'seed': {'auth_user_id': '10000000-0000-4000-8000-000000000003',
                 'restaurant_id': '10000000-0000-4000-8000-000000000002',
                 'employee_id': '10000000-0000-4000-8000-000000000001',
                 'employee_updated_at': '2026-09-01T00:00:00Z',
                 'seed_before_auth_signup_triggers': True},
        'excluded_execution_paths': ['Auth signup and email-change customer subsystem; original trigger bodies remain present but no customer tables/functions are stubbed.',
                                     'Supabase Auth API, JWT issuance, and Storage service behavior; no credential values are supplied.'],
        'provider_scaffolding': {'schema_and_function_owner': 'postgres in disposable CI database; provider administration ownership is not reproduced',
                                  'omitted_provider_admin_acls': omitted_provider_acls,
                                  'tested_role_acls': 'PUBLIC, postgres, anon, authenticated and service_role grants preserved'},
        'database_execution_performed_by_builder': False,
        'definitions': records,
    }
    manifest_data = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    if args.check:
        assert OUTPUT.read_bytes() == result, 'External schema is stale'
        assert MANIFEST.read_bytes() == manifest_data, 'External manifest is stale'
    else:
        OUTPUT.write_bytes(result)
        MANIFEST.write_bytes(manifest_data)
    print(json.dumps({'fixture_sha256': manifest['fixture_sha256'], 'counts': manifest['counts']}))


if __name__ == '__main__':
    main()
