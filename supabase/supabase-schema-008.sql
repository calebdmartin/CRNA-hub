-- CRNA Hub — migration 008: server-side facilities table.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 007. It creates only the facilities table. It does NOT
-- backfill anything from any device: tables start empty, and the client
-- sync that uploads on-device facilities is a separate step. No secrets,
-- tokens, or passwords are stored here (facility notes must never hold
-- passwords), and no patient information.
--
-- Row Level Security mirrors migrations 001–005: each user sees only
-- their own rows through the API. The Edge Functions use the service-role
-- key and enforce the same per-user scoping in code.
--
-- Mirrors the on-device facility record (app.js `db.facilities`):
--   * id is TEXT, the client's own id, like shifts (migration 007).
--   * aliases stays one comma-separated TEXT string, exactly as the
--     client stores it ('CAMC, Charleston') — the server splits it when
--     it needs the list (normalizeFacilityRules already does).
--   * Every rate column is NULL when blank, never 0: each has a CHECK
--     (null or > 0), the database form of the blank-never-$0 rule. The
--     full rate list is the client's RATE_FIELDS plus paid_hours_8:
--     hourly_rate, paid_hours_8, rate_8, rate_10, rate_12, rate_24,
--     rate_second, weekend_rate_second, call_bonus, hourly_call_1st,
--     weekend_rate_24. A blank rate means "doesn't apply / not taken
--     here"; a shift type with no rate stays unpriced, never $0.
--   * distance is the ONE-WAY miles the client stores (f.distance);
--     distance_source is 'manual' or 'auto'. Round-trip miles are
--     always derived (2 x one-way), never stored doubled.
--   * lat / lng / geocoded_address are the cached geocode the mileage
--     auto-calculation uses; they are cleared when the address changes
--     (client submitEntry rule), never trusted blindly.
--   * rates_source / rates_source_file / rates_source_date are the
--     provenance the Facilities tab already shows ('manual' or the
--     contract it was read from). The extracted contract itself lives in
--     the client's contracts store, not here — this table holds the
--     applied pay rule only.
--   * One facility per name per user (unique index on lower(name)):
--     the client already merges a same-name save into the existing
--     facility instead of creating a duplicate, so this only enforces
--     what the app already does. Aliases may still overlap across
--     different names; alias matching stays in app code.
create table if not exists public.facilities (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  aliases text,
  address text,
  lat numeric,
  lng numeric,
  geocoded_address text,
  hourly_rate numeric check (hourly_rate is null or hourly_rate > 0),
  paid_hours_8 numeric check (paid_hours_8 is null or paid_hours_8 > 0),
  rate_8 numeric check (rate_8 is null or rate_8 > 0),
  rate_10 numeric check (rate_10 is null or rate_10 > 0),
  rate_12 numeric check (rate_12 is null or rate_12 > 0),
  rate_24 numeric check (rate_24 is null or rate_24 > 0),
  rate_second numeric check (rate_second is null or rate_second > 0),
  weekend_rate_second numeric check (weekend_rate_second is null or weekend_rate_second > 0),
  call_bonus numeric check (call_bonus is null or call_bonus > 0),
  hourly_call_1st numeric check (hourly_call_1st is null or hourly_call_1st > 0),
  weekend_rate_24 numeric check (weekend_rate_24 is null or weekend_rate_24 > 0),
  distance numeric check (distance is null or distance > 0),
  distance_source text check (distance_source is null or distance_source in ('manual', 'auto')),
  rates_source text,
  rates_source_file text,
  rates_source_date text,
  notes text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.facilities enable row level security;
drop policy if exists "own facilities" on public.facilities;
create policy "own facilities" on public.facilities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No separate (user_id) index: the unique index below already serves
-- user_id-only lookups through its leftmost column.
create unique index if not exists facilities_user_name_idx on public.facilities (user_id, (lower(name)));
