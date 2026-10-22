# Production readiness — 21 October 2026

Initial live check: 2026-10-21T21:12:06.886788+07:00 (Asia/Bangkok). Target: `https://tamma-chat.netlify.app`.

## Local verification

- Full existing suite after fixing the Owner fixture clock: **3,468 / 3,468 passed**.
- Additional ordered-migration/preflight/lease checks: **5 / 5 passed**. These ran locally in PGlite; they do not establish hosted schema state.
- The Owner failure was a historical fixture expiry compared to the current wall clock. Its test now freezes `Date.now` and restores it; production expiry logic was not weakened.

## Real production observations

| Probe | Result | End-to-end time |
| --- | --- | --- |
| `/.netlify/functions/ops-health` | HTTP 200 | 1.620s |
| `/.netlify/functions/thongthai-brain-status` | HTTP 200 | 1.538s |
| `/.netlify/functions/line-webhook` (invalid HMAC, empty event batch) | HTTP 401 | 0.922s |
| Web: สวัสดีครับ | HTTP 200 | 8.293s |
| Web: ผมแพ้นมครับ | Client read timeout; no reply received | 18.108s |
| Web: ผัดไทยมีไหม | Client read timeout; no reply received | 18.096s |
| Follow-up: ops-health | HTTP 200 | 2.169s |
| Follow-up: เปิดกี่โมง | Client read timeout; no reply received | 15.105s |

Times include network travel from the test machine and are individual samples, not a latency percentile or a server-only measurement. Health remained reachable during follow-up while chat timed out. The server-side cause still requires logs.

The web sequence reused one synthetic guest and sent browser-style history. Since its second and third turns timed out, conversation continuity is **not certified**.

`ops-health` reported Supabase configuration, a PII key and LINE configuration present. This proves presence only, not valid credentials, migration state, reachability, webhook redelivery configuration or successful message delivery.

## Remaining verification

- **Hosted migrations: unverified.** No connected database account or local production service credentials were available. Run `supabase/checks/customer-turn-production-readiness.sql` on the actual production project. It checks 10 schema/permission/trigger prerequisites without changing data.
- Apply only missing prerequisites in this order: existing cost/trace tables → `20261009090000_customer_turn_monitor_v1.sql` → `20261018120000_web_search_cost_provider.sql` → `20261020120000_customer_turn_claim_v1.sql` → `20261020130000_customer_turn_monitor_context_persisted.sql` → `20261021120000_line_customer_deliveries.sql`. Never rerun the claim view migration after the context view migration.
- **Cost: unverified.** Query the cost ledger/response metadata for the synthetic conversations below. Missing telemetry must remain NULL/unverified, not 0 THB. Ledger totals depend on configured provider prices and do not replace an invoice.
- **LINE delivery: unverified.** The invalid-signature probe was rejected (401); no valid signed message or outbound reply/push was sent. The designated test account still needs an unambiguous LINE user ID and channel/log access.
- **Deployed revision: unverified.** The public brain status exposes component version names but no commit SHA. The local fixes are uncommitted and were not deployed. Do not attribute current production results to this edited source.
- A Supabase integration is available but its installation/connection is not confirmed. No database migration or deployment was applied.

## Synthetic correlation identifiers

- Web sequence guest: `c64ae030-57a1-441d-bbb2-b1f2854d214a`
- `readiness-20261021-572e1843-7e91-44ab-a5bd-802d91686825` — สวัสดีครับ; Netlify request `01M5FCW9S2KRJ9YJPBWT8MW6AH`
- `readiness-20261021-1f411124-8b72-4dcd-8ba2-7c4311335300` — ผมแพ้นมครับ
- `readiness-20261021-e78a66c4-1e2e-4e89-8ee5-24646a16dbad` — ผัดไทยมีไหม
- Opening-hours guest: `c300f2e3-7f2a-46fc-abd3-6763cc995355`; event `readiness-hours-b96e96c1-f00e-4f71-849e-7aa3fe5883af`.
