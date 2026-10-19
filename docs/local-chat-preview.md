# Local Thongthai preview

All modes run the edited website and canonical chat handler with the existing
in-memory backend fixtures. Menu prices, stock and orders are simulated, and
state disappears when the server exits. No production database or LINE writes.

Offline mode: `npm run preview:chat`, then open http://127.0.0.1:4173.

For KKU IntelSphere, put the following in the Git-ignored `.env.local` file:

```dotenv
KKU_API_KEY=your-key-here
THONGTHAI_SEMANTIC_MODEL=gpt-5.6-terra
THONGTHAI_SEMANTIC_REVIEW_MODEL=gpt-5.6-terra
```

Run `npm run preview:chat:kku`, then open http://127.0.0.1:4174.
Keep that terminal open. Stop with Ctrl+C. Restart after changing `.env.local`.

KKU base URL supplied by the user: https://gen.ai.kku.ac.th/api/v1.
Unauthenticated inspection on 2026-10-18 confirmed `/models` lists
`gpt-5.6-terra`, `/chat/completions` rejects an unkeyed POST with HTTP 401,
and `/responses` returns HTTP 404. The preview translates the application's
Responses requests into Chat Completions and maps standard token usage back.
It passes the JSON schema as instructions, since structured-output parameter
support has not been verified on this gateway. Application validation still
checks the returned JSON. Authenticated KKU generation was verified on
2026-10-18 against the brand overview, location, and opening-hours sequence.
Brand overview now receives the registered canonical ecosystem graph. Owner-confirmed brand text, location (ตาดโตน • ชัยภูมิ), and regular venue
hours (daily 06:00–18:00 Asia/Bangkok) are registered separately as organization
configuration. Exact regular venue-hours questions need no model call. These
hours do not establish individual business-unit schedules, live opening status,
or special holiday exceptions.

The ecosystem and owner-hours fixes passed 2,993 of 2,994 full-suite tests.
All 25 targeted ecosystem/owner-hours checks passed, and an HTTP request to
the running KKU preview returned the configured regular hours without a model call. The remaining
Owner project draft-expiry failure is the previously verified baseline issue.

The pet-permission screenshot exposed a separate routing defect: the language
model correctly returned `informationNeed: policy`, but the dialog planner
requested the ecosystem catalog and the fallback listed business names. Identity
and policy adapters are now separate. Explicit information facets (policy,
schedule, price, availability, inventory and ingredients) cannot fall back to the
identity catalog. Local/general venue-policy interpretations also request policy
knowledge, and restaurant policies do not query the menu catalog.

The user subsequently supplied a dog-access policy for the Inthanin Tadtone
outdoor/camping area. This has its own organization-configuration source ID,
separate from identity, menu and branch-profile facts. Its deterministic answer
includes the indoor exclusion, continuous leash use around horses/other guests,
and cleanup requirement. Exact dog-access questions need no model call; broader
model-understood policy questions still use the same grounded policy renderer.
The live local preview returned all of these conditions. This policy does not
establish permission for cats/other species, accommodation, the restaurant or
other branches. Unsupported scopes remain unverified. A catalog is not
permission evidence.

The API key is sent only to the KKU chat endpoint. Redirects and other outbound
destinations are blocked. Token usage comes from the gateway when available;
the application's baht estimate uses its configured pricing and is **not verified
KKU billing**. Quotas, timing and model behavior may differ from production.

Direct OpenAI preview remains available via `OPENAI_API_KEY` and
`npm run preview:chat:ai`, also on port 4174. Run one AI preview at a time.
No keys are served to the browser. The visible preview banner identifies the
selected provider and fixture data mode.

User-supplied Inthanin Tadtone branch details (2026-10-18) are stored separately
from overall venue configuration: Na Fai, Mueang Chaiyaphum; left side when
approaching from Chaiyaphum Rajabhat University before the Tat Ton National Park
ascent; daily 06:00–18:00; spacious/shaded setting with camping, garden,
artificial-waterfall and small-pond photo areas. The Facebook reference was
supplied as an excerpt and was not independently verified. Branch profile facts
have their own source ID. Exact named-branch questions about regular hours,
location/directions and atmosphere are read-only and need no model call.
The location path supplies the address/directions without inventing a map pin.
Other branches, pet rules, special-date hours, riding prices and evening-zone
availability are not established by this profile (dog rules have their own
subsequently supplied policy source). The approximate riding price
and conditional evening claim remain review notes, excluded from grounded facts.

