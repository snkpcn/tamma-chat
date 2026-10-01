# Thongthai Production Agent Canary

Production rollout configuration (2026-10-01):

- Saved Agent: `Thongthai-Production`
- Model: `gpt-5.6-terra`
- Primary channels: WEB, LINE, Facebook
- WEB rollout: 100% of eligible guests
- LINE rollout: 10% read-only canary
- Facebook rollout: 10% read-only canary
- Legacy global rollout fallback: 10%
- Agent transaction tools: not exposed in the production saved Agent
- Live Agent transaction flag: OFF
- Weather, verified location, and transaction intents remain on the established core paths
- Safety, escalation, and service-feedback guardrails run before Agent routing
- Primary Agent failures do not cascade into a second paid LLM call on the same turn
- Owner cost ceiling remains 5 THB per customer conversation

Rollout history:

- 10% production canary: passed initial smoke verification with Agent responses persisted, telemetry marked `agent_primary_turn_aggregate`, no non-completed Agent cost events, and no conversation over the 5 THB cap.
- 25% production canary: promoted after the 10% verification gate.
- During 25% verification, one successful Agent turn exposed a telemetry persistence gap: the Saved-Agent session had a real cost but `ai_api_cost_events` missed the row. PR #374 added retry plus fail-safe pending accounting before any further paid Agent turn.
- Post-hotfix 25% verification recorded 4/4 fresh production Agent responses with matching cost rows, all grounded, 0 non-completed events, total 4.6809 THB and max 1.2898 THB for any tested turn.
- 50% production canary: promoted after the post-hotfix 25% telemetry/cost gate.
- New 25-50% cohort verification: two fresh production guests in buckets 2590 and 4241 both routed to `thongthai_agent_primary`, both grounded, with matching cost rows of 1.1170 THB and 1.0268 THB.
- 100% eligible WEB rollout: promoted after the new 50% cohort verification gate.
- New >50% cohort verification: a fresh WEB guest in bucket 7344 passed 3/3 production turns; the two paid turns both routed to `thongthai_agent_primary`, both were grounded, with matching completed cost rows of 1.0272 THB and 0.3420 THB (1.3692 THB total), and no false transaction was detected.
- Per-channel rollout support: WEB keeps 100% while LINE and Facebook begin at 10%, without reducing the proven WEB rollout.

This file also records the environment-configuration deployment point so the Netlify production functions are rebuilt after each canary percentage change.
