# Thongthai V5 Owner Certification — Round 2 Trigger

This is an operations-only checkpoint used to trigger the existing production owner-certification workflow after PR #535 was merged.

Scope:
- Thongthai certification only.
- No WW implementation is duplicated or changed by this checkpoint.
- No runtime code, database schema, booking/order/payment logic, or production configuration changes are introduced here.

Expected production gate:
1. Netlify production contains PR #535.
2. Replay the unchanged 15-turn owner acceptance conversation.
3. All 15 turns must pass.
4. Real customer-conversation AI cost remains below the owner's 5 THB ceiling.
5. The LINE idle cost notification must report the full conversation total.

The merge commit for this checkpoint intentionally contains the phrase `Thongthai V5 Owner Acceptance` so the repository's existing `thongthai-v5-owner-production-certification.yml` workflow runs against production.
