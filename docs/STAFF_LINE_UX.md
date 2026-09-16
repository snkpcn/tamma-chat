# LINE Staff Operations UX

The staff-facing LINE workflow is button-first. Staff should not need to remember booking IDs or technical commands.

## Booking card
- Accept job / confirm
- Change assigned ATV / horse / archery lane for activity bookings
- Reschedule with LINE date-time picker
- Cancel with confirmation
- Complete job after confirmation
- Open backoffice details

Booking IDs remain visible only as a small reference. Text commands remain supported as a fallback for administrators.

## Safety
- Staff postbacks are validated against the LINE group/team binding.
- Activity reassignment and rescheduling reuse the database conflict/capacity checks.
- Customer LINE messages and database status updates continue through the existing booking lifecycle functions.
