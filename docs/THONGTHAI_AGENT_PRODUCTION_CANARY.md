# Thongthai Production Agent Canary

Initial production rollout configuration (2026-10-01):

- Saved Agent: `Thongthai-Production`
- Model: `gpt-5.6-terra`
- Primary channel: WEB only
- Stable canary: 10% of guests
- Agent transaction tools: not exposed in the production saved Agent
- Live Agent transaction flag: OFF
- Weather, verified location, and transaction intents remain on the established core paths
- Safety, escalation, and service-feedback guardrails run before Agent routing
- Primary Agent failures do not cascade into a second paid LLM call on the same turn
- Owner cost ceiling remains 5 THB per customer conversation

This file also records the environment-configuration deployment point so the Netlify production functions are rebuilt after the canary variables are installed.
