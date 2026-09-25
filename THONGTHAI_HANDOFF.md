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

---

## WORDING IMPROVEMENT — translate OpenWeather condition text to Thai (NOT DEPLOYED, awaiting owner approval)

Live production smoke (after round 2's merge) confirmed the weather
integration works end-to-end: "จากข้อมูลล่าสุด (openweathermap): few
clouds อุณหภูมิประมาณ 25°C ...". The only gap: OpenWeatherMap's
`description` field comes back as raw English, so it appeared verbatim in
an otherwise-Thai reply.

`_weather-provider.ts` gained `translateWeatherCondition()` — a small,
closed lookup table (OpenWeatherMap's `description` field is always one
of a documented, bounded set of lowercase English phrases, never free
text, so this is a structural mapping, not a growing phrase list) covering
the owner's 8 given examples plus the rest of OpenWeatherMap's common
condition vocabulary (thunderstorm/drizzle/snow/mist/fog/etc.). Applied to
`forecastSummary` before it's returned, so every caller (the
`weather_condition` and `activity_suitability` composers) gets
already-Thai text with no caller-side change needed. Anything NOT in the
table falls back to the original English string — never blank, never a
guessed translation, never blocks the reply over a wording gap.

No architecture change, no env var touched, no DB touched, no routing
change — exactly the scope asked for.

### Tests added

3 new tests in `tests/weather-provider.test.ts` (now 21 total, was 18):
all 8 owner-given examples translate correctly; case-insensitivity +
whitespace tolerance + unmapped-phrase fallback; and an end-to-end test
using a real-shaped mocked response (`description: 'few clouds'`, matching
the actual production observation) confirming the composed customer
reply contains the Thai translation and never the raw English text.

### Full test result

**673/673 passing** (670 before this change + 3 net new).

### Deploy status

**DEPLOYED.** Owner approved; PR #47 merged to `main` (`c07b46cb`). One
deploy triggered, no repeated deploys.

### Confirmation

No DB migration, no production transaction, no env var touched, no
routing change.

---

## THONGTHAI SERVICE MIND SYSTEM — 3-phase hospitality layer (NOT DEPLOYED)

Branch: `feature/service-mind-system`, based on `main`. **Not merged, not
deployed.** Owner will decide deploy later.

### Overview

Makes Thongthai behave less like a chatbot and more like a world-class
front-desk host: warm before a conversation starts, attentive and honest
during it, and a real feedback bridge to the owner/backoffice team after
it. Reuses the existing canonical architecture throughout — no new brain,
no parallel pipeline, no changes to booking/order/payment execution. The
one genuinely new subsystem is the feedback classifier + event record +
staff notification (Section 3); Sections 1 and 2 are mostly small,
narrowly-scoped additions plus verification that a lot of "during
conversation" personalization the spec asks for already exists via the
local-concierge framework from earlier phases.

### 1. Before conversation

- **Greeting** (`deterministicGreetingResponse`, `thongthai-chat.ts`):
  updated from a flat canned line to a warm host line offering real help
  categories (กิน/พัก/กิจกรรม/โลเคชั่น/อากาศ/ทริป), matching the owner's own
  example almost verbatim.
- **Vague visit intent** (`_service-mind-conversation-flow.ts`): a bare
  "จะไปเที่ยว"/"อยากไปเที่ยว" with nothing else structural now asks ONE
  companion question instead of falling through with no scaffolding.
- **Food/activity intent start** (same file): a bare "อยากกิน" or
  "อยากขี่ม้า" — confirmed empirically (before this change) that "อยากกิน"
  alone risked the generic LLM-unavailable apology (no deterministic
  scaffolding existed for it at all), and "อยากขี่ม้า" got a plain
  horse-inventory list, not a caring question — now both ask one relevant
  question (spice/allergy; riding experience/preferred feel) first. All
  three markers are deliberately narrow (exact-match, optional trailing
  punctuation only) so they never steal a message with more structure —
  those already have better-fitting handlers (local-concierge's
  `visitor_journey`/`food_culture`/`horse_comparison`/etc., which own
  anything with a companion, constraint, or named business/activity).

### 2. During conversation

Most of the personalization categories in the spec (couple trip
planning, dietary constraints, horse ride-feel facts, weather + outdoor
activity with ground-condition caveats) **already exist and already
work** via the Local Concierge Intelligence Framework built in earlier
phases (`_local-concierge-intent.ts`/`_local-concierge-response.ts`) —
verified end-to-end in `tests/service-mind.test.ts` (tests 5, 7, 8, 9)
rather than reimplemented, per the instruction not to create a parallel
architecture. No new intent-classification module was built for
weather_condition_question / itinerary_request / couple_trip / horse_
interest — those names map directly onto local-concierge's existing
`weather_condition` / `visitor_journey` / `horse_comparison` categories.

**Care-aware wording follow-up** (`_service-mind-care-context.ts`, new):
the owner's own review found the generic `visitor_journey`/`food_
culture`/`activity_suitability` composers, while correct, didn't
explicitly voice comfort/pace/safety care for family/children/elderly/
mobility context the way a real host would. Rather than modifying
local-concierge's own files (per "do not rewrite local concierge"), this
adds a small, narrow, EARLIER-checked classifier that only claims
messages combining a child/elderly/mobility marker with something else
(a family context, a mobility statement, an activity interest, a named-
activity suitability question about an elderly person, or a food
constraint) — 5 categories: `family_elderly_children`, `low_walking`,
`child_activity`, `elderly_activity_suitability`,
`child_food_constraint`. A message without one of these specific
combinations (e.g. a bare "มากับแฟน มีเวลา 3 ชั่วโมง", no child/elderly
word at all) is completely untouched and still falls through to
local-concierge exactly as before — **verified via the established
revert-and-confirm methodology**: disabling this responder broke exactly
the 5 tests that depend on it and zero others.

Genuinely new in this phase: the feedback-shaped categories the spec asks
for that had **zero** existing coverage, plus this care-context wording
layer — see Section 3.

### 3. After conversation — feedback system (the new subsystem)

**Classification** (`_service-mind-feedback-intent.ts`): a small, closed
marker set (same discipline as every other classifier in this codebase)
detecting `compliment` / `complaint` / `suggestion` / `safety_issue` /
`system_feedback` (feedback about Thongthai's own answers), plus
structural inference of `business_unit` (restaurant/activity/stay/cafe/
membership/system/general/unknown) and `severity` (low/normal/high/
urgent — a real medical/fire/accident marker always forces `urgent`
regardless of anything else in the message), and a bounded staff-name
extraction (only when an honorific + name is actually present, e.g.
"พี่เจิด" — never guessed).

Deliberately does **not** check `hasExplicitTransactionIntent` — the
classifier's own header comment explains why: a bare "ยืนยัน" trailing a
complaint ("บริการแย่มาก ยืนยัน") must be read as a complaint, not a
booking confirmation. This is enforced by **placement**, not a special
case inside the classifier: `deterministicServiceFeedbackResponse` is
wired into `processThongthaiChatCore` right after the activity-booking
fallback and before every other deterministic responder, One-Mind, and
the LLM — a feedback match returns immediately, so transaction-processing
code never sees the message at all. **Verified load-bearing** by
temporarily disabling this responder and confirming 9 of 21
`service-mind.test.ts` tests fail — notably "ร้านอาหารรอนานมาก" (a
restaurant complaint) fell through to the restaurant menu advisor and
got shown a menu instead of being treated as a complaint — then restoring
it and reconfirming all 21 pass.

**Response composition** (`_service-mind-feedback-response.ts`): sincere,
non-defensive, non-robotic acknowledgment per category, matching the
owner's own example wording closely (apology + one clarifying question
for complaint, thank-you + staff-name capture for compliment, thank-you +
no-overpromise for suggestion, urgent acknowledgment + ground-condition
deferral for safety issues). The closing "we'll route this" line is
chosen honestly by whether the staff notification actually sent/queued
(`"ส่งเรื่องให้ทีมที่เกี่ยวข้องแล้วครับ"`, past tense) vs. not yet
(`"จะส่งต่อให้เจ้านายกับทีมที่เกี่ยวข้องครับ"`, future tense) — never
claims delivery before it happened (Operational Truth Doctrine).

**Feedback event storage** (`_service-mind-feedback-events.ts` +
`supabase/migrations/20260922210000_ops_feedback_events_v1.sql`, **NOT
APPLIED**): a new, purpose-built `ops_feedback_events` table. Considered
and rejected the two existing candidates: `handoff_requests` (a
different concept — "customer needs a human now," no compliment/
suggestion types, never notified to staff) and `guest_events` (its own
`guest_events_no_chat_text` CHECK constraint deliberately forbids storing
raw chat text, which this system genuinely needs — `customer_message` —
for staff triage; overriding that guardrail would weaken a real privacy
boundary protecting every other `guest_events` write). The migration file
follows this repo's own established banner-comment convention (NOT
APPLIED marker, the gap, why the fix is purely additive, the safety
argument, apply instructions) — same shape as the one real prior
migration in `supabase/migrations/`.

**Never blocks the customer's turn**: `createFeedbackEvent` is fully
wrapped in try/catch — a DB write failure (including, today, the
completely expected case of the migration not being applied yet) logs
and degrades to `{eventId: null, notificationQueued: false}`, and the
customer still gets the full sincere acknowledgment with the honest
future-tense routing line. Verified in `service-mind.test.ts` test 20 by
forcing the `ops_feedback_events` write to fail and confirming a normal
200 response with the real apology text, never the generic LLM-outage
apology, never a crash.

**Staff notification** (`_ops-notifications.ts`, extended, not
replaced): reuses the exact existing dispatcher — new
`OpsNotificationEntity` value `'feedback_event'`, new `notifyFeedbackEvent`
function mirroring `notifyCafeInquiry`'s shape exactly, wired into the
existing `dispatchEntityNotification`. Business-unit → team routing:
restaurant/activity/stay/cafe map to their real bound team; membership/
system/general/unknown map to `'all'` — the SAME existing
broadcast-to-every-bound-team mechanic `sendDailyOpsSummaries` already
uses, not a new concept. Uses the exact same LINE Messaging API push,
`ops_notification_channels` team-binding table, and
`ops_notification_deliveries` idempotency-keyed delivery ledger every
other notification (bookings, cafe inquiries, OTOP orders) already goes
through. When no team has bound a channel yet (the honest, current state
— nothing here is deployed), `sendTeamMessage` returns `'not_bound'`,
exactly like every other entity type; nothing is silently dropped, no
notification success is faked. Verified end-to-end in
`service-mind.test.ts` test 21 (added `programOpsChannel` to
`canonical-core-harness.ts`, using the REAL `encryptPii`/`piiHash` so
`_ops-notifications.ts`'s own decryption round-trips exactly like
production) that once a channel IS bound, the customer-facing wording
correctly switches to the past-tense "already sent" line.

### Files changed

- `netlify/functions/_service-mind-feedback-intent.ts` (new)
- `netlify/functions/_service-mind-feedback-response.ts` (new)
- `netlify/functions/_service-mind-feedback-events.ts` (new)
- `netlify/functions/_service-mind-conversation-flow.ts` (new — vague
  visit intent, bare food/activity intent start, thank-you close)
- `netlify/functions/_service-mind-care-context.ts` (new — family/
  children/elderly/mobility care-aware wording, added in the care-wording
  follow-up round; see Section 2 above)
- `netlify/functions/_ops-notifications.ts` (extended: `'feedback_event'`
  entity, `notifyFeedbackEvent`, wired into `dispatchEntityNotification`)
- `netlify/functions/thongthai-chat.ts` (greeting wording; 6 new
  deterministic responders wired into the precedence chain right after
  the activity-booking fallback)
- `tests/helpers/canonical-core-harness.ts` (extended: LINE push mock,
  `ops_notification_channels`/`ops_notification_deliveries`/
  `ops_feedback_events` mocking, `programOpsChannel`)
- `tests/service-mind.test.ts` (25 tests — 21 from the initial phase + 4
  net new from the care-wording follow-up: test 6 upgraded, tests
  6b/6c/6d/6e added)
- `supabase/migrations/20260922210000_ops_feedback_events_v1.sql` (new,
  **NOT APPLIED**)

### Notification status

Not configured in any real environment by this session — no LINE group
has been bound to any team for feedback routing (that's the owner's own
`"ผูกทีม <name>"` command in their LINE ops groups, unchanged, already
existing infrastructure). Until a team binds a channel, feedback
notifications correctly degrade to `'not_bound'`, same as every other
notification type in this codebase, and the customer-facing wording
stays honestly future-tense.

### Tests added

`tests/service-mind.test.ts` — 25 tests: 21 from the initial phase
(covering all 20 of the owner's required scenarios plus one extra, the
notification-actually-sent happy path), plus 4 net new from the
care-wording follow-up round (test 6 upgraded with stronger assertions;
tests 6b/6c/6d/6e added for low-walking, child + activity, elderly +
named-activity suitability, and child + food constraint). All driven
through the real `processThongthaiChatCore`. Both the service-feedback
responder's AND the care-context responder's precedence placement are
verified load-bearing via the established revert-and-confirm
methodology (see Section 3 and Section 2 above). Full suite:
**698/698 passing** (673 before this phase + 25 new).

### Sample answers (care-wording follow-up)

| Message | Response |
|---|---|
| "พาครอบครัวไป มีเด็กกับผู้สูงอายุ" | "ได้เลยครับ 😊 ถ้ามีเด็ก ๆ กับผู้สูงอายุ ทองไทยแนะนำแผนเดินสบาย ไม่แน่นเกินไปก่อนครับ เริ่มจากกินข้าว/นั่งพักในโซนสบาย ๆ แล้วค่อยเลือกกิจกรรมเบา ๆ ตามแรงของทุกคนครับ / มีใครเดินไม่สะดวก หรือมีอาหารที่แพ้/ไม่ทานเผ็ดไหมครับ" |
| "พาแม่มา ไม่อยากเดินเยอะ" | "ได้เลยครับ แบบนี้ทองไทยจัดสายชิลให้ดีกว่าครับ 😊 เน้นกินข้าว นั่งพัก ดูบรรยากาศ แล้วค่อยเลือกกิจกรรมเบา ๆ ถ้าอากาศดี ไม่ต้องเดินเยอะครับ / คุณแม่เดินขึ้นลงสะดวกไหมครับ เดี๋ยวทองไทยช่วยจัดให้เบาที่สุด" |
| "มากับเด็ก อยากทำกิจกรรม" | "ได้เลยครับ 😊 ถ้ามีเด็กมาด้วย ทองไทยแนะนำเริ่มจากกิจกรรมเบา ๆ และให้ทีมหน้างานช่วยดูความเหมาะสมอีกที โดยเฉพาะกิจกรรมกลางแจ้งอย่างขี่ม้า/ATV ต้องดูอากาศกับสภาพพื้นจริงเพื่อความปลอดภัยครับ / เด็กอายุประมาณกี่ขวบครับ" |
| "ผู้สูงอายุเล่น ATV ได้ไหม" | "ทองไทยฟันธงแทนทีมงานหน้างานไม่ได้ครับ ขอให้ทีมช่วยดูความเหมาะสมของผู้สูงอายุหน้างานอีกทีเพื่อความปลอดภัยครับ ถ้าอยากได้แบบเบา ๆ ก่อน ทองไทยมีกิจกรรมที่ไม่โลดโผนเท่า ATV ให้เลือกด้วยครับ / อยากให้ทองไทยช่วยแนะนำกิจกรรมเบา ๆ เพิ่มเติมไหมครับ" |
| "มีเด็ก ไม่กินเผ็ด" | "ได้เลยครับ 😊 มีเด็กมาด้วย ทองไทยแนะนำเมนูรสอ่อน ไม่เผ็ด ให้เด็กทานได้สบายครับ / มีใครแพ้อาหารหรือมีข้อจำกัดอื่นเพิ่มเติมไหมครับ" |

### Remaining gaps (honest, documented)

- `ops_feedback_events` migration is prepared but **not applied** — the
  feedback event write is currently a no-op that degrades gracefully;
  nothing is persisted until the owner applies it.
- No LINE group has bound to receive feedback notifications yet (a
  separate owner action, same `"ผูกทีม"` command already used for
  bookings — feedback events will flow to the SAME bound channel per
  business unit once that's done, no new binding step needed).
- Cross-turn feedback-invitation suppression (asking again if the
  customer says "ขอบคุณ" a SECOND time later in the same session) is a
  documented simplification, not implemented — the spam guard that IS
  enforced is structural (the thank-you responder only ever fires on the
  narrow bare-"ขอบคุณ" marker, never proactively on an unrelated turn,
  which is what the owner's own test #18 actually checks).
- The classifier is a closed marker set, not general NLU — a novel
  phrasing of a complaint/compliment/suggestion can still structurally
  miss and fall through to the LLM, same deliberate trade-off as every
  other classifier in this codebase.
- Section 2's "during conversation" coverage leans on the EXISTING
  local-concierge framework rather than a from-scratch rebuild of every
  named intent category in the spec (weather_condition_question,
  itinerary_request, couple_trip, horse_interest, etc.) — verified
  working, not reimplemented; see the note in Section 2 above for exactly
  which spec category maps to which existing local-concierge category.
  ~~family_trip / elderly / mobility_constraint wording was too generic~~
  — **closed in the care-wording follow-up round**: see
  `_service-mind-care-context.ts` and the new sample answers above.

### Deploy status: NOT DEPLOYED

No Netlify access used, no deploy, no DB migration applied, no
production DB mutation, no real transaction created, no real booking/
order/payment/redemption created in any test. All work is on
`feature/service-mind-system` (pushed to `origin`), untouched by and
unrelated to every other branch's own deploy state.

### Next step

Owner review of: the feedback-event schema/migration (apply when ready),
the response wording (matches the owner's own examples closely but is
final-approval-worthy, same as every other customer-facing composer in
this codebase), and which LINE groups should be bound to receive
feedback notifications — then a deploy decision, following the same
one-clean-merge discipline already used for every prior phase.

## FEEDBACK OPERATIONS PHASE — backoffice review system + LINE routing +
## dashboard (NOT DEPLOYED, NOT MERGED)

Branch: `feature/feedback-operations-phase`, based on `main` (which
already includes Service Mind v1, PR #48, merged). **Not merged, not
deployed, migration not applied, no LINE group bound.**

### Overview

Service Mind v1 shipped the chat-facing half of the feedback loop
(classification, sincere acknowledgment, an `ops_feedback_events` row on
a best-effort basis). This phase builds the *operational* half: richer
extraction (who/what was actually mentioned, not just a type/severity/
business-unit triple), a real LINE routing table (including an urgent-
safety owner escalation), notification content the staff can actually
act on without opening the backoffice, and a read-only-first backoffice
dashboard (`tamma-backoffice` repo) so the owner can actually see and
triage what customers are saying.

### 1. Structured extraction (`_service-mind-feedback-intent.ts`)

`classifyServiceFeedback` (already live from v1) now ALSO returns, on
every match: `personMentions`, `businessUnitMentions`,
`sentimentKeywords`, `issueKeywords` (a closed 15-value taxonomy), and
`namedAssets` — computed by a new pure function, `extractFeedbackKeywords`,
callable independently for testing. Classification markers themselves
were widened additively (never narrowed) to cover the phrase set the
Feedback Operations spec gave as canonical examples across all 5
feedback types and all 6 business units — see the file's own comments
for exactly which marker covers which example phrase, and why
(`ทองไทยตอบดี` vs. `ทองไทยตอบยาวไป`, `มีปัญหาระหว่างทาง` vs. bare `มีปัญหา`,
etc. are all deliberate near-miss disambiguations, not accidents).

**Person/role entity rule** (the most accuracy-sensitive part of this
phase, per the spec's own "never over-accuse a person"): a closed list
of role words (`พนักงาน`, `แคชเชียร์`, `ไกด์`, `แม่ครัว`, `แม่บ้าน`,
`คนดูแลม้า`, `เจ้าของ`, `ทองไทย`) is checked BEFORE any name-guessing, so
"พนักงานพูดไม่ดี" always produces a role-level mention
(`{label: 'พนักงาน', kind: 'role'}`), never a fabricated individual name.
A named honorific match (`พี่เจิด`) or, failing that, a bare name
immediately preceding a negative-behavior verb with no honorific
("เจิดพูดไม่ดี") produces a `kind: 'named'` mention. `staffName` (the
field the response composer already used pre-this-phase) is now derived
from `personMentions` rather than its own separate regex, so the two can
never drift.

Proven load-bearing: temporarily disabling the role-word precedence
check and re-running the suite makes exactly the 3 tests that depend on
it fail (unknown-staff complaint, role-level activity complaint, cafe
role+compliment) with everything else still green — see the commit
history for this verification, not repeated in this doc.

### 2. Persistence (`_service-mind-feedback-events.ts`)

`createFeedbackEvent`'s POST body now also carries
`person_mentions`/`business_unit_mentions`/`sentiment_keywords`/
`issue_keywords`/`named_assets`/`keyword_summary` (all from
`extractFeedbackKeywords`). The row's `notification_status` is now
PATCHed to the real dispatch outcome after `dispatchEntityNotification`
returns (`sent`/`duplicate`/`not_bound`/`not_configured`) instead of
being left at its insert-time `'pending'` forever — a real gap in v1 the
dashboard's status column depends on. On a notification dispatch
failure, `notification_error` is now also written to the row (previously
only `console.error`-logged, never durably recorded). Every new write is
still inside the same try/catch discipline as v1: a table that doesn't
exist yet (migration not applied) degrades exactly the same way it
always has, no new failure mode introduced.

### 3. LINE routing (`_ops-notifications.ts`)

`notifyFeedbackEvent`'s message body now includes the ORIGINAL customer
message (not just the summary), the event id explicitly, and a
backoffice deep link (`customer-voice.html?event=<id>`) — all three
were spec requirements v1's message body didn't yet meet. Routing logic:
unchanged for every non-urgent case (one team, by business unit, exactly
as v1 already did — `restaurant`/`activity`/`stay`/`cafe` route to their
team, `membership`/`system`/`general`/`unknown` route to `'all'`, the
existing owner/general broadcast binding). NEW: a `severity === 'urgent'`
event whose primary team ISN'T already `'all'` also sends a second,
separately-idempotent message to `'all'` (owner/general) — the spec's
"urgent safety issue → owner/general + relevant group if known" rule.
This is the ONLY case that sends to more than one group; every other
combination still routes to exactly one bound channel, matching the
spec's explicit "do not spam all groups" constraint. The escalation
send is best-effort (a failure there is logged but never fails the
primary send/response).

### 4. Database (migration v2, NOT APPLIED)

`supabase/migrations/20260922230000_ops_feedback_events_keywords_dashboard_v2.sql`
— purely additive `ALTER TABLE` on top of v1's (also still not applied)
`ops_feedback_events`: adds the 6 extraction columns above plus
`notification_error`, `internal_notes` (an append-only staff triage
log), `acknowledged_at`/`resolved_at`, `updated_at` (with a touch
trigger), and widens the `status` check constraint from 3 values
(`new`/`acknowledged`/`resolved`) to 5
(`new`/`acknowledged`/`in_progress`/`resolved`/`dismissed`) — strictly
widening, so it cannot invalidate any existing row or insert. RLS/grants
are unchanged from v1 (service-role only) — see the migration file's own
banner comment for the full safety argument and exact apply instructions
(apply v1 first, then v2, via the Supabase MCP server's `apply_migration`
tool or `supabase db push`, owner-authorized only).

### 5. Tests

11 new tests added to `tests/service-mind.test.ts` (Section 4, tests
22–31, numbered to slot after the existing Section 3 tests without
renumbering them), covering: named vs. bare-name vs. role-word person
mentions across 4 distinct phrasings, restaurant/stay/cafe/activity/
system/suggestion business-unit + issue-keyword extraction, and a
mixed-sentiment message ("อาหารช้า ห้องน้ำไม่สะอาด แต่พี่เจิดดูแลดี") proving
the positive named-person signal survives even when the overall message
also classifies as a complaint (via `keyword_summary`'s
`topPositive`/`topNegative` split — the "structured metadata" fallback
the spec itself suggested as acceptable when a single event can't
represent two feedback types at once). `canonical-core-harness.ts`
gained PATCH support for `ops_feedback_events` (previously POST/GET
only) plus a `feedbackEventRow(id)` accessor, so tests can assert on the
post-dispatch `notification_status`, not just the insert body.

Full suite: 709/709 passing (698 pre-existing + 11 new), zero
regressions.

### 6. Backoffice dashboard — see `tamma-backoffice` repo's own handoff
notes for the "เสียงลูกค้า" page (separate repo, separate PR).

### Deploy status: NOT DEPLOYED, NOT MERGED

No migration applied (v1 or v2), no LINE group bound, no production DB
mutation, no real booking/order/payment/redemption created in any test.
All work is on `feature/feedback-operations-phase` (customer repo) and
its counterpart branch in `tamma-backoffice`.

### Next step

Owner review, per the Feedback Operations spec's own two-option close:
**Option 1** — ready for review only (code/migration/dashboard ready,
nothing applied/deployed). **Option 2** — owner approves: apply v1 then
v2 migrations, bind the relevant LINE groups (restaurant/activity/stay/
cafe/owner-general), deploy the customer repo, deploy the backoffice
repo.

### Phase 1 deploy — DEPLOYED, migrations APPLIED

Owner approved. Both migrations (v1, v2) applied to `tamma-customer-data`
(project `upaokrprawzhgzeqsdke`) and verified column-by-column via direct
schema inspection. `feature/feedback-operations-phase` merged to `main`
in both repos (tamma-chat `089bce0`, tamma-backoffice `b1265d5`).
Production deploy could not be independently verified from this session
-- egress to both `*.netlify.app` domains is blocked by this session's
network policy (`EGRESS_BLOCKED`, confirmed via both `curl` and
`WebFetch`), same limitation noted in the prior deploy-status-fix.

**Existing LINE bindings discovered** (read-only inspection of
`ops_notification_channels`, no data mutated): `restaurant`, `activity`,
`stay`, `cafe` were ALREADY bound from an earlier phase (real groups:
ตำมา-ชาติ/ร้านอาหาร, ทำมา-ชาติ ผจญภัย, ทำมา-ชาติ เฮือนสเตย์, Inthanin
Café) -- feedback for those 4 business units routes for real, no action
needed. `owner_general` was NOT bound, AND the `ผูกทีม` bind command
itself had no alias that could ever resolve to it (the pre-existing
`'all'` pseudo-team was explicitly excluded from binding) -- a genuine
code gap, not just missing data.

### Hotfix — owner_general team code (`feature/owner-general-line-binding`)

Added a real, independently-bindable `owner_general` team (distinct from
the pre-existing `'all'`, which stays reserved for its narrower existing
meaning and remains unbindable). `parseTeamCode` now accepts
`owner`/`general`/`admin`/`เจ้าของ`/`ทั่วไป`/`แอดมิน`/`ผู้ดูแล`, all
resolving to `owner_general`. `FEEDBACK_BUSINESS_UNIT_TEAM` routes
membership/system/general/unknown feedback there (was `'all'`). The
urgent-safety escalation also targets `owner_general` now, and -- new --
its own outcome is recorded honestly in `notification_error`
(`"owner_general escalation: not_bound"`) without ever touching
`notification_status`, which stays governed solely by the PRIMARY
team's real send result. No migration needed (this is pure application
code + existing-table data, no schema change). 7 new tests (716/716
total passing); load-bearing verified by disabling the escalation-
recording branch and confirming exactly the dependent test fails.

**Owner action to finish wiring owner_general**: add the bot to the real
owner/general/admin LINE group, then type `ผูกทีม เจ้าของ` (or `ผูกทีม
owner`) in that group. After that: system feedback, unknown/general
feedback, and the urgent-safety escalation all reach it for real.

### URGENT BUGFIX — "ทองไทย" name collision misrouted feedback as horse selection

Production smoke found: after a safety complaint about ATV, a follow-up
"ทองไทยตอบยาวไป" (system feedback about Thongthai's own answers) was
misread as SELECTING THE HORSE named ทองไทย and asked for booking
details. Root cause: `activityBookingFallbackDraft`'s
`hasHorseBookingContext` check (thongthai-chat.ts) treated ANY second-
plus conversation turn as sufficient "we're mid horse-booking" context,
regardless of what the conversation was actually about -- a real,
general bug, not specific to this one phrase.

Fix (`hotfix/system-feedback-horse-selection-collision`):
1. Removed the blanket `userTurns.length > 1` clause -- real context now
   requires the conversation to actually mention riding/horses (`ม้า`,
   or `อยากขี่` naming a specific horse instead of the word `ม้า`).
2. Added an explicit guard: a message matching
   `_service-mind-feedback-intent.ts`'s new exported
   `THONGTHAI_RESPONSE_MENTION`/`mentionsThongthaiResponse` (commenting on
   Thongthai's own answers/behavior -- ตอบยาว/ตอบสั้น/ตอบไม่ตรง/ตอบมั่ว/
   พูดเยอะ/พูดไม่รู้เรื่อง/แนะนำไม่ตรง/ควรถาม/ควรตอบ, plus the pre-existing
   บอทตอบ/แชทบอท/ระบบแชท/ระบบจอง markers) never triggers horse selection,
   even if an earlier turn in the SAME conversation was legitimately
   about horse riding (a case the first fix alone doesn't cover).
3. The SAME `THONGTHAI_RESPONSE_MENTION` marker now also drives
   `_service-mind-feedback-intent.ts`'s classification (`SYSTEM_FEEDBACK_MARKER`
   widened to cover ยาว/สั้น/มั่ว/พูดเยอะ/พูดไม่รู้เรื่อง/แนะนำไม่ตรง/ควรถาม/
   ควรตอบ, not just the one originally-reported "ยาวไป") and business-unit
   inference (`BUSINESS_UNIT_MARKERS`'s 'system' entry now reuses the same
   marker, so a COMPLIMENT about Thongthai's own answers, e.g. "ทองไทยช่วยดี
   มาก", also correctly infers business_unit 'system' -- `COMPLIMENT_MARKER`
   gained "ช่วยดี" for this).

12 new tests (727/727 total passing) -- including the exact reported
2-turn scenario, the "legitimate horse turn then feedback turn" edge
case the guard specifically protects, and confirmation that real horse
selection ("อยากขี่ทองไทย", "อยากขี่ม้า" → "เอาทองไทย") and horse-facts
questions ("ทองไทยกับภาราดรต่างกันยังไง", "ทองไทยขี่ยังไง") still work
exactly as before. Both new guards verified load-bearing individually
(each disabled in turn, confirmed exactly its own dependent test(s)
fail, nothing else). `brainRequest()` test helper gained an optional
4th `history` parameter so multi-turn scenarios can be tested at all
(it previously always sent an empty `chatHistory`, which is why this
class of bug had no prior test coverage).

### FOLLOW-UP BUGFIX — horse comparison vs. selection collision

A second production smoke report claimed "ทองไทยกับภาราดรต่างกันยังไง"
(asking how the two horses differ) was ALSO being misread as selecting
ภาราดร and prompting for booking details.

Investigation: this exact phrase, plus all 13 scenarios the report's own
test list required, were already answered correctly by the previous fix
above (`composeHorseComparisonResponse` in `_local-concierge-response.ts`
already produces owner-configured ride-feel/personality facts for it,
almost verbatim to the report's own "expected" wording) -- confirmed via
13 new regression tests, all passing against the already-merged code
with zero further changes needed. Most likely explanation: the report
was run against a stale production deploy that hadn't yet picked up the
previous fix (this session still cannot verify Netlify deploy completion
-- egress to `tamma-chat.netlify.app` remains blocked).

Still extended coverage for a few additional phrase shapes the report's
broader "REQUIRED BEHAVIOR" section named beyond the strict test list,
all narrowly scoped (`_local-concierge-intent.ts`'s `horse_comparison`
classifier): bare "ต่างกัน" (was "ต่างกันยังไง" only, so "ต่างกันไหม" now
matches too), a single named horse's personality question
("ทองไทยนิสัยเป็นไง" -- deliberately a different shape than the
"ตัวไหน + attribute" comparison `detectCompareEntities` already owns, so
it can never collide with that), and an explicit comparison request
scoped to an actual horse/riding mention ("ขอเปรียบเทียบม้าสองตัว").
5 more tests (18 total this round, 745/745 overall), load-bearing
verified.

### REAL FIX — horse comparison hijacked by an ALREADY-OPEN booking task

The previous round's investigation was right that a single-turn,
no-active-task comparison question already worked -- but wrong to stop
there. Reproduced the actual live failure: with a horse-booking task
ALREADY OPEN (e.g. "อยากขี่ม้า" then "เอาทองไทย" selects ทองไทย), asking
"ทองไทยกับภาราดรต่างกันยังไง" next silently RE-SELECTED ภาราดร (the
horse named LAST in the joined text) and re-asked for booking details --
exactly the reported production response
("รับทราบครับ ผมล็อกตัวเลือกเป็น ภาราดร ... เลือกม้า: ภาราดร ...").

Root cause: `activityBookingFallbackDraft`'s only non-selection guard
was `mentionsThongthaiResponse` (from the "system feedback" bugfix
above) -- it has nothing to do with comparison questions, so it never
fired here, and `hasHorseBookingContext` was already satisfied by the
EARLIER turn's "ม้า" mention.

Fix: new exported `isHorseInfoOrComparisonQuestion` in
`_local-concierge-intent.ts` -- deliberately reuses
`classifyLocalConciergeQuestion`'s existing `horse_comparison` markers
(never a second, independently-drifting marker set), checked in
`activityBookingFallbackDraft` right alongside the existing
`mentionsThongthaiResponse` guard, BEFORE the horse-booking-context
check. 9 new tests build REAL multi-turn state through the actual
`processThongthaiChatCore` path (no hand-constructed classifier calls),
including the exact 3-turn reproduction. 754/754 total passing; the new
guard verified load-bearing (disabling it makes exactly the two active-
task scenarios fail, nothing else).

### THIRD FIX — current turn's explicit horse choice was losing to array order

Reproduced the actual live failure: "อยากขี่ม้า" -> "เอาภาราดร" (selects
ภาราดร) -> "เอาทองไทย" (should SWITCH to ทองไทย) kept saying
"เลือกม้า: ภาราดร" -- the customer's own latest, explicit choice was
ignored.

Root cause: `activityBookingFallbackDraft` ran `activityAssetFromText`
over the WHOLE joined history+current-message text. Once BOTH horse
names had appeared anywhere in the conversation,
`ACTIVITY_ASSET_SELECTIONS`' array-DECLARATION order (ภาราดร listed
before ทองไทย in `_deterministic-semantic-turn.ts` -- an arbitrary
detail, not recency, not the current turn) decided the winner via
`findKnownActivityAssetSelection`'s `accepted[0]`.

Fix: check the CURRENT message alone first
(`activityAssetFromText(request.message) ?? activityAssetFromText(text)`
-- only fall back to scanning the joined history when the current
message itself names no horse at all, e.g. "30 นาที" continuing an
already-made selection). 7 new tests build real, persisted multi-turn
state through the actual `processThongthaiChatCore` path, including
both switch directions and the exact reported scenario. 761/761 total
passing; the fix verified load-bearing (reverting it makes exactly the
ภาราดร-\>ทองไทย switch test fail, nothing else -- the reverse direction
still happens to pass by the SAME array-order coincidence that caused
the bug, which is precisely why this needed a real fix, not a lucky
reordering of the array).

### FOURTH FIX — bare "เอาทองไทย"/"เอาภาราดร" with no context now asks first

A deeper intent-safety gap: a bare "เอาทองไทย" (or "เอาภาราดร"/"เลือก
ทองไทย"/a bare horse name alone) with NO established horse/activity
context was silently accepted as horse selection -- not by
`activityBookingFallbackDraft` (already correctly gated from the prior
three fixes), but by the ENTIRELY SEPARATE One-Mind semantic layer's own
`findKnownActivityAssetSelection` check
(`_deterministic-semantic-turn.ts`, line ~535), which has no context or
intent gate of its own -- any bare horse-name mention with no open task
silently opened a booking task and produced a garbled missing-field
prompt.

Fix: a new deterministic responder, `bareHorseSelectionClarification`
(`thongthai-chat.ts`), checked right after the activity-booking fallback
(before the One-Mind orchestrator ever sees the message). It fires only
when the message names a horse AND isn't feedback/comparison-shaped AND
doesn't itself express real riding intent ("ขี่"/"ม้า" -- see the new
`hasExplicitHorseBookingIntent`) AND there's no active context -- checked
via BOTH prior `chatHistory` (`hasActiveHorseBookingContext`) AND, since
the client doesn't always resend full history (several existing tests
seed task state directly), whether an activity-domain task has EVER
existed for this guest (`hasEverDiscussedActivityDomain`, a cheap
`loadGuestAgentStateSnapshot` read -- this is what a real cancelled-task-
then-reselect regression test needed to keep passing).

Also had to teach the ambiguity guard to yield to
`detectCompareEntities`'s existing temperament/beginner-suitability path
(new `isCompareEntitiesAttributeQuestion` in `_local-concierge-intent.ts`)
-- "ภาราดรกับทองไทยตัวไหนนิสัยดีกว่า" names both horses with no "ม้า"/
riding wording, so without this it would have been wrongly intercepted
as an ambiguous selection instead of reaching that path's honest
"ไม่มีข้อมูล" decline (caught 3 real regressions in existing tests before
landing this).

15 new tests, all through the real `processThongthaiChatCore` path.
776/776 total passing; the new guard verified load-bearing (disabling it
makes exactly the 6 ambiguity-clarification tests fail, nothing else).

### OWNER GROUP BIND DEBUG — "ผูกทีม เจ้าของ" produced no bot response

Owner created a new LINE group, added the bot, typed `ผูกทีม เจ้าของ` /
`ผูกทีม owner` / `ผูกทีม admin` in it, and got no response at all.

**Was the webhook receiving the messages? Could not be determined from
this session** -- there is no log line anywhere in `line-webhook.ts`
that fires on receiving a group event, so a genuinely silent group
(LINE never even calling the webhook) and "received it but something
inside silently dropped it" were indistinguishable from existing
Netlify function logs. That gap is now closed (see below).

**Where it would drop if the webhook DID receive it: nowhere.** Traced
the full path by hand and confirmed with tests: `handleOpsEvent` ->
`handleLinePaymentGroupText`/`paymentTypedConfirmationGuard`/
`handleLineFuelText`/`handleRestaurantStockText` (all four correctly
return `null` immediately for an unbound, brand-new group -- none of
them throw) -> `handleLineOpsGroupMessage` -> `handleBookingOpsCommand`
(doesn't match, returns `{handled:false}` immediately, no DB call) ->
the `ผูกทีม` regex match -> `parseTeamCode` (already accepts เจ้าของ/
owner/admin/general/ทั่วไป/แอดมิน/ผู้ดูแล from the earlier owner_general
fix) -> `bindLineTeamChannel` -> success reply. Every one of these steps
is now covered by a direct test using the real `handleLineOpsGroupMessage`
entry point, and all pass. **The code, when actually invoked, works
correctly for the exact commands the owner typed.**

**Two real gaps found and fixed along the way** (neither explains "zero
response," both are genuine hardening):

1. **No authorization existed at all** on the `ผูกทีม` command -- any
   LINE user present in ANY group with the bot could rebind that
   group's team, rerouting all future notifications for that team.
   Added `isAuthorizedForTeamBind` (`_ops-notifications.ts`), gated by a
   new `LINE_OPS_ADMIN_USER_IDS` env var (comma-separated LINE userIds).
   **Opt-in by design**: unset (the current, unconfigured state) means
   every sender is still authorized, exactly matching today's behavior
   -- so this fix cannot be what caused "no response," and deploying it
   does not lock the owner out of anything they haven't explicitly
   configured. When unauthorized, the bot now replies
   "คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบครับ" -- never silent.
2. **No safe diagnostic logging existed** for incoming group/room
   events. Added a redacted `LINE_OPS_EVENT_RECEIVED` log line (event
   type, source type, partially-redacted groupId/roomId/userId, message
   type, first 120 chars of text, whether a replyToken was present) that
   fires for EVERY group/room event this webhook receives, including a
   bare `join` event (LINE sends one when the bot is added to a group;
   this webhook still doesn't reply to it -- not customer-facing, no
   action needed -- but it will now be VISIBLE in logs instead of
   silently doing nothing). Also correlated `LINE_OPS_GROUP_ERROR`'s
   existing catch-all log with which event/group it came from. Never
   logs the LINE channel secret or access token (verified by test).

**If the code is correct but the webhook received nothing at all --
owner action required, in this order:**
1. LINE Developers Console -> the Messaging API channel -> **Webhook
   settings**: "Use webhook" must be ON, and the webhook URL must point
   at this project's `line-webhook` Netlify function (verify it matches
   the actual deployed URL, not a stale one from an earlier project).
2. LINE Official Account Manager -> **Response settings** -> **Chat**:
   if this is set to "Chat" (manual reply) instead of the webhook/API
   mode, LINE routes messages to the OA Manager inbox for a human and
   NEVER calls the webhook at all. This is the single most common cause
   of "bot added to a group, types a command, gets nothing" and is
   entirely outside this codebase's control.
3. Same screen -> confirm **"Allow bot to join group chats"** is
   enabled -- without it, group functionality may not work even though
   the bot can technically be added.
4. LINE Developers Console -> the channel's **webhook event log**
   (if available on the plan) -- check whether a `message`/`join` event
   for this group even appears there. If it doesn't, the problem is
   entirely on LINE's side (settings above), not this codebase.
5. Once verified/fixed, retest with exactly: `ผูกทีม เจ้าของ` -- expect
   "✅ ผูกกลุ่มนี้กับทีม เจ้าของ/ทั่วไป แล้วครับ...". If it now works, check
   the new `LINE_OPS_EVENT_RECEIVED` log line in Netlify's function logs
   for this invocation to confirm exactly what changed.

Files changed: `netlify/functions/line-webhook.ts` (safe redacted
logging), `netlify/functions/_ops-notifications.ts` (opt-in
authorization gate). 8 new tests (784/784 total passing); the
authorization guard verified load-bearing.

## LINE Full Audit (group bind + private chat) -- 2026-09-23

Owner reported two live symptoms: (1) the group bind command still
produced zero response after the prior "Owner Group Bind Debug" fix, and
(2) a private LINE OA chat with a casual interjection ("เห้ยยย") got the
generic "ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึงครับ..." fallback instead of a
friendly reply. Audited the whole LINE pipeline end to end rather than
patching either symptom in isolation.

**Architecture clarified**: `line-webhook.ts` is the ONLY Netlify entry
point. It classifies each inbound event by `source.type`: group/room ->
`handleOpsEvent` (in the same file); everything else -> re-signed and
forwarded to `_line-webhook-core.ts`'s own exported `handler`
(`coreHandler`), which does its own independent signature verification
and then calls `askThongthaiReliably` -> `processThongthaiChatCore` (from
`thongthai-chat.ts`) -- **the exact same function the web HTTP handler
calls**. Confirmed: LINE private chat does NOT bypass the web core; there
is no separate/duplicate brain for LINE. One real gap: `_line-webhook-
core.ts`'s `askThongthai` always builds `chatHistory: []` for the core
call -- multi-turn continuity for LINE customers comes entirely from
persisted `guest_agent_state` (guestDbId-keyed, survives across
turns/webhooks), not from chatHistory. This is why B7's two-turn LINE
test below still works (state persists) even though each call's
chatHistory is empty.

**Finding 1 -- group bind**: re-verified the ENTIRE path from a fully
signed LINE webhook HTTP request (not just calling
`handleLineOpsGroupMessage` directly, as the prior debug round did) for
"ผูกทีม เจ้าของ" / "owner" / "admin" / an invalid team / an unauthorized
sender / a reply-send failure. All six behave correctly and are covered
by new tests (`tests/line-full-audit.test.ts`, Group A). **No code defect
found this round either.** Added `LINE_GROUP_BIND_ATTEMPT` logging
(teamCodeRaw, teamCodeParsed, redacted targetId, authorized, result:
success/not_authorized/invalid_team/db_error) directly in the bind
handler in `_ops-notifications.ts`, and top-level `LINE_EVENT_RECEIVED` /
`LINE_ROUTE_SELECTED` logging in `line-webhook.ts` for EVERY inbound
event (not just group/room ones) so a genuinely silent group can now be
distinguished, from the logs alone, between "LINE never delivered the
event" (no `LINE_EVENT_RECEIVED` line at all) and "delivered but the
reply send failed" (`LINE_OPS_GROUP_ERROR`, already existed). Given the
code is proven correct end-to-end twice now, a still-silent group most
likely means: (a) the fix from the prior round has not actually reached
production yet (this session cannot verify a live Netlify deploy --
egress to `*.netlify.app` is blocked here), or (b) the LINE Official
Account Manager "Response Settings -> Chat" mode is intercepting the
message before the webhook ever fires (see the prior handoff entry's
owner checklist -- unchanged and still the most likely explanation).

**Finding 2 -- private chat generic fallback -- REAL BUG, FIXED**: no
deterministic responder existed for bare attention-getting interjections
("เห้ยยย", "ฮัลโหล") or presence checks ("อยู่ไหม", "มีใครอยู่ไหม") --
only actual greeting words (สวัสดี/หวัดดี/hello/hi) had one
(`deterministicGreetingResponse`). A casual interjection therefore fell
all the way through to the real LLM call, and when that call hit a
genuine provider failure, the ONLY fallback for the LLM-unavailable case
was one flat message ("ตอนนี้ทองไทยคิดช้ากว่าปกติ...") used for every
category of question -- weather, booking, feedback, and plain chit-chat
alike.

Fixed with two independent changes in `thongthai-chat.ts`:
1. `deterministicCasualChatResponse` (new) -- checked in the SAME early,
   pre-LLM slot as the existing greeting responder (`earlyCasualChat`,
   right after `earlyGreeting`), so a casual message now gets
   "ครับผม ทองไทยอยู่นี่ครับ 😊 มีอะไรให้ช่วยไหมครับ" **regardless of LLM/
   provider availability**, on every channel (web and LINE both call the
   same `processThongthaiChatCore`). Matched by `CASUAL_ATTENTION_RE`
   (เห้ย/เฮ้ย/ฮัลโหล/เอ้ย, repeated letters and trailing politeness
   particles allowed) and `PRESENCE_CHECK_RE` (มีใครอยู่ไหม/อยู่ไหม, with
   an optional "ทองไทย" prefix), both anchored start-to-end so a message
   that merely contains one of these words alongside real content (e.g.
   a horse-booking message) is never intercepted.
2. `categorizeDegradedFallback` + `degradedFallbackResponse` (new) --
   replaces the single `availabilityBrainResponse()` call in the
   `LLMAvailabilityError` catch block (after the existing promotion-
   fallback and One-Mind deterministic-degradation attempts both still
   fail to compose) with a per-category apology: weather / booking /
   feedback / casual, each honest about what didn't happen (never claims
   a booking was made or feedback was saved) and none of them the old
   flat "คิดช้า" text verbatim.

**Files changed**: `netlify/functions/thongthai-chat.ts` (both fixes,
plus the now-shared `categorizeDegradedFallback`/`isCasualAttentionMessage`
exports), `netlify/functions/_line-webhook-core.ts` (`LINE_PRIVATE_CHAT_
ATTEMPT` logging: textCategory, deterministicResponder, llmAttempted,
llmErrorType, finalResponseKind -- imports the new classifiers from
`thongthai-chat.ts` rather than re-implementing them), `netlify/
functions/line-webhook.ts` (`LINE_EVENT_RECEIVED`/`LINE_ROUTE_SELECTED`),
`netlify/functions/_ops-notifications.ts` (`LINE_GROUP_BIND_ATTEMPT`).
Never logs the channel secret, access token, or a full group/user id in
any of the four new log lines.

**Tests**: `tests/line-full-audit.test.ts`, 16 new tests. Group A (6):
full signed-webhook group bind scenarios (success x3 team-alias
variants, invalid team, unauthorized sender, reply-send failure).
Group B (7): full signed-webhook PRIVATE chat scenarios -- "เห้ยยย"
never gets the generic apology; "สวัสดี" matches web-quality greeting;
"มีใครอยู่ไหม" gets the friendly reply; "ทองไทยตอบยาวไป" is not
misrouted as horse selection; "อยากขี่ม้า" starts the activity flow;
bare "เอาทองไทย" with no context asks for clarification; "อยากขี่ม้า"
then "เอาทองไทย" selects the horse once context is established (proves
LINE's turn-to-turn persisted-state continuity, despite chatHistory
always being `[]` for this transport). Group C (3): an unscripted/
open-ended message still gets a real delivered reply (never
silence/crash); a casual message with zero LLM programming still gets
the deterministic reply, proving it never depended on the LLM; and a
direct unit check that `categorizeDegradedFallback`/
`degradedFallbackResponse` produce four genuinely distinct, honest,
non-generic messages. **Full suite: 800/800 passing** (784 prior + 16
new). Load-bearing verified: disabling `deterministicCasualChatResponse`
made exactly B1, B3, and C2 fail and no others; restoring returns the
suite to 800/800.

**Owner retest checklist**: private LINE chat -- "เห้ยยย" should now
reply "ครับผม ทองไทยอยู่นี่ครับ 😊 มีอะไรให้ช่วยไหมครับ", never the
"คิดช้า" message. Group bind -- retest "ผูกทีม เจ้าของ" in the "owner"
group; if STILL silent, check the new `LINE_EVENT_RECEIVED` log line in
Netlify's function logs for that exact timestamp: if it's absent
entirely, the problem is the LINE OA "Response Settings -> Chat" mode
(see checklist in the prior handoff entry), not this codebase.

**Confirmations**: no DB migration (pure application-code fix); no
booking/order/payment created by this work; no fake notification
success (both bind and chat failure paths report their real outcome,
never a claimed success); no unrelated production data mutated; deploy
completion cannot be verified from this session (egress to
`*.netlify.app` is blocked here, as in every prior round).

## Owner Group Only -- 2026-09-23

New live evidence: an EXISTING, already-bound "activity" group replies
correctly ("รับงาน" / "300"), proving the webhook, group receipt, group
reply, and ops routing all work in general right now. A brand-new "owner"
group (bot just added) is silent for "ผูกทีม เจ้าของ"/"owner"/"admin".

**What this session could and could not check.** This sandbox has no
access to this project's live Netlify function logs (no log-query tool
or API is available here) -- it cannot pull the actual `LINE_EVENT_
RECEIVED`/`LINE_ROUTE_SELECTED`/`LINE_GROUP_BIND_ATTEMPT` lines for the
12:34-12:35 window the owner reported. **The owner (or anyone with
Netlify dashboard/CLI access) needs to pull those logs directly** --
that is the one piece of evidence that would conclusively separate
"LINE never delivered the owner-group event" from "it arrived and
something here dropped it," and this session cannot substitute for it.

**What WAS checked, exhaustively, at the code level**: re-read every
single handler in the group-text precedence chain (`handleLinePayment
GroupText`, `paymentTypedConfirmationGuard`, `handleLineFuelText`,
`handleRestaurantStockText`, `handleBookingOpsCommand`) that runs BEFORE
`handleLineOpsGroupMessage`'s bind-command handling, specifically testing
the round's own hypothesis ("a bound-group-only guard silently drops the
bind command before it's reached"). Every one of them either (a) doesn't
even look up a binding for text shaped like "ผูกทีม ...' (their regexes
require a booking code, a payment code, or a digit amount -- none of
those patterns match), or (b) looks up the binding and returns null/false
immediately when none exists. None of them throw for an unbound group.
This was proven, not assumed: `tests/owner-group-only.test.ts` reproduces
the owner's EXACT 4-message rapid-rebind sequence against a brand-new,
never-touched target id through the FULL signed webhook handler, and all
four get the correct success reply. **No code defect reproduces this
symptom.**

**Change made anyway**: restructured `line-webhook.ts`'s `handleOpsEvent`
so a `ผูกทีม ...` message is checked and handled FIRST, before any of
the four handlers above, per the owner's own stated invariant ("binding
must work in an unbound group -- that's the whole point"). This is
defensive/architectural, not a bug fix for the reported symptom (proven
by disabling it and re-running `tests/owner-group-only.test.ts`: all 7
tests still passed, confirming the four upstream handlers were already
safe for this text before the reorder). It does remove the theoretical
risk of a FUTURE change to one of those handlers accidentally shadowing
the bind command.

**Given the code is now proven correct at this level of detail twice
in a row**, and the activity group proves the OA-wide webhook/response
mode is not the blocker, the remaining live hypotheses are things this
session cannot observe from here:
- The prior LINE Full Audit fix has not actually reached the live
  Netlify deployment yet (this session cannot verify a deploy).
- Something specific to how this particular new group was created
  (invited vs added directly, or a delay in LINE's own webhook
  registration for a just-created group) is preventing LINE itself from
  delivering `message` events for THIS group specifically, even though
  OA-wide settings are fine. Owner action: check the LINE Developers
  Console webhook event log filtered to this group's timeframe -- if
  no event appears there at all, this is entirely LINE-side, not this
  codebase.

**Files changed**: `netlify/functions/line-webhook.ts` (bind-first
precedence). **Tests**: `tests/owner-group-only.test.ts`, 7 new tests,
all through the full signed webhook, including the owner's exact 4-
message sequence against a fresh group id and a check that an ALREADY-
BOUND activity group's own commands are unaffected by the reorder.
**Full suite: 807/807 passing** (800 prior + 7 new).

**Owner retest / diagnosis needed from your side**: pull Netlify function
logs for the owner group's exact timestamp and check for `LINE_EVENT_
RECEIVED`. Absent entirely -> LINE-side (see LINE Developers Console
webhook event log). Present but no `LINE_GROUP_BIND_ATTEMPT` -> report
back immediately, that would be a genuine code-path finding this session
did not manage to reproduce and would need the exact log line to chase
further.

**Confirmations**: no DB migration; no booking/order/payment created; no
fake notification success; no unrelated production data mutated; deploy
completion not verifiable from this session.

## Final LINE Stabilization -- 2026-09-23

Owner supplied real production `line-webhook` function logs for the first
time this round. That evidence proved the FIRST genuine code-adjacent
defect found in three rounds of "owner group is silent" investigation.

**Fix 1 -- DB constraint rejected owner_general (real bug, fixed + applied)**.
Production log for "ผูกทีม เจ้าของ" showed: `LINE_EVENT_RECEIVED` present,
`LINE_ROUTE_SELECTED=group_ops_command`, `LINE_OPS_EVENT_RECEIVED` present,
`LINE_GROUP_BIND_ATTEMPT={teamCodeParsed:"owner_general",authorized:true,
result:"db_error"}`, error `23514` (Postgres check_violation), failing row
containing `owner_general` in both the team_code and service_type
positions. So: LINE delivery, webhook routing, command parsing, and
authorization were ALL already correct (matching every prior round's
conclusion) -- the write itself was rejected by schema.

Queried the live `tamma-customer-data` (`upaokrprawzhgzeqsdke`) schema
directly (no local migration file defines this table at all -- it predates
this repo's migration convention) and found TWO relevant CHECK
constraints, not one:
- `ops_notification_channels_team_code_check` -- allowed only
  restaurant/stay/activity/cafe/otop/all. Missing `owner_general`.
- `ops_notification_channels_service_type_check` -- allowed only
  restaurant/stay/activity/cafe/otop (or NULL). `bindLineTeamChannel`
  was setting `service_type: input.teamCode` for anything that wasn't
  `'all'`, so `owner_general` would violate THIS constraint too, even
  after fixing the first one.

Fix: migrated `ops_notification_channels_team_code_check` to also accept
`'owner_general'` (`supabase/migrations/20260923060732_ops_notification_
channels_owner_general_v1.sql`, applied directly to production via the
Supabase MCP tool -- drop+recreate, the only way to widen a Postgres CHECK
constraint; verified after: all 5 existing rows unchanged, new definition
confirmed). Left `service_type_check` untouched and instead fixed
`_ops-notifications.ts`'s `bindLineTeamChannel` to map `owner_general` to
`service_type: null`, exactly like the pre-existing `'all'` pseudo-team --
`owner_general` isn't a real business-unit service type, so this is the
semantically correct fix, not a workaround, and it means one constraint
change was enough rather than two.

**Fix 4 -- bind command replied nothing on DB failure (real bug, fixed)**.
`bindLineTeamChannel`'s catch block used to log `db_error` and rethrow --
the group got zero reply while the real cause was visible only in
`LINE_OPS_GROUP_ERROR`. Now replies "ผูกทีมไม่สำเร็จครับ ระบบฐานข้อมูลยังไม่
รองรับทีมนี้ ทีมงานกำลังแก้ไขครับ ลองใหม่อีกครั้งในภายหลัง" and still logs
`LINE_GROUP_BIND_DB_ERROR` with the redacted error detail.

**Fix 2 -- private casual logging accuracy (real logging bug, fixed)**.
Production log for private "หวัดดี" showed `deterministicResponder=null,
llmAttempted=true`, and a genuine ~10-14s Gemini call that hit
`circuit_open`. `deterministicGreetingResponse`/`deterministicCasualChat
Response` (added in the prior "LINE Full Audit" round) are the absolute
first two checks `processThongthaiChatCore` runs, unconditionally, before
any LLM call -- so `isSimpleGreetingMessage`/`isCasualAttentionMessage`
being true is a GUARANTEE the core will short-circuit, not a guess. But
`_line-webhook-core.ts`'s `LINE_PRIVATE_CHAT_ATTEMPT` logging was setting
`llmAttempted = true` unconditionally right before every call into the
core, regardless of whether that guarantee held -- so the log could never
actually distinguish "the LLM was genuinely attempted" from "the
deterministic path always wins, this field is just wrong." Fixed the
logging to compute `deterministicResponder`/`llmAttempted` from that same
guaranteed precondition before calling `askThongthaiReliably`, so the log
is now trustworthy for future debugging. Whether the "หวัดดี" case in the
owner's log was a genuine code defect (unlikely -- `isSimpleGreetingMessage`
demonstrably matches bare "หวัดดี" via direct regex check and via a new
dedicated test) or evidence the prior round's deploy hadn't reached
production yet at the time of that specific test remains unresolved from
this session (deploy status still not verifiable here) -- but the logging
is fixed either way, and the underlying deterministic responder was
re-verified correct with the LLM forcibly disabled (zero Gemini calls
observed) rather than merely inspected.

**Fix 3 -- weather LINE fallback (already correct, verified, no code
change needed)**. Traced `deterministicLocalConciergeResponse` (weather
category) -- it runs well before any LLM call, same as every other
deterministic responder, and its composer (`composeLocalConciergeResponse`)
ALREADY handles a failed/unavailable weather provider itself, honestly and
deterministically, without ever throwing or falling through toward the
LLM. Verified directly: with the weather provider forced to fail AND
Gemini forced unavailable simultaneously, the reply is a real, specific,
non-generic weather answer -- never the flat "คิดช้า" apology. The
earlier-reported "วันนี้ฝนตกปะ -> generic คิดช้า" live evidence for this
task predates today's evidence and is most consistent with the same
stale-deploy pattern seen throughout this engagement, not a live defect
in the code as it exists now.

**Files changed**: `netlify/functions/_ops-notifications.ts` (service_type
mapping fix, db_error reply fix), `netlify/functions/_line-webhook-core.ts`
(LINE_PRIVATE_CHAT_ATTEMPT logging accuracy), `supabase/migrations/
20260923060732_ops_notification_channels_owner_general_v1.sql` (new,
applied to production). **Tests**: `tests/final-line-stabilization.test.ts`,
21 new tests covering DB/schema mapping, group bind through the full
signed webhook (including a simulated DB failure), private casual chat
with the LLM forcibly disabled (proving zero Gemini calls, not just a
plausible-looking reply), weather with the provider forced to fail, and
regression coverage for every previously-fixed behavior this task listed
(activity group commands, system feedback, bare horse clarification,
horse-context selection, horse comparison). **Full suite: 828/828
passing** (807 prior + 21 new). Load-bearing verified: reverting the
db_error reply fix made exactly test B8 fail and nothing else.

**Migration applied**: yes, directly to `tamma-customer-data`
(`upaokrprawzhgzeqsdke`) via the Supabase MCP tool, verified post-apply
(constraint definition confirmed, all 5 pre-existing rows unchanged).

**Confirmations**: no booking/order/payment created; no fake notification
success (the db_error reply is honest about failure, not a fabricated
success); no unrelated production data mutated (only the one CHECK
constraint was touched, confirmed via direct query before and after); the
one production mutation in this round is the explicitly-authorized,
tested, additive schema migration itself.

## Horse Service Mind UX -- 2026-09-23

Owner retest showed the system replying, but with the wrong FEEL: "อยากขี่ม้า"
jumped straight to "เลือกระยะเวลา 30, 60 หรือ 90 นาที" (transactional, form-
like), and a follow-up bare "เอาทองไทย" kept re-asking "horse or assistant?"
even after horse context was clearly established.

**Root cause 1 (why "อยากขี่ม้า" jumped straight to duration)**: discovered
a SECOND, entirely separate, LINE-only booking system that this session had
not previously read: `_operations-db.ts`'s `handleLineBookingMessage`, with
its own `line_booking_sessions` state table, called directly from
`_line-webhook-core.ts`'s `handleEvent` BEFORE `askThongthaiReliably`/
`processThongthaiChatCore` is ever reached. Its `shouldConsumeLegacyLineBookingTurn`
guard treated a bare "อยากขี่ม้า" as "clearly belongs to the booking" and
answered with its own transactional prompt -- `thongthai-chat.ts`'s
Service Mind responder (`deterministicActivityIntentStartResponse`,
built in an EARLIER phase of this engagement, already existed and already
asked a caring question) never got a chance to run at all. This corrects
an earlier conclusion in this session's own "LINE Full Audit" entry that
LINE private chat always uses "the exact same core" as web -- true for
casual/greeting messages, NOT true for activity-booking-shaped messages,
which this legacy flow intercepts first. Fixed: `shouldConsumeLegacyLineBookingTurn`
now defers (returns false) for exactly the bare, unstructured activity-
intent-start shape (`isActivityIntentStartMessage`); anything with more
structure (a duration, a horse name, a date) still starts the legacy flow
normally, unchanged.

**Root cause 2 (why "เอาทองไทย" kept re-asking after context was
established)**: `composeActivityIntentStartResponse`'s reply was pure
text -- it never persisted anything. `bareHorseSelectionClarification`'s
own `hasEverDiscussedActivityDomain` guard (added in an earlier round)
reads persisted `guest_agent_state.taskState.activeTask.domain` for
exactly this continuity, but nothing was ever writing it for this
responder, and LINE's `chatHistory` is always empty (`_line-webhook-
core.ts`'s `askThongthai`), so there was no other memory available
between turns. Reproduced precisely via the full signed LINE webhook
across 3 turns before fixing, confirming this diagnosis empirically
rather than by inspection alone.

**Fixes applied** (`thongthai-chat.ts`):
- `markActivityIntentStarted` -- starts a real `activity_booking`
  `ActiveTask` (via `_task-state.ts`, the same machinery every other
  domain already uses) when the intent-start responder fires, so a later
  turn's `hasEverDiscussedActivityDomain` check sees it.
- `horseSelectionWithContextResponse` (new) -- the other half of
  `bareHorseSelectionClarification`: once context is established
  (chatHistory OR persisted state), a bare horse-name mention now
  actually SELECTS the horse (warm confirmation + ride-feel/personality
  from the same `HORSE_FACTS` data the horse-comparison responder already
  uses, so the two never drift) and asks the one caring question that
  matters next (rider experience + party size), persisting the pick via
  `persistHorseSelection`, instead of silently falling through toward the
  LLM once the clarification stopped firing.
- `composeActivityIntentStartResponse` (`_service-mind-conversation-
  flow.ts`) rewritten to introduce both horses by name with a one-line
  ride-feel/personality each (matching the task's own example almost
  verbatim), and `ACTIVITY_INTENT_START_MARKER` broadened to also cover
  "ขี่ม้าได้ไหม"/"มีกิจกรรมขี่ม้าไหม" and an optional beginner/family
  qualifier (`classifyActivityIntentQualifier`), each branching to its
  own caring wording -- team supervision for a beginner, age/comfort for
  a family, never a claimed safety guarantee for either (per the
  session's explicit "never say beginner-safe" instruction).

**Explicitly deferred, NOT built this round**: the full 9-step slot
reorder (rider-experience answer -> party-size answer -> THEN duration ->
date/time -> ... -> payment) across further turns. This round covers the
two turns the live bug report was actually about (intent start, then
horse selection) end to end and correctly; continuing correctly once the
customer ANSWERS the care question (e.g. "เคยขี่มาก่อนครับ") would need
the REST of the slot-filling pipeline (`activityBookingFallbackDraft`) to
also read persisted `taskState.slots` rather than only `chatHistory` --
that pipeline is heavily tested and load-bearing for existing behavior
(duration/date/time extraction, multi-duration disambiguation, etc.), and
extending it safely to be LINE-native (persisted-state-driven, not just
chatHistory-driven) end to end is a larger, separate piece of work this
round intentionally did not touch, to keep this fix scoped and verifiable.

**Feedback pipeline (Fix 6)**: verified, not re-implemented.
`deterministicServiceFeedbackResponse` already calls `createFeedbackEvent`
(persists to `ops_feedback_events`, the same table the tamma-backoffice
"customer voice" dashboard reads, built in an earlier phase) and
`composeServiceFeedbackResponse` already reflects the REAL
`notificationQueued` result rather than claiming success unconditionally.
The one real blocker (the `owner_general` LINE group never being
bindable) was fixed in the immediately-prior "Final LINE Stabilization"
round; this round only added regression tests confirming feedback still
persists and stays honest with and without a bound `owner_general`
channel.

**Files changed**: `netlify/functions/thongthai-chat.ts` (task-state
persistence + new horse-selection responder), `netlify/functions/
_service-mind-conversation-flow.ts` (richer intro text, broadened
markers, qualifier classification), `netlify/functions/_operations-db.ts`
(legacy-flow bypass for the bare intent-start shape). **Tests**:
`tests/horse-service-mind-ux.test.ts`, 14 new tests, all through the full
signed LINE webhook. **Full suite: 842/842 passing** (828 prior + 14
new). Load-bearing verified twice: disabling the legacy-flow bypass broke
exactly A1/A2/A3/A6/A7/A8; separately disabling `horseSelectionWithContextResponse`
broke exactly A2/A3/A6 -- both restores return the suite to 842/842.

**Owner retest checklist**: "อยากขี่ม้า" -> warm intro naming both horses,
asks rider experience + party size, never jumps to duration. Then
"เอาทองไทย" -> "ได้ครับ เลือกทองไทยนะครับ 😊 ทองไทยจะขี่กระด้างกว่านิดนึง
คาแรกเตอร์ขี้เล่นน่ารักครับ เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?" (never
re-asks horse-or-assistant). "ทองไทยกับภาราดรต่างกันยังไง" -> comparison,
stays in horse context, a following "เอาทองไทย" still selects. "วันนี้
ฝนตกปะ", "ทองไทยตอบยาวไป" -> unchanged from the prior round.

**Confirmations**: no booking/order/payment created; no fake notification
success; no DB migration (pure application-code fix, reusing the existing
`guest_agent_state`/`_task-state.ts` machinery); no unrelated production
data mutated.

## Horse UX Production Gap -- 2026-09-23

Owner confirmed PR #61 deployed (commit 640cec9, ready) and retested live
~50 minutes later. Production still hit the legacy "เลือกระยะเวลา 30, 60
หรือ 90 นาที" prompt for a bare "อยากขี่ม้า", and "เอาทองไทย"/"จะขี่ทองไทย"
still got the horse-or-assistant clarification. PR #61's own tests all
passed -- the fix was real but never actually protected production.

**Why the tests passed but production didn't**: `shouldConsumeLegacyLineBookingTurn`'s
bypass only fired `if (!session && isActivityIntentStartMessage(text))`.
Every test in PR #61 (and, it turns out, every test in this ENTIRE
existing suite that reaches this code path) used a brand-new guest, so
`session` was always null. Worse: this shared test harness never modeled
the `booking_sessions` table at all before this round -- any GET fell
through to the generic "unmodeled table -> []" default, silently matching
"no session" instead of real production state. A real LINE account that
has been tested against repeatedly over this whole engagement has a real,
non-null `booking_sessions` row (from an earlier ATV/activity test, days
old), so the `!session` guard never fired, and the legacy flow's own
resume logic (`session.service_type === 'activity'` branch) kept
answering with its own transactional question regardless of what the
customer just typed. **No test in this codebase could have caught this
until the harness itself could model a stale session** -- fixed first
(`tests/helpers/canonical-core-harness.ts` now models `booking_sessions`
with `getBookingSession`/`setBookingSession`), then reproduced exactly
(a new test seeds a 3-day-old, unrelated ATV session before sending
"อยากขี่ม้า" and confirms the old, still-conditional bypass fails that
exact test) before fixing the actual guard.

**Fix**: the bare-intent-start bypass in `shouldConsumeLegacyLineBookingTurn`
is now UNCONDITIONAL -- checked before the `!session` branch, not only
when session is null. A regression test confirms a genuinely ACTIVE,
in-progress legacy session (customer mid-way through an ATV booking,
just supplied a duration) still continues normally -- this bypass only
ever fires for the bare, narrow intent-start sentence itself.

**Second real gap found from the owner's exact reproduction**: "จะขี่
ทองไทย" (a riding verb attached directly to a specific horse's name, but
without the generic word "ม้า") was being treated as ambiguous -- the
SAME as a bare "เอาทองไทย"/"ทองไทย" -- and got the "horse or assistant?"
clarification even with zero prior conversation, because
`hasExplicitHorseBookingIntent`'s vocabulary only recognized "ม้า"/"ขี่ม้า"/
"อยากขี่", not a riding verb glued directly to a proper name. Added
`hasRidingVerbAttachedToHorseName` (`/ขี่(?:ทองไทย|ภาราดร)/u`) as a
narrower, separate signal: unlike a bare name alone, naming a riding verb
together with the horse's name leaves nothing genuinely ambiguous to ask
about, so it now lets both `bareHorseSelectionClarification` (skip the
question) and `horseSelectionWithContextResponse` (select immediately)
treat it as sufficient context on its own, with or without a prior
"อยากขี่ม้า" turn. A bare name with NO riding verb at all
("เอาทองไทย"/"ทองไทย") still correctly requires established context,
verified by dedicated tests for both shapes.

**Files changed**: `netlify/functions/_operations-db.ts` (unconditional
bypass), `netlify/functions/thongthai-chat.ts`
(`hasRidingVerbAttachedToHorseName`), `tests/helpers/canonical-core-harness.ts`
(new `booking_sessions` modeling -- a genuine, previously-missing harness
capability, not just a test). **Tests**: `tests/horse-ux-production-gap.test.ts`,
9 new tests, including the exact stale-session production reproduction
and an active-session regression check. **Full suite: 851/851 passing**
(842 prior + 9 new). Load-bearing verified independently for both fixes:
reverting the unconditional bypass broke exactly the stale-session test
(test 1) and nothing else; disabling the riding-verb detection broke
exactly the no-context "จะขี่ทองไทย" test (test 5) and nothing else.

**Owner retest checklist**: `อยากขี่ม้า` -> warm intro (should now hold
even on the SAME LINE account that has been tested many times before,
since the fix no longer depends on a clean session). `เอาทองไทย` ->
selects. For a true from-scratch check: `จะขี่ทองไทย` with NO prior
message in the conversation should ALSO select immediately (no
clarification) -- this is the new, second fix and worth testing on its
own, not just after "อยากขี่ม้า".

**Confirmations**: no booking/order/payment created; no fake notification
success; no DB migration; no unrelated production data mutated. This
round also did not need to touch or seed anything in the real production
database -- the reproduction was entirely local to this session's test
harness.

## Global Feedback Override (scoped subset of "Master Rebuild") -- 2026-09-23

Owner requested a full "Central Conversation OS" rebuild spanning 12
business units, a new global-priority engine, a new state schema, and 20
acceptance tests. **That full rebuild was not attempted this round** --
it is a multi-week architectural initiative, and building it in one pass
without the same reproduction/load-bearing-verification rigor this whole
engagement has required would risk exactly the "claimed fixed, production
still broken" pattern from the two immediately-prior rounds. This round
instead fixed the two concrete, SEVERE, precisely-specified live failures
(D and E) with full rigor, plus the one precedence rule the task called
"mandatory": feedback/safety must never be swallowed by an active task.

**Failure E (severe) -- root cause found and fixed.** The exact
reproduction ("ทองไทยอธิบายไม่รู้เรื่อง เจิดนิสัยไม่ดี", sent right after
selecting a horse) did not classify as feedback AT ALL:
`classifyServiceFeedback`'s markers only recognized "ทองไทยพูดไม่รู้เรื่อง"
(verb พูด), not "อธิบายไม่รู้เรื่อง" (verb อธิบาย), and only recognized
"พูดไม่ดี"/"ทำไม่ดี" for a staff complaint, not "นิสัยไม่ดี" -- a genuinely
common, natural Thai phrase for "bad attitude." Because it didn't
classify, and because the message happened to contain the substring
"ทองไทย", `isBareAmbiguousHorseSelection`/`horseSelectionWithContextResponse`
treated it as a horse pick instead (horse context was already active).
Fixed both marker gaps (`THONGTHAI_RESPONSE_MENTION`, `SYSTEM_FEEDBACK_
MARKER`, `COMPLAINT_MARKER`, `BARE_NAME_BEHAVIOR_RE`, the `staff_behavior`
issue-keyword pattern -- all in `_service-mind-feedback-intent.ts`).

**Also moved `deterministicServiceFeedbackResponse` to run BEFORE any
active-task continuation code** in `thongthai-chat.ts`'s precedence chain
(previously after `activityBookingFallbackResponse` and the bare-horse
responders) -- this directly implements the task's own "mandatory"
global-priority requirement (feedback must outrank active-task
continuation) as an ORDERING guarantee, not something each downstream
responder has to individually remember. **Honesty check on this specific
change**: empirically verified (by reverting JUST the reorder while
keeping the marker fixes) that the reorder was NOT independently load-
bearing for this round's test set -- the marker fixes alone were
sufficient, because `activityBookingFallbackDraft`/`isBareAmbiguousHorseSelection`
both already had their own `mentionsThongthaiResponse` veto, which the
broadened marker now correctly triggers regardless of check order. The
reorder is kept anyway as genuine architectural hardening (protects
against a FUTURE marker gap, or a future active-task responder that
doesn't share that same veto) and because the task explicitly required it
as a standing rule -- but it is reported honestly as defense-in-depth
here, not falsely claimed as the fix that made today's tests pass.

**Failure D -- root cause found and fixed.** `horseSelectionWithContextResponse`'s
own care question ("เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?", added the
previous round) had no continuation -- the customer's answer named no
horse/activity keyword, matched nothing deterministic, and fell through
to the One-Mind orchestrator's generic "ขอรายละเอียดเพิ่มอีกนิดครับ"
clarification, which never says what's missing -- so asking "รายละเอียด
อะไรครับ?" back just got the SAME vague line again. Added (both in
`thongthai-chat.ts`):
- `horseCareFollowupResponse` -- parses the answer (`ไม่เคย`/`เคย` for
  rider experience, `คนเดียว`/a number for party size via the existing
  `extractPartySize`), persists it onto the active `activity_booking`
  task's `slots` (via `_task-state.ts`'s `mergeTaskSlots`), and asks the
  next SPECIFIC question (health/balance concerns) -- matches the task's
  own example reply almost verbatim.
- `horseCareDetailExplainerResponse` -- if the customer is confused by
  that question ("รายละเอียดอะไรครับ?"), explains EXACTLY what's being
  asked instead of repeating anything vague -- matches the task's own
  example reply verbatim.

**Explicitly NOT built this round** (the rest of the "Master Rebuild"
ask): a single `_conversation-os.ts`/global-priority-engine file; the
11-item global message processing order (safety/complaint/staff-mention/
compliment/system-feedback/change-topic/weather/domain-intent/active-
task/slot-filling/LLM) as one unified ordering rule across ALL domains
(this round only ordered feedback ahead of horse-booking continuation
specifically); domain care-profiles/playbooks for ATV, archery,
restaurant, cafe, homestay, OTOP, journey planning, or the first-time-
visitor ecosystem overview (these still use their existing, separately-
built deterministic responders from earlier phases of this engagement,
which were NOT audited or rebuilt this round); the full state schema
(group_size/customer_type/has_child/child_age/accessibility_needs/etc.)
-- only `riderExperience`/`partySize` were added, scoped to the horse
domain; explicit safety/compliment/change-topic global overrides for
domains other than horse-riding; and the `CONVERSATION_OS_ROUTE`/
`GLOBAL_OVERRIDE_DETECTED`/etc. observability log lines. A mixed
complaint's customer-facing REPLY text also still reflects only ONE
`feedbackType` (whichever of system_feedback/complaint the classifier's
if/else chain matches first) even though the structured DATA capture
(`person_mentions`, `issue_keywords`, `staff_name`) correctly includes
BOTH halves regardless -- the task's own example reply explicitly
acknowledges both halves in one sentence, which would need a genuine
multi-classification composer this round did not build.

**Files changed**: `netlify/functions/_service-mind-feedback-intent.ts`
(marker fixes), `netlify/functions/thongthai-chat.ts` (precedence
reorder, `horseCareFollowupResponse`, `horseCareDetailExplainerResponse`,
`persistHorseCareSlots`, `loadHorseBookingTask`). **Tests**: `tests/
global-feedback-override.test.ts`, 16 new tests, all through the full
signed LINE webhook, covering the exact D and E reproductions plus 10
regression checks (horse flow, weather, casual, group ops, compliment
classification, horse comparison). **Full suite: 867/867 passing** (851
prior + 16 new). Load-bearing verified for the marker fix (disabling
`นิสัยไม่ดี` broke exactly the one dependent test) and for the care-
followup responders (disabling broke exactly the two dependent tests);
the precedence reorder was checked and found NOT independently load-
bearing for this test set, reported honestly above rather than claimed.

**Owner's stated acceptance bar** ("the system must feel like a real
ทำมา-ชาติ host across all business units") is **not yet met** by this
round alone -- only the horse-riding domain and the feedback-override
mechanism were addressed. If the owner wants the remaining 10+ business
units built out to the same before/during/after playbook depth (ATV,
archery, restaurant, cafe, homestay, OTOP, journey, ecosystem overview,
plus explicit global safety/compliment/change-topic overrides for all of
them, plus the full state schema and observability logging), that is
recommended as a separate, explicitly-scoped follow-up initiative -- this
round's honest recommendation, not a decision made unilaterally on the
owner's behalf.

**Confirmations**: no booking/order/payment created; no fake notification
success; no DB migration; no unrelated production data mutated.

## Feedback Delivery Constraint -- 2026-09-23

Owner reported, with live evidence, that PR #63 did not actually fix
anything the owner could observe: vague slot-filling still repeated
"ขอรายละเอียดเพิ่มอีกนิด" after the horse health question was answered, and
sending the exact complaint "ทองไทยอธิบายไม่รู้เรื่อง เจิดนิสัยไม่ดี" got a
"will forward" reply while the owner group received nothing and the
backoffice "เสียงลูกค้า" dashboard showed nothing. The task's explicit rule
this round: **"No response text is considered fixed unless the backend
proof exists."** Every claim below is backed by a real database query or
a test that fails when the fix is reverted -- not by re-reading code.

**Root cause 1 (the real reason the owner group received nothing) --
found by querying REAL production `ops_feedback_events` rows directly**,
not by re-testing against the mock harness (which had already given
false confidence in prior rounds). A real row's `notification_error`
column contained the literal Postgres error `{"code":"23514",...}` --
`check_violation`. Querying `pg_constraint` showed
`ops_notification_deliveries_entity_type_check` and
`_delivery_type_check` had never been extended to allow
`entity_type:'feedback_event'` / `delivery_type:'feedback_<type>'` since
the Feedback Operations feature was first built. `beginDelivery`
(`_ops-notifications.ts`) inserts into `ops_notification_deliveries`
*before* attempting the actual LINE push (an idempotency-reservation
pattern) -- so **every feedback notification, ever, failed at the
database layer before the LINE push was even attempted**, regardless of
whether `owner_general` was bound, regardless of any application-code fix
from any prior round. Fixed via an additive migration
(`supabase/migrations/20260923091310_ops_notification_deliveries_feedback_v1.sql`,
applied directly to production), verified by re-querying the constraint
definitions afterward and by a clean insert/delete round-trip proof
against the live constraint (no lasting data change).

**Why previous rounds claimed feedback worked but the owner saw
nothing**: three pre-existing tests (`ops-notifications-owner-general.test.ts`
tests 6-7, `service-mind-feedback-notifications.test.ts` test 21) asserted
`notification_status: 'sent'` and were genuinely passing -- but as a
FALSE POSITIVE, because `tests/helpers/canonical-core-harness.ts`'s
`ops_notification_deliveries` mock accepted any insert unconditionally,
never modeling the real CHECK constraints that were rejecting every
actual feedback notification in production. Fixed the harness to
validate against the real constraint shape, and verified this mattered
by temporarily reverting it to the old permissive shape -- exactly those
3 tests failed, nothing else. This closes a systemic, generalizable test-
fidelity gap: any future code touching `ops_notification_deliveries` is
now validated against realistic constraints.

**Root cause 2 -- staff mentions silently dropped from backoffice data.**
Inspecting the real persisted row for the exact complaint text showed
`person_mentions: [{"kind":"role","label":"ทองไทย"}]` only -- "เจิด" was
completely missing, even after the marker fixes from the prior round.
`extractPersonMentions` (`_service-mind-feedback-intent.ts`) early-
returned as soon as it found a role hit (`ROLE_WORDS` includes 'ทองไทย',
intentionally, so a complaint about the bot itself is still recorded) --
so a message naming BOTH Thongthai's own behavior AND a real staff member
only ever recorded one of them. A second, compounding bug:
`BARE_NAME_BEHAVIOR_RE` was anchored to string-start only, so it would
not have matched "เจิด" mid-string anyway. Fixed both: the function now
collects role and named mentions independently instead of stopping at
the first; the anchor changed to `(?:^|\s)`.

**Backoffice visibility -- investigated, no bug found in that repo.**
Read `tamma-backoffice/netlify/functions/customer-voice.ts` directly:
it reads `ops_feedback_events` -- the exact same canonical table
`tamma-chat` writes to (no "table A vs table B" mismatch, confirmed by
querying both). Its `environment=eq.live` and 30-day-window filters
match every real row's actual `environment`/`created_at` values.
**Refuted the "wrong table" hypothesis with direct evidence rather than
assuming it.** The stale header comment claiming the v1/v2 migrations
"are prepared but NOT applied" was corrected (they are applied; real
production rows exist). Added `tamma-backoffice/tests/
customer-voice-visibility-proof.test.ts` -- the first test in that repo
to exercise the actual `handler` end-to-end (real signed owner cookie via
`_auth.ts`'s `cookie()`, mocked Supabase fetch) rather than only the pure
aggregation functions or source-text greps: seeds a row shaped exactly
like tamma-chat's insert for the real complaint text and proves it
surfaces in `recent`/`people`/`businessUnits` with the raw text, staff
mention, and classification intact; a second test proves the endpoint
never reaches the database without a valid owner cookie. Both load-bearing
verified (disabling the owner check broke exactly the auth test).

**Horse-care vague-fallback closed.** The task gave an exact 5-turn
conversation ending in "ผมไม่เคยขี่ครับไม่กังวลครับ ไม่ปวดหลัง" and an
exact expected next reply. Added a third step to the horse-care flow in
`thongthai-chat.ts`: `parseHealthConcern` (recognizes
none/present via ไม่มี/ไม่กังวล/ไม่ปวด vs ปวดหลัง/กังวลเรื่องทรงตัว
phrasing) and `horseHealthFollowupResponse`, which fires only once
`riderExperience`+`partySize` are already known and `healthConcern` is
not yet set, persists the answer onto the active task's slots via the
existing `_task-state.ts` machinery, and produces the acknowledgment +
30-minute/60-minute duration-choice question matching the task's example
almost verbatim. `horseCareDetailExplainerResponse` gained a guard so it
never fires once `healthConcern` is answered (this responder now owns
that point in the conversation).

**Files changed**: `netlify/functions/_service-mind-feedback-intent.ts`
(`extractPersonMentions`, `BARE_NAME_BEHAVIOR_RE`),
`netlify/functions/thongthai-chat.ts` (`parseHealthConcern`,
`horseHealthFollowupResponse`, `persistHorseHealthSlot`, a guard added to
`horseCareDetailExplainerResponse`), `tests/helpers/
canonical-core-harness.ts` (real constraint validation for
`ops_notification_deliveries`), `supabase/migrations/
20260923091310_ops_notification_deliveries_feedback_v1.sql` (applied to
production). Backoffice repo: `netlify/functions/customer-voice.ts`
(doc-comment correction only, no behavior change), `tests/
customer-voice-visibility-proof.test.ts` (new).

**Tests**: `tests/feedback-delivery-constraint-proof.test.ts` (new, 6
tests, all through the full signed LINE webhook) plus the backoffice's 2
new tests above. **tamma-chat full suite: 873/873 passing** (867 prior +
6 new). **tamma-backoffice full suite: 67/67 passing** (65 prior + 2
new). Load-bearing verified for: `extractPersonMentions` (reverting broke
exactly tests 1 and 7, the two that check staff-mention capture, nothing
else), `horseHealthFollowupResponse` (disabling broke exactly test 6,
nothing else), the harness constraint validation (reverting broke exactly
the 3 named pre-existing tests, nothing else), and the backoffice owner
gate (disabling broke exactly the auth test, nothing else).

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round. The DB migration is confirmed live in production
(applied directly via the Supabase MCP tool, not pending a deploy); the
application-code fixes require a Netlify deploy of both repos to reach
production, which the owner should confirm via their own dashboard.

**Confirmations**: no booking/order/payment created; no fake notification
success reported; one additive DB migration applied and verified
non-destructive; no unrelated production data mutated (a test insert to
`ops_notification_deliveries` was made and immediately deleted as part of
verifying the constraint fix).

## Semantic Hospitality Intelligence -- 2026-09-23

Owner's "Next Phase" request asked for a full semantic-understanding layer
across all 12 business units (typo/colloquial normalization, fear/health/
customer-type/intensity/weather signal extraction, worst-case policies,
18 numbered tests) -- explicitly warning against "keyword-triggered, not
understanding" behavior. Given the same discipline as the prior "Master
Rebuild" round (see that entry above), a full 12-domain buildout was not
attempted in one pass -- that risks exactly the "claimed fixed, still
broken" pattern this whole engagement has fought. Instead: a genuinely
reusable semantic-interpreter CORE was built with real tests, then wired
deeply into the domain with the most existing infrastructure and the
richest worked examples (horse riding), a minimal but real extension for
ATV and archery, and honest, tested verification (not new code) for
feedback and restaurant. Cafe/homestay/journey got no new domain code
this round -- reported honestly below, not claimed.

**New module**: `netlify/functions/_semantic-hospitality-interpreter.ts`
-- `normalizeThai` (a deliberately SHORT typo table: only pairs with no
other plausible meaning, e.g. "ขี้ม้า"->"ขี่ม้า", "ทองทัย"->"ทองไทย",
"พาราดร"->"ภาราดร", "กังวน"->"กังวล" -- skips genuinely ambiguous cases
like "ขี่มา" rather than guess), `interpretFear` (concern vs. explicit
no-concern, correctly disambiguating "ไม่ค่อยมั่นใจ" from "มั่นใจ"),
`interpretHealthConcerns`/`interpretOverallHealthConcern` (per-body-part
back/knee/hip/shoulder, negation-aware), `interpretExperience`,
`interpretCustomerType` (elderly companion / child with age, bounded
against false positives like "แม่ครัว"/"แม่บ้าน"), `prefersGentleIntensity`,
`mentionsWeatherGroundConcern`, `asksIfSafe`, `mentionsSpeedFear`, and a
shared `noSafetyGuaranteeMessage` so every risky-activity responder says
the same honest thing (team assesses/supervises/starts slow, never a
guarantee). 7 unit tests in `tests/semantic-hospitality-interpreter.test.ts`.

**Horse riding (deep integration, tests 1-6 + 16-18, all 9 passing)**:
`parseRiderExperience`/`parseHealthConcern` now delegate to the
interpreter (broader coverage, same call sites). Four new responders in
`thongthai-chat.ts`: `horseCareFearResponse` (fear/concern expressed
instead of answering the current slot -- e.g. "กังวลนิดนึง" -- reassures
and re-asks instead of falling through to the vague fallback),
`horseSafetyQuestionResponse` ("ปลอดภัยไหม" mid-flow -- never a
guarantee), `horseCompoundCareIntentResponse` (a compound OPENING message
naming a family/elderly/child/health signal in the same sentence, e.g.
"แม่อยากขี่ม้า เข่าไม่ค่อยดี" or "เด็ก 8 ขวบอยากขี่" -- team-assessment
caveat, never rushes to duration; explicitly defers to
`isActivityIntentStartMessage`'s existing, more specific qualifier
mechanism for shapes it already owns, e.g. "อยากขี่ม้า มีเด็กไปด้วย").
`horseCareFollowupResponse` extended to recognize a compound single-
message answer ("ผมไม่เคยขี่ครับ ไม่กังวลครับ ไม่ปวดหลัง") including a new
`SOLO_SELF_REFERENCE_RE` fallback (a first-person-singular self-reference
with no companion mention, used only as a last resort when neither an
explicit number nor "คนเดียว" is present).

**A real, severe production-shaped bug found and fixed along the way**:
the legacy LINE booking flow (`_operations-db.ts`'s
`shouldConsumeLegacyLineBookingTurn`/`handleLineBookingMessage` -- the
SAME flow multiple earlier rounds already fought to suppress for the
"อยากขี่ม้า"/"เอาทองไทย" cases) was still consuming compound care-signal
OPENING messages it wasn't specifically patched for, producing its
transactional "เลือกระยะเวลา..." prompt instead of ever reaching any
care-aware responder. Fixed with a new, narrowly-scoped guard (only for a
genuinely fresh conversation, `!session`): defer to the richer core
whenever the message carries a customerType/health/weather/fear signal.
This single fix is what actually makes tests 4, 7, 8, and 9 possible --
confirmed by disabling it and watching exactly those 4 tests fail.

**A second real bug found and fixed via test 10's own assertion failing
against ACTUAL behavior**: `_restaurant-intelligence.ts`'s allergy filter
relied solely on a curated `menu_item.profile.allergenFlags` tag (from a
separate, rarely-populated profile table) -- a customer saying "แพ้กุ้ง"
(shrimp allergy) still got "ต้มยำกุ้ง" (shrimp tom yum) recommended,
because that item's curated profile was empty even though its raw
`ingredient_names` literally lists "กุ้ง". Fixed by also pushing the bare
allergen keyword into `avoidIngredients`, which the existing raw-
ingredient-name cross-check already uses -- a food-safety-appropriate
"better an occasional over-broad exclusion than serving an allergen"
trade-off (documented in the code).

**ATV (minimal, test 7-8, both passing)**: one new responder,
`atvCareIntentResponse` -- beginner and/or speed-fear signal in the
opening message gets a team-briefing/slow-start reply instead of the
legacy flow's transactional prompt. No full ATV booking-task flow built
(unlike horse riding, which already had one from a prior round). Test 8
(safety feedback, "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว") needed NO new code --
the existing feedback pipeline's `SAFETY_CONCERN_MARKER` and 'activity'
business-unit inference already covered it; only a new test was added to
prove it, plus the legacy-flow guard fix above (without it, this message
was ALSO being swallowed by the transactional flow before ever reaching
feedback classification).

**Archery (minimal, test 9, passing)**: one new responder,
`archeryCareIntentResponse` -- a stated shoulder concern ("อยากยิงธนู แต่
เจ็บไหล่") gets team guidance instead of the prior generic "ไม่มีตัวเลือก
ที่ตรง" (no matching option) non-answer.

**Feedback (test 14-15) and restaurant (test 10) -- verified against
EXISTING infrastructure, no new classification code**: test 14 (the exact
complaint text) already has comprehensive coverage from a prior round
(`tests/feedback-delivery-constraint-proof.test.ts`). Test 15 ("พี่เจิด
ดูแลดีมาก") already worked via the existing `COMPLIMENT_MARKER`/
`STAFF_NAME_RE` -- a new test proves it. Test 10 (restaurant allergy/
spice) needed the allergy bug fix above; the spice/allergen PARSING
itself (`_restaurant-intelligence.ts`) already existed and is genuinely
sophisticated.

**Explicitly NOT built this round (cafe, homestay, journey -- tests 11,
13, 12)**: no dedicated domain intent/care module exists for these
(unlike horse riding's task-state flow or even ATV/archery's minimal
responders). Diagnosed their CURRENT behavior honestly instead of
guessing: cafe preference ("อยากกินกาแฟ ไม่เข้ม หวานน้อย") gets an honest
"no verified data, won't guess" reply -- safe (never invents a coffee
menu/price that doesn't exist) but doesn't acknowledge the specific
preference. Homestay ("อยากพัก พาแม่มา เดินไกลไม่ได้") and journey
("มาเที่ยว 1 วัน ไม่อยากเดินเยอะ") already behave reasonably (the mobility
signal is reinforced into structured memory; a real, relevant follow-up
question is asked) via existing local-concierge/service-mind-care-context
infrastructure -- not full semantic care-awareness matching horse
riding's depth, but not hallucinating either. New tests lock in this
honest baseline. Building full domain playbooks for these three (plus
full worst-case policies, dedicated task-state flows, and the remaining
9 domains from the original 12-domain ask) is recommended as a separate,
explicitly-scoped follow-up -- this round's honest recommendation, not a
decision made unilaterally on the owner's behalf.

**Files changed**: `netlify/functions/_semantic-hospitality-interpreter.ts`
(new), `netlify/functions/thongthai-chat.ts` (parseRiderExperience/
parseHealthConcern delegation, horseCareFearResponse,
horseSafetyQuestionResponse, horseCompoundCareIntentResponse,
horseCareFollowupResponse's compound-answer + solo-self-reference
extension, atvCareIntentResponse, archeryCareIntentResponse, all wired
into processThongthaiChatCore's precedence chain before
activityBookingFallbackResponse), `netlify/functions/_operations-db.ts`
(shouldConsumeLegacyLineBookingTurn's new care-signal deferral guard),
`netlify/functions/_restaurant-intelligence.ts` (allergy-to-ingredient
safety-net fix).

**Tests**: `tests/semantic-hospitality-interpreter.test.ts` (7, new),
`tests/semantic-horse-understanding.test.ts` (9, new, full signed LINE
webhook), `tests/semantic-atv-understanding.test.ts` (2, new),
`tests/semantic-feedback-restaurant-verification.test.ts` (2, new),
`tests/semantic-diagnostic-remaining-domains.test.ts` (4, new).
**Full suite: 897/897 passing** (873 prior + 24 new). Load-bearing
verified individually for every new responder/guard (disabling each one
broke exactly its target test(s), confirmed by name): horseCareFearResponse
(tests 2, 17), horseSafetyQuestionResponse (test 18),
horseCompoundCareIntentResponse (tests 4, 5), atvCareIntentResponse
(test 7), archeryCareIntentResponse (test 9), the
shouldConsumeLegacyLineBookingTurn guard (tests 4, 7, 8, 9 -- broader
than any single responder, confirming it's the real root-cause fix), and
the restaurant allergy-to-ingredient fix (test 10).

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Confirmations**: no booking/order/payment created; no fake safety
guarantee anywhere in new or existing wording; no DB migration; no
unrelated production data mutated.

## Knowledge Base + Scenario Brain -- 2026-09-23

Owner's "Next Phase" request asked to expand Thongthai from semantic
intent understanding (PR #65) into a richer hospitality knowledge +
scenario brain across 11 business-unit domains, with at least 30 new
load-bearing tests. Same discipline as every prior "Next Phase" round in
this engagement: a full 11-domain rebuild was not attempted in one pass
-- instead, real depth was added to the domains with existing
infrastructure (horse riding), minimal-but-real extensions to ATV/
archery (following the prior round's precedent), two genuinely new
domains built from owner-supplied facts (ecosystem/first-visit,
homestay), and honest verification (plus two narrow, real marker
fixes) for the remaining domains rather than inventing new
infrastructure everywhere.

**New knowledge module**: `netlify/functions/_tamma-domain-knowledge.ts`
-- `ECOSYSTEM_PATHS` (the owner's own 3-path framing: สายชิล/สายกิจกรรม/
สายพัก, reusing `_ecosystem-entity-graph.ts`'s real business-unit ids)
and `HOMESTAY_FACTS` (6 houses total, 3 two-bedroom, 3 one-bedroom,
check-in ≤14:00, check-out ≤12:00, room service 10:00-22:00, 24h booking
window, final confirmation via LINE/email/phone only -- all supplied
directly by the owner this round, same "owner-provided, owner-verified,
nothing beyond it" discipline as `_local-concierge-knowledge.ts`'s
HORSE_FACTS). Deliberately does NOT include night-by-night room
availability -- that changes daily and has no real data source here, so
it always gets an honest "team confirms" answer, never a guess.

**Ecosystem / first-time visitor (NEW domain, 4 tests)**: new responder
`ecosystemFirstVisitResponse` in `thongthai-chat.ts` -- "มาครั้งแรก มีอะไร
แนะนำ" now gets the owner's exact 3-path breakdown + asks group size/vibe
(previously handled by `_experience-discovery.ts`'s legacy fallback,
which is explicitly marked "MUST NOT be expanded" -- this is a separate,
higher-precedence responder, not a change to that file). A rain-aware
"ฝนตกไปไหนดี" now suggests real indoor-friendly business units (reusing
`_local-concierge-knowledge.ts`'s existing `INDOOR_FRIENDLY_BUSINESS_UNITS`)
instead of a generic apology. A bare elderly/child + low-walking request
with no specific domain named ("พาแม่ไป อยากได้เดินน้อย") gets a caring
reply instead of falling through -- but explicitly DEFERS to
`_service-mind-care-context.ts`'s existing `classifyCareContext` when
that already recognizes the message (confirmed necessary: a regression
was found and fixed where this new responder was shadowing that
existing, more specific mechanism for phrasings it already handled).

**Horse riding (deep extension, 10 tests)**: four real gaps closed.
(1) A fear-only compound opener ("อยากขี่ม้า ไม่เคยเลย กลัวตก") now gets
care mode instead of falling through -- `horseCompoundCareIntentResponse`
extended to also trigger on `interpretFear(...) === 'concerned'`, not
just customerType/health. (2) "ลูก" (one's own child) is now recognized
as a child reference, not only "เด็ก" -- bounded the same way "แม่"/"พ่อ"
already are (ลูกค้า/ลูกทีม/ลูกน้อง never false-positive). (3) A goal that
doesn't need a full ride (photo-only/touch-only), a firmness preference
between the two real configured horses ("นิ่มกว่า" -> ภาราดร, "แน่นกว่า"
-> ทองไทย, using the SAME HORSE_FACTS data every other horse responder
uses), a weight/size concern, and a hands-on-support request ("ให้คนจูง
ได้ไหม") all now get real, honest replies via a new
`horseScenarioSignalResponse` -- never a fabricated weight limit, never
a safety guarantee. (4) A real, severe production-shaped bug found along
the way: the legacy LINE booking flow was STILL swallowing these new
compound signals before any care-aware responder ever ran (the SAME
class of bug fixed for the prior round's signals) -- fixed by extending
`_operations-db.ts`'s existing deferral guard with the new signals;
confirmed load-bearing across 4 different tests in one disable/confirm
pass.

**ATV (extended, 6 tests)**: `atvCareIntentResponse` extended with a
child-passenger age question ("เด็กซ้อน ATV ได้ไหม" -- never guarantees,
asks age), a brake-question response (context-independent -- "เบรก" is
unambiguous in this business), an honest speed-calibration reply for
"อยากมันส์ ๆ เร็ว ๆ" (never guarantees a speed level), and back-concern
acknowledgment. A new `hasEverDiscussedAtv`/`markAtvIntentStarted` pair
gives ATV its own lightweight context-tracking (mirroring horse riding's
`hasEverDiscussedActivityDomain` pattern) so a follow-up like "ถ้าเบรกไม่
เป็นทำไง" is understood without re-naming "ATV" every turn.

**Archery (extended, 4 tests)**: `archeryCareIntentResponse` extended
with a beginner-teaching reply, a child+age question (with the same
"ลูก"/"เด็ก" recognition, guardian mention, no safety guarantee), and a
photo-only goal reply (reusing `interpretActivityGoal`'s existing
PHOTO_ONLY_MARKER, which already covered "ถ่ายรูปกับธนู"). **A real bug
found and fixed while extending this**: the first version of this
extension let a bare customerType (child/elderly) signal bypass the
archery-intent gate entirely, causing it to incorrectly hijack unrelated
messages like "อยากขี่ม้า มีเด็กไปด้วย" and "มีเด็กกับผู้สูงอายุ" (caught
by the full suite regressing 6 pre-existing tests) -- fixed by requiring
explicit archery intent or prior archery context before ANY signal
(including customerType) is checked, confirmed via the full suite
returning to green.

**Homestay (NEW domain, 5 tests)**: new responder `homestayFactsResponse`
answers room-count questions, check-in/out timing, and elderly/child-
aware opening messages from the real `HOMESTAY_FACTS` data -- and
explicitly, honestly declines any night-by-night availability question
("คืนนี้ว่างไหม") rather than guessing. This closed a genuine, pre-
existing "KNOWN GAP" that `tests/gate2-line-web-domain-equivalence.test.ts`
had explicitly documented and locked in (a test asserting "must never
assert a specific time it has no real per-question adapter for") --
that test was updated to reflect the now-real per-question adapter,
not reverted.

**Verified-existing (no new domain code) + two narrow marker fixes**:
restaurant (real menu data, spice/allergy filtering already
sophisticated -- verified with new tests, no changes), cafe (honestly
declines with no fabricated menu/price, verified, no cafe data source
exists to build on), OTOP (same), journey planning (already asks
mobility/dietary follow-ups for family+elderly+children, verified). Two
real, narrow gaps were found and fixed: (1) `_local-concierge-intent.ts`'s
`LOCATION_MARKER` was missing "อยู่ตรงไหน" (only had "อยู่ไหน"/"อยู่ที่ไหน")
and "ขอแผนที่" -- both now correctly surface the real owner-provided map
link (`_local-concierge-location.ts`'s `TAMMA_CHART_LOCATION`, already
correct, never touched). (2) `_service-mind-feedback-intent.ts`'s
`COMPLAINT_MARKER` was missing "ควรแก้"/"ช่วยปรับ" -- a constructive,
hesitant complaint ("ไม่อยากรีวิวแย่ แต่ควรแก้เรื่องพนักงาน") now
correctly creates a feedback event instead of falling through to the
generic apology.

**Semantic interpreter core additions**: `interpretActivityGoal`
(photo_only/touch_only), `interpretFirmnessPreference` (softer/firmer),
`mentionsWeightOrSizeConcern`, `mentionsSupportRequest`,
`mentionsBrakeQuestion`, `mentionsChildPassengerQuestion`,
`wantsIntenseExperience`, `prefersLowWalking` -- plus two marker
extensions to existing functions: `interpretCustomerType`'s
`ELDERLY_MARKER` now also matches "พา...ไป" (not only "พา...มา"), and its
child detection now also matches "ลูก" (not only "เด็ก").

**Files changed**: `netlify/functions/_semantic-hospitality-interpreter.ts`
(new signal extractors, marker fixes), `netlify/functions/_tamma-domain-knowledge.ts`
(new), `netlify/functions/thongthai-chat.ts` (ecosystemFirstVisitResponse,
homestayFactsResponse, horseScenarioSignalResponse,
horseCompoundCareIntentResponse's fear extension,
atvCareIntentResponse/archeryCareIntentResponse extensions, all wired
into the precedence chain), `netlify/functions/_operations-db.ts`
(legacy-flow guard extended with the new signals),
`netlify/functions/_local-concierge-intent.ts` (LOCATION_MARKER fix),
`netlify/functions/_service-mind-feedback-intent.ts` (COMPLAINT_MARKER
fix). Two pre-existing tests were updated (not reverted) to reflect
genuine behavior improvements: `tests/gate2-line-web-domain-equivalence.test.ts`'s
"stay" test (the check-in-time known-gap, now closed) and
`tests/ecosystem-cross-domain-stress.test.ts`'s first-visit test (regex
broadened to also accept "อาหาร" alongside "กิน"/"ตำมา-ชาติ", matching the
owner's own literal 3-path wording).

**Tests**: 6 new test files -- `tests/scenario-ecosystem.test.ts` (4),
`tests/scenario-horse-extended.test.ts` (9), `tests/scenario-atv-extended.test.ts`
(4), `tests/scenario-archery-extended.test.ts` (4), `tests/scenario-homestay.test.ts`
(5), `tests/scenario-remaining-domains-verification.test.ts` (9) -- plus
extensions to `tests/semantic-hospitality-interpreter.test.ts` (4 new
unit tests for the new signal extractors and marker fixes). **39 new
tests total** (exceeds the requested 30). **Full suite: 936/936 passing**
(897 prior + 39 new). Load-bearing verified individually for every new
responder and guard via disable/confirm, each breaking exactly its
target test(s): `ecosystemFirstVisitResponse` (E1/E2/E4), `homestayFactsResponse`
(S1-S4), `horseScenarioSignalResponse` (H4/H6/H9/H10), ATV's child-
passenger/brake signals (A2/A4), the LOCATION_MARKER fix (W2/W3), and the
COMPLAINT_MARKER fix (F3).

**Confidence policy**: implemented implicitly, not as a separate scored
system -- every new signal extractor is either a bounded, structural
match (acts directly -- "high confidence" per the spec) or returns
null/false (never guesses -- effectively "ask/defer" for anything not
confidently matched). No new phrase is treated as a fact source; e.g.
`interpretFirmnessPreference` only ever selects between the two REAL
configured horses, never invents a third option or a safety ranking.

**No-safety-guarantee enforcement**: every new risky-activity responder
(horse's weight/support signals, ATV's brake/intense/child-passenger
signals, archery's child/beginner signals) either reuses the shared
`noSafetyGuaranteeMessage` helper or independently states "ไม่ขอการันตี...
100%" -- verified by the H8/A5/AR3 tests, none of which permit an
unqualified "ปลอดภัยแน่นอน"/"การันตี" claim to survive.

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Confirmations**: no booking/order/payment created; no fake safety
guarantee anywhere in new or existing wording; no DB migration; no
unrelated production data mutated; no fabricated fact, price, or
availability anywhere in new responder wording (all facts trace to
either owner-supplied static data or real, already-existing menu/asset
data sources).

## PR #66 Production Precedence Fix -- 2026-09-23

The prior round ("Knowledge Base + Scenario Brain", PR #66) passed
936/936 tests and was merged, but the owner reported 5 live production
failures the round's own tests claimed were fixed: bare horse-fear and
ATV-fear/safety messages still got the legacy `handleLineBookingMessage`
flow's "รับกิจกรรม ... แล้วครับ เลือกระยะเวลา 30, 60 หรือ 90 นาทีได้เลย"
transactional prompt instead of the care/safety responders, a restaurant
allergy question was suspected of hallucinating menu/prices, and a bare
ambiguous "สติ" got the generic degraded-provider apology.

**Root cause (the 3 swallowed-signal failures)**: `_operations-db.ts`'s
`shouldConsumeLegacyLineBookingTurn` guard has two unconditional checks
that must defer to the semantic/care/safety layer regardless of whether
a legacy `booking_sessions` row already exists for that guest --
`isActivityIntentStartMessage` (fixed in an earlier round, with an
explicit incident comment) and `hasCareOrRiskSignal` (added the round
*before* this one). The second check was added scoped to `if (!session)`
-- it protected a brand-new conversation but NOT a conversation where any
legacy session already existed, even one an innocuous earlier message
legitimately created (e.g. a bare "อยากขับ ATV"). A later, genuine
safety/care message in that same conversation was never checked against
the guard at all, and the legacy flow resumed and answered with its own
transactional prompt, completely ignoring the safety/care content. This
is the EXACT same bug class the first check was already fixed for once
-- the fix was never generalized, so the second guard shipped with the
identical mistake, undetected because every prior round's test used a
fresh `userId` per test and therefore never exercised an EXISTING
session. Reproduced directly (scratch test, since deleted): establish a
bare ATV session, then send a safety message as a second turn -- got the
identical duration prompt both times.

**Fix**: `hasCareOrRiskSignal` is now unconditional, checked before ANY
session-status branching, exactly matching `isActivityIntentStartMessage`'s
own precedent immediately above it in the same function. Also extended
the signal vocabulary with a new `mentionsSafetyConcern`
(`_semantic-hospitality-interpreter.ts`), mirroring
`_service-mind-feedback-intent.ts`'s existing `SAFETY_CONCERN_MARKER` so
bare safety reports ("น่ากลัว", "พื้นลื่น", "ไม่มีคนดู", "ล้ม") are
covered, not just weather/ground-specific phrasing.

**Production-precedence logging (proves which handler answers, from logs
alone, not just local reproduction)**: added `SEMANTIC_FRAME_BUILT` and
`LEGACY_LINE_GUARD_DECISION` (with a `reason` string) at every exit of
`shouldConsumeLegacyLineBookingTurn`; `LEGACY_BOOKING_CONSUMED` and
`FINAL_RESPONSE_SOURCE` in `_line-webhook-core.ts` at the legacy-booking
and LLM-core exits; `SEMANTIC_RESPONDER_SELECTED` at every relevant
care/safety/restaurant/short-text responder's return in
`thongthai-chat.ts`; `ACTIVITY_BOOKING_FALLBACK_SELECTED` at
`activityBookingFallbackResponse`'s return.

**Restaurant menu audit (owner asked: is the menu/price data
fabricated? if the source isn't trusted, disable it)**: verified
directly against the real production Supabase project
(`upaokrprawzhgzeqsdke`, `tamma_chart_os.restaurant_menu_live`) -- 30
real, substantial Thai dishes with real prices and ingredient lists
(ตำลาว 79฿, ลาบปลาช่อน 169฿, ต้มแซ่บไก่บ้าน 179฿, etc.), all
`is_orderable: true`. `_restaurant-sot.ts`'s `listRestaurantMenu()`
queries this real view; `thongthai-chat.ts`'s `formatAdvisorMessage` is a
hard-coded template built directly from that structured data (menu
name/price/reason), never an LLM freeform composition -- there is no
fabrication in this path, and no fallback to invented/placeholder data
exists. Conclusion: the source IS trusted; nothing needed disabling. The
real gap was wording: the existing allergy notice
(`_restaurant-intelligence.ts`'s `adviseRestaurantMenu`) described what
the system already filtered but never told the customer to also notify
kitchen staff in person -- the one step that actually protects against
cross-contact, which no ingredient list can rule out. Added that
instruction to the notice. The shrimp-allergy ingredient cross-check
itself (`avoidIngredients.push('กุ้ง')` catching "กุ้งแห้ง" via substring)
was already correct from an earlier round.

**Short-unclear-text responder (new)**: a bare ambiguous fragment
("สติ", "เอ้า", "อะไร", "งง", "ห้ะ", "อืม", "ต่อ", "แล้วไง") used to fall
all the way through to the generic "คิดช้ากว่าปกติ" degraded-provider
apology (implying the AI was slow/down, when the real issue was the
message being too short to interpret), or reach the LLM at all for
something no model call could ground an answer in either. New
`deterministicShortUnclearTextResponse`/`isShortUnclearTextMessage`
(`thongthai-chat.ts`), checked in the same early pre-LLM slot as
`deterministicGreetingResponse`/`deterministicCasualChatResponse`,
anchored whole-message-only so it never fires on a message that merely
contains one of these words alongside real content (e.g. "ร้านอาหารมีอะไร
แนะนำ" keeps its own restaurant handling). Wired into
`_line-webhook-core.ts`'s `LINE_PRIVATE_CHAT_ATTEMPT` bookkeeping too, so
that log line stays accurate.

**Tests added**: `tests/pr66-production-precedence.test.ts`, 8 tests
through the full signed LINE webhook, real handler order -- the exact 5
originally-failing phrases (horse fear, ATV fear, ATV safety, restaurant
allergy, "สติ"), PLUS the two regression-proof tests the incident
demanded: #4 and #5 first establish a REAL legacy `booking_sessions` row
via a genuine prior turn (not a mock shortcut) through the real webhook,
then send the safety/care message and assert the override still wins.
Test #8 is a blanket negative assertion that no care/safety compound
message across every scenario gets the legacy duration-first prompt.

**Load-bearing verification**: reintroduced the exact bug (`if (!session
&& hasCareOrRiskSignal)`) and confirmed tests #4, #5, and #8 correctly
fail (tests #1/2/3/6/7, which don't involve an existing session, stay
green, as expected) -- proving these tests actually catch the class of
regression this incident was. Restored the fix; all 8 pass again.

**Full suite**: 944/944 passing (936 prior + 8 new), zero regressions.

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Owner retest script** (the exact 5 originally-failing live phrases):
1. "อยากขี่ม้า ไม่เคยเลย กลัวตก" -> expect care-mode reply, never
   "เลือกระยะเวลา 30, 60 หรือ 90 นาที".
2. "อยากขับ ATV ไม่เคยขับ กลัวเร็ว" -> expect slow-start/team-briefing
   reply, never the duration prompt.
3. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> expect a safety-acknowledgment
   reply (never the duration prompt), sent both as a fresh message AND
   mid-way through an already-started ATV booking.
4. "ร้านอาหารมีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง" -> expect no
   shrimp-containing item recommended, and an explicit "แจ้งพนักงาน"
   instruction in the reply.
5. "สติ" -> expect "ขอโทษครับ หมายถึงให้ทองไทยตั้งสติ/ตอบใหม่ หรืออยาก
   ถามเรื่องไหนต่อครับ?", never "คิดช้ากว่าปกติ".

**Confirmations**: no booking/order/payment created; no fake safety
guarantee anywhere in new or existing wording; no DB migration; no
unrelated production data mutated; no fabricated fact, price, or
availability anywhere (restaurant menu source confirmed real via direct
production query, not assumed).

## Post-PR67 Polish -- safety escalation, LINE brevity, host-style restaurant -- 2026-09-23

After PR #67 fixed the legacy-booking precedence bug, the owner reported
production was much better but not yet polished: a safety report's
owner/general LINE group notification was invisible even though the
activity team's own group got it; restaurant/advisory replies were too
dense for LINE; and a partial notification failure wasn't reflected
precisely in the customer-facing reply. Same "fix the cross-cutting rule,
not each symptom one by one" instruction as the round itself asked for.

**Root cause (Task 1)**: `_ops-notifications.ts`'s owner_general
escalation for a feedback event was scoped to `severity === 'urgent'`
only. A real safety report classified via `SAFETY_CONCERN_MARKER`
("พื้นลื่นมาก ตอนเล่น ATV น่ากลัว", "เกือบล้ม", "ไม่มีคนดู", etc.) scores
`severity: 'high'`, not `'urgent'` -- `URGENT_SAFETY_MARKER` is reserved
for an in-progress injury ("บาดเจ็บ"). So almost every real safety report
never triggered the escalation at all, and the owner/general group
never saw it, exactly matching the live evidence.

**Fix (Task 1)**: `needsOwnerEscalation` now returns true for
`feedback_type === 'safety_issue'` OR `severity === 'urgent'` -- a safety
report escalates to `unique([domainTeam, owner_general])` regardless of
severity, matching the task's own explicit routing rule. New
`notifyFeedbackEventTargets` (replacing the old single-status
`notifyFeedbackEvent` internals) sends to every route target, deduping
by the PHYSICAL LINE group (`target_id_hash`, not the channel row id --
two different team codes could in principle be bound to the same real
group) so the same message is never pushed twice. `dispatchEntityNotification`
keeps its existing single-status contract for its other callers
(`ops-notify.ts`) by reflecting the primary/domain team's own outcome.

**Per-target status representation (Task 1)**: `notification_status`'s
real CHECK constraint (`supabase/migrations/..._ops_feedback_events_v1.sql`)
only allows one scalar value -- adding a "partial" state would need a
schema migration. Instead, the full per-target breakdown
(`Array<{team, status}>`) is written non-destructively into
`internal_notes`, an existing jsonb column no other code was using. Logs
added: `SAFETY_ESCALATION_TARGETS`, `FEEDBACK_NOTIFY_TARGET_ATTEMPT`,
`FEEDBACK_NOTIFY_TARGET_RESULT`, `FEEDBACK_NOTIFY_PARTIAL_FAILURE`.

**Customer reply matches notification result (Task 4)**: `_service-mind-
feedback-response.ts`'s `composeSafetyIssueResponse` now takes the real
per-target result and picks precise wording -- both sent ("ส่งให้ทีม...
และเจ้าของตรวจสอบแล้วครับ"), domain sent/owner failed ("...ส่วนแจ้งเจ้าของ
ยังไม่สำเร็จ ทีมจะตรวจสอบต่อครับ"), owner sent/domain not bound, neither
sent ("ตอนนี้ระบบแจ้งเตือนทีมไม่สำเร็จ...บันทึกเรื่องไว้แล้ว"), and storage
itself failing (never claims stored or sent at all). Distinguishes
`not_bound` (no channel exists) from a genuine `failed` push (channel
bound, the LINE API call itself threw) -- both degrade honestly, neither
is ever reported as success.

**LINE response style (Task 2)**: three small, reusable helpers added to
`_chat-copy-style.ts` -- `limitAdvisoryList` (caps a recommendation list,
default 3), `trimLongRecommendationForLine` (word-boundary-safe
truncation for a per-item reason line), `composeLineShortReply` (joins
non-empty parts, dropping any skipped optional line). Applied at the two
responders the round's own evidence named as too dense (restaurant
advisor, safety feedback reply) rather than a blanket rewrite of every
reply in the codebase -- a global automatic "ครับ"-repetition stripper
was considered and rejected as too high-regression-risk against ~950
existing wording assertions; the two evidenced flows were fixed directly
instead.

**Restaurant host-style (Task 3)**: `formatAdvisorMessage`'s recommend/
pairing branch (`thongthai-chat.ts`) now leads with the allergy/
constraint caution (never a menu list first), caps items at 3 by default
via `limitAdvisoryList`, drops the per-item sales-pitch reason line
unless the customer explicitly asked for the full catalog
(`wantsFullRestaurantList` -- "ขอเมนูทั้งหมด", "เอามาหมด", "ส่งเมนูละเอียด",
etc.), and asks exactly one next question (group size, or a "more detail
available" nudge once it's already known). A real precedence gap was
also found and fixed along the way: `_local-concierge-intent.ts`'s
`FOOD_VISITOR_MARKER` ("กินอะไรได้") matched "แพ้กุ้ง กินอะไรได้บ้าง" and
answered with a generic, allergy-blind Isan-cuisine description BEFORE
the restaurant advisor (which does real per-item ingredient filtering)
ever got a turn -- `deterministicLocalConciergeResponse` now defers when
the message names a specific allergy, the same "defer to the more
specific, safety-aware handler" precedent used throughout this
engagement.

**Tests added**: `tests/post-pr67-polish.test.ts`, 20 tests -- Section A
(5 tests, Task 1's exact routing/storage combinations: both bound, owner-
only, domain-only, neither, and the same-physical-group dedup case),
Task 4 (4 tests, using a new harness capability `programLinePushFailure`
to simulate a genuine LINE API failure distinct from `not_bound`),
Section B (4 tests, Task 3's exact restaurant scenarios), Section C (7
tests, Task 5's regression list through the full signed LINE webhook).
`tests/owner-general-line-binding.test.ts`'s tests 6-7 were updated (not
just left broken) to assert the new, more precise per-target wording
instead of the old, less accurate collapsed-boolean wording they
previously encoded -- their own original intent (never fake an unbound
escalation as sent) is unchanged.

**Load-bearing verification**: reintroduced the exact routing bug
(`needsOwnerEscalation` reverted to `severity === 'urgent'` only) and
confirmed exactly the 8 tests tied to it (Section A's 5 + Task 4's
first 3) failed, while the unrelated 12 tests (Task 4d, Section B,
Section C) stayed green -- proving the new tests actually catch this
class of regression, not just pass by coincidence. Restored the fix;
all 20 pass again.

**Full suite**: 964/964 passing (944 prior + 20 new), zero regressions.

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Owner retest script**:
1. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> check the activity LINE group AND
   the owner/general LINE group both receive the alert (bind both first
   via "ผูกทีม activity" / "ผูกทีม เจ้าของ" if not already bound); check
   backoffice "เสียงลูกค้า" shows the event.
2. "ร้านอาหารมีอะไรแนะนำ แม่กินเผ็ดไม่ได้ แพ้กุ้ง" -> short, host-style
   reply: allergy caution first, at most 3 items, asks group size.
3. "สติ" -> clarification question, never the generic slow-fallback
   apology.
4. "อยากขับ ATV ไม่เคยขับ กลัวเร็ว" -> slow-start/team-briefing care
   reply, never the legacy duration-first prompt.

**Confirmations**: no booking/order/payment created; no schema migration
(internal_notes is an existing, previously-unused column); no fake
notification-success claim anywhere; no unrelated production data
mutated; restaurant menu data and prices remain sourced from the real,
verified `restaurant_menu_live` view, never invented.

## PR #68 Partial-Failure Incident -- owner_general dedup false-positive -- 2026-09-23

Live production retest of PR #68 showed the activity group got the
safety alert but the owner/general group did NOT, while Thongthai's
customer-facing reply still claimed both were notified
("ทองไทยส่งให้ทีมกิจกรรมและเจ้าของตรวจสอบแล้วครับ") -- a false success claim,
not just a missing notification.

**Diagnosis (direct production query, not assumption)**: queried the real
`ops_feedback_events`/`ops_notification_deliveries`/`ops_notification_channels`
tables in project `upaokrprawzhgzeqsdke` for the exact incident
(customer_message "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว", created_at 2026-09-23
13:35:02 UTC -- matches the owner's reported 20:35 Bangkok time exactly).
Found:
- `internal_notes.notification_targets` = `[{team:"activity",status:
  "sent"},{team:"owner_general",status:"duplicate"}]`.
- `ops_notification_deliveries` has exactly ONE row for this event's
  entity_id -- the activity send. No delivery row exists for
  owner_general at all, proving its "duplicate" status was never backed
  by a real send attempt of any kind.
- `ops_notification_channels` confirms activity and owner_general are
  bound to two COMPLETELY DIFFERENT `target_id_hash` values (different
  physical LINE groups) -- so the dedup-by-shared-group logic had no
  legitimate reason to fire.

**Root cause**: `channelForTeam`'s query (`_ops-notifications.ts`)
selected `id,team_code,target_type,target_id_enc,display_name,enabled`
-- it never selected `target_id_hash`, even though PR #68's own
same-physical-group dedup logic (`notifyFeedbackEventTargets`) reads
`channel.target_id_hash`. Real PostgREST only returns columns actually
listed in `select=`, so `channel.target_id_hash` was `undefined` for
EVERY channel in production. The dedup check
(`usedTargetHashes.has(channel.target_id_hash)`) compared
`undefined === undefined`, which is always true -- so the SECOND route
target in ANY escalation (owner_general, always processed after the
domain team) was unconditionally marked `'duplicate'` regardless of
which real group it was bound to, and `composeSafetyIssueResponse`
(correctly, given a genuine dedup) treats `'duplicate'` as a real send.
This is why 964 passing tests never caught it: the test harness's mock
for `ops_notification_channels`'s GET handler returned every stored
field on the channel object regardless of what `select=` asked for --
real PostgREST's column projection was never actually simulated.

**Fix (two independent layers, so a future regression in either one
alone still fails safe)**:
1. `channelForTeam`'s (and every other `NotificationChannel`-returning
   query's) select list now includes `target_id_hash`; the
   `NotificationChannel` type declares it as a required field with a
   doc comment explaining exactly this incident, so omitting it from a
   future query select list is now a TypeScript error, not a silent
   `undefined`.
2. Defensive: the dedup comparison now requires `channel?.target_id_hash`
   to be truthy before ever consulting the used-hashes set -- two falsy
   hashes are never treated as "the same group" again. Verified this
   layer alone (with the select-list bug deliberately reintroduced)
   already prevents the incident -- worst case on a future select-list
   mistake is now a harmless duplicate send, never a silently dropped
   escalation reported as successful.
3. `tests/helpers/canonical-core-harness.ts`'s `ops_notification_channels`
   GET mock now enforces real PostgREST `select=` column projection
   (new `projectSelect` helper) -- this is what actually would have
   caught this bug before it ever reached production, and now protects
   the same class of mistake for any future field this codebase adds to
   that type.

**Tests added**: `tests/safety-escalation-target-hash-incident.test.ts`,
6 tests through the full signed LINE webhook with realistic bound
groups -- asserts the EXACT physical LINE push call count per target
(`postsTo('line_push')`, new harness tracking), that a real delivery row
exists for BOTH targets (`postsTo('ops_notification_deliveries')`, also
newly tracked), and that the reply's wording only ever claims a target
was notified when it genuinely was.

**Load-bearing verification**: reproduced the exact original bug
(reverted `channelForTeam`'s select list to omit `target_id_hash`,
*before* adding the defensive hash-presence guard) against the new test
file -- 2 of 6 tests failed exactly as production did. Then verified the
defensive guard alone (select list still broken) is now sufficient by
itself to keep all 6 passing -- confirming the fix is genuinely two
independent, mutually-reinforcing layers, not one fix wearing two hats.
Restored the corrected select list; all 6 pass with both layers
correct.

**Full suite**: 970/970 passing (964 prior + 6 new), zero regressions.

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Owner retest**: send "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" in Private OA ->
check the Private OA reply, check the activity LINE group receives the
alert, check the owner/general LINE group ALSO receives a NEW alert
(not just the old 16:35 one), check backoffice "เสียงลูกค้า" shows the
event with both targets recorded.

**Confirmations**: no schema migration; no fake notification-success
claim anywhere; verified directly against real production data (not
assumed) both before and as part of confirming the fix's mechanism; no
unrelated production data mutated (read-only queries only against
`upaokrprawzhgzeqsdke`).

## Master Roadmap Phase 0 -- Baseline Audit / Checkpoint -- 2026-09-23

Owner asked to stop doing one-off patch rounds and start a structured,
phased rebuild (Phase 0 through Phase 8, see the roadmap message itself
for full phase scope). This entry is Phase 0 ONLY -- audit and
checkpoint, no feature changes, no code touched.

### Checkpoint

- **Latest merged PR**: #69 ("Fix false owner_general escalation
  success: channelForTeam never selected target_id_hash"), merge commit
  `7994f92`.
- **Current `main` head**: `7994f92` (verified via `git fetch origin
  main` + `git log`), local `main` fast-forwarded to match.
- **Full test suite**: `npm test` -> **970/970 passing, 0 failed**, run
  directly on `main` at this commit (not a feature branch).
- No production DB mutation this phase; the only production access was
  a read-only Supabase query already reported in the PR #69 entry above.

### Architecture map

**Request entry points** (`netlify/functions/*.ts`, Netlify Functions,
one file = one HTTP endpoint):
- `line-webhook.ts` -> thin signature-verification wrapper around
  `_line-webhook-core.ts`'s real `handleEvent`.
- `thongthai-chat.ts` -- also the entry point for the **web** channel
  AND the shared core (`processThongthaiChatCore`) every channel funnels
  through. 3,450 lines -- by far the largest file in the codebase; holds
  the full deterministic responder cascade (order matters -- see its own
  inline precedence comments) plus the One-Mind LLM fallback.
- `customer-memory.ts`, `customer-account.ts`, `line-link.ts`,
  `restaurant-menu.ts`, `ops-*.ts` (daily-schedule/health/notify/
  payment-notify/settlement-notify), `staff-line-contact.ts`,
  `thongthai-brain-status.ts`, `chess-*.ts` (an unrelated side feature)
  -- narrower single-purpose endpoints.

**Core conversation pipeline** (`thongthai-chat.ts`'s
`processThongthaiChatCore`, in the ACTUAL checked order -- this order
IS the precedence policy, and has been the direct cause of several real
production incidents this engagement fixed when a narrower responder
was checked too late):
1. `deterministicGreetingResponse` / `deterministicCasualChatResponse` /
   `deterministicShortUnclearTextResponse` -- zero-LLM, pre-authority
   replies for bare greetings/interjections/ambiguous fragments.
2. `deterministicServiceFeedbackResponse` (`_service-mind-feedback-*.ts`)
   -- compliment/complaint/suggestion/safety_issue/system_feedback,
   checked before ANY active-task continuation so a complaint mid-
   booking is never swallowed.
3. Horse/ATV/archery care & scenario responders (`horseCareFearResponse`,
   `horseSafetyQuestionResponse`, `horseCompoundCareIntentResponse`,
   `horseScenarioSignalResponse`, `atvCareIntentResponse`,
   `archeryCareIntentResponse`) -- semantic care/risk signals, powered by
   `_semantic-hospitality-interpreter.ts`.
4. `homestayFactsResponse`, `ecosystemFirstVisitResponse` -- owner-
   supplied static facts (`_tamma-domain-knowledge.ts`).
5. `activityBookingFallbackResponse`, bare-horse-selection responders.
6. `deterministicLocalConciergeResponse` (`_local-concierge-intent.ts` +
   `_local-concierge-knowledge.ts` + `_local-concierge-response.ts`) --
   broad local-area/weather/food-culture/visitor-journey/activity-
   suitability questions. Now (as of the "Post-PR67 Polish" round)
   yields to the restaurant advisor when a specific allergy is named.
7. `deterministicRestaurantResponse` (`_restaurant-intelligence.ts`
   scoring/filtering + `_restaurant-sot.ts` real Supabase menu source +
   `formatAdvisorMessage` in `thongthai-chat.ts` for host-style
   presentation).
8. Promotion continuation/discovery, experience discovery, deterministic
   activity response.
9. One-Mind LLM orchestration (`_thongthai-one-mind-orchestrator.ts`,
   `_thongthai-model-provider.ts`, `_dialog-manager.ts`) as the final
   fallback when nothing deterministic matched -- Gemini primary, OpenAI
   optional paid fallback, deterministic zero-cost degradation
   (`_deterministic-semantic-turn.ts`, `_graceful-degradation.ts`) when
   the provider is down.

Every branch funnels through `polishedResponse` ->
`_chat-copy-style.ts`'s `polishCustomerMessage` (channel-aware plain-
text/spacing cleanup) before reaching the customer -- the one true
single choke point every reply passes through, and where the LINE-
brevity helpers (`limitAdvisoryList`, `trimLongRecommendationForLine`,
`composeLineShortReply`) added in the "Post-PR67 Polish" round live.

**State**: two SEPARATE systems, a known architectural seam (already the
root cause of two real production incidents this engagement fixed --
see the "PR #66 Production Precedence" and its own predecessor "Horse
UX Production Gap" entries above):
- `guest_agent_state` (JSONB blob, `_guest-agent-state-store.ts`) --
  the REAL, current-generation state: `taskState` (`_task-state.ts`,
  domain-generic `ActiveTask` container), `conversationContext`,
  `restaurantAdvisorContext`, `restaurantProposedSet`,
  `pendingPromotionRedemption`.
- `booking_sessions` (its own Postgres table, `_operations-db.ts`'s
  `loadLineBookingSession`/`saveLineBookingSession`) -- the LEGACY,
  LINE-only transactional booking flow
  (`handleLineBookingMessage`), checked BEFORE `askThongthaiReliably`
  in `_line-webhook-core.ts`, entirely bypassing the One-Mind pipeline.
  `shouldConsumeLegacyLineBookingTurn` is the guard that decides whether
  a turn belongs to this legacy flow or should defer to the pipeline
  above -- this guard has needed the SAME class of fix (an unconditional
  check scoped too narrowly to `!session`) twice already.

**Notifications / ops** (`_ops-notifications.ts`, 968 lines):
`ops_notification_channels` (team_code -> LINE group binding, via
"ผูกทีม ..."), `ops_notification_deliveries` (idempotency-keyed delivery
ledger), `dispatchEntityNotification` (booking/cafe_inquiry/otop_order/
feedback_event). `notifyFeedbackEventTargets` (added in "Post-PR67
Polish", fixed in the "PR #68 Partial-Failure Incident" entry) is the
current multi-target safety-escalation mechanism -- routes a
`safety_issue` (or any `urgent` severity) to `unique([domainTeam,
owner_general])`, storing the per-target result in
`ops_feedback_events.internal_notes` (a real, applied migration; see
`supabase/migrations/20260922210000_ops_feedback_events_v1.sql` and its
two follow-up migrations -- despite that first file's own header saying
"NOT APPLIED", it and its two follow-ups ARE live in production,
confirmed directly via Supabase query this round and the prior one).

**Feedback classification** (`_service-mind-feedback-intent.ts`, 315
lines): `classifyServiceFeedback` -- a closed set of structural/
vocabulary markers (never a growing phrase table) producing
`{feedbackType, businessUnit, severity, staffName, personMentions,
businessUnitMentions, sentimentKeywords, issueKeywords, namedAssets,
keywordSummary}`. This is the closest existing thing to Phase 1's
"boundary classifier" -- it already knows safety_issue/complaint/
suggestion/compliment/system_feedback and severity low/normal/high/
urgent, but has NO concept yet of CAN_ANSWER/NEEDS_CONTEXT/ESCALATE/
ANSWER_AND_ESCALATE as the roadmap's Phase 1 asks for, and does not run
on EVERY message (only ones that already look like feedback) -- a plain
factual question or a vague "อยากพัก" never reaches it today.

**Customer memory (already exists, narrower than Phase 2's ask)**:
`_customer-db.ts` + `customer-memory.ts` endpoint -- `customer_accounts`-
keyed `GuestContext` (tripDuration, travelerType, group composition,
interests, pace, budget, constraints) with explicit actions (profile/
favorite/visited/save_journey). Already enforces a real privacy
guardrail: `FORBIDDEN_RAW_CHAT_KEYS` rejects storing raw chat
text/transcript/prompt content, mirroring `guest_events`'s own
`guest_events_no_chat_text` constraint. This is real, working
infrastructure Phase 2 should EXTEND (phrase memory, per-customer
preference confidence, demand aggregation), not duplicate.

**Domain knowledge** (`_tamma-domain-knowledge.ts`, only 63 lines --
intentionally small): `ECOSYSTEM_PATHS` (owner's 3-path framing) and
`HOMESTAY_FACTS` (owner-supplied static facts only, no invented
availability). `_local-concierge-knowledge.ts` (110 lines) holds
`HORSE_FACTS` and `INDOOR_FRIENDLY_BUSINESS_UNITS` similarly. Both
modules follow the same discipline: owner-provided, owner-verified,
nothing beyond it, and an honest "team confirms" answer wherever real
data has no source (e.g. night-by-night room availability).

**Backoffice / customer-voice dashboard**: referenced only by URL
(`BACKOFFICE_URL = 'https://tamma-backoffice.netlify.app/'` in
`_ops-notifications.ts`, and `customer-voice.html?event=<id>` deep
links in the feedback notification body) -- **no backoffice code exists
in this repository**. This session's GitHub access is scoped to
`snkpcn/tamma-chat` only; a `tamma-backoffice` repo (or wherever that
Netlify site's source actually lives) is NOT currently accessible from
this session. **This is a hard blocker for Phase 3** (Owner Dashboard)
as written -- it cannot be scoped or implemented from inside this repo
alone. Needs owner confirmation of where that codebase lives and this
session's access extended to it (`add_repo`) before Phase 3 can start.

**Test infrastructure**: 109 test files, 970 tests, `node --test` +
`tsx`, no separate typecheck step configured (no root `tsconfig.json`;
type errors surface only if `tsx` itself trips on them, not via a
dedicated `tsc --noEmit` gate). `tests/helpers/canonical-core-harness.ts`
is the shared, actively-maintained mock -- drives the REAL
`processThongthaiChatCore` and the REAL full signed LINE webhook end to
end, mocking only Supabase REST and the LLM provider's raw HTTP
endpoint. As of the "PR #68 Partial-Failure Incident" entry, this mock
now enforces real PostgREST `select=` column projection on
`ops_notification_channels`'s GET handler specifically -- NOT yet swept
across every other mocked table, which is a real, known residual gap
(see "Known gaps" below).

### Known gaps (honest inventory, not yet fixed this phase)

1. **No CAN_ANSWER/NEEDS_CONTEXT/ESCALATE/ANSWER_AND_ESCALATE
   classifier exists anywhere.** This is exactly Phase 1's job, from
   scratch -- `classifyServiceFeedback` is adjacent but answers a
   different question (what KIND of feedback is this) and only fires on
   messages that already look like feedback.
2. **No refund/discount/compensation escalation path exists at all.**
   "ขอคืนเงินได้ไหม"/"ขอส่วนลดพิเศษ" today would most likely reach the
   One-Mind LLM fallback with no deterministic guardrail against it
   inventing a policy answer -- a real gap Phase 1's ESCALATE class is
   meant to close.
3. **No phrase-memory or demand-aggregation tables exist.** Phase 2
   needs new schema (`guest_phrase_memory`/`guest_preference_memory`/
   `demand_insights_daily`/`bot_lessons` or equivalent) -- all additive,
   none of it exists today beyond the narrower `customer_accounts`
   `GuestContext` described above.
4. **Backoffice/dashboard code is inaccessible from this session** (see
   above) -- blocks Phase 3 outright until resolved.
5. **The mock harness's real-`select=`-projection enforcement covers
   only ONE table** (`ops_notification_channels`'s GET handler) --
   every other mocked GET handler in `canonical-core-harness.ts` still
   returns every stored field regardless of the real query's `select=`
   list, which is the EXACT class of bug the PR #68 incident was. A
   future field-selection mistake anywhere else in the codebase would
   currently go uncaught the same way, until each handler gets the same
   `projectSelect` treatment.
6. **No `bot_lessons`/learning-loop mechanism exists** (Phase 5)
   -- corrections today are pure code changes by this engagement, not a
   data-driven, owner-approvable lesson store.
7. **`THONGTHAI_HANDOFF.md` itself is now 4,579 lines** -- still fully
   readable and append-only by design, but worth the owner knowing this
   is getting large; no action taken this phase (out of Phase 0's own
   "no feature changes" scope, and restructuring a living handoff
   document mid-roadmap has its own risk).
8. **No root `tsconfig.json`/typecheck gate** -- `npm test` runs via
   `tsx` directly; a type error that `tsx` doesn't trip on at runtime
   could currently slip through CI undetected. Not new this phase, but
   relevant to Phase 1+'s "small atomic changes, tests, load-bearing
   proof" discipline -- tests are the only correctness gate that exists.

### Exact Phase 1 scope (proposed, pending owner review)

Per the roadmap's own explicit instruction ("Do not start Phase 2 until
owner reviews" -- applies equally to starting Phase 1 after this Phase 0
report), this section is a PROPOSAL, not started work:

- New module `_boundary-classifier.ts` (or extend
  `_service-mind-feedback-intent.ts` if a single owner review prefers
  one classifier module over two adjacent ones -- open question for the
  owner) implementing the 4-class policy (CAN_ANSWER/NEEDS_CONTEXT/
  ESCALATE/ANSWER_AND_ESCALATE) with the routing table from the
  roadmap's own examples.
- New responder in `thongthai-chat.ts`'s precedence cascade, positioned
  carefully relative to the EXISTING `deterministicServiceFeedbackResponse`
  (safety_issue/complaint already handled there) to avoid a duplicate/
  conflicting classification of the same message by two different
  classifiers -- likely: this NEW classifier only fires for the classes
  `classifyServiceFeedback` does NOT already cover (refund/discount/
  compensation-specific ESCALATE cases, safety-guarantee-question
  ESCALATE cases like "ปลอดภัย 100% ไหม", and the CAN_ANSWER/
  NEEDS_CONTEXT distinction for plain factual vs. vague-intent
  messages), reusing `classifyServiceFeedback`'s own output where a
  message already IS feedback rather than re-classifying it.
- Reuses the EXISTING `notifyFeedbackEventTargets` routing/delivery
  machinery for ESCALATE/ANSWER_AND_ESCALATE cases -- no new
  notification infrastructure needed, per the roadmap's own routing
  table (refund/compensation -> owner_general; severe allergy ->
  restaurant + owner_general; etc. all map onto the EXISTING
  `FEEDBACK_BUSINESS_UNIT_TEAM`/`needsOwnerEscalation` mechanism with,
  at most, new feedback_type/severity values if the CHECK constraints
  need widening -- additive migration, owner-approved, per the
  roadmap's own DB rules).
- 10 tests from the roadmap's own Phase 1 list, via the full signed
  LINE webhook, plus load-bearing verification.
- Handoff update + checkpoint commit + PR, stop for owner review before
  Phase 2.

No code changes are included in this Phase 0 report -- this section is
the plan for Phase 1, to be executed only once the owner confirms scope
(in particular: confirm whether ESCALATE-class messages like "ขอคืนเงิน
ได้ไหม" should get a deterministic guardrail reply immediately, or
whether some of them should still reach the LLM for a nuanced first
draft before routing to the owner -- the roadmap's own examples imply
the former, but this is worth an explicit owner confirmation before
building it, since it changes user-facing behavior for messages that
currently reach the LLM today).

## Master Roadmap Phase 1 -- Escalation Boundary Policy -- 2026-09-23

Owner answered Phase 0's open question: for ESCALATE-class messages
(refund, special discount, claim, accident liability, a safety-
guarantee question, a bad-review threat, severe allergy/medical risk,
unverified real-time availability), Thongthai must reply with an
**immediate deterministic guardrail response**, never an LLM-drafted
one -- "These are outside Thongthai's authority/control and can create
legal, financial, safety, or brand risk if the model improvises."

**What was built** (new module `_boundary-classifier.ts`,
`classifyEscalationBoundary`): a closed, narrow-vocabulary classifier
for exactly 8 categories -- `refund_request`, `special_discount`,
`claim_request`, `accident_liability`, `safety_guarantee`,
`bad_review_threat`, `severe_allergy_medical`, `unverified_availability`.
Each match carries an optional `domainUnit` (detected via a small,
closed domain-name hint list -- ม้า/ATV/ยิงธนู->activity, อาหาร/กิน/เมนู->
restaurant, ที่พัก/เฮือน->stay, คาเฟ่/กาแฟ->cafe) and an `escalates` flag.
Only ONE category instance does not escalate at all: a bare, generic
"ปลอดภัย 100% ไหม" with no named activity -- per the owner's own explicit
instruction ("If generic: answer with no guarantee, ask context"), this
gets an honest answer with zero feedback event and zero notification.

**A real, confirmed pre-existing bug this closes**:
`_service-mind-feedback-intent.ts`'s own `URGENT_SAFETY_MARKER` already
contains the literal substrings "อุบัติเหตุ" and "แพ้อาหารรุนแรง" (there
for genuine in-progress-injury/emergency detection). Verified directly
before building anything: "ถ้าเกิดอุบัติเหตุรับผิดชอบไหม" (a LIABILITY
QUESTION -- nobody is actually hurt) and "แพ้อาหารรุนแรง" (said bare, no
food/restaurant context) were BOTH misclassified as an urgent
`safety_issue` REPORT by the existing classifier, producing the wrong
reply (a ground-condition-check acknowledgment for a liability policy
question). `deterministicEscalationResponse` is checked in
`thongthai-chat.ts`'s precedence cascade BEFORE
`deterministicServiceFeedbackResponse` specifically to intercept these
two narrow cases first; every genuinely safety_issue/complaint/
compliment/suggestion/system_feedback-shaped message (confirmed via
direct classifier scratch-testing, including "เจิดพูดไม่ดี" and "พื้นลื่น
มาก ตอนเล่น ATV น่ากลัว") keeps flowing through the EXISTING,
already-correct `classifyServiceFeedback` path completely unaffected.

**No schema migration.** Every escalation category reuses the EXISTING
`ops_feedback_events`/`ops_notification_channels`/
`ops_notification_deliveries` infrastructure (`createFeedbackEvent`,
`notifyFeedbackEventTargets`) as-is -- `feedback_type` maps to
`'safety_issue'` for the genuinely safety/liability/medical-risk
categories (accident_liability, safety_guarantee-with-domain,
severe_allergy_medical -- these get the existing automatic domain +
owner_general escalation via `needsOwnerEscalation`'s
`feedback_type === 'safety_issue'` rule for free) and `'complaint'` for
the rest (refund/discount/claim/bad-review/unverified-availability --
these route via `business_unit` alone, mostly `'general'` -> owner_general
only). `severity` is set per-category (`'urgent'` for the safety-
adjacent ones, `'high'`/`'normal'` for the rest) purely for the owner-
facing label; it does not change routing beyond what `feedback_type`/
`business_unit` already decide.

**Deterministic guardrail wording** (new `composeEscalationResponse` in
`_service-mind-feedback-response.ts`, alongside a new shared
`composeNotificationStatusLine` helper factored OUT of the existing
`composeSafetyIssueResponse` so both composers say precisely which
target(s) actually sent, never a blanket claim -- `composeSafetyIssueResponse`
itself now calls this shared helper too, a pure refactor with zero
behavior change, confirmed by the full suite staying green). Wording
for refund_request, special_discount, accident_liability, and both
safety_guarantee branches is the owner's own verbatim text from their
Phase 1 decision message; claim_request, bad_review_threat,
severe_allergy_medical, and unverified_availability were not given
verbatim text and were written to match the same tone/structure.

**Tests added**: `tests/master-roadmap-phase1-escalation-boundary.test.ts`,
15 tests through the full signed LINE webhook with realistic bound
groups -- the roadmap's own 10-item list in full (tests 1-10, in order),
plus 5 extra (domain-tied vs. domain-generic liability routing,
not-bound honesty, bad-review routing, unverified-availability
honesty). Test 4 ("มีอะไรแนะนำ" -> NEEDS_CONTEXT) surfaced a genuine,
pre-existing gap while writing it: a truly BARE "มีอะไรแนะนำ" (no
"ครั้งแรก"/"ร้านอาหาร"/other domain anchor) has no deterministic
NEEDS_CONTEXT responder at all yet and falls through to the LLM --
`ecosystemFirstVisitResponse`'s own `FIRST_VISIT_RECOMMEND_MARKER`
requires "ครั้งแรก" alongside it. This belongs to the roadmap's own
Phase 4 ("ecosystem/first-time visitor" domain playbook), not this
phase's scope -- the test was written to assert only what Phase 1
actually guarantees (the new classifier does not misfire on it, no
spurious feedback event), and this gap is carried forward as a known
item for Phase 4.

**Load-bearing verification**: neutered `classifyEscalationBoundary` to
always return `null` (simulating "Phase 1 was never built") and
confirmed exactly the 9 escalation-dependent tests failed while the 6
unrelated tests (CAN_ANSWER/NEEDS_CONTEXT/staff-complaint/existing-
safety-issue) stayed green -- proving these tests actually catch a
regression in the new classifier specifically, not passing by
coincidence. Restored the real classifier; all 15 pass again.

**Full suite**: 985/985 passing (970 prior + 15 new), zero regressions.

**Deploy status**: cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**Owner retest script**:
1. "ขอคืนเงินได้ไหม" -> deterministic guardrail reply, never an LLM-
   drafted refund answer; check owner/general LINE group receives it.
2. "ขอส่วนลดพิเศษ กลุ่ม 20 คน" -> guardrail reply + asks group
   size/date/service; owner/general group notified.
3. "ปลอดภัย 100% ไหม" (bare, no activity named) -> honest no-guarantee
   answer, NO owner/general notification, no backoffice event.
4. "ถ้าเกิดอุบัติเหตุระหว่างขี่ม้า รับผิดชอบไหม" -> guardrail reply; check
   BOTH the activity LINE group and owner/general group receive it.
5. "แม่แพ้กุ้งรุนแรง กินอะไรได้บ้าง" -> guardrail-style acknowledgment;
   check BOTH the restaurant LINE group and owner/general group receive
   it.
6. "เจิดพูดไม่ดี" -> unaffected regression, still a staff complaint to
   owner/general (confirms the new classifier didn't break the existing
   path).
7. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> unaffected regression, still
   activity + owner/general, never the duration-first prompt.

**Confirmations**: no schema migration (every category reuses existing
feedback_type/business_unit/severity values, no CHECK constraint
touched); no fake notification-success claim anywhere (every escalation
composer uses the same real per-target `composeNotificationStatusLine`
as the existing safety-issue path); no unrelated production data
mutated; no LLM call for any ESCALATE-class message, confirmed by the
classifier being checked and returning before the One-Mind orchestrator
is ever reached.

**Per the roadmap's own workflow rule** ("Stop and wait for owner
before next phase"): this phase stops here. Proposed next phase
(pending owner review, not started): Phase 2 (Customer Intelligence
Memory), extending the EXISTING `_customer-db.ts`/`customer-memory.ts`
`GuestContext` system (confirmed real and working in the Phase 0 audit)
rather than building a parallel one -- or, if the owner prefers,
resolving Phase 3's blocker first (confirming where the backoffice
dashboard codebase lives and granting this session access to it) so
that phase can be scoped accurately once reached.

## Master Roadmap Phase 2 -- Customer Intelligence Memory -- 2026-09-23

Owner's instruction this round: "Thongthai should remember valuable
customer-provided information and repeated customer language in a
privacy-safe, service-useful way... This is not creepy tracking. This
is service intelligence." Explicit architectural constraint: extend the
EXISTING `_customer-db.ts`/GuestContext/`guest_memory` system -- no
`guest_memory_v2`, no parallel memory system, no new split-brain (the
owner's own reason: "We already suffered from split-brain state between
guest_agent_state and legacy booking_sessions").

**1. Existing memory system audited.** Read `_customer-db.ts` in full.
Confirmed the owner's own claim: a real, already-working memory
foundation exists -- `GuestContext` (`tripDuration`, `travelerType`,
`group`, `interests`, `pace`, `budget`, `constraints`), backed by the
`guest_memory` table (`guest_id`, `memory_key`, `memory_value`, upserted
on `guest_id,memory_key`), with an allowed-value-set discipline already
enforced per field (`CONSTRAINTS`/`PACES`/`TRAVELER_TYPES` Sets +
`dedupeAllowed`) -- i.e. a real privacy guardrail already existed (only
whitelisted normalized keys can ever be written, never arbitrary text).
`loadCustomerMemory` re-hydrates `GuestContext` from `guest_memory` on
every turn; `persistCustomerResult` writes it back. Critical gap found:
`persistCustomerResult` is only ever called from the One-Mind/LLM
fallback path in `thongthai-chat.ts` -- never from any of the ~30
deterministic responder branches that answer the vast majority of real
production turns. This is *why* memory personalization wasn't already
happening for most conversations: not a missing schema, a missing
capture call.

**2. Exact extension chosen.** Two additive pieces, both reusing the
existing foundation:
- A new capture function, `capturePreferenceSignals` (new export in
  `_customer-db.ts`), called ONCE per turn from a single insertion
  point in `thongthai-chat.ts`'s `processThongthaiChatCore` -- right
  after `registerGuestIdentity`, before the entire deterministic
  responder cascade (including Phase 1's own escalation check). This
  guarantees every turn's message is scanned for service-useful signal
  regardless of which responder eventually answers, and structurally
  cannot affect response routing: it is a pure async side effect on
  `request.message`, never touches which responder fires, never calls
  the LLM.
- A new pure classifier module, `_customer-phrase-intelligence.ts`
  (`extractPreferenceSignal` for durable per-guest constraints/pace/
  traveler-type; `extractIntelligenceSignals` for one-off aggregate
  phrase/demand/risk signals), plus a new append-only aggregate event
  writer, `_customer-intelligence-events.ts` -- see item 8 below for
  why aggregate counting needs its own table.

**3. Schema migration needed?** Yes, but narrowly: ONE new additive
table, `customer_intelligence_events`
(`supabase/migrations/20260923142552_customer_intelligence_events_v1.sql`,
**NOT APPLIED -- prepared for owner review only**, same discipline as
`ops_feedback_events`'s own migration before it was approved). No
existing table, column, trigger, or constraint is touched.
`guest_memory` itself needed NO migration -- its existing `CONSTRAINTS`
Set was simply extended with 6 new allowed values (below), the same
mechanism every prior constraint already used.

**4. Why existing structure is insufficient for the aggregate piece.**
`guest_memory` is guest_id-scoped: one row per `(guest_id, memory_key)`,
upserted -- correct for "what does THIS guest prefer," but it cannot
represent "how many DIFFERENT guests said this phrase this month"
without attaching a shared counter to every guest's own row, which
would conflate per-guest state with cross-guest business intelligence
and risk write races. `customer_intelligence_events` is a plain
append-only log instead -- same design philosophy as the existing
`guest_events` table (event log, not a maintained counter; counting
happens at query time, by a future dashboard). Until the migration is
applied, every write attempt fails gracefully (caught, logged, never
thrown) -- nothing customer-facing depends on this table; the actual
shipped personalization (item 7 below) reads only `guest_memory`.

**5. Memory keys/categories added.** `guest_memory`'s `CONSTRAINTS` Set
gained 6 new normalized keys, added the same way every existing one
was: `low_intensity`, `fear_of_falling`, `fear_of_speed`, `food_allergy`,
`prefers_short_replies`, `prior_safety_concern`. Existing keys already
covered several of the owner's own examples with no change needed
(`limited_walking`, `shrimp_allergy`, `no_spicy`/mild_spice family,
`elderly_friendly`, `child_friendly`). `customer_intelligence_events`
(once applied) adds `event_type` (`phrase`/`demand`/`risk`), `category`,
`domain`, optional `guest_id`, and a redacted example.

**6. Phrase intelligence supported.** `extractPreferenceSignal` and
`extractIntelligenceSignals` (`_customer-phrase-intelligence.ts`) cover
the owner's own phrase examples with normalized meanings, e.g.
"เอาแบบไม่โหด" -> `low_intensity`, "กลัวตก" -> `fear_of_falling`,
"แม่เดินไม่ไหว"/"เดินไกลไม่ได้" -> `limited_walking`, "กินไม่เผ็ด" ->
`no_spicy`, "แพ้กุ้ง" -> `shrimp_allergy`, "ขอแบบชิล ๆ" -> pace `relaxed`
+ aggregate `chill_pace`, "มีอะไรเด็ด" -> aggregate demand
`signature_recommendation_request`, "พื้นลื่น" -> aggregate risk
`ground_condition_risk`, "ตอบยาวไป" -> `prefers_short_replies`. Only the
normalized meaning is ever stored -- never the raw phrase (see item 9).

**7. Customer preference memory supported.** Durable, per-guest,
correctable. `capturePreferenceSignals` reads the guest's current
`constraints` row, merges in new additions, removes any the current
message corrects away (a dedicated correction pattern -- "จริง ๆ
กินเผ็ดได้..." -- is checked BEFORE the bare "กินเผ็ด" substring match so
a correction always wins), and upserts via the SAME
`on_conflict=guest_id,memory_key` path every other constraint uses --
never a permanent lock on a wrong value. One real, working,
customer-facing personalization ships this round as proof the
architecture actually changes a reply, not just stores data silently:
`ecosystemFirstVisitResponse` (the "ครั้งแรก...มีอะไรแนะนำ" responder)
now checks `guestContext.constraints` for `limited_walking` and, if
present, answers with the owner's own exact wording ("ถ้ามากับคุณแม่
เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อนนะครับ...") instead of the generic
3-path pitch. Separately, the EXISTING restaurant advisor
(`deterministicRestaurantResponse` -> `restaurantMenuAdvice` ->
`_restaurant-intelligence.ts`'s `FOOD_CONSTRAINT_ALIASES`, which already
mapped `shrimp_allergy` to an allergen filter) was already fully wired
end-to-end -- fixing the capture gap alone was sufficient to make
"remembered allergy quietly shapes a later restaurant reply" genuinely
work, with zero changes to the restaurant responder itself. Honest
scope note: `fear_of_falling`/`fear_of_speed` are captured into memory
this round (proven by tests 2 and 12) but no horse/ATV responder yet
reads them back for gentler framing -- that behavioral wiring is not
part of this round's shipped slice.

**8. Demand/risk insight signals supported.** `extractIntelligenceSignals`
classifies a message into `phrase`/`demand`/`risk` + `category` + domain
(`restaurant`/`activity`/`stay`/`cafe`/`system`/`general`), fired in
parallel with the preference-memory write, landing in
`customer_intelligence_events` (once its migration is applied) --
covering the owner's own examples: top-asked/popular/signature requests
(demand), allergy/mobility/ground-condition/bot-quality signals (risk),
repeated low-intensity/chill-pace phrasing (phrase). Query-time
aggregation (counts, top categories) is left to a future owner
dashboard, per the owner's own explicit "do NOT build dashboard UI in
Phase 2" instruction.

**9. Privacy guardrails.** Only normalized keys from the existing
`CONSTRAINTS`/`PACES`/`TRAVELER_TYPES` allowed-value sets are ever
written to `guest_memory` -- the raw message text is never stored
there (proven by test 1 and test 7: `JSON.stringify` of every
`guest_memory` POST body is asserted to never contain the customer's
actual phrase, even for a pregnancy disclosure, which is deliberately
NOT captured as a constraint at all). `customer_intelligence_events`'
own `redactExample` truncates to 80 characters, trimmed and
whitespace-collapsed -- a short snippet, never a chat dump (test 7).
Sensitive medical/pregnancy detail is never normalized into a stored
key unless it maps to an existing safety-relevant category; a bare
pregnancy mention produces no constraint write at all this round.

**10. Non-creepy wording rule.** The one shipped personalization
(`ecosystemFirstVisitResponse`'s mobility branch) uses the owner's own
exact good-example wording verbatim ("ถ้ามากับคุณแม่เหมือนเดิม...") --
test 8 asserts this exact string, and both tests 3 and 8 assert the
reply never matches a timestamped "you told me before" pattern
(`ครั้งก่อนคุณบอก`/`ตอนเวลา`/`เมื่อกี้คุณบอก`), matching the owner's own bad
example to avoid.

**11. Tests added.** `tests/master-roadmap-phase2-customer-intelligence.test.ts`,
16 tests through the full signed LINE webhook against a now-STATEFUL
`guest_memory` mock (`tests/helpers/canonical-core-harness.ts` was
previously write-only for this table -- fixed first, since Phase 2's
whole value proposition is real read-after-write across turns) --
covering the roadmap's own 14-item list in full (test 14 split into
14a/14b/14c for the three named regression phrases), in order.

**12. Full test result.** 1001/1001 passing (985 prior + 16 new), zero
regressions.

**13. Load-bearing proof.** Four separate mutations, each reverted
immediately after confirming the expected failures, with the final
file state diffed byte-for-byte against a pre-mutation backup to
confirm a clean restore:
   - **Memory writes disabled** (capture call replaced with a no-op in
     `thongthai-chat.ts`): 8 of 16 tests failed (1, 2, 4, 5, 6, 9, 11,
     12) -- proving the capture pipeline is load-bearing, not
     decorative. (Test 3 alone survived, via a separate, pre-existing
     LLM-path memory write unrelated to this round's new function.)
   - **Raw-chat privacy guardrail violated** (temporarily appended the
     raw message text into the stored `constraints` row): tests 1, 4,
     and 6 failed -- proving the privacy assertions actually inspect
     stored content, not just presence of a write.
   - **Phase 1 boundary priority bypassed** (`classifyEscalationBoundary`
     temporarily forced to always return `null`, simulating Phase 1
     never having been built): tests 10 and 12 failed -- proving these
     tests catch a real regression if memory-era code ever came before
     or replaced the boundary check, not passing by coincidence.
   - **Repeated-phrase/aggregate counting disabled**
     (`recordIntelligenceEvent` short-circuited to a no-op): tests 5,
     9, 11, and 12 failed -- proving the aggregate event count is
     genuinely produced by the write path under test, not asserted
     against a vacuously-true default.

**14. THONGTHAI_HANDOFF.md update.** This entry.

**15. Deploy status.** Cannot be verified from this session -- egress
to `*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as
in every prior round. Verify via the Netlify dashboard after merge.

**16. Owner retest script** (exact 8 phrases, in order, same LINE
conversation where noted):
1. "เอาแบบไม่โหด" -> reply unaffected; `low_intensity` captured silently.
2. "อยากขี่ม้า แต่กลัวตก" -> still gets the existing horse care-mode
   reply; `fear_of_falling` captured silently (no behavioral change
   yet -- see item 7's honest scope note).
3. "แม่เดินไกลไม่ได้" -> reply unaffected; `limited_walking` captured.
4. "กินไม่เผ็ด แพ้กุ้ง" -> reply unaffected; `no_spicy` +
   `shrimp_allergy` captured.
5. "มีอะไรแนะนำ" (same conversation as #3, after "ครั้งแรก" context) ->
   should now open with "ถ้ามากับคุณแม่เหมือนเดิม ทองไทยแนะนำแบบเดินน้อยก่อน
   นะครับ" -- never a timestamped callback.
6. "ร้านอาหารมีอะไรแนะนำ" (same conversation as #4) -> shrimp dishes must
   not appear in the recommendation, without the message re-stating the
   allergy.
7. "ขอคืนเงินได้ไหม" -> Phase 1's deterministic guardrail reply, exactly
   as before -- confirms memory capture never delays or overrides
   escalation routing.
8. "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว" -> Phase 1/existing safety routing
   unaffected (activity + owner/general notified, no booking-flow
   prompt); `ground_condition_risk` recorded in the aggregate log once
   its migration is applied.

**Confirmations**: no `guest_memory_v2` or any parallel memory table
created or written to anywhere in this round's code (test 13, plus
direct inspection) -- `guest_memory` remains the single source of
truth for per-guest preference state, extended in place exactly as
instructed.

**Per the roadmap's own workflow rule**: this phase stops here, per
the owner's explicit final instruction ("Stop after Phase 2. Do not
start Phase 3."). `customer_intelligence_events`'s migration remains
unapplied pending owner approval; Phase 3 (backoffice) is untouched.

## Master Roadmap Phase 2 -- Production Regression Fix -- 2026-09-23

Owner's production retest of PR #72 (commit `428a2bc`) failed: "แม่เดินไกลไม่ได้"
got the generic clarify fallback ("ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง")
instead of a care-aware reply, and a following bare "มีอะไรแนะนำ" got the
SAME generic fallback instead of the mobility-aware recommendation the
first Phase 2 round shipped and tested.

**1. Root cause.** Two independent gaps, not one:
   - `_semantic-hospitality-interpreter.ts`'s `LOW_WALKING_MARKER` (used
     by `prefersLowWalking`, the ONLY thing gating
     `ecosystemFirstVisitResponse`'s existing generic low-walking-care
     branch) recognized "เดินไม่ไหว" but not "เดินไกลไม่ได้"/"เดินไม่ได้ไกล"/
     "เดินนานไม่ได้" -- a different phrasing that Phase 2's OWN
     `_customer-phrase-intelligence.ts` memory-capture regex already
     recognized. The two regexes, built in the same round for related
     purposes, drifted out of sync by hand. So the message was captured
     into `guest_memory` correctly (proven by the original Phase 2 test
     suite) but never triggered the existing care-aware responder branch
     that reads it back -- `prefersLowWalking("แม่เดินไกลไม่ได้")` was
     simply `false`.
   - A truly BARE "มีอะไรแนะนำ" (no "ครั้งแรก" context) had ZERO
     deterministic coverage at all -- a known, real gap already flagged
     and explicitly deferred in this file's own Phase 1 entry ("a truly
     BARE 'มีอะไรแนะนำ'... has no deterministic NEEDS_CONTEXT responder
     at all yet and falls through to the LLM"). The original Phase 2
     test suite's own test 3 used "มาครั้งแรก มีอะไรแนะนำ" (WITH the
     "ครั้งแรก" anchor) rather than the owner's actual bare retest
     phrase -- a real fidelity gap in that test, not just the code.

**2. Which responder swallowed the message.** Neither statement matched
any deterministic responder in the precedence cascade -- both fell all
the way through to the One-Mind/LLM orchestrator, whose `dialog.mode`
resolved to `clarify`, producing `_response-composer.ts`'s generic
`clarify` string. The test harness's stubbed LLM never exercises this
`clarify` branch (it always returns a coherent reply), which is why the
original Phase 2 test suite passed while production failed -- a real
gap between the mock and real LLM behavior under ambiguity, not a
mocking bug to fix; the actual fix is to make BOTH turns fully
deterministic so the LLM's clarify behavior is never reached at all,
per the owner's explicit "should be deterministic... do not rely on
LLM" instruction.

**3. Was memory written?** Yes, both before and after this fix --
`capturePreferenceSignals`'s own regex already recognized "เดินไกลไม่ได้"
and wrote `limited_walking` to `guest_memory` correctly. This was never
broken; only the READ side (which responder consults that memory) was.

**4. Was memory read on the next turn?** No, before this fix -- there
was no deterministic responder for a bare "มีอะไรแนะนำ" at all, so
nothing ever consulted `guestContext.constraints` for it. Fixed by item
5 below.

**5. Exact fix.**
   - `_semantic-hospitality-interpreter.ts`: extended `LOW_WALKING_MARKER`
     with `เดินไกลไม่ได้|เดินไม่ได้ไกล|เดินนานไม่ได้`, matching
     `_customer-phrase-intelligence.ts`'s existing mobility regex.
     Confirmed single-use (only `prefersLowWalking`, only consumed by
     `ecosystemFirstVisitResponse`'s existing generic branch) before
     widening it, so the blast radius is exactly one responder. This
     alone makes `ecosystemFirstVisitResponse`'s pre-existing
     `customerType && lowWalking && !classifyCareContext(...)` branch
     fire for "แม่เดินไกลไม่ได้" (already-existing `interpretCustomerType`
     recognized "แม่" via its ELDERLY_MARKER; only `lowWalking` was
     false) -- no new responder needed for requirement A.
   - `thongthai-chat.ts`: added a new, deliberately narrow
     `BARE_RECOMMEND_MARKER` (anchored to the WHOLE message, so it can
     never claim a longer domain-anchored message like "ร้านอาหารมีอะไร
     แนะนำ") plus a new branch inside `ecosystemFirstVisitResponse` that
     fires ONLY when the bare marker matches AND
     `guestContext.constraints` includes `limited_walking` -- reusing
     the exact wording already shipped and tested in the "ครั้งแรก"
     branch, for consistency. A bare "มีอะไรแนะนำ" with no memory signal
     is deliberately still left to the existing fallback -- building the
     full first-time-visitor 3-path pitch for every anonymous "มีอะไร
     แนะนำ" remains the same known Phase 4 item, not expanded by this
     fix.
   - Both fixes are fully deterministic -- neither touches the LLM/
     One-Mind path in any way; they only add coverage earlier in the
     existing precedence cascade so that path is never reached for
     these two exact messages.

**6. Tests added/fixed.**
`tests/master-roadmap-phase2-mobility-regression-fix.test.ts` (new, 7
tests, through the full signed LINE webhook, using the OWNER'S EXACT
production phrases verbatim): (1) "แม่เดินไกลไม่ได้" gets a care-aware
reply, never the generic clarify fallback, and stores `limited_walking`;
(2) a following bare "มีอะไรแนะนำ" uses the remembered mobility context,
never the generic fallback; (3) load-bearing -- the same assertion fails
if memory was never captured; (4) load-bearing -- the exact mobility-
aware string only the bare-recommendation responder produces, proving
it (not some other path) answered; (5)-(7) regressions ("สติ", "ขอคืนเงิน
ได้ไหม", "พื้นลื่นมาก ตอนเล่น ATV น่ากลัว").

**7. Full test result.** 1008/1008 passing (1001 prior + 7 new), zero
regressions.

**8. Load-bearing proof.** Two mutations, each reverted immediately
after confirming the expected failures, with both files diffed
byte-for-byte against pre-mutation backups to confirm a clean restore:
   - **`LOW_WALKING_MARKER` fix reverted** (back to its pre-fix form):
     test 1 failed (generic fallback returns for "แม่เดินไกลไม่ได้" again);
     tests 2-4 stayed green, correctly proving memory capture itself
     (a separate mechanism, Phase 2's own regex) was never broken by
     this bug -- only the read side was.
   - **Bare-recommendation responder's memory check short-circuited**
     (`&& false &&` inserted before the constraint check): tests 2 and
     4 failed (the mobility-aware reply for bare "มีอะไรแนะนำ" never
     fires without it) -- tests 1, 3, 5-7 stayed green as expected.

**9. Deploy status.** Cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round. Verify via the Netlify dashboard and the owner
retest script below after merge.

**10. Owner retest script** (same LINE conversation):
1. "แม่เดินไกลไม่ได้" -> a care-aware reply mentioning เดินน้อย (never
   "ขอรายละเอียดเพิ่มอีกนิดครับ"); `limited_walking` captured.
2. "มีอะไรแนะนำ" (same conversation) -> "ถ้ามากับคุณแม่เหมือนเดิม ทองไทย
   แนะนำแบบเดินน้อยก่อนนะครับ 😊 อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?"
   -- never the generic fallback.

**Confirmations**: no new memory keys, no schema migration, no dashboard
work, no aggregate migration applied -- a pure precedence/regex fix
within the existing Phase 2 architecture, per the owner's explicit
"this is a Phase 2 fix" scope.

**Per the roadmap's own workflow rule**: stops here, per the owner's
explicit instruction ("Stop after this fix. Do not start Phase 3.").

## Master Roadmap Phase 2 -- Restaurant Memory UX Fix -- 2026-09-24

Owner's production retest of PR #73 caught a real UX/composition
failure, NOT a memory-capture failure: "กินไม่เผ็ด แพ้กุ้ง" correctly
stored `no_spicy`/`shrimp_allergy` and correctly avoided shrimp, but the
reply was a long menu-dump block (constraint checklist + allergy
caution + intro + item list + closing question), and a following
"ร้านอาหารมีอะไรแนะนำ" repeated the EXACT SAME long block verbatim.

**1. Root cause.** `deterministicRestaurantResponse`
(`thongthai-chat.ts`) never distinguished a bare constraint/allergy
DECLARATION from a genuine recommendation REQUEST -- both always called
`restaurantMenuAdvice` + the full `formatAdvisorMessage` path. Separately,
nothing in `formatAdvisorMessage` suppressed the caution block
(`formatRestaurantConstraintAck` + the allergy staff-notify notice) on a
turn that didn't restate the constraint itself -- so a later
recommendation request, reading the SAME remembered constraint, showed
the identical block again.

**2. Which responder handled each message.** Both
"กินไม่เผ็ด แพ้กุ้ง" and "ร้านอาหารมีอะไรแนะนำ" are handled by the SAME
`deterministicRestaurantResponse` -> `formatAdvisorMessage` pair --
`isRestaurantAdvisorTurn`'s `explicitFood` marker already matches both
("เผ็ด"/"กุ้ง" for the first, "ร้านอาหาร"/"แนะนำ" for the second).

**3. Why both produced the same long block.** Because nothing
downstream of `isRestaurantAdvisorTurn` ever asked "is this turn just
stating a preference, or actually asking what to eat" -- every restaurant-
advisor turn got the identical recommendation-composition function with
identical inputs (the same remembered constraints), producing
line-for-line identical output whenever the underlying `advisor.parsed`
was unchanged.

**4. Exact UX fix.**
   - New `isBareRestaurantConstraintDeclaration(message)`
     (`thongthai-chat.ts`): true when the message mentions a constraint/
     allergy marker (`RESTAURANT_CONSTRAINT_MENTION_MARKER`, the same
     vocabulary `_restaurant-intelligence.ts`'s own `parsePreferences`
     checks) but does NOT also match a recommendation-request marker
     (`RESTAURANT_RECOMMEND_REQUEST_MARKER` -- "มีอะไร", "แนะนำอะไร",
     "อยากกิน", "ขอเมนู", etc.). When true, AND there is no already-
     active restaurant conversation (`currentRestaurantAdvisorContext`/
     `currentRestaurantSet` both empty -- otherwise a mid-flow
     refinement like "จริงๆ ขอเผ็ดน้อย" would wrongly lose its
     already-shown recommendation list), `deterministicRestaurantResponse`
     returns a new short, two-line acknowledgment
     (`formatConstraintDeclarationAck`) instead of calling the full
     recommendation formatter -- reusing `restaurantMenuAdvice`'s OWN
     `parsed` output so the acknowledgment wording always matches what
     was actually filtered, never a second, separately-maintained copy.
   - New `mentionsRestaurantConstraintNow(message)` -- same marker,
     tested on the CURRENT message only (never chat history). Passed as
     `formatAdvisorMessage`'s new third parameter,
     `constraintMentionedNow`. When false (the constraint is only
     remembered, not restated this turn), the full
     `formatRestaurantConstraintAck` + allergy-notice caution block is
     suppressed entirely, replaced by a short natural phrase from new
     `naturalRestaurantConstraintPhrase(advisor)` -- e.g. "ถ้ายังเลี่ยงกุ้ง
     และไม่เผ็ดอยู่ ทองไทยแนะนำเริ่มจาก 2–3 อย่างนี้ครับ 😊" -- matching the
     owner's own exact expected wording.
   - The existing `limitAdvisoryList(allRows, fullList ? allRows.length : 3)`
     cap and `wantsFullRestaurantList` (explicit "ขอเมนูทั้งหมด..." widen)
     were already correct and untouched -- confirmed still load-bearing
     (item 7 below).
   - Two small, pre-existing parsing gaps in `_restaurant-intelligence.ts`
     were fixed along the way, both required for the owner's own Test 5
     ("ขอเมนูทั้งหมดที่ไม่มีกุ้ง") to behave correctly: `hasNegative` didn't
     recognize "ไม่มี..." ("without/no...") as an avoidance phrasing
     (only "ไม่กิน"/"ไม่เอา"/"งด"/"เลี่ยง"/"ไม่ชอบ"/"แพ้"); and the
     negation path only pushed the bare "กุ้งแห้ง" (dried shrimp) string
     into `avoidIngredients`, never bare "กุ้ง" (fresh shrimp) -- meaning
     a plain "ไม่กินกุ้ง"/"ไม่มีกุ้ง" statement (not phrased as an allergy)
     still recommended "ต้มยำกุ้ง" (fresh-shrimp tom yum). Fixed the same
     conservative way the allergy path already handles this (see that
     code's own comment): push both the specific and the bare ingredient
     name.

**5. Tests added.**
`tests/master-roadmap-phase2-restaurant-memory-ux.test.ts`, 10 tests
through the full signed LINE webhook, using the owner's exact production
phrases: (1) declaration gets a short ack, no menu, includes staff
caution, stores both constraints; (2) a following recommendation request
uses the remembered constraint naturally, caps at 3, never repeats the
prior block, no shrimp; (3) without prior memory, no remembered-constraint
phrase appears; (4) the cap is real (proven against a seeded 6-item menu,
since the default 3-item fixture can't distinguish "capped" from
"coincidentally small"); (5) an explicit full-menu request widens the cap
and still excludes shrimp; (6) severe allergy still gets Phase 1's
escalation, no guarantee; (7)-(9) regressions (mobility memory, refund
guardrail, ATV safety routing); (10) a mid-conversation constraint
REFINEMENT (already-active recommendation flow) still shows an updated
list, never downgrades to the bare declaration ack.

**6. Full test result.** 1018/1018 passing (1008 prior + 10 new), zero
regressions.

**7. Load-bearing proof.** Four separate mutations, each reverted
immediately after confirming the expected failures, with the final file
state diffed byte-for-byte against a pre-mutation backup to confirm a
clean restore:
   - **Restaurant follow-up ignores GuestContext** (both
     `constraints: request.guestContext.constraints` AND
     `recentMessages: restaurantAdvisorRecentMessages(...)` replaced
     with empty arrays -- removing GuestContext alone wasn't enough,
     since the conversation-history path independently re-derives the
     same constraint from the SAME conversation's own prior turns, by
     design): test 2 failed, all others stayed green.
   - **Menu cap removed** (`limitAdvisoryList(allRows, allRows.length)`
     unconditionally): test 4 failed (proven against the seeded 6-item
     menu -- the default 3-item fixture is too small to show this),
     all others stayed green.
   - **Declaration turn's short-circuit disabled** (forced `false`):
     test 1 failed (the declaration turn dumped the full menu again),
     all others stayed green.
   - **Duplicate-block suppression removed** (`constraintMentionedNow`
     forced to always `true`): test 2 failed (the full caution block
     reappeared on the follow-up turn), all others stayed green.

**8. Deploy status.** Cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**9. Owner retest script** (same LINE conversation):
1. "กินไม่เผ็ด แพ้กุ้ง" -> "รับทราบครับ 🙏 เดี๋ยวทองไทยจะเลี่ยงกุ้ง/กุ้งแห้ง และ
   เลือกแบบไม่เผ็ดให้นะครับ / หน้างานขอให้แจ้งพนักงานอีกครั้งเรื่องแพ้อาหาร เพื่อ
   กันการปนเปื้อนครับ" -- short, no menu list.
2. "ร้านอาหารมีอะไรแนะนำ" -> "ถ้ายังเลี่ยงกุ้งและไม่เผ็ดอยู่ ทองไทยแนะนำเริ่มจาก
   2–3 อย่างนี้ครับ 😊" followed by up to 3 non-shrimp items and "มากี่คนครับ
   เดี๋ยวทองไทยช่วยจัดให้พอดีโต๊ะครับ" -- never repeats turn 1's caution block.

**Confirmations**: no memory-capture code touched (constraint capture
was already correct); no schema migration; no dashboard work; no
aggregate migration applied -- a response-composition fix plus two
narrowly-scoped pre-existing parsing gaps, entirely within the existing
Phase 2 restaurant advisor.

**Per the roadmap's own workflow rule**: stops here, per the owner's
explicit instruction ("Stop after this fix. Do not start Phase 3.").

## Master Roadmap Phase 2 -- Restaurant Declaration Still Dumped a Menu (Stale Context) -- 2026-09-24

Owner's production retest of PR #74 showed the follow-up recommendation
turn was now fixed, but the FIRST turn ("กินไม่เผ็ด แพ้กุ้ง") STILL
returned a full menu recommendation (constraint checklist, allergy
caution, 3 items, party-size question) instead of the short
acknowledgment PR #74 was supposed to guarantee.

**1. Root cause.** PR #74's own `isBareRestaurantConstraintDeclaration`
branch was gated by `!hasActiveRestaurantConversation`, where that gate
checked only whether `restaurantAdvisorContext`/`restaurantProposedSet`
exist AT ALL in the guest's persisted agent state -- with no expiry.
Reproduced directly: a genuinely brand-new LINE guest sending only
"กินไม่เผ็ด แพ้กุ้ง" got the correct short ack (confirmed via a probe
against the real webhook handler) -- but the owner's actual LINE test
account had leftover `restaurantAdvisorContext` from an EARLIER,
unrelated retest (a prior PR round, well over an hour before this one).
Since that context never expires on its own, the new declaration was
wrongly treated as a same-conversation refinement of stale history,
permanently blocking the short-ack path for that specific returning
guest -- exactly matching the owner's report ("still dumps a menu")
while every fresh-guest test kept passing.

**2. Exact condition that separates a declaration from a request.**
Unchanged from PR #74's own classifiers
(`isBareRestaurantConstraintDeclaration` /
`RESTAURANT_RECOMMEND_REQUEST_MARKER` /
`RESTAURANT_CONSTRAINT_MENTION_MARKER`) -- the actual fix is in what
counts as "an already-active restaurant conversation" that should defer
to the full recommendation path instead of the short ack:
`isRestaurantConversationRecentlyActive(runtime)` (new,
`thongthai-chat.ts`) now returns true only when
- a concrete, in-progress proposed order (`currentRestaurantSet`)
  exists -- always counts, regardless of age (abandoning a real
  in-progress order over a constraint declaration would be worse), OR
- `restaurantAdvisorContext.updatedAt` is within the last 10 minutes
  (`RESTAURANT_ACTIVE_CONVERSATION_WINDOW_MS`) -- a conversation that's
  genuinely still going, not a leftover from an earlier session.

A constraint declaration therefore now ALWAYS gets the short ack unless
the guest is either mid an actual pending order or has interacted with
the restaurant advisor within the last 10 minutes.

**3. Tests added/fixed.**
`tests/master-roadmap-phase2-restaurant-stale-context-fix.test.ts`, 7
tests through the full signed LINE webhook: (1) bare declaration -- short
ack, memory stored, no bullets/prices, staff caution, no party-size ask;
(2) follow-up recommendation uses remembered constraints, capped, no
duplicated warning; (3) declaration+request combined in one message
still recommends (with the caution, since it's stated this turn); (4)
regression -- explicit full-menu request still works; **(5) the actual
production bug, reproduced directly**: seeds a real guest's
`restaurantAdvisorContext.updatedAt` to one hour in the past (via
`harness.setState`, simulating the owner's real returning-guest account)
and confirms a fresh declaration still gets the short ack, not a menu
dump; (6)-(7) regressions (severe-allergy Phase 1 escalation, and the
pre-existing "mid-conversation refinement with still-RECENT context"
behavior from `restaurant-cross-domain-stress.test.ts`, confirmed
unaffected since that test's two calls happen within milliseconds, well
inside the 10-minute window).

**4. Full test result.** 1025/1025 passing (1018 prior + 7 new), zero
regressions.

**5. Load-bearing proof.**
   - **Constraint-only detection disabled** (`isBareRestaurantConstraintDeclaration`
     call replaced with `false`): tests 1 and 5 failed (both fresh and
     stale-context declarations dumped a menu again).
   - **Recommendation-request detection disabled**
     (`RESTAURANT_RECOMMEND_REQUEST_MARKER` replaced with a never-matching
     regex): tests 3 and 4 failed (a combined declaration+request, and an
     explicit full-menu request, were both misread as bare declarations).
   Both reverted immediately after confirming the expected failures,
   file diffed byte-for-byte against a pre-mutation backup to confirm a
   clean restore.

**6. Deploy status.** Cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**7. Owner retest script:**
1. "กินไม่เผ็ด แพ้กุ้ง" -> short ack only ("รับทราบครับ 🙏 เดี๋ยวทองไทยจะ
   เลี่ยงกุ้ง/กุ้งแห้ง และเลือกแบบไม่เผ็ดให้นะครับ / หน้างานขอให้แจ้งพนักงาน
   อีกครั้งเรื่องแพ้อาหาร เพื่อกันการปนเปื้อนครับ"), even on the SAME LINE
   account used for every prior retest.
2. "ร้านอาหารมีอะไรแนะนำ" -> "ถ้ายังเลี่ยงกุ้งและไม่เผ็ดอยู่ ทองไทยแนะนำเริ่ม
   จาก 2–3 อย่างนี้ครับ 😊" + up to 3 non-shrimp items + party-size
   question, never repeating turn 1's caution block.

**Confirmations**: no memory-capture code touched; no schema migration;
no dashboard work; no aggregate migration applied -- a single, narrowly-
scoped recency fix to an existing "is this conversation still active"
check, within the existing Phase 2 restaurant advisor.

**Per the roadmap's own workflow rule**: stops here, per the owner's
explicit instruction ("Do not start Phase 3.").

## Master Roadmap Phase 2 -- Restaurant Constraint vs. Recommendation Intent Split -- 2026-09-24

Owner's next production retest showed the SAME symptom (a bare
constraint statement dumping a menu) with a DIFFERENT, more specific
trigger than the previous round's fix addressed: a constraint UPDATE
sent moments after a real recommendation ("ไม่กินไก่" right after
"ร้านอาหารมีอะไรแนะนำ") still dumped the full block again.

**1. Root cause.** The previous round's fix ("stale restaurantAdvisorContext"
entry above) bounded the "already an active conversation" gate to a
10-minute recency window on `restaurantAdvisorContext.updatedAt`. That
window was, by definition, ALWAYS satisfied immediately after a
recommendation had just been shown (the recommendation turn itself
refreshes `updatedAt` to "now"), so a constraint update sent right after
always fell through to the full recommendation composer again. Any
notion of "the conversation is still active" based on conversational
recency turned out unable to distinguish "the customer is refining what
they just saw" from "the customer is stating a brand-new constraint" --
both look identical from a timestamp's point of view. The owner's own
product rule is, and was always meant to be, unconditional: a customer
declaring or updating a dietary constraint is never the same as asking
for a menu, no matter how recently a recommendation was shown.

**2. Exact intent split added.** No new classifier logic --
`isBareRestaurantConstraintDeclaration` / `RESTAURANT_RECOMMEND_REQUEST_MARKER`
/ `RESTAURANT_CONSTRAINT_MENTION_MARKER` (from the earlier "restaurant
memory UX" round) are unchanged. What changed is the ONLY thing allowed
to override the bare-declaration short ack: new `hasPendingRestaurantOrder`
(`thongthai-chat.ts`) checks ONLY for a CONCRETE, in-progress proposed
order (`currentRestaurantSet`) -- no recency window, no "conversation
context exists" check of any kind. Silently abandoning an actual pending
order over a constraint mention would be a worse failure than this one;
every other notion of "still active" was removed as unsafe. Two
supporting gaps found and fixed while reproducing the owner's exact
scenario:
   - `isRestaurantAdvisorTurn`'s own `explicitFood` anchor list had
     "เผ็ด"/"ปลาร้า"/"ถั่ว"/"กุ้ง" as bare trigger words but only
     "ไก่บ้าน" (a specific dish name), not bare "ไก่"/"หมู"/"เนื้อ" -- so
     "ไม่กินไก่ มีอะไรแนะนำ" as a customer's very FIRST message never
     reached the restaurant advisor at all. Added the three bare protein
     words, mirrored into `_semantic-interpreter-shadow.ts`'s own exact
     copy of this regex (that module's own comment says it must match
     "exactly").
   - `isRestaurantAdvisorTurn`'s `restaurantFollowUp` marker didn't
     recognize a bare "แนะนำ" ("มีอะไรแนะนำอีก" -- a natural "what else do
     you recommend" follow-up), so with restaurant context already
     established it still fell through to an unrelated generic fallback
     instead of re-running the recommendation. Safe to add broadly here
     (unlike in the declaration marker) because this branch only fires
     when restaurant history/context is ALREADY established.

**3. Supported dietary exclusions.** Extended `_customer-phrase-intelligence.ts`'s
`extractPreferenceSignal`/`extractIntelligenceSignals` to capture plain
protein/ingredient avoidance as a durable preference (previously only
allergy-flavored statements like "แพ้กุ้ง" were captured; a plain "ไม่กิน
ไก่" was filtered correctly for that one turn via the existing ephemeral
recentMessages mechanism, but never persisted): `ไม่กินไก่`/`ไม่เอาไก่`/
`งดไก่` -> `no_chicken`; `ไม่กินหมู`/`ไม่เอาหมู`/`งดหมู` -> `no_pork`;
`ไม่กินเนื้อ(วัว)?`/`ไม่เอาเนื้อ(วัว)?`/`งดเนื้อ(วัว)?` -> `no_beef`;
`ไม่กินกุ้ง`/`ไม่เอากุ้ง`/`งดกุ้ง` (non-allergy phrasing only, i.e. not also
matching `แพ้กุ้ง`) -> `no_shrimp`. `ขอไม่ใส่พริก` was also added to the
existing `no_spicy` pattern.

**4. Whether a new memory key was needed.** No. `no_pork`, `no_beef`,
`no_chicken`, `no_fish`, `no_egg`, and `no_shrimp` already existed in
`_customer-db.ts`'s own `CONSTRAINTS` allowed-value set from before Phase
2 -- they were simply never DETECTED by Phase 2's own phrase-capture
regex. This round only teaches the existing capture pipeline to
recognize phrasing that already had a valid, allowed home to write to.

**5. Tests added.**
`tests/master-roadmap-phase2-restaurant-declaration-intent-split.test.ts`,
9 tests through the full signed LINE webhook: (1) bare declaration --
short ack, no menu, no prices, no party-size CTA, allergy caution; (2)
follow-up recommendation uses remembered constraints; **(3) the actual
production bug, reproduced directly**: "ไม่กินไก่" sent immediately after
a real recommendation stores `no_chicken` and still gets the short ack,
never a menu dump; (4) a further recommendation request
("มีอะไรแนะนำอีก") uses ALL three remembered constraints together; (5)-(6)
combined declaration+request in one message, shrimp and chicken variants;
(7)-(9) regressions (mobility memory, ATV safety routing, refund
guardrail). Also updated three PRE-EXISTING tests whose expectations the
owner's new unconditional rule explicitly supersedes (each updated with
a comment explaining why, pointing back to this entry):
`tests/master-roadmap-phase2-restaurant-memory-ux.test.ts` test 10,
`tests/master-roadmap-phase2-restaurant-stale-context-fix.test.ts` test
7, and `tests/restaurant-cross-domain-stress.test.ts`'s own "a dietary
constraint mid-conversation" test (this last one predates all of Phase
2) -- all three previously required a mid-conversation constraint
refinement to still show a filtered recommendation; all three now
require the short ack instead, per the owner's own explicit rule.

**6. Full test result.** 1034/1034 passing (1025 prior + 9 new), zero
regressions.

**7. Load-bearing proof.** Three separate mutations, each reverted
immediately after confirming the expected failures, all three files
diffed byte-for-byte against pre-mutation backups to confirm a clean
restore:
   - **Declaration detection disabled** (`isBareRestaurantConstraintDeclaration`
     call replaced with `false`): tests 1 and 3 failed.
   - **`no_chicken` capture disabled** (that one detection line replaced
     with `false`): test 3 failed (the one that directly checks
     `guest_memory` for `no_chicken`) -- test 4 stayed green, confirming
     the ephemeral recentMessages-based re-derivation is a genuinely
     independent, redundant mechanism, not the same code path.
   - **Recommendation composer made to ignore remembered exclusions**
     (`constraints`/`recentMessages` both replaced with empty arrays):
     tests 2 and 4 failed (both rely purely on REMEMBERED constraints,
     not the current message) -- tests 5 and 6 stayed green, since they
     restate the constraint in the same message.

**8. Deploy status.** Cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox, as in
every prior round.

**9. Owner retest script:**
1. "กินไม่เผ็ด แพ้กุ้ง" -> short ack only.
2. "ร้านอาหารมีอะไรแนะนำ" -> up to 3 non-shrimp items using the
   remembered constraint, no repeated warning block.
3. "ไม่กินไก่" -> short ack only ("รับทราบครับ 🙏 เดี๋ยวทองไทยจะเลี่ยงกุ้ง/
   กุ้งแห้ง/ไก่ และเลือกแบบไม่เผ็ดให้นะครับ..."), even sent immediately
   after the recommendation above -- never a menu dump.
4. "มีอะไรแนะนำอีก" -> up to 3 items avoiding shrimp, spice, AND chicken
   together.

**Confirmations**: no schema migration; no dashboard work; no aggregate
migration applied -- an intent-gating fix plus a narrow, already-allowed
memory-key capture extension, entirely within the existing Phase 2
restaurant advisor.

**Per the roadmap's own workflow rule**: stops here, per the owner's
explicit instruction ("Do not start Phase 3. Do not apply aggregate
migration yet.").

## Master Roadmap Phase 2 -- Restaurant Dietary Intent Gate (Final Focus Fix) -- 2026-09-24

Owner's instruction: fix the ONE bug -- "a dietary constraint update
must not trigger a menu recommendation" -- completely, via a single
named intent gate and a full continuous 7-turn conversation test, no
scope widening.

**1. Root cause.** A brand-new guest was already handled correctly
(confirmed by direct reproduction before any code change). The owner's
retest exposed two DIFFERENT genuine remaining gaps in the previous
rounds' fixes: (a) a correction ("จริง ๆ กินไก่ได้") matched neither the
constraint-mention marker nor the recommend-request marker, classifying
as OTHER and falling through to a full menu dump; (b) once a correction
turn's own reply was fixed, it still wrongly repeated the FULL staff/
cross-contamination caution block on every later constraint-only turn,
because that caution was derived from `advisor.parsed.allergenFlags`
-- accumulated over the whole rolling `recentMessages` window -- rather
than whether the allergy was mentioned THIS turn. Separately, the
owner's own retest surfaced a genuinely new bug in the underlying menu
filter: `isHardExcluded` only hard-excluded a spicy item when someone
had manually curated its `spiceLevel >= 3`; an uncurated ส้มตำ/ยำ/ลาบ
dish (the common case -- curated profiles routinely don't exist) slipped
through even with `no_spicy` active.

**2. Exact intent gate implemented.** `classifyRestaurantDietaryIntent(text)`
(`thongthai-chat.ts`, exported), returning exactly one of
`CONSTRAINT_ONLY` / `RECOMMENDATION_ONLY` / `CONSTRAINT_AND_RECOMMENDATION`
/ `OTHER`. Built from the same two marker sets the prior round already
had (`RESTAURANT_CONSTRAINT_MENTION_MARKER`,
`RESTAURANT_RECOMMEND_REQUEST_MARKER`), now consolidated into one named
function instead of two separately-called boolean helpers, plus a new
`RESTAURANT_CONSTRAINT_CORRECTION_MARKER` OR'd into the constraint check
so a correction is never misclassified as OTHER. `deterministicRestaurantResponse`
computes this once per turn and gates on it: `CONSTRAINT_ONLY` always
gets the short ack (`formatConstraintDeclarationAck`/`formatConstraintCorrectionAck`)
unless a concrete pending order exists (`hasPendingRestaurantOrder`);
recommendation only ever runs for the other three buckets.

**3. Exact memory keys.** `no_spicy` (spice), `shrimp_allergy` (allergy)
/ `no_shrimp` (plain avoidance, non-allergy), `no_chicken`, `no_pork`,
`no_beef` -- all in `_customer-db.ts`'s pre-existing `CONSTRAINTS` set;
`no_chicken`/`no_pork`/`no_beef`/`no_shrimp` capture was added to
`_customer-phrase-intelligence.ts` two rounds ago and is unchanged here,
now with symmetric corrections (`removeConstraints`) for all four, not
just spice.

**4. Exact menu filter rule.** `_restaurant-intelligence.ts`'s
`isHardExcluded` now also hard-excludes any item whose name/category
matches `SPICY_RISK_CATEGORY_RE` (`ตำ|ส้มตำ|ยำ|ลาบ`) when `pref.spice
=== 'none'`, REGARDLESS of curated `spiceLevel` -- same conservative
"an occasional over-broad exclusion beats serving the wrong thing"
principle already used for allergens.

**5. Tests added.**
`tests/master-roadmap-phase2-restaurant-dietary-intent-gate.test.ts`:
a direct unit-level check of every `classifyRestaurantDietaryIntent`
example the owner listed; one full 7-turn continuous conversation test
(not isolated turns) covering the owner's entire required sequence
including the correction; a dedicated somtam/yam/laab exclusion test
against a seeded uncurated menu; three regressions.

**6. Full test result.** 1040/1040 passing (1034 prior + 6 new), zero
regressions.

**7. Load-bearing proof.** Five mutations, each reverted immediately
after confirming the expected failure, files diffed byte-for-byte
against pre-mutation backups: CONSTRAINT_ONLY gate disabled, `no_chicken`
capture disabled, GuestContext constraints ignored, the spice safety net
disabled, and the correction's `removeConstraints` disabled -- each
broke exactly the test(s) meant to catch it.

**8. Deploy status.** Cannot be verified from this session -- egress to
`*.netlify.app`/`api.netlify.com` is blocked from this sandbox.

**9. Owner retest script:** "กินไม่เผ็ด แพ้กุ้ง" -> short ack; "ร้านอาหารมีอะไร
แนะนำ" -> up to 3 filtered items; "ไม่กินไก่" -> short ack, no repeated
caution block; "มีอะไรแนะนำอีก" -> up to 3 items excluding shrimp, spice-
risk, AND chicken together.

**Per the roadmap's own workflow rule**: stops here, per the owner's
explicit instruction.


## Master Roadmap Phase 2 Stabilization — Meaning-First Semantic Intent Gate — 2026-09-24

**Checkpoint baseline:** main `67a36f4ccc4ffad366c1bc467e83f8d493855019` (PR #77).

**Production incident that triggered this phase:** after valid horse/activity context had existed, the customer sent `ขอโลเคชั่นหน่อยทองไทย`. The system treated the lexical token `ทองไทย` as the horse name and answered as if the customer selected that horse, even though the whole sentence was unambiguously a location request. The same architecture could let stale activity context hijack other assistant-name turns.

**Root cause:** the responder cascade had good domain-specific handlers but no small top-level meaning gate before horse/activity continuation. `activityBookingFallbackDraft` and the bare/contextual horse-selection path could inspect entity tokens + old activity context before Local Concierge (location/weather) ran much later in the cascade.

**Change:**
- Added `netlify/functions/_top-level-intent.ts` with a deliberately small, high-confidence classifier:
  - `LOCATION_REQUEST`
  - `WEATHER_REQUEST`
  - `BOT_ADDRESS`
  - `HORSE_RELATED`
  - `GENERAL_RECOMMENDATION`
  - `OTHER`
- Whole-sentence location/weather intent now outranks the `ทองไทย` entity collision.
- Explicit location/weather goes through the existing deterministic Local Concierge **before** horse/activity continuation.
- Assistant-address wording such as `ทองไทยแนะนำหน่อย` gets a deterministic assistant response and never becomes a horse selection.
- `activityBookingFallbackDraft` and `isBareAmbiguousHorseSelection` both yield when the top-level meaning is location/weather/bot-address/general-recommendation.
- Explicit horse language (`อยากขี่ม้าทองไทย`, `เอาทองไทย`) is not stolen by the new gate; the existing horse-context/ambiguity logic remains authoritative.
- Existing precedence above the new gate is unchanged: Phase 1 escalation boundary and service-feedback/safety still win first.
- Added `TOP_LEVEL_SEMANTIC_INTENT` observability log.

**CI hardening:** updated `.github/workflows/one-mind-branch-ci.yml` so every PR targeting `main` runs `npm ci && npm test`, while preserving the existing One-Mind branch push CI. This closes the process gap where Netlify deploy-preview success alone did not prove the full test suite.

**Tests:** added `tests/master-roadmap-phase2-semantic-intent-gate.test.ts`, including full signed LINE webhook coverage for:
1. stale horse context + `ขอโลเคชั่นหน่อยทองไทย` => location/map, never horse selection;
2. stale horse context + `ทองไทยแนะนำหน่อย` => assistant request, never horse selection;
3. explicit `อยากขี่ม้าทองไทย` remains horse-related;
4. restaurant constraint declaration regression;
5. refund boundary regression;
6. ATV safety regression;
plus direct classifier coverage.

**Full CI result on branch head `5599698163f1844db8b94d41422cfb7909368bb2`: 1047/1047 passing, 0 failures.** GitHub Actions job `test` succeeded. Netlify deploy preview for PR #78 is ready.

**No DB migration. No production DB mutation. No Phase 3 work.**

**Owner production retest after merge:**
1. establish horse context: `อยากขี่ม้า ไม่เคยเลย กลัวตก`
2. `ขอโลเคชั่นหน่อยทองไทย` -> must return map/location, never `เลือกทองไทย`
3. `ทองไทยแนะนำหน่อย` -> assistant/general helper response, never horse
4. fresh context: `เอาทองไทย` -> existing ambiguity/context rule, never blind booking
5. `อยากขี่ม้าทองไทย` -> horse intent remains valid
6. `ตอนนี้ฝนตกไหม` -> weather
7. regression: `กินไม่เผ็ด แพ้กุ้ง`
8. regression: `ขอคืนเงินได้ไหม`
9. regression: `พื้นลื่นมาก ตอนเล่น ATV น่ากลัว`

**Stop/checkpoint rule:** merge this phase only after final head CI is green, then owner performs the production smoke above before any next semantic-routing expansion.


## Master Roadmap Phase 2 Stabilization — Restaurant Follow-up Precedence — 2026-09-25

**Owner production smoke that exposed this:** after horse context, the guest said `กินไม่เผ็ด แพ้กุ้ง` -> `ร้านอาหารมีอะไรแนะนำ` -> `มีอะไรแนะนำอีก`. The final LINE turn returned the generic clarification `ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง` instead of continuing the restaurant recommendation.

**Root cause:** LINE intentionally sends `chatHistory: []`. Restaurant continuity was correctly persisted in `guest_agent_state.restaurantAdvisorContext`, but routing still had two model-bearing layers ahead of the grounded restaurant responder:
1. the early One-Mind cutover guard originally checked restaurant intent with an empty agent state, so a bare follow-up could not prove its topic;
2. even after preserving the cutover, `deterministicActivityResponse` still ran before `deterministicRestaurantResponse` and invokes One-Mind semantic interpretation. With an old horse task present, the real model could claim/clarify the turn before restaurant logic ran.

**Fix:**
- For `RECOMMENDATION_ONLY` turns that are not explicit food phrases, the pre-cutover guard now reads the small persisted `guest_agent_state` snapshot and re-runs the existing `isRestaurantAdvisorTurn` classifier with real server context.
- After the full runtime is loaded, the grounded deterministic restaurant responder now runs **before** the model-bearing activity semantic responder. `isRestaurantAdvisorTurn` already rejects explicit horse/ATV/archery messages, so activity intents keep their existing path.
- No new phrase-specific answer was added; this is routing/precedence based on persisted topic context.
- Added test-harness Gemini call counting so tests can prove a deterministic fast path truly used zero model completions, instead of merely producing the right final answer after an unnecessary model call.

**Load-bearing production-shaped test:** `tests/master-roadmap-phase2-restaurant-followup-cutover.test.ts` runs a signed LINE sequence with `THONGTHAI_ONE_MIND_CUTOVER=1`, empty LINE history, and pre-existing horse/activity context. It asserts that after a restaurant recommendation, `มีอะไรแนะนำอีก`:
- does not call Gemini/One-Mind at all,
- does not return the generic clarification,
- returns grounded menu recommendation item(s),
- keeps the remembered shrimp-allergy filter on recommended item lines.

**Verified code head:** `1057abbabd9c2368a5f9f380919895c2f5f2cd3b` — GitHub Actions **1048/1048 passing, 0 failures**. Targeted test #458 passed with logs showing `SEMANTIC_RESPONDER_SELECTED deterministicRestaurantResponse` immediately after the top-level intent log, with no model-provider call on that follow-up.

**No DB migration. No production DB mutation. No Phase 3 work.**

**Owner retest after production deploy:** use the same existing LINE conversation and send `มีอะไรแนะนำอีก`. Expected: another short restaurant recommendation that respects remembered constraints; never the generic `ขอรายละเอียดเพิ่มอีกนิด` reply.


## Phase 2 Stabilization — Restaurant "อีก" semantics + strict no-spicy — 2026-09-25

Owner production smoke after PR #79 confirmed restaurant routing/context continuity was fixed, but exposed two content-quality gaps:
1. `มีอะไรแนะนำอีก` repeated the same top recommendations instead of giving other grounded options.
2. strict `ไม่เผ็ด` could still recommend conventional spicy-risk dishes/sauces when curated `spiceLevel` metadata was absent, e.g. `คอหมูย่างจิ้มแจ่ว` / `เสือร้องไห้`.

Changes:
- Explicit restaurant follow-ups containing `อีก` / `อย่างอื่น` / `เมนูอื่น` rotate from ranked positions 1–3 to the remaining grounded shortlist (positions 4–5).
- If no additional verified candidates remain, Thongthai says so instead of repeating or hallucinating.
- Strict `no_spicy` hard-exclusion now conservatively covers name/category risk markers `น้ำตก`, `ต้มแซ่บ`, `พล่า`, `แจ่ว`, and `เสือร้องไห้` in addition to existing `ตำ/ส้มตำ/ยำ/ลาบ`.
- No menu facts/prices are invented; ranking still comes from existing restaurant SOT.

Tests:
- direct intelligence test proves risky names are excluded even when profile spice metadata defaults to 0;
- full signed LINE test proves `มีอะไรแนะนำอีก` returns only remaining grounded items and does not repeat the first top-3;
- previous PR #79 follow-up regression now accepts the honest no-more-verified-options response when the constrained catalog genuinely has no additional safe items.

Verified code head before docs-only checkpoint: `3fa6f13592e20c5b121e666c75d2b51897d21561` — GitHub Actions success.

No DB migration. No production DB mutation. No Phase 3 work.

Owner retest after merge/deploy:
- in the same existing restaurant conversation, send `มีอะไรแนะนำอีก`;
- expected: different grounded items from the previous list, OR an honest no-more-verified-options message;
- must not repeat the exact same top 3;
- with remembered `ไม่เผ็ด`, must not recommend conventional spicy-risk items/sauces such as `จิ้มแจ่ว`, `เสือร้องไห้`, `ตำ`, `ยำ`, `ลาบ`, `น้ำตก`, `ต้มแซ่บ`, `พล่า` unless future SOT explicitly verifies a safe non-spicy preparation.


## Phase 2 Stabilization — Restaurant food/drink scope continuity — 2026-09-25

Owner production smoke after PR #80 showed the "อีก" routing fix worked, but revealed semantic category drift: in a FOOD conversation with remembered `ไม่เผ็ด + แพ้กุ้ง + ไม่กินไก่`, `มีอะไรแนะนำอีก` returned `Singha Draft (แก้ว)` and `น้ำกระเจี๊ยบ`. Those rows were grounded and constraint-safe, but they were beverages, not a continuation of food recommendations.

Read-only production DB verification confirmed the live categories involved: `เบียร์สด` for Singha Draft and `น้ำสมุนไพร` for น้ำกระเจี๊ยบ.

Fix:
- generic restaurant recommendations now default to **food scope**;
- beverage categories are eligible only when the customer explicitly asks for drinks/beer/spirits/herbal drinks, or when a vague follow-up inherits a recent drink scope;
- dessert categories are eligible only when explicitly requested, or inherited from recent dessert context;
- explicit full-menu intent can still span all categories;
- a food follow-up no longer falls into beverages merely because safe food candidates were exhausted.

This preserves topic meaning instead of patching product names.

Tests:
- direct advisor test: generic restaurant recommendation returns food only;
- direct advisor test: explicit drink request returns beverage rows;
- direct advisor test: explicit dessert request returns dessert rows;
- direct continuity test: vague follow-up after an explicit drink request stays in drink scope;
- full signed LINE test: food recommendation -> `มีอะไรแนะนำอีก` never returns Singha/beer/herbal drink rows.

Verified code head `5592f4368d83e1620ad74ccd2bb18e5095bbd14e`: GitHub Actions **1053/1053 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.

Owner retest after production deploy:
- same existing LINE conversation;
- send `มีอะไรแนะนำอีก`;
- expected: another FOOD option that respects remembered constraints, or an honest "no more verified food options" response;
- must not drift to beer/herbal drinks unless the customer asks for drinks.


## Phase 2 Final Restaurant Quality Checkpoint — 2026-09-25

Owner production smoke after PR #81 finally kept `มีอะไรแนะนำอีก` inside FOOD scope and returned `ไข่เจียวหมูสับ` + `ขนมจีน`. This proved category continuity, but exposed three last quality gaps before closing the restaurant-memory slice:

1. strict `ไม่เผ็ด` still trusted curated `spiceLevel` too much; production SOT contains dishes with `พริกสด/พริกแห้ง` in authoritative ingredient_names while profile spiceLevel is only 0–1;
2. generic recommendation ranking could promote bare staple/side rows (e.g. plain `ขนมจีน`) as standalone recommendations ahead of substantive dishes;
3. repeated `มีอะไรแนะนำอีก` had no persistent cursor on LINE, so after the second page it could loop the same alternatives forever because LINE transports no chat history.

Fix:
- strict no_spicy now hard-excludes authoritative raw chilli ingredients (`พริกสด`, `พริกแห้ง`, `พริกป่น`, `พริกขี้หนู`, `พริกจินดา`, `พริกชี้ฟ้า`, chili/chilli) in addition to existing name/category risk rules;
- scoring gives substantive main/protein/grill/soup/single-plate roles priority and penalizes bare side-only rows;
- generic recommendation display suppresses bare staple-only rows as standalone picks while full-list/compose/pairing flows keep them available;
- `restaurantAdvisorContext` now stores a bounded `recentRecommendationNames` cursor;
- first recommendation stores shown grounded names; each `อีก` follow-up serves only unseen grounded rows; when exhausted, Thongthai says there are no more verified options instead of looping or hallucinating;
- a fresh non-`อีก` recommendation request resets the shown-name cursor; constraint-only updates preserve it.

Tests added:
- raw chilli ingredient safety with low/zero profile spiceLevel;
- substantive main ranks ahead of bare side;
- full signed LINE sequence proves first page -> unseen second page -> honest exhausted third page.

Verified code head `a6b995932935dcdeec3581fa73917816922f73fb`: GitHub Actions **1056/1056 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.

Owner smoke after deploy:
1. same restaurant conversation: `ร้านอาหารมีอะไรแนะนำ`
2. `มีอะไรแนะนำอีก`
3. `มีอะไรแนะนำอีก`
Expected:
- no shrimp/chicken/spicy-risk item under remembered constraints;
- no beer/herbal drink drift unless explicitly requested;
- no bare staple presented as a top standalone recommendation when substantive food exists;
- no repeated names across pages;
- final page honestly says no more verified options when exhausted.


## Phase 2 Stabilization — Durable protein avoidance safety — 2026-09-25

Owner production smoke after the final restaurant paging work exposed a load-bearing dietary safety failure: the customer had previously said `ไม่กินไก่`, but a later recommendation returned `ไก่บ้านทอดสมุนไพร`.

A production-shaped failing test proved the exact mechanism:
- `ไม่กินไก่` **did persist correctly** as durable `guest_memory.constraints = no_chicken`;
- the next recommendation naturally said `ถ้ายังเลี่ยงไก่อยู่...`, proving the durable constraint was active;
- but a chicken dish still passed when curated `profile.proteinTags` was unavailable, because hard exclusion relied on profile tags instead of authoritative raw `ingredient_names`.

Load-bearing red proof: commit `634d901586b0779e2a94ab23e858c67234af5036` failed the new full LINE test with actual output containing `ไก่บ้านทอดสมุนไพร` despite active `no_chicken`.

Fix:
- protein avoidance now has a raw-ingredient fallback in `_restaurant-intelligence.ts`;
- `no_chicken` detects real chicken-meat ingredient forms (ไก่บ้าน/เนื้อไก่/อกไก่/สะโพกไก่/น่องไก่/ปีกไก่/ไก่ย่าง/ไก่ทอด/ไก่สับ/chicken) while deliberately NOT treating `ไข่ไก่` as chicken meat;
- equivalent defensive raw fallbacks were added for pork/beef/fish/egg constraints;
- curated profile tags remain useful, but are no longer a single point of failure for dietary exclusion.

Regression test: `tests/master-roadmap-phase2-durable-no-chicken.test.ts` uses full signed LINE flow and a menu catalog with **no curated intelligence profiles**. It proves:
1. `ไม่กินไก่` persists into existing guest_memory as `no_chicken`;
2. a later restaurant recommendation does not contain the raw chicken-ingredient dish;
3. non-chicken alternatives remain available.

Verified fixed head `b5f6bba367ddb1924923394c1b6c539769cfb611`: GitHub Actions **1057/1057 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.

Owner retest after production deploy:
- send `ไม่กินไก่` once to ensure this old test conversation has a fresh durable no_chicken constraint;
- then `ร้านอาหารมีอะไรแนะนำ`;
- then `มีอะไรแนะนำอีก`;
- no chicken dish may appear even if intelligence-profile metadata is missing.


## Phase 2 Stabilization — Dietary restaurant intent beats Local Concierge generic food-culture — 2026-09-25

Owner production smoke exposed a routing bug after the durable no-chicken fix:
- `ไม่กินเผ็ดด้วยนะ` returned generic Isan-food copy instead of a short dietary acknowledgment.
- `บอกว่าไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง` repeated the same generic food-culture answer instead of using the grounded restaurant advisor.

Root cause:
`deterministicLocalConciergeResponse` runs before `deterministicRestaurantResponse`. Its broad `food_culture` classifier could claim high-confidence dietary restaurant turns before the dedicated restaurant intent gate ever ran.

Load-bearing red proof:
commit `80081d4b4fff3f0d33cc9f682f8058718596af6c` added the exact production phrases as full signed LINE tests and failed both.

Fix:
- before Local Concierge, compute the existing `classifyRestaurantDietaryIntent`;
- prefer the grounded restaurant path for:
  1. `CONSTRAINT_ONLY` declarations/updates;
  2. `CONSTRAINT_AND_RECOMMENDATION` only when the same message has an explicit grounded menu/recommendation ask (`มีอะไร`, `แนะนำอะไร`, `กินอะไรดี`, `ขอเมนู`, etc.);
- deliberately do NOT steal broad hospitality/food-culture messages such as `อยากกินอีสาน ไม่กินเผ็ด`, and do not steal recommendation-only visitor-context questions such as `มากับแฟนกินอะไรดี`.
- weather/location precedence remains unchanged and still wins earlier.

Regression coverage:
- exact owner phrase `ไม่กินเผ็ดด้วยนะ` -> short constraint ack, no generic Isan-food copy, no menu dump;
- exact combined phrase -> grounded priced menu, excludes chicken/shrimp/spicy test dishes;
- existing Local Concierge food-culture and Service Mind tests remain green.

Verified branch head `59a2ff2d945920d76ecfb9cf39aee088f0b4ff9d`: GitHub Actions **1059/1059 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.

Owner retest after deploy:
1. `ไม่กินเผ็ดด้วยนะ`
2. `บอกว่าไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง`
Expected:
- turn 1 short acknowledgment only;
- turn 2 grounded menu recommendations respecting all 3 current constraints;
- never the generic `อาหารอีสานแท้ๆ...รสจัดจ้าน...` paragraph.


## Phase 2 Stabilization — Durable no_shrimp covers fresh + dried shrimp — 2026-09-25

Owner smoke for the combined dietary phrase passed visually, but review of the underlying constraint mapping found a latent durable-memory bug:
- same-turn `ไม่กินกุ้ง` was safe because parsePreferences added both fresh `กุ้ง` and `กุ้งแห้ง`;
- durable `guest_memory.constraints = no_shrimp` mapped only to `กุ้งแห้ง`, so a later turn relying only on memory could allow a fresh-shrimp dish.

Fix:
- `FOOD_CONSTRAINT_ALIASES.no_shrimp` now excludes both `กุ้ง` and `กุ้งแห้ง`;
- customer-facing acknowledgement now says `ไม่มีกุ้ง` instead of the misleading narrower `ไม่มีกุ้งแห้ง`;
- full signed LINE regression proves `ไม่กินกุ้ง` persists as `no_shrimp` and a later restaurant recommendation excludes both a fresh-shrimp dish and a dried-shrimp dish.

Verified head `028bb6ce18bb631b94acd0c69b5dc0835409b302`: GitHub Actions **1060/1060 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.


## Phase 2 Stabilization — Same-turn preference application — 2026-09-25

Owner production smoke exposed a subtle state-timing bug:
- customer sent `ไม่กินกุ้ง`;
- durable capture wrote the new preference, but the same reply still said only `เลี่ยงไก่ / ไม่เผ็ด`;
- the newly stated shrimp avoidance was only visible on a later turn.

Root cause:
`processThongthaiChatCore` loads `request.guestContext` BEFORE `capturePreferenceSignals` writes durable guest_memory. The write was correct, but the responder cascade for that SAME turn still held the stale in-memory GuestContext.

Fix:
- compute the same canonical `extractPreferenceSignal` used by durable capture;
- keep the existing durable DB write unchanged;
- immediately merge the canonical add/remove constraint delta (plus pace/travelerType when present) into the current in-memory `request.guestContext`;
- corrections remove stale constraints on the same turn;
- no extra DB read is added.

A first load-bearing test run correctly failed because the short-ack helper itself omitted non-allergy shrimp/peanut ingredient labels. That copy gap was fixed too: `restaurantConstraintAvoidLabels` now includes shrimp and peanut avoidance from parsed avoidIngredients.

Full LINE regressions:
1. fresh `ไม่กินกุ้ง` -> same reply explicitly acknowledges shrimp avoidance; no menu dump;
2. fresh `ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง มีอะไรแนะนำบ้าง` -> same-turn grounded recommendation excludes chicken/shrimp/spicy test dishes.

Verified head `a7fab775000628af33cb0788bcdb88cfc14cbb0d`: **1062/1062 tests passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.


## Phase 2 Stabilization — Resolve Thongthai's Own Ecosystem Focus Question — 2026-09-25

Owner production smoke exposed a conversation-state gap:
- Thongthai correctly remembered `limited_walking` and asked: `อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?`
- customer answered the offered branch directly: `อยากเน้นกินข้าว`
- production fell to the generic clarification: `ขอรายละเอียดเพิ่มอีกนิดครับ จะได้ช่วยต่อให้ตรงเรื่อง`.

Root cause:
LINE intentionally transports no chat history. The deterministic ecosystem responder asked a multi-choice follow-up but persisted no pending-choice state, so the customer's answer was context-free on the next webhook. A first implementation also read `activeTopic`, but the persisted guest-agent-state schema stores the key as `active_topic`; the load-bearing tests caught this before merge.

Fix:
- mobility-personalized ecosystem recommendation now persists `activeTopic=ecosystem_focus_choice` plus an unresolved-choice marker;
- an early deterministic continuation reads the bounded server-side guest-agent-state snapshot before One-Mind cutover;
- food choice (`อยากเน้นกินข้าว`, `เน้นอาหาร`, etc.) goes directly to verified restaurant SOT and returns grounded menu recommendations while preserving durable guest constraints;
- cafe choice gets a specific Inthanin next question;
- light-activity choice gets a specific activity-selection next question;
- direct `อยากเน้นกินข้าว` without prior choice context is also recognized as a food-start intent and asks the concrete dietary question instead of generic clarification;
- continuation uses the persisted snake_case `active_topic` key (with compatibility support for camelCase);
- no legacy `loadBrainRuntime` call was inserted ahead of the canonical cutover, preserving Phase N architecture ordering.

Load-bearing tests:
- full signed LINE: `แม่เดินไกลไม่ได้` -> `มีอะไรแนะนำ` -> `อยากเน้นกินข้าว` => grounded priced restaurant recommendations, never vague clarification;
- the same own-question flow resolves cafe and light-activity branches specifically;
- direct `อยากเน้นกินข้าว` without prior state gets a specific food question;
- Phase N canonical-order regression remains green.

Verified code head `957789cb82045e2f0629f586c7e8dca10f53adf6`: GitHub Actions **1066/1066 passing, 0 failures**.

No DB migration. No production DB mutation. No Phase 3 work.

Owner retest after production deploy:
1. `แม่เดินไกลไม่ได้`
2. `มีอะไรแนะนำ`
3. `อยากเน้นกินข้าว`
Expected turn 3: grounded restaurant recommendation with real prices/constraints, never `ขอรายละเอียดเพิ่มอีกนิด`.


---

## Phase 2 Closeout — Persisted Pending-Question / Semantic Follow-up — 2026-09-25

**STATUS: CODE READY; PHASE 2 IS NOT CLOSED UNTIL OWNER PRODUCTION LINE SMOKE PASSES.**

### Why this checkpoint exists

LINE intentionally calls the canonical core with `chatHistory: []`. The production failure was not missing restaurant wording; it was missing server-side knowledge of the question Thongthai itself had just asked:

1. `แม่เดินไกลไม่ได้`
2. `มีอะไรแนะนำ`
3. Thongthai: `อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?`
4. Customer: `อยากเน้นกินข้าว`
5. Old behavior: generic `ขอรายละเอียดเพิ่มอีกนิดครับ...`

PR #88 fixed that exact ecosystem branch with `active_topic + unresolved_need`, but the continuation was still a branch-specific regex responder. Phase 2 closeout replaces that patchy continuation contract with a bounded, persisted semantic pending-question state.

### Test-first proof

- Test-only RED commit: `cc3ddf90772addc16f015bc163bd994beeaa2644`
- GitHub Actions run: `36108132718`
- Result: **1066 pass / 1 fail**
- Exact failure: `own clarification/choice question must persist pending_question`
- This proves current production architecture did not yet have the required structured continuation state even though PR #88 could answer the exact food phrase.

### Architecture added

New domain-agnostic module:

- `netlify/functions/_conversation-continuity.ts`

Persisted state contract:

```ts
pending_question: {
  domain: string,
  kind: "preference_choice" | "entity_choice" | "party_size",
  choices?: Array<{ value: string, aliases: string[] }>,
  slot?: string
}
```

Canonical response contract now supports:

- `agentStateUpdate.pendingQuestion`
- `agentStateUpdate.clearPendingQuestion`

Persistence remains inside the existing `guest_agent_state` CAS store through `persistBrainRuntime -> patchGuestAgentState`.
No new table, database, site, repo, or production migration was added.

### Resolution policy

The resolver combines:

- current customer message
- persisted `pending_question`
- existing durable customer memory loaded by the canonical core

It resolves canonical values from the choices stored by the **question producer**, rather than hard-coding the current customer sentence inside a branch responder.

Current integrated ecosystem producer persists:

- domain: `general_recommendation`
- choices: `restaurant | cafe | light_activity`

The old `ecosystem_focus_choice` phrase-regex continuation has been removed.

Precedence is preserved:

1. urgent safety / authority escalation
2. service feedback
3. persisted pending-question continuation
4. explicit location / weather / assistant-address intent
5. explicit domain responders / active-task continuation
6. normal One-Mind fallback

A clear explicit domain switch discards an incompatible stale general-recommendation pending question before normal domain routing. This prevents stale choice state from stealing location/weather/horse/ATV/homestay turns.

### Load-bearing coverage

The generic resolver is independently proven for:

- preference choices
- entity choices (e.g. canonical horse choice)
- party size, including Thai digits
- ambiguous multi-choice answers return no guess

The signed LINE regression uses the real webhook path and therefore `chatHistory: []`.

The final same-user Phase 2 closeout matrix covers:

1. `แม่เดินไกลไม่ได้`
2. `มีอะไรแนะนำ`
3. `อยากเน้นกินข้าว`
4. `ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง`
5. `มีอะไรแนะนำบ้าง`
6. `มีอะไรแนะนำอีก`
7. `ขอโลเคชั่นหน่อยทองไทย`
8. `ตอนนี้ฝนตกไหม`
9. `อยากขี่ม้า ไม่เคยเลย กลัวตก`
10. `เอาทองไทย`
11. `ขอคืนเงินได้ไหม`
12. `พื้นลื่นมาก ตอนเล่น ATV น่ากลัว`

The matrix verifies:

- mobility memory survives
- obvious answer to Thongthai's own question never falls to generic clarification
- intended pending resolution uses zero model calls
- no-spicy / no-chicken / no-shrimp remain durable across topic turns
- restaurant `มีอะไรแนะนำอีก` returns unseen grounded options or an honest no-more result
- location/weather are not hijacked by horse or stale restaurant state
- explicit horse intent switches domain correctly
- `เอาทองไทย` is interpreted as the horse inside horse context
- refund authority boundary overrides active horse state
- ATV safety escalation overrides every active task
- owner/activity feedback events still route through the existing notification/event path

### Final branch CI before this handoff update

Head: `85040264ddeacd59dea8b243573fa344f41879a1`

GitHub Actions run: `36109122400`

Result: **1070 / 1070 PASS**

### What remains before Phase 2 can be marked CLOSED

Owner must production-smoke the real LINE flow after PR merge and automatic Netlify production deployment.

Start with **one message at a time**:

`แม่เดินไกลไม่ได้`

Do not start Phase 2.7 or Phase 3 until the owner confirms the production smoke passes the Phase 2 Definition of Done.

Phase 2.7 `customer_intelligence_events` migration remains **NOT APPROVED / NOT APPLIED** and still requires explicit owner approval.


---

## Phase 2 Production Smoke Fix — Horse context after explicit domain switch — 2026-09-25

**STATUS: FIXED IN PR #90; PHASE 2 STILL AWAITS OWNER PRODUCTION SMOKE.**

Owner production LINE smoke failed at closeout turn 10:

- prior turn: `อยากขี่ม้า ไม่เคยเลย กลัวตก`
- Thongthai correctly entered horse-care behavior and asked `แล้วมากี่คนครับ?`
- next turn: `เอาทองไทย`
- wrong production reply: `หมายถึงอยากเลือก “ทองไทย” เป็นม้าสำหรับขี่ หรือเรียกทองไทยผู้ช่วยแชทครับ 😊`

This proved the earlier closeout test was too weak: it only asserted that the response contained `ทองไทย` / `เลือกทองไทย`, so the bad clarification could accidentally satisfy it.

### Root cause

LINE has `chatHistory: []`, so the horse-name disambiguator relies on persisted task context.

`horseCompoundCareIntentResponse` called `markActivityIntentStarted`, but that helper returned early whenever **any** unfinished task was already active. A stale unrelated restaurant/other-domain task could therefore remain active even after a clear explicit horse-domain switch.

Result:

- horse-care wording was returned for the current turn;
- server-side active task still said `restaurant`;
- next webhook `เอาทองไทย` saw no persisted activity context;
- the correct bare-name safety clarification fired.

### Test-first proof

Test-only RED commit: `7a38318e53db66abdc3b9f1e1b6c7857d49c93b3`

GitHub Actions run: `36110907138`

Failure:
- expected active task domain: `activity`
- actual: `restaurant`

The new regression uses the real signed LINE webhook with `chatHistory=[]`, seeds a legitimate stale unrelated active task, then sends:

1. `อยากขี่ม้า ไม่เคยเลย กลัวตก`
2. `เอาทองไทย`

### Architectural fix

Explicit horse/activity intent now uses the existing bounded task-stack semantics:

- if the current unfinished task is already `activity`, reuse it;
- if an unfinished task belongs to another domain, call `suspendActiveTask`;
- start the new `activity_booking` task;
- preserve the old task in `suspendedTask` instead of overwriting or silently dropping it.

The same protection was added to direct horse-selection persistence so an explicit named-horse selection cannot overwrite an unrelated active task either.

No phrase-specific `if text == "เอาทองไทย"` patch was added.

### Load-bearing expectations

The regression now requires:

- active task becomes `activity_booking`;
- old unrelated task remains in bounded `suspendedTask`;
- `เอาทองไทย` reply begins `ได้ครับ เลือกทองไทย...`;
- reply must NOT contain `หมายถึงอยากเลือก` / `ผู้ช่วยแชท`;
- selected horse persists as `assetSelection = ทองไทย`;
- horse care + horse selection use zero model calls.

Fixed code head: `1327f7338fd72af81709cc9d54ec1d3b3e7a2854`

GitHub Actions run `36111060758`: **1071 / 1071 PASS**.

No DB migration. No production DB mutation. No Phase 2.7 or Phase 3 work.

Owner production retest after automatic deployment:
- send exactly `เอาทองไทย` in the CURRENT horse conversation.
- expected: direct horse selection, never assistant-vs-horse clarification.


---

## Phase 2 Production Smoke Fix — Horse-care slot continuity — 2026-09-25

**STATUS: FIXED IN PR #91; PHASE 2 STILL AWAITS OWNER PRODUCTION LINE SMOKE.**

Owner production LINE smoke confirmed PR #90 fixed horse-name disambiguation:
- `อยากขี่ม้า ไม่เคยเลย กลัวตก`
- `เอาทองไทย`
- Thongthai correctly selected horse ทองไทย without asking assistant-vs-horse clarification.

The same screenshot exposed a second continuity defect:
- the opening turn already contained `ไม่เคยเลย`;
- Thongthai's first reply correctly understood this and asked only `แล้วมากี่คนครับ?`;
- after selecting `ทองไทย`, it incorrectly asked again `เคยขี่ม้ามาก่อนไหมครับ แล้วมากี่คนครับ?`.

### Root cause

`horseCompoundCareIntentResponse` semantically interpreted rider experience/fear for its current reply, but persisted only care flags such as fear/customer type/health. It did not persist the already-understood `riderExperience` / `partySize` care slots into the activity task.

Separately, `horseSelectionWithContextResponse` hard-coded the same two care questions regardless of which slots were already known.

With LINE `chatHistory=[]`, this meant a fact understood on one turn disappeared from the next turn's continuation state.

### Test-first proof

Test-only RED commit: `5a37953bbdd881de678e4be8803a51a9b6669aae`

GitHub Actions run: `36112952637`

Exact failure:
- expected `activeTask.slots.riderExperience = beginner`
- actual `undefined`

The signed LINE regression sends:
1. `อยากขี่ม้า ไม่เคยเลย กลัวตก`
2. `เอาทองไทย`

and requires the selection turn NOT to repeat `เคยขี่ม้ามาก่อนไหม`.

### Architectural fix

- Compound horse-care opener now persists every care fact already parsed from the current turn:
  - `riderExperience`
  - `partySize`
  - existing fear / health / customer-type signals
- Selection continuation reloads the persisted activity task AFTER horse selection.
- The next question is derived from genuinely missing slots:
  - neither known -> ask experience + party size
  - experience known -> ask only party size
  - party size known -> ask only experience
  - both known -> proceed to the health/balance clarification
- No phrase-specific patch for `ไม่เคยเลย` or `เอาทองไทย`; the existing semantic interpreters and task slots remain the source of truth.

Fixed code head: `62e6dbe23609205be3042567d3c48773048266c6`

GitHub Actions run `36113088787`: **1072 / 1072 PASS**.

No DB migration. No production DB mutation. No Phase 2.7 or Phase 3 work.

Owner production retest after automatic deployment:
1. `อยากขี่ม้า ไม่เคยเลย กลัวตก`
2. `เอาทองไทย`

Expected turn 2:
- direct `เลือกทองไทย`;
- asks only `มากี่คนครับ?`;
- must NOT ask `เคยขี่ม้ามาก่อนไหม` again.


---

## PHASE 2 CLOSED — Production LINE smoke complete — 2026-09-25

**STATUS: CLOSED.**

Phase 2 — Customer memory + semantic conversational continuity is now closed based on **real owner production LINE smoke**, not unit tests alone.

### Production baseline at closure

- Production `main` commit: `6e120275237df9e303e194a46d3f79ac1c32e3e4`
- Netlify production deploy: `6ab63133b93e640008e6a41d`
- Netlify state: **READY**
- Deploy `commit_ref`: `6e120275237df9e303e194a46d3f79ac1c32e3e4`
- Deploy was automatic (`manual_deploy=false`)
- Latest full GitHub Actions result before closure: **1072 / 1072 PASS**

### Owner production smoke that passed

The owner tested the real LINE account, one same conversation, including:

1. `แม่เดินไกลไม่ได้`
   - limited-walking context captured.

2. `มีอะไรแนะนำ`
   - remembered the mother / low-walking context and asked the specific refinement:
     `อยากเน้นกินข้าว คาเฟ่ หรือกิจกรรมเบา ๆ ครับ?`

3. `อยากเน้นกินข้าว`
   - correctly resolved as the answer to Thongthai's own previous question.
   - no generic `ขอรายละเอียดเพิ่มอีกนิด`.
   - entered grounded restaurant recommendations.

4. `ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง`
   - acknowledged constraints without dumping a menu.

5. `แนะนำอะไร`
   - returned grounded menu choices respecting no-spicy / no-chicken / no-shrimp.

6. `มีอะไรแนะนำอีก`
   - did not repeat the same menu page.
   - honestly reported that no further verified options were available under the constraints.

7. `ขอโลเคชั่นหน่อยทองไทย`
   - correctly treated `ทองไทย` as the assistant, not the horse.
   - returned the location / Google Maps link.

8. `ตอนนี้ฝนตกไหม`
   - correctly switched to weather intent instead of letting stale restaurant context hijack the turn.

9. `อยากขี่ม้า ไม่เคยเลย กลัวตก`
   - switched cleanly into horse-care context.
   - care-first response, no booking/payment rush, no 100% safety guarantee.
   - persisted `riderExperience=beginner` and fear context.

10. `เอาทองไทย`
    - correctly selected horse `ทองไทย`.
    - did not ask assistant-vs-horse clarification.
    - did not re-ask `เคยขี่ม้ามาก่อนไหม`.
    - asked only the still-missing party-size question.

11. `ขอคืนเงินได้ไหม`
    - authority boundary overrode active horse context.
    - Thongthai did not approve a refund itself.
    - owner LINE notification was received.
    - Customer Voice event/backoffice link was generated.

12. `พื้นลื่นมาก ตอนเล่น ATV น่ากลัว`
    - safety escalation overrode all active context.
    - Thongthai told the customer the real surface conditions require team checking.
    - owner LINE safety notification was received.
    - activity LINE safety notification was received.
    - Customer Voice event/backoffice link was generated.

### Phase 2 Definition of Done — final status

A. Memory survives multiple turns — **PASS**

B. Thongthai understands answers to its own previous questions — **PASS**

C. Explicit new intent switches domain cleanly — **PASS**

D. Stale context does not hijack new intent — **PASS**

E. Dietary / mobility / fear preferences persist correctly — **PASS**

F. Safety + authority override active tasks — **PASS**

G. No generic clarification for an obvious contextual answer — **PASS**

H. No regression in location / weather / horse / ATV / restaurant / mobility / refund / safety / owner notification — **PASS**

### Important smoke fixes included before closure

- PR #89 — persisted generic `pending_question` semantic follow-up resolver.
- PR #90 — explicit horse/activity domain switch suspends unrelated stale task instead of being blocked by it.
- PR #91 — horse-care facts already understood in the opening turn are persisted, and subsequent prompts ask only genuinely missing slots.

### Guardrails after closure

Phase 2.7 `customer_intelligence_events` aggregate migration remains:

**NOT APPROVED / NOT APPLIED**

Do not apply that migration without explicit owner approval.

Phase 3 — Owner Dashboard / Customer Voice OS remains:

**NOT STARTED**

Do not start Phase 3 until the owner explicitly approves proceeding after this closed checkpoint.

No new repo, Supabase project, site, or production DB mutation was created as part of Phase 2 closeout.


---

## Phase 2.7 — Aggregate Customer Intelligence Storage — 2026-09-25

**STATUS: DONE — DATABASE APPLIED + CODE MERGED + PRODUCTION DEPLOY VERIFIED.**

Owner explicitly approved proceeding with Phase 2.7 after Phase 2 was closed.

### Canonical database

Project:
- `tamma-customer-data`
- project ref: `upaokrprawzhgzeqsdke`

Migration:
- repo file: `supabase/migrations/20260923142552_customer_intelligence_events_v1.sql`
- Supabase applied migration version: `20260925094049`
- name: `customer_intelligence_events_v1`
- application result: success

### Why Phase 2.7 exists

`guest_memory` remains the per-guest personalization source of truth.

`customer_intelligence_events` is a separate aggregate event log for future owner intelligence such as:
- repeated customer phrases
- normalized demand signals
- risks / constraints seen across customers
- category/domain trends over time
- distinct-guest counts

It is not a second customer memory system and is never required for a customer-facing response.

### Storage / privacy design

Table:
- `public.customer_intelligence_events`

Stored fields:
- normalized `event_type`
- normalized `category`
- normalized `domain`
- nullable canonical `guest_id`
- normalized `channel`
- one-way `source_event_key`
- short `redacted_example` (1–80 chars)
- `created_at`

The raw LINE/web transport event id is never stored.

Before storage, common direct identifiers are deterministically redacted from examples:
- URL -> `[url]`
- email -> `[email]`
- phone -> `[phone]`
- @handle -> `[handle]`

The dashboard phase should prefer normalized category/domain fields and only show snippets where genuinely useful.

### Retry/idempotency hardening

A production-relevant gap was found before enabling the table:

`askThongthaiReliably` can re-enter the canonical core with the SAME LINE `message.id` after a transient failure. Without event-level idempotency, one real customer turn could inflate aggregate counts.

Test-first RED proof:
- commit: `50032b37486b4338fdcad4f99a029841b0fec108`
- GitHub Actions run: `36119340783`
- failure: same signed LINE message produced **2** aggregate rows instead of 1

Fix:
- canonical core establishes one stable transport event id before intelligence capture
- writer stores SHA-256(`channel:eventId`) as `source_event_key`
- table unique constraint:
  `(source_event_key, event_type, category, domain)`
- PostgREST uses:
  `Prefer: resolution=ignore-duplicates,return=minimal`

This still allows one customer turn to produce multiple DIFFERENT normalized signals, while duplicate transport retries cannot inflate the same signal.

### Database security verification

RLS: **enabled**

Privileges verified after migration:
- anon SELECT: false
- anon INSERT: false
- authenticated SELECT: false
- authenticated INSERT: false
- service_role SELECT: true
- service_role INSERT: true
- service_role UPDATE: false
- service_role DELETE: false

This matches the append-log design: customer-facing clients cannot query the table; server-side writer/future dashboard may insert/read but not rewrite history.

Security advisor:
- only the expected INFO `RLS enabled no policy` finding for this server-only table
- no new security warning/error caused by Phase 2.7

Performance advisor:
- new indexes are reported as unused while the table has zero rows, expected immediately after creation

### Database structural verification

Verified in production:
- FK `guest_id -> guests(id) ON DELETE SET NULL`
- event type CHECK
- domain CHECK
- channel CHECK
- 64-char lowercase hex source-event-key CHECK
- redacted example length CHECK
- unique source-signal constraint
- created-at trend index
- normalized signal trend index
- guest/time partial index

A duplicate-insert verification was executed transactionally and rolled back. No synthetic verification row remains in production.

### Application tests

Final branch CI before this checkpoint:
- code head before docs update: `31c9d4d306fc531bd560087394cf465271ecd2b7`
- GitHub Actions run: `36119651600`
- result: **1074 / 1074 PASS**

New load-bearing coverage includes:
- same signed LINE message id cannot create two accepted aggregate rows
- stored source key is a SHA-256 hex value, never raw LINE message id
- phone/email/url are removed from stored examples
- all prior Phase 2 customer-memory / safety / authority regressions remain green

### Production closure

PR #93:
- merged to `main`
- merge commit: `44c783ada37d24886b781a5ae1969590495f3f26`

Final PR CI:
- GitHub Actions run: `36119978651`
- result: **1074 / 1074 PASS**

Automatic Netlify production deploy:
- deploy id: `6ab642971b58030008356c13`
- state: **READY**
- context: `production`
- `commit_ref`: `44c783ada37d24886b781a5ae1969590495f3f26`
- `manual_deploy=false`

Phase 2.7 is therefore **DONE**.

Phase 3 — Owner Dashboard / Customer Voice OS remains **NOT STARTED** at this checkpoint.


---

## Phase 2.7 Production Smoke Fix — Missing no_shrimp aggregate signal — 2026-09-25

**STATUS: CODE FIXED; CI GREEN; PENDING PR #95 MERGE + PRODUCTION RETEST.**

Owner production smoke sent:

`ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง`

The customer-facing reply was correct, but production `customer_intelligence_events` contained only:

- `low_spice`
- `no_chicken`

and omitted `no_shrimp`.

This exposed an aggregate-classifier completeness gap: durable guest memory already stored `no_shrimp`, but `extractIntelligenceSignals` had no matching aggregate phrase signal.

### Test-first proof

Test-only commit:
- `7a74b2294ed6b241cefa2c11e5d86b6449c010a1`

GitHub Actions run:
- `36127769668`

Exact failure:
- `durable no_shrimp must also be represented in aggregate intelligence`

### Fix

`extractIntelligenceSignals` now emits:

```ts
{ eventType: 'phrase', category: 'no_shrimp', domain: 'restaurant' }
```

for plain avoidance:
- `ไม่กินกุ้ง`
- `ไม่เอากุ้ง`
- `งดกุ้ง`

while continuing to keep `แพ้กุ้ง` as the separate risk signal `shrimp_allergy`.

This keeps aggregate customer intelligence aligned with the existing durable preference vocabulary instead of introducing a new parallel concept.

### Verification

Fix commit:
- `f953a3e35305b8176b6b95c4b3e1cfa522c240e9`

GitHub Actions run:
- `36127886662`

Result:
- **1075 / 1075 PASS**

Production retest required after deployment:
- resend `ไม่กินเผ็ด ไม่กินไก่ ไม่กินกุ้ง`
- verify the new transport turn creates all three aggregate categories:
  - `low_spice`
  - `no_chicken`
  - `no_shrimp`

Do not start Phase 3 until this production retest passes.


---

## Phase 2.7 Production Privacy Fix — Direct identifiers in feedback events — 2026-09-25

**STATUS: CODE FIXED; CI GREEN; PENDING PR #96 MERGE + PRODUCTION RETEST.**

Owner privacy smoke sent a synthetic safety message containing:
- phone
- email
- external URL

The aggregate `customer_intelligence_events` write succeeded, but the owner LINE notification visibly exposed all three direct identifiers because `ops_feedback_events.customer_message` and `summary` still stored the raw customer text.

### Test-first proof

Test-only commit:
- `275463f6af8d7db9d71c032754bb2e32bc112307`

GitHub Actions run:
- `36128872803`

Exact failure:
- stored `customer_message` and `summary` still contained the raw phone/email/url

### Fix

New shared helper:
- `netlify/functions/_direct-identifier-redaction.ts`

Before operational feedback is persisted, deterministic direct identifiers are replaced:
- URL -> `[url]`
- email -> `[email]`
- phone -> `[phone]`
- @handle -> `[handle]`

Because staff LINE notifications read the persisted feedback event, the same redacted text now flows to:
- `ops_feedback_events.customer_message`
- `ops_feedback_events.summary`
- owner/activity/team LINE notification bodies
- future backoffice reads of newly-created events

The aggregate intelligence writer now reuses the same helper to avoid privacy logic drifting across subsystems.

### Verification

Implementation head:
- `d93e66222cbe8e6993c920bd72bacd42cfa050b6`

GitHub Actions run:
- `36129003394`

Result:
- **1076 / 1076 PASS**

The load-bearing regression requires both stored feedback and the actual captured LINE push payload to contain `[phone]`, `[email]`, `[url]` and none of the raw synthetic identifiers.

No historical production rows were rewritten by this code fix.
No Phase 3 work started.


---

## Phase 3 Customer Voice Runtime Incident — Feedback internal_notes contract — 2026-09-25

**STATUS: ROOT CAUSE PROVEN; BACKOFFICE FIX LIVE; CUSTOMER WRITER FIX GREEN ON PR #97, PENDING MERGE / AUTO DEPLOY.**

This incident was discovered from the owner's real iPhone production behavior on the Backoffice Customer Voice page: feedback cards rendered, but tapping the newest rows did not open detail.

### Production root cause

Read-only inspection of live `public.ops_feedback_events` in `tamma-customer-data` proved:

- 23 live feedback rows total
- 13 rows had `internal_notes` as a JSON object
- 10 rows had `internal_notes` as the intended JSON array
- the 12 newest live rows were all object-shaped
- every object-shaped row contained the routing-only key `notification_targets`

The Backoffice detail renderer treated `internal_notes` as the documented owner/staff-note array and called `.map(...)`. Object-shaped rows therefore threw before the detail dialog could open.

The writer-side source was this Service Mind path: after `notifyFeedbackEventTargets()`, `_service-mind-feedback-events.ts` PATCHed:

```ts
internal_notes: { notification_targets: targets }
```

That reused the staff-notes column for routing metadata and violated the schema contract.

No production feedback row was rewritten or deleted while diagnosing this incident.

### Backoffice side

The Backoffice fix was completed independently in `snkpcn/tamma-backoffice` PR #19 and is already live:

- merged Backoffice commit: `85dfdcff077c4d09c98e0baccb4956498cd819a1`
- automatic Netlify production deploy: `6ab67850eb9a11000823e071`
- deploy state: READY
- `manual_deploy=false`

Backoffice now normalizes legacy `internal_notes` at the read boundary and opens detail from a canonical by-ID read rather than an in-memory subset.

### Customer writer RED proof

Branch:
- `fix/feedback-internal-notes-contract-20260925`

The canonical test harness was first corrected to model the actual DB default:

```ts
internal_notes: []
```

A new Service Mind end-to-end regression then creates a real feedback event, runs notification routing, and requires `internal_notes` to remain the staff-note array.

RED head:
- `e80aa312360c8edf381d2296264c927bb381092f`

GitHub Actions:
- run `36141977762`
- **1076 PASS / 1 FAIL**

Exact failing assertion:
- `internal_notes must remain the staff-note array contract after notification routing`

### Writer fix

`_service-mind-feedback-events.ts` no longer writes per-target notification results into `internal_notes`.

It now PATCHes only the feedback row's scalar `notification_status`.

Per-target provider delivery evidence remains where it belongs:
- `ops_notification_deliveries`
- actual LINE push attempts
- the immediate `notifyFeedbackEventTargets()` result used to compose the customer-facing response

`internal_notes` is reserved exclusively for owner/staff notes.

### Test-contract repair

Several older routing tests were coupled to the production-breaking implementation by reading:

`ops_feedback_events.internal_notes.notification_targets`

Those tests were migrated to stronger operational evidence instead of restoring the bad write:

- final `ops_notification_deliveries` state
- actual LINE push targets/counts
- the feedback row's primary `notification_status`
- customer-facing wording for partial failure / not-bound states

The harness now exposes final notification delivery ledger state joined back to its bound team for this purpose.

Not-bound and same-physical-target duplicate cases intentionally have no provider delivery row because no provider send was attempted; tests prove those states using absence of a delivery/push plus the canonical response/status.

### GREEN proof

Current code/test head before this docs update:
- `7204c45179e330813dd16819c00876d8c8831dc2`

GitHub Actions:
- run `36142683629`
- **1077 / 1077 PASS**

No database migration is part of this writer fix.
No production data rewrite is part of this writer fix.
Do not mark Customer Voice Checkpoint 3 closed until the owner performs the single production detail-open smoke and then one complete normal workflow smoke.


---

## Phase 3 — Owner Intelligence Capture Closeout — 2026-09-25

**STATUS: SOURCE CAPTURE + ACTUAL BOT QUALITY IMPLEMENTED; CI GREEN; PR #98 PENDING FINAL DOCS CI / MERGE / AUTO DEPLOY.**

### Checkpoint 3 production workflow is CLOSED

Owner completed the single production iPhone workflow smoke on feedback event:

`f38293ea-21e0-4dba-9817-ab8a42692774`

Production DB verification immediately after the smoke:
- final status: `closed`
- assigned_to: `owner test`
- acknowledged_at present
- assigned_at present
- resolved_at present
- closed_at present
- audit sequence in `backoffice_activity`:
  1. `acknowledged`
  2. `assigned`
  3. `started`
  4. `resolved`
  5. `closed`
- no false workflow 400 observed
- owner screenshot showed canonical closed state and correct assignee on iPhone

The tested historical row still physically contains the old object-shaped `internal_notes.notification_targets`, by design: historical production data was not rewritten. Backoffice read-boundary normalization hides that legacy routing metadata from the staff-note contract, and the writer fix in PR #97 prevents new rows from creating that shape.

Checkpoint 3 is therefore **CLOSED**.

### Remaining Phase 3 capture taxonomy

The existing append-only `customer_intelligence_events` table is reused. No new DB, repo, site, or parallel memory system was created.

Normalized common intents now include:
- `intent_restaurant_recommendation`
- `intent_cafe`
- `intent_horse`
- `intent_atv`
- `intent_archery`
- `intent_homestay`
- `intent_location`
- `intent_weather`
- `intent_refund`
- `intent_complaint`
- `intent_safety`
- `intent_booking`
- `intent_pricing`
- `intent_availability`

Food/activity interest signals include:
- cafe / horse / ATV / archery / homestay
- dish interest (larb / somtam / namtok / grilled pork neck)
- protein interest (pork / chicken / beef / fish)
- Isan-food interest

Negative dietary constraints never inflate positive protein demand.

Group patterns include:
- solo
- couple
- family
- family with children
- elderly companion
- friends
- corporate/group

Where the same concept belongs in durable customer memory, the existing GuestContext / guest_memory vocabulary is reused:
- solo / friends / group traveler type
- child_friendly
- beginner_friendly
- rain_sensitive
- existing family/couple and other constraint keys

Additional aggregate constraint signals:
- children_present
- beginner
- weather_sensitive
- existing low-spice/protein avoidance/allergy/mobility/fear/low-intensity/chill signals remain intact

### Actual post-response Bot Quality

New module:
- `netlify/functions/_bot-quality-intelligence.ts`

The evaluator runs from the canonical `processThongthaiChatCore` response boundary, so signals describe the actual customer message + actual assistant response, not only keywords in the customer's complaint.

Signals:
- `bot_quality_clarification_failure`
- `bot_quality_wrong_domain`
- `bot_quality_repeated_answer`
- `bot_quality_stale_context_hijack`
- `bot_quality_unsupported_claim`
- `bot_quality_authority_boundary_failure`
- `bot_quality_safety_handling`
- `bot_quality_successful_recovery`

All are written best-effort into the existing aggregate event pipeline using the same one-way source-event key/idempotency contract.

A canonical runtime regression proves a real safety turn persists `bot_quality_safety_handling` after the response is composed.

### RED / GREEN proof

RED head:
- `1c8076a9ed5650cf81dc81424ddd02be41b9137e`
- GitHub Actions run `36143993154`
- failures covered all four missing groups: common intents, interests/groups, constraints, Bot Quality

Implementation had one vocabulary-only follow-up:
- natural phrase `ขอแบบไม่โหด` was not in the existing low-intensity marker
- fixed without broadening unrelated routing

Current implementation head before this docs update:
- `e35fc64d94cccef7e47b91027f42a7dc45ab42ca`
- GitHub Actions run `36144475655`
- **1082 / 1082 PASS**

### Still required before Phase 3 is complete

Backoffice must aggregate and visibly surface:
- Common Intents
- Food / Activity Interests
- Group Patterns
- expanded Constraints
- actual Bot Quality signals above

Then production deploy/status must be verified. No extra owner click test is required for aggregate sections unless production behavior contradicts CI/runtime evidence.


---

## Phase 4 — All-domain Hospitality Playbook — Checkpoint 1 — 2026-09-25

**STATUS: ALL-DOMAIN HOST ENTRYPOINT + GROUNDED CAFE BOUNDARY GREEN; PR #99 PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

### Scope closed in this checkpoint

This checkpoint does NOT replace the existing domain responders. It adds one acceptance gate over the canonical `processThongthaiChatCore` entry point and closes the documented ecosystem-entry gap.

Covered through one canonical hospitality matrix:
- restaurant
- cafe
- horse
- ATV
- archery
- homestay
- location
- weather
- safety
- complaint
- compliment
- refund / payment authority boundary
- booking support

### Bare recommendation gap

Before this checkpoint, a truly bare:

`มีอะไรแนะนำ`

with no remembered mobility context could still fall through to One-Mind / model fallback.

It is now handled deterministically by the ecosystem host:
- สายชิล — คาเฟ่ + ถ่ายรูป + อาหาร
- สายกิจกรรม — ขี่ม้า / ATV / ยิงธนู
- สายพัก — เฮือนสเตย์ + ธรรมชาติ
- one useful follow-up asks party size and whether the guest wants chill vs activity

The existing privacy-safe personalization behavior remains:
- limited-walking memory still gets the low-walking branch
- food-constraint context is not stolen from the restaurant advisor

The regression requires `modelCallCount() === 0` for the bare host opener.

### Cafe grounding incident caught by full CI

An initial Phase 4 attempt incorrectly treated synthetic harness `world_facts` rows as verified cafe production facts and produced:
- latte price: 65 THB
- cafe hours: 07:00–18:00

Full regression CI correctly failed the existing no-hallucination / LINE-Web-equivalence suites.

Read-only production DB inspection then proved:
- `public.world_facts` has the expected verified/active schema
- **there are currently zero production rows where category='cafe'**

Therefore:
- the speculative cafe adapter / new world-facts reader was removed from this PR
- cafe price/menu/hours remain an explicit information boundary
- cafe questions are preserved across the One-Mind cutover so the model cannot invent an answer
- the deterministic cafe response says the data is not verified and offers useful ecosystem next steps
- no synthetic 65-THB / 07:00–18:00 fact can reach customers

No production DB mutation was performed.

### All-domain acceptance contract

New test:
- `tests/phase4-all-domain-hospitality.test.ts`

It proves the canonical core:
- returns HTTP 200
- avoids generic failure wording
- stays relevant to the requested domain
- keeps location grounded on the canonical Maps link
- uses weather provider data for weather
- preserves safety / complaint / compliment / refund boundaries
- keeps booking support in the booking domain
- keeps cafe helpful without inventing operational facts

### RED / GREEN evidence

Earlier Phase 4 head:
- `0451225831cc6dc85fd8267c4794f31a132b228f`
- GitHub Actions run `36146842025`
- failed because synthetic cafe fixtures leaked as customer facts and one acceptance assertion did not match the real Maps-link contract

Corrected grounded head:
- `e01fe8546a562f1ccef0712377e6b86e77b05116`
- GitHub Actions run `36154114723`
- **1085 / 1085 PASS**

### Next Phase 4 checkpoint

After this PR is merged and production deploy is verified:
- audit domain handoff continuity as a host, especially cross-domain switching and follow-up questions
- keep existing explicit transaction precedence
- do not add facts without a verified source
- only then mark the whole Phase 4 complete


---

## Phase 4 — All-domain Hospitality Playbook — Checkpoint 2 — 2026-09-25

**STATUS: STATEFUL HOSPITALITY CONTINUITY GREEN; PR #100 PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY. PHASE 4 CLOSES AFTER PRODUCTION DEPLOY VERIFICATION.**

Checkpoint 1 established the all-domain canonical acceptance gate and the deterministic bare `มีอะไรแนะนำ` host opener.

Checkpoint 2 tests the harder requirement: the SAME guest must be able to move naturally between the ecosystem host and specific domains without stale pending state hijacking the new intent.

### RED findings

New stateful regression:
- `tests/phase4-hospitality-continuity.test.ts`

RED commit:
- `bd91365b435a5c1118ec86c07a5f86187e93370a`

GitHub Actions run:
- `36154641603`

Three real continuity gaps were reproduced:

1. Broad opener → `สายกิจกรรม`
   - the old general-recommendation pending choices reused the **low-walking** `light_activity` branch
   - response omitted ATV and incorrectly framed the guest as wanting only gentle activity

2. Broad opener → `สายพัก`
   - the advertised 3-path host prompt had no actual `สายพัก` choice contract
   - the follow-up fell to a generic no-verified-info failure

3. Broad opener → `คาเฟ่มีลาเต้ไหม`
   - the stale general pending question matched the word `คาเฟ่`
   - it swallowed the customer's specific cafe fact question instead of yielding to the grounded cafe information boundary

The same RED suite proved these were NOT global precedence failures:
- complaint still preempted the pending host question
- refund/authority boundary still preempted it
- explicit location, weather and booking switches still won

### Fix

A separate pending-question contract now represents the actual advertised ecosystem paths:

- `ecosystem_chill`
- `ecosystem_activity`
- `ecosystem_stay`

It is distinct from `ECOSYSTEM_FOCUS_PENDING_QUESTION`, which remains dedicated to the personalized low-walking prompt:
- restaurant
- cafe
- light activity

This prevents the general host from silently inheriting mobility-mode semantics.

General ecosystem continuations now behave as follows:

- **สายชิล**
  - cafe + photo + food framing
  - asks party size / available time
  - no cafe menu/price/hours invention

- **สายกิจกรรม**
  - preserves the full verified category set: horse / ATV / archery
  - asks which activity to explore
  - does not create a booking merely because the guest chose the path

- **สายพัก**
  - stays at the verified homestay + nature level
  - asks party size / number of nights
  - explicitly does not claim live room availability

The generic first-visit 3-path opener now persists the same path-choice contract, so its own follow-up is meaningful across channels that do not transport chat history.

### Specific-domain override

While a general ecosystem preference question is pending, a **specific cafe fact inquiry** such as:

`คาเฟ่มีลาเต้ไหม`

now clears the stale general pending question and reaches the deterministic cafe boundary.

It therefore remains honest:
- no fake menu
- no fake price
- no fake hours
- no model needed to answer the known information boundary

Bare path choices are still handled as path choices; only a structurally specific cafe fact inquiry overrides the prompt.

### GREEN evidence

Implementation commit:
- `0dcef2f966f6c67052e806b62de7a570cc9ff1b5`

GitHub Actions run:
- `36154865495`
- **1090 / 1090 PASS**

No DB/schema/site changes.
No production transaction.
No manual Netlify deploy.

### Phase 4 definition after this checkpoint

Once PR #100 is merged and its automatic production deploy is verified:
- all required Phase 4 domains have canonical acceptance coverage
- broad host entry is deterministic
- stateful path selection is coherent
- explicit new-domain intent wins over stale host state
- complaint/refund/safety authority precedence remains intact
- cafe remains grounded to the actual production source boundary

At that point **Phase 4 is CLOSED** and the roadmap proceeds to **Phase 5 — Learning Loop / Bot Lessons**.


---

## Phase 6 — Customer Personalization — 2026-09-25

**STATUS: DURABLE PERSONALIZATION GREEN; PR #101 PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

Phase 6 reuses the existing `guest_memory` / `journeyContext` foundation. No parallel profile store was added.

### RED findings

Stateful regression:
- `tests/phase6-customer-personalization.test.ts`

RED commit:
- `acb1172060d840f56489470b3739247560601768`

GitHub Actions run:
- `36159604057`

Existing memory already persisted many useful signals, but several were merely loaded and then ignored by deterministic host responses.

RED reproduced five real gaps:

1. child/family memory persisted but did not shape a later broad recommendation
2. relaxed pace persisted but did not shape a later broad recommendation
3. beginner/fear memory persisted but a later horse turn still re-asked whether the guest had ever ridden
4. couple/group context persisted but broad host wording ignored it
5. favorites / visited experiences rehydrated into `journeyContext` but were never read by the canonical core

The same RED suite also proved two safety properties already worked:
- `preferred_language` is durable through the existing customer-memory endpoint
- a current explicit new intent (e.g. location) wins over stale personalization state

### Implementation

Broad ecosystem recommendations now add **soft, conditional hints** from durable memory:

- child/family
  - emphasizes unhurried pacing and team assessment for activities
  - never makes a safety guarantee

- relaxed pace
  - prioritizes cafe / food / stay as the initial planning spine
  - activities remain optional instead of being silently removed

- couple
  - may suggest cafe / dining / sunset framing

- favorites
  - canonical experience IDs are mapped through the existing `EXPERIENCES` catalog
  - wording is conditional: “ถ้ายังชอบ ... อยู่”
  - no claim that an old preference is permanently true

- visited experiences
  - can be used as an optional avoid-repeat hint
  - wording is conditional: “ถ้าอยากไม่ซ้ำ...”
  - previously visited places are not permanently excluded

No raw chat text is stored for this personalization.

### Activity care memory

`deterministicActivityIntentStartResponse()` now uses durable constraints when the current message does not already supply a stronger qualifier:

precedence:
1. explicit current-turn qualifier
2. remembered `beginner_friendly`
3. remembered fear-of-falling / fear-of-speed → cautious branch
4. remembered child / elderly companion context
5. generic horse-start branch

This prevents the assistant from asking “เคยขี่ม้ามาก่อนไหม” again when durable memory already says the guest is a beginner.

The new cautious branch says the guest can start slowly and be assisted during mounting/dismounting; it never guarantees safety.

### Stale-context rule

Durable memory only shapes **how** a compatible response is composed.

It does not select a different domain over an explicit current request.

The Phase 6 regression explicitly proves a stored chill/couple preference cannot hijack a later location request.

### Favorites / visited / language

Existing durable storage remains authoritative:
- `favorites`
- `visited_experiences`
- `preferred_language`

Phase 6 adds actual canonical-host use for favorites/visited.

Language behavior keeps the safer rule:
- stored preferred language remains durable
- the current request language wins when explicit, so stale language cannot override a new-language turn

### GREEN evidence

Implementation head before this docs update:
- `37fd15afc9c378ab28cc590f61770413fa842e1a`

GitHub Actions:
- run `36159835028`
- **1097 / 1097 PASS**

No DB/schema/site change.
No production customer transaction.
No manual Netlify deploy.

After merge + exact automatic production deploy verification:
**Phase 6 is CLOSED** and the roadmap proceeds to **Phase 7 — Production E2E Smoke Matrix**.


---

## Phase 7 — Production E2E Smoke Matrix — 2026-09-25

**STATUS: REAL-CHANNEL MATRIX GREEN; PR #102 PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

This phase deliberately avoids creating another production booking/order/workflow transaction.

There is no authenticated Cloud Browser available in the current execution environment, so this phase does **not** claim an automated authenticated browser smoke that was not actually run.

Instead it combines:
1. real signed LINE webhook integration through the production handler code path,
2. canonical durable state / DB harness behavior,
3. read-only production DB verification,
4. owner-proven iPhone Backoffice workflow evidence from Phase 3,
5. exact current Netlify deployment verification.

### Real LINE channel matrix

New test:
- `tests/phase7-production-e2e-matrix.test.ts`

Every LINE turn is a separate signed webhook delivery. The LINE transport itself provides no chat history, so continuity in these tests comes from the same persisted server-side mechanisms production LINE depends on.

The matrix proves:

1. **LINE chatHistory-free durable memory**
   - turn 1: `ไม่กินไก่ ไม่กินกุ้ง`
   - turn 2: `ร้านอาหารมีอะไรแนะนำ`
   - durable constraints contain `no_chicken` + `no_shrimp`
   - only eligible menu item lines are recommended

2. **Contextual follow-up**
   - `มีอะไรแนะนำ`
   - later webhook: `สายกิจกรรม`
   - response preserves horse / ATV / archery
   - discovery creates no booking transaction

3. **Horse + exact asset selection + cross-domain protection**
   - `อยากขี่ม้า`
   - `เอาภาราดร`
   - selection remains **ภาราดร**, never silently changes to ทองไทย
   - later location and weather questions override stale horse state
   - no old horse missing-field prompt leaks into those answers

4. **ATV safety + escalation + owner notification**
   - activity + owner_general channels are bound in the real notification harness
   - safety message creates exactly one `ops_feedback_events` case
   - business unit = activity
   - both activity and owner deliveries are recorded `sent`
   - one LINE push goes to each target
   - response does not fall into a booking-duration prompt

5. **Refund / payment authority boundary**
   - owner_general is bound
   - no refund approval/guarantee is invented
   - owner escalation case is created
   - owner delivery is `sent`

6. **Durable personalization + explicit-current-intent precedence**
   - prior chill/couple context shapes a later broad recommendation
   - a later explicit location request still wins completely
   - personalization cannot hijack the new domain

### RED / test correction

Initial matrix head:
- `b2a490e449333b5490be5878318ec9fb3e13c9d0`
- GitHub Actions run `36160597599`

Only one assertion failed, and inspection proved the product behavior was correct:
- response acknowledged “เลี่ยงกุ้ง/ไก่”
- the only recommended item was `ข้าวผัดหมู`

The test had incorrectly banned the word “ไก่” from the **entire reply**, so it rejected the assistant's correct explanation of the remembered constraint.

The load-bearing assertion was corrected to inspect only menu-item bullet lines for forbidden ingredients.

Corrected head:
- `7fae692196626b7ffa81c9c0f40c8472763230ec`
- GitHub Actions run `36160773852`
- **1103 / 1103 PASS**

No product code was weakened to satisfy this assertion.

### Production Backoffice evidence (read-only)

The owner already performed the one requested real iPhone production workflow smoke on feedback:

`f38293ea-21e0-4dba-9817-ab8a42692774`

Current read-only production DB verification still shows:
- status = `closed`
- assigned_to = `owner test`
- acknowledged_at / assigned_at / resolved_at / closed_at all present
- false_alarm = false
- training_signal = false

Current audit history still contains, in order:
- acknowledged
- assigned
- started
- resolved
- closed

This reuses the already-proven production workflow instead of creating another test mutation.

Backoffice current production remains:
- deploy `6ab6984be2cdef0008a085b0`
- READY
- Phase 5 main commit `00b9acdc386f1d24609faf67a8f0bc00ccd1bce5`

### Customer production before this PR

Current customer production before Phase 7 merge:
- deploy `6ab69f6472352c0008b8f38a`
- READY
- commit `ba3fff45c7d8f9ba70691d6e5deb7cf8f22ca063`
- automatic deploy

### Phase 7 closure rule

After PR #102 docs-inclusive CI is green, merged, and the automatic Netlify production deploy is verified at the exact merge commit:

**Phase 7 is CLOSED.**

The remaining roadmap phase is:
- **Phase 8 — Operational Polish**


---

## Phase 8 — Operational Polish — Customer Runtime — 2026-09-25

**STATUS: CUSTOMER-SIDE OPERATIONAL POLISH GREEN; PRODUCTION IDEMPOTENCY MIGRATION APPLIED; PR #103 PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

This checkpoint closes two concrete operational risks found after Phase 7.

### 1. Production-false cafe fixtures removed

The canonical harness still contained synthetic cafe rows:
- `cafe_hours = 07:00-18:00`
- `cafe_latte_price = 65`

Production read-only verification in Phase 4 proved `public.world_facts` currently has **zero cafe rows**.

Those fixtures are now removed from the default canonical harness so a future test cannot accidentally mistake synthetic data for a production source of truth.

Existing tests can still inject explicit catalog overrides when a test truly needs synthetic source data.

### 2. Customer Voice feedback creation is transport-idempotent

A RED operational test replayed the exact same signed LINE safety event twice with the same `message.id`.

Before the fix:
- first delivery created `feedback-event-1`
- redelivery created `feedback-event-2`
- this violated LINE retry-safety expectations and could duplicate owner work

The canonical core already has one stable `transportEventId` per turn:
- LINE: `message.id`
- web: supplied event/request id when available
- fallback: one generated id per core invocation

Phase 8 now threads that exact key into Customer Voice creation as `source_event_key`.

### Database contract

Additive migration:
- repo file: `supabase/migrations/20260925163800_ops_feedback_source_event_key_v1.sql`
- production migration name: `ops_feedback_source_event_key_v1`

Production schema now has:
- `ops_feedback_events.source_event_key text NULL`
- unique index `ops_feedback_events_source_event_key_uq`

Historical rows remain NULL and were not rewritten.

RLS / grants were not broadened.

The migration was applied **before** the customer code is merged/deployed, preventing a schema/code mismatch window.

### Runtime behavior

For a source event key:
1. insert uses PostgREST `on_conflict=source_event_key` + `resolution=ignore-duplicates`
2. first delivery creates the Customer Voice case normally
3. retry/redelivery receives an empty insert result
4. code re-reads the original feedback case by `source_event_key`
5. notification dispatch runs against the original case id
6. the existing `ops_notification_deliveries` ledger returns duplicate rather than sending another LINE push

Therefore a redelivered safety report:
- creates one feedback case
- creates one activity push
- creates one owner push
- can safely reuse the original operational case

Customer-intelligence events keep their existing separate unique source-event contract and are also regression-tested for retry dedupe.

### RED / GREEN evidence

RED head:
- `81beaf7369c0788b1ebe405ca5f23a25c67ea170`
- GitHub Actions run `36161627067`

RED reproduced:
- synthetic cafe fixtures present
- duplicate LINE safety message creates a second feedback case

GREEN implementation head:
- `4e0a3ab59e4f4104ebe1ec8a89e6ea343dd5edd6`
- GitHub Actions run `36161871691`
- **1106 / 1106 PASS**

No production feedback row was modified or deleted.
No production test booking/order was created.

After PR #103 merge + exact automatic Netlify deploy verification, customer-side Phase 8 polish is closed.
The remaining Phase 8 checkpoint is Backoffice mobile mutation locking / final documentation.


---

## THONGTHAI HUMAN BRAIN — Phase 1 / Checkpoint 1 — Semantic Arbitration — 2026-09-26

**STATUS: CODE + CANONICAL ENTRYPOINT GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY / OWNER LIVE LANGUAGE SMOKE.**

### Goal

Upgrade the existing mature Thongthai system instead of replacing it.

Human Brain doctrine:
- LLM semantic understanding reads whole-sentence meaning where legacy routing is too coarse
- proven deterministic business/dialog behavior remains in place
- booking/order/payment/safety execution authority is NOT handed to the model
- weak model output and provider outage fall back to the mature deterministic system
- no phrase-by-phrase language patching

### Real owner failure used as the RED case

Production LINE utterance:

`ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ`

The guest already had durable restaurant dietary memory:
- no chicken
- no shrimp
- no spicy

Production incorrectly returned food recommendations.

Root cause was proven at TWO layers.

#### RED 1 — One-Mind semantic ownership

RED commit:
- `0b43219e3f533c3c7f7c78ae9e8403b8e1484901`

GitHub Actions:
- run `36165713206`

Exact finding:
- semantic model calls = **0**
- `deriveDeterministicSemanticTurn()` reduced the sentence to coarse `restaurant_topic_switch`
- the LLM semantic interpreter never saw the sentence
- active transactional slot-fill guard test remained green

#### Unsafe global LLM-first experiment rejected

A first implementation made all normal turns model-first:
- commit `dc884a8217be2860de8bf66167b41853a953a0e1`
- run `36165904378` = FAILURE

Full CI correctly exposed broad regressions in mature behavior:
- OTOP catalog
- membership
- cafe/stay switching
- activity inventory count
- provider-outage zero-cost paths
- multi-hop suspend/resume
- hospitality matrix

That approach was **not merged** and was replaced by semantic arbitration.

### Final architecture of Checkpoint 1

`resolveSemanticTurn()` is now an arbiter.

1. derive the mature deterministic candidate
2. if it is a proven precise path, keep it with zero LLM cost
3. if it is a deliberately coarse semantic class approved for refinement, ask the LLM semantic interpreter
4. accept model refinement only when:
   - domain != unknown
   - action != unknown
   - no clarification required
   - confidence >= 0.70
5. if model result is weak, reuse the deterministic candidate
6. if provider is unavailable, reuse the deterministic candidate
7. execution/tool policy remains downstream and deterministic

Checkpoint 1 intentionally refines only:
- task-free `restaurant_topic_switch`

It does NOT globally switch all domains to LLM-first.

This is a strangler upgrade: later Human Brain checkpoints may expand refinement ownership only after their own RED + full-CI proof.

### Customer-entrypoint ownership fix

A second RED test drove the real:
- `processThongthaiChatCore`
- durable dietary memory
- LINE channel
- exact owner sentence

RED commit:
- `a0337fb5b09b11b4f671a28f7438de55c1c849c7`
- run `36166713843`

It proved the semantic brain was still called **0 times** because the legacy pre-cutover guard used the broad:
- `isRestaurantAdvisorTurn(...)`

That function correctly detects restaurant scope for the legacy advisor, but was too broad to decide semantic ownership.

Final fix:
- legacy restaurant fast-path is reserved for its proven intent classes:
  - dietary declarations/corrections
  - explicit menu/recommendation requests
  - existing proven restaurant continuity
- merely mentioning the restaurant no longer blocks semantic interpretation of a richer question

No table/availability/date phrase was added as a runtime trigger for this fix.

### Whole-sentence semantic prompt

The existing LLM semantic interpreter doctrine was strengthened generically:

- domain nouns tell WHERE
- the predicate/question tells WHAT
- do not collapse availability/status/price/booking/etc. to generic discovery
- preserve explicit date/time/party-size/preferences
- current utterance outranks stale context/memory
- ordinary conversation should not be forced into a business trigger

### Thai semantic evaluation corpus

Added a four-paraphrase evaluation family:
- `restaurant_table_availability`

Includes:
- `ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ`
- `พรุ่งนี้หกโมงเย็นยังมีโต๊ะมั้ย`
- `เย็นพรุ่งนี้คนแน่นปะ ยังพอมีที่นั่งไหม`
- `พรุ่งนี้ 18:00 ไปกินข้าวได้ไหม โต๊ะว่างหรือเปล่า`

These are evaluation examples, **not runtime regex triggers**.

### Guard tests

Human Brain Phase 1 proves:
- exact owner sentence reaches semantic interpreter
- high-confidence specific meaning can refine coarse restaurant topic classification
- active transactional slot updates remain deterministic
- precise activity inventory semantics remain deterministic / zero-model
- low-confidence model output cannot overwrite the mature deterministic fallback
- canonical customer entrypoint with dietary memory cannot turn table availability into a menu recommendation

### GREEN evidence

Final implementation head before this docs update:
- `caf8ed7902ffde342ced09fee83808a30e2c1100`

GitHub Actions:
- run `36166944741`
- **1115 / 1115 PASS**

No DB/schema/site change.
No production customer transaction.
No manual Netlify deploy.

### Phase 1 remaining work

This checkpoint establishes safe semantic arbitration and fixes the first proven coarse-language class.

Phase 1 is not declared fully complete until:
- this PR is merged
- exact auto production deploy is READY
- owner live language smoke confirms the real production model handles the availability family
- additional coarse semantic classes are expanded only where Human Brain evaluation demonstrates a real need

Next Human Brain phase after Phase 1:
- Phase 2 — Conversation Brain (references, short follow-ups, interruption/topic switch, change-of-mind)


---

## THONGTHAI HUMAN BRAIN — Phase 1 / Checkpoint 1.1 LIVE ACCEPTED + Checkpoint 1.2 — Availability Contract — 2026-09-26

### Owner live acceptance for Checkpoint 1.1

Production LINE retest was performed by the owner in the SAME conversation that still had restaurant dietary memory.

Owner message:
`ที่ร้านอาหารพรุ่งนี้ตอน 18.00 โต๊ะเต็มรึยังคะ`

Production reply after PR #104 / main `625b88caf53130945215331bc3a44b188a55a537`:
`ข้อมูลส่วนนี้ยังไม่มีข้อมูลยืนยันครับ ทองไทยไม่ขอเดาให้ผิด`

Acceptance result:
- PASS: dietary memory did not hijack the turn
- PASS: no menu recommendation was emitted
- PASS: no invented table-availability claim
- PASS: current utterance won over stale restaurant preference context
- UX GAP FOUND: the final reply was too generic and dropped the already-understood date/time/table predicate

Checkpoint 1.1 semantic-ownership bug is therefore CLOSED by production evidence, while its downstream semantic-preservation UX gap became Checkpoint 1.2.

### Checkpoint 1.2 RED evidence

Branch:
`human-brain/phase1-2-restaurant-availability-20260926`

RED commit:
`0b0e01cfe1af309008cd43dec2316706792f8c82`

GitHub Actions:
run `36168043421` = FAILURE

Two exact RED failures:

1. Dialog/Knowledge contract:
- expected `needs: ['availability']`
- actual `needs: ['order_status']`

This proved that although the Semantic Interpreter understood
`restaurant_table_availability`, the Dialog Manager collapsed all
restaurant `action='status'` meanings into prior-order status.

2. Deterministic honest-degradation copy:
- expected reply to preserve `พรุ่งนี้`, `18:00`, and table/seat meaning
- actual:
  `ข้อมูลส่วนนี้ยังไม่มีข้อมูลยืนยันครับ ทองไทยไม่ขอเดาให้ผิด`

This proved semantic meaning was still being lost after interpretation.

### Checkpoint 1.2 implementation

No Thai runtime phrase trigger was added.

#### Dialog Manager
`restaurant_table_availability` now explicitly plans:
- domain: `restaurant`
- knowledge need: `availability`

Generic restaurant `status` remains `order_status` for existing-order inquiries.

Therefore the semantic INTENT, not the presence of words such as "โต๊ะ" or a time string, decides the knowledge contract.

#### Knowledge Resolver
The architecture now declares restaurant availability as a legitimate live source contract:
- `SOURCE_REGISTRY.availability` includes `restaurant_live`
- `KnowledgeSourceAdapters.restaurant.availability` is optional
- `(restaurant, availability)` routes only to that adapter
- it never calls `orderStatus.lookup`

There is intentionally no fabricated production availability adapter.
Until a real authoritative table-capacity source exists, the resolver returns
`no_source_registered` -> `fact_unknown`.

This is deliberate truth preservation, not an incomplete fake integration.

#### Response Composer
For the machine-classified `restaurant_table_availability` knowledge request,
`fact_unknown` / `source_unavailable` now preserves semantic entities.

Thai response shape:
`รับทราบครับ ถามเรื่องโต๊ะสำหรับพรุ่งนี้ เวลา 18:00 นะครับ ตอนนี้ทองไทยยังไม่มีข้อมูลโต๊ะว่างแบบสดที่ยืนยันได้ เลยยังบอกไม่ได้ว่าเต็มหรือว่าง และไม่ขอเดาให้ผิดครับ`

The copy:
- acknowledges what the customer actually asked
- preserves date/time supplied by SemanticTurn entities
- never claims live capacity without a source
- never converts the question into an order-status or menu reply

### Regression / guard coverage

New tests prove:
1. table availability plans `availability`, never `order_status`
2. no-source fallback preserves date/time/table meaning
3. a future registered `restaurant.availability` source is called exactly once
4. `orderStatus.lookup` remains zero calls for this intent
5. existing Phase 1.1 semantic arbitration tests continue to pass
6. all pre-existing transaction, dietary, OTOP, membership, activity, provider-outage and continuity regression tests remain in the full suite

No DB/schema change.
No production transaction.
No new site/repo/project.
No manual Netlify deploy.

### Human Brain principle locked by this checkpoint

**Meaning must survive every layer.**

It is not enough for the LLM to understand the sentence correctly if the
Dialog Manager, Knowledge Resolver, or Response Composer later collapses
that meaning into a broader legacy category.

The required chain is now:
`whole-sentence meaning -> precise semantic intent -> correct knowledge need -> truthful intent-preserving response`.



---

## THONGTHAI HUMAN BRAIN — Phase 2 / Checkpoint 2.1 — Conversation + Active Task Context — 2026-09-26

**STATUS: GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

### Goal

Make the semantic brain understand short human follow-ups from the real bounded conversation/task state already present in the system, without creating a second memory system and without replacing deterministic business execution.

This checkpoint targets the previously documented 16-turn gaps such as:
- `เวลาเดิมนะ`
- `ตอนนี้ที่เลือกไว้มีอะไรบ้าง`

### RED evidence

Branch:
`human-brain/phase2-conversation-context-20260926`

RED commit:
`34d8a08a26f96e2edac2021d3c915b4c0356df7a`

GitHub Actions:
run `36170205619` = FAILURE

Three exact RED failures proved:

1. Semantic brain did not receive bounded recent turns / active topic / rolling summary / active task values.
2. A model-identified prior task-slot reference could not resolve `time` from canonical task state, so `เวลาเดิมนะ` had no safe way to reuse the already-known value.
3. `summarize_active_task` was incorrectly treated like a normal activity `ask` and triggered catalog knowledge lookup instead of reading the task state already owned by the system.

### Implementation

#### Semantic context now receives existing bounded evidence

No new table, DB, or transcript store was created.

The existing `ConversationContextState` already stores bounded/redacted:
- recent turns
- rolling summary
- active domain/topic
- open question
- recent entities

`buildSemanticContext()` now exposes those same bounded fields to the Semantic Interpreter.

#### Privacy-safe task evidence

The orchestrator now adds a reduced semantic view of:
- active task
- suspended task
- task type/domain/status
- selected entities
- missing-field names
- task constraints
- customer-facing known slots only

Allowed task values include items such as:
- date
- time
- partySize
- durationMinutes
- quantity
- checkIn/checkOut
- horseName
- roomType
- seatPreference
- budget/activity/service descriptors

Contact/payment/internal routing values are NOT sent to the semantic prompt.

Direct regression proves:
- time/duration/entity are present
- phone is absent
- email is absent
- internal resourceCode is not customer-facing summary output

#### Canonical task-slot references

The model may identify a contextual reference with:
- `type: "task_slot"`
- `value: <exact safe slot key>`

Example semantic meaning:
- "same time" -> task_slot/time

The model names only WHAT prior field is referenced.
The deterministic validator then obtains the actual value from canonical active-task state.

The model does not invent/copy the old value itself.

A resolved task-slot reference is considered a valid resolved prior-context reference and does not force needless clarification.

#### Generic active-task summary

New first-class machine response:
- semantic intent: `summarize_active_task`
- response intent: `active_task_summary`

It:
- reads current task state
- makes zero catalog fetches
- never executes a transaction
- summarizes only customer-facing selections
- explicitly states that the details are still in progress / not a confirmed booking or submitted order

Example covered state:
- ภาราดร
- date
- 15:00
- 60 minutes
- 2 people

Phone/email/internal resource codes are never rendered.

### Human Brain prompt doctrine added

Conversation evidence is context, not execution authority.

Rules now explicitly cover:
- short follow-ups / ellipsis
- task-slot references such as same time/date/duration
- asking what has been selected/provided so far
- CURRENT utterance still outranks prior context

No runtime Thai phrase trigger was added for these examples.

### GREEN evidence

Implementation head before docs:
`e1f228e972ac7b08c0d6b29c17fcd3a88b3b28e5`

GitHub Actions:
run `36170627215`
**1121 / 1121 PASS**

No DB/schema change.
No production transaction.
No new repo/site/project.
No manual Netlify deploy.

### Next Phase 2 checkpoint

Checkpoint 2.2 will expand human conversational continuity to:
- pronouns/deictics: อันนั้น / ตัวเดิม / อันเมื่อกี้
- short elliptical follow-ups: พรุ่งนี้ล่ะ / แล้วอันนี้ล่ะ
- change-of-mind / interruption: ไม่เอาละ ไปกินข้าวก่อน
- safe topic resume without stale task hijack
- preserve current-turn precedence over all prior state


---

## THONGTHAI HUMAN BRAIN — Phase 2 / Checkpoint 2.2 — References + Compound Topic Changes — 2026-09-26

**STATUS: GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY.**

### Goal

Close the remaining Conversation Brain gaps without teaching Thai through business phrase triggers.

This checkpoint proves:
- singular prior-selection references use the item actually selected
- one utterance may both manage the old working conversation and express a new current intent
- working-task control remains completely separate from real transaction execution
- pure deterministic topic switches keep their mature zero-model path

### RED evidence

Branch:
`human-brain/phase2-2-reference-switch-20260926`

RED commit:
`4ade2bc8be1c4cf7906021e310a34c92ce31503b`

GitHub Actions:
run `36171337057` = FAILURE

Three RED failures proved:
1. `selected_entity` could widen to all recently seen catalog entities instead of resolving the one canonical item already selected.
2. A model-understood compound turn could identify a current restaurant intent but there was no policy for separately abandoning the old working task.
3. Dialog Manager ignored the proposed working-task directive.

### Semantic task directives

`SemanticTurn` now has optional:
- `cancel_active`
- `suspend_active`
- `resume_suspended`

These are **conversation working-state directives only**.

They:
- may transition/suspend/resume bounded `ActiveTask`
- do NOT call booking/order/payment executors
- do NOT cancel an operational booking/order
- do NOT grant transaction permission
- are ignored unless the semantic output validates against the closed directive union

The current turn's domain/action still proceeds independently.

Example semantics:
`ไม่เอาละ ไปกินข้าวก่อน`
can mean:
- close the old conversational activity task
- CURRENT intent = restaurant discovery

instead of forcing the utterance into only one of those meanings.

### Selected-entity reference resolution

When the semantic brain emits a prior-context reference:
- `type = selected_entity`

and canonical active task state has exactly one selected entity, the deterministic validator resolves the reference to that selected entity.

Thus a singular `ตัวเดิม / อันที่เลือกไว้` style reference cannot accidentally widen back to every catalog entity merely seen earlier.

### Dialog Manager working-state policy

Task directives are applied before ordinary domain transition logic.

Terminal tasks are no longer eligible as topic-transition owners.

After a `cancel_active` directive:
- working task remains terminal/cancelled as factual history
- it is NOT converted into a resumable suspended task
- the current turn still plans/answers its own domain
- terminal task state is not attached as a live task to the new knowledge request

### Coarse topic-switch arbitration without losing zero-cost paths

A broad global model-first change was already rejected in Phase 1.

Phase 2.2 therefore keeps pure deterministic switches zero-cost.

A cheap **clause-shape arbitration cue** may ask the semantic model to refine a coarse `restaurant_topic_switch` only when the utterance structurally looks multi-clause.

Important:
- this cue does NOT classify intent/action/domain
- it only decides whether the Language Brain should read the whole utterance
- the model still determines meaning
- low-confidence/provider outage falls back to the exact mature deterministic candidate

Regression:
- pure `ร้านมีไรกิน` keeps zero LLM calls
- compound `ไม่เอาละ ร้านมีอะไรกินก่อน` may be semantically refined

A remote-edit escaping defect briefly changed `\s` to literal `s`; full CI caught the guard failure and it was corrected before merge.

### GREEN evidence

Final implementation head before docs:
`153a9c63a35e6e2e0250794c9524d02f2ddcd3f3`

GitHub Actions:
run `36172318753`
**1125 / 1125 PASS**

No DB/schema change.
No operational transaction.
No new repo/site/project.
No manual Netlify deploy.

### Phase 2 status

After this PR merges and its exact auto production deploy is READY:

**Human Brain Phase 2 — Conversation Brain = CLOSED.**

Phase 3 next:
**Relevance & Memory Brain**
- memory may inform a current answer only when semantically relevant
- current utterance always outranks durable/stale memory
- build a relevance contract rather than domain-keyword hijacking


---

## THONGTHAI HUMAN BRAIN — Phase 1 / Checkpoint 1.3 — Closed Semantic Information Facets — 2026-09-26

**STATUS: REBASED ON CURRENT MAIN + FULL CI GREEN; PENDING MERGE / AUTO DEPLOY / LIVE TRACE.**

### Production evidence that drove this checkpoint

The owner's real LINE table-availability turn was inspected from the existing bounded `one_mind_traces` store.

The live semantic model returned:
- domain: `restaurant`
- intent: `table_availability_check`
- action: `status`
- confidenceBucket: `high`
- needsClarification: `false`

But downstream still degraded to `fact_unknown`.

Root cause:
Checkpoint 1.2 had machine routing coupled to one exact free-form intent label:
`restaurant_table_availability`

The real model used the equally-correct:
`table_availability_check`

Therefore the language brain understood the meaning, but the downstream machine contract was unstable.

### Architecture change

`SemanticTurn` now carries optional closed:
`informationNeed`

Allowed:
- none
- availability
- price
- schedule
- inventory
- catalog
- recommendation
- ingredients
- policy
- transaction_status

The model's free-form `intent` remains diagnostics/evaluation metadata only.

Restaurant knowledge routing now uses `informationNeed`:
- availability -> availability
- price -> price
- ingredients -> ingredients
- transaction_status -> order_status

Legacy deterministic turns without the new facet retain their previous compatibility behavior.

### Prompt + parser

The semantic prompt now requires the closed facet separately from intent.

The parser:
- accepts only the closed enum
- normalizes any invented/unknown value to `none`
- never turns arbitrary model text into a routing key

### Response composition

Restaurant availability fallback keys from the resolved:
- restaurant + availability knowledge need

It no longer requires an exact free-form intent label.

### Safe observability

`informationNeed` is included in the privacy-safe One-Mind trace envelope.

No raw customer transcript, raw model output, or chain-of-thought is added.

### Test evidence

Initial RED on PR #108:
- parser dropped informationNeed
- downstream still chose order_status
- unknown facet was not normalized

PR #108 then became non-mergeable only because Human Brain Phase 2.2 advanced `main` concurrently.

No force merge was used.

The same atomic changes were reapplied onto exact current main after Phase 2.2:
- rebased branch: `human-brain/phase1-3-semantic-facets-rebase-20260926`
- green head before docs: `9a5fd1bd21084d39c997de780d9c67c49905964d`
- GitHub Actions run `36172955163`
- **1128 / 1128 PASS**

This proves Phase 1.3 coexists with the completed Phase 2.2 conversation/reference work.

### Owner regression

The canonical owner test now deliberately uses:
- free-form intent: `table_availability_check`
- informationNeed: `availability`

and requires:
- no dietary/menu hijack
- reply still refers to table/seat
- reply preserves tomorrow
- reply preserves 18:00

### Next live verification

After merge + exact automatic production deploy:
1. owner sends one natural table-availability question
2. query the newest LINE One-Mind trace
3. require:
   - domain=restaurant
   - informationNeed=availability
   - confidence high/acceptable
   - knowledge need availability, never order_status
4. customer response must preserve the understood date/time/table meaning even when live table inventory is unconfigured

Only then close Checkpoint 1.3.

No DB/schema/site change.
No production transaction.
No manual Netlify deploy.


---

## THONGTHAI HUMAN BRAIN — Phase 3 — Relevance & Memory Brain — 2026-09-26

**STATUS: CORE + ORCHESTRATOR INTEGRATION GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY / LIVE TRACE.**

### Goal

Durable customer memory must help a response only AFTER the current utterance has been understood.

Human Brain ownership order is now:

`CURRENT UTTERANCE -> SEMANTIC TURN -> MEMORY RELEVANCE -> DIALOG / KNOWLEDGE / RESPONSE`

Never:

`MEMORY / KEYWORD -> CHOOSE INTENT`

This closes the original failure class where remembered food constraints could hijack a later restaurant table-availability question.

### RED evidence

Branch:
`human-brain/phase3-memory-relevance-20260926`

RED head:
`5e620fd475f581b80d0ca584cbf3ff967add8b0f`

GitHub Actions:
run `36174575188`

Expected RED failures proved that the new relevance contract did not yet select:
- restaurant dietary memory for food recommendation
- dietary safety memory for ingredient questions
- trip-style memory for ecosystem recommendations
- care/mobility memory for activity recommendations

The important negative controls were green from RED:
- restaurant availability ignored durable dietary/lifestyle memory
- operational/status-style questions ignored unrelated memory
- relevance planning did not mutate the SemanticTurn

### Memory relevance policy

New module:
`netlify/functions/_memory-relevance.ts`

It consumes only:
- an already-resolved `SemanticTurn`
- an already-normalized durable-memory snapshot

It cannot change:
- domain
- intent
- action
- informationNeed

#### Restaurant
Recommendation/catalog/ingredients may receive food-relevant constraints only:
- dietary restrictions
- food allergies
- spice preference
- authentic-Isan preference

Restaurant availability/status never receives those durable preferences.

#### Activity
Recommendation may receive care/mobility context only:
- limited walking / wheelchair
- elderly/child suitability
- beginner
- low intensity
- fear of falling / speed
- rain sensitivity / prior safety concern

Dietary memory is excluded.

#### Stay
Recommendation may receive bounded mobility/family/rest context.

#### Ecosystem / Journey
Broad recommendation may softly use:
- traveler type
- pace
- interests
- favorites
- visited experiences
- general mobility/family constraints

Food-specific dietary constraints do not leak into broad trip planning.

#### Operational / live fact questions
Availability, schedule, transaction status and status actions are memory-neutral by default.

### One-Mind integration

`OneMindTurnInput` now accepts optional normalized `durableMemory`.

Important sequence inside the orchestrator:

1. build bounded conversation/task semantic context
2. resolve the current SemanticTurn
3. plan durable-memory relevance
4. create a dialog-only copy enriched only with relevant constraints
5. Dialog Manager / Knowledge Resolver operate on that enriched copy
6. ORIGINAL SemanticTurn remains the canonical understanding stored in result/context/trace

Therefore memory can enrich downstream planning without rewriting what the customer meant.

### Customer gateway wiring

`thongthai-chat.ts` now passes one normalized durable-memory snapshot into every One-Mind entry:
- activity One-Mind path
- primary One-Mind cutover
- shadow path
- provider-failure One-Mind fallback

No channel gets a different memory policy.

### Safe observability

One-Mind trace now includes only:
- `memory.appliedKeys`
- `memory.ignoredKeys`
- `memory.relevantConstraintCount`

It does NOT persist the actual memory values in the trace envelope.

Backward compatibility:
old tests/older trace objects with no `trace.memory` safely default to an empty memory trace instead of throwing.

### Integration proof

New tests:
- `tests/human-brain-phase3-memory-relevance.test.ts`
- `tests/human-brain-phase3-memory-relevance-integration.test.ts`

They prove:
- restaurant availability with remembered no-chicken/no-shrimp/no-spicy keeps those values OUT of DialogPlan
- restaurant recommendation receives the relevant dietary values only after semantic understanding
- original SemanticTurn constraints remain unchanged
- safe trace contains keys/count only, never raw memory values

### GREEN evidence

Green head before docs:
`5e47a8898e5542e96528e5012921d83461edee31`

GitHub Actions:
run `36175450766`
**1138 / 1138 PASS**

No DB schema change.
No new database/repo/site.
No production transaction.
No manual Netlify deploy.

### Live verification after deploy

For an owner LINE turn, inspect `one_mind_traces.envelope` and require:
- current semantic domain/action/informationNeed correctly reflect the utterance
- availability/status turn shows no relevant durable constraint application
- recommendation turn may show only semantically appropriate memory keys
- no raw preference values appear in trace metadata

### Next Human Brain phase

**Phase 4 — Organization Brain + Tool Truth**

Goal:
the Language Brain may understand broadly, but all mutable TAMMA facts/actions must come from verified organization knowledge/tools:
- live availability
- current prices/menu
- schedules/inventory
- booking/order/payment state
- business policy

Unknown facts remain unknown; the model never fills source gaps by guessing.


---

## THONGTHAI HUMAN BRAIN — Phase 5 / Checkpoint 5.1 — Human Response Quality — 2026-09-26

**STATUS: IMPLEMENTATION GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY / LIVE TRACE.**

### Goal

A correctly understood semantic turn must sound like a capable human staff member, not like an intent-classification system.

This checkpoint fixes the production-observed reply shape:

`รับทราบครับ ถามเรื่องโต๊ะสำหรับพรุ่งนี้ เวลา 18:00นะครับ ...`

The semantic trace for that real LINE turn was already correct:
- domain = restaurant
- action = status
- informationNeed = availability
- needsClarification = false
- memory relevantConstraintCount = 0

Therefore this checkpoint changes RESPONSE RENDERING, not intent routing.

### Architecture rule

No new Thai intent regex/trigger was added.

The Response Composer now renders degraded/unknown mutable facts from the already-decided machine contract:

`domain + knowledge need + entities + degradation condition -> human fallback copy`

It never decides what the customer meant.

Semantic needs covered by the generic human fallback include:
- availability
- schedule
- price
- inventory
- catalog
- ingredients
- policy
- transaction_status
- recommendation

### Natural-response doctrine

The normal model Response Composer prompt now explicitly requires:
- answer the substance first
- do not narrate intent/domain/classification/routing
- do not mechanically restate the customer's whole question
- use natural spoken Thai like a capable human staff member
- avoid bureaucratic/system wording when simpler human wording is truthful
- keep spacing around times/numbers and Thai particles natural
- never glue a time such as `18:00` directly to `นะครับ`

Truth rules remain unchanged:
- no source = do not guess
- unavailable != empty
- no false booking/payment/confirmation claims
- mutable business facts still require authoritative facts/outcomes

### RED-first evidence

RED contract commit:
`bd86087bd706d31419ffd5bc36cfabd7f995818b`

The human-response tests were committed before implementation.

Branch CI in this repository is PR-triggered, so no workflow run existed for the RED-only branch commit before the draft PR was opened.

Implementation commit:
`21812587149e4758e92c2493b75a78bf35622316`

First PR CI:
run `36177083214` = FAILURE

It caught two existing regression contracts:
1. Response Composer version constant must remain the established explicit value.
2. The generic FACT_UNKNOWN fallback must still clearly state unverified truth / no guessing.

Those tests were NOT weakened.

Regression-preserving fix:
`7dd7dd48ab52f672fb7649055d8b0b64d18ce217`

Green CI:
run `36177261146`

Result:
**1142 / 1142 PASS**
**fail 0**

### New coverage

`tests/human-brain-phase5-human-response.test.ts` proves:

1. Restaurant table availability:
   - preserves tomorrow
   - preserves 18:00
   - still says table/seat
   - never uses `รับทราบครับ ถามเรื่อง...`
   - never produces `18:00นะครับ`

2. Semantic fallback is not restaurant-phrase-specific:
   - stay availability preserves date + room meaning
   - activity schedule preserves date/time + round/schedule meaning
   - restaurant price preserves the named menu item

3. SOURCE_UNAVAILABLE:
   - says it cannot check now
   - never converts unavailable into a false empty/full claim

4. Normal model composition:
   - answer content first
   - no intent narration
   - natural spoken Thai doctrine

### Safety / scope

No DB/schema change.
No transaction behavior change.
No booking/order/payment policy change.
No new repo/site/project.
No manual Netlify deploy.

### Live closeout requirement after merge

One real production LINE availability turn must show:
- semantic trace still availability
- memory irrelevant
- customer reply preserves date/time/table meaning
- customer reply no longer sounds like an intent-ack template

Only then close Checkpoint 5.1.


---

## THONGTHAI HUMAN BRAIN — Phase 5 / Checkpoint 5.2 — Language Brain Ownership — 2026-09-26

**STATUS: IMPLEMENTATION GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / AUTO DEPLOY / LIVE ACCEPTANCE.**

### Why this checkpoint exists

The system already had a capable semantic interpreter, but the One-Mind arbiter still allowed deterministic phrase/topic routers to become the FINAL owner of most natural read-only turns.

That was safe, but not human enough.

A sentence could therefore be reduced to:
- stay topic
- cafe topic
- activity topic
- generic price
- generic availability

before the Language Brain had a chance to read the whole predicate, qualifiers, constraints, references, or information need.

### New ownership rule

For **coarse read-only meaning**, the deterministic result is now a FALLBACK, not the final language owner.

Language Brain ownership covers coarse:
- ask
- discover
- recommend
- compare
- status

across coarse deterministic buckets including:
- stay
- cafe
- OTOP
- membership
- activity topic
- broad ecosystem discovery
- price
- availability
- how-it-works
- follow-ups

The model reads the whole current utterance with the existing semantic prompt.

### What remains deterministic

Business-state safety is unchanged.

The mature deterministic path remains authoritative for state-mutating / transactional meaning such as:
- task slot filling
- correction
- selection / confirmation
- booking
- ordering
- modification
- cancellation
- explicit transaction continuation

Exact deterministic machine facts that do not need language interpretation also remain zero-model.

Current explicit example:
- `activity_inventory_count` (e.g. exact catalog-backed count)

### Write-escalation guard

A semantic refinement that starts from a read-only deterministic candidate may NEVER upgrade the action into:
- book
- order
- confirm
- modify
- cancel
- or another write-capable action

A high-confidence model cannot turn “is it available?” into “book it”.

Write-capable meaning must still enter through the existing transactional contracts.

### Human clarification rule

A high-confidence semantic result that says clarification is genuinely required may now beat a coarse deterministic guess.

This lets Thongthai behave like a person:
- unresolved “that room / that one” => ask what the customer means
- do not confidently follow a broad keyword guess just because one exists

Weak/low-confidence semantic output still falls back to the deterministic candidate.

### Provider outage behavior

The new architecture may ATTEMPT Language Brain on coarse read-only turns.

If the model provider is unavailable:
- exact deterministic candidate is reused
- task state is preserved
- slots are preserved
- no transaction is proposed merely because the model failed
- exact deterministic write/state flows remain model-free

Two older tests that asserted **zero LLM calls for the entire conversation** were intentionally superseded because that performance contract conflicts with the owner’s new requirement that important natural read-only sentences be understood by the Language Brain.

Their safety coverage was not removed. It was replaced with stronger explicit contracts:
- only bounded coarse read-only turns may attempt the model
- transactional state turns remain deterministic
- provider outage must preserve the entire task state and response truth

### RED evidence

RED test commit:
`15f9c62bd65300a20647505da2344443aecbb419`

GitHub Actions:
run `36178933035` = FAILURE

Expected RED failures:
- task-free stay inquiry did not reach Language Brain
- cafe fact inquiry did not reach Language Brain
- richer ATV capacity question collapsed to activity topic
- read-only price side-question during active booking stayed phrase-owned
- write-escalation guard was absent
- semantic clarification could not beat a coarse deterministic guess

Transactional slot-fill and exact inventory guard tests were GREEN already in RED.

### Implementation

Core commit:
`30e68cb725b0311b7ece39859f54976f36930163`

The arbiter now uses semantic candidate TYPE / action ownership, not an expanded Thai intent keyword list.

No new Thai runtime phrase trigger was added.

### Regression migration

Old zero-call-only assertions were replaced with the new bounded ownership contract.

Regression commits:
- `e961c76c05645ea9985121d0eb135c45cb5a6acc`
- `a89fa4aead110d249878ce612830054db8dbd78c`

### GREEN evidence

GitHub Actions:
run `36179343184`

Result:
**1150 / 1150 PASS**
**fail 0**

New coverage proves:
1. stay availability reaches Language Brain
2. cafe item + preference reaches Language Brain
3. richer ATV capacity meaning is preserved
4. read-only side-question during an active booking reaches Language Brain without mutating the booking
5. transactional slot filling remains deterministic
6. exact inventory remains deterministic / zero-model
7. write-escalating model output is rejected
8. genuine high-confidence clarification can beat a coarse read-only guess
9. forced provider outage preserves task state and deterministic fallback truth

### Scope

No DB/schema change.
No booking/order/payment executor change.
No backoffice change.
No new repo/site/project.
No manual Netlify deploy.

### Remaining acceptance before calling this “human-grade”

Static / mocked CI is necessary but not sufficient.

The repository already carries the large semantic ground-truth corpus and live-eval runner.

A final human-grade certification still requires real-provider acceptance across the important semantic matrix, especially:
- colloquial Thai
- typo
- omitted subjects
- short follow-ups
- reference resolution
- corrections
- topic changes
- multi-intent
- availability vs transaction status
- price / schedule / inventory / policy
- active-task side questions
- current intent beating stale memory

Do not call the system “perfect” solely from network-free CI.


---

## THONGTHAI HUMAN BRAIN — Phase 5 / Checkpoint 5.4 — Provider Resilience + Honest Live Certification — 2026-09-26

**STATUS: IMPLEMENTATION GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / ONE-SHOT PRODUCTION LIVE CERT.**

### Why this checkpoint exists

The first production live semantic certification finally produced real evidence, but the headline score was misleading if read as semantic intelligence:

- total corpus: **158**
- pass: **5**
- failed: **153**
- naive passPct: **3.16%**

Inspection of the artifact showed:

- **152 / 153 failures were provider errors**
- only **1 failure was an actual semantic mismatch**
- the semantic mismatch was `discover-04` (`มีไรให้เล่น`), classified as activity discovery instead of broad ecosystem discovery

Therefore **3.16% was NOT the model's semantic accuracy**. It primarily measured provider availability collapse under the certification load.

Production certification evidence:
- deploy commit: `ec76dc2bf77ec102fbe6c709f2096dab7ad2d37d`
- certification artifact workflow run: `36185536194`
- artifact ID: `10885733633`

### Root cause in provider architecture

The provider layer had a global Gemini circuit assumption:

> one Gemini model returns 429 => all Gemini models are treated as quota-exhausted

That assumption was too broad.

Current Google Gemini rate-limit documentation states that limits are applied per project while each model variation has its own associated rate limits. A 429 on one model therefore must not automatically suppress every other free Gemini model.

Reference reviewed during this checkpoint:
`https://ai.google.dev/gemini-api/docs/rate-limits`

### New zero-cost provider chain

Free Gemini order is now:

1. `gemini-3.8-flash`
2. `gemini-3.7-flash`
3. `gemini-3.6-flash`
4. `gemini-3.5-flash`

Google lists 3.8, 3.7, 3.6 and 3.5 Flash as current Gemini 3 model releases.

A 429 now:

- records the structured diagnostic
- opens a bounded circuit for **that model only**
- immediately tries the next FREE Gemini model within the existing shared wall-clock budget
- never enables paid OpenAI by itself

`THONGTHAI_ALLOW_PAID_FALLBACK='1'` is still required before OpenAI may be called.

No paid fallback was enabled in this checkpoint.

### Circuit semantics

Old:
`geminiCircuitOpenUntil: number`

New:
per-model circuit map keyed by Gemini model.

Compatibility:
`isGeminiCircuitOpen()` still reports whether at least one Gemini model is cooling down, for existing diagnostics/tests.

`resetGeminiCircuitForTests()` clears all per-model circuits.

### RED evidence

RED commit:
`95c2a506ee92b7c2e695f9b4dcbfae24bebb0767`

Run:
`36186324795`

Expected RED result:
- tests: 1155
- pass: 1152
- fail: 3

RED proved:
1. one-model 429 incorrectly killed all Gemini fallback
2. circuit was global instead of model-specific
3. provider chain did not start with current stable Gemini 3.8 Flash

### Provider implementation

Core provider commit:
`044ea99f2cd7249ac4d2101e10a559ef9c41ac62`

Legacy global-circuit test was intentionally migrated rather than deleted:
`336ac0a5c2ed2bf6bf9990a029084d8aa352e272`

The replacement contract proves:
- next FREE Gemini model is attempted
- fallback remains fast
- model URL actually changes
- paid OpenAI is not called
- a rate-limited model remains circuit-open while other models stay usable

### Honest certification semantics

`_semantic-live-certification.ts` now distinguishes:

- `semanticFailed`: model returned a semantic turn but it disagreed with golden truth
- `providerFailed`: no valid semantic result because provider availability failed
- `semanticEvaluated`: only cases where a semantic result was actually obtained
- `availabilityComplete`: whether the requested certification slice completed without persistent provider failure

Provider failures now include only privacy-safe structured attempt diagnostics:
- provider
- model
- outcome
- HTTP status when available
- elapsedMs

No API keys.
No prompts.
No model output.
No customer transcript.

Certification diagnostics commit:
`b224ee71da5755c2470ca53bdc5bf75d358e5fa8`

Regression coverage commit:
`9ac99818cdb00340eb128ea8a8c2ae115aa734de`

### Certification pacing

The production certification runner now:

- runs serially instead of 4 batches in parallel
- uses chunks of 20
- on retryable availability failure waits **61 seconds**
- retries the same case once
- if provider still fails, stops immediately as `incomplete_provider`
- never turns hundreds of provider failures into a fake semantic score

Pacing commit:
`df5e5a249276ea7efcb0d9b498ea3551d14569f1`

### Netlify credit protection

The prior `RUN_SEMANTIC_CERTIFICATION = "1"` value was removed from `netlify.toml`.

Certification is now an explicit one-shot production action:

- production only: `CONTEXT=production`
- main only: `BRANCH=main`
- run only when:
  - explicit runtime env opt-in exists, OR
  - current commit message contains `[semantic-cert]`

The Phase 5.4 merge will intentionally carry `[semantic-cert]`.
Future ordinary production deploys will NOT rerun the full corpus.

Commits:
- `89e71540ff8431acecb1632cd8257909a4639c3f`
- `0c6caff85006250495a1f562f0c0ef8ec61c48f0`
- `ff475599f124f3d93ca92ccce2ad7a5f9838000e`

### GREEN evidence before docs checkpoint

One-Mind CI run:
`36187097185`

Result:
**1158 / 1158 PASS**
**fail 0**

Exact Netlify build command:
run `36187097193`
**PASS**

### Scope safety

No DB/schema change.
No customer memory mutation.
No booking/order/payment executor change.
No backoffice change.
No new repo/site/database.
No paid OpenAI fallback enabled.
No manual Netlify deploy.

### Next acceptance

After docs-inclusive CI is green:

1. merge exact PR head with merge commit marker `[semantic-cert]`
2. verify production Netlify deploy READY and commit_ref exact
3. read `semantic-certification-result.json`
4. require:
   - `availabilityComplete=true`
   - `providerFailed=0`
5. only then interpret semantic pass/fail
6. fix recurring semantic failure patterns without weakening golden corpus
7. repeat until human-grade semantic contract is met

Do NOT quote the old **3.16%** as semantic accuracy. It was primarily an availability artifact.


---

## THONGTHAI HUMAN BRAIN — Phase 5 / Checkpoint 5.5 — Semantic Taxonomy v2 — 2026-09-26

**STATUS: IMPLEMENTATION GREEN; PENDING DOCS-INCLUSIVE CI / MERGE / ONE-SHOT LIVE CERTIFICATION.**

### Live evidence that triggered this checkpoint

Phase 5.4 production live certification after provider-resilience hardening:

- total executable corpus: **158**
- evaluated before persistent provider interruption: **33**
- semantic results actually returned: **32**
- semantic pass: **17**
- semantic failures: **15**
- provider failures: **1**
- semantic pass rate over returned semantic results: **53.13%**
- status: `incomplete_provider`

This is materially different from the earlier misleading 3.16% run: Phase 5.4 separated real semantic mismatches from provider availability.

The remaining 15 semantic failures clustered into taxonomy classes rather than isolated phrases.

### Taxonomy defects identified from live model output

1. Generic property-wide discovery (`มีไรทำ/เล่น`) sometimes narrowed to `activity` with no specific activity/entity.
2. Restaurant catalog browsing (`ร้านมีไรกิน`, `มีเมนูไรมั่ง`) was inconsistently scored as recommendation.
3. Availability used `status` in restaurant but `ask` in stay/activity fixtures.
4. Contextual selection (`เอาภาราดร`, `อันเมื่อกี้`) could be escalated to `book`.
5. Slot answers (`พรุ่งนี้สองคน`) could be confused with confirmation.
6. One golden case (`พรุ่งนี้ว่างไหม`) demanded `stay` despite supplying no stay context -- a human cannot infer the missing subject honestly.

### Semantic-v2 human taxonomy

The interpreter prompt now defines domain/action meaning explicitly, without runtime phrase routing.

#### Domain scope
- `ecosystem`: whole-property discovery when no specific business domain/activity/entity is stated.
- Generic “do/play/visit” meaning alone does not narrow to `activity`.
- `activity`: requires a specific activity/entity or unambiguous relevant context.
- Elliptical availability with neither an entity/domain nor relevant context must not hallucinate a domain; use clarification.

#### Actions
- `discover`: browse catalog/options/categories that exist.
- `recommend`: ask Thongthai to help choose/personalize/suggest.
- `status`: ask current state/availability/open/full/still-available or existing transaction state.
- `ask`: factual information not better represented by status/compare/recommend/discover.
- `confirm`: accept/select a previously presented/referenced option.
- `book/order`: explicit transaction intent to create/submit now; selection alone is not enough.
- `provide_information`: supply requested task slot values, not transaction confirmation.
- `correct_previous`: explicit correction/replacement.

### Closed-facet canonicalizer

Prompt quality is not the only guard.

After structured model output is parsed, read-only actions are canonicalized from the CLOSED machine-facing facet:

- availability -> status
- transaction_status -> status
- catalog -> discover
- recommendation -> recommend

Only read-only labels (`ask/discover/recommend/status`) are normalized.

Transactional actions are NEVER rewritten:
- book
- order
- confirm
- modify
- cancel
- etc.

This keeps deterministic safety while removing harmless model-label drift.

### Golden corpus corrections

The corpus was corrected where old ground truth was internally inconsistent.

Examples:
- restaurant menu/catalog browsing -> discover + catalog
- explicit “แนะนำอะไรกินหน่อย” remains recommend
- stay/activity/resource availability -> status + availability
- context-free `พรุ่งนี้ว่างไหม` now has relevant stay context because otherwise the domain is unknowable
- topic-switch stay availability -> status
- Phase-L status/informationNeed cases were aligned as well

This is NOT weakening gold to match model output. It makes the semantic contract internally consistent and human-grounded.

### Corpus count correction

Executable arrays are:

- base corpus: **78**
- Phase-L expansion: **80**
- total: **158**

Older comments stating 89 + 70 = 159 were stale and did not match the actual executable fixtures.

### RED evidence

RED commit:
`4e79b17757ad8f6f8c014d5894c67ea6548f338a`

RED run:
`36188209869`

Result:
- tests: 1165
- pass: 1159
- fail: 6

Expected failures proved:
- broad ecosystem/activity domain rule missing
- discover/recommend taxonomy missing
- confirm vs transaction rule missing
- cross-domain availability status inconsistency
- context-free stay hallucination in gold
- restaurant catalog/recommendation inconsistency

### Implementation

Prompt taxonomy:
`3e9d2ca14c62fa3a94c85e90014bd0642ac97a1e`

Base gold normalization:
`d48aa4e3ab4ee9b77ff50b91c3315cd00d44dba7`

Phase-L normalization:
`a6e4833a9547ddb9e3efd8b4fefc68863d1ad067`

Closed-facet canonicalizer:
`d73e0c6be43b2fad439b7d27107943f935a4128e`

Canonicalizer safety tests:
`2a13615e9ee630c49a3b4db955d21abe0e5963a3`

Semantic interpreter version:
`semantic-v2`

Live-eval status now honestly reports:
`partial_live_certification_in_progress`

Corpus equivalence tests were migrated, not deleted:
`70392050f5f45752128fe072627f8b2111bc8f63`

### GREEN evidence before docs checkpoint

One Mind CI:
run `36188961192`

Result:
**1167 / 1167 PASS**
**fail 0**

Exact Netlify build-command guard:
run `36188961187`
**PASS**

### Scope safety

No DB/schema change.
No booking/order/payment executor change.
No backoffice change.
No runtime keyword router added.
No paid OpenAI fallback enabled.
No manual deploy.

### Next acceptance

Merge with explicit `[semantic-cert]` marker and run one-shot semantic-v2 production certification.

Do not call Phase 5.5 human-grade until the live model evidence confirms the taxonomy changes.


---

## THONGTHAI HUMAN BRAIN — Phase 5.6 — Quota-safe semantic certification — 2026-09-26

**STATUS: IMPLEMENTATION + BRANCH VERIFICATION GREEN; PENDING PR CI / EXACT MERGE / AUTO PRODUCTION CERT.**

### Why this checkpoint exists

The hardened live certification still burst provider calls fast enough to manufacture its own availability failure.

Production evidence from deploy `6ab6dd0bc092750008f39e8f`:
- total corpus = 158
- evaluated = 17
- semanticEvaluated = 16
- semanticFailed = 5
- providerFailed = 1
- availabilityComplete = false
- passPct = 68.75% of semantic-evaluated cases only

The provider-blocked turn showed multiple current Gemini model IDs rate-limited in the same burst before the shared 7s provider budget was exhausted.

Therefore the incomplete run is NOT a valid whole-corpus semantic score.

### Architecture

Runtime provider behavior remains unchanged:
- FREE Gemini first
- per-model circuit remains
- shared 7s runtime budget remains
- paid OpenAI remains opt-in only via THONGTHAI_ALLOW_PAID_FALLBACK=1

Certification only now supports bounded `interCaseDelayMs`.

The production one-shot runner defaults to:
`SEMANTIC_CERT_INTER_CASE_DELAY_MS=4250`
when no explicit override is supplied.

Pacing applies across:
- cases inside each batch
- batch boundaries

It does NOT slow customer chat.

Existing cert safeguards remain:
- provider failure != semantic failure
- stop on provider failure
- 61s availability retry/cooldown
- provider failures excluded from semantic pass percentage
- build never fails merely because baseline provider availability is incomplete

### Provider documentation correction

Gemini quotas are project-scoped and may vary by model/tier.
A 429 from one model does not prove every model is unavailable, so per-model runtime fallback remains useful.
But certification must pace project-wide because project quota can affect several model IDs during one burst.

### RED-first evidence

RED commit:
`c2f09075712d24d6ab3997424e11441442bf4fa4`

### Branch verification

GitHub Actions:
run `36189657525`

Result:
- **1169 / 1169 PASS**
- fail 0
- exact Netlify build command = SUCCESS
- live semantic certification correctly skipped outside production/main

No DB/schema change.
No transaction executor change.
No booking/order/payment behavior change.
No backoffice change.
No manual Netlify deploy.
No fake production transaction.
No paid OpenAI fallback.
Temporary verification workflow removed before PR.

### Merge discipline

PR must skip Deploy Preview to preserve Netlify credits.
Merge only exact verified head SHA.
Production merge commit must contain `[semantic-cert]` and must NOT contain `[skip netlify]`, so the single real production auto deploy runs the quota-safe live corpus.


## 2026-09-26 Human Brain Phase 5.7 — semantic-v3 hardening

This checkpoint follows the first semantic-v2 production certification and fixes correctness problems found from real provider output. It is a strangler improvement only: no DB/schema change, no booking/order/payment executor change, no backoffice change, no runtime keyword router, no paid OpenAI enablement.

### Live semantic-v2 evidence used

Production artifact from the semantic-v2 run:
- total corpus: **158**
- evaluated before stop: **102**
- semantic evaluated: **101**
- pass: **73**
- semantic failures: **28**
- provider failures reported: **1**
- reported passPct: **72.28%**
- availabilityComplete: **false**

Important correction: the final reported provider failure was a **SyntaxError with zero provider attempts**. That means the provider returned something, but the semantic payload could not be parsed as valid JSON. Phase 5.7 now classifies such malformed model output as a semantic/model-output failure, not provider unavailability. Provider availability is reserved for failures with safe provider-attempt diagnostics.

### Root semantic patterns fixed

From the live failures, the following human semantic distinctions were made explicit without phrase-by-phrase routing:

- capacity/policy vs live availability
- catalog existence vs current availability
- vague support/help vs ecosystem discovery
- journey save/view vs booking
- membership profile/status vs membership benefits/catalog
- explicit correction vs intentional modify
- short category follow-up after broad discovery
- ambiguous multi-candidate selection vs legitimate multi-entity question/comparison
- closed read-only informationNeed overriding harmless read-only action-label drift
- suspended-task resume fixtures must contain real suspended task evidence instead of expecting the model to hallucinate missing context

### Deterministic safety added

- Multiple plausible target entities force clarification only for target-changing actions such as confirm/book/order/modify/cancel.
- Multi-entity ask/recommend/compare turns may retain the candidate set without being falsely treated as ambiguous execution.
- availability / transaction_status / catalog / recommendation closed facets may normalize read-only action labels, including a stray provide_information label on a read-only question.
- No transactional action is normalized into another action.
- Malformed semantic JSON is counted as semantic correctness failure with safe error-class diagnostics only; no raw model output is stored.

Semantic interpreter version:
`semantic-v3`

### RED evidence

Initial Phase 5.7 RED run:
`36190615279`

Result:
- **1176 tests**
- **1169 pass**
- **7 fail**

The failures proved the intended missing behavior:
- malformed model JSON incorrectly counted as provider outage
- ambiguous target selection not mechanically guarded
- read-only informationNeed could lose to action-label drift
- missing semantic doctrine for capacity/catalog/support/journey/membership/correction
- stale/inconsistent gold cases from live evidence
- resume-horse fixture lacked actual suspended task evidence

### GREEN evidence

Final branch verification:
run `36191447184`

Result:
- **1176 / 1176 PASS**
- **0 fail**
- exact Netlify build command: PASS
- `PHASE_O_LIVE_EVAL_GATE_SKIPPED` as expected outside production/main
- `LIVE_SEMANTIC_CERTIFICATION_SKIPPED` as expected outside production/main

### Scope safety

Still true after Phase 5.7:
- no production DB mutation
- no fake transaction
- no transaction-core rewrite
- no paid OpenAI fallback enablement
- no Netlify manual deploy
- no new repo/DB
- no keyword-expansion architecture

### Next acceptance

1. Merge the exact reviewed Phase 5.7 head only after normal PR CI + Netlify build guard are green.
2. Let Netlify auto-deploy production.
3. Run one semantic-v3 production certification using the existing one-shot marker.
4. Treat providerFailed and semanticFailed separately.
5. Only if availabilityComplete=true is the full semantic score meaningful.
6. Fix/adjudicate any remaining semantic-v3 failures by semantic pattern, never exact runtime sentence matching.
