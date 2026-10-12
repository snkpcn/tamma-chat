# Employee advance review patch

Review proposal against snkpcn/tamma-chat production commit 910762af1bb548afb326e0ddbcf60a9a3857e049. Source publication and synthetic CI do not apply this schema or authorize production financial writes/deployment.

## Behavior

- A named employee advance opens an owner-only employee card against an explicitly mapped, existing employee. Generic or ambiguous names require selection. No employee records are created by chat.
- The card shows full name/nickname, business or cost center, department/role, payment date and month, funding source, recorded monthly advances, this advance, and a separately labeled projected monthly total.
- Bare “เบิก” asks its type. A unique, explicitly approved private whole-note alias can identify salary advance; purchase/negation exclusions win. No real alias is seeded in source.
- Only the single configured finance approver may operate the employee-advance card. Group membership, another ops admin, a stale revision, and pre-resume callbacks grant no permission.
- Confirmation uses one atomic database operation. Its returned sum is the saved monthly total. A changed employee snapshot or monthly balance requires a fresh card and another confirmation.
- Receiving an image cannot record a salary advance. Reply to the image with “ตรวจสลิป” and resolve document/direction questions. A known approved note opens the employee card directly. Otherwise the visible “เงินเบิกพนักงาน” button opens existing-employee and type choices without requiring another text turn. The button is available on all eligible generic draft views, including the final summary.
- Existing generic drafts and re-reviewed images use the same intake and evidence. Wrong OCR names have an unfiltered employee chooser. Old generic buttons reopen the current employee card rather than posting a generic expense. If reviewed amount/date corrections differ from OCR evidence, conversion stops with both values visible and leaves the draft unchanged.
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
- netlify/functions/_owner-slip-review-ui.ts
- netlify/functions/_owner-document-intent.ts
- netlify/functions/_owner-expense-intake.ts

Database proposal and byte-identical CLI-generated migration, both still unapplied:
- supabase/proposals/owner_employee_advance_v1.sql
- supabase/migrations/20261012063307_owner_employee_advance_v1.sql

Tests:
- tests/owner-employee-advance.test.ts
- tests/owner-employee-advance-migration.test.ts
- tests/owner-staff-slip-natural-thai.test.ts
- tests/financial-cp8-live-owner-payroll.test.ts
- tests/owner-employee-advance-clickthrough.test.ts
- tests/helpers/employee-advance-clickthrough-db.ts
- tests/owner-employee-advance-alias-sql.test.ts

## Data and permission implications

The proposal links payroll rows to existing employee IDs and original intake evidence. It adds scoped employee profiles and an append-only advance audit table, preserves original images/metadata, and excludes a linked intake's expense representation rather than cancelling the actual payment. Funding gains an explicit unknown option. The RPCs remain service-role-only and security-invoker; no client role receives payroll access or new credentials.

Approved aliases carry a separate owner approval reference and profile revision. Stage and confirm recompute the unique active scoped match against the saved source note; changed/removed/ambiguous aliases require a new review. Explicit manual salary selection clears inference provenance. Profile/employee status changes serialize with confirmation.

Employee-to-owner-group and cost-center mappings require explicit review. The existing employee restaurant tenant must not be changed merely to represent shared/central work. Legacy name keys and existing bank-reference collisions require preflight inspection before any migration is approved.

The backoffice import is a separately authorized action with exact source facts, expected revisions, owner approval reference and total. It does not impersonate the LINE actor. No real import payload, employee identity, account detail or private transaction reference is included in this patch or its new fixtures.

## Verification

The previous reviewed commit `97386da52b7054a50ca8761166045bf48da55191` passed whole-repository CI (2,901 tests) and real PostgreSQL 17.11 validation (15 cases, including 12 independent-session races). Those results predate this click-through and approved-alias amendment; they are not a pass for the revised source.

The amendment adds real handler/card postback tests backed by the actual SQL migrations in PGlite. Coverage includes full explicit image-review/direction/capture flow, reopening saved evidence, all generic views including summary, private aliases, manual employee/type selection, ambiguity, purchase escape, stale revisions, unchanged evidence, pre-confirm zero money writes, authoritative totals and uncertain-result retry behavior. Separate exact-schema SQL tests cover alias provenance and concurrency prerequisites. The real multi-session harness includes the new alias/profile races and must run on the exact amended commit after publication is approved.

Focused TypeScript checking still reports the two pre-existing Buffer/BodyInit errors in `_inthanin-daily-close-image.ts` and `_owner-payroll.ts`. This is not a clean whole-repository typecheck. Local card payload checks validate visible controls, labels, revisions and size limits; no live LINE screenshot or live financial posting is claimed.

## Rollout gate

Production migration, production data import and deployment need separate explicit approval. Before rollout: verify the live schema and constraint names, preflight historical duplicates and grants, review the employee mapping, preserve snapshots, and keep the owner-slip route paused. Apply only the approved database migration, then deploy the approved compatible code. Set a fresh resume cutoff before reopening so queued old events cannot commit. Verify with a dedicated synthetic/staging flow and read-only production checks.

## Remaining validation and access gates

The current revised source needs final independent review, whole-repository CI and the expanded real PostgreSQL concurrency run on its exact commit. Standard hosted GitHub CI uses an isolated ephemeral PostgreSQL service, synthetic data, read-only repository permissions and no production secrets; it does not need a paid Supabase branch.

Production is still held pending supported access that can verify the intake pause, followed by installed-schema checks, paired deployment and a fresh resume cutoff. This repository contains no production import payload and no authorization to infer or post new payments. Source tests alone do not establish live LINE behavior.

## Rollback

Pause this feature first. Do not roll back to a build that restores automatic salary-advance posting on image receipt. Preserve the no-auto-advance guards even if the card feature is disabled. Do not drop populated columns/tables or erase audit/history. Financial corrections use the audited, expected-revision compensation operation after explicit approval; it changes bookkeeping only, preserves the payment evidence, and does not reverse a bank transfer. Reconcile downstream payroll deductions before any financial reversal.
