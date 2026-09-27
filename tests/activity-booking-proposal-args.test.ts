// Human Core PR D: a supervisor-driven booking commit (task.slots ==
// proposal.validatedArgs) never carried a human-readable asset name -- only
// resourceCode/date/time/etc. The booking's execution layer used to fall
// back to re-scanning the CURRENT turn's raw message for a horse name, which
// fails silently for a bare "ยืนยัน" confirmation and can match the WRONG
// horse if the message happens to mention one incidentally (e.g. a
// compliment about the other horse). resolveActivityBookingProposalArgs
// instead reads the name straight off the task's own already-resolved
// selectedEntities -- structured intent the dialog manager decided earlier
// in the conversation, never raw text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActivityBookingProposalArgs } from '../netlify/functions/thongthai-chat';

test('a resolved activity_asset selectedEntity supplies horseName onto the booking args', () => {
  const args = resolveActivityBookingProposalArgs(
    { validatedArgs: { resourceCode: 'activity-horse', date: '2026-10-05', time: '10:00', durationMinutes: 30, partySize: 1 } },
    { selectedEntities: [{ id: 'activity_asset:horse-pharadon', name: 'ภาราดร' }] },
  );
  assert.equal(args.horseName, 'ภาราดร');
  assert.equal(args.resourceCode, 'activity-horse');
});

test('no selectedEntities at all leaves validatedArgs untouched (no horseName key added)', () => {
  const args = resolveActivityBookingProposalArgs(
    { validatedArgs: { resourceCode: 'activity-horse', date: '2026-10-05' } },
    { selectedEntities: [] },
  );
  assert.equal('horseName' in args, false);
});

test('a non-activity_asset selectedEntity (e.g. a room type from a different domain shape) is not mistaken for the asset', () => {
  const args = resolveActivityBookingProposalArgs(
    { validatedArgs: { resourceCode: 'activity-horse' } },
    { selectedEntities: [{ id: 'room_type:deluxe', name: 'Deluxe' }] },
  );
  assert.equal('horseName' in args, false);
});

test('no active task at all (null/undefined) does not throw and leaves args untouched', () => {
  assert.doesNotThrow(() => resolveActivityBookingProposalArgs({ validatedArgs: { resourceCode: 'activity-horse' } }, null));
  const args = resolveActivityBookingProposalArgs({ validatedArgs: { resourceCode: 'activity-horse' } }, undefined);
  assert.equal('horseName' in args, false);
});
