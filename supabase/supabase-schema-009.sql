-- CRNA Hub — migration 009: server-side mileage trips table.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 008. It creates only the mileage table. It does NOT
-- backfill anything from any device: tables start empty, and the client
-- sync that uploads on-device trips is a separate step. No secrets,
-- tokens, or passwords are stored here, and no patient information.
--
-- Row Level Security mirrors migrations 001–005: each user sees only
-- their own rows through the API. The Edge Functions use the service-role
-- key and enforce the same per-user scoping in code.
--
-- Mirrors the on-device mileage record (app.js `db.mileage`):
--   * id is TEXT, the client's own id, like shifts (migration 007).
--   * status is the verified-only gate: 'draft' (needs the weekly
--     review), 'verified' (confirmed — the ONLY status that counts in
--     mileage totals and exports), 'skipped' (reviewed, not a trip).
--     Drafts are never counted until the weekly review confirms them.
--   * miles is NULL when not entered (a blank draft), never 0: the
--     CHECK rejects 0 and negatives, the same "never guessed, never $0"
--     rule as pay in migration 007. A draft whose distance cannot be
--     computed is stored with miles NULL and miles_source
--     'needs-manual', flagged for manual entry.
--   * one_way_miles is the one-way leg stored alongside, so flipping
--     trip_type re-calculates exactly instead of halving/doubling a
--     rounded total twice. miles itself is the stored trip distance
--     (round trip already includes the return leg) and is always summed
--     once — a round-trip value is never doubled again.
--   * trip_type defaults to 'round-trip', matching the client default.
--     origin is 'home' | 'hotel' | 'other'; hotel_address holds the
--     hotel / other address when the origin is not home (blank for home).
--   * miles_source is informational only (no CHECK): 'auto' |
--     'manual' | 'manual-override' | 'needs-manual' | '' (unset, for a
--     trip logged with no miles yet). Writers map '' to NULL.
--   * facility is free text, like shifts.facility (migration 007): a
--     trip may name a facility the user has not added yet, and facility
--     renames must not orphan trips. The weekly review matches trips to
--     shifts by (date, facility), case-insensitive — that matching stays
--     in app code, not in a database constraint.
--   * Hotel stays (date blocks with one address) are NOT a table here:
--     they are mileage inputs that live on the device (db.hotelStays)
--     and only affect how a draft's miles are calculated. If stays ever
--     need to sync, they get their own migration; nothing in this table
--     depends on them.
create table if not exists public.mileage_trips (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  facility text,
  purpose text not null,
  miles numeric check (miles is null or miles > 0),
  one_way_miles numeric check (one_way_miles is null or one_way_miles > 0),
  trip_type text not null default 'round-trip'
    check (trip_type in ('round-trip', 'one-way')),
  miles_source text,
  origin text not null default 'home'
    check (origin in ('home', 'hotel', 'other')),
  hotel_address text,
  status text not null default 'draft'
    check (status in ('draft', 'verified', 'skipped')),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.mileage_trips enable row level security;
drop policy if exists "own mileage trips" on public.mileage_trips;
create policy "own mileage trips" on public.mileage_trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists mileage_trips_user_date_idx on public.mileage_trips (user_id, date);
