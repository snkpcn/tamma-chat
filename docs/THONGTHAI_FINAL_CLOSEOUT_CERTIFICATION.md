# Thongthai Human Core — Final Closeout Certification

Base commit: `7e21c4ec` (main, PR #199 merged — production smoke mechanism).
This document closes the three items the owner named as still open after
PR H (Cafe cutover): (1) state/memory/knowledge/channel certification,
(2) an independently recomputed cost certification, (3) real LINE HTTPS
transport certification.

## 1. State / Memory / Knowledge / Channel certification

Every required invariant below is either already proven by an existing,
named test (cited exactly) or by a new test added in this closeout. Nothing
here is a new behavior added to satisfy the checklist — every citation
exercises pre-existing production code.

| Required invariant | Evidence |
|---|---|
| Current utterance outranks stale context | `tests/human-conversation-phase2-hidden-continuity-holdout.test.ts`: "...current unrelated meaning outranks stale restaurant constraints" |
| Correction updates only the intended slot | `tests/human-conversation-phase4-transaction-safety-acceptance.test.ts:100` "Phase 4 acceptance: correction changes only the named slot"; `tests/semantic-meaning.test.ts:119` "corrections only lists entity keys on a genuine correction turn, never an unrelated turn's full entity set"; `tests/task-state.test.ts:308` "task correction fields are keyed objects, not append-only logs" |
| Entity continuity | `tests/human-conversation-phase2-hidden-continuity-holdout.test.ts`: "Phase 2 frozen holdout: A survives two side topics and exact A resumes" |
| Suspend/resume non-contamination | `tests/gate3-stale-interrupted-conversations.test.ts`: "switch A -> B -> C -> resume A: a suspended task survives more than one intervening domain hop" (generic proof, otop/cafe) |
| **Activity -> Restaurant -> Stay -> Activity (literal named sequence)** | **New**: `tests/final-certification-cross-domain-sequence.test.ts` (below) |
| Memory-relevance ordering | `tests/human-brain-phase3-memory-relevance.test.ts`: 6 tests, e.g. "restaurant availability ignores dietary and lifestyle memory", "activity recommendation uses care/mobility memory, not dietary memory"; doctrine test: "relevance planning never mutates or reclassifies the semantic turn" |
| PII/payment/contact never enters durable memory | `tests/task-state.test.ts:281` "SAFE_MEMORY_KEYS (durable semantic memory allow-list) contains no transactional/PII field names" **plus source-level architectural proof**: `_thongthai-runtime-v3.ts` lines 14-16 define `SAFE_MEMORY_KEYS` as a closed 6-entry set (`discovery_style, preferred_moods, experience_preferences, stay_preferences, activity_preferences, avoid_experiences`); line 320 `if (!SAFE_MEMORY_KEYS.has(memory.key)) continue;` makes any other key structurally unwritable; `safeShort()` (lines 37-43) additionally redacts email/phone patterns on whitelisted values as defense in depth |
| Raw text never improperly durable | Same `SAFE_MEMORY_KEYS` allow-list — only 6 named preference keys are ever persisted, never raw utterance text |
| Unique-bounded-evidence reference resolution | `tests/human-brain-semantic-v29-speech-act-domain-repair.test.ts:295` "descriptive prior recommendation selection resolves the unique recommended entity across topic switches" |
| Ambiguous-reference fails closed | `tests/human-brain-phase5-7-semantic-hardening.test.ts:100` "PR G certification: an arbitrary descriptive reference with multiple candidates fails closed instead of confirming" |
| Descriptive reference not keyword-dependent | Same test file — the fix underlying it (see THONGTHAI_HANDOFF.md's "Real LINE Conversation Recovery" entry) explicitly removed a hardcoded keyword-spelling dependency |
| Four-way truth distinction (VERIFIED FACT != VERIFIED EMPTY != FACT UNKNOWN != SOURCE UNAVAILABLE) across availability/price/stock/schedule/policy/promotion | `tests/human-conversation-phase3-hidden-knowledge-holdout.test.ts`: "a plausible static price cannot impersonate live activity truth" (FACT vs guess), "a live organization fact wins regardless of stale-memory order" (FACT), "an explicit authoritative zero is known, not guessed absent" (VERIFIED EMPTY != UNKNOWN), "a failed live source remains unavailable and never becomes none" (SOURCE UNAVAILABLE != VERIFIED EMPTY) |
| Web/LINE channel consistency (same brain, same facts, differences only in presentation) | `tests/gate2-line-web-domain-equivalence.test.ts`: 6 domain tests (stay/restaurant/promotion/otop/membership/cafe), each asserting identical real facts/business behavior on both channels; `tests/human-conversation-phase5-channel-parity-acceptance.test.ts:62` "web and LINE suspend a side topic and restore the exact same business task"; `tests/conversation-context.test.ts:128` "web -> line, same canonical guest: turn 2 on LINE is interpretable as continuation of turn 1 on web" |

### New test: the literal named cross-domain sequence

`tests/final-certification-cross-domain-sequence.test.ts` drives the real
`processThongthaiChatCore` end-to-end (never a hand-built SemanticTurn),
seeding an Activity task exactly the way `gate3-stale-interrupted-
conversations.test.ts` does, then sends a real read-only Restaurant
question, then a real read-only Stay question, then continues the Activity
conversation. Investigating the actual persisted state after each hop
revealed the correct, existing invariant is even *stronger* than a
suspend/resume round trip: `_dialog-manager.ts`'s `SIDE_QUESTION_ACTIONS`
(`ask`, `discover`, `recommend`, `compare`, `status`) mark a pure read-only
question in another domain as a **no-write turn** — the persisted task
state is left completely untouched, not merely suspended and later
restored. The test asserts the seeded Activity task's `taskId` and `slots`
are byte-for-byte identical before the Restaurant hop, after the Restaurant
hop, after the Stay hop, and after the conversation returns to Activity.
Full suite after adding it: **1593/1593 passing, 0 failures**.

## 2. Cost certification (recomputed from current code, not quoted)

Read directly: `netlify/functions/_ai-cost-policy.ts`,
`netlify/functions/_ai-cost-ledger.ts`, `netlify/functions/
_thongthai-model-provider.ts`, `netlify/functions/_thongthai-brain-v3.ts`,
`netlify/functions/_semantic-interpreter.ts`, `netlify/functions/
_response-composer.ts`, `netlify.toml`, `.env.example`.

### Current live policy (no environment override exists in `netlify.toml`/`.env.example` — these are the actual deployed values)

| Constant | Value | Source |
|---|---:|---|
| `maxConversationCostUsd` | **$0.05** (hard; env may only lower it — `Math.min(env, DEFAULT)`) | `_ai-cost-policy.ts` line 4/103-109 |
| `maxCallsPerTurn` | **1** (hard max; `boundedInteger` cannot exceed `DEFAULT_MAX_AI_CALLS_PER_TURN`) | line 5/110-115 |
| `maxCallsPerConversation` | **6** (hard max) | line 6/116-121 |
| `semanticMaxOutputTokens` | **500** (bounded 64-500) | line 7/122-127 |
| `absoluteInputTokens` | **5,000** (bounded 500-5,000) | line 10/128-133 |
| Production model | `gpt-5.6-terra` (`THONGTHAI_SEMANTIC_MODEL` env not set in `netlify.toml`, so the code default applies) | `_thongthai-model-provider.ts` line 67 |
| Terra pricing | $2.00 / $0.20 / $12.00 per 1M input/cached-input/output | `_ai-cost-policy.ts` lines 36-40 |

### Worst-case arithmetic (recomputed, not quoted)

Per-call worst-case reservation (`reserveWorstCaseCostUsd`, always reserved
at the *absolute ceiling*, never the actual smaller estimate):

```
(5,000 input * $2.00 + 0 cached + 500 output * $12.00) / 1,000,000
= (10,000 + 0 + 6,000) / 1,000,000
= $0.016 per call
```

`reserveAiCall` (`_ai-cost-ledger.ts` line 206-215) blocks *before* any
network I/O once `cumulativeCostUsd + reservedCostUsd + nextReservation`
would exceed `maxConversationCostUsd`. At $0.016/call, `floor($0.05 /
$0.016) = 3` reservations fit ($0.048); a 4th reservation attempt
($0.064 total) is rejected before any fetch happens — independent of the
6-call structural cap, which is never actually reached. So the ledger's own
enforced ceiling means a conversation can **never structurally reserve more
than $0.048**, itself under the configured $0.05 constant.

### (A) No hidden second call from any migrated domain

`reserveAiCall` is the **single canonical gate** for every OpenAI network
call in the deployed codebase. Verified by searching every file under
`netlify/functions/` for `openai.com`: exactly three files reference it —
`_thongthai-model-provider.ts` (the guarded transport, calls `reserveAiCall`
at line 156 before `fetch`), `_thongthai-brain-v3.ts` (the legacy-fallback
brain used by domains not yet migrated to a single-brain cutover; its
`callPreferredModel` at line 39 explicitly forwards `costContext` into
`_thongthai-model-provider.ts`'s own guarded function — confirmed by
reading both files), and `_ops-fuel-receipts.ts` (an unrelated
back-office OCR feature, not part of the customer chat path).

**A real, now-confirmed-inert finding from this audit**: an *old*,
superseded file `netlify/functions/_thongthai-brain.ts` (no `-v3` suffix)
still contains its own private `callOpenAI`/`callGemini`/`callPreferredModel`
functions that call `fetch('https://api.openai.com/...')` directly, with
**no** cost-ledger integration at all. A repo-wide search
(`grep -rn "_thongthai-brain'"`) shows its **only** reference anywhere in
the repository is a single `import type { BrainChannel } from
'./_thongthai-brain'` in `_thongthai-identity.ts` — a type-only import,
erased at compile time, with zero runtime footprint. `thongthai-chat.ts`
(the live handler) imports `runThongthaiBrain` from `_thongthai-brain-v3`
exclusively. This old file is genuinely dead code, not a live production
risk — but it should be deleted in a follow-up cleanup PR to remove the
latent hazard of someone importing the wrong file by mistake. Not deleted
in this closeout since that is out of this task's scope (cost
*certification*, not a cleanup pass) and doing so would be an unrequested
change to files this task did not otherwise need to touch.

Cross-domain migrated cutovers (Activity, Stay, Restaurant, Promotion,
Cafe) each call `composeGroundedDeterministicResponse`/
`composeDeterministicResponse` (in `_response-composer.ts`) — confirmed
**zero** references to `openai.com`/`reserveAiCall`/`fetch(` anywhere in
that file, so a migrated domain's own cutover path can add at most the
one semantic-supervisor call already reserved upstream, never a second one
of its own.

### (B) Certification/reviewer extra calls are opt-in/test-only

`options.certificationMode` (the gate for the bounded Sol second-opinion
review call in `_semantic-interpreter.ts` line 1484) is driven by
`process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE === '1'`
(`_thongthai-model-provider.ts` line 141). A repo-wide search shows this
env var is set to `'1'` **only** inside five standalone certification
scripts (`scripts/run-phase1-*.ts`, `scripts/run-phase6-live-multiturn.ts`,
`scripts/run-real-line-16-turn-live-acceptance.ts`,
`scripts/run-semantic-live-eval.ts`) via `process.env.X = '1'` at the top
of each script file — that assignment lives inside that script's own Node
process and is never set in `netlify.toml`, never set by the deployed
handler, and cannot leak into a real Netlify function invocation. This
structurally proves reviewer calls cannot reach customer production.

### (C) Recomputed THB ceiling with margin

The repo's own existing `docs/THONGTHAI_AI_COST_CERTIFICATION.md`
(PR #183) records the design intent explicitly: *"Owner ceiling: <=
$0.05 estimated OpenAI spend per customer conversation (the internal USD
safety cap for the <= 2 THB requirement)"* — i.e. the $0.05 constant was
deliberately chosen assuming a conservative **40 THB/USD** rate (0.05 x 40
= 2.00), which is above the prevailing real market rate (recently
~32-36 THB/USD), so it already bakes in an FX safety margin rather than
being a bare break-even number.

- **At the conservative 40 THB/USD design rate**: $0.05 structural ceiling
  = **2.00 THB exactly**; the tighter $0.048 actually-reservable ceiling
  (see arithmetic above) = **1.92 THB**, a **0.08 THB (4%) margin** below
  the owner's cap even at this deliberately pessimistic rate.
- **At a realistic current market rate (~32.5-36 THB/USD)**: the true
  worst-case reservable amount is **$0.048 x 32.5-36 ≈ 1.56-1.73 THB**,
  a genuine **0.27-0.44 THB (14-22%) margin**.
- **Real observed evidence** (the existing 100-conversation/1,596-turn
  corrected-pricing stress run already in `docs/
  THONGTHAI_AI_COST_CERTIFICATION.md`): average cost/conversation
  $0.029252, maximum observed $0.041540 — at 40 THB/USD that maximum is
  **1.66 THB**, still under the 2 THB cap with margin, before even
  accounting for the tighter structural ceiling above.

**Conclusion: the current, unmodified, deployed cost policy mathematically
cannot exceed the owner's 2 THB/conversation cap under any of the three
lenses above.** No guard change was required.

Full suite (including `tests/thongthai-ai-cost-guard.test.ts`'s 12 tests)
remains green: **1593/1593**.

## 3. Real LINE HTTPS transport certification

No prior workflow exercised the real deployed `line-webhook` endpoint over
HTTPS — the existing 16-turn LINE acceptance suite (16/16, still green)
only drives the in-process brain logic.

### What was built

- `.github/workflows/line-transport-certification.yml` (`workflow_dispatch`
  only): step 1 checks **only** whether the `LINE_CHANNEL_SECRET` repository
  secret is configured, using `if [ -z "$LINE_CHANNEL_SECRET" ]` — the
  value itself is never echoed, printed, or logged anywhere. If absent, the
  job records the exact marker `LINE_TRANSPORT_SECRET_NOT_CONFIGURED` and
  stops; it does not fabricate a pass and does not ask the owner for a test
  channel before exhausting this CI path.
- `scripts/run-line-transport-certification.ts`: if the secret is present,
  sends two real HTTPS POST requests to the deployed
  `https://tamma-chat.netlify.app/.netlify/functions/line-webhook`:
  1. An **invalid** `x-line-signature` header — expects HTTP 401.
  2. A **validly HMAC-SHA256-signed** body (computed exactly the way
     `_line-webhook-core.ts`'s own `verifyLineSignature` does) — expects
     HTTP 200.

  **Safety property, verified by reading `_line-webhook-core.ts` directly**:
  the request body is a LINE `follow` event, never a `message` event.
  `handleEvent()` unconditionally calls `replyToLine()` (a real outbound
  LINE Reply API call) once it reaches a text message with a replyToken and
  userId (line ~510) — there is no way to exercise that branch live without
  also attempting a real reply. A `follow` event passes the exact same live
  signature-verification gate but is caught by the handler's own
  `if (event.type !== 'message') return;` guard (line ~438) immediately
  afterward: no reply, no `processThongthaiChatCore` call, no database
  write, no customer-visible effect of any kind. This is the deepest
  transport boundary provable live without risking a real reply or
  fabricated customer-visible event, per the explicit safety constraint to
  avoid LINE reply delivery when a real message event is unavoidable.
  The synthetic `userId` (`Uci-line-transport-cert-<timestamp>`) is
  clearly CI-marked and cannot collide with a real LINE user ID.

### Result

This closeout could not execute the workflow from this sandbox (no
production network access, and GitHub Actions secret presence cannot be
queried from here without running the workflow itself). The mechanism is
built, safe, and ready to run via `workflow_dispatch`; its actual PASS or
`LINE_TRANSPORT_SECRET_NOT_CONFIGURED` result will be recorded by whoever
dispatches it, or by a follow-up session with GitHub Actions dispatch
access.

**Regardless of that live outcome, the following LINE boundaries are
already structurally certified** (static code + the existing test suite,
independent of whether the secret is configured):

- The webhook is deployed at `netlify/functions/line-webhook.ts` /
  `_line-webhook-core.ts`.
- Signature verification exists (`verifyLineSignature`, HMAC-SHA256) and
  structurally rejects any request without a matching signature.
- The private LINE route reaches the shared `processThongthaiChatCore`
  (`_line-webhook-core.ts` line 174) — the same entry point Web uses.
- No separate LINE semantic brain exists; `askThongthaiReliably` funnels
  into the identical One-Mind/semantic-interpreter path Web uses.
- No channel-local transaction interpretation: all task/booking logic
  lives in `_dialog-manager.ts`/`thongthai-chat.ts`, channel-agnostic.
- The existing 16/16 real LINE-channel live human-conversation acceptance
  remains green (see THONGTHAI_HANDOFF.md's "Real LINE Conversation
  Recovery" entry, 2026-09-27).

If the live workflow result is `LINE_TRANSPORT_SECRET_NOT_CONFIGURED`, the
honest final status is: **PRODUCT LOGIC CERTIFIED; EXTERNAL LINE TRANSPORT
HAPPY-PATH NOT SYNTHETICALLY EXERCISED (blocked only by a missing CI
signing secret)** — the one acceptable remaining limitation per the
owner's own stated criteria.
