-- CRNA Hub — migration 010: full cloud sync for shifts, facilities,
-- mileage trips, pay stubs, and profile/settings.
--
-- Run AFTER migration 009. Migrations 007–009 created the typed tables
-- (shifts / facilities / mileage_trips) with per-user RLS, and those
-- tables are the sync store — but a purely typed mapping is LOSSY for
-- the client records: the app stores camelCase, stringly-typed records
-- with fields the typed columns never had (shifts.contractId,
-- mileage.dismissedAt / originChosen, facility provenance strings, and
-- any field a future build adds). A data-safety sync must round-trip a
-- record byte-for-byte, so each table gains a `data jsonb` column that
-- carries the COMPLETE client record. The typed columns stay populated
-- best-effort (they serve queries, reporting, and the calendar sync
-- joins) but `data` is authoritative when a record is read back down.
--
-- Also here:
--   * mileage_trips.status learns 'dismissed' — the client has used it
--     since the current-month mileage cleanup (Nov 6, 2026): a cleared
--     backlog trip is kept, excluded from totals, and restorable. The
--     009 CHECK would have rejected every dismissed trip at upload.
--   * pay_stubs: a pay-stub record is a pay SCHEDULE the user approved
--     from a stub read (agency, frequency, period, pay date, amounts).
--     The stub image itself is never stored anywhere — same rule as on
--     the device. Typed columns are minimal on purpose; `data` carries
--     the record.
--   * user_settings: one row per user; `data` is the client's
--     db.settings object (schedule name, employment type, income goal,
--     home/hotel addresses for mileage, and the rest). The step-1
--     profile fields ALSO still ride in Auth user_metadata (existing
--     pattern, unchanged) — settings sync is the full-fidelity copy.
--
-- RLS mirrors every earlier migration: each user sees only their own
-- rows through the API; the client always sends the user's own token,
-- so RLS is the enforcement, not app code.

alter table public.shifts add column if not exists data jsonb;
alter table public.facilities add column if not exists data jsonb;
alter table public.mileage_trips add column if not exists data jsonb;

alter table public.mileage_trips drop constraint if exists mileage_trips_status_check;
alter table public.mileage_trips add constraint mileage_trips_status_check
  check (status in ('draft', 'verified', 'skipped', 'dismissed'));

create table if not exists public.pay_stubs (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  agency text not null,
  pay_date date,
  data jsonb,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.pay_stubs enable row level security;
drop policy if exists "own pay stubs" on public.pay_stubs;
create policy "own pay stubs" on public.pay_stubs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists pay_stubs_user_idx on public.pay_stubs (user_id);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
