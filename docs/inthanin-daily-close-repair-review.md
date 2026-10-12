# Inthanin daily-close revision repair

Local implementation only. Confirmation activation and production release remain blocked pending the gates below.

## Changes

- Replace three existing invoker trigger guards to lock direct old/new parents and linked claim origins and advance draft revisions when dependencies change. Confirmed records remain immutable; valid later reimbursement of a confirmed origin remains possible.
- Compare the source fields of generated totals in BEFORE UPDATE rather than unavailable NEW generated values. No-op and timestamp-only updates retain their token; explicit writer revision advances remain monotonic.
- Fail closed when RLS hides a referenced parent/claim or prevents a required lock. Unlinked children require no claim lock. No grants or security-definer shortcut are added to satisfy an unsupported direct writer.
- Lock/revalidate selected claims in the two existing automatic evidence-settlement writers. Cancellation, changed origin or outstanding amount that wins leaves evidence unmatched/needs_review. Rematch also locks evidence, skips rejected evidence and does not overwrite a completed match after waiting. Source-key conflicts are reused only after exact settlement ownership/value validation; unmatched conflicts remain needs_review.
- Add an owner-backend, service-only atomic draft saver using the same parent lock and expected-revision contract as the installed LINE confirmation wrapper. It validates exact close/date/environment/active branch, mutable status and allowed inputs; NULL cash remains NULL. No new confirmation path is added.
- Make the LINE edit link exact-day and revision-aware and recognize the database's pending_confirmation state. Existing owner, group, missing-data, variance, blocker and rollout checks remain in place. Availability copy no longer claims LIVE Backoffice confirmation exists.
- The companion Backoffice patch retains the exact target through owner login, uses an effective record with its real revision, calls atomic save, handles stale/uncertain responses without blind retries, and guards repeated clicks and interrupted navigation. LIVE Backoffice confirmation stays disabled.

## Database privilege difference

The proposal replaces only:

- financial_guard_daily_close()
- financial_guard_close_child_mutation()
- financial_guard_expense_claim()
- financial_attach_inthanin_live_evidence_v1(text,text,date,text,text,text,text,jsonb)
- financial_rematch_inthanin_live_day_evidence_v1(uuid)

Existing signatures, ownership, ACLs and SECURITY modes are preserved.

The only added signature is financial_save_inthanin_daily_close_draft_v1(uuid,date,text,integer,jsonb,text), SECURITY INVOKER. Its PUBLIC/anon/authenticated privileges are revoked and only service_role receives EXECUTE. No tables, policies, existing wrapper, role attributes, credentials, financial rows or activation flags change.

A direct cancellation with active ledger RLS now fails because a filtered count cannot prove settlement absence. Service/definer writers keep their full-ledger behavior. A writer that cannot read and lock all dependencies now fails instead of silently omitting an invalidation. A referenced claim must be explicitly unlinked before deletion if a cascade would make its old dependency unavailable. Current application writers cancel claims rather than deleting them. Legitimate production direct-writer policies still need parity verification before release.

## Local evidence

Base: tamma-chat b1caaea2ed4dde68096515370b58733846e13a3f. Existing employee-release changes remain untouched.

- Full source suite: 2,945 passed, 0 failed
- Targeted LINE Node-runtime TypeScript check and bundle: passed
- Deploy-preview Netlify build gate: passed; production-only checks intentionally not executed
- Deterministic guard tests: 48 passed
- Repository-financial-schema/actual-writer tests: 48 passed
- Actual SQL writer → LINE card assertions: 4 passed
- Companion Backoffice API/inline-script VM-DOM tests: 66 passed

The repository-relative test kit was executed locally. It uses actual repository financial tables/views/constraints and saved actual writer bodies; only unrelated foundation dependencies and role/policy scenarios are fixture scaffolding. Fixtures contain invented data only. Source hashes are emitted with results, and the kit checks that its repair components match the proposal.

## Unfinished release gates

- The prepared 35-case real PostgreSQL suite has not run. Its proposed CI job uses a disposable PostgreSQL 17 service, synthetic credentials and no production connection. Actual blocker IDs, serialization results and safe deadlock rollback must pass before activation.
- Current production schema/view/constraint/RLS/ACL parity remains unverified. Synthetic role tests do not certify live policy behavior.
- Targeted LINE TypeScript passes with ES2022/Node libraries. A default browser-DOM comparison has an unchanged baseline Buffer/BodyInit mismatch; no whole-repository typecheck pass is claimed. Backoffice needs its declared Netlify dependency present for a complete handler typecheck.
- Exact-commit hosted CI and deployed-browser/LINE owner workflow checks are still required. Mocked transport and VM/DOM tests are not deployed E2E.
- Publication, production migration/app deployment and activation require separate approval. Do not confirm real financial data as a deployment test.

## Rollback

Disable LINE confirmation activation first. Roll back callers, restore the five old function bodies from fresh release-time backups, then remove the new save function. Preserve the installed confirmation wrapper and privilege boundaries. Never rewrite confirmed financial history.
