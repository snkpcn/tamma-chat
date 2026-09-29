-- Phase 6 production catalog repair.
--
-- activity-inventory-slots-v1 originally seeded generic 30/60/90-minute
-- activity offerings. Phase 4 later added the owner-confirmed horse catalog
-- (30 minutes / 300 THB and 45 minutes / 500 THB), but did not retire the
-- two superseded generic horse rows. Because Thongthai correctly reads every
-- active activity_offerings row, production consequently advertised 60 and
-- 90 minutes as real horse choices.
--
-- Keep this correction in canonical operational data, rather than teaching
-- the conversation router a hardcoded horse-duration exception. The old rows
-- remain in place for auditability and can be deliberately re-enabled by an
-- owner through the catalog if the business offering changes in future.

update public.activity_offerings
set
  active = false,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'superseded', true,
    'superseded_reason', 'owner-confirmed horse catalog is 30/45 minutes'
  ),
  updated_at = now()
where activity_code = 'horse'
  and duration_minutes in (60, 90)
  and active = true;
