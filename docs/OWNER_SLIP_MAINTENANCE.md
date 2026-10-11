# Scoped owner-slip maintenance and release sequence

The webhook can temporarily reject new owner expense slips and pending slip review
turns without disabling the shared LINE webhook, the owner group binding, payroll,
customer chat, or other teams. No new table, queue, transport or credential is used.

## Controls

- `THONGTHAI_OWNER_SLIP_MODE=paused`: reject affected owner-slip work.
- `THONGTHAI_OWNER_SLIP_MODE=active`: accept new owner-slip work.
- An unset mode preserves existing behavior. Any other explicitly set value fails
  closed for affected work. Set this variable in the **Functions runtime scope**
  of the existing chat site. A build-only netlify.toml value is insufficient.
- `THONGTHAI_OWNER_SLIP_RESUME_AFTER=<ISO-8601 UTC timestamp>`: keep this cutoff
  after reopening. Affected deliveries with original timestamps at or before it,
  or missing timestamps, are rejected and must be resent as new messages. An
  invalid cutoff fails closed. This prevents delayed maintenance-period
  confirmations from being executed automatically after the pause.

## What the owner sees

The Thai response explicitly says the image/message was **not accepted or posted**,
asks the owner to keep the original and resend after reopening, and says existing
records remain. This is an explicit rejection, not a durable queue. Never tell the
owner that maintenance messages were stored or will automatically replay.

Before normal routing, the webhook identifies affected events using only existing
group, payroll and intake columns. It finishes all maintenance notices before
dispatching other events from that batch. A lookup failure, absent reply token or
failed notice returns HTTP 503, not a misleading 200. A successfully delivered
explicit rejection permits acknowledgment. Do not rely on LINE redelivery as a
durable queue; redelivery can be disabled or expire. The owner's retained original
and explicit resend are the recovery path. If guaranteed automatic replay is
required instead, this gate does not provide it and a separate durable inbox is
needed before promising that behavior.

Active payroll-image sessions keep their existing priority. A second guard at the
owner expense image handler prevents intake if a payroll session disappears
between preflight and dispatch. Failure to send that late maintenance notice also
returns 503. In this rare race, other group events may already have run under the
existing concurrent dispatch; normal downstream idempotency still applies. Normal
mixed-batch maintenance is handled before any other dispatch.

Pending ordinary text is scoped to the uploader; explicit intake references match
the group inbox. This intentionally pauses corrections, cancellations and note
follow-ups as well as confirmations. Other-team events, direct customers,
postbacks, binding commands and owner text without a matching pending intake keep
their existing routes. Existing review handling already treats the uploader's
unstructured text as a pending-slip continuation; the pause preserves that scope.
The new review handler skips its new-column query while paused, so unrelated owner
text can still use existing handlers before the migration is installed.

## Approved release sequence (not performed locally)

1. Verify usable existing recovery metadata, current heads/deploy IDs, private
   preview protection, required CI, and scoped pause tests. Obtain one owner
   approval for the complete maintenance/migration/release/activation sequence.
2. Configure production Functions runtime `THONGTHAI_OWNER_SLIP_MODE=paused` and
   deploy the exact reviewed chat build containing this gate. Merely saving the
   flag does not change an old deployment that lacks the gate. Record this paused
   deploy's immutable ID as the safe rollback target. Do not deploy backoffice's
   new-column queries yet. Confirm the deployed configuration without sending a
   real slip or financial test. Drain previously executing owner-slip invocations
   using the platform's verified maximum invocation duration/completion logs.
3. Apply only the reviewed slip-review migration in a transaction with bounded
   lock/statement timeouts. Retain the pause. Perform read-only PostgREST schema,
   authorization and relationship checks before enabling intake. Failure stops
   the rollout with the pause retained; no automatic migration retry.
4. Deploy the reviewed backoffice build and check read-only health/version/schema
   behavior. Keep the pause until all checks pass. No real or synthetic financial
   writes are part of production validation.
5. Set the resume cutoff to the intended reopening boundary and mode to `active`
   in Functions runtime; deploy the **same reviewed chat source** once to activate
   the new runtime configuration. A cutoff just before this deployment is
   conservative: events before it remain rejected. Tell the owner to resend any
   explicitly rejected slip/note/confirmation after activation is verified.

## Rollback

Restore the recorded **paused gate deployment**, not the old pre-gate chat release.
Keep the schema, guard, evidence, drafts and audit records. Verify that the restored
deployment retains `paused` runtime configuration; environment snapshot behavior
must be verified before selecting the rollback artifact, not assumed from the
site's current variable settings. If platform rollback does not preserve it,
redeploy the same reviewed gate source with explicit paused Functions configuration.
Backoffice can revert to its earlier compatible release; draft amounts stay NULL.
Do not drop review columns or reverse confirmed financial transactions as code
rollback. Financial corrections require a separate audited owner decision.

Local tests use mocks/fixtures only. No production flag, migration, deployment,
provider request, LINE message or financial record was changed for this gate.
