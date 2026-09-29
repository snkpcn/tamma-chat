-- Phase 4: dynamic organization knowledge.
-- Owner-editable business facts stay in the existing canonical backoffice data:
-- - tamma_chart_os.restaurant_menu_intelligence_profiles.profile for menu safety/customization metadata
-- - public.activity_offerings for duration/price options
-- - public.service_resources for activity inventory/status/capacity
--
-- Unknown is represented as JSON null / absent values, never as false.

alter table tamma_chart_os.restaurant_menu_intelligence_profiles
  add column if not exists notes text null;

alter table if exists public.activity_offerings
  add column if not exists updated_at timestamptz not null default now();

-- Seed structured customization/allergy metadata without overwriting curated
-- values already present in backoffice. Ingredient presence and kitchen
-- customization are separate objects.
update tamma_chart_os.restaurant_menu_intelligence_profiles p
set
  profile = jsonb_set(
    jsonb_set(
      p.profile,
      '{safety}',
      coalesce(p.profile->'safety', jsonb_build_object(
        'allergens', jsonb_build_object(),
        'contains', jsonb_build_array(),
        'mayContain', jsonb_build_array(),
        'crossContaminationRisk', 'unknown',
        'dietaryTags', jsonb_build_array()
      )),
      true
    ),
    '{customization}',
    coalesce(p.profile->'customization', jsonb_build_object(
      'spiceAdjustable', null,
      'allowedSpiceLevels', jsonb_build_array(),
      'canRemoveChili', null,
      'canRemoveFermentedFish', null,
      'canRemoveMsg', null,
      'canReduceOrRemoveSugar', null,
      'removableIngredients', jsonb_build_array(),
      'addableIngredients', jsonb_build_array(),
      'substitutions', jsonb_build_array(),
      'kitchenNote', null
    )),
    true
  ),
  updated_at = now()
where not (p.profile ? 'safety') or not (p.profile ? 'customization');

-- Owner-confirmed example/editable metadata for ตำลาว. This is seed data in
-- backoffice, not application-code authority; changing this row changes what
-- Thongthai reads without redeploy.
update tamma_chart_os.restaurant_menu_intelligence_profiles p
set
  profile = jsonb_set(
    jsonb_set(
      p.profile,
      '{safety,allergens}',
      coalesce(p.profile #> '{safety,allergens}', '{}'::jsonb) || jsonb_build_object(
        'shrimp', 'does_not_contain',
        'fish', 'may_contain'
      ),
      true
    ),
    '{customization}',
    coalesce(p.profile->'customization', '{}'::jsonb) || jsonb_build_object(
      'spiceAdjustable', true,
      'allowedSpiceLevels', jsonb_build_array('none','mild','medium','hot'),
      'canRemoveChili', true,
      'canRemoveFermentedFish', true,
      'canRemoveMsg', null,
      'canReduceOrRemoveSugar', true,
      'removableIngredients', jsonb_build_array('พริก','น้ำปลาร้า','ผงชูรส','น้ำตาล'),
      'addableIngredients', jsonb_build_array(),
      'substitutions', jsonb_build_array(),
      'kitchenNote', 'ข้อมูลนี้เจ้าของร้านแก้ได้ใน backoffice; สูตรมีพริกและความสามารถสั่งไม่ใส่พริกเป็นคนละข้อ'
    ),
    true
  ),
  curation_status = 'curated',
  updated_at = now()
from tamma_chart_os.menu_items m
where p.menu_item_id = m.id
  and m.name = 'ตำลาว';

-- Activity resources: capacity/status is editable here. No fake boat names.
insert into public.service_resources (code, service_type, name, description, unit_label, default_capacity, requires_schedule, active, metadata, updated_at)
select 'activity-horse', 'activity', 'ขี่ม้า', 'กิจกรรมขี่ม้าในทำมา-ชาติ', 'รอบ', 1, true, true,
  jsonb_build_object('activityCode','horse','status','available'),
  now()
where not exists (select 1 from public.service_resources where code = 'activity-horse');

update public.service_resources
set name = 'ขี่ม้า',
    default_capacity = coalesce(default_capacity, 1),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('activityCode','horse','status',coalesce(metadata->>'status','available')),
    updated_at = now()
where code = 'activity-horse';

insert into public.service_resources (code, service_type, name, description, unit_label, default_capacity, requires_schedule, active, metadata, updated_at)
select 'activity-pedal-boat', 'activity', 'ปั่นเรือเป็ดน้ำ', 'ปั่นเรือเป็ดน้ำกลางบ่อน้ำ', 'ลำ', 2, true, true,
  jsonb_build_object('activityCode','pedal_boat','inventoryTotal',2,'status','available'),
  now()
where not exists (select 1 from public.service_resources where code = 'activity-pedal-boat');

update public.service_resources
set name = 'ปั่นเรือเป็ดน้ำ',
    default_capacity = 2,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('activityCode','pedal_boat','inventoryTotal',2,'status',coalesce(metadata->>'status','available')),
    updated_at = now()
where code = 'activity-pedal-boat';

-- Duration/price options. These are rows in editable operational data, not
-- customer-sentence regex branches.
do $$
begin
  update public.activity_offerings
     set activity_name = 'ขี่ม้า', price = 300, currency = 'THB', active = true, updated_at = now()
   where activity_code = 'horse' and duration_minutes = 30;
  if not found then
    insert into public.activity_offerings(activity_code, activity_name, duration_minutes, price, currency, active, sort_order, metadata, updated_at)
    values('horse','ขี่ม้า',30,300,'THB',true,10,'{}'::jsonb,now());
  end if;

  update public.activity_offerings
     set activity_name = 'ขี่ม้า', price = 500, currency = 'THB', active = true, updated_at = now()
   where activity_code = 'horse' and duration_minutes = 45;
  if not found then
    insert into public.activity_offerings(activity_code, activity_name, duration_minutes, price, currency, active, sort_order, metadata, updated_at)
    values('horse','ขี่ม้า',45,500,'THB',true,20,'{}'::jsonb,now());
  end if;

  update public.activity_offerings
     set activity_name = 'ปั่นเรือเป็ดน้ำ', price = 50, currency = 'THB', active = true, updated_at = now()
   where activity_code = 'pedal_boat' and duration_minutes = 30;
  if not found then
    insert into public.activity_offerings(activity_code, activity_name, duration_minutes, price, currency, active, sort_order, metadata, updated_at)
    values('pedal_boat','ปั่นเรือเป็ดน้ำ',30,50,'THB',true,30,'{}'::jsonb,now());
  end if;

  update public.activity_offerings
     set activity_name = 'ปั่นเรือเป็ดน้ำ', price = 100, currency = 'THB', active = true, updated_at = now()
   where activity_code = 'pedal_boat' and duration_minutes = 60;
  if not found then
    insert into public.activity_offerings(activity_code, activity_name, duration_minutes, price, currency, active, sort_order, metadata, updated_at)
    values('pedal_boat','ปั่นเรือเป็ดน้ำ',60,100,'THB',true,40,'{}'::jsonb,now());
  end if;
end $$;
