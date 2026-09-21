[object Object]

### Pending-flow side-question hardening — 2026-09-21

**Production smoke finding**: after `เอาชุดเมื่อกี้`, side questions such as `ราคาเท่าไร`,
`มีอะไรเผ็ดน้อยๆไหม`, and `มีโปรด้วยไหม` could still be swallowed by the pending restaurant
preorder flow and re-render the missing pickup-time prompt. This was a task precedence defect, not
missing business data.

**Fixes**:
- Pending restaurant preorder now answers price side-questions from the proposed set first, while
  preserving the pending preorder state.
- Menu-advice side questions during a pending preorder return to the restaurant advisor instead
  of being parsed as missing preorder fields.
- `มีโปรด้วยไหม` is classified as promotion discovery; the `โปรด...` guard now only excludes the
  polite word class and no longer blocks real promotion phrases containing `โปรด้...`.

**Test result**: `npm test` passes **518/518**, 0 failed.
