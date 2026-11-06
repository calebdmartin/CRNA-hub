-- CRNA Hub — migration 007: server-side shifts table.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 006. It creates only the shifts table. It does NOT
-- backfill anything from any device: tables start empty, and the client
-- sync that uploads on-device shifts is a separate step. No secrets,
-- tokens, or passwords are stored here, and no patient information.
--
-- Row Level Security mirrors migrations 001–005: each user sees only
-- their own rows through the API. The Edge Functions use the service-role
-- key and enforce the same per-user scoping in code (they must, because
-- RLS does not apply to the service role).
--
-- Mirrors the on-device shift record (app.js `db.shifts`):
--   * id is TEXT, not uuid: it is the client's own id (crypto.randomUUID),
--     and it is the same key calendar_sync_map / calendar_import_map use
--     as shift_id, so the sync pairings join without casts.
--   * date is a real date: the client stores ISO 'YYYY-MM-DD', which
--     casts directly, and a date column makes year/month scoping a query
--     instead of string work.
--   * status defaults to 'proposed', never silently to confirmed — the
--     same rule as normalizeShiftStatus on the device. 'rejected' and
--     'canceled' count in NO income total; 'completed' counts with
--     'confirmed' (see the C/S/P engine in app.js yearIncomeSplit).
--   * pay is NULL when unpriced, never 0: the CHECK below rejects 0 and
--     negatives at the database, the same blank-never-$0 rule the client
--     (rateOrNull / isPricedShift) and the server (ruleNum) already apply.
--   * facility is free text, NOT a foreign key to facilities: facility
--     names are the join key in the app (facilityByNameOrAlias), a
--     facility can be renamed, and an imported shift may name a facility
--     the user has not added yet (ask-first suggestions flow).
--   * updated_at is set by writers on every update: it is the
--     newest-edit-wins input for calendar sync, exactly like the
--     local_updated_at the sync map already carries. No trigger is used,
--     matching migrations 001–005 (writers own the column).
--   * There is NO unique(user_id, date, facility, type) constraint on
--     purpose: the client dedupes imports by date + facility + type
--     (alias-aware), but two legitimate same-day shifts at one facility
--     with different types exist, and alias-awareness cannot be expressed
--     as a database constraint. Dedupe stays in the app / sync code.
--   * Employment type is NOT stored here: it lives in the user's Auth
--     user_metadata (step 1 profile), and the income engine reads it
--     from there. W-2 salary days (type Off / PTO) are excluded from
--     every income total even with a pay value stored — that rule lives
--     in the engine (isW2SalaryShift), not in this table.
create table if not exists public.shifts (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  facility text not null,
  type text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'submitted', 'confirmed', 'rejected', 'canceled', 'completed')),
  pay numeric check (pay is null or pay > 0),
  incomplete boolean not null default false,
  note text,
  source text, -- 'user-entered' | 'csv-import' | 'schedule-import' | 'qgenda-feed' | 'calendar-google' | 'calendar-apple' | 'calendar-outlook' | 'calendar-file' | 'extracted-from-contract'
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.shifts enable row level security;
drop policy if exists "own shifts" on public.shifts;
create policy "own shifts" on public.shifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists shifts_user_date_idx on public.shifts (user_id, date);
