# Live verification with the existing LINE Official

The user selected the existing Official account and the personal test account named `taoparis`. The display name alone is not a LINE user ID. Identify that account from a unique inbound test message and confirm its profile before sending test pushes. Do not broadcast tests.

## Before deployment

1. Confirm Netlify account access and the site/project identities. Record the currently published deploy ID and the current LINE webhook URL for rollback.
2. Confirm the Supabase project used by the deployment. Run `supabase/checks/customer-turn-production-readiness.sql`; record every result. Inspect migration history and apply only missing prerequisites in the order documented in `production-readiness-20261021.md`. Rerun the read-only checks afterwards.
3. Record the exact source fingerprint and deployment ID, including local edits. Verify that secrets are runtime environment variables and are excluded from uploaded static files.
4. Deploy a draft and check health, signature rejection and web conversations before altering live routing. Record which database the draft uses; a draft URL does not imply an isolated database.

## Real LINE verification

Preserve the current webhook until the target deployment and database pass preflight. A synthetic signed event to a draft can verify its processing and outbound push, but cannot establish real inbound end-to-end delivery. Record these as separate results.

For end-to-end verification, confirm the effective webhook target in LINE, then have the tester send fresh messages from the verified personal account. Record the received event ID, deployed revision, HTTP status, elapsed time and outbox status without publishing raw user IDs or message payloads. Check conversations across several turns in both Thai and English, including a requirement introduced before a later food question, combined requirements and an explicit correction. Unknown ingredients or preparation must result in clarification rather than a claim of suitability.

Check that webhook redelivery is enabled. For delivery recovery, use a controlled test scoped to the verified test account and an isolated endpoint. Record one failed delivery followed by replay of the same event, the same cached answer and retry key, one successful final delivery, no new AI charge, and no repeated business operation. Local mocked failures alone do not establish this live result. Avoid placing real orders or triggering real payment or kitchen notifications merely to test retry behavior.

After testing, restore any temporary webhook change and verify the restored target. A published deployment must retain its recorded rollback deploy ID. Report real latency and cost only from the corresponding deployment logs and cost records; absent evidence remains unverified.

## Preparation observed on 22 October 2026

- Netlify CLI 27.14.1 is available in temporary storage. Account authorization succeeded and the account can access the `tamma-chat` site (`8c1f4d60-68c9-4940-9152-89e9c967e22c`).
- The published deploy is `6acea434b38ac7e507198d9a`, from `main` at `50333bea78f33421ce1ab03caeaa315816a4d8a7`, published at `2026-10-13T21:36:59.258Z`. The edited branch is not this live revision.
- Required credentials are marked `is_secret: true`. Their production values are not readable through the CLI/API; the relevant preview values are empty or absent. Direct Supabase and LINE probes with the CLI-returned representations received 401. Those probes do **not** establish that the real production credentials are invalid, that a migration is missing, or what the live webhook URL is. Netlify documents that only code running on Netlify receives the raw non-development secret values: https://docs.netlify.com/build/environment-variables/secrets-controller/ . Do not copy those returned representations into another environment.
- The edited `thongthai-chat` and `line-webhook` functions bundled successfully with esbuild for Node 20. Their input hashes are recorded locally at `/private/tmp/tamma-line-readiness-20261022/source-manifest.json`. This is a packaging check, not a deployment.
- Supabase connection is not yet confirmed. No hosted migration, LINE test send or webhook change has occurred during this preparation.

## Draft deployment created on 22 October 2026

- Deploy ID: `6ad9c7f409f4ef08ef9b769f`; Netlify reports `state: ready`, `context: deploy-preview`.
- URL: https://6ad9c7f409f4ef08ef9b769f--tamma-chat.netlify.app
- Dashboard: https://app.netlify.com/projects/tamma-chat/deploys/6ad9c7f409f4ef08ef9b769f
- Source: commit `127170198205b7c4f292d442b8e91821a83fbd6c` plus local edits, input-manifest SHA-256 `c6c572f98ce3f77a2b10896b478b4d712cc9c456da05eb1c1ca0727610e6660e`.
- Uploaded an explicitly prepared static directory (165 files, including a build marker) and five bundled functions: `thongthai-chat`, `line-webhook`, `customer-memory`, `ops-health`, and `thongthai-brain-status`. This focused preview does not contain the other site functions or scheduled jobs and must not be promoted as a complete production release. The repository, `.env` files and private preparation manifests were not part of the static upload.
- Anonymous homepage, build-marker, health and empty-invalid-signature probes all received an HTTP 401 Netlify login redirect. This establishes preview access protection, **not** successful function execution or application-level signature rejection. Protection was not disabled.
- Required production secret values have empty or absent preview counterparts. Runtime readiness and web/LINE behavior are therefore still unverified on this draft.
- After deploying the draft, a second authenticated site lookup confirmed the published production deploy remained `6acea434b38ac7e507198d9a` at `50333bea78f33421ce1ab03caeaa315816a4d8a7`.
