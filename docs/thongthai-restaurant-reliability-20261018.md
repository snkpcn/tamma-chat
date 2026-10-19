# Restaurant conversation reliability — 2026-10-18

## Reported behavior

The production website intermittently timed out on child-friendly menu advice
and a three-person, 1,000-baht follow-up. A separate production API conversation
lost a two-adult, 500-baht, non-spicy dining request when a child was added.

## Changes

- Clear Thai read-only menu recommendations use the existing restaurant advisor
  and live menu source before paid Agent/semantic/composer attempts. This is a
  bounded route; ambiguous language, other domains, promotions, and transactions
  retain their existing interpretation and execution paths.
- Restaurant preference history contains customer statements only. An assistant's
  menu prices and serving counts cannot become the customer's budget/headcount.
  Parse `งบรวม`, Thai person counts, labelled adult/child counts, additions, and
  numeric budget corrections chronologically. Context recap does not query a
  model or create an order.
- Pass web history into One-Mind's semantic context when server discourse is
  absent. Bound/redact that history and discard messages before a reset. LINE
  can supply fresh user-only restaurant working memory from the existing state
  row. This evidence does not manufacture semantic intent or transaction state;
  newer canonical discourse and concrete preorder dialogs retain precedence.
- Independent startup records and independent menu/profile reads run concurrently.
  Response-telemetry writes retain two idempotent attempts, with a one-second
  deadline per attempt instead of 2.5 seconds. A diagnostic write failure does
  not discard a successful grounded restaurant answer. Paid-call accounting
  retains its existing policy.
- Live menu failure returns an honest unavailable answer without a second paid
  attempt or invented menu/price. Provenance is recorded as
  `restaurant_grounded_read_only`, with whether knowledge was supplied and
  whether the turn used a model.
- The website allows one message in flight, releases controls on success/failure,
  and excludes transport-error copy from future conversation evidence.

## Validation

- Full `npm test`: 2,963 passed / 2,964 tests.
- The one failure is the existing Owner project test
  `LINE flow previews and confirms four tasks once, then completes only the selected task`.
  A separate checkout of untouched `origin/main` (`50333bea`) reproduces the same
  assertion at `tests/owner-project-os.test.ts:226`. Its fixed fixture draft expiry
  is October 13 while the current date is October 18. No Owner workflow source
  was changed for this work.
- New tests cover the screenshot sequence, web/LINE count/budget/spice continuity,
  zero paid model requests for grounded menu advice, assistant-price contamination,
  source/telemetry outages, history delivery to the semantic boundary, redaction,
  reset/expiry/precedence, and browser request serialization/recovery.
- Netlify chat function bundles successfully with esbuild for Node 20; all inline
  website scripts parse. `git diff --check` passes.

These tests use mocked backends/providers. They do not establish production
latency, production menu data quality, or actual billed conversation cost.

## Release status

Local changes only. No Netlify CLI/site link/authentication or production backend
credentials are configured in this session, so deployment and authenticated live
verification have not been performed. The existing local reliability/budget and
monitor work was preserved; its monitor migration remains unapplied by this work.
After release, repeat both customer sequences on the website and LINE, inspect
source/latency/cost records, and verify that source failure does not create an
order or trigger another paid attempt.
