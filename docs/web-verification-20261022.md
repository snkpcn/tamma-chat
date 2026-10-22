# Web verification — 22 October 2026

## Scope and result

The edited canonical web handler was exercised over actual localhost HTTP requests, using the repository's existing preview server. This verifies the local endpoint and a small real-provider conversation. It does not certify the hosted deployment, production data, production latency, production billing, frontend interaction in a browser, or LINE delivery.

Production Supabase access is still unavailable: the user's attempted connector authorization returned an insufficient-privileges error. No hosted migration or production publish was performed. The Netlify draft remains separate from the live site.

## Local test suite

The full suite ran 3,469 cases: 3,468 passed and one failed because the sandbox refused its localhost listener (`listen EPERM`). The affected file, `tests/backend-fetch.test.ts`, was rerun with localhost permission and both of its cases passed. No test or production code was changed to obtain this result. Thus every case was verified across these runs; this was not a single uninterrupted 3,469-pass run.

Local evidence:

- `/private/tmp/tamma-web-verification-20261022-tests.log`
- `/private/tmp/tamma-web-backend-fetch-20261022-tests.log`

## HTTP verification without AI

The offline preview at `http://127.0.0.1:4173` uses in-memory fixture data and blocks other outbound destinations. Nine requests were made. Five returned HTTP 200: a plain menu-stock question, vegan, peanut omission, milk-and-egg omission, and a follow-up stock question with an allergy in request history. Qualified requests retained their requirements and did not assert suitability when ingredients/preparation were unverified.

Four requests returned HTTP 503 because no language-model key is available in offline mode: halal, English gluten-free, kidney-disease suitability, and the initial milk-allergy declaration. These are recorded as unavailable responses, not successful conversations. The final offline follow-up included the initial declaration in client history and therefore is not proof of a successful initial acknowledgement.

Evidence: `/private/tmp/tamma-web-http-verification-20261022.json`.

## HTTP verification with real KKU AI

An OpenAI preview launch failed because the local OpenAI key is absent. The existing KKU preview transport was then used at `http://127.0.0.1:4174`, with web search disabled. It sends real model requests to KKU while all business data and persistence remain synthetic; real database and LINE destinations are blocked by the preview transport.

All three sequential HTTP requests returned 200:

| Request | Observed response | End-to-end local time |
| --- | --- | --- |
| ผมแพ้นมและไข่ครับ | Acknowledges both milk and egg | 2,978 ms |
| ผัดไทยมีไหม | Retains both allergies and requests kitchen confirmation instead of asserting suitability | 11 ms |
| Can I have gluten-free pad thai? | English response declines to guess unverified live availability | 1,888 ms |

These are single samples, not latency percentiles. The English case establishes a response in English and safe abstention, not comprehensive multilingual or gluten-free menu accuracy. The preview's fake database is not evidence of hosted persistence across devices or process restarts.

Provider logs record two real KKU requests, with a combined 5,021 input tokens and 209 output tokens. The transport adapts KKU Chat Completions into the application's OpenAI Responses interface, so application telemetry labels the provider `openai`. The application estimated 0.4518 THB using its configured pricing; this is **not verified KKU billing or production cost**. The intervening item question made no model request.

Evidence: `/private/tmp/tamma-web-ai-verification-20261022.json` and the local preview process output.

## Still required for production confirmation

Authorized access to the actual Supabase project, hosted prerequisite checks and any missing migrations, a complete release build/deploy with the correct runtime configuration, and web conversations against that deployed revision using real data and cost telemetry. LINE verification remains a separate task.
