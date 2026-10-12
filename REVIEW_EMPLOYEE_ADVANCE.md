# Employee advance review patch

Review proposal against snkpcn/tamma-chat production commit 910762af1bb548afb326e0ddbcf60a9a3857e049. Source publication and synthetic CI do not apply this schema or authorize production financial writes/deployment.

## Behavior

- A named employee advance opens an owner-only employee card against an explicitly mapped, existing employee. Generic or ambiguous names require selection. No employee records are created by chat.
- The card shows full name/nickname, business or cost center, department/role, payment date and month, funding source, recorded monthly advances, this advance, and a separately labeled projected monthly total.
- Bare “เบิก” asks whether this is salary advance. It never assumes a purchase or a salary payment.
- Only the single configured finance approver may operate the employee-advance card. Group membership, another ops admin, a stale revision, and pre-resume callbacks grant no permission.
- Confirmation uses one atomic database operation. Its returned sum is the saved monthly total. A changed employee snapshot or monthly balance requires a fresh card and another confirmation.
- Receiving an image cannot record a salary advance. Existing automatic advance text/attachment routes are blocked. The supported intake is to send an image, reply to that image with “ตรวจสลิป”, then identify the employee/type.
- Quotes, unpaid documents, incoming funds, multiple slips, unclear payment dates and unreadable evidence cannot become salary payments.
- Salary advances cannot become ordinary expenses or investment entries through the generic card. Explicit purchase corrections return to the existing review flow without writing money.
- Unknown funding remains “unknown”. Payroll totals do not imply net salary, and no bank transfer is performed.

## Scope

New runtime modules:
- netlify/functions/_owner-employee-advance.ts
- netlify/functions/_owner-employee-advance-card.ts

Integration and safety changes:
- netlify/functions/line-webhook.ts
- netlify/functions/_owner-payroll.ts
- netlify/functions/_owner-slip-review.ts
- netlify/functions/_owner-slip-cards.ts
- netlify/functions/_owner-slip-maintenance.ts

Database proposal, not an applied migration:
- supabase/proposals/owner_employee_advance_v1.sql

Tests:
- tests/owner-employee-advance.test.ts
- tests/owner-employee-advance-migration.test.ts
- tests/owner-staff-slip-natural-thai.test.ts
- tests/financial-cp8-live-owner-payroll.test.ts

## Data and permission implications

The proposal links payroll rows to existing employee IDs and original intake evidence. It adds scoped employee profiles and an append-only advance audit table, preserves original images/metadata, and excludes a linked intake's expense representation rather than cancelling the actual payment. Funding gains an explicit unknown option. The RPCs remain service-role-only and security-invoker; no client role receives payroll access or new credentials.

Employee-to-owner-group and cost-center mappings require explicit review. The existing employee restaurant tenant must not be changed merely to represent shared/central work. Legacy name keys and existing bank-reference collisions require preflight inspection before any migration is approved.

The backoffice import is a separately authorized action with exact source facts, expected revisions, owner approval reference and total. It does not impersonate the LINE actor. No real import payload, employee identity, account detail or private transaction reference is included in this patch or its new fixtures.

## Verification

- Pre-change relevant baseline: 181 tests passed.
- New TypeScript card/handler tests: 37 passed. Final combined runtime rerun after generic owner-label cleanup: 157/157 passed.
- Updated legacy payroll/staff suites: 120 tests passed.
- Synthetic SQL proposal tests: 20/20 passed. Five independent database scenarios also passed.
- Real TypeScript-to-synthetic-SQL probes cover changing affiliation, deactivated mappings, a name/role race between lookup and staging, and purchase corrections.
- TypeScript checking reports two pre-existing Buffer/BodyInit errors. Current output matches the baseline exactly; no new type errors were found. This is not a clean whole-repository typecheck.
- Aggregate across all tests available in this focused checkout: 355/355 passed with zero skips. This is a subset of the repository, not the whole hosted suite. Later SQL and runtime checks above cover the final small changes.
- Card payload JSON and a synthetic HTML preview are under evidence/preview/. These are local simulations of LINE Flex cards. Chromium screenshot rendering was blocked by local socket restrictions; no live LINE screenshot or screenshot validation is claimed.

## Rollout gate

Production migration, production data import and deployment need separate explicit approval. Before rollout: verify the live schema and constraint names, preflight historical duplicates and grants, review the employee mapping, preserve snapshots, and keep the owner-slip route paused. Apply only the approved database migration, then deploy the approved compatible code. Set a fresh resume cutoff before reopening so queued old events cannot commit. Verify with a dedicated synthetic/staging flow and read-only production checks.

## Remaining validation blocker

Read-only discovery found only the production Supabase project and no development branches. This executor has no configured non-production PostgreSQL connection. A previous local PostgreSQL socket restriction was not retried or bypassed. No new service or credential was created.

Use a separately authorized non-production PostgreSQL 17 or Supabase branch, reproduce the actual deployed schema/roles/functions/triggers with synthetic rows only, apply this proposal there, and run independent simultaneous transactions for: same slip; different slips for one employee/month; old payroll writer versus new confirmer; payroll versus generic expense/investment; stale profile/revision; and atomic batch rollback. Then run full repository CI. The local result does not establish live-schema compatibility or multi-session race behavior. Test-environment authorization, production migration/deployment approval, and approval to import actual advances are distinct gates.

## Rollback

Pause this feature first. Do not roll back to a build that restores automatic salary-advance posting on image receipt. Preserve the no-auto-advance guards even if the card feature is disabled. Do not drop populated columns/tables or erase audit/history. Financial corrections use the audited, expected-revision compensation operation after explicit approval; it changes bookkeeping only, preserves the payment evidence, and does not reverse a bank transfer. Reconcile downstream payroll deductions before any financial reversal.
