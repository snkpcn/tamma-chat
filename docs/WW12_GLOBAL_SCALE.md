# WW-12 — Global Scale

Status: merged / awaiting production deploy
Date: 2026-10-04

## Goal

Close the Worldwide roadmap with a scale/safety layer above WW-0 through WW-11.

WW-12 is intentionally additive. It does not activate an uncertified country, invent a carrier rate, create a payment credential, or weaken the WW-11 country certification boundary.

WW-12 owns:

- CDN/cache policy for safe public static assets
- structured worldwide data-path observability
- optional read-replica routing for explicitly eventual-safe reads
- strong-consistency routing for price, payment, shipping, customs, certification, checkout and fulfillment truth
- final production fail-closed certification on every production build

## CDN / cache policy

HTML remains no-cache/revalidated.

Mutable translation/product scripts remain no-cache.

Safe static visual/style assets get bounded browser/CDN caching:

- brand / chess / Thongthai visual assets: browser 1 hour, CDN 24 hours, stale-while-revalidate 7 days
- styles: browser 5 minutes, CDN 1 hour, stale-while-revalidate 1 day

No transaction API response receives a public cache policy.

## Worldwide DB client

`_worldwide-db-client.ts` is the WW-12 server-only data-path boundary.

Rules:

- writes always use the primary database
- strong reads always use primary
- only callers explicitly marked `eventual` may use a replica
- missing/incomplete replica config automatically resolves to primary
- replica network/5xx failure may fall back to primary for GET/HEAD only
- request timeout is bounded
- traces log only operation/resource/route/status/latency; database keys and query values are not logged

Current eventual-safe caller:

- WW-1 market/country/currency/locale/capability reference context

Strong-consistency callers:

- WW-4 price truth
- WW-5 global payment truth
- WW-6 global shipping truth
- WW-7 customs truth
- WW-9 fulfillment truth
- WW-11 country certification truth

This means enabling a read replica later does not move transactional authority away from primary.

## Optional read replica

Environment contract:

- `SUPABASE_READ_URL`
- `SUPABASE_READ_SERVICE_ROLE_KEY`

Both must be configured before any read is routed to the replica.

If either is absent, all reads stay on primary.

WW-12 does not provision a paid replica by itself. The application is replica-ready without creating a new billable infrastructure resource.

## Observability

`# WW12_GLOBAL_SCALE_TRACE` emits structured events for:

- route: primary / replica
- safe replica fallback
- HTTP status
- request latency
- logical operation
- resource name only

With `TAMMA_WW_OBSERVABILITY_ENABLED=1`, all WW-12 client calls are traced.

When disabled, slow requests, failures, and replica fallbacks are still traced.

## Final production certification

`scripts/ww12-production-certification.mjs` is read-only.

On non-production builds it explicitly skips.

On Netlify production it blocks deployment if it detects:

- a live foreign market with no current WW-11 certification
- a first-wave KR / JP / US market still in certification state but exposing payment/shipping/customs/checkout/fulfillment capability
- a live global-v2 payment method attached to a non-live market
- a live global-v2 shipping service attached to a non-live market

The production gate is deliberately compatible with the current first-wave state: KR / JP / US may remain fail-closed while real product measurements, customs evidence, Stripe credentials, DHL credentials and country certification are completed later.

## First-wave relationship

WW-11 remains the launch authority for South Korea, Japan and the United States.

WW-12 does not bypass those missing facts.

When returning to real-country activation later, each country still needs the exact WW-11 evidence chain before checkout can become live.

## Pre-deploy production baseline

Read-only production check after merge:

- foreign markets: 3 (KR, JP, US)
- live foreign markets: 0
- live market without current certification: 0
- prelaunch exposed payment/shipping/customs/checkout/fulfillment capabilities: 0
- live global-v2 payment methods on non-live markets: 0
- live global-v2 shipping services on non-live markets: 0

This verifies the merged code/data baseline is still fail-closed before production publication.

## Definition of Done

- [x] bounded CDN/static cache policy
- [x] centralized worldwide DB route client
- [x] optional read-replica contract
- [x] primary-only strong transaction truth
- [x] safe replica fallback for GET/HEAD only
- [x] structured global scale traces
- [x] WW-12 audit in Netlify build gate
- [x] read-only production fail-closed certification gate
- [x] full repository CI passes
- [x] Netlify deploy preview passes
- [x] merged to main
- [ ] production deploy ready
- [ ] live production certification observed PASS
