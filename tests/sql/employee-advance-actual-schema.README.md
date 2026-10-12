# Employee advance: source-exact database-test bootstrap

Entry point: `tests/sql/employee-advance-actual-schema.sql`.

This is a disposable-database fixture for an existing employee and the actual payroll,
owner-expense, investment and owner-project SQL dependencies. It is not a full Supabase
service replica. The frozen proposal is **not** part of this bootstrap.

## Source provenance

- Repository: `snkpcn/tamma-chat`
- Pinned commit: `910762af1bb548afb326e0ddbcf60a9a3857e049`
- All 16 original local financial/owner-project migrations match the pinned Git blobs.
- The shared payroll touch function is copied verbatim from
  `20261002092518_financial_daily_close_v1.sql`, lines 166–174.
- `employee-advance-actual-schema.sources.json` records every full-file SHA-256,
  Git blob SHA-1, copied 1-based line range, slice SHA-256 and output line range.
  Source paths are canonical repository paths; local resolution paths are never
  serialized, so partial and full checkouts produce identical manifests.
  All 17 copied blocks are byte-for-byte original SQL. No constraint is weakened,
  and no application function or trigger is replaced by a test stub.
- `employee-advance-schema-search.json` records all 108 tracked SQL files inspected
  and verified against the pinned recursive Git tree. They contain no base
  `CREATE TABLE` for employees, restaurants, investments or investment_categories.
- Exact external definitions are reconstructed from approved schema-only catalog
  exports in `tests/sql/schema-metadata/`, hashed in `employee-advance-external-schema.sources.json`.
  Types, defaults, NOT NULLs, generated columns, named constraints, indexes, RLS,
  policies, grants, trigger definitions and complete function bodies are retained.
  SQL statement wrappers are generated from metadata, not an invented schema.

## Deliberate boundaries

1. The caller supplies disposable PostgreSQL provider roles `anon`, `authenticated`
   and `service_role`. No login credentials are created by these files. PUBLIC and
   the tested application-role ACLs are preserved. CI uses postgres ownership;
   provider-administration roles/ownership are not reproduced. The external
   manifest lists each omitted provider-administration ACL explicitly.
2. CP8 live daily-close RPC cloning and storage bucket seed configuration are omitted.
   They neither define nor constrain the tested payroll/expense/investment tables.
   The manifest lists exact omitted ranges. Storage tables/services are not stubbed.
3. The sole seeded auth principal is synthetic and represents an existing account.
   Seed order: exact tables/constraints/functions/security and non-auth triggers;
   synthetic auth user; synthetic restaurant; synthetic employee; original auth
   signup/email triggers. Auth signup and email-change workflows are outside the
   test boundary; their actual function bodies are preserved, and their unrelated
   customer-system dependencies are not replaced with no-ops.
4. The SQL fixture has no real employee, financial or customer rows and no passwords,
   API keys or authentication tokens. Financial test rows are supplied by the suite.
5. The bootstrap fails closed if exact external metadata is missing or the target
   financial tables already exist. Do not use a reduced fallback.

## Synthetic existing employee

- Auth user: `10000000-0000-4000-8000-000000000003`
- Restaurant: `10000000-0000-4000-8000-000000000002`
- Employee: `10000000-0000-4000-8000-000000000001`
- Full name/nickname: `Synthetic Employee` / `Worker`
- Wage/employment/status: `12000` / `เงินเดือน` / `ทำงานอยู่`
- Initial employee updated_at: `2026-09-01T00:00:00Z`

## Rebuild and integrity verification (no database connection)

```sh
python tests/sql/build-employee-advance-external-schema.py
python tests/sql/build-employee-advance-external-schema.py --check
python tests/sql/build-employee-advance-actual-schema.py
python tests/sql/build-employee-advance-actual-schema.py --check
```

The source builder asserts the frozen proposal SHA-256 remains
`54daddec6e5cc0f9d4dcf15237671b8504448f2b469ab4075df745efbffc7026`.
Running either builder only reads/writes local files; neither applies SQL or opens
any database connection. Static provenance verification is not a runtime SQL pass.

After provider role setup, the separately authorized test harness can load the main
bootstrap once into a fresh disposable database, then apply the frozen proposal
and run synthetic tests. Keep runtime test results separate from source-integrity
checks. Never load this fixture into an existing or production database.
