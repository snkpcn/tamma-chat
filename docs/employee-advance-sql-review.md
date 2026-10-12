# Employee salary advances: local SQL review package

Status: UNAPPLIED SQL PROPOSAL. Source review and synthetic CI do not apply the production schema or authorize financial posting.

## Files and verification
- SQL: `supabase/proposals/owner_employee_advance_v1.sql`
- Synthetic executable database tests: `tests/owner-employee-advance-migration.test.ts`
- Test log: `evidence/sql-tests.log`
- Run: `node --import tsx --test tests/owner-employee-advance-migration.test.ts`

The tests use PGlite (real PostgreSQL SQL/PLpgSQL execution) with a minimal synthetic fixture of the verified source schema. They test function compilation, privilege boundaries, stage/confirm, stale monthly snapshots, repeated clicks, exact evidence deduplication, source preservation, atomic batch failure, truthful funding, generic expense/investment cross-ledger guards, classification changes, and audited compensation. This is not a production deployment test and does not prove independent-connection lock contention. Before release, run two-connection PostgreSQL tests for simultaneous confirmation of the same slip, different slips for one employee, old writer vs new writer, and payroll vs generic expense/investment posting. Expected result: one source payment counted once; a stale card must be refreshed; failed operations leave no partial audit/profile/source changes.

## Interface used by the card worker
`owner_employee_advance_context_v1(group_hash, employee_query, employee_id, event_date)` returns group-bound existing employee candidates, an unambiguous selected candidate, month bounds, and paid salary advances by event_date. Candidate fields include employee_id, employee_key, label/full_name/nickname, business_unit_code, role_label, month_paid_advance/monthly_sum, profile_revision, employee_updated_at, and advance_outstanding. `monthly_salary` is populated only when the employee profile has an explicitly approved monthly salary basis. Wage amount alone does not establish its period.

`financial_stage_owner_employee_advance_v1(intake_id, group_hash, actor_hash, message_id, revision, proposal)` accepts a top-level `{kind:'employee_advance',event_type:'salary_advance'|'unknown',employee_query,employee_id,business_unit_code,funding_source,amount,occurred_on,purpose,questions,monthly_sum_before}`. It derives trusted context and questions and changes only review state. Missing employee/type/date can be parked, never confirmed. Canonical money remains untouched during review.

`financial_confirm_owner_employee_advance_v1(intake_id, group_hash, actor_hash, revision, message_id)` reads the locked stored proposal. It returns authoritative employee context, amount/date/funding, monthly_sum_before, monthly_sum, and event_id. It returns changed:true without writing when employee context or monthly balance differs. Repeated authenticated clicks return the same committed event. Exact evidence already linked to another event returns duplicate_transaction:true and no money write.

`financial_import_owner_employee_advances_v1(group_hash, approval_ref, actor_hash, rows, expected_total)` is a separate backoffice operation for a verified approval outside LINE. It never invents a LINE actor. The actor may be null if the executor has no verified identity hash; the real approval reference is mandatory. Exact expected employee record/tenant/wage/update timestamp, source revision/update timestamp, amount/date/message/hash/bank reference and batch total are checked. All rows, profile bindings, source updates, and audits commit together or roll back together. Original evidence paths are reused. Optional classification_approval_refs and funding_evidence_refs are retained in audit metadata. An employee is mapped only to an existing record; tenant IDs are never repurposed as cost centers.

## Accounting and safety semantics
- Funding supports business_account, owner_personal, cash, other, and unknown. No hardcoded personal funding. Metadata records a classification, never an assertion of bank verification.
- Salary advances are not capital investments or operating expenses. The payroll entry becomes the single money representation. The old expense inbox row is marked excluded, retains original amount/evidence, and links payroll_event_id. `payment_cancelled:false` makes clear that the bank payment itself is not cancelled.
- October/monthly totals use paid salary_advance event_date. They are not net salary due, and do not infer pay_period, attendance or payroll settlement.
- All evidence identities are checked within the owner group. Equal amounts/dates alone do not cause deduplication.
- Active normalized bank reference, source intake, slip message, and image hash identities have database uniqueness protection. Advisory transaction locks serialize writers within an owner group. Generic expense/investment writes have reciprocal payroll evidence guards.
- New OCR metadata cannot override quotations, incoming payments or multi-slip documents; legacy transfer slips with absent semantic fields remain supported. Missing extracted payment date blocks confirmation instead of using upload date.
- Authoritative reviewed purchase corrections may supersede mistaken OCR notes. Salary-advance/unknown staff purposes cannot slip into generic expense confirmation. Cancellation stays available.
- Every new RPC is SECURITY INVOKER with an empty search_path. PUBLIC, anon and authenticated have no new function/table access. Only service_role receives the new capabilities; no source-table privileges, credentials or RLS bypass grants are introduced.
- Production read-only checks on 12 October 2026 confirmed service_role already has employee-schema USAGE and employee SELECT/UPDATE, payroll SELECT/INSERT/UPDATE, intake SELECT/UPDATE, expense-audit INSERT, and investment SELECT. Runtime must still enforce the single configured finance owner and a verified signed LINE event. Database service credentials are a trusted server boundary, not an owner-authentication substitute.

## Reversal and deployment rollback
`financial_revert_owner_employee_advance_v1(event_id, group_hash, approval_ref, actor_hash, reason, expected_event_updated_at, expected_intake_revision)` requires a separate explicit approval and exact unchanged source/event revisions. It refuses reversal after a later paid salary settlement or recorded advance deduction. It retains the bank payment/evidence and original audit, cancels only the payroll bookkeeping representation, appends reversal audits, and parks the source for manual reconciliation. The original source link and uniqueness remain, so it cannot silently be reimported or reclassified by an old card. Repeated use of the same reversal approval is idempotent.

For deployment rollback, first disable the new runtime entry points. Do not drop populated audit/profile/source-link columns or delete financial records. Revert uncommitted migration transactions normally. For a committed schema, leave the additive schema in place and retain provenance; use an approved compensating record for posted data rather than a destructive down migration.

## Required release gates
1. Obtain explicit production code/schema deployment approval. Approval to record a few advances is not silently widened to a deployment.
2. Generate the actual migration with `supabase migration new`; this package intentionally has no invented dated migration filename because Supabase CLI is unavailable in this workspace.
3. Recheck exact source schema/constraints, service privileges, and original table triggers. Existing unique-key collisions must be investigated, never automatically cancelled or deleted to make the migration pass.
4. Run complete repository regression tests and true multi-connection tests against a disposable PostgreSQL/Supabase branch, including all legacy expense/investment/payroll entry points. Assess index-building locks on the live tables.
5. Apply the approved additive migration transactionally, deploy the paired runtime patch, and verify new RPC signatures and denied anon/authenticated execution. No credentials or public data access changes are required.
6. Re-read exact employee and source rows, evidence identities, existing payroll matches and current month total immediately before an approved import. Use unchanged expected revisions and a real approval reference. Stop on any mismatch.
7. After import, re-read event/source/audit rows and current monthly total. Confirm correct employee, central cost center where approved, original evidence, truthful funding, no investment/expense double count, and no new employee. Retry the identical import only to verify read-only idempotency; never change evidence keys to bypass a conflict.

## Explicit limits
Unlinked or manually entered transactions without shared reference/message/image/source IDs cannot be proven to be duplicates. Historical funding classifications are not repaired by this change. Only explicitly bound employees appear in the new context; unknown staff must be bound to their existing record with verified affiliation before posting. True cross-connection concurrency, live deployment, user acceptance and production posting are not established by the local test result.
