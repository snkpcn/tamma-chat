# Thongthai Production Agent Canary

Production rollout configuration (2026-10-01):

- Saved Agent: `Thongthai-Production`
- Model: `gpt-5.6-terra`
- Primary channel: WEB only
- Stable canary: 50% of guests
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

This file also records the environment-configuration deployment point so the Netlify production functions are rebuilt after each canary percentage change.
