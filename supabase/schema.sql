-- Cosmic Gems - Supabase schema. Run this in the SQL editor of your project.
-- Works with Postgres (Supabase) RLS. Safe to run once.

-- Profiles: one row per auth user, holds a display name.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Commander',
  created_at timestamptz not null default now()
);

-- Scores: one row per user per mode (leveled / infinite). Upsert on conflict.
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null,
  score integer not null default 0,
  level integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, mode)
);

create index if not exists scores_mode_score_idx on public.scores (mode, score desc);

-- Enable row-level security.
alter table public.profiles enable row level security;
alter table public.scores enable row level security;

-- Profiles: a user can read all (for the leaderboard) but only write their own.
create policy "profiles readable by all" on public.profiles
  for select using (true);

create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid () = id);

create policy "profiles update own" on public.profiles
  for update using (auth.uid () = id);

-- Scores: anyone can read (leaderboard). A user can only insert/update their own.
create policy "scores readable by all" on public.scores
  for select using (true);

create policy "scores upsert own" on public.scores
  for insert with check (auth.uid () = user_id);

create policy "scores update own" on public.scores
  for update using (auth.uid () = user_id);

-- Trigger: auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Commander'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();
