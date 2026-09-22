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

### L. Commands the next agent/session should run first (superseded by the section below; kept for history)

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 558/558 passing as of commit 9fb198d
git log --oneline -5
```

## 2026-09-22 Priority 1 Checkpoint — LINE Self-Fetch Removed

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `d60cde3`.
Working tree: clean, pushed.

### What changed

`netlify/functions/thongthai-chat.ts`'s handler body was mechanically
extracted into a new exported plain function,
`processThongthaiChatCore(request: BrainRequest, eventId: string | null):
Promise<{statusCode: number; payload: Record<string, unknown>}>`. The HTTP
`handler` export is now a thin wrapper: parse JSON → `normalizeRequest` →
call the core → wrap the result as an HTTP response. Every internal
`return json(X, Y)` became `return coreResult(X, Y)`; zero business logic
changed (verified line-by-line via `git diff` and the full test suite).

`netlify/functions/_line-webhook-core.ts` now calls
`processThongthaiChatCore` **directly, in-process** (a live ES module
import from `./thongthai-chat` — the exact same function object the web
HTTP handler calls, not a re-implementation) instead of HTTP-fetching
`/.netlify/functions/thongthai-chat`. Its `reinforceStructuredMemory`
similarly now calls `_customer-db.ts`'s `loadCustomerMemory`/
`persistCustomerSnapshot` directly instead of HTTP-fetching
`/.netlify/functions/customer-memory` (mirroring that handler's own
two-call pattern exactly, so behavior is unchanged). The dead
`siteBaseUrl()`/`THONGTHAI_ENDPOINT`/`CUSTOMER_MEMORY_ENDPOINT` were
removed.

**Retry/fallback semantics are fully preserved**: `askThongthaiReliably`
still throws-and-retries on a non-2xx core result exactly as it threw on
a non-2xx HTTP response before.

### How this was verified (no production access)

1. Full test suite: 563/563 passing (558 baseline + 5 new).
2. Import-graph trace: confirmed `thongthai-chat.ts`'s full import closure
   (3 levels deep) never reaches back to `_line-webhook-core.ts` — no
   circular import.
3. **Real dynamic import test** (not just source grep) — both files loaded
   via actual tsx module resolution with zero env vars set; proves no
   import-time throw anywhere in either file's closure.
4. **esbuild bundle test** — bundled the real `line-webhook.ts` entry point
   with the repo's own esbuild (matching `netlify.toml`'s
   `node_bundler = "esbuild"`), then `require()`'d the bundle and invoked
   `handler()` with a synthetic signed LINE `ฮัลโหล` event end-to-end. The
   stack trace confirms `askThongthai` calls `processThongthaiChatCore`
   **synchronously in the same call stack** (no network hop), the existing
   provider-unavailable retry-then-fallback path fired exactly as
   designed, and the handler resolved cleanly (`200 OK`). The only
   failures logged were this sandbox's own missing API keys/blocked
   egress to `api.line.me` — not any code defect. Bundle size grew from
   ~322kb (LINE webhook alone) to ~707kb (now also carrying the full
   brain/One-Mind dependency graph inline) — still trivially within
   Netlify Function size limits; noted as an honest trade-off (less
   network-dependent latency risk, larger single bundle) with no observed
   downside.
5. Fixed one stale test (`phase-n-legacy-cleanup.test.ts`) that asserted
   the OLD self-fetch pattern (`THONGTHAI_ENDPOINT` must appear in the
   file) — updated to assert the new invariant (`processThongthaiChatCore`
   imported/called; neither self-fetch endpoint string present).

### Remaining self-fetch-shaped risk, explicitly NOT yet touched

`_line-webhook-core.ts`'s `LINE_REPLY_ENDPOINT` fetch to `api.line.me` and
`_ops-notifications.ts`/`_operations-db.ts`'s Supabase `dbFetch` calls are
genuine external-service calls, not self-fetches — out of scope for this
priority and untouched.

### Definition-of-done items this closes

Item 1 ("LINE no longer self-fetches its own site") and item 2 ("Web and
LINE share one canonical brain invocation") from the owner's Definition of
Done are now true, as far as offline/CI verification can prove (see
Priority 1's required "FINAL PRODUCTION ACCEPTANCE GATES" note below).

### Next step

Priority 2: eliminate the `booking_sessions`/`taskState` split-brain, per
section H.2 of the prior audit — now unblocked, since the self-fetch risk
that made a prior attempt (`ee2a315`) unsafe to reason about is resolved.
Redesign per H.2: write One-Mind's collected activity slots into the
*same* `booking_sessions` row via the existing `special_request` marker
mechanism, rather than an extra live `loadTaskState` fetch per turn.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 563/563 passing as of commit d60cde3
git log --oneline -8
```

### FINAL PRODUCTION ACCEPTANCE GATES (accumulating — not a reason to deploy now)

- Netlify production deploy SHA must match this branch's merge commit
  before any of this is live.
- A real LINE greeting must be confirmed replying in production (the exact
  check that failed after `ee2a315`) before any further activity-booking
  production retest.
- Live LINE smoke test of the full required conversation sequence.
These require the owner's explicit go-ahead for ONE deploy; nothing above
was performed against production.

## 2026-09-22 Priority 2 Checkpoint — Booking Split-Brain Eliminated

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `b41911c`.
Working tree: clean, pushed. Full suite: **580/580 passing**.

### Design: one-directional ownership, redesigned from ee2a315

`guest_agent_state.state.taskState` is canonical for a customer's activity-
booking conversation. `booking_sessions` is a passive execution adapter:
still the only thing `handleLineBookingMessage` (`_operations-db.ts`) can
use to actually execute a real LINE booking, but it no longer independently
interprets customer intent once One-Mind has an activity_booking task for
that guest.

