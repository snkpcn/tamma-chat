# Owner slip notes and confirmation

Review branch: `codex/owner-slip-note-confirmation`
Base: `snkpcn/tamma-chat` main `25229202e5f7c36e7316436073234a4d7ee61766` (PR #616).

## Behavior

New Owner-group images use the existing private evidence bucket and expense inbox. OCR transcribes the visible payment memo/bottom annotation separately from model diagnostics. The proposal reads existing group-scoped projects and installments, normalizes hyphens/spaces in names (including ตำมาชาติ / ตำมา-ชาติ), and never creates a project, task, budget, or installment. Separate mentions of both a project and its named extension remain ambiguous.

A draft contains the note, amount, date, business, category, project and installment. Only missing/ambiguous facts are asked for. The owner confirms a particular slip and revision, e.g. `ยืนยัน #ABC123 v1`. Corrections create a new revision; an old confirmation cannot approve it. `ยกเลิก #ABC123` cancels the draft. Multiple pending slips require one explicit reference; a collage of multiple slips must be sent as separate images. A note with several expense categories asks for clarification instead of allocating the entire amount to the first category.

Evidence and review metadata persist before confirmation so retries and corrections survive process restarts. Financial classification, project links and installment payments persist only in the confirmation transaction. Draft `amount` is NULL, with the read amount retained in extraction/review JSON; this excludes drafts from both the summary view and the existing backoffice API's raw-row totals. The existing backoffice page calls a NULL amount “อ่านไม่ชัด”; the actual amount and approval summary are shown in LINE. This change does not add a backoffice approval UI.

Older inbox rows retain their previous workflow. Unclassified new uploads can hand off to the existing employee-advance workflow; handoff restores the extracted amount to the legacy inbox but does not itself create an expense or payroll event. New business slip review does not use that handoff once it has a purpose or project.

The database serializes capture/confirmation within the owner group, checks image/message/reference duplicates, locks the intake, validates the current project/task/installment, and commits allocation plus audit together. Repeated confirmation does not add an installment payment. NULL revision/action inputs fail closed. Reference matching is conservative within a group: a collision blocks a second record. All new RPCs are service-role-only. A trigger rejects financial allocation or amount changes by older routes while a slip remains a draft.

Authorization follows the existing signed LINE webhook and `owner_general` group binding, and additionally requires the original slip sender for review mutations. This does not introduce an independent owner-user allowlist. OCR notes are data, never executable commands or confirmation authorization.

## Verification

Verified with Node 20.19.0, exact `package-lock.json` dependencies installed using `npm ci`, TypeScript 5.9.3 and @types/node 20.19.43. Run `npm test`: 2,653 tests passed, zero failed/skipped. The LINE function also bundles successfully with esbuild. No dependency manifests or lockfiles changed. Native bundling stalled under protected Documents on this Mac, so verification ran from an equivalent disposable source copy under `/tmp/thongthai-node20-verification`.

The 22 tests in `tests/owner-slip-review.test.ts` cover note normalization, existing-project aliases, incomplete/ambiguous notes, corrected amounts, stale/repeated confirmation, actor/group isolation, invalid LINE signature, image/reference duplicates, replayed corrections, cancellation, multiple slips, collage separation, invalid dates, repeated installment numbers, rollback after a late failure, payroll handoff and slip-note instruction injection. PGlite executes the new migration after two existing relevant migrations, with scaffolding for unrelated investment/storage dependencies. This is not a full production migration-chain replay. Promise.all capture/confirmation tests use one PGlite session; they do not prove PostgreSQL cross-session locking.

The actual `snkpcn/tamma-backoffice` owner-expenses API/page source was tested locally with mocked owner authentication and a fixture REST adapter over PGlite. API totals were 0 before confirmation, 1,000 after confirmation and 1,000 after repetition. Chrome on the Mac displayed the corresponding before/after states. No authenticated production browser workflow was exercised and no backoffice repository files were edited.

A real offline Tesseract `tha+eng` run on a non-sensitive synthetic slip read the English amount/date/reference and Thai bottom note, but inserted spaces between Thai characters. This is surrogate OCR evidence, not a test of the production Gemini/OpenAI extraction path. Automated application tests use fixture OCR responses. Production OCR was not run because provider keys were unavailable; no keys were requested or created.

An ad hoc TypeScript check reports two pre-existing Buffer/BodyInit TS2769 errors in `_inthanin-daily-close-image.ts` and `_owner-payroll.ts`. Both reproduce at the exact base commit with identical Node 20 dependencies; normalized diagnostics are identical. Those unrelated errors remain unchanged.

## Migration and release prerequisites

### Investment-direction acceptance update (2026-10-11)

The anonymized carpenter-equipment case uses amount 3,540, date 2026-10-10, memo `อุปกรณ์ช่างไม้`, and a synthetic reference. These are manually transcribed acceptance inputs, not a live OCR result. The memo supplies the purpose; only the missing existing project is requested. The owner's subsequent `หน่วยการลงทุน` direction is retained in this draft and shown explicitly as the destination. An explicit operating-expense correction is supported, and contradictory directions require clarification. No carpenter-specific global classification rule was added; the pre-existing equipment classifier remains unchanged.

The existing backoffice investment module already includes `capital_investment` owner slips as source kind `slip`, linking them via the same `owner_project_id` and optional task/installment fields. Confirmation therefore uses the existing owner-slip ledger record, never a second manual investment entry. The regression asserts an unchanged zero total before confirmation, one 3,540 allocation after confirmation, reference deduplication and repeated-confirmation idempotence. An independent backoffice regression checks one displayed slip and one project total. The selected project and empty installment catalogue in these tests are synthetic fixtures, not assertions about the owner's actual project.

Current release evidence and limitations superseding the historical verification notes above are recorded in `../review-evidence/CARPENTER_RELEASE_READINESS.md` in the task workspace. No provider call or production mutation was made for this acceptance case.

The additive migration `20261011052544_owner_slip_review_v1.sql` adds four review columns to the existing intake table, creates review RPCs and a guard trigger, and replaces the summary view to omit review drafts. Existing rows retain NULL review state and their previous behavior; no new database/app is created and no historical financial amounts are rewritten. New capture clears its own draft amount atomically; confirmation fills it atomically.

1. Review this diff and recheck latest main for overlapping Owner changes. Other task source copies under `2026-10-11/new-chat` were inspected and left untouched; this branch includes merged PR #616.
2. Apply the migration to an isolated staging database with the full existing migration chain. Verify real PostgREST permissions/relationship lookup, database advisors, and simultaneous capture/confirmation from independent PostgreSQL sessions. These were not run locally.
3. Run normal CI. The local Node 20/npm-lockfile suite and bundle pass; the two base TypeScript errors are documented separately.
4. Perform a staging OCR smoke test with representative redacted slips, including handwritten bottom notes, and authenticated backoffice/LINE approval flow. Verify authorized owner group membership and sender identity. Actual provider OCR and authenticated end-to-end delivery remain untested.
5. Obtain owner approval before merge/deploy. Apply schema before backend deployment because new code queries review columns. If code is rolled back, retain the migration/guard: existing drafts must not be allocated through an old path.

No push, PR, merge, deployment, live database migration, or live financial update was performed. No personal LINE transport or SNK personal-finance code was changed.
