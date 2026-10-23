-- Paper Pig database schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Every table is scoped to a family. Row Level Security makes sure a signed-in
-- parent can only ever read or write rows for the family they belong to.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our family' check (char_length(name) <= 60),
  timezone    text not null default 'America/Denver',
  pin_hash    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id   uuid not null references public.families on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.family_invites (
  family_id   uuid not null references public.families on delete cascade,
  email       text not null check (char_length(email) <= 254),
  created_at  timestamptz not null default now(),
  primary key (family_id, email)
);

create table if not exists public.kids (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families on delete cascade,
  name                text not null check (char_length(name) between 1 and 40),
  color               text not null default 'green',
  weekly_allowance    numeric(8,2) not null default 5 check (weekly_allowance >= 0 and weekly_allowance <= 1000),
  base_screen_minutes int not null default 100 check (base_screen_minutes between 0 and 2000),
  reading_cap         int not null default 60 check (reading_cap between 0 and 2000),
  max_read_session    int not null default 60 check (max_read_session between 5 and 240),
  screen_days         int[] not null default '{6,0}',
  start_week          date not null,
  goal_name           text check (char_length(goal_name) <= 60),
  goal_amount         numeric(8,2) check (goal_amount > 0 and goal_amount <= 100000),
  created_at          timestamptz not null default now()
);

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  done_means  text not null default '' check (char_length(done_means) <= 160),
  category    text not null default 'Around the house' check (char_length(category) <= 40),
  price       numeric(8,2) not null default 1 check (price >= 0 and price <= 1000),
  enabled     boolean not null default true,
  sort        int not null default 0,
  bonus_minutes int not null default 0 check (bonus_minutes between 0 and 240),
  created_at  timestamptz not null default now()
);

-- One row per kid per week. "allowance" is fixed when the week starts (Monday).
-- paid_at / paid_total are unused (kept for older installs); payments live in transactions.
create table if not exists public.weeks (
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  allowance   numeric(8,2) not null default 0 check (allowance >= 0),
  paid_at     timestamptz,
  paid_total  numeric(10,2),
  primary key (kid_id, week_start)
);

-- Money in: completed jobs and bonuses. Amounts are always positive.
create table if not exists public.credits (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  kind        text not null check (kind in ('job','bonus')),
  title       text not null check (char_length(title) between 1 and 120),
  amount      numeric(8,2) not null check (amount > 0 and amount <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  -- 'pending' = the kid tapped "I did it" and a parent hasn't approved yet. Only 'approved' counts.
  status      text not null default 'approved' check (status in ('approved','pending')),
  minutes     int not null default 0 check (minutes between 0 and 600),
  job_id      uuid references public.jobs on delete set null
);

-- Money out of a kid's balance: cash or a transfer the parent handed over ('payout'),
-- or something the parent bought for the kid with their money ('purchase').
-- Every entry needs an explanation. There is no way to take money away as a punishment.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  kind        text not null check (kind in ('payout','purchase')),
  amount      numeric(8,2) not null check (amount > 0 and amount <= 10000),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  local_date  date not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.reading_sessions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  kid_id        uuid not null references public.kids on delete cascade,
  book          text not null check (char_length(book) between 1 and 100),
  local_date    date not null,
  week_start    date not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- seconds saved so far; while running, add the time since running_since. Null running_since = paused.
  seconds       int not null default 0 check (seconds between 0 and 36000),
  running_since timestamptz,
  source        text not null default 'timer' check (source in ('timer','manual')),
  minutes       int not null default 0
);

create table if not exists public.screen_sessions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  kid_id        uuid not null references public.kids on delete cascade,
  local_date    date not null,
  week_start    date not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  seconds       int not null default 0 check (seconds between 0 and 36000),
  running_since timestamptz,
  source        text not null default 'clock' check (source in ('clock','manual')),
  note          text check (char_length(note) <= 120),
  minutes       int not null default 0
);

-- Extra screen minutes a parent gives, always with an explanation.
create table if not exists public.screen_bonus (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  minutes     int not null check (minutes between 1 and 600),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  created_at  timestamptz not null default now()
);

-- Optional "oops jar": small deductions of money or screen minutes, always with a reason.
-- Off for every family unless a parent turns it on in Settings, and the family picks its name.
alter table public.families add column if not exists penalty_enabled boolean not null default false;
alter table public.families add column if not exists penalty_name text not null default 'Oops Jar';
create table if not exists public.penalties (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  local_date  date not null,
  week_start  date not null,
  amount      numeric(8,2) not null default 0 check (amount >= 0),
  minutes     int not null default 0 check (minutes between 0 and 600),
  note        text not null check (char_length(trim(note)) between 1 and 120),
  created_at  timestamptz not null default now(),
  check (amount > 0 or minutes > 0)
);

-- Older versions used this to take minutes away. The app no longer does that; kept so upgrades don't fail.
create table if not exists public.screen_adjust (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  kid_id      uuid not null references public.kids on delete cascade,
  week_start  date not null,
  minutes     int not null check (minutes between 1 and 600),
  note        text not null default 'Screens without the clock' check (char_length(note) <= 120),
  created_at  timestamptz not null default now()
);

