# Daily-close verification kit

Local final evidence: 48 deterministic guard cases, 48 repository-financial-schema/writer cases, and 4 SQL-to-LINE integration assertions passed. These are single-session PGlite tests, not concurrency certification.

The repository-ready kit lives under tamma-chat/tests/sql/inthanin-daily-close-repair. It uses existing Node dependencies and repository migrations. From the tamma-chat root:

    node tests/sql/inthanin-daily-close-repair/database/tests/run-pglite.mjs
    node tests/sql/inthanin-daily-close-repair/database/tests/run-actual-schema.mjs
    node --import tsx tests/sql/inthanin-daily-close-repair/database/tests/run-card-writer-integration.ts

The actual fixture replays repository financial tables/views/constraints, then saved actual current writer bodies and the proposal. Only unrelated foundational business-unit/storage dependencies and roles are fixture scaffolding. RLS tests use explicitly synthetic policies; current production policy parity is still a release gate. A guard-component/proposal check rejects divergent test source. All test amounts, actors and dates are invented.

`run-postgres-concurrency.py` is the unchanged legacy synthetic runner retained only as a reusable session helper and historical comparison. Its cancellation-first generic direct-write case does not represent the repaired automatic settlement contract.

`run-actual-postgres-concurrency.py` is the new 35-case actual-writer runner. It has only been compiled; no real concurrency results exist. It requires an authorized empty guard_revision_test_* database on a local PostgreSQL service with existing anon/authenticated/service_role fixture roles. It refuses remote hosts, nonempty public schemas, and missing opt-in, and it creates no cluster roles. Never use production credentials or a port-forward. Every contention assertion uses observed PostgreSQL blocker IDs.

    node tests/sql/inthanin-daily-close-repair/database/tests/build-actual-fixture.mjs
    python3 tests/sql/inthanin-daily-close-repair/database/tests/run-actual-postgres-concurrency.py --host 127.0.0.1 --database guard_revision_test_inthanin --user postgres --allow-local-fixture-writes

The proposed GitHub Actions workflow prepares an isolated PostgreSQL 17 service and synthetic roles for this purpose. Publication and its run require approval first. Do not claim any hosted, browser, live-schema or multi-session pass from local PGlite results.
