-- Phase 6 working-memory persistence repair.
--
-- Application memory accepts the normalized constraint vocabulary below,
-- but the deployed guest_memory CHECK constraint still contained the
-- original seven-value list. PostgREST therefore rejected an entire
-- constraint-array upsert when it contained e.g. shrimp_allergy or
-- mild_spice. The customer-facing turn still succeeded, hiding the lost
-- memory until a later topic switch/resume.
--
-- This is an additive allow-list expansion only. It does not rewrite or
-- delete any existing customer memory.

alter table public.guest_memory
  drop constraint if exists guest_memory_value_allowed,
  add constraint guest_memory_value_allowed check (
    case memory_key
      when 'traveler_type' then memory_value in (
        '"solo"'::jsonb, '"couple"'::jsonb, '"friends"'::jsonb,
        '"family"'::jsonb, '"group"'::jsonb
      )
      when 'trip_duration' then memory_value in (
        '"short"'::jsonb, '"half"'::jsonb, '"full"'::jsonb,
        '"overnight"'::jsonb, '"2d1n"'::jsonb, '"3d2n"'::jsonb
      )
      when 'pace' then memory_value in (
        '"slow"'::jsonb, '"relaxed"'::jsonb, '"balanced"'::jsonb, '"active"'::jsonb
      )
      when 'budget_band' then memory_value in (
        '"under_3000"'::jsonb, '"3000_8000"'::jsonb,
        '"8000_15000"'::jsonb, '"15000_plus"'::jsonb
      )
      when 'preferred_language' then memory_value in (
        '"th"'::jsonb, '"en"'::jsonb, '"zh"'::jsonb, '"lo"'::jsonb, '"vi"'::jsonb
      )
      when 'interests' then
        jsonb_typeof(memory_value) = 'array'
        and memory_value <@ '["food","nature","adventure","rest","culture","coffee","local_community","family","photography","wellness"]'::jsonb
      when 'constraints' then
        jsonb_typeof(memory_value) = 'array'
        and memory_value <@ '["limited_walking","wheelchair_access","elderly_friendly","child_friendly","vegetarian","no_spicy","rain_sensitive","no_pork","no_beef","no_chicken","no_fish","no_egg","no_plara","no_peanut","no_shrimp","mild_spice","peanut_allergy","shrimp_allergy","fish_allergy","egg_allergy","authentic_isan","beginner_friendly","kid_friendly","low_intensity","fear_of_falling","fear_of_speed","food_allergy","prefers_short_replies","prior_safety_concern"]'::jsonb
      when 'group' then
        jsonb_typeof(memory_value) = 'object'
        and memory_value - 'adults' - 'children' - 'elderly' = '{}'::jsonb
      when 'visited_experiences' then jsonb_typeof(memory_value) = 'array'
      when 'favorites' then jsonb_typeof(memory_value) = 'array'
      else false
    end
  );
