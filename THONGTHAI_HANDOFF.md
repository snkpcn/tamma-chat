# Thongthai One-Mind Handoff

Updated: 2026-09-21
Repo: `snkpcn/tamma-chat`
Production: https://tamma-chat.netlify.app/
Existing Supabase only: `tamma-customer-data`

## Current Main Acceptance State

Main has advanced beyond the original expected baseline `2d23b4ee2947cfb6ebf24d9c30f16fe7d728294a` through final One-Mind acceptance hardening and follow-up production smoke fixes.

Latest verified local main before this handoff restore: `40e15d0cc247e1ac7cad6e737b75faf53db0657b`.
This handoff restore commit is intended to retrigger Netlify so production deploys the current main state and stops serving the older `fd0a72c...` deploy.

## Test Evidence

Full local suite on current main code path: `npm test` passes `530/530`, `0` failed.

The suite covers:
- canonical activity conversation continuity
- side questions during active tasks
- topic switch and resume
- correction semantics such as `60 นาที` -> `จริงๆ 90 นาที`
- no hallucinated horse temperament
- no transaction execution from One-Mind read/compose paths
- deterministic zero-paid-LLM behavior under provider outage
- Gemini/OpenAI provider availability and circuit-breaker behavior
- Web/LINE shared One-Mind state rules and transport-only LINE adapter boundaries
- restaurant/promotion/stay/OTOP/cafe/membership read-only routing
- stale task TTL behavior so old tasks do not hijack unrelated future turns

## Fixes Already In Main

- Broad discovery and activity catalog follow-ups stay deterministic under One-Mind cutover.
- Activity side questions no longer get swallowed by missing-field booking prompts.
- Horse selection and requested time survive follow-ups.
- Unknown temperament/beginner suitability is reported honestly; no invented comparison.
- Restaurant advisor follows server-side context, not only client `chatHistory`.
- Restaurant party/budget replies do not become premature pickup-field prompts.
- Pending restaurant preorder side questions such as price/menu/promo no longer re-render the missing pickup-time prompt.
- Promotion discovery is read-only and deterministic from live promotion facts.
- Membership signup information has deterministic copy and does not fall into provider-unavailable apology.
- Grounded response wording avoids raw database-style phrases such as `ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้ครับ`.
- OpenAI paid fallback remains optional; zero-cost deterministic paths handle supported business flows when providers are unavailable.
- Temporary Phase P diagnostic endpoint/token/build artifacts were removed; only historical comments/tests mention the diagnostic investigation.

## Deployment Requirement

After this commit reaches GitHub main:

1. Allow or trigger one Netlify production deploy for `tamma-chat`.
2. Verify Netlify production `commit_ref` equals the latest GitHub main SHA.
3. Rerun concise production smoke through the real gateway using UUID guest/session identities.
4. Do not create real bookings/orders/payments/redemptions.

If Netlify production remains on an older commit, the code may be green but production is not accepted.

## Required Production Smoke

Activity:
1. `มีไรทำมั่ง`
2. `ม้าล่ะ`
3. `มีม้ากี่ตัว`
4. `ตัวไหนนิสัยดีกว่า`
5. `เอาภาราดร`
6. `บ่ายสามได้ปะ`
7. `จะขี่ม้าไง`
8. `มีราคาเท่าไร`
9. `ร้านมีไรกิน`
10. `กลับมาจองม้าต่อ`
11. `60 นาที`
12. `จริงๆ 90 นาที`

Restaurant:
- `ร้านมีไรกิน`
- `มากันสองคน งบ 500`
- `ไม่กินหมู`
- `เอาชุดเมื่อกี้`
- `มีอะไรเผ็ดน้อยๆไหม`
- `ราคาเท่าไร`
- `มีโปรด้วยไหม`

Other read-only domains:
- Stay: `มีห้องพรุ่งนี้ไหม`, `เช็คอินกี่โมง`, `เช็คเอาท์ล่ะ`, `มี room service ไหม`
- Promotion: repeated `มีโปรอะไร`
- Membership: `สมัครสมาชิกยังไง`, `เช็คสถานะสมาชิกได้ไหม`
- OTOP: `มีของฝากอะไรบ้าง`, `อันไหนดี`, `ราคาเท่าไร`
- Cafe: `มีลาเต้ไหม`, `ร้านเปิดกี่โมง`
- Ecosystem: `มีไรทำมั้ง`, `แถวนี้ทำไรดี`, `พาแฟนมา มีไรแนะนำ`, `มาครั้งแรกแนะนำหน่อย`

## Expected Acceptance Properties

