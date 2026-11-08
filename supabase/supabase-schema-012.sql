-- CRNA Hub — migration 012: vehicles table for cloud sync (Nov 7, 2026).
--
-- Run AFTER migration 011. Caleb asked for QuickBooks-style saved
-- vehicles on the Mileage tab: a vehicle has a name/label (e.g.
-- "2022 Silverado"), optional make / model / year / license plate, and
-- exactly one vehicle may be the default — new mileage trips are
-- stamped with it. Vehicles therefore join the full cloud sync
-- (migration 010 pattern) so they survive clear-device -> sign-in
-- exactly like facilities and pay stubs.
--
-- The shape mirrors pay_stubs (migration 010) on purpose:
--   * id is TEXT, the client's own id, like every other synced table.
--   * name is the only typed column besides the payload — it is the
--     one field the row mapper refuses to sync without (a nameless
--     vehicle is meaningless), and it serves reporting/queries.
--   * `data jsonb` carries the COMPLETE client record (make, model,
--     year, plate, isDefault, updatedAt) and is authoritative when a
--     record is read back down — the same data-safety rule as 010.
--
-- Trips do NOT reference this table by foreign key: a mileage trip
-- stores vehicleId plus a vehicleName text snapshot, so deleting a
-- vehicle never breaks a trip's history. That stays in app code, not
-- in a database constraint.
--
-- RLS mirrors every earlier migration: each user sees only their own
-- rows through the API; the client always sends the user's own token,
-- so RLS is the enforcement, not app code.
--
-- Idempotent: safe to re-run.

create table if not exists public.vehicles (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  data jsonb,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.vehicles enable row level security;
drop policy if exists "own vehicles" on public.vehicles;
create policy "own vehicles" on public.vehicles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists vehicles_user_idx on public.vehicles (user_id);
