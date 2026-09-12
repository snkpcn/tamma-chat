# THONGTHAI BRAIN

Canonical architecture for the central intelligence of **ทำมา-ชาติ — Experiences of Isan**.

## Core rule

ทองไทย is one mind. Website, LINE, Facebook/Messenger, backoffice and future channels are adapters around the same brain; never create a separate personality/prompt/agent per channel.

Flow:

`Channel adapter -> thongthai-chat -> Identity -> Customer memory -> Brain -> Tools -> Operational DB -> Brain finalization -> Channel response`

## Production components

- `netlify/functions/_thongthai-brain-v3.ts` — current operations-capable identity/personality, judgment policy, model orchestration, output validation and tool planning.
- `netlify/functions/_thongthai-runtime-v3.ts` — persistent working state, semantic travel memory, verified world facts and real tool execution.
- `netlify/functions/_operations-db.ts` — encrypted customer identity, booking schedules, reservations, café inquiries, OTOP orders and authenticated customer portal data.
- `netlify/functions/_thongthai-identity.ts` — resolves channel-local aliases to the canonical anonymous guest.
- `netlify/functions/thongthai-chat.ts` — single public brain gateway used by all channels.
- `netlify/functions/customer-account.ts` — authenticated customer profile/account API.
- `account.html` — real email/password customer signup/login and self-service account view using Supabase Auth.
- `netlify/functions/_customer-db.ts` — structured guest profile + Journey persistence.
- `netlify/functions/line-webhook.ts` — LINE adapter only; business intelligence stays in the brain.
- `netlify/functions/line-link.ts` — signed LINE/web identity linking and Brain memory merge.
- `src/data/experiences.ts` — verified experience catalog.
- Supabase `world_facts` + verified `community_offerings` — mutable source of truth for live business knowledge.
- Supabase operational tables — customer accounts, schedules, bookings, inquiries, products/orders, contact logs and backoffice activity.

## Personality contract

ทองไทย is warm, perceptive, playful in a restrained way, modern-Isan, and quietly confident. It is not a generic support bot and not a pushy sales bot.

Customer-facing Thai must be polite. Never use `กู` or `มึง`. Light Isan wording is seasoning, not a caricature. Never force the same closing question, CTA, response layout or phrase across turns.

Variation must come from context, memory, channel, active Journey and the guest's needs — not randomness. Facts stay consistent even when wording and emphasis differ.

## Memory model

### Structured travel memory

`guest_memory` stores only travel-relevant structured fields such as traveler type, duration, group, interests, pace, constraints, favorites and visited experiences.

### Semantic travel memory

`guest_semantic_memory` stores durable travel/experience preferences only, with source channel, confidence, evidence count and timestamps. Allowed keys are deliberately narrow. Do not store raw chat, contact details, medical data, secrets, payments or unrelated personal information.

### Working state

`guest_agent_state` stores compact travel-only conversational state such as active topic, travel summary, unresolved need, previous response style and brain version. It is working memory, not a transcript.

### Customer account / PII

Personally identifying operational data is deliberately separate from Thongthai's conversational memory.

`customer_accounts` links a Supabase Auth user and/or anonymous guest to encrypted service-contact data. Names, email addresses, phone numbers and shipping addresses are encrypted server-side with AES-256-GCM. Email/phone lookup hashes are one-way SHA-256 hashes. Browser clients never receive the Supabase service-role key or the encryption key.

Customer passwords are handled only by Supabase Auth; they never pass through the Thongthai prompt or customer operational tables.

### Identity

`guest_identities` maps channel-local privacy-safe aliases to the same canonical guest. Raw provider IDs must not enter semantic/working memory.

## World model

`world_facts` is the verified mutable source of truth for brand/location/ecosystem facts. A fact absent from verified data must not be invented. Prices, opening hours, availability, weather, travel time, phone numbers and exact address must be treated as unknown unless verified data exists.

Specific community/OTOP offerings can be recommended only when verified. Orderable products additionally require an active, verified row in `otop_products` for the live environment.

## Agent loop

For each turn, silently:

1. Understand the current request before old context.
2. Resolve the canonical guest.
3. Load only relevant structured memory, semantic travel memory, working state, Journey and verified world facts.
4. Decide whether a real action is needed.
5. If availability/stock is needed, query the operational database rather than guessing.
6. Execute the smallest necessary tool.
7. Feed the tool result back to the brain for final wording.
8. Persist structured state and compact travel memory separately from encrypted operational PII.
9. Return only public response fields to the channel. Never expose internal reasoning or tool instructions.

## Real operational tools

Current production Brain V3 can:

- query restaurant / stay / activity schedules
- create a requested restaurant booking
- create a requested stay booking across one or more nightly allocations
- create a requested activity booking
- create a café staff-follow-up inquiry when a verified answer is unavailable or human contact is requested
- list verified live OTOP products
- create a requested OTOP order
- save Journey
- favorite / unfavorite experiences
- mark an experience visited
- create a pending human handoff request

Tool execution happens server-side. A second model pass phrases the actual result but cannot claim an action succeeded if the tool failed.

## Booking truth model

A customer request is **not** a confirmed reservation merely because Thongthai accepted the message.

Operational states:

`requested -> confirmed -> completed`

with cancellation / no-show states when applicable. Staff confirms requests in backoffice.

Restaurant and activity capacity is allocated against a real schedule slot. Stay reservations allocate capacity across each nightly schedule row. Database triggers lock/update reserved capacity to prevent simple overbooking races.

No live schedule is invented. Test/demo schedules live in `environment='test'`; customer-facing tools query only `environment='live'`.

## OTOP stock truth model

Customer-facing order tools query only active + verified + live products. Stock is decremented by a database trigger that locks the product row. Cancelling an order restores stock. Test products/orders remain in `environment='test'` and never appear to ordinary customer tools.

## Customer portal

Official account portal:

`https://tamma-chat.netlify.app/account.html`

Customers can create a real Supabase Auth account, save encrypted contact information, and view their own bookings, OTOP orders and café inquiries. The portal links the authenticated account back to the existing anonymous guest when `tamma_guest_id` is present.

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

Canonical customer repo: `snkpcn/tamma-chat`.
Canonical customer production: `https://tamma-chat.netlify.app/`.
Canonical customer database: existing Supabase project `tamma-customer-data`.
Existing separate backoffice Netlify site remains `tamma-backoffice`; do not create another backoffice site or database.

Do not create a new repo, Netlify site, Supabase project or separate Thongthai brain for a new channel or operational feature.