- No repeated unrelated missing-field prompt.
- Active task does not hijack side questions.
- Topic switch suspends the task and resume restores it.
- Selected horse and requested time survive.
- Corrections overwrite prior slot values instead of appending.
- `REQUESTED` is not called `CONFIRMED`.
- No unsupported fact is invented.
- No real transaction is executed during UAT.
- Supported zero-cost flows do not collapse into generic provider outage copy.
- Web and LINE use the same One-Mind semantics/state rules.

## Remaining Data Gaps

Owner should fill these later in authoritative data/backoffice, not code hardcoding:

- Horse temperament.
- Beginner suitability.
- Horse age.
- Horse sex.
- Horse size.
- Max rider weight.
- Horse notes.
- Operational status.
- Final activity prices/durations where not populated or not wired.
- Stay policies as authoritative One-Mind facts: check-in <= 14:00, check-out <= 12:00, room service 10:00-22:00, final confirmation by LINE/email/phone.
- Cafe/Inthanin menu and hours source-of-truth.
- OTOP product recommendations/prices where missing.

## Current Acceptance Gate

Ready for normal customer beta traffic only after Netlify production deploy SHA matches GitHub main and the concise production smoke above passes against production. Until then, main is test-green but production acceptance is pending deploy verification.


## 2026-09-22 Emergency LINE Rollback Checkpoint

- Commit `ee2a31563d091c2810d0eb90b02be0667e7ede54` was deployed to production at approximately 17:32 Asia/Bangkok.
- LINE was verified replying before that deploy (17:06) and then stopped replying after it (18:02 onward), including to a generic `ฮัลโหล` message.
- Netlify environment variables for LINE and Supabase remained present, and the deploy itself reported ready, so this was treated as a production runtime regression introduced by `ee2a315`, not an environment-loss incident.
- Emergency rollback commit `1a48a83dd1cbd2f560f1d153630fcec71f12bc50` restores the exact prior tree from `bc3a5c978513baf4e66c4210fcd8c4e77f55740c` while preserving Git history.
- Do NOT reintroduce the `ee2a315` cross-system fallback directly on production until the LINE runtime path is isolated and production-smoked.
- Next acceptance gate: production deploy must point to the rollback tree and LINE must reply to a generic greeting before any activity-booking retest.


## 2026-09-22 One-Mind Architecture Consolidation Audit

Branch: `feature/thongthai-one-mind-architecture`.
This section supersedes nothing above; it is additive audit + decision
record from a dedicated consolidation pass, done with **no Netlify access,
no deploy, and no production DB mutation** (read-only `execute_sql` against
`tamma-customer-data` was used to verify real trigger wiring — see below).

### A. Scope actually completed this pass

Given the explicit "DO NOT DEPLOY" constraint and the fact that a previous,
well-tested (564/564 passing), narrowly-scoped change (`ee2a315`) still
caused a real production outage in a way that was **not reproducible** even
by bundling the exact regressed commit with esbuild (Netlify's own bundler)
and invoking the handler directly against a synthetic LINE event (see
Finding 1 below) — this pass prioritized **audit depth and one safe,
verified cleanup** over further speculative runtime changes. Attempting a
second large state-consolidation change without any way to validate it
against real production traffic would repeat the exact mistake that caused
the rollback. What follows is a real, code-verified (not assumed)
architecture map, a set of concrete findings, a canonical-architecture
decision, and an explicit, narrow next task for whoever picks this up next
(a careful, incremental, production-observed change — not a rewrite).

### B. Root architectural problems found (verified in code, not inferred)

1. **LINE's fallback to the shared brain is an HTTP self-fetch, not a
   function call.** `_line-webhook-core.ts`'s `askThongthai()` does
   `fetch(siteBaseUrl() + '/.netlify/functions/thongthai-chat')` — a live
   HTTP round-trip from one Netlify Function to another on the *same site*.
   `reinforceStructuredMemory()` adds two more self-fetches (load + save) to
   `/.netlify/functions/customer-memory`. So a single LINE message that
   isn't caught by membership/legacy-booking can cost **up to 4 sequential
   HTTP round-trips to the site's own serverless functions** before a reply
   is sent, each with its own cold-start/latency/egress risk. This is
   exactly the "fetch recursion to the site's own functions" class of risk
   called out as a runtime-safety concern, and it is the most plausible
   structural explanation available for the `ee2a315` incident's symptom
   (LINE silent to *every* message, including a plain `ฮัลโหล`, which routes
   through this exact self-fetch since it hits neither membership nor
   legacy booking): a heavier import graph from `ee2a315`'s two added
   imports could plausibly have pushed cold-start time enough to affect this
   already-fragile multi-hop path. This is **not proven** (no production
   logs were available to confirm it), but it is a real, demonstrable
   structural fragility independent of whether it was the specific cause,
   and it directly blocks the brief's own target architecture (LINE and Web
   should call the *same* canonical brain, not one over HTTP and one
   in-process).
   - Reproduction attempted: checked out `ee2a315` in a worktree, bundled
     `line-webhook.ts` with the repo's own esbuild (`node_bundler = "esbuild"`
     per `netlify.toml`), `require()`d the bundle, and invoked `handler()`
     with a synthetic signed `ฮัลโหล` event. The bundle loaded cleanly and
     the handler resolved (`200 OK`) even with fake Supabase/LINE endpoints
     — no import-time throw, no circular-import breakage. This rules out a
     simple synchronous crash as the cause and points toward a
     latency/timeout-class failure instead, which is consistent with
     Finding 1's self-fetch chain but can't be proven without production
     logs this sandbox cannot reach.

