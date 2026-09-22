# Thongthai One-Mind Handoff

Updated: 2026-09-21
Repo: `snkpcn/tamma-chat`
Production: https://tamma-chat.netlify.app/
Existing Supabase only: `tamma-customer-data`

## Current Main Acceptance State

Main has advanced beyond the original expected baseline `2d23b4ee2947cfb6ebf24d9c30f16fe7d728294a` through final One-Mind acceptance hardening and follow-up production smoke fixes.

Latest verified local main before this handoff restore: `40e15d0cc247e1ac7cad6e737b75faf53db0657b`.
This handoff restore commit is intended to retrigger Netlify so production deploys the current main state and stops serving the older `fd0a72c...` deploy.

## Test Evidence

Full local suite on current main code path: `npm test` passes `530/530`, `0` failed.

The suite covers:
- canonical activity conversation continuity
- side questions during active tasks
- topic switch and resume
- correction semantics such as `60 นาที` -> `จริงๆ 90 นาที`
- no hallucinated horse temperament
- no transaction execution from One-Mind read/compose paths
- deterministic zero-paid-LLM behavior under provider outage
- Gemini/OpenAI provider availability and circuit-breaker behavior
- Web/LINE shared One-Mind state rules and transport-only LINE adapter boundaries
- restaurant/promotion/stay/OTOP/cafe/membership read-only routing
- stale task TTL behavior so old tasks do not hijack unrelated future turns

## Fixes Already In Main

- Broad discovery and activity catalog follow-ups stay deterministic under One-Mind cutover.
- Activity side questions no longer get swallowed by missing-field booking prompts.
- Horse selection and requested time survive follow-ups.
- Unknown temperament/beginner suitability is reported honestly; no invented comparison.
- Restaurant advisor follows server-side context, not only client `chatHistory`.
- Restaurant party/budget replies do not become premature pickup-field prompts.
- Pending restaurant preorder side questions such as price/menu/promo no longer re-render the missing pickup-time prompt.
- Promotion discovery is read-only and deterministic from live promotion facts.
- Membership signup information has deterministic copy and does not fall into provider-unavailable apology.
- Grounded response wording avoids raw database-style phrases such as `ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้ครับ`.
- OpenAI paid fallback remains optional; zero-cost deterministic paths handle supported business flows when providers are unavailable.
- Temporary Phase P diagnostic endpoint/token/build artifacts were removed; only historical comments/tests mention the diagnostic investigation.

## Deployment Requirement

After this commit reaches GitHub main:

1. Allow or trigger one Netlify production deploy for `tamma-chat`.
2. Verify Netlify production `commit_ref` equals the latest GitHub main SHA.
3. Rerun concise production smoke through the real gateway using UUID guest/session identities.
4. Do not create real bookings/orders/payments/redemptions.

If Netlify production remains on an older commit, the code may be green but production is not accepted.

## Required Production Smoke

Activity:
1. `มีไรทำมั่ง`
2. `ม้าล่ะ`
3. `มีม้ากี่ตัว`
4. `ตัวไหนนิสัยดีกว่า`
5. `เอาภาราดร`
6. `บ่ายสามได้ปะ`
7. `จะขี่ม้าไง`
8. `มีราคาเท่าไร`
9. `ร้านมีไรกิน`
10. `กลับมาจองม้าต่อ`
11. `60 นาที`
12. `จริงๆ 90 นาที`

Restaurant:
- `ร้านมีไรกิน`
- `มากันสองคน งบ 500`
- `ไม่กินหมู`
- `เอาชุดเมื่อกี้`
- `มีอะไรเผ็ดน้อยๆไหม`
- `ราคาเท่าไร`
- `มีโปรด้วยไหม`

Other read-only domains:
- Stay: `มีห้องพรุ่งนี้ไหม`, `เช็คอินกี่โมง`, `เช็คเอาท์ล่ะ`, `มี room service ไหม`
- Promotion: repeated `มีโปรอะไร`
- Membership: `สมัครสมาชิกยังไง`, `เช็คสถานะสมาชิกได้ไหม`
- OTOP: `มีของฝากอะไรบ้าง`, `อันไหนดี`, `ราคาเท่าไร`
- Cafe: `มีลาเต้ไหม`, `ร้านเปิดกี่โมง`
- Ecosystem: `มีไรทำมั้ง`, `แถวนี้ทำไรดี`, `พาแฟนมา มีไรแนะนำ`, `มาครั้งแรกแนะนำหน่อย`

## Expected Acceptance Properties

- No repeated unrelated missing-field prompt.
- Active task does not hijack side questions.
- Topic switch suspends the task and resume restores it.
- Selected horse and requested time survive.
- Corrections overwrite prior slot values instead of appending.
- `REQUESTED` is not called `CONFIRMED`.
- No unsupported fact is invented.
- No real transaction is executed during UAT.
- Supported zero-cost flows do not collapse into generic provider outage copy.
- Web and LINE use the same One-Mind semantics/state rules.

## Remaining Data Gaps

Owner should fill these later in authoritative data/backoffice, not code hardcoding:

- Horse temperament.
- Beginner suitability.
- Horse age.
- Horse sex.
- Horse size.
- Max rider weight.
- Horse notes.
- Operational status.
- Final activity prices/durations where not populated or not wired.
- Stay policies as authoritative One-Mind facts: check-in <= 14:00, check-out <= 12:00, room service 10:00-22:00, final confirmation by LINE/email/phone.
- Cafe/Inthanin menu and hours source-of-truth.
- OTOP product recommendations/prices where missing.

## Current Acceptance Gate

Ready for normal customer beta traffic only after Netlify production deploy SHA matches GitHub main and the concise production smoke above passes against production. Until then, main is test-green but production acceptance is pending deploy verification.


## 2026-09-22 Emergency LINE Rollback Checkpoint

- Commit `ee2a31563d091c2810d0eb90b02be0667e7ede54` was deployed to production at approximately 17:32 Asia/Bangkok.
- LINE was verified replying before that deploy (17:06) and then stopped replying after it (18:02 onward), including to a generic `ฮัลโหล` message.
- Netlify environment variables for LINE and Supabase remained present, and the deploy itself reported ready, so this was treated as a production runtime regression introduced by `ee2a315`, not an environment-loss incident.
- Emergency rollback commit `1a48a83dd1cbd2f560f1d153630fcec71f12bc50` restores the exact prior tree from `bc3a5c978513baf4e66c4210fcd8c4e77f55740c` while preserving Git history.
- Do NOT reintroduce the `ee2a315` cross-system fallback directly on production until the LINE runtime path is isolated and production-smoked.
- Next acceptance gate: production deploy must point to the rollback tree and LINE must reply to a generic greeting before any activity-booking retest.
