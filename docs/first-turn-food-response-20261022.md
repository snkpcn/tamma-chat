# First-turn food response

The deployed web chat spent 16.60 seconds answering a new anonymous guest's
first `อยากกิน` request on 22 October 2026. The existing food-start responder
was below Agent Primary and One-Mind, so a complete preference question still
waited for semantic interpretation. A slow interpretation could exhaust the
turn budget before reaching that responder and ask the customer to send again.

Bare Thai food and visit openings now reach their existing responders before
visitor interpretation, business catalogs, Agent Primary and One-Mind. Existing
dietary constraints, pending questions and active tasks retain their established
continuation paths. Identity, customer memory, response state, telemetry and the
transaction boundaries remain in place. No timeout was extended.

`tests/first-turn-food-latency.test.ts` reproduces the previous unnecessary
model request on both web and LINE, then verifies an immediate useful first
answer with the model unavailable, no unrelated catalog reads, no booking and
response telemetry preserved. Its web case adds 350 ms per database request
and must still finish within eight seconds. Before this change both cases
failed because they attempted a model request.

Validation: all 3,481 tests passed with four test workers and localhost access;
web and LINE function bundles compiled. The default parallel run hit an
unrelated migration-worker crash; that file passed all 20 checks alone, and
the complete run at bounded concurrency passed without failures.
