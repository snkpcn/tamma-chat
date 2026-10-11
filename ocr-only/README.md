# Disposable one-run OCR preview — DO NOT MERGE

Owner approved one private Netlify Deploy Preview and at most two Gemini requests
for the marked-invalid synthetic slip. This branch is a test harness, not a release.
Do not rebuild, retry, push additional commits, or merge it without fresh approval.

The extractor bundle is generated from the actual `extractFinancialEvidence`
export at reviewed commit `2ed21d6e4ce9a88129289b870a92fd7e724f4a4d` with esbuild
bundling/tree shaking, platform=node, format=esm. The original TypeScript helper,
compiled bundle and fixed PNG are hash-pinned in `manifest.json`. There are no
runtime package dependencies, database/LINE calls, or function endpoints.

Netlify base is this directory. Root-site assets, redirects, functions, scheduled
functions, and edge functions are not published. GitHub workflows are removed
only on this disposable branch to prevent existing live-provider PR checks.
Neither production settings nor either implementation branch is modified.

Before triggering the PR, Netlify's connector verified SSO for nonproduction;
Chrome verified branch deploys disabled and PR previews enabled. Build logs are
public, so output is restricted to booleans, counters, enums and HTTP status codes.

The build rejects other contexts/branches/sites and database/LINE/OpenAI
credentials. OCR runs in a child with only GEMINI_API_KEY. Its fetch wrapper
permits only the two existing Google model endpoints, forbids redirects, caps
requests at two, and halts on 400/401/403. No production-key fallback is permitted.
Only one synthetic fixture is read. Nothing persists to a financial database.

Local verification: `node --test safety.test.mjs` (mocked fetch; no provider calls).
`node run.mjs` outside Netlify must fail with BLOCKED_CONTEXT and zero calls.

Limitations: masked preview credential presence does not prove key validity or
separate billing. This verifies provider OCR only, not staging DB/auth integration.
The request cap is enforced per invocation; the operator must not trigger retries.

## Local guard correction — not yet pushed or approved to run

The first approved build stopped with BLOCKED_CONTEXT and zero provider requests.
Its initialization log L5 says `Preparing Git Reference pull/617/head`. The original
guard incorrectly compared BRANCH to `codex/ocr-only-preview-once`. Netlify defines
BRANCH as the checkout ref and HEAD as the Git provider's source branch name:
https://docs.netlify.com/build/configure-builds/environment-variables/#git-metadata

The local correction requires all of: NETLIFY=true, CONTEXT=deploy-preview, the
exact site ID, PULL_REQUEST=true, REVIEW_ID=617, HEAD=codex/ocr-only-preview-once,
and BRANCH=pull/617/head. It does not accept arbitrary PR refs, main, a merge ref,
or a missing HEAD. Diagnostics contain only hardcoded labels and booleans.
Database/LINE/other-provider credentials still abort; alternate database aliases
are also rejected. Only Gemini is passed to the OCR child process.

`context-fixtures.json` models the documented metadata and observed ref using
fake credentials; it is not a dump of Netlify's environment. Local Node 24 tests
pass 34/34 with mocked provider functions and no real provider calls. Any new
push/build requires fresh approval. Recheck nonproduction SSO before that push.