Branch-profile validation: 114 targeted routing/composer/concierge checks passed;
16 final profile/menu wiring checks passed after updating the existing source
assertion for the added profile adapter. Three HTTP questions to the running
KKU preview returned hours, address/directions and atmosphere successfully.
The broad suite also encountered the known Owner draft-expiry failure and an
unrelated Owner clickthrough worker crash; the latter passed all 24 checks
when rerun alone. No deployment was performed.

Screenshot follow-up: the generic local-concierge location path previously
returned only the canonical Maps link because its coordinate-resolution flag
was still unresolved. It now also renders the supplied venue area and named
Inthanin arrival landmark/address/directions; coordinates remain unasserted.
Short location wording (including พิกัด and ที่ตั้ง) uses the same path.
A narrow read-only cart/wheelchair/stroller loan question now asks the facility
knowledge route instead of the identity catalog. No facility source is
registered, so its deterministic answer states that loan/rental information is
unverified and advises checking with staff before travelling. It never claims
that a wheelchair exists, is absent, is free, or that staff were contacted.
The three-message screenshot sequence passed through the running local preview
and both web/LINE test harnesses without model calls. The related targeted
suite passed all 138 checks.

The customer-supplied 28-question corpus is now in
`tests/fixtures/visitor-basic-questions.ts`. The bounded visitor-information
handler runs before cafe-keyword and escalation fallbacks. It answers brand
identity/relationships from canonical configuration, reads food/product lists
and configured stay rates from the existing knowledge adapters, and names
missing operational fields without inventing a fee, opening status, accessibility
claim, safety rule, refund rule or shipping rate. This route writes conversation
context and response telemetry only; it never starts a booking or staff request.
The child/non-spicy question uses the existing ingredient-aware restaurant
advisor rather than unfiltered model composition. A question mark no longer
excludes an exact regular-hours query.

`npm run eval:visitor:local` replays all 28 questions against localhost.
`npm run eval:visitor:local -- --conversation` tests the same questions in one
conversation. Both HTTP runs passed all 28 routing/content checks with no paid
model calls. This is NOT proof that missing business facts are known or that
fixture prices are real. See `visitor-basic-questions-report.md` for actual
answers and `visitor-information-needed.md` for the remaining source data.

Paraphrase interpretation is enabled in the local preview. Deployment must
explicitly set `THONGTHAI_VISITOR_UNDERSTANDING=1`. See
`visitor-paraphrase-validation.md` for the staged rollout, model/cache/context
boundaries, validation results, and the current KKU 401 revalidation blocker.
Use `npm run eval:visitor:local -- --paraphrases` for the alternative-wording
corpus; add `--conversation` to send it as one conversation. Exact/basic facts
still take the no-model path. Authentication failures stop further model calls
for that turn, and a paid interpretation cannot leave a zero-cost response row.

The additional user-supplied cafe facts (2026-10-18) live in
`netlify/functions/_user-supplied-venue-facts.ts`: free cafe/garden admission,
front parking with accessible spaces near the cafe ramp, accessible toilets,
and food/bakery examples. These describe the cafe approach, not accessibility
of every activity or accommodation area, and do not establish wheelchair loans.
Menu examples are not injected into orderable inventory or allergen guarantees.
Cafe prices use backend facts first; otherwise the answer explicitly labels the
supplied figures as references awaiting Tadtone branch confirmation. Prices
from other branches are not presented as current Tadtone prices. The supplied
500-baht/90-minute horse quote remains a reference where backend packages differ;
it cannot replace the backend offering or authorize a booking.

Validation of these additions: 254 related checks and 39 final targeted checks
passed. Seven local HTTP questions returned the new facts without model calls.
The preview still uses fixture backend data; these checks do not verify actual
availability, current branch prices, or the KKU connection. No deployment made.
The subsequent broad run passed 3,197 of 3,200 checks: a localhost-listener
sandbox restriction, an older generic-parking expectation, and the known Owner
draft-expiry baseline failed. The parking test now explicitly asks about stay
parking (still unknown); the facility/source tests and backend-deadline test
passed together when rerun with localhost permission. The Owner expiry issue
remains outside this change.

Public-web fallback is now implemented but has no search key configured.
See [visitor-web-search.md](visitor-web-search.md) for supported questions,
source checks, the separate Tavily key, shared two-baht budget, and the prepared
production cost-provider migration. KKU is not used to generate web claims.
