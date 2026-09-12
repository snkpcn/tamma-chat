# THONGTHAI BRAIN

Canonical architecture for the central intelligence of **ทำมา-ชาติ — Experiences of Isan**.

## Core rule

ทองไทย is one mind. Website, LINE, Facebook/Messenger, backoffice and future channels are adapters around the same brain; never create a separate personality/prompt/agent per channel.

Flow:

`Channel adapter -> thongthai-chat -> Identity -> Customer memory -> Brain -> Tools -> Brain finalization -> Channel response`

## Production components

- `netlify/functions/_thongthai-brain.ts` — identity/personality, judgment policy, model orchestration, output validation, tool planning.
- `netlify/functions/_thongthai-runtime.ts` — persistent working state, semantic travel memory, verified world facts, tool execution.
- `netlify/functions/_thongthai-identity.ts` — resolves channel-local aliases to the canonical anonymous guest.
- `netlify/functions/thongthai-chat.ts` — single public brain gateway used by all channels.
- `netlify/functions/_customer-db.ts` — structured guest profile + Journey persistence.
- `netlify/functions/line-webhook.ts` — LINE adapter only; business intelligence stays in the brain.
- `netlify/functions/line-link.ts` — signed LINE/web identity linking and Brain V2 memory merge.
- `src/data/experiences.ts` — verified experience catalog.
- Supabase `world_facts` + verified `community_offerings` — mutable source of truth for live business knowledge.

## Personality contract

ทองไทย is warm, perceptive, playful in a restrained way, modern-Isan, and quietly confident. It is not a generic support bot and not a pushy sales bot.

Customer-facing Thai must be polite. Never use `กู` or `มึง`. Light Isan wording is seasoning, not a caricature. Never force the same closing question, CTA, response layout or phrase across turns.

Variation must come from context, memory, channel, active Journey and the guest's needs — not randomness. Facts stay consistent even when wording and emphasis differ.

## Memory model

### Structured memory

`guest_memory` stores only travel-relevant structured fields such as traveler type, duration, group, interests, pace, constraints, favorites and visited experiences.

### Semantic travel memory

`guest_semantic_memory` stores durable travel/experience preferences only, with source channel, confidence, evidence count and timestamps. Allowed keys are deliberately narrow. Do not store raw chat, contact details, medical data, secrets, payments or unrelated personal information.

### Working state

`guest_agent_state` stores compact travel-only conversational state such as active topic, travel summary, unresolved need, previous response style and brain version. It is working memory, not a transcript.

### Identity

`guest_identities` maps channel-local anonymous aliases to the same canonical guest. Raw provider IDs must be transformed by the channel adapter before reaching the brain. LINE already uses a deterministic UUID-shaped hash and never persists the raw LINE user id.

## World model

`world_facts` is the verified mutable source of truth for brand/location/ecosystem facts. A fact absent from verified data must not be invented. Prices, opening hours, availability, weather, travel time, phone numbers and exact address must be treated as unknown unless verified data exists.

Specific community/OTOP offerings can be recommended only when they are active + verified in `community_offerings`.

## Agent loop

For each turn, silently:

1. Understand the current request before old context.
2. Resolve the canonical guest.
3. Load only relevant structured memory, semantic travel memory, working state, Journey and verified world facts.
4. Decide whether a real action is needed.
5. Execute the smallest necessary tool.
6. Feed tool results back to the brain for final wording.
7. Persist structured state and compact travel memory.
8. Return only public response fields to the channel. Never expose internal reasoning or tool instructions.

## Current real tools

- save Journey
- favorite experience
- unfavorite experience
- mark experience visited
- create pending human handoff request

Tool execution happens server-side. A second model pass may phrase the result, but it is not allowed to change the structural decision that was already executed.

## Journey continuity

The most recent Journey is loaded as working Journey context across turns/channels; the latest explicitly saved Journey remains separately available. A factual/casual message must not modify a Journey merely because one exists.

## Adding a new platform

A new platform should only:

1. verify its webhook/request,
2. transform its raw user id to a privacy-safe stable key,
3. call `/.netlify/functions/thongthai-chat`,
4. set `pageContext.section` to its channel name,
5. render the returned public response in platform-native UI.

Do **not** copy the Brain prompt or implement a separate decision tree in the adapter.

## Data / infrastructure rule

Canonical repo: `snkpcn/tamma-chat`.
Canonical production: `https://tamma-chat.netlify.app/`.
Canonical customer database: existing Supabase project `tamma-customer-data`.

Do not create a new repo, Netlify site, Supabase project or separate Thongthai brain for a new channel.
