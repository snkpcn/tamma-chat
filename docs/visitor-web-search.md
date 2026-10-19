# Public-web fallback

Added locally on 2026-10-18; not deployed. A search provider key has **not**
been configured and real provider access has **not** been tested.

The visitor handler first uses configured venue facts and backend adapters.
Missing supported public fields then use Tavily basic search. This covers
missing facility/accessibility information, published restaurant/activity/stay
opening announcements, packages, cafe price references, food/product catalogs,
and the conflicting horse package reference. Additional bounded public
questions include WiFi, EV charging, contact channels, playgrounds, smoking
areas and work/power facilities. This is not an unrestricted web agent for
every possible question.

Results must match the venue name, Tadtone and Chaiyaphum, the requested topic,
and any explicitly requested business unit. Only HTTPS Facebook, Wongnai and
Inthanin pages are accepted. These are public references, not automatically
verified owner statements: a relevant review can still be outdated or wrong.
The reply preserves known facts, quotes at most two short search excerpts,
includes direct source URLs, the search date and any supplied publication date,
and keeps the unresolved fields unresolved. It does not claim to have opened
and independently verified the full pages. No model synthesizes extra claims.

Live room availability, stock, personal bookings, shipping quotes, allergen
guarantees, individual riding safety, and refund permissions still require
backend/owner confirmation. Search never creates orders, bookings or staff
messages. Photo-only activity requests and known branch information retain
their existing handlers. Missing configuration leaves those handlers intact.

Queries are assembled from fixed public topic phrases and venue identifiers;
customer messages/history, phone numbers, names and private backend facts are
not sent. No arbitrary page URLs are fetched. Search results are treated as
untrusted text, never instructions or executable tools.

## Local setup

In the ignored `tamma-chat/.env.local`, fill `TAVILY_API_KEY` and set
`THONGTHAI_VISITOR_WEB_SEARCH=1`. These placeholders have been added without
changing existing KKU settings. A KKU key does not authenticate Tavily. Keep
both keys server-side and out of chat/browser files. Restart the existing
preview with `npm run preview:chat:kku`. Search itself does not need a working
KKU connection. `/preview-info` exposes only whether search is configured.

For a search-only preview without model calls, load `.env.local` and run:

```sh
node --env-file=.env.local --import tsx scripts/preview-thongthai.ts
```

This uses port 4173 by default and fixture backend data. Known questions such
as opening hours should not search. A question like `มี WiFi ให้ใช้ไหม`
exercises the public fallback when configured. No matches or provider failures
remain an honest unknown; logs distinguish them from missing configuration.

## Cost and deployment

The same persistent CAS ledger reserves search credits alongside model spend
before calling the provider, under the existing <=2-THB customer conversation
ceiling. Basic search reserves at least USD 0.008 (about THB 0.288 at the app's
36-THB reporting exchange rate), including failures whose billing is unknown.
This is a conservative application estimate, not verified provider billing.
`THONGTHAI_WEB_SEARCH_COST_USD` may raise that estimate, never lower its floor.
Tavily's [API contract](https://docs.tavily.com/documentation/api-reference/endpoint/search)
and [credit pricing](https://docs.tavily.com/documentation/api-credits) were
checked on 2026-10-18; review this estimate if vendor pricing changes.

No model answer generation, auto-selected search depth, raw-page extraction or
automatic HTTP retry is enabled. A bounded 10-minute in-process cache includes
no-match results. Concurrent searches in one conversation are deduplicated;
persistent event replay avoids rebilling the same event after process restart.
Replay of a paid event still marks that response turn as nonzero cost.
Cache expiry/another server may require another search, still budget guarded.

Before a production release, apply the prepared migration
`20261018120000_web_search_cost_provider.sql` to allow `tavily` in cost history,
and configure the two search variables on the server. The migration has not
been applied. Logs expose search status, cache/charge flags, source URLs,
missing fields and checked date; cost events identify provider `tavily` and
model/service `tavily-basic`. Search failures never expose provider bodies or
keys to customers.

## Validation

The initial related routing, cost, monitoring and preview regression passed
199/199 checks. After concurrency/replay coverage and preserving downstream
branch/activity handlers, the final targeted run passed 89/89 checks. Tests use
mocked search responses: both web and LINE, source/branch/unit mismatches,
privacy of queries, cache/no-match behavior, event replay, budget exhaustion,
and 401/429/timeout/malformed responses. The server bundle builds successfully;
`git diff --check` passes. A standalone TypeScript check remains blocked by the
existing `ScopableFact[]`/`GroundedFact[]` mismatch at `_knowledge-resolver.ts:388`.
The running preview reports `webSearch: not_configured`, as expected without
a search key. No real Tavily request or KKU revalidation was performed.
Final full suite: 3,210/3,211 passed. The sole failure is the previously known
Owner project draft-expiry assertion in `owner-project-os.test.ts`, unrelated
to visitor search; no search/routing/cost failures remain.
