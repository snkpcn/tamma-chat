# Phase 6 — Natural Response Brain

Status: **implementation / certification**

Base production checkpoint: `f8ea2e7ee3b527b7af8458b1a689d1142374e4c0` (Phase 5 complete)

## Objective

Make the final customer-facing layer sound like one capable human Thongthai across every supported customer language and channel, without weakening any truth or transaction boundary.

Phase 6 is not a new brain. It strengthens the existing final Response Composer and deterministic safety rails so the same semantic meaning and the same verified business facts are expressed naturally in the customer’s requested language.

Supported runtime response languages:

- Thai (`th`)
- English (`en`)
- Chinese (`zh`)
- Lao (`lo`)
- Vietnamese (`vi`)

## Problems this phase closes

The normal grounded model composer already receives an explicit output language and human-service voice, but several deterministic paths still leaked another language:

- Chinese/Lao/Vietnamese degraded responses fell back to English.
- non-Thai collect-field turns used a generic English clarification instead of naming the real missing field.
- non-Thai operational outcomes collapsed to English.
- task summaries used English headings or Thai labels even when another response language was requested.
- refund/claim/liability/safety guardrails were deterministic Thai regardless of customer language.
- raw customer-voice acknowledgements were deterministic Thai regardless of customer language.

Those are response-authority defects, not semantic-routing defects.

## Invariants

1. **Phase 4 commercial boundary is unchanged.**
   Natural copy must never create transaction consent.

2. **Phase 5 incident routing is unchanged.**
   Natural copy happens only after incident/business ownership is already decided.

3. **Verified truth remains authoritative.**
   A natural answer cannot invent price, stock, availability, policy, status, staff action, or outcome.

4. **Requested is not confirmed.**
   Localized wording must preserve operational state exactly.

5. **Guardrails remain deterministic.**
   Refund/claim/liability/safety/incident authority rails never need an LLM in order to sound human.

6. **No language leakage.**
   A supported customer language must not fall back to English or Thai merely because a deterministic path was selected.

7. **Thai voice remains male/polite.**
   Customer `ค่ะ/คะ` never makes Thongthai mirror a female polite particle.

8. **Channel presentation remains last-mile only.**
   LINE/Facebook/Web may differ in density/formatting, never in facts or decision logic.

## Implementation

### Response Composer deterministic rails

`_response-composer.ts` now localizes:

- provider/source unavailable
- unknown fact
- verified empty
- comparison cannot be verified
- proposal / failed request
- missing-field collection
- operational success/requested state
- active/suspended task summaries
- durable preference / interest summary labels

Thai remains the canonical service voice. English/Chinese/Lao/Vietnamese now receive first-class deterministic copy instead of an English last-resort fallback.

### Customer Voice / escalation rails

`_service-mind-feedback-response.ts` now accepts the response language.

Non-Thai deterministic customer-voice cases use the same real stored/delivery result as Thai.

Authority-boundary categories remain deterministic and are localized:

- refund
- special discount
- claim/compensation
- accident liability
- safety guarantee
- bad-review escalation
- severe allergy/medical boundary
- unverified room availability

### Canonical gateway

`thongthai-chat.ts` passes `request.language` into deterministic feedback and escalation composers. No channel-specific language implementation was added.

## Offline certification

`tests/phase6-natural-response-brain.test.ts` proves:

- no English leakage in Chinese/Lao/Vietnamese degraded copy;
- collect-field prompts name the actual missing field in the requested language;
- `requested` never becomes a false localized `confirmed`;
- task summaries stay in the requested language;
- refund authority wording stays localized and refuses owner-level authority;
- customer-voice acknowledgements stay localized;
- grounded model prompt still says answer-first / no classification narration;
- Thai last-mile copy still forces `ครับ`.

Full repository `npm test` must remain green.

## Live OpenAI certification

`.github/workflows/phase6-live-natural-response.yml`

`scripts/run-phase6-live-natural-response.ts`

The live gate gives the final grounded response composer the same verified price fact in all five supported languages.

For every language it must:

- return the verified price;
- use only supplied grounded fact keys;
- stay in the requested language;
- avoid internal/source/classification narration;
- avoid false booking/order/confirmation language;
- remain concise enough for customer chat.

## Definition of done

Phase 6 closes only when:

- offline Phase 6 suite passes;
- full repository CI passes;
- Netlify build guard passes;
- existing cost-stress regression passes;
- real OpenAI Phase 6 natural-response matrix passes;
- merged `main` production deploy is READY at the exact merge commit;
- Live Transaction remains OFF;
- Public Prepare remains 0%.

Next roadmap phase after closure: **Phase 7**.
