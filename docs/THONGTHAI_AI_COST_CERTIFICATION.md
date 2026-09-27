# Thongthai AI Cost Guard — Final Certification

Runtime checkpoint: `8995c73060ab3a0c7dd24480c509143ae2c85ea5`
Branch: `human-brain/production-cost-guard`
PR: #183 (draft; no production deploy/merge authorized)

## Production hard contract

- Owner ceiling: **<= $0.05 estimated OpenAI spend per customer conversation** (the internal USD safety cap for the <= 2 THB requirement).
- Maximum paid semantic calls per customer turn: **1**.
- Maximum configured paid calls per conversation: **6**, but worst-case dollar reservation blocks earlier.
- Production semantic model: **GPT-5.6 Terra** only.
- GPT-5.6 Sol is excluded from customer production and is used only in explicit paid certification mode.
- Production request limits: <= **5,000 estimated input tokens** and <= **400 output tokens** by default (output configuration cannot be loosened above 500).
- Every paid request reserves worst-case cost before OpenAI network I/O.
- Current reviewed Terra reservation at the absolute 5,000-input / 400-output ceiling is **$0.0148**. Three such reservations fit ($0.0444); a fourth is blocked before the model call.
- Duplicate Web/LINE event IDs replay the persisted completed semantic result instead of paying twice.
- Budget exhaustion/provider failure degrades to deterministic/context-safe behavior; genuinely uncertain meaning clarifies rather than transacting.
- Customer production cannot activate certification mode.
- Owner caps are fail-closed: environment settings may make the cap stricter but cannot raise the $0.05 ceiling, raise paid calls/turn above 1, or loosen the reviewed output ceiling.
- Unknown/unreviewed model pricing fails closed so a model swap cannot silently bypass the cost guard.
- Full prompts, API keys, and secret headers are not written to cost telemetry.

## Canonical reviewed pricing used by the guard

| Model | Input / 1M | Cached input / 1M | Output / 1M |
|---|---:|---:|---:|
| gpt-5.6-terra | $2.00 | $0.20 | $12.00 |
| gpt-5.6-sol | $4.00 | $0.40 | $20.00 |

Pricing lives only in `_ai-cost-policy.ts`; environment overrides may raise a rate immediately but may not lower the reviewed baked-in rate.

## Deterministic/static CI evidence

The cost-guard suite proves:
- canonical pricing math;
- hard caps cannot be loosened by environment configuration;
- unknown model pricing fails closed;
- 20 representative zero-paid-call turns;
- 30 genuinely semantic turns are bounded to <= 1 paid call/turn;
- 20/50/100-turn conversations cannot reserve over $0.05;
- persistent duplicate-event replay avoids a second paid call;
- pre-call worst-case reservation blocks before OpenAI I/O;
- production semantic prompt stays inside normal/complex token targets;
- response composer has no OpenAI path;
- production has no paid reviewer/retry loop.

Final branch CI target: **all tests green**. The latest corrected-pricing stress run reported **1,596 turns across 100 conversations** with zero cap violations.

## 100-conversation corrected-pricing stress evidence

| Metric | Result |
|---|---:|
| Conversations | 100 |
| Customer turns | 1,596 |
| Paid calls | 398 |
| Calls / turn | 0.2494 |
| Zero-call turns | 75.06% |
| Average input tokens / paid call | 2,610.10 |
| p95 input tokens / paid call | 3,800 |
| Average output tokens / paid call | 177.47 |
| Total estimated cost | $2.925224 |
| Average cost / conversation | $0.029252 |
| p95 cost / conversation | $0.039800 |
| Maximum cost / conversation | **$0.041540** |
| Conversations above $0.05 | **0** |

The maximum observed synthetic conversation remains below the hard ceiling after correcting the canonical pricing table.

## Paid semantic certification evidence

Explicit certification mode (never customer production) has demonstrated:
- Open-world live language acceptance: **12 / 12**
- Frozen hidden open-world holdout: **12 / 12**
- Phase 6 live multi-turn semantic acceptance: **7 / 7**
- Phase 6 observed Terra primary calls: 7
- Phase 6 observed bounded Sol review calls: 2
- Business executor called during semantic certification: **no**

Certification-only Sol review is intentionally allowed to spend money; it is not reachable from ordinary customer production.

## Release status

Cost-guard implementation is ready only when the final PR-head workflows are green:
1. One Mind Branch CI
2. Netlify Build Command Guard
3. Phase 1 Live Language Acceptance (open-world + hidden holdout + Phase 6)

Production merge/deploy remains blocked pending explicit owner approval.
