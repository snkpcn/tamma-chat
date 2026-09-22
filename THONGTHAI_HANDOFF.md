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
