# Stay question continuation

The screenshot exposed a different failure from request latency: the legacy
stay opener asked for arrival date, party size and nights but did not persist
the stay topic or its own question. Old restaurant context therefore owned
the customer's date/party answer, followed by a repeated menu clarification.

A bounded read-only stay continuation now records the question, topic and
customer-supplied date/party/nights together with compare-and-swap. It asks
only for missing fields, preserves known details across short acknowledgements,
and never interprets yes as a night count or booking consent. An explicit stay
date/party declaration also repairs an older conversation lacking that question
contract. Old planning is paused; existing orders and durable preferences are
preserved. No booking task or operational request is created.

Completed details return to the existing knowledge pipeline as an explicitly
read-only stay question. Weather, food, cancellations, resets and transaction
requests retain their routes. Canonical state remains the source of continuity;
browser history is not allowed to overwrite it.

Both web and history-free LINE regression tests failed before the fix because
the first stay question left `active_topic: restaurant`. The corrected screenshot
sequence passes without model calls, keeps tomorrow and two people, and asks
for nights. Transaction and domain-switch guards are covered separately. The
complete suite passed 3,493 tests; both function bundles compiled.

Hosted verification uses one synthetic guest: restaurant discovery, stay opener,
tomorrow/two people, two acknowledgements, one night, then a café-hours question.
It requests information only and checks content rather than HTTP status alone.
