# Thongthai Production Agent Canary

Production rollout configuration (2026-10-01):

- Saved Agent: `Thongthai-Production`
- Model: `gpt-5.6-terra`
- Primary channels: WEB, LINE, Facebook
- WEB rollout: 100% of eligible guests
- LINE rollout: 100% read-only
- Facebook rollout: 100% read-only
- Legacy global rollout fallback: 10%
- Agent transaction tools: `prepare_*` and `get_prepared_*` exposed; all `commit_prepared_*` tools absent
- Prepare-only public rollout: 0%; one synthetic WEB certification guest allowlisted
- Live Agent transaction/commit flag: OFF
- Weather and verified location remain on established core paths; non-allowlisted transaction intents remain on established executors
- Safety, escalation, and service-feedback guardrails run before Agent routing
- Primary Agent failures do not cascade into a second paid LLM call on the same turn
- Owner cost ceiling remains 5 THB per customer conversation

Rollout history:

- 10% production canary: passed initial WEB smoke verification with Agent responses persisted, telemetry marked `agent_primary_turn_aggregate`, no non-completed Agent cost events, and no conversation over the 5 THB cap.
- 25% WEB production canary: promoted after the 10% verification gate.
- During 25% WEB verification, one successful Agent turn exposed a telemetry persistence gap: the Saved-Agent session had a real cost but `ai_api_cost_events` missed the row. PR #374 added retry plus fail-safe pending accounting before any further paid Agent turn.
- Post-hotfix 25% WEB verification recorded 4/4 fresh production Agent responses with matching cost rows, all grounded, 0 non-completed events, total 4.6809 THB and max 1.2898 THB for any tested turn.
- 50% WEB production canary: promoted after the post-hotfix 25% telemetry/cost gate.
- New WEB 25-50% cohort verification: two fresh production guests in buckets 2590 and 4241 both routed to `thongthai_agent_primary`, both grounded, with matching cost rows of 1.1170 THB and 1.0268 THB.
- 100% eligible WEB rollout: promoted after the new 50% cohort verification gate.
- New WEB >50% cohort verification: a fresh guest in bucket 7344 passed 3/3 production turns; the two paid turns both routed to `thongthai_agent_primary`, both were grounded, with completed cost rows of 1.0272 THB and 0.3420 THB (1.3692 THB total), and no false transaction was detected.
- Per-channel rollout support: WEB remains at 100% while LINE and Facebook can be rolled independently.
- LINE 10% read-only verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0298 THB and 0.3227 THB (1.3525 THB total).
- Facebook 10% read-only verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0335 THB and 0.3266 THB (1.3601 THB total).
- LINE and Facebook promoted to 25% read-only after the 10% cross-channel gate passed.
- LINE 10-25% cohort verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0257 THB and 0.3258 THB (1.3515 THB total).
- Facebook 10-25% cohort verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0241 THB and 0.3281 THB (1.3522 THB total).
- LINE and Facebook promoted to 50% read-only after the new 25% cohort gate passed.
- LINE 25-50% cohort verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0276 THB and 0.3243 THB (1.3519 THB total).
- Facebook 25-50% cohort verification: 3/3 production turns passed; the two paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0313 THB and 0.3208 THB (1.3521 THB total).
- LINE and Facebook promoted to 100% read-only after the new 50% cohort gate passed.\n- Final LINE >50% cohort verification: a fresh guest in bucket 8381 passed 3/3 production turns; both paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0302 THB and 0.3300 THB (1.3602 THB total).\n- Final Facebook >50% cohort verification: a fresh guest in bucket 5301 passed 3/3 production turns; both paid turns were grounded `thongthai_agent_primary` responses with completed cost rows of 1.0309 THB and 0.3299 THB (1.3608 THB total).\n- Read-only Saved Agent rollout is now verified at 100% for WEB, LINE, and Facebook; live Agent transactions remain OFF.\n
- Production certification exposed a prepare-routing bug: an ordinary affirmative `ขอจอง...` request reached the Saved Agent but runtime kept transaction mode OFF. PR #388 fixed the gate by reusing the existing fail-closed standalone transaction-request parser; booking questions and `ยังไม่จอง` remain excluded.
- Synthetic prepare certification guest rotated before re-test; public prepare rollout remains 0% and live commit remains OFF.

- Fast-prepare latency fix: production Saved Agent profile v3 instructs direct self-validating `prepare_*` calls when all required fields are already present, avoiding redundant catalog/availability tool rounds.
- Fresh latency certification uses one synthetic WEB guest while public prepare rollout remains 0% and live commit remains OFF.

This file also records the environment-configuration deployment point so the Netlify production functions are rebuilt after each canary percentage change.
