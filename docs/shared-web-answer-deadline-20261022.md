# Shared web answer deadline

The earlier food-opening fix did not resolve the general first-reply failure.
Production logs show a web request whose semantic interpretation succeeded,
then ran again through the ledger's replay path, before the gateway discarded
the result at 22,011 ms. A separate fresh-conversation baseline across four
ordinary questions delivered one useful answer, two turn-timeout messages and
one provider fallback. The baseline questions covered first visits, couples,
two-hour visits and gifts for older relatives.

The common pipeline now addresses the causes without extending the 22-second
web answer deadline or the browser timeout:

- A successful interpretation updates `aiCostLedger` in the same state row
  that One-Mind loaded before interpreting. This guarantees a CAS revision
  conflict even without a concurrent conversation change. On a ledger-only
  change, the computed result is reused against the fresh revision; the new
  ledger is preserved. Any other state change still recomputes the turn.
- Conversation, task, routing and read-only Agent-session checks share a
  request-local snapshot. All writers and cost reservations still read fresh;
  state writes invalidate shared readers before and after their requests.
- The absolute web deadline includes identity, memory and source reads.
  Optional model phrasing starts only when its network budget and a four-second
  completion reserve remain. Otherwise the already-understood question is
  answered from its grounded facts. Provider calls also inherit this deadline.
- Required web interpretation may use up to twelve seconds within the same
  overall deadline. The previous six-second provider cap could reject a valid
  first interpretation independently of the time available in the parent turn.
  Optional phrasing retains its six-second cap; other transports retain their
  existing provider timing.
- Agent preflight reconciles owed usage first, then avoids a redundant spend
  read when the entire conversation ceiling cannot fund its configured reserve.

Regression coverage includes a ledger-only conflict that previously interpreted
twice, preservation of genuinely concurrent conversation changes, shared reads
with fresh CAS snapshots, arbitrary activity/product questions after thirteen
seconds of prior work, and a successful interpretation arriving after the old
six-second provider timeout. No booking, payment or order executor is added.

Validation: 3,488 / 3,488 tests passed with two workers and localhost access.
Both web and LINE function bundles compiled. One unrelated SQL-test worker
crashed at four-worker concurrency; its 14 checks passed alone before the
complete two-worker run passed.