**The critical redesign vs. `ee2a315`**: that attempt added a live
`loadTaskState` fetch to the LEGACY flow's own reply-critical hot path on
every turn — extra I/O on the path most exposed to latency, and (per
Priority 1's finding) the most plausible structural contributor to the
production incident that followed. This instead writes proactively from
the **One-Mind side**: `_operations-db.ts`'s new
`mirrorActivityTaskToLegacySession` is called from
`_thongthai-one-mind-orchestrator.ts`, immediately after a taskState CAS
write actually applies (never on a conflict-retry that didn't commit).
The legacy flow's *existing* read of its own session row
(`loadLineBookingSession`, already called on every turn regardless) picks
up the mirrored values with **zero new I/O added to that path**.

### Guardrails (the "never becomes a second interpreter" half)

- Only writes while the legacy session is itself still `'collecting'` (or
  doesn't exist yet) — backs off entirely once the legacy flow has moved a
  session into `awaiting_phone`/`awaiting_special_request`/`submitted`/etc.
  One-Mind must never override legacy-flow-specific progression it can't
  see.
- Never steals a session already claimed by a different `service_type`
  (e.g. an in-progress stay booking).
- The read inside the mirror function exists *only* to decide whether to
  defer; it never pulls legacy values back into taskState. All 4
  guardrail/behavior tests in `tests/mirror-activity-task-to-legacy-
  session.test.ts` pass against a fully mocked Supabase REST layer.
- Orchestrator-level gating (`tests/mirror-activity-task-orchestrator-
  wiring.test.ts`, 4 tests): fires only for `channel === 'line'` +
  `task.type === 'activity_booking'` + non-terminal status, after a write
  that actually `applied`. Web never triggers it (proven, not assumed) —
  channels must not each own separate operational side effects.

### Two independent parser fixes re-applied

Reverted along with `ee2a315` even though they were unrelated to its
network-call risk (needed regardless, since the *current* turn's own
date/time text is still parsed by the legacy flow's own parser, not
mirrored from an earlier turn):
- `bookingDateFromText`'s numeric-date regex no longer treats `.` as a
  date separator (it collided with `13.00` as a TIME). Falls through to
  `_slot-parsers.ts`'s `extractDate`, now taught to recognize a day + Thai
  month name (`3 ตุลาคม` / `3 ต.ค.`) instead of a second private lexicon.
- `activityDurationFromText` no longer requires a trailing word boundary
  after `นาที`, so `"30 นาทีครับ"` (politeness particle glued on with no
  space — the overwhelmingly common real phrasing) parses correctly.
- 8 new tests in `tests/legacy-activity-parser-fixes.test.ts`.

### Verification (no production access)

- Full suite: 580/580 (24 new tests across 4 files this checkpoint).
- esbuild bundle test (same method as Priority 1): bundled the real
  `line-webhook.ts`, invoked the handler with a synthetic signed LINE
  message stating horse + duration + date + time in one turn
  (`"เอาภาราดรครับ เอา 30 นาทีครับ 3 ตุลาคม เวลา 13.00"`) — resolved cleanly
  (200 OK), the deterministic semantic layer correctly parsed the real
  Thai text (`deterministic_turn:true` in the log), no crash, no new
  failure class versus Priority 1's baseline.

### Still not done: the 16-turn end-to-end conversation proof

The owner's CRITICAL REQUIREMENT (prove the full 16-turn horse-booking
conversation, asserting slot/state values at every turn) has **not yet
been built**. Priority 2's tests prove the mirror mechanism and its
gating in isolation, not the full multi-turn conversation end-to-end
through the real routing gate (`shouldConsumeLegacyLineBookingTurn`) that
decides, turn by turn, whether a message reaches the legacy flow or
One-Mind. That routing gate itself was NOT modified this pass (out of
scope for Priority 1/2) and is the next thing to verify directly.

### Next step

Build the 16-turn stress test (owner's CRITICAL REQUIREMENT). This
requires exercising the REAL turn-by-turn routing decision
(`shouldConsumeLegacyLineBookingTurn` in `_operations-db.ts`, plus the
One-Mind side via `processThongthaiOneMindTurnAuthoritative`) against a
single persistent mocked state store (both `guest_agent_state` and
`booking_sessions`, via `global.fetch` mocking following this session's
established pattern), asserting the required fields at every turn. This
is the strongest remaining proof that Priorities 1+2 actually fixed the
original bug end-to-end, not just in their own unit tests.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 580/580 passing as of commit b41911c
git log --oneline -10
```

## 2026-09-22 CRITICAL REQUIREMENT Checkpoint — 16-Turn Canonical-State Proof

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `2754200`.
Working tree: clean, pushed. Full suite: **582/582 passing**.

### What this proves

`tests/activity-16-turn-canonical-state.test.ts` drives the exact
owner-specified 16-turn horse-booking conversation through the REAL
One-Mind pipeline (deterministic semantic derivation → dialog manager →
task state), with a single in-memory `guest_agent_state` row carried
across all 16 turns via the same `{loadSnapshot, compareAndSwap}` shape
the real CAS read/write uses — one continuous conversation, not 16
independent single-turn tests. Asserts domain/action/entities/missing-
fields/dialog-decision/task-state at every turn.

Confirmed working: side questions (price, inventory count, comparison)
answered without losing the open task; unknown temperament honestly
admitted, never invented; topic switch (turn 8, restaurant) suspends the
activity task rather than destroying it; explicit resume (turn 9) restores
the exact prior slots; corrections (turns 12, 13) overwrite only the
stated field; the final confirmation (turn 16) produces **exactly one**
transaction proposal — verified absent on all 15 prior turns — carrying
the **final corrected** values (ทองไทย, 60 minutes), never the original
(ภาราดร, 30 minutes) stated earlier; One-Mind proposes but never executes.

### Real bug found and fixed while building this test

Turn 13 ("ไม่เอาภาราดรแล้ว เอาทองไทย" — a correction naming both the
rejected and newly-chosen horse in one message) surfaced that
`_deterministic-semantic-turn.ts`'s `findKnownActivityAssetSelection`
picked whichever name came first in `ACTIVITY_ASSET_SELECTIONS`'s array
order (ภาราดร), regardless of which one the customer was negating — so
this exact correction phrasing would have silently kept the REJECTED
horse. Fixed structurally: a name immediately preceded by a negation
marker (ไม่เอา/ไม่ใช่/ไม่รับ/ไม่ได้เอา — the same category
`hasCorrectionMarker` already recognizes) is excluded before picking a
match, working regardless of phrasing order. Direct regression test added
in `tests/deterministic-semantic-turn.test.ts` covering both orders.

### Honest, documented gap (not hidden)

3 of the 16 turns (`ชื่ออะไรบ้าง`, `เวลาเดิมนะ`, `ตอนนี้ที่เลือกไว้มีอะไรบ้าง`)
have no deterministic handler yet and no LLM is configured in this test
environment, so they fall back to a generic clarify response instead of
answering the question. The test proves the property that matters for the
split-brain audit — the fallback never loses/corrupts/resets the task's
known slots — but does NOT prove these 3 specific questions get answered
in production. This is a real capability gap for a future session:
- `ชื่ออะไรบ้าง` ("what are the names") — could be a new deterministic
  side-question category alongside the existing inventory-count/price
  ones in `_deterministic-semantic-turn.ts`, backed by the real catalog.
- `ตอนนี้ที่เลือกไว้มีอะไรบ้าง` ("what have I selected so far") — a
  natural, generic "summarize the active task's slots" category that
  would work across ALL domains (not just activity), reading directly
  from `task.slots` (data already correctly tracked, just not yet
  surfaced back to the customer on request).
- `เวลาเดิมนะ` ("same time as before") — currently harmless (doesn't
  corrupt state) but doesn't explicitly acknowledge the re-affirmation
  either; in production this depends on the configured LLM understanding
  it via context, which this zero-LLM test environment can't exercise.

None of these are safe to deploy blind — they're additive read-only
response quality, not safety-critical, and are listed here rather than
implemented so the next session can decide priority.

### Next step

Priority 3: cross-channel (web/line) equivalence tests — prove the same
logical conversation via `channel:'web'` and `channel:'line'` produces
equivalent semantic/task/transaction results, fixing architecture (not
weakening tests) if they diverge.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 582/582 passing as of commit 2754200
git log --oneline -12
```

## 2026-09-22 Priority 3 + 4 Checkpoint — Channel Equivalence + LINE Business-Ownership Audit

Branch: `feature/thongthai-one-mind-architecture`. HEAD (before this handoff
commit): `48a7986`. Full suite: **583/583 passing**.

### Priority 3: Web/LINE cross-channel equivalence — PROVED

`tests/web-line-channel-equivalence.test.ts` runs the identical 6-turn
activity-booking conversation through `channel:'web'` and `channel:'line'`
(separate in-memory state per channel) and asserts equivalent semantic
turns, dialog decisions, task slot values, and final transaction-proposal
arguments. **Passed on the first run** — the orchestrator/semantic/dialog-
manager layers are already genuinely channel-agnostic for business logic.
The one legitimate divergence (LINE-only legacy-session mirror, Priority 2)
is explicitly asserted: 0 calls for web, ≥1 for LINE across the
conversation — correct, since that's transport-adjacent execution
plumbing, not a business decision.

### Priority 4: Audit remaining LINE business ownership

Traced `_line-webhook-core.ts` (515 lines) function by function. Findings:

1. **The adapter file itself contains zero domain/business decision
   logic** for booking/membership/promotion/etc — enforced by the
   structural test extended in Priority 1
   (`tests/line-self-fetch-removed.test.ts`'s
   `doesNotMatch(source, /_semantic-interpreter|_dialog-manager|
   _knowledge-resolver|_response-composer|_task-state/)`).
2. **`handleLineMembershipMessage`/`handleLineBookingMessage`** (imported
   from `_operations-db.ts`, not defined in the adapter file) remain
   justified per the owner's own explicit caveat — "do not delete
   transaction safety before equivalent canonical behavior exists". One-
   Mind still cannot execute a transaction (architectural constraint,
   unchanged this session); these are the ONLY code that can execute a
   real LINE booking/membership action. Classification unchanged from the
   original audit: **B — keep as adapter, one-directional migration
   target** (Priority 2 already made this one-directional for activity
   bookings specifically).
3. **`saveLatestJourney`/`buildJourneyFlex`** (the `action=save_journey`
   postback and LINE Flex Message card rendering) — genuinely transport-
   layer code: LINE-Flex-specific UI formatting and a thin "persist the
   last computed journey" utility, not a business decision about what a
   journey contains. **Classification: A — justified as-is.**
4. **One real, verified channel-inconsistency found**:
   `deterministicConstraints`/`reinforceStructuredMemory` (a small
   deterministic regex classifier inferring an accessibility constraint —
   currently only `limited_walking` — from raw customer text, as a
   zero-LLM safety net) exists ONLY in `_line-webhook-core.ts`. It writes
   into `guest_memory.constraints` via `persistCustomerSnapshot` — the
   SAME table/field the canonical brain's own LLM-driven
   `contextUpdates.constraints` (via `persistCustomerResult`) already
   writes to for BOTH channels since Priority 1. So this is a genuine
   safety-net **duplication that is LINE-only**: a web customer whose
   message the LLM fails to correctly infer a mobility constraint from
   gets no deterministic fallback; the identical LINE customer does.
   **Classification: E — needs repair, NOT done this pass.** Low
   severity (accessibility-relevant but not booking/payment-correctness;
   never conflicts with the LLM path, since both write with
   `resolution=merge-duplicates`), and the safe fix requires care:
   extracting `deterministicConstraints` + the load/merge/persist
   sequence into `_customer-db.ts` (already imported by both channels)
   as one shared function, then finding the right single call site in
   EACH channel's outer wrapper (LINE already calls it once, right after
   `askThongthaiReliably` returns; `thongthai-chat.ts`'s core has many
   early-return branches, so the natural web call site is in its own
   thin `handler`, wrapping whatever `processThongthaiChatCore` returns,
   not threaded through every internal branch). Deferred rather than
   implemented this pass because it touches the shared core's calling
   convention for a modest, non-blocking benefit, and this session
   already made two structural changes to that exact file (Priority 1);
   stacking a third in the same session raises risk for a low-severity
   fix that isn't time-sensitive.

### Next step

Priority 5: restaurant preorder notification consistency (read-only
verification + tests only, per the original audit's Finding 5 — no
production DB mutation without explicit owner authorization for the
migration).

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 583/583 passing as of commit 48a7986
git log --oneline -14
```

## 2026-09-22 Priority 5 Checkpoint — Restaurant Notification Parity (prepared, not applied)

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `2c300fd`.
Full suite: **585/585 passing**. No production DB mutation.

### What changed (code, safe to ship now)

`netlify/functions/ops-notify.ts` now accepts `entity: 'restaurant_preorder'`
and routes it to the existing `notifyRestaurantPreorderTeam` (from
`_restaurant-sot.ts` — reused, not re-implemented). Nothing calls this
endpoint with that entity today (no DB trigger exists yet), so this is
inert, forward-compatible preparation — zero behavior change to any live
path until the migration below is applied.

### The exact migration — NOT applied, needs owner authorization

Verified directly against the live `tamma-customer-data` schema (project
`upaokrprawzhgzeqsdke`) with read-only `execute_sql` only. Confirmed via
`pg_get_functiondef`: `enqueue_tamma_ops_notification()` currently branches
on `tg_table_name` for `booking_allocations` → entity `booking`,
`cafe_inquiries` → entity `cafe_inquiry`, `otop_order_items` → entity
`otop_order`, with a final `else return new;` — `restaurant_preorder_items`
(confirmed to exist, with `preorder_id` FK to `restaurant_preorders`,
exactly mirroring `booking_allocations`/`otop_order_items`'s shape) falls
through that `else` today. The migration is additive only — one new
`elsif` branch plus one new trigger, matching the existing pattern exactly:

```sql
-- 1. Extend the existing dispatcher function with one more branch,
--    mirroring the otop_order_items case exactly.
create or replace function public.enqueue_tamma_ops_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_secret text;
  v_entity text;
  v_entity_id uuid;
  v_environment text;
begin
  if tg_table_name = 'booking_allocations' then
    v_entity := 'booking';
    v_entity_id := new.booking_id;
    select b.environment into v_environment from public.bookings b where b.id = new.booking_id;
  elsif tg_table_name = 'cafe_inquiries' then
    v_entity := 'cafe_inquiry';
    v_entity_id := new.id;
    v_environment := new.environment;
  elsif tg_table_name = 'otop_order_items' then
    v_entity := 'otop_order';
    v_entity_id := new.order_id;
    select o.environment into v_environment from public.otop_orders o where o.id = new.order_id;
  elsif tg_table_name = 'restaurant_preorder_items' then
    v_entity := 'restaurant_preorder';
    v_entity_id := new.preorder_id;
    select p.environment into v_environment from public.restaurant_preorders p where p.id = new.preorder_id;
  else
    return new;
  end if;

  if coalesce(v_environment, 'live') not in ('live', 'test') then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ops_notification_webhook_secret'
  order by created_at desc
  limit 1;

  if v_secret is null or length(v_secret) < 24 then
    raise warning 'ops_notification_webhook_secret is missing; skipping notification enqueue';
    return new;
  end if;

  perform net.http_post(
    url := 'https://tamma-chat.netlify.app/.netlify/functions/ops-notify',
    body := jsonb_build_object('entity', v_entity, 'id', v_entity_id::text, 'environment', coalesce(v_environment, 'live')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ops-notification-secret', v_secret),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Could not enqueue Tamma ops notification: %', sqlerrm;
    return new;
end;
$function$;

-- 2. New trigger, matching ops_notify_booking_after_allocation /
--    ops_notify_otop_after_item exactly.
create trigger ops_notify_restaurant_after_item
after insert on public.restaurant_preorder_items
for each row execute function public.enqueue_tamma_ops_notification();
```

**Before applying**: confirm `notifyRestaurantPreorderTeam`'s existing
idempotency (`ops_notification_deliveries` with
`resolution=ignore-duplicates` on `idempotency_key`) means a preorder
created through the existing inline call path (which still runs
unchanged) plus this NEW trigger firing on the same `restaurant_preorder_items`
insert will not double-notify — the code already reused in Priority 5 is
built exactly to make that safe (a second call for the same preorder
resolves to `'duplicate'`), but this should be watched on the first
`restaurant_preorder_items` insert after the migration lands, same as any
production change.

### Next step

Priority 6: cross-domain (stay/restaurant/promotion/OTOP/membership/cafe/
ecosystem) multi-turn stress suites plus Thai fuzz variants, per the
original brief's Phase 8-10.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 585/585 passing as of commit 2c300fd
git log --oneline -16
```

## 2026-09-22 Priority 6 Checkpoint — Thai Fuzz Suite + Domain-Coverage Finding

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `167c490`.
Full suite: **597/597 passing**.

### Thai fuzz suite: done, 2 real gaps found and fixed

`tests/thai-fuzz-variants.test.ts` systematically tested every variant the
owner listed against the shared parsers. Two genuine, narrow, structural
gaps found and fixed (see the commit message for full detail): a shortened
inventory-count question ("มีกี่ตัว", no keyword restated) now falls back
to an already-open task's own topic instead of hitting the LLM path
needlessly; "บ่ายโมง" (colloquial 1pm with the implied "one" omitted) is
now recognized. "เวลาเดิมนะ" is confirmed to correctly NOT match the
correction-marker pattern (a reference to a prior value, not a correction
— a real, honestly-documented gap already proven harmless in the 16-turn
test, not a bug).

### Important architectural finding: honest scope decision on cross-domain multi-turn suites

Attempted to build stay- and restaurant-domain multi-turn stress tests
through the real pipeline (`processThongthaiOneMindTurnAuthoritative`),
using the owner's own example turns for each domain, the same way the
activity 16-turn test was built. **Result: almost none of those messages
produce a deterministic semantic turn in `_deterministic-semantic-turn.ts`
at all** — they fall straight through to the LLM-unavailable clarification
fallback in this zero-LLM test environment.

This is not a bug in those messages or in the test harness. It's
confirmation of something already noted in the Priority 4 audit:
**One-Mind's deterministic semantic-turn coverage is activity-domain-
heavy by design.** Restaurant conversations are deliberately routed
AROUND One-Mind entirely today — `thongthai-chat.ts`'s own
`isRestaurantAdvisorTurn`/`preserveRestaurantFastPath` explicitly gates
the One-Mind cutover OFF for restaurant-advisor turns, sending them
instead through that file's own separate machinery
(`restaurantPreorderDialogResponse`, `deterministicRestaurantResponse`,
the legacy paid-LLM brain's restaurant tool calls). Stay has some
deterministic coverage in `_deterministic-semantic-turn.ts` (confirmed:
`stay_read_only_inquiry`/`stay_follow_up` intents exist and fire) but
still depends on the LLM for anything beyond the most basic recognition.

**Given this, building "16-turn-style" full-pipeline tests for restaurant/
stay against `processThongthaiOneMindTurnAuthoritative` would either (a)
mostly test the LLM-unavailable fallback (uninformative), or (b) require
testing against a completely different set of functions
(`thongthai-chat.ts`'s own restaurant/stay machinery) with a different,
heavier mocking burden (HTTP/DB, similar to what
`create-booking-retry-idempotency.test.ts` already does for the write
path).** Rather than force weak or mislabeled tests, this scope was
deliberately NOT pursued this pass. What already exists and remains
valid:
- `tests/dialog-manager-restaurant-scenario.test.ts` /
  `tests/dialog-manager-stay-scenario.test.ts` — multi-turn dialog-manager
  behavior with hand-constructed semantic turns (proves the DIALOG LOGIC
  is correct given a certain interpretation, a real and valid but
  different layer than proving real Thai text produces that
  interpretation).
- `tests/restaurant-preorder-dialog.test.ts`,
  `tests/restaurant-intelligence.test.ts`, `tests/restaurant-routing.test.ts`,
  `tests/promotion-*.test.ts` — domain-specific unit/integration coverage
  of `thongthai-chat.ts`'s own restaurant/promotion machinery.

**Recommendation for a future session**, if full real-text multi-turn
proof for restaurant/stay/promotion/OTOP/membership/cafe/ecosystem is
wanted: build it against `thongthai-chat.ts`'s exported response functions
directly (`restaurantPreorderDialogResponse`,
`deterministicActivityResponse`, etc.), with HTTP/DB mocking for
`loadRestaurantWorldFacts`/`loadCustomerMemory`/etc. — not against the
One-Mind orchestrator, since that is not where those domains' production
logic actually lives yet. This is itself a finding worth weighing against
Priority 4's "move business ownership into the canonical brain" goal:
until restaurant/stay/etc. get the same deterministic-coverage investment
activity received, `thongthai-chat.ts`'s separate machinery remains a
necessary B-classification adapter, not a removable duplicate.

### Next step

Priority 7: final cleanup pass (re-audit for now-provably-dead code),
final full suite run, final report.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 597/597 passing as of commit 167c490
git log --oneline -18
```

## 2026-09-22 Priority 7 Checkpoint — Final Cleanup Pass

Branch: `feature/thongthai-one-mind-architecture`. HEAD: `6e27030`
(this commit follows it). Full suite: **597/597 passing**. Working tree
clean.

### Re-audit for now-provably-dead code

Checked each candidate from the owner's Priority 7 list against this
session's actual changes:

- **Legacy LINE booking conversation routing** — NOT removable.
  `handleLineBookingMessage`/`handleLineMembershipMessage` remain the
  only code that can execute a real LINE transaction (unchanged
  architectural constraint). Correctly reclassified this session as a
  passive execution adapter fed by the canonical brain (Priority 2), not
  removed.
- **Duplicated slot handling** — the one real instance found this session
  (a private Thai-month lexicon duplicated between the legacy parser and
  the shared one) was already consolidated in the very first checkpoint
  and again in Priority 2 (`bookingDateFromText` now delegates to
  `_slot-parsers.ts`'s `extractDate` instead of owning a second copy).
- **Obsolete compatibility bridges** — `_thongthai-runtime.ts` (fully
  superseded by `_thongthai-runtime-v3.ts`) was found and deleted in the
  first checkpoint of this session, with a resurrection-guard test.
- **Old deterministic fallbacks superseded by canonical One-Mind
  behavior** — per the Priority 6 finding, restaurant/stay/promotion/
  OTOP/membership/cafe fallbacks in `thongthai-chat.ts` are explicitly
  NOT yet superseded (One-Mind has no equivalent coverage for those
  domains) — correctly left in place. Only the activity domain has deep
  One-Mind coverage; nothing there was found duplicating what One-Mind
  already fully owns.
- **Duplicate response generation** — none found this session.
- **Old state-sync helpers** — the one real instance found
  (`mergeBrainGuestData`'s raw-upsert bypass of the shared CAS store,
  surfaced while migrating it out of the dead `_thongthai-runtime.ts`)
  was fixed in the first checkpoint.

**Conclusion: no further safe deletions identified beyond what was
already done in earlier checkpoints this session.** Verified via:
- Confirmed every helper function touched this session
  (`activityAssetFromSession`, `activityDurationFromSession`,
  `activitySessionMarker`, `loadLineBookingSession`,
  `saveLineBookingSession`) still has live callers, not orphaned by the
  refactors.
- Full combined `tsc --noEmit` across all 9 production files touched
  this session in one pass: zero new errors (same 4 pre-existing,
  unrelated errors present before this session started).
- Final esbuild-bundle-and-invoke smoke test on BOTH entry points
  (`line-webhook.ts` and `thongthai-chat.ts`), including the exact
  original bug-report message sequence (`ฮัลโหล` then
  `"เอาภาราดรครับ เอา 30 นาทีครับ 3 ตุลาคม เวลา 13.00"` combined in one
  turn) — both resolve cleanly (`200`), zero crashes, only expected
  sandbox limitations logged (no real API keys/DB/LINE egress).

### Net effect on codebase size/clarity this session

23 files changed: 1 production file deleted outright (346 lines), 9
production files modified with net-positive but modest line counts (each
change traceable to a specific, documented, tested bug or architectural
fix), 13 test files added/extended, plus this handoff document. The
codebase is smaller in dead weight (one fewer duplicate runtime module)
and structurally clearer (LINE no longer self-fetches; state ownership
between `taskState` and `booking_sessions` is now explicit and
one-directional, with the direction and guardrails documented in code
comments at the exact point they apply) than at session start.

### This is the final checkpoint of this session

See the end-of-turn report delivered to the owner for the full 16-item
Definition of Done checklist and FINAL PRODUCTION ACCEPTANCE GATES.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 600/600 passing (see RELEASE-GATE CLOSING checkpoint below)
git log --oneline -20
```

---

## RELEASE-GATE CLOSING — Gate 1 in progress (checkpoint, not final)

Superseding the "final checkpoint of this session" framing above: this is
a NEW session picking up the accepted `f57978a` architecture to close the
release-acceptance gates (cross-domain stress, LINE/Web equivalence,
stale-state, operational contract, no-hallucination, release freeze) —
**not** another architecture rebuild. Two atomic checkpoints landed so
far, both tested and pushed:

### Checkpoint: promotion redemption loose-name bug (commit `eab940d`,
rebased to `a1043bf`)

While building `tests/helpers/canonical-core-harness.ts` (a shared
harness that drives the real `processThongthaiChatCore` end-to-end via
Supabase REST + Gemini `fetch` mocking only — never hand-constructed
`SemanticTurn` objects, matching this repo's established test convention)
and running the owner's PROMOTION flow through it, found a real bug:
`resolvePromotionRedemption` (thongthai-chat.ts) reused
`parseRestaurantPreorderTurn`'s "loose name" fallback — built for the
restaurant preorder flow, where a stray aside after order commitment is
rare. In promotion redemption, ANY short off-topic message, or a bare
"ยืนยัน", was accepted as the customer's name once a redemption was
pending, creating a `promotion_redemptions` row every time without the
customer's real name ever being captured.

Fix: `parseRestaurantPreorderTurn` now takes an optional
`{ allowLooseName: false }`; `resolvePromotionRedemption`'s call site
passes it, now requiring an explicit name marker ("ชื่อ...", "ผมชื่อ...").
The restaurant preorder flow's own call site (`_promotion-dialog.ts`'s
`decidePromotionFallback`, and the restaurant preorder dialog itself) is
untouched — its loose-name behavior is a working, accepted characteristic
of that flow, not the bug. Regression test:
`tests/promotion-redemption-loose-name-guard.test.ts` — verified it
actually catches the bug by reverting the fix locally and confirming the
test fails, then restoring it.

### Checkpoint: deterministic restaurant topic-switch gap (commit `0db6724`)

A concurrent session pushed `tests/stay-real-text-readonly-flow.test.ts`
(commit `90ce044`) directly to this branch while this session was
working — merged cleanly via rebase, no conflicts. Running it surfaced a
second real, structural bug: `findRestaurantTopicNarrow` (the regex-based
restaurant-topic marker in `_deterministic-semantic-turn.ts`) was only
ever consulted inside `detectCrossDomainTopicSwitch`, itself only called
from `deriveDeterministicSemanticTurn`'s **active-task** branch. Stay has
no task-creation mechanism at all (confirmed in the prior session's
findings — no `AgentStateUpdate` field, no `taskState` write path for a
stay booking draft), so `activeTask` is always `null` for a pure stay
conversation. A message like "ร้านอาหารมีอะไร" mid a stay conversation
therefore had **no deterministic path** to be recognized as a restaurant
topic switch: it fell through to `null`, and — when the model provider is
unavailable (no API key/network, e.g. in this offline harness, but
equally a real production circuit-breaker-open scenario) — the
orchestrator's own fallback re-used `context.activeDomain` (the stale
'stay' domain) instead of switching, so the customer's restaurant
question would silently be mis-routed to a stay-domain clarification.

Fix: added the same `findRestaurantTopicNarrow` check to the no-active-
task ladder in `deriveDeterministicSemanticTurn`, returning the identical
`restaurant_topic_switch` shape `detectCrossDomainTopicSwitch` already
returns for the active-task case — no new lexicon, no new intent, purely
closing a missing call site.

**Full suite: 600/600 passing** (597 baseline + `stay-real-text-readonly-
flow` + 2 new promotion-redemption regression tests). Both checkpoints
pushed to `feature/thongthai-one-mind-architecture`. Netlify/production
untouched throughout (`process.env.THONGTHAI_ONE_MIND_CUTOVER` set only
inside the local test harness, never in a deployed context).

### Checkpoint: restaurant preorder loose-name gap + harness RPC/PATCH fixes (commit `a266837`)

Building `tests/restaurant-cross-domain-stress.test.ts` (menu discovery,
dietary-constraint filtering, promotion side-question survival, and — via
`harness.setState` seeding a `restaurantProposedSet` the same shape a
correct LLM turn would write, matching the promotion test's established
seeding technique — the accept/collect-missing-fields/create-preorder
path) surfaced two real, distinct problems:

1. **A production bug, sibling to the promotion one**: `parseRestaurantPreorderTurn`'s
   loose-name fallback only checked "no name captured yet", not "date+time
   already resolved" — its own design premise (`formatRestaurantSetPrompt`
   always asks for date+time before name+phone). An off-topic message sent
   right after accepting a set, while date/time were still missing, was
   wrongly captured as the customer's name. Fixed by gating the loose
   fallback on date+time already being known (from the draft, or from the
   same message when given together) — preserves the designed one-shot
   "นุ๊ก 0610169999" reply while closing the gap. **Caught only after
   strengthening the test to check the persisted draft directly** — an
   initial version that only checked downstream write counts passed even
   with the bug present, because the final turn's explicit "ชื่อสมชาย"
   silently overwrote the wrongly-captured value before any assertion saw
   it. Verified the strengthened test actually fails on the reverted bug.

2. **Two harness bugs (test infrastructure, not production)**:
   - `guest_agent_state` PATCH — the real CAS write path used by every
     turn after a guest's very first write — was never modeled in the
     harness's fetch mock. Every write after turn 1 fell through to the
     generic "unmodeled write" fallback: it returned a fake success
     response but never actually updated the harness's in-memory state
     map. This was invisible in earlier tests only because their
     assertions happened to not depend on state changing after turn 1
     (promotion redemption's pending state was fully written on turn 1
     already, since the default catalog has exactly one promotion).
     Fixed by adding a real PATCH handler with proper CAS-token
     (`updated_at`) matching, mirroring PostgREST's actual conflict
     semantics (stale token → empty array → caller-side conflict/retry).
   - Restaurant preorder creation is the RPC `create_restaurant_preorder_v2`/
     `_v3` (`_restaurant-sot.ts`), never a direct table insert — the
     harness previously modeled a fake direct `restaurant_preorders`
     POST route that real code never calls, so an early version of this
     test's "exactly one preorder" assertion was checking a write path
     that doesn't exist in production (it would have passed vacuously).
     Fixed by modeling both RPCs with realistic menu-price resolution and
     idempotency-key-based dedup (mirroring the real RPC's own
     idempotency contract), recorded under `postsTo('restaurant_preorders_rpc')`,
     and serving the created row back on the GET-by-id reads the
     staff-notification path (`notifyRestaurantPreorderTeam`) depends on.

**Methodology note for whoever builds the remaining domains' tests**: when
a domain's transactional write turns out to go through an RPC rather than
a plain table insert, grep the real implementation file (not just the
table name) before assuming the harness's existing generic fallback is
adequate — a vacuously-passing assertion against an unmodeled write path
is worse than no test, because it looks like coverage.

**Full suite: 604/604 passing.** Pushed to `feature/thongthai-one-mind-architecture`.

### Gate 1 status (cross-domain customer-level stress, 8 domains)

- **Activity**: pre-existing deep coverage (16-turn flow etc.) — regression only, not re-derived.
- **Stay**: covered by `stay-real-text-readonly-flow.test.ts` (read-only inquiry, side-question survival, topic switch to restaurant and back, no premature task/transaction). Known gap (documented, not a bug to fix under this program's scope discipline): stay still has no booking-task-creation mechanism via the canonical core — a real booking intent for stay does not yet produce an `ActiveTask`, unlike activity.
- **Restaurant**: covered by `restaurant-cross-domain-stress.test.ts` (menu discovery, dietary-constraint filtering, promotion-side-question survival, accept-set → collect-missing-fields → create-exactly-once, off-topic-message-not-captured-as-name). Real bug found and fixed (see above).
- **Promotion**: covered by `promotion-redemption-loose-name-guard.test.ts` (missing-name path). Broader promotion discovery/conditions/cross-domain-return flow from the owner's example not yet built as a dedicated file (the discovery/list/clarify paths are exercised incidentally by the restaurant and promotion tests above, but not as their own named scenario).
- **OTOP, Membership, Cafe, General ecosystem**: not yet built as permanent test files — next task.

### Next task (exact resumption point)

### GATE 1 COMPLETE (commits `a266837`..`4fcb995`)

Permanent stress-test files now exist for all 8 required domains —
`activity` (pre-existing 16-turn flow etc., unchanged), `stay-real-text-
readonly-flow.test.ts`, `restaurant-cross-domain-stress.test.ts`,
`promotion-redemption-loose-name-guard.test.ts`, `otop-cross-domain-
stress.test.ts`, `membership-cross-domain-stress.test.ts`, `cafe-cross-
domain-stress.test.ts`, `ecosystem-cross-domain-stress.test.ts` — all
driven through the real `processThongthaiChatCore` via `tests/helpers/
canonical-core-harness.ts`, never hand-constructed `SemanticTurn`s.

**Five real production bugs found and fixed this session** (all with a
regression test verified to fail on the reverted fix before landing):
1. Promotion redemption accepted an off-topic message as the customer's
   name (`resolvePromotionRedemption` reusing the restaurant preorder
   parser's loose-name fallback with no guard).
2. `deriveDeterministicSemanticTurn` never checked for a restaurant-topic
   switch when there was no active task (only checked it for an
   in-progress task) — a stay conversation with no task literally could
   not switch to restaurant deterministically.
3. Restaurant preorder's own loose-name fallback captured an off-topic
   message as the name whenever date/time were STILL missing (not just
   once they were already known, which was the fallback's own design
   premise) — same bug class as #1, sibling flow.
4. Membership status questions phrased with ordinary "หรือยัง/รึยัง" (yet?)
   particles, rather than an explicit "สถานะ/เช็ค/ตรวจ/ดู" keyword, were
   misrouted to the generic "here's how to sign up" script instead of an
   actual status lookup.
5. Generalized #2's fix: ANY domain's own loose side-question marker (bare
   "มี", price words) could swallow a message that structurally named a
   DIFFERENT domain, before ever checking for a real topic switch — found
   via cafe→stay ("มีห้องพักไหม" mid a cafe conversation), fixed once for
   all domains in `deriveDeterministicSemanticTurn`'s no-active-task path.

**Two harness (test infrastructure) bugs also found and fixed**, both
capable of producing false-positive-passing tests if left in place: (a)
`guest_agent_state` PATCH (the real CAS write path used by every turn
after a guest's first) was never modeled, so state changes after turn 1
silently failed to persist; (b) restaurant preorder creation is an RPC
(`create_restaurant_preorder_v2`/`_v3`), not a direct table insert, so an
early version of the harness's fake direct-insert route made an
"exactly-once" assertion pass vacuously against a write path production
never uses. See `tests/helpers/canonical-core-harness.ts`'s own comments
for the fixes; see the checkpoint commits above for full narrative.

**Known, deliberately NOT-fixed gaps** (documented per this program's
"do not create new architecture, fix the smallest real cause" discipline
— these are real feature gaps, not classification bugs a regex can close):
- **Stay** has no booking-task-creation mechanism via the canonical core
  at all (no `AgentStateUpdate` field, no `taskState` write path for a
  stay booking draft) — a real stay booking intent never produces an
  `ActiveTask`, unlike activity/restaurant/otop.
- **OTOP** purchase intent ("เอาอันนี้") is not distinguished from a
  browsing follow-up in the deterministic layer — it never fabricates an
  order (verified), but it also doesn't acknowledge the selection or ask
  which product is meant when more than one was shown.
- **Cafe** has NO knowledge adapter wired up in `_dialog-source-
  adapters.ts` at all (`_knowledge-resolver.ts` already expects
  `adapters.cafe?.facts` and finds nothing) — every cafe question
  honestly degrades to "cannot confirm," even though real `cafe_hours`/
  `cafe_latte_price`-shaped facts exist in `world_facts`. No hallucination
  risk, but a real missed-answer gap.

**Full suite: 616/616 passing.** All checkpoints pushed to
`feature/thongthai-one-mind-architecture`. Production/Netlify untouched
throughout.

### Next task (exact resumption point)

### GATE 2 COMPLETE (commit `a283125`)

`tests/gate2-line-web-domain-equivalence.test.ts` covers the remaining 7
domains (activity's own deep 6-turn equivalence proof already existed at
`tests/web-line-channel-equivalence.test.ts`, driven through
`processThongthaiOneMindTurnAuthoritative` directly). Driven through the
real shared entry point `processThongthaiChatCore` for both
`channel:'web'` and `channel:'line'`, independent guests per channel,
asserting equivalent business meaning (real facts surfaced, missing-
field/transaction-gating behavior, write counts) — no channel-specific
business divergence found in any domain. Also fixed a real harness
usability gap: `harness.guestDbId(anonymousId)` now looks up a guest's
internal id directly from the harness's own registry, instead of the
previous reverse-engineering-from-last-post trick, which silently
returned the WRONG guest's id the moment more than one guest had written
state in the same test — exactly the shape Gate 2's multi-channel tests
need.

### GATE 3 COMPLETE (commit `a31a3f9`)

`tests/gate3-stale-interrupted-conversations.test.ts`. **Found and fixed
a real, significant production bug**: `planDialogTurn` in
`_dialog-manager.ts` decided whether to start a fresh task with a bare
`if (!container.activeTask)` null check. A cancelled task transitions to
`status:'cancelled'` but is never nulled out of `container.activeTask` —
so that check was `false` for a cancelled task, and the very next
unrelated-but-same-domain selection ("ยกเลิก" then "เอาภาราดรครับ") got
merged INTO the dead, cancelled task object via the `update_slots` branch
instead of starting a genuinely new one. This **silently resurrected a
task the customer had just cancelled**, in all but name — status stayed
`'cancelled'` while its slots kept accumulating new data. Fixed by
checking `isTerminalTaskStatus` too, reusing the exact `hasOpenTask`
pattern already established elsewhere in the same file. Full suite stayed
green before and after with zero other changes needed, confirming no
other code relied on the buggy behavior. Also covers: a stale task never
hijacking a plain greeting or leaking into an unrelated domain's answer,
and a suspended task surviving more than one intervening domain hop
before an explicit resume (A→B→C→resume A).

**Full suite: 627/627 passing.** Both gates' commits pushed to
`feature/thongthai-one-mind-architecture`. Production/Netlify untouched.

### Next task (exact resumption point)

1. **Gate 4** — restaurant-preorder-notification migration: locate the SQL
   drafted in a prior session's checkpoint (search this file's history /
   earlier "Priority 5" section), verify it's still accurate against the
   now-better-understood RPC-based creation flow
   (`create_restaurant_preorder_v2`/`_v3`, not a direct table insert — see
   Gate 1's restaurant checkpoint above), create/keep an actual migration
   file in the repo, add schema-assertion tests, do NOT apply it, mark
   OWNER APPROVAL REQUIRED. Also trace/document the operational contract
   for booking/OTOP/cafe (customer intent → canonical execution → DB
   result shape → backoffice source → staff notification path) — this was
   already verified structurally in a prior session; a light re-
   confirmation is enough, not a full re-derivation.
2. **Gate 5** — dedicated no-hallucination checks (temperament/beginner-
   suitability/availability/price/policy/menu/OTOP/cafe unknown-fact
   probes) — several domains already demonstrate this informally via
   Gate 1's tests (especially cafe's "cannot confirm" tests), but a
   dedicated pass across ALL domains closes the gate properly.
3. **Gate 6** — release freeze: full suite + tsc + esbuild bundle/import
   smoke for both entry points + the exact original LINE bug flow +
   activity's 16-turn flow + all Gate 1-5 flows, then ONE final commit
   updating `THONGTHAI_HANDOFF.md` with a "RELEASE CANDIDATE — PRE-
   PRODUCTION ACCEPTANCE" section, and the owner's 11-item final report.
4. Commit and push after every meaningful checkpoint, as done throughout
   this session — do not accumulate uncommitted work.

---

## RELEASE CANDIDATE — PRE-PRODUCTION ACCEPTANCE

Branch: `feature/thongthai-one-mind-architecture`. HEAD as of this section:
`cdd49a8` (this documentation commit follows it). Full suite: **638/638
passing**. Working tree clean throughout. **DO NOT DEPLOY. DO NOT TOUCH
NETLIFY. DO NOT TOUCH MAIN. DO NOT APPLY PRODUCTION DB MIGRATIONS** — none
of the above was done at any point in this program.

### What this release-gate program closed

Starting from the accepted `f57978a` architecture checkpoint (597/597
passing), this program closed all 6 required release-acceptance gates
without any architecture rebuild: LINE and Web still share ONE canonical
customer core (`processThongthaiChatCore`); `guest_agent_state.state.
taskState` is still the one authoritative conversational task state;
`booking_sessions` is still only a one-directional compatibility mirror;
domains that route through legacy `thongthai-chat.ts` machinery were
tested exactly as they are, not rewritten to look uniform.

**7 real production bugs found and fixed**, every one with a regression
test independently verified to fail against the reverted fix before
landing:

1. Promotion redemption accepted an off-topic message (or a bare
   "ยืนยัน") as the customer's name, creating a redemption with no real
   name ever given.
2. Restaurant topic-switch detection never fired when there was no active
   task (only worked mid-task) — a conversation with no open task
   literally could not deterministically switch to restaurant.
3. Restaurant preorder's own loose-name fallback captured an off-topic
   message as the name whenever date/time were still missing — sibling
   bug to #1, fixed by requiring date+time already known first.
4. Membership status questions phrased with ordinary "หรือยัง/รึยัง" (yet?)
   particles were misrouted to generic sign-up instructions instead of an
   actual status lookup.
5. Generalized #2: any domain's own loose side-question marker (bare
   "มี", price words) could swallow a message that structurally named a
   DIFFERENT domain, before ever checking for a real topic switch — fixed
   once for all domains, not just restaurant.
6. A cancelled task stayed present in `container.activeTask` (only its
   status changed), so the dialog manager's task-start decision — a bare
   null check — silently merged the very next unrelated selection INTO
   the dead, cancelled task instead of starting a clean new one,
   resurrecting it in all but name.
7. (Test-infrastructure, not production, but load-bearing for everything
   above): `guest_agent_state` PATCH — the real CAS write path used by
   every turn after a guest's first — was never modeled in the test
   harness, so state changes after turn 1 silently failed to persist in
   any test that happened not to notice; and restaurant preorder creation
   turned out to be an RPC, not a direct table insert, so an early
   harness route made an "exactly-once" assertion pass vacuously against
   a write path production never uses. Both fixed in `tests/helpers/
   canonical-core-harness.ts` before they could hide a real bug.

### A. Per-domain cross-domain stress result (Gate 1)

All 8 required domains covered with permanent tests driven through the
real `processThongthaiChatCore`, never hand-constructed `SemanticTurn`s:
**activity** (pre-existing 16-turn flow, regression only), **stay**
(`stay-real-text-readonly-flow.test.ts`), **restaurant**
(`restaurant-cross-domain-stress.test.ts`), **promotion**
(`promotion-redemption-loose-name-guard.test.ts`), **otop**
(`otop-cross-domain-stress.test.ts`), **membership**
(`membership-cross-domain-stress.test.ts`), **cafe**
(`cafe-cross-domain-stress.test.ts`), **ecosystem**
(`ecosystem-cross-domain-stress.test.ts`). Per domain: informational
question never mutates state, policy answers never erase state, topic
switch works, resume works, corrections overwrite, no duplicate
transaction, exactly one confirmation-gated action where applicable — all
PASS, with bugs #1-#5 above found and fixed along the way.

### B. Per-domain LINE/Web equivalence result (Gate 2)

Activity's deep 6-turn equivalence proof pre-existed
(`tests/web-line-channel-equivalence.test.ts`, driven through
`processThongthaiOneMindTurnAuthoritative` directly). The remaining 7
domains are covered by `tests/gate2-line-web-domain-equivalence.test.ts`,
driven through `processThongthaiChatCore` for both channels with
independent guests. **Result: equivalent business meaning confirmed for
all 8 domains** — same real facts surfaced, same missing-field/
transaction-gating behavior, same write counts. No channel-specific
business-logic divergence found anywhere; the one legitimate difference
(LINE's legacy-session mirror, activity-only) is itself asserted as
channel-specific transport plumbing, not business logic.

### C. Stale-state result (Gate 3)

`tests/gate3-stale-interrupted-conversations.test.ts`: a stale task never
hijacks a plain greeting or leaks into an unrelated domain's answer; a
suspended task survives more than one intervening domain hop before an
explicit resume (A→B→C→resume A); and bug #6 above (cancelled-task
resurrection) — found, fixed, regression-tested.

### D. Exactly-once transaction result

Verified per domain throughout Gates 1-3: promotion redemption (exactly
one `promotion_redemptions` row, even across repeated off-topic/bare-
confirmation turns), restaurant preorder (exactly one RPC-created
preorder, missing fields block creation, a stray post-completion
confirmation never creates a second one), activity booking (pre-existing
16-turn proof: exactly one transaction proposal, absent on all 15 prior
turns, carrying the FINAL corrected values). No domain tested produced a
duplicate or premature transaction at any point in this program.

### E. Backoffice/notification contract result (Gate 4)

Re-verified read-only against the live `tamma-customer-data` schema
(project `upaokrprawzhgzeqsdke`): `booking_allocations`/`cafe_inquiries`/
`otop_order_items` each still have their `AFTER INSERT` trigger →
`enqueue_tamma_ops_notification()` → staff LINE notification, confirmed
still wired correctly. `restaurant_preorder_items` still has zero
triggers — same gap found in a prior session, still real, still
unapplied. See item F below for the prepared fix.

### F. Restaurant preorder notification migration — NOT APPLIED

File: `supabase/migrations/20260922190000_restaurant_preorder_items_ops_notification_v1.sql`.
Effect: adds one `elsif` branch to the existing
`enqueue_tamma_ops_notification()` dispatcher (mirroring the
`otop_order_items` branch's exact shape) plus one new trigger,
`ops_notify_restaurant_after_item`, on `restaurant_preorder_items` —
purely additive, no existing branch/trigger/table touched. Verified via
static content tests (`tests/gate4-restaurant-notification-migration.test.ts`)
that every existing dispatcher branch survives byte-for-byte and exactly
one new trigger is added. **This migration has NOT been applied to any
database. OWNER APPROVAL IS REQUIRED before applying it** — see the
file's own header comment for the full idempotency safety argument
(`notifyRestaurantPreorderTeam`'s existing ignore-duplicates key means
the app's own inline call and this trigger's call for the same preorder
will not double-notify).

### G. Remaining known data/capability gaps (honestly documented, not fixed)

Per this program's explicit scope discipline — real feature gaps, not
classification bugs a regex/state-check fix can safely close:

- **Stay** has no booking-task-creation mechanism via the canonical core
  at all (no `AgentStateUpdate` field, no `taskState` write path for a
  stay booking draft) — a real stay booking intent never produces an
  `ActiveTask`, unlike activity/restaurant/otop. Stay's deterministic
  routing also does not yet distinguish different policy sub-questions
  (check-in time vs. room-service hours vs. availability all collapse to
  the same generic catalog-listing answer) — verified to degrade
  identically and honestly on both channels (Gate 2), never asserting an
  invented time.
- **OTOP** purchase intent ("เอาอันนี้") is not distinguished from a
  browsing follow-up in the deterministic layer — verified to never
  fabricate an order, but it also doesn't acknowledge the selection or
  ask which product is meant when more than one was shown.
- **Cafe** has no knowledge adapter wired up in `_dialog-source-
  adapters.ts` at all — `_knowledge-resolver.ts` already expects
  `adapters.cafe?.facts` and finds nothing. Every cafe question (menu,
  price, hours) honestly degrades to "cannot confirm" today, even though
  real `cafe_hours`/`cafe_latte_price`-shaped facts already exist in
  `world_facts`. Zero hallucination risk, but a real missed-answer gap.
- 3 of activity's original 16 turns (`ชื่ออะไรบ้าง`, `เวลาเดิมนะ`,
  `ตอนนี้ที่เลือกไว้มีอะไรบ้าง`) still have no deterministic handler
  (documented in the CRITICAL REQUIREMENT checkpoint above) — harmless
  (never corrupts state) but not yet answered without a live LLM.

### H. Production acceptance smoke plan (for the owner's actual deploy, not performed here)

1. Netlify production deploy SHA must match this branch's merge commit
   before any of the below.
2. A real LINE greeting must reply correctly in production (the exact
   check that failed after the original `ee2a315` incident).
3. Live LINE smoke test of the exact original bug flow: "ฮัลโหล" then
   "เอาภาราดรครับ เอา 30 นาทีครับ 3 ตุลาคม เวลา 13.00" in one message —
   this was re-verified this session via real esbuild-bundled-and-invoked
   handler code (not just unit tests) with a real HMAC-signed synthetic
   LINE event; both turns resolved `200 OK` with zero crashes.
4. Live smoke test of one representative flow per domain (the same
   messages used in this program's Gate 1/2 tests) on both LINE and Web.
5. Confirm the restaurant notification migration (item F) is either
   intentionally deferred or applied-and-watched (first
   `restaurant_preorder_items` insert's `ops_notification_deliveries`
   rows show exactly one delivered notification, not two) — owner
   decision, not automatic.
6. Only after 1-5 pass does this branch merit merging to `main`/deploying
   — none of that was performed in this program.

### I. Explicit confirmation

- **Netlify: untouched.** No build triggered, no deploy, no config
  change.
- **No deploy performed** at any point in this program.
- **No production database mutation.** Every database interaction this
  program performed was either read-only (`execute_sql` against
  `tamma-customer-data`, confirming trigger/function state) or against
  this session's own in-memory test harness (`tests/helpers/canonical-
  core-harness.ts`'s `global.fetch` mock) — never the real Supabase
  REST/RPC endpoints.
- **No real transaction was ever created.** Every booking/preorder/order/
  redemption referenced in this document was created inside the offline
  test harness against mocked data, never against `tamma-customer-data`.
- **`main` untouched.** All work stayed on
  `feature/thongthai-one-mind-architecture`.

### Commands the next agent/session should run first

```bash
cd /home/user/tamma-chat
git fetch origin feature/thongthai-one-mind-architecture
git checkout feature/thongthai-one-mind-architecture
git pull --ff-only origin feature/thongthai-one-mind-architecture
npm test   # expect 638/638 passing
git log --oneline -20
```

---

## LOCAL CONCIERGE INTELLIGENCE FRAMEWORK (post-deploy, branch work — NOT DEPLOYED)

Branch: `feature/local-concierge-intelligence`, based on `main` (which
already contains the merged release candidate from PR #42,
`main@2cb2e88`). **Not merged, not deployed.** Owner will decide deploy
later.

### Observed post-deploy gap

After the release candidate went live, a real customer message —
"อิสานมีอะไรดี ช่วงนี้ฝนตกไหมอะ" — exposed a structural gap, not a one-off
phrase miss: Thongthai had no general way to answer local-area, weather-
condition, food-culture, visitor-journey, activity-suitability, or safety-
uncertainty questions. These aren't rare edge cases for a concierge for a
real rural Isan/Chaiyaphum property — they're a normal, broad class of
things a real visitor asks. Patching only the one observed sentence would
have left the next 50 phrasings of the same underlying question classes
unanswered.

### Framework added

Three new pure, side-effect-free modules, following the exact same
discipline already established by `_ecosystem-entity-graph.ts` (static
structural knowledge, never a mutable/real-time fact) and
`_deterministic-semantic-turn.ts` (small closed marker sets, never a
growing phrase table):

- **`_local-concierge-knowledge.ts`** — the STATIC LOCAL KNOWLEDGE pack
  (season guidance for hot/rainy/cool, region/place character, food-
  culture style, general safety principle). A lookup table, not prose —
  extend by adding entries, never by writing a new paragraph per phrase.
  Explicitly documents the truth boundary: this module must never be
  asked for a real-time fact (current weather, current availability).
- **`_local-concierge-intent.ts`** — structural classifiers for 6
  categories (`weather_condition`, `region_place`, `food_culture`,
  `visitor_journey`, `activity_suitability`, `safety_uncertainty`), each a
  small set of grammatical/vocabulary markers, plus
  `hasExplicitTransactionIntent` — the guard that makes local-concierge
  questions yield to a real booking/confirm/signup/accept-offer signal in
  the same message (Routing Safety, category F below).
- **`_local-concierge-response.ts`** — pure composer, one function per
  category, following the required shape (direct answer → local context →
  best options → real-time-data caveat → at most one follow-up). Every
  business name it prints comes from `_ecosystem-entity-graph.ts`'s real
  node labels, never invented.

Wired into `thongthai-chat.ts` as `deterministicLocalConciergeResponse`,
called from `processThongthaiChatCore` at **two** points (both required,
found empirically while testing, not assumed up front):
1. In the legacy deterministic chain, right after promotion-discovery and
   right **before** the bare ecosystem broad-discovery fallback (a message
   can match both, e.g. "ฝนตกแล้วยังทำอะไรได้บ้าง" also matches
   `isExperienceDiscoveryIntent`'s own "ทำอะไรได้บ้าง" pattern — the more
   specific, weather-aware answer wins) and before the activity/restaurant
   deterministic responses (so a blended question like "ฝนตกขี่ม้าได้ไหม"
   gets concierge reasoning, not a generic activity-inventory answer that
   silently drops the weather framing).
2. A matching `preserveLocalConciergeFastPath` guard added alongside the
   **existing** `preserveExperienceDiscoveryFastPath`/
   `preserveRestaurantFastPath` guards, right before the One-Mind cutover
   block. **Found and fixed a real gap while testing**: without this,
   One-Mind's own structural markers (`findActivityTopic` matching "ม้า")
   claimed a blended message like "ฝนตกขี่ม้าได้ไหม" as plain activity-
   topic discovery BEFORE `deterministicLocalConciergeResponse` ever got a
   turn — confirmed by writing a permanent regression test
   (`local-concierge-intelligence.test.ts`'s tests A2 and E) and verifying
   it fails when this guard is disabled. This reuses the exact precedent
   these two existing guards already established — not new architecture,
   the same pattern extended once more.

### Categories covered

Weather/condition, place/region, food-culture, visitor-journey, activity-
suitability, safety-uncertainty — all 6, per the owner's spec. General
safety questions with a comparison shape ("ตัวไหนนิสัยดีกว่า") are
deliberately left to the EXISTING `detectCompareEntities`/
`cannot_verify_comparison` path in `_deterministic-semantic-turn.ts`
(already correct, already tested in Gate 5) rather than duplicated here.

**Phase 2 added `location` and `horse_comparison` — see the "PHASE 2"
section below** for those two categories, the real owner Maps link, the
weather-provider abstraction, and the classifier-precision fixes.

### Tests added

`tests/local-concierge-intelligence.test.ts` — 8 tests, grouped by
category A-F exactly as specified, driven through the real
`processThongthaiChatCore`, never hand-constructed `SemanticTurn`s.
Verified the One-Mind fast-path-guard fix is load-bearing (not vacuous) by
disabling it and confirming tests A2/E fail, then restoring it.

(Phase 2 adds `tests/local-concierge-phase2.test.ts` and
`tests/weather-provider.test.ts` — see the "PHASE 2" section below.)

### Examples: before vs after

| Message | Before | After |
|---|---|---|
| "อิสานมีอะไรดี ช่วงนี้ฝนตกไหมอะ" | generic "ไม่มีข้อมูลที่ยืนยันได้" apology | honest no-live-weather caveat + real seasonal guidance + connects to ตำมา-ชาติ/Inthanin/เฮือนสเตย์ |
| "ฝนตกขี่ม้าได้ไหม" | plain horse-inventory listing (weather framing silently dropped) | "cannot confirm live ground conditions, generally rideable in normal weather, please confirm with staff on the day" |
| "มีเวลา 3 ชั่วโมง จัดทริปให้หน่อย" | generic apology (fell through to unavailable LLM) | short journey suggestion touching food/stay/activity/cafe, asks the one genuinely missing detail (companions) |
| "ทำมา-ชาติฟีลแบบไหน" | generic apology | short, real region-character answer |
| "มีเวลา 3 ชั่วโมง จองขี่ม้าเลย" (explicit book-now) | (untested) | correctly yields to the real activity booking flow, not journey-planning copy |

### Facts still missing (honest, documented)

Same truth boundary as always in this program: this framework answers
from STATIC local knowledge only. It has no live weather integration, no
live ground-condition sensor, and does not override staff's real safety
judgment at the property — every weather/safety response explicitly says
so and defers to staff/"check when you arrive." If the owner wants an
actual live weather source integrated later, that is real new
infrastructure (a weather API adapter wired through
`_knowledge-resolver.ts`'s existing adapter pattern), not something this
static-knowledge framework should fake.

~~Known remaining classifier gaps~~ — **fixed in Phase 2** (below): the
"อีสาน/อิสาน" spelling variant, "มีไรดี/มีไรบ้าง" colloquial contractions,
the "ปะ" sentence-final question particle, and bare companion/mood
mentions ("มากับแฟน", "อยากชิล") with no other signal are now all
recognized. See the "PHASE 2" section's "Gaps fixed" subsection for the
exact before/after and the food-culture-vs-visitor-journey ordering fix
that had to accompany the bare-companion broadening.

### Deploy status: NOT DEPLOYED

No Netlify, no deploy, no DB migration, no production DB mutation, no
transaction created. All work is on `feature/local-concierge-intelligence`
(pushed to `origin`), untouched by any of tonight's/this session's deploy
activity on the actual release candidate.

### Next step

Owner review of the framework design and the before/after examples above,
then a deploy decision (merge to `main` + Netlify deploy, following the
SAME pre-deploy checklist/watch-window discipline already used for the
release candidate itself).

---

## LOCAL CONCIERGE INTELLIGENCE FRAMEWORK — PHASE 2 (real location, real
## weather provider, horse facts, precision fixes) — still NOT DEPLOYED

Same branch: `feature/local-concierge-intelligence`. This phase finishes
the ONE improvement above per the owner's own explicit scope boundary —
**Service Mind / Feedback Operations / customer-feedback routing is a
separate, second improvement and was deliberately NOT started.**

### 1. Real location

`_local-concierge-location.ts` (new) stores the owner-provided official
Google Maps link as the canonical location fact:
`https://maps.app.goo.gl/1Zm9D9uxyezX373J6?g_st=ic`.

This session's sandboxed environment could **not** resolve that short link
to coordinates/address — outbound network access to `maps.app.goo.gl` is
blocked by the environment's own egress policy (confirmed via both a
direct `curl`, which got a proxy `403`/`connect_rejected`, and the
`WebFetch` tool, which returned an explicit `EGRESS_BLOCKED` error — not a
timeout, not a DNS failure). Per the owner's own explicit instruction for
this exact case, the fallback was followed exactly: the Maps link is
stored as canonical, **no address or coordinates were invented**, and an
explicit `TODO(owner/next session)` comment is left in the file (with the
exact resolution failure documented) until a future session — with either
network access to `maps.app.goo.gl` or an owner-supplied lat/lon — can
resolve it.

New `location` category in `_local-concierge-intent.ts` (`LOCATION_MARKER`
covers อยู่ที่ไหน / ขอโลเคชั่น / ไปยังไง / ปักหมุดให้หน่อย / ใกล้อะไร) and
`composeLocationResponse` in `_local-concierge-response.ts` answers with
the real link (would also surface a resolved address once
`resolutionStatus` flips to `'resolved'`).

### 2. Weather provider abstraction

`_weather-provider.ts` (new) exports `getWeatherForTammaLocation()`:
current condition, precipitation chance, temperature, forecast summary,
source, fetch timestamp if available — or a structured `unavailable`
result (`no_api_key_configured` / `unsupported_provider` /
`location_not_resolved` / `provider_error`) if not, **never** a thrown
error and **never** a block on the concierge answer. Shaped around
OpenWeatherMap's free current-weather endpoint (same graceful-absence
pattern as `_thongthai-model-provider.ts`'s own
`GEMINI_API_KEY`/`OPENAI_API_KEY` checks), but every caller depends only on
the `WeatherResult` contract, so swapping providers later needs no
caller-side change.

**Status: NOW LIVE in production config, per Phase 3 below** — the owner
configured `WEATHER_API_KEY`, `TAMMA_WEATHER_LAT`, and `TAMMA_WEATHER_LON`
in Netlify. See the "PHASE 3" section for the exact env var contract, the
classification of `TAMMA_WEATHER_LAT`/`LON` as its own coordinate source
(deliberately separate from `TAMMA_CHART_LOCATION`'s still-unresolved
Maps-link address), and the forecast-limitation and ground-condition
handling added alongside it. **`WEATHER_PROVIDER` was originally also
required but is now OPTIONAL (defaults to `openweathermap`) — see the
"HOTFIX — exposed secrets, round 2" section near the end of this doc for
why, and the exact owner action (delete it from Netlify) that goes with
it.**

`composeWeatherConditionResponse` and `composeActivitySuitabilityResponse`
are now `async` and call `getWeatherForTammaLocation()`:
- **Available**: cites the live data with "จากข้อมูลล่าสุด..." (source +
  condition/temperature/precipitation chance), still gives practical local
  guidance, and — for activity-suitability specifically — still never
  claims the actual ground condition ("สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกที
  ครับ") since rain/no-rain from an API is not the same as a confirmed
  on-site ground reading.
- **Unavailable**: says exactly "ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันใน
  ระบบครับ" (never a generic failure, never "คิดช้า"/"เชื่อมต่อไม่ได้"),
  still gives safe seasonal guidance, suggests checking again closer to
  arrival or with staff.

`deterministicLocalConciergeResponse` in `thongthai-chat.ts` is now
`async` (it awaits the composer); its one call site in
`processThongthaiChatCore` now `await`s it. The
`preserveLocalConciergeFastPath` guard stays synchronous — it only calls
the classifier, never the composer.

### 3. Horse ride-feel facts (owner-verified)

`_local-concierge-knowledge.ts` gained `HORSE_FACTS` — the ENTIRE
configured fact set for each horse, nothing more:
- ทองไทย: "ขี่กระด้างกว่านิดนึง", ขี้เล่นน่ารัก
- ภาราดร: "ขี่นิ่มกว่านิดหน่อย", ขี้เล่นน่ารัก

New `horse_comparison` category. `composeHorseComparisonResponse` uses
exactly these facts, in the owner's own allowed phrasing style ("ทองไทยจะ
ให้ฟีลแน่น ๆ ขี่กระด้างกว่านิดนึง ส่วนภาราดรจะขี่นิ่มกว่านิดหน่อย แต่ทั้งคู่
ขี้เล่นน่ารักครับ 😊"), and explicitly defers anything beyond ride-feel
("เรื่องความเหมาะสมเฉพาะคน... ขอให้ทีมงานช่วยแนะนำหน้างานอีกที") — never a
safety guarantee, never a beginner-suitability claim, never "X ดีกว่า Y"
framing.

**Critical guard, verified load-bearing**: `HORSE_ATTRIBUTE_EXCLUSION_MARKER`
(นิสัย|อารมณ์|มือใหม่|เริ่มต้น|หัดขี่|อายุ|เพศ|ขนาด|น้ำหนัก — mirrors
`_deterministic-semantic-turn.ts`'s own `COMPARE_ATTRIBUTE_KEYWORDS`
exactly) stops `horse_comparison` from ever firing on a temperament or
beginner-suitability question, so those keep going to the EXISTING,
already-correct `detectCompareEntities`/`cannot_verify_comparison` path
(Gate 5) instead of getting an irrelevant ride-feel answer. Verified this
is load-bearing the same way the Phase 1 fast-path guard was verified: a
blended probe message ("ตัวไหนขี่นิ่มกว่า เหมาะกับมือใหม่ไหม") was run with
the guard temporarily removed — it incorrectly returned the ride-feel
facts — then the guard was restored and the same probe correctly fell
through to the honest "ไม่มีข้อมูล... ไม่ขอเดา" decline.

### 4. Gaps fixed from the Phase 1 report

- **Typo/casual spelling**: อีสาน**/อิสาน** now both recognized;
  "มีไรดี"/"มีไรบ้าง" (colloquial อะไร→ไร contraction) added alongside
  "มีอะไรดี"/"มีอะไรบ้าง"; "ปะ" added as a sentence-final "ไหม" alternative
  ("แดดแรงปะ").
- **Bare companion/mood mentions**: "มากับแฟน", "มากับครอบครัว", "มีเด็ก",
  "มีผู้สูงอายุ", "พาแม่มา"/"พาลูกมา"/etc., "อยากชิล", "อยากลุย" now qualify
  `visitor_journey` on their own (previously required pairing with a
  planning verb or visitor-type marker).
- **Ordering fix that had to accompany the above**: `food_culture` is now
  checked *before* `visitor_journey` in `classifyLocalConciergeQuestion`
  (previously the reverse) — otherwise the now-broadened bare-companion
  match would have stolen a message like "มากับแฟนกินอะไรดี" away from
  food_culture. Covered by its own test ("food-culture questions still win
  over a bare companion mention").

### Tests added (Phase 2)

- `tests/local-concierge-phase2.test.ts` — 6 tests: location (A), typo/
  casual-phrasing tolerance (C), bare visitor-context (D), food-culture-
  vs-bare-companion ordering (E), horse ride-feel facts (G), and routing
  safety for the two new categories (H) — including the guard-load-bearing
  probe described above.
- `tests/weather-provider.test.ts` — 6 tests: unavailable/no key
  configured (structured result, no crash); unavailable/location not
  resolved even with a key; configured+resolved uses real fetched data and
  cites source/freshness; provider error degrades to unavailable, never
  throws; end-to-end with mocked live weather (response cites freshness,
  still never claims actual ground condition); end-to-end unavailable
  (plain honest message, never a generic failure).
- All driven through the real `processThongthaiChatCore` (or, for the
  provider unit tests, the real `getWeatherForTammaLocation` — never a
  hand-constructed `SemanticTurn` or a hand-built `WeatherResult` fed
  straight to a composer in isolation). **Full suite: 658/658 passing**
  (646 from Phase 1 + 12 new).

### Sample improved answers

| Question | Response shape |
|---|---|
| "วันนี้อากาศเป็นยังไงบ้าง" (rain-ish framing, no weather API configured) | "ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ" + real seasonal prep guidance + indoor-friendly options |
| "วันนี้ขี่ม้าได้ไหม แดดแรงปะ" (with weather API mocked available) | "จากข้อมูลล่าสุด (openweathermap): แดดจัด อุณหภูมิประมาณ 34°C" + "ขี่ม้าเล่นได้ในสภาพอากาศปกติ แต่สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ" |
| "ขอโลเคชั่นหน่อย" | the real owner Maps link, "กดลิงก์แล้วกดนำทางได้เลยครับ" |
| "อิสานมีอะไรดี" / "อีสานมีไรดี" | real region-character answer (fixed spelling/contraction gap) |
| "มากับแฟน" (bare, no question) | short journey-planning offer touching food/stay/activity/cafe, asks the one missing detail (available time) |
| "ทองไทยกับภาราดรขี่ต่างกันยังไง" | "ทองไทยจะให้ฟีลแน่น ๆ ขี่กระด้างกว่านิดนึง ส่วนภาราดรจะขี่นิ่มกว่านิดหน่อย แต่ทั้งคู่ขี้เล่นน่ารักครับ 😊" + defers beginner/health suitability to staff |

### Remaining gaps (honest, documented)

- Maps link coordinates/address: **unresolved** (network-blocked this
  session; TODO left in `_local-concierge-location.ts`).
- Live weather: the provider is built and tested (with a mocked API) but
  **not live** in any real environment yet — needs `WEATHER_API_KEY` set
  AND the coordinates above resolved before it can ever return `status:
  'ok'` for real.
- Classifier precision is still a closed marker set, not a general NLU —
  a sufficiently novel phrasing of any of these question types can still
  structurally miss and fall through to the broader fallback chain (this
  is the same, deliberate trade-off as `_deterministic-semantic-turn.ts`
  itself; extend by adding a marker, never by hand-listing more exact
  phrases).

### Deploy status: NOT DEPLOYED (Phase 2)

No Netlify access used, no deploy, no DB migration, no production DB
mutation, no real transaction created. All Phase 2 work is on the same
`feature/local-concierge-intelligence` branch (pushed to `origin`),
untouched by and unrelated to the release candidate's own deploy.

### Next step (Phase 2)

Owner review of: the location TODO (resolve via network access or a
supplied lat/lon), the weather-provider go-live requirement
(`WEATHER_API_KEY`), the horse-facts phrasing, then a single deploy
decision for the whole Local Concierge Intelligence Framework (Phase 1 +
Phase 2 together) — no partial deploy of just one phase is intended.

---

## LOCAL CONCIERGE INTELLIGENCE FRAMEWORK — PHASE 3 (live weather, now
## configured in production) — still NOT DEPLOYED

Same branch: `feature/local-concierge-intelligence`. The owner configured
4 Netlify env vars for production (`WEATHER_PROVIDER=openweathermap`,
`WEATHER_API_KEY=<configured in Netlify>`,
`TAMMA_WEATHER_LAT=<configured in Netlify>`,
`TAMMA_WEATHER_LON=<configured in Netlify>`). This phase wires the weather
provider to read exactly those 4 vars and finishes the live-weather
answer shapes. (Their real values are never written into this repo — see
the "HOTFIX — exposed secrets" section below for why even the
non-sensitive lat/lon values must stay out of committed files once
they're configured as Netlify env vars.)

### What changed

- **`_weather-provider.ts` rewritten** to read `WEATHER_PROVIDER`,
  `WEATHER_API_KEY`, `TAMMA_WEATHER_LAT`, `TAMMA_WEATHER_LON` directly from
  `process.env` (previously it read `WEATHER_API_KEY` plus
  `TAMMA_CHART_LOCATION.latitude`/`longitude`, which are the Maps-link
  module's own, still-unresolved coordinates). `TAMMA_WEATHER_LAT`/`LON`
  are their own, independent coordinate source — the owner supplied them
  specifically for weather and they do **not** depend on the Maps-link
  address-resolution TODO in `_local-concierge-location.ts` at all, which
  is why weather can go live even though that TODO is still open.
  Check order: `WEATHER_API_KEY` missing → `no_api_key_configured`;
  `WEATHER_PROVIDER` not exactly `'openweathermap'` → `unsupported_provider`
  (a new reason code — the module implements only this one provider, and
  says so explicitly rather than silently ignoring an unrecognized value);
  `TAMMA_WEATHER_LAT`/`LON` missing or not parseable as a number →
  `location_not_resolved`; non-`ok` HTTP response or a thrown fetch error →
  `provider_error`. Every branch returns the same structured
  `WeatherResult`, never throws.
- **Forecast-limitation handling** (new): the provider only implements
  OpenWeatherMap's *current*-conditions endpoint, not a real forecast API.
  A question shaped around a future day ("พรุ่งนี้ฝนตกไหม", "มะรืนนี้...",
  "พยากรณ์...") now gets an explicit line saying today's data is current
  conditions only, not a confirmed forecast — never silently answered as
  if today's reading confirms tomorrow's weather, and never a definite
  claim about a future day either way.
- **Ground-condition caveat** (already existed from Phase 2, reconfirmed
  here): `composeActivitySuitabilityResponse` and
  `composeWeatherConditionResponse` both still say "สภาพพื้นจริงหน้างานต้อง
  ให้ทีมดูอีกทีครับ" whether or not live weather is available — rain/no-rain
  from an API is never treated as a confirmed on-site ground reading.
  Pure safety-shaped questions ("พื้นลื่นไหม เล่น ATV ได้ไหม") already went
  through `composeSafetyUncertaintyResponse`, which has always deferred
  ground condition/individual suitability to staff — reconfirmed by a new
  end-to-end test, no code change needed there.

### 1. Env var names used (exact)

`WEATHER_PROVIDER`, `WEATHER_API_KEY`, `TAMMA_WEATHER_LAT`,
`TAMMA_WEATHER_LON` — read directly in `_weather-provider.ts`, no
aliasing, no fallback names.

### 2. OpenWeatherMap endpoint used

`https://api.openweathermap.org/data/2.5/weather?lat={TAMMA_WEATHER_LAT}&lon={TAMMA_WEATHER_LON}&units=metric&appid={WEATHER_API_KEY}`
— the free current-conditions endpoint (not the forecast endpoint; see
"Forecast-limitation handling" above for how a forecast-shaped question is
handled without one).

### Files changed (Phase 3)

`_weather-provider.ts` (env-var contract rewritten), `_local-concierge-response.ts`
(`composeWeatherConditionResponse` and `composeActivitySuitabilityResponse`
gained forecast-limitation handling; the latter's signature now also takes
`message`), `tests/weather-provider.test.ts` (rewritten for the new env-var
contract, extended to 10 tests).

### Tests added/updated (Phase 3)

`tests/weather-provider.test.ts` — 10 tests: no env configured; provider
missing/unsupported (with a key present); lat/lon missing or invalid (with
provider+key present); all 4 vars configured — calls OpenWeatherMap with
the *exact* configured lat/lon/key (asserted against the real mocked
request URL) and uses the real fetched data; provider HTTP error degrades
to unavailable, never throws; end-to-end "ฝนตกไหม"/"แดดออกไหม" use live
mocked weather and cite freshness/source; end-to-end "แดดแรงไหม ไปทำอะไรดี"
uses live weather AND gives a local recommendation; end-to-end "พรุ่งนี้
ฝนตกไหม ขี่ม้าได้ไหม" explains the forecast limitation correctly; end-to-end
"พื้นลื่นไหม เล่น ATV ได้ไหม" never claims actual ground condition; end-to-end
unavailable case still says the plain honest message. All driven through
the real `getWeatherForTammaLocation`/`processThongthaiChatCore`, weather
data mocked only at the `global.fetch` boundary (same discipline as the
canonical test harness's own Supabase/Gemini mocking).

### Full test result

**662/662 passing** (658 from Phase 1+2, +4 net new in Phase 3's rewritten
weather-provider suite). Existing local-concierge tests (Phase 1's 8,
Phase 2's 6) unaffected — verified by re-running the full suite after the
env-var-contract rewrite.

### Sample answers

| Question | Response |
|---|---|
| "ฝนตกไหม" (live weather mocked available) | "จากข้อมูลล่าสุด (openweathermap): ฝนตกปรอยๆ อุณหภูมิประมาณ 26°C โอกาสฝนประมาณ 8%" + seasonal prep guidance + "สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ" |
| "แดดแรงไหม" | "จากข้อมูลล่าสุด (openweathermap): แดดจัด อุณหภูมิประมาณ 35°C" + practical heat guidance + indoor-friendly options |
| "พรุ่งนี้ฝนตกไหม ขี่ม้าได้ไหม" | live current-data line + "ข้อมูลนี้เป็นสภาพอากาศปัจจุบัน ยังพยากรณ์ล่วงหน้าแบบยืนยัน 100% ไม่ได้ครับ" + "ขี่ม้าเล่นได้ในสภาพอากาศปกติ แต่สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ" |
| "พื้นลื่นไหม เล่น ATV ได้ไหม" | general safety guidance, explicitly defers ground condition/individual suitability to staff on-site — never asserts the ground is or isn't slippery |

### 7. Ready to merge/deploy?

**Code and tests: ready.** All 662 tests pass, including the exact-URL
assertion that the provider calls OpenWeatherMap with the real configured
`TAMMA_WEATHER_LAT`/`TAMMA_WEATHER_LON`/`WEATHER_API_KEY`. This session has
**no way to verify the live OpenWeatherMap call actually succeeds against
production's real key/coordinates** — no outbound network access in this
sandboxed environment (same confirmed limit as earlier in this session).
The mocked tests prove the code's *logic* is correct; they cannot prove
the real API call from production will succeed. Recommend: after this
merges/deploys, the owner (or a session with production access) sends one
real weather question and confirms a live, non-"unavailable" answer comes
back before considering weather fully verified end-to-end.

Per the "one final deploy" instruction: **this PR is not deployed by this
session.** One clean merge/deploy instruction:
```
git checkout main && git pull origin main
git merge --no-ff feature/local-concierge-intelligence
git push origin main
# then: Netlify deploy of main (single deploy — Phase 1+2+3 together)
```

### 8. Confirmation

No production transaction created, no DB migration, no unnecessary
Netlify deploy performed by this session — all env-var reading was via
`process.env` in code/tests only, never a live call against the owner's
real key (every test mocks `global.fetch`). Work remains on
`feature/local-concierge-intelligence`, pushed, not merged, not deployed.

**Update:** merged to `main` via PR #43 (`be2babb`), tree-identical to the
tested branch tip.

---

## HOTFIX — weather routing production incident (on top of PR #43)

Live smoke on production after PR #43 reported "ฝนตกไหมตอนนี้" and
"ฝนตกไหม" returning the generic LLM-outage apology ("...ทองไทยคิดช้ากว่า
ปกติ...") instead of a weather answer.

### Root cause

That exact apology string is `availabilityBrainResponse()`, reachable from
exactly ONE place in the whole codebase: `thongthai-chat.ts`'s catch
branch for `LLMAvailabilityError` thrown by `runThongthaiBrain` (the real
LLM call), reached only after every deterministic responder ahead of it
(including the local-concierge one) returned `null`. Reproducing the exact
production-reported phrases through the full `processThongthaiChatCore`
path in every provider state (unset / mocked success / mocked HTTP error)
showed the classifier and composer both already handle them correctly —
so the apology could only mean the local-concierge deterministic responder
was skipped or crashed before it could answer.

Two real, confirmed gaps (found by code inspection, not guessed):
1. **No defensive `.catch()`** around `deterministicLocalConciergeResponse`'s
   call site in `processThongthaiChatCore` — every sibling deterministic
   responder (`promotionDiscoveryFallbackResponse`,
   `deterministicActivityResponse`, `deterministicRestaurantResponse`) is
   wrapped in `.catch(error => { console.error(...); return null; })`, but
   this one, added in Phase 1, was not. If anything in the local-concierge
   composer path threw, the exception would escape `processThongthaiChatCore`
   entirely uncaught (there is no top-level try/catch around it, nor around
   the Netlify `handler` that calls it) — a hard crash, not a graceful
   apology. **Verified load-bearing**: forced a throw inside
   `getWeatherForTammaLocation` via a temporary test-only env flag, removed
   the `.catch()`, confirmed the request crashed uncaught (worse than the
   apology — no response at all), then restored both and confirmed it
   degrades gracefully to a real answer instead.
2. **No timeout on the OpenWeather fetch** — a hung/slow provider call
   would `await` indefinitely, with no upper bound, inside a function with
   no defensive catch above it (gap 1). Added a 6-second `AbortController`
   timeout; a timeout now degrades to `status: 'unavailable', reason:
   'timeout'`, the same structured shape as every other failure mode.

Separately, investigating this surfaced an **unrelated test-infrastructure
bug**: several of Phase 3's own "mocked weather success" end-to-end tests
were silently not exercising their intended mock at all.
`withHarness` (the shared test harness) unconditionally installs its own
`global.fetch` mock for its whole run and restores the real one only
afterward — a `global.fetch = myMock` set *before* calling `withHarness`
is invisible to any code that runs inside it. Its own fallback for an
unrecognized domain (which an unprogrammed OpenWeatherMap call would hit)
returns an empty-but-`ok:true` list, which `_weather-provider.ts` reads as
a real (if data-less) success — so the affected tests passed for the wrong
reason (asserting only the `"จากข้อมูลล่าสุด"` prefix, which appears
regardless of whether real mocked data made it through). Fixed by adding
`harness.programWeatherFetch({ ok, body })` to `canonical-core-harness.ts`
(the same pattern as its existing `programGeminiReply`), and updated every
affected Phase 3 test to use it and to additionally assert the actual
mocked data value, not just the prefix.

### Files changed (hotfix)

- `netlify/functions/thongthai-chat.ts` — added `.catch()` around
  `deterministicLocalConciergeResponse`'s call site.
- `netlify/functions/_weather-provider.ts` — added an `AbortController`-based
  6s timeout (`timeoutMs` parameter, default 6000, overridable for tests);
  new `'timeout'` reason code.
- `tests/helpers/canonical-core-harness.ts` — added
  `programWeatherFetch` + its routing branch (additive; no existing test's
  behavior changed).
- `tests/weather-provider.test.ts` — rewritten to use
  `programWeatherFetch` throughout; added the exact production-reported
  phrases as a dedicated regression test across all 3 provider states, a
  timeout regression test, and a synchronous-throw regression test.

### Tests added

3 new tests in `tests/weather-provider.test.ts` (now 13 total, was 10):
"exact production-reported phrases never return the generic LLM-outage
apology, in any provider state" (unset / mocked success / mocked
failure — pins both exact phrases from the report), "OpenWeather fetch
that hangs past the timeout degrades to unavailable, never crashes, never
hangs indefinitely", "a fetch that throws synchronously... still degrades
gracefully". Every existing Phase 1/2/3 local-concierge test still passes
unmodified.

### Full test result

**665/665 passing** (662 before this hotfix + 3 net new).

### Ready for one hotfix deploy?

Yes. Small, targeted diff (2 defensive fixes + a test-infrastructure fix +
regression tests), all green, both fixes verified load-bearing via the
established revert-and-confirm methodology. No DB migration, no
production transaction.

**Update:** merged to `main` via PR #44 (`f1e0d6b8`). Netlify then
reported the deploy of that commit FAILED its own secrets scan (see the
next section) -- production was still serving the older `main@2cb2e88`
until that was fixed.

---

## HOTFIX — exposed secrets detected (Netlify build failure on PR #43/#44)

Netlify's production deploy of `main@f1e0d6b` (PR #44's merge) failed with
"Exposed secrets detected"; production kept serving the older
`main@2cb2e88` until this was fixed.

### Root cause

The real `WEATHER_API_KEY` was **never** in this session's possession and
does not appear anywhere in the repository — every test and every doc
reference uses an obviously-fake key (`test-openweather-key`), confirmed
by a repo-wide search for `appid=`, any 32-char hex/alphanumeric string
shaped like an OpenWeatherMap key, and the literal env var name, across
every file type (not just this feature's own files).

The actual, confirmed cause: **the real `TAMMA_WEATHER_LAT`/
`TAMMA_WEATHER_LON` coordinate values** the owner configured in Netlify
had been hardcoded, as realistic-looking test fixtures, into
`tests/weather-provider.test.ts` and quoted directly in this handoff
doc's own Phase 3 section. Netlify's secrets scanner treats the *value*
of every configured environment variable as sensitive by default — not
only variables that are semantically secrets — so a literal, exact match
of a configured env var's value anywhere in the deploy source trips it,
regardless of whether that value is actually confidential. Lat/lon are
not sensitive on their own, but since they're configured as Netlify env
vars, their literal appearance in committed files is exactly what the
scanner is designed to catch. This repo's `netlify.toml` also publishes
`publish = "."` (the whole repo root, tests and docs included, not a
separate built `dist/`), so these files were genuinely part of what
Netlify was scanning.

**Was any real secret committed? No.** The coordinate values are not
secrets in a security sense (they're a public place's lat/lon), and the
actual API key was never available to this session to leak in the first
place. This was a real, but low-severity, class of mistake — reusing an
owner-supplied *configured* value as a *test fixture* — not a credential
leak.

### Fix

- Replaced every literal occurrence of the real lat/lon values with
  obviously-fake test coordinates in `tests/weather-provider.test.ts`,
  and with `<configured in Netlify>` placeholders (matching the existing
  `WEATHER_API_KEY=<configured in Netlify>` convention) in this handoff
  doc's Phase 3 section.
- Renamed the test fixture key from `'test-key'` to `'test-openweather-key'`
  everywhere, so it's unambiguous at a glance in any future diff that
  it's a placeholder, never real.
- Added `redactWeatherUrl()` to `_weather-provider.ts` — strips
  `appid=<value>` out of any string before it could ever reach a log
  line — and applied it defensively at `thongthai-chat.ts`'s
  `deterministicLocalConciergeResponse` `.catch()` handler (some fetch
  implementations embed the request URL, key included, in their own
  error `.message`; the provider's own internal try/catch already
  prevents this from happening in the normal case, but this is
  belt-and-braces at the one place upstream of it that logs anything).
- Confirmed (grep sweep, see below) the weather provider is never
  imported by any static/client file (`index.html`, `account.html`,
  `chess.html`, `menu.html`) — it already only lived under
  `netlify/functions/`, called only from other `netlify/functions/`
  modules and this test file. No client-bundle boundary violation
  existed; a regression test now pins this.
- Added `WEATHER_PROVIDER`/`WEATHER_API_KEY`/`TAMMA_WEATHER_LAT`/
  `TAMMA_WEATHER_LON` (all empty) to `.env.example` for documentation,
  matching the existing pattern for the other provider keys.

### Files changed

`tests/weather-provider.test.ts` (literal values replaced; 4 new
SECRETS-prefixed tests), `THONGTHAI_HANDOFF.md` (this section + the
Phase 3 section's placeholder fix), `netlify/functions/_weather-provider.ts`
(`redactWeatherUrl` export), `netlify/functions/thongthai-chat.ts`
(applies it at the one relevant log site), `.env.example`.

### Tests added

4 new tests in `tests/weather-provider.test.ts` (now 17 total, was 13):
`redactWeatherUrl` strips `appid=` correctly (including mid-string and
case-insensitively); test-key isolation (this file and the shared harness
only ever set the fake key); a pinned regression guard that the two
specific real coordinate values never reappear in this test file or the
handoff doc; and a client-bundle-boundary check that no static HTML file
references the weather provider, its env var names, or the OpenWeatherMap
endpoint.

### Full test result

**669/669 passing** (665 before this hotfix + 4 net new).

### Netlify deploy status

This session has no Netlify access (confirmed multiple times earlier in
this program) and so cannot open the failed deploy's own details to
confirm Netlify's exact reported file/line, nor can it confirm the next
deploy actually passes the scan — that confirmation has to come from the
owner (or a session with Netlify access) after this merges. Everything
above is a direct, provable fix for the one concrete leak this session
could find and reproduce (the literal coordinate values); if Netlify's
next scan still fails, its failure details will name the exact
file/path/line to fix next — per the owner's own instruction, that should
be fixed at the source, never bypassed by disabling scanning.

### Confirmation

No DB migration, no production transaction. Exactly one more merge to
`main` for this hotfix (no repeated deploy spam) — see the PR link in
this session's final report.

---

## HOTFIX — exposed secrets, round 2 (WEATHER_PROVIDER removed as a requirement)

Production deploy of `main@bbffd9bd` (round 1's own hotfix) **still**
failed Netlify's secrets scan. This session has no Netlify access and so
could not open the failed deploy's own details to read the exact
file/line it names (same confirmed limit as every prior round). Round 1
already removed the one leak this session could find and reproduce (the
literal `TAMMA_WEATHER_LAT`/`LON` values) — round 1's report said
explicitly that if the scan still failed, Netlify's own failure details
would be needed to find the next cause. Absent those details, the next
most plausible cause, reasoned from first principles, is
`WEATHER_PROVIDER=openweathermap`: **preview deploys passed, only
production failed**, which is consistent with Netlify's secrets scan
running only (or more strictly) against the production build context —
i.e. only checking env vars that are actually SET for that context. The
string `"openweathermap"` legitimately appears throughout this
repository's own source, tests, and docs (it's the literal provider name
in URLs, log messages, and doc examples) — entirely expected and correct
on its own. But because `WEATHER_PROVIDER` was ALSO configured as a
production env var with that exact value, Netlify's default scan (which
treats the value of any configured env var as sensitive, not just
semantically-secret ones — see round 1's section above) would flag every
one of those legitimate appearances.

**This session cannot confirm this is the actual cause** without seeing
Netlify's real failure details. What this session CAN do, and did: remove
the underlying condition entirely, so it stops being possible regardless
of whether this specific guess is right.

### Design change: WEATHER_PROVIDER is no longer required

`getWeatherForTammaLocation()` now defaults `WEATHER_PROVIDER` to
`'openweathermap'` when the env var is unset — `process.env.WEATHER_PROVIDER
|| 'openweathermap'` — and only returns `unsupported_provider` when the
var is explicitly set to something else. Production's required env vars
are now just:

```
WEATHER_API_KEY=<the real OpenWeather key>
TAMMA_WEATHER_LAT=<the real latitude>
TAMMA_WEATHER_LON=<the real longitude>
```

`WEATHER_PROVIDER` is optional — the code works correctly with it unset,
and unset is now the RECOMMENDED state precisely to keep its literal
value out of Netlify's env-var-scanning surface.

### Owner action required

**Delete the `WEATHER_PROVIDER` environment variable from the Netlify
site's production environment.** Its value (`openweathermap`) was never a
secret, but configuring it as an env var at all is what made Netlify's
scanner treat that value as one to search for — and the codebase legitimately
mentions that string elsewhere, which is what (most likely) caused the
repeated scan failure.

**Do NOT delete**: `WEATHER_API_KEY`, `TAMMA_WEATHER_LAT`,
`TAMMA_WEATHER_LON` — all three are still required and this hotfix
doesn't change how any of them are read.

### Files changed

`netlify/functions/_weather-provider.ts` (default-provider logic + header
comment rewritten to document it), `tests/weather-provider.test.ts`
(removed the requirement that `WEATHER_PROVIDER` be set anywhere except
the one explicit-unsupported-value test; added a dedicated
"defaults-when-absent" test), `.env.example` (removed `WEATHER_PROVIDER`
line entirely), `THONGTHAI_HANDOFF.md` (this section + a pointer added to
the Phase 3 section above).

### Tests added/updated

`tests/weather-provider.test.ts` is now 18 tests (was 17): split the old
combined "WEATHER_PROVIDER missing/unsupported" test into two precise
ones — "WEATHER_PROVIDER absent: defaults to openweathermap and is NOT
required" (asserts the real call still goes to OpenWeatherMap with no
provider var set at all) and "WEATHER_PROVIDER explicitly set to an
unknown value: returns unsupported_provider, no crash" (the only
remaining case that can still fail this way). Every other existing test
updated to no longer set `WEATHER_PROVIDER` in its setup, since production
won't have it either once the owner deletes it.

### Full test result

**670/670 passing** (669 before this round + 1 net new — split one test
into two, +1 overall).

### Repo-wide secret sweep (this round)

Re-ran the same sweep as round 1 (grep for `appid=`, key-shaped
hex/alphanumeric strings, the literal env var names, and the specific
previously-leaked coordinate values) across the whole repository, not
just this feature's files. No real secret value found anywhere — the
`WEATHER_API_KEY` was never in this session's possession in any round.

### Main commit

Round 2's hotfix PR is linked in this session's final report; the merge
commit SHA is there too.

### Deploy instruction

**After the owner deletes `WEATHER_PROVIDER` from Netlify AND this
hotfix's PR is merged, trigger exactly one production deploy.** If
Netlify's scan still fails after both of those, the failure details
becomes the only reliable next lead (this session still has no Netlify
access to read them directly) — the owner or a session with Netlify
access should open the failed deploy and report the exact file/path/line
it names, rather than this session guessing a third time.

### Confirmation

No DB migration, no production transaction. Exactly one more merge to
`main` for this hotfix — no repeated deploy spam from this session.