2. **Two non-communicating state stores for the same activity-booking
   conversation.** `booking_sessions` (legacy, LINE-only, the *only* path
   that calls `createBooking` from LINE) and `guest_agent_state.state.
   taskState` (One-Mind's `ActiveTask`, which by design never executes a
   transaction). A per-message regex-based gate
   (`shouldConsumeLegacyLineBookingTurn`) decides turn-by-turn which one
   answers, so a slot collected by one is invisible to the other. This is
   the root cause behind the original bug report this session started from,
   and `ee2a315` was a first attempt at bridging it that caused the
   rollback. **Not re-attempted this pass** — see section H for why and
   what the safe path looks like.

3. **Duplicate runtime module, now removed.** `_thongthai-runtime.ts` was a
   fully superseded predecessor of `_thongthai-runtime-v3.ts` (same four
   functions re-implemented), kept alive only by one straggler import
   (`line-link.ts`'s `mergeBrainGuestData`). Migrated and deleted this pass
   — see section E.

4. **A real split-brain bug was hiding in that dead file.**
   `mergeBrainGuestData` wrote `guest_agent_state` with a raw
   `?on_conflict=guest_id` upsert instead of going through
   `patchGuestAgentState` (the shared CAS store that exists specifically
   because `conversationContext`/`taskState`/legacy-brain state are sibling
   keys in one JSONB column). An account-merge racing a customer's in-flight
   conversation could silently drop their active task. The codebase's own
   structural test for this (`g2-concurrency-and-cutover.test.ts`) only
   scanned 3 files and never covered the now-deleted file, so this was
   invisible until the migration surfaced it. Fixed this pass.

5. **Restaurant preorder staff notification is wired differently from
   booking/OTOP notification**, verified directly against the live
   `tamma-customer-data` schema (read-only `execute_sql`, no mutation):
   - `bookings` → notified via a genuine DB trigger chain:
     `booking_allocations` INSERT → `enqueue_tamma_ops_notification()` →
     `net.http_post` to `https://tamma-chat.netlify.app/.netlify/functions/
     ops-notify` with a Vault-stored secret. Fully channel-independent —
     fires even if a booking is created by something this repo doesn't
     know about (e.g. a future admin tool, or the Backoffice directly).
   - `otop_orders` → same pattern, via `otop_order_items` INSERT.
   - `cafe_inquiries` → same pattern, direct table INSERT trigger.
   - `restaurant_preorders` → **no DB trigger at all.** Notification is an
     explicit call, `await notifyRestaurantPreorderTeam(created.id)`, made
     *inside* `_restaurant-sot.ts`'s `createRestaurantPreorder`/
     `createRestaurantPreorderWithPromotion` (the shared creation functions
     both channels call through, so this is not channel-specific
     duplication) — but unlike the other three entities, a restaurant
     preorder row created any other way (direct SQL, a future admin path)
     would get **no automatic staff notification**, because the trigger
     doesn't exist. This is a real, verifiable inconsistency, not a
     hypothesis. See section K for the exact SQL used to verify this.

6. **`87601b0` (the branch's one pre-existing commit, "Fix active activity
   inventory side-question routing") was reviewed and is genuinely
   structural, not a symptom patch** — it recognizes an entire Thai
   grammatical category ("how many X" — กี่ตัว/กี่คัน/กี่ชุด/กี่อัน/กี่รายการ,
   จำนวนเท่าไร, มีกี่) via `isInventoryCountQuestion`, not a hardcoded phrase,
   and is properly tested at both the semantic-derivation and dialog-manager
   layers. **Verdict: KEEP.**

### C. What was canonical before this pass (verified, not assumed)

- **The single transaction executor for bookings across both channels is
  already unified**: `_operations-db.ts::createBooking` is the only
  `createBooking` definition in the codebase. Both LINE's legacy
  `handleLineBookingMessage` and the web/One-Mind-fallback path
  (`thongthai-chat.ts`'s `executeDeterministicActivityBooking` →
  `_thongthai-runtime-v3.ts`'s `executeBrainTools`'s `create_booking` case)
  call it. It already has a real idempotency guard (a 2-minute
  guest+resource+start_at dedup window) with a code comment explicitly
  documenting *why* — the LINE self-fetch retry-on-any-failure pattern in
  Finding 1 could otherwise double-book on a retry after a successful
  write. This is good, already-correct architecture; nothing needed here.
- The asset/name lexicon (`ACTIVITY_ASSET_SELECTIONS`,
  `findKnownActivityAssetSelection`/`activityAssetFromText`) is already a
  single shared source of truth reused by LINE-legacy, web-deterministic-
  fallback, and One-Mind alike. Good.
- `patchGuestAgentState` (the CAS store) is the correct, already-existing
  single-writer primitive for the shared JSONB state column; the bug in
  Finding 4 was a caller bypassing it, not a gap in the primitive itself.
- Booking/OTOP/cafe staff notification is already correctly DB-trigger-
  driven and channel-independent (Finding 5's good half).

### D. Files changed this pass

- `netlify/functions/_thongthai-runtime-v3.ts` — added `mergeBrainGuestData`
  (migrated, and fixed to use `patchGuestAgentState` instead of a raw
  upsert).
- `netlify/functions/line-link.ts` — import updated to `./_thongthai-runtime-v3`.
- `tests/g2-concurrency-and-cutover.test.ts` — 3 new regression tests (dead
  file actually deleted, merge writer uses the CAS store, import points at
  the canonical module).

### E. Files deleted this pass

- `netlify/functions/_thongthai-runtime.ts` (fully superseded, confirmed
  zero remaining callers before deletion via repo-wide grep).

### F. Tests added this pass

3 tests in `tests/g2-concurrency-and-cutover.test.ts` (see D). Full suite:
**558/558 passing, 0 failed**, immediately after this change (grew to
558 from the 555 baseline on `main` post-rollback: +3 new).

### G. Canonical architecture decision (Phase 3/4/6 conclusion)

| Component | Classification | Why |
|---|---|---|
| `_operations-db.ts::createBooking` | **A. Canonical** | Single implementation, both channels call it, already idempotent. |
| `_task-state.ts` (`ActiveTask`/CAS-backed `taskState`) | **A. Canonical for conversational slot state** | Correct model; just not yet the sole one for LINE's activity flow. |
| `patchGuestAgentState` (`_guest-agent-state-store.ts`) | **A. Canonical** | Correct CAS primitive; enforce it has zero exceptions (Finding 4 closed the one found). |
| `_deterministic-semantic-turn.ts` / `_dialog-manager.ts` | **A. Canonical for semantic interpretation + dialog policy** | Well-tested, structural (not phrase-table) design; `87601b0` fits this cleanly. |
| `handleLineBookingMessage` / `booking_sessions` (LEGACY) | **B. Keep temporarily as adapter, one-directional migration target** | Still the only thing that can execute a LINE transaction today; must not be ripped out until One-Mind can execute directly (see H). Its own slot parsers should keep delegating to `_slot-parsers.ts` (already done for dates this session) rather than growing a second lexicon. |
| `thongthai-chat.ts`'s deterministic fallbacks (`activityBookingFallbackResponse`, `deterministicRestaurantResponse`, `restaurantPreorderDialogResponse`, `promotionContinuationResponse`, etc.) | **B. Keep temporarily as adapter/fallback tier** | These are a legitimate strangler-fig fallback chain (deterministic-early → One-Mind-cutover-read-only → legacy paid-LLM brain → domain-specific deterministic fallback), not duplicated business logic — they all still terminate in the same `createBooking`/`createRestaurantPreorder`/etc. Consolidation risk is real but this pass found no evidence they disagree with each other's slot values (they share `_slot-parsers.ts`/`_operations-db.ts` lexicons). Flatten only after One-Mind's own coverage is proven wide enough to retire tiers one at a time, never all at once. |
| `_thongthai-runtime.ts` | **D. Deleted** | Confirmed fully superseded, zero real callers after migration. |
| `mergeBrainGuestData`'s raw-upsert pattern | **E. Repaired** | Now goes through the CAS store. |
| LINE's HTTP-self-fetch to `thongthai-chat`/`customer-memory` | **E. Needs repair, NOT done this pass** | Should become a direct in-process call once it's safe to verify (see H) — this is the single highest-leverage change left, but also the one most directly implicated in the last production incident, so it must not be attempted blind. |

### H. Exact next task (do this next, carefully)

**Do NOT re-attempt a broad state-bridging change blind.** The next task,
in order:

1. **First**, convert LINE's `askThongthai()`/`reinforceStructuredMemory()`
   self-fetches in `_line-webhook-core.ts` into direct in-process calls to
   `thongthai-chat.ts`'s handler logic (extract its core into a plain
   function both the HTTP handler and `_line-webhook-core.ts` can call,
   the same shape `_line-webhook-core.ts` already uses for
   `handleLineBookingMessage`/`handleLineMembershipMessage`). This removes
   a real, verified structural risk (Finding 1) on its own, independent of
   the state-merge problem, and is lower-risk than bridging state because
   it changes *how* a call is made, not *what* data flows through it. Add a
   structural test asserting `_line-webhook-core.ts` never calls `fetch`
   against its own site's `/.netlify/functions/` paths.
2. **Only after (1) is merged and the owner has confirmed a normal LINE
   greeting still replies in production**, re-attempt the
   `booking_sessions` ↔ `taskState` fallback from `ee2a315`, but redesigned
   to avoid adding a network round-trip to the reply-critical path — e.g.
   have `_dialog-manager.ts` write One-Mind's collected activity slots
   *into the same `booking_sessions` row* (via the existing
   `special_request` marker mechanism `activitySessionMarker`/
   `formatActivityAssetNote` already used for this) the moment a session
   exists, rather than having the legacy flow make an extra live
   `loadTaskState` fetch on every turn. That keeps the fix a pure read of
   data the legacy flow already fetches, with zero new I/O.
3. Restaurant preorder notification (Finding 5): either add a DB trigger
   on `restaurant_preorders` matching the `bookings`/`otop_orders` pattern
   (preferred, for real channel-independence), or explicitly document why
   the inline call is intentionally different. This is small, low-risk,
   and can be done independently of (1)/(2) — but note it needs a Supabase
   migration, which per the brief's Phase 18 rule requires explicit owner
   authorization before applying to production.
4. The remaining Phase 8-10 stress suites (stay/restaurant/promotion/OTOP/
   membership/cafe multi-turn conversations, Thai fuzzing) were not built
   this pass — they're valuable but were deprioritized in favor of audit
   depth and the one safe fix, given the session's effort budget. The
   existing suite already covers a meaningful subset (see the "Test
   Evidence" section above); treat new stress suites as additive, not
   blocking, on the next session.

### I. What must NOT be reintroduced

- `ee2a315`'s cross-system fallback **exactly as it was written** (the
  extra unconditional `loadTaskState` fetch per activity turn) — not
  because it was logically wrong (its 11 tests were correct), but because
  its *shape* (an added network call on a path already carrying up to 4
  self-fetches) is the structural risk Finding 1 identifies. Redesign per
  H.2 before retrying.
- `_thongthai-runtime.ts` (deleted; a resurrection test now guards this).
- Any raw `guest_agent_state?on_conflict=guest_id` upsert anywhere in the
  codebase (guarded by the existing + newly extended structural test).

### J. Confirmations

- Netlify: untouched. No deploy triggered, no Netlify MCP tool used, no
  Netlify credits spent.
- No real booking, order, payment, or redemption was created.
- No production DB mutation: the two Supabase calls this pass made were
  both read-only (`execute_sql` querying `information_schema.triggers` and
  `pg_proc`), used only to verify the notification-trigger finding in
  section B.5 against ground truth instead of guessing from application
  code alone. No `apply_migration` call was made.
- All work is on `feature/thongthai-one-mind-architecture`; `main` was not
  touched beyond the fast-forward pull already documented above.

### K. Verification queries used (read-only, for reproducibility)

```sql
-- confirms bookings/otop_orders/cafe_inquiries notify via DB trigger,
-- restaurant_preorders does not:
select trigger_name, event_manipulation, event_object_table, action_statement, action_timing
from information_schema.triggers
where event_object_table in ('bookings','restaurant_preorders','otop_orders','cafe_inquiries');

select trigger_name, event_manipulation, event_object_table, action_statement, action_timing
from information_schema.triggers
where event_object_table in ('booking_allocations','otop_order_items','restaurant_preorders','restaurant_preorder_items');

-- confirms the notification trigger function's real dispatch logic:
select pg_get_functiondef(oid) from pg_proc where proname = 'enqueue_tamma_ops_notification';
```

### L. Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 558/558 passing as of commit 9fb198d
git log --oneline -5
```
