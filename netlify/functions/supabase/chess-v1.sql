-- Challenge Thongthai — chess feature.
-- Applied to the existing production Supabase project (tamma-customer-data).
-- No new project, no new database. guest_id always references the same
-- public.guests table every other Thongthai feature already uses.
--
-- Reward truth model: the server alone issues a reward, only after a
-- verified player win (chess-game.ts calls chess.js server-side and never
-- trusts a client-claimed result). Zones eligible for redemption are NOT
-- hardcoded here or duplicated into a column — they are read live from
-- public.service_resources (the same real, active service catalog already
-- used for bookings), via the single centralized zone config in
-- netlify/functions/_chess-db.ts.

create table if not exists public.chess_games (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  difficulty text not null,
  player_color text not null,
  fen text not null,
  moves jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  engine_seed text null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null
);

create table if not exists public.chess_rewards (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  game_id uuid not null unique references public.chess_games(id) on delete cascade,
  difficulty text not null,
  discount_percent integer not null check (discount_percent > 0 and discount_percent <= 100),
  scope text not null,
  selected_zone text null,
  status text not null default 'available',
  master_badge boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chess_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.chess_rewards(id) on delete cascade,
  zone_key text not null,
  redeemed_at timestamptz not null default now(),
  unique (reward_id, zone_key)
);

-- ---------------------------------------------------------------------------
-- Constraints via explicit ALTER (drop + add), not inline on CREATE TABLE.
-- `create table if not exists` is a no-op once a table already exists, so an
-- inline constraint clause here would never reach an already-deployed table
-- if this file is edited and re-run later. ALTER makes re-running this file
-- self-healing on a fresh database or an existing one.
-- ---------------------------------------------------------------------------
alter table public.chess_games drop constraint if exists chess_games_difficulty_check;
alter table public.chess_games add constraint chess_games_difficulty_check
  check (difficulty in ('easy','medium','hard','master'));

alter table public.chess_games drop constraint if exists chess_games_player_color_check;
alter table public.chess_games add constraint chess_games_player_color_check
  check (player_color in ('white','black'));

alter table public.chess_games drop constraint if exists chess_games_status_check;
alter table public.chess_games add constraint chess_games_status_check
  check (status in ('active','player_won','thongthai_won','draw','resigned','abandoned'));

alter table public.chess_rewards drop constraint if exists chess_rewards_difficulty_check;
alter table public.chess_rewards add constraint chess_rewards_difficulty_check
  check (difficulty in ('easy','medium','hard','master'));

alter table public.chess_rewards drop constraint if exists chess_rewards_scope_check;
alter table public.chess_rewards add constraint chess_rewards_scope_check
  check (scope in ('one_zone','all_zones'));

alter table public.chess_rewards drop constraint if exists chess_rewards_status_check;
alter table public.chess_rewards add constraint chess_rewards_status_check
  check (status in ('available','partially_used','used','expired'));

-- A one_zone reward's selected_zone is set once (at selection time) and
-- never blank for a scope that requires it once available; an all_zones
-- reward never carries a single selected_zone (it covers every eligible
-- zone at redemption time).
alter table public.chess_rewards drop constraint if exists chess_rewards_scope_zone_shape;
alter table public.chess_rewards add constraint chess_rewards_scope_zone_shape
  check (scope <> 'all_zones' or selected_zone is null);

create index if not exists chess_games_guest_created_idx on public.chess_games(guest_id, started_at desc);
create index if not exists chess_games_guest_status_idx on public.chess_games(guest_id, difficulty, status);
create index if not exists chess_rewards_guest_created_idx on public.chess_rewards(guest_id, created_at desc);
create index if not exists chess_rewards_guest_status_idx on public.chess_rewards(guest_id, status);
create index if not exists chess_reward_redemptions_reward_idx on public.chess_reward_redemptions(reward_id);

-- Extend the existing shared guest_events log with this feature's structured
-- event types (reusing the current event model rather than a parallel one,
-- per the same self-healing ALTER pattern as the rest of this file).
alter table public.guest_events drop constraint if exists guest_events_event_type_check;
alter table public.guest_events add constraint guest_events_event_type_check check (
  event_type in (
    'chat_request', 'information_request', 'journey_created',
    'journey_modified', 'journey_saved', 'journey_favorited', 'return_visit',
    'experience_favorited', 'experience_visited', 'identity_linked',
    'memory_learned', 'brain_decision', 'agent_action', 'handoff_requested',
    'chess_game_started', 'chess_game_won', 'chess_game_lost', 'chess_game_drawn',
    'chess_master_unlocked', 'chess_reward_issued', 'chess_reward_redeemed'
  )
);

alter table public.chess_games enable row level security;
alter table public.chess_rewards enable row level security;
alter table public.chess_reward_redemptions enable row level security;

-- Deliberately no policies for anon or authenticated roles — same model as
-- every other Thongthai table. Only the server-side Supabase service-role
-- key (Netlify Functions) may read or write these tables; the browser only
-- ever talks to chess-game.ts / chess-rewards.ts.
revoke all on table public.chess_games from anon, authenticated;
revoke all on table public.chess_rewards from anon, authenticated;
revoke all on table public.chess_reward_redemptions from anon, authenticated;