-- Upgrades for databases created from an earlier version of this file (safe to re-run).
alter table public.reading_sessions add column if not exists seconds int not null default 0;
alter table public.reading_sessions add column if not exists running_since timestamptz;
alter table public.reading_sessions add column if not exists source text not null default 'timer';
alter table public.screen_sessions add column if not exists seconds int not null default 0;
alter table public.screen_sessions add column if not exists running_since timestamptz;
alter table public.screen_sessions add column if not exists ended_at timestamptz;
alter table public.screen_sessions add column if not exists source text not null default 'clock';
alter table public.screen_sessions add column if not exists note text;
alter table public.screen_sessions alter column minutes set default 0;
alter table public.screen_sessions drop constraint if exists screen_sessions_minutes_check;
alter table public.reading_sessions drop constraint if exists reading_sessions_minutes_check;
alter table public.credits add column if not exists status text not null default 'approved';
alter table public.credits add column if not exists minutes int not null default 0;
alter table public.credits add column if not exists job_id uuid references public.jobs on delete set null;
alter table public.jobs add column if not exists bonus_minutes int not null default 0;
alter table public.kids add column if not exists goal_name text;
alter table public.kids add column if not exists goal_amount numeric(8,2);

create index if not exists jobs_kid on public.jobs (kid_id);
create index if not exists credits_kid on public.credits (kid_id, week_start);
create index if not exists tx_kid on public.transactions (kid_id);
create index if not exists reading_kid on public.reading_sessions (kid_id, week_start);
create index if not exists screen_kid on public.screen_sessions (kid_id, week_start);
create index if not exists members_user on public.family_members (user_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.my_family_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select family_id from public.family_members where user_id = auth.uid()
$$;

-- First sign-in: make a family and add the caller as its first parent.
create or replace function public.create_family(p_name text, p_tz text)
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select family_id into fid from public.family_members where user_id = auth.uid() limit 1;
  if fid is not null then return fid; end if;
  insert into public.families (name, timezone)
    values (coalesce(nullif(trim(p_name), ''), 'Our family'), coalesce(nullif(p_tz, ''), 'America/Denver'))
    returning id into fid;
  insert into public.family_members (family_id, user_id, email) values (fid, auth.uid(), auth.email());
  return fid;
end $$;

-- A second parent signs in with an invited email and joins that family.
create or replace function public.accept_invites()
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then return null; end if;
  select family_id into fid from public.family_invites where lower(email) = lower(auth.email()) order by created_at limit 1;
  if fid is null then return null; end if;
  insert into public.family_members (family_id, user_id, email) values (fid, auth.uid(), auth.email()) on conflict do nothing;
  delete from public.family_invites where lower(email) = lower(auth.email());
  return fid;
end $$;

-- Delete everything: the family, its kids and history, and the caller's login.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.families f
   where f.id in (select family_id from public.family_members where user_id = auth.uid());
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.my_family_ids() from public, anon;
revoke all on function public.create_family(text, text) from public, anon;
revoke all on function public.accept_invites() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.my_family_ids() to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.families         enable row level security;
alter table public.family_members   enable row level security;
alter table public.family_invites   enable row level security;
alter table public.kids             enable row level security;
alter table public.jobs             enable row level security;
alter table public.weeks            enable row level security;
alter table public.credits          enable row level security;
alter table public.transactions     enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.screen_sessions  enable row level security;
alter table public.screen_adjust    enable row level security;
alter table public.screen_bonus     enable row level security;
alter table public.penalties        enable row level security;

drop policy if exists fam_select on public.families;
drop policy if exists fam_update on public.families;
create policy fam_select on public.families for select to authenticated using (id in (select public.my_family_ids()));
create policy fam_update on public.families for update to authenticated using (id in (select public.my_family_ids())) with check (id in (select public.my_family_ids()));

drop policy if exists mem_select on public.family_members;
create policy mem_select on public.family_members for select to authenticated using (family_id in (select public.my_family_ids()));

drop policy if exists inv_all on public.family_invites;
create policy inv_all on public.family_invites for all to authenticated
  using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));

do $$
declare t text;
begin
  foreach t in array array['kids','jobs','reading_sessions','screen_sessions','screen_adjust','screen_bonus','penalties'] loop
    execute format('drop policy if exists fam_all on public.%I', t);
    execute format('create policy fam_all on public.%I for all to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()))', t);
  end loop;
end $$;

-- Weeks: read, create, and mark paid. Never deleted from the app.
drop policy if exists wk_select on public.weeks;
drop policy if exists wk_insert on public.weeks;
drop policy if exists wk_update on public.weeks;
create policy wk_select on public.weeks for select to authenticated using (family_id in (select public.my_family_ids()));
create policy wk_insert on public.weeks for insert to authenticated with check (family_id in (select public.my_family_ids()));
create policy wk_update on public.weeks for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));

-- Credits and transactions: read, add, and undo (delete) a mistake. No edits, so amounts can't be changed later.
do $$
declare t text;
begin
  foreach t in array array['credits','transactions'] loop
    execute format('drop policy if exists cr_select on public.%I', t);
    execute format('drop policy if exists cr_insert on public.%I', t);
    execute format('drop policy if exists cr_delete on public.%I', t);
    execute format('create policy cr_select on public.%I for select to authenticated using (family_id in (select public.my_family_ids()))', t);
    execute format('create policy cr_insert on public.%I for insert to authenticated with check (family_id in (select public.my_family_ids()))', t);
    execute format('create policy cr_delete on public.%I for delete to authenticated using (family_id in (select public.my_family_ids()))', t);
  end loop;
end $$;

-- Parents can edit any entry from the Ledger (fix an amount, explanation or day).
-- Money amounts still can't be negative; the checks on each table enforce that.
drop trigger if exists credits_only_approve on public.credits;
drop function if exists public.credits_only_approve();
drop policy if exists cr_update on public.credits;
drop policy if exists cr_update on public.transactions;
create policy cr_update on public.credits for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));
create policy cr_update on public.transactions for update to authenticated using (family_id in (select public.my_family_ids())) with check (family_id in (select public.my_family_ids()));
