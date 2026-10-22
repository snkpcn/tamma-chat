# Food constraint audit

This change checks food requirements across the quick item answer, durable guest memory, restaurant advice, and order preparation/creation. It extends the earlier vegan/peanut examples into a shared policy in `_food-constraints.ts`.

| Requirement | Checks and behavior |
| --- | --- |
| Allergens | Peanut, tree nuts, milk, egg, soy, wheat, gluten, sesame, shrimp, fish/seafood, celery, mustard, lupin, sulphites. Recorded presence or possible presence conflicts. Missing allergen or cross-contact data is unknown, never a safe verdict. |
| Ingredient avoidance | Named ingredients and proteins, fermented fish, MSG, sugar and chili. Removal requires an explicit kitchen capability; missing recipe/capability data does not establish absence. |
| Dietary patterns | Vegan, vegetarian, jay, halal, kosher, gluten-free and lactose-free. Check recorded dietary tags and reject contradictory ingredients. A dish name alone cannot establish compliance. |
| Taste, preparation and nutrition | Spice/sweetness/salt/oil, raw/cooked, separate equipment/sauce, additions/substitutions and health/nutrition requests remain unverified unless the relevant data exists. Do not invent calorie/sodium/certification or preparation capabilities. |
| Multiple requirements | Every requirement participates in the check. A known conflict wins over unknown data. Unknown data cannot authorize an order. |
| Context and corrections | User turns and normalized guest constraints govern later stock questions. Recognized constraints persist in existing guest memory. Explicit corrections affect only the referenced ingredient; third-party constraints do not become the guest's durable profile. Assistant ingredient lists are not customer requirements. |
| Quantity and stock | Both normal and promotional order creation reject non-integer, non-positive or above-limit quantities instead of silently changing them. Existing live stock checks still run. |
| Prices and budget | Existing advisor/set tests validate live menu prices and set totals. Personalized dietary recommendations now read the menu rather than a generic cuisine answer. |

The policy distinguishes conflict, verified recorded information and unknown. Recommendations may show possible dishes with a clear notice when suitability is not confirmed. A single-dish allergy answer no longer calls an item safe solely because the ingredient/tag is absent. The quick stock path cannot answer unconditionally when current or remembered requirements need confirmation.

The shared order gate runs for normal and promotion orders, plus Agent preparation and commit. Original request text, item-name modifiers, memory, recent user context and notes are checked independently of the model's optional note. Verified requirements are carried into the kitchen note and the idempotency key. Conflicts or missing proof stop the order before creation, payment or restaurant notification. Agent previews also stop when kitchen confirmation is needed.

Regression coverage includes parser cases, affirmative/missing/contradictory data, five-language modifier cases through web and the actual signed LINE entry point, later-message memory, self/companion ownership, corrections, ordinary/promotion orders, an Agent omitting its note, and a verified order replaying without duplicates.

Limits: vocabulary and kitchen metadata are finite. New/ambiguous expressions must retain their original wording for clarification; this is not proof of understanding every possible sentence. Detailed free-text context follows the existing bounded conversation window; durable memory stores recognized codes. Kitchen certifications, recipes, cross-contact procedures and capabilities must be supplied by the business. No hosted data migration, production channel check or live model quality certification was performed for this audit.
