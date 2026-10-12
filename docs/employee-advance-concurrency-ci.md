# Real PostgreSQL 17 concurrency validation

Run only through `.github/workflows/employee-advance-concurrency-ci.yml` on the approved public GitHub Actions standard runner. No Supabase branch, production URL, service secret, paid database, host port, or persistent database credential is used.

The job container and PostgreSQL 17 service share the disposable job's private Docker network. Trust authentication is restricted to that short-lived synthetic environment. The existing postgres user and ephemeral NOLOGIN authorization roles are used; nothing changes in an existing database or account. Checkout does not persist credentials; the workflow token has only contents:read.

## What the job checks

1. A separate standard-runner step runs both source/metadata builders with `--check`.
2. The database starts empty. Source-exact fixture DDL preserves relevant application columns, constraints, indexes, triggers, functions, RLS and tested-role grants. The provider/customer-subsystem boundaries are documented in `tests/sql/employee-advance-actual-schema.README.md`.
3. Before applying the proposal, the disposable service reproduces production creator default grants. A complete privilege matrix verifies that the two new tables restrict the server role precisely and deny anonymous/authenticated access. Global defaults and existing source-table grants remain unchanged.
4. The frozen proposal hash is checked and applied only to this disposable service. No migration-history entry or production target is involved.
5. Eighteen concurrency cases use independent psql backend sessions. For blocked races, a third observer must see the actual `pg_blocking_pids` edge and distinct backend PIDs. A conflicting profile insert must instead fail promptly with the specific busy error while the first transaction remains open; its distinct backend PID is captured before the rejected statement. Sleep merely keeps the first transaction open; time passing alone never counts as success. A separate-groups case must complete its second transaction while the first still holds its transaction.
6. Cases cover same-slip double clicks; legitimate equal payments with a stale balance; duplicate references; both legacy/new payroll writer orders; both expense and investment allocation orders; separate-group isolation; concurrent affiliation changes; concurrent draft revisions; alias removal/new ambiguity; profile mutation in both orders; and inactive-employee reactivation in both orders.
7. Three actual-schema sequential cases exercise the backoffice three-slip import, identical cached retry, stale-last-row full rollback, and audited compensation. The rollback asserts that earlier rows, profile binding, audits and source changes all rolled back.
8. Final assertions verify authoritative totals, one persisted payment representation, source preservation, correct audit before/after provenance, unchanged unknown funding, no leftover failed-ledger audit, and no extra employee.

## Output and limits

The artifact contains synthetic-only per-session logs, actual observed backend PIDs, a TAP transcript, and a JSON summary. Bootstrap/statement failures fail the job; no race is skipped or downgraded to a sequential pass.

A local PGlite smoke can check exact-source DDL compilation, but is never reported as real multi-connection proof. Only a successful hosted PostgreSQL job establishes this concurrency result. This bounded fixture is not a full Supabase service replica; no real LINE client delivery or bank verification is implied. Production deployment and the actual historical import remain separate approval gates.

The earlier 15-case hosted pass on `97386da52b7054a50ca8761166045bf48da55191` predates the alias amendment. The revised harness now contains 18 races plus three sequential cases (21 total); this document does not claim that revised suite has run on hosted PostgreSQL yet.
