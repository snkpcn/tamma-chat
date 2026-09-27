# Thongthai AI Cost Guard — Certification Checkpoint

Source checkpoint: `af0b356dced5443ca5cfa8be4d977e1b4f2ddb36`

## Production contract

- Default conversation ceiling: `$0.05`.
- Maximum paid semantic calls per customer turn: `1`.
- Maximum configured calls per conversation: `6`; pre-call worst-case reservation blocks earlier when the dollar ceiling would be crossed.
- Semantic request limits: at most `5,000` estimated input tokens and `400` output tokens.
- Customer production uses one Terra semantic boundary. Sol review is excluded from production and remains available only in explicit certification mode.
- Every paid request reserves worst-case cost before network I/O.
- Duplicate Web/LINE event IDs replay the persisted semantic result without a second paid call.
- Budget exhaustion and provider failure fall back to deterministic/context-safe handling; uncertain meaning asks for clarification and cannot execute a transaction.
- Full customer prompts and secrets are not written to cost telemetry.

## Deterministic CI evidence

GitHub Actions: One Mind Branch CI #679.

- Tests: `1,388 / 1,388`
- Failures: `0`
- Netlify build-command guard: pass

## 100-conversation stress evidence

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
| Total estimated cost | $2.642696 |
| Average cost / conversation | $0.026427 |
| p95 cost / conversation | $0.035460 |
| Maximum cost / conversation | $0.037140 |
| Conversations above $0.05 | **0** |

The synthetic mix includes deterministic and difficult semantic turns across restaurant, stay, activities/horses, availability, recommendations, corrections, follow-ups, booking progression, cancellation, and topic changes.

## Remaining release gate

Run the paid live semantic regression, frozen hidden holdout, and Phase 6 multi-turn acceptance once on the final checkpoint. Production merge/deploy remains intentionally blocked pending owner approval.
