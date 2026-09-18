# THONGTHAI ONE-MIND — Phase O Production Checklist

Canonical production systems only:
- Customer repo: snkpcn/tamma-chat
- Customer site: https://tamma-chat.netlify.app/
- Backoffice repo: snkpcn/tamma-backoffice
- Existing backoffice Netlify site only
- Existing tamma-customer-data Supabase project only

## Preconditions

- [ ] Customer integration branch CI green
- [ ] Backoffice integration branch CI green
- [ ] Customer main SHA re-checked and every intervening commit reconciled
- [ ] Backoffice main SHA re-checked and every intervening commit reconciled
- [ ] No uncommitted/local-only checkpoint exists
- [ ] One-Mind migration files reviewed
- [ ] Production env already has Gemini/OpenAI/Supabase configuration
- [ ] One-Mind cutover remains OFF until merge + migration are ready

## Database

Apply only tracked additive migrations required by One-Mind:
- [ ] `netlify/functions/supabase/one-mind-observability-v1.sql`
- [ ] Verify `public.one_mind_traces` exists
- [ ] Verify RLS enabled
- [ ] Verify no anon/authenticated read policy was added
- [ ] Verify 24-hour expiry trigger/function exists
- [ ] Do not alter existing customer/booking/order/payment data

## Final merge

- [ ] Open customer PR: integration branch -> main
- [ ] Review changed files and merge-base
- [ ] Merge customer PR
- [ ] Open backoffice PR: integration branch -> main
- [ ] Review changed files and merge-base
- [ ] Merge backoffice PR

## Production config

- [ ] Set `THONGTHAI_ONE_MIND_CUTOVER=1` for production customer site
- [ ] Keep shadow flag unnecessary/off unless diagnosing
- [ ] Do not expose secrets
- [ ] Confirm model-provider booleans via brain-status after deploy

## Deploy

- [ ] ONE final customer production deploy
- [ ] ONE final backoffice production deploy
- [ ] Wait for both deploys to reach ready
- [ ] Record deploy ids + commit SHAs

## Customer smoke

- [ ] Homepage has 5 opening script tags / client JS alive
- [ ] Brain status returns current component versions
- [ ] Web: `มีไรทำมั่ง` gets non-generic grounded answer
- [ ] Web: restaurant discovery is grounded
- [ ] Promotion repeated discovery does not become customer name
- [ ] Source-unavailable copy is not misreported as empty
- [ ] requested is never worded as confirmed
- [ ] Local ConciergeProvider is never invoked after canonical endpoint failure
- [ ] LINE webhook endpoint responds normally; stable LINE event id still forwarded
- [ ] No duplicate write on replay/idempotency regression

## Live-model acceptance

Run the stored semantic ground truth against the real configured provider stack:
- [ ] `npm run eval:semantic:live` equivalent acceptance completed
- [ ] Record total/pass/fail/pass %
- [ ] Investigate any failure before declaring Phase O complete

If the local runner cannot access production secrets, perform an equivalent
production-gateway smoke set covering the highest-value semantic groups and
record the limitation honestly. Never fabricate a live-eval result.

## Backoffice smoke

- [ ] Owner login still works
- [ ] Thongthai Intelligence page loads
- [ ] System Health visible
- [ ] Recent safe trace visible after a One-Mind customer smoke turn
- [ ] Conversation Inspector contains machine metadata only
- [ ] No raw customer/assistant transcript appears
- [ ] Other existing backoffice modules still load

## Rollback

Fast rollback is configuration-first:
1. Set `THONGTHAI_ONE_MIND_CUTOVER=0` (or delete the variable).
2. Trigger customer production deploy only if Netlify requires env rebuild.
3. Legacy deterministic transaction executors remain in code and were not removed.
4. Trace table is additive and can remain safely; it expires records automatically.
5. Revert merge commits only if code rollback is required after cutover is disabled.

## Completion evidence

Record in `THONGTHAI_HANDOFF.md`:
- final customer main SHA
- final backoffice main SHA
- migration result
- production deploy ids
- production smoke results
- live semantic acceptance result/limitation
- known remaining limitations
