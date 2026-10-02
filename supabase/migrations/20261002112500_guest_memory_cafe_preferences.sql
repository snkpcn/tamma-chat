-- Messenger/Inthanin production hotfix.
-- Extend the existing guest_memory constraints array with Café conversational
-- preferences. These are preferences only, never medical/allergy claims and
-- never transaction authorization.

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
        and memory_value <@ '["limited_walking","wheelchair_access","elderly_friendly","child_friendly","vegetarian","no_spicy","rain_sensitive","no_pork","no_beef","no_chicken","no_fish","no_egg","no_plara","no_peanut","no_shrimp","mild_spice","peanut_allergy","shrimp_allergy","fish_allergy","egg_allergy","authentic_isan","beginner_friendly","kid_friendly","low_intensity","fear_of_falling","fear_of_speed","food_allergy","prefers_short_replies","prior_safety_concern","no_coffee","low_sweet","low_bitter","no_cow_milk","no_sugar"]'::jsonb
      when 'group' then
        jsonb_typeof(memory_value) = 'object'
        and memory_value - 'adults' - 'children' - 'elderly' = '{}'::jsonb
      when 'visited_experiences' then jsonb_typeof(memory_value) = 'array'
      when 'favorites' then jsonb_typeof(memory_value) = 'array'
      else false
    end
  );
