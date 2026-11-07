-- CRNA Hub — migration 011: two-status model (Nov 6, 2026).
--
-- Caleb's status model change: only 'confirmed' and 'proposed' are
-- working statuses — 'submitted' is eliminated (the Dashboard split
-- is C/P now, not C/S/P). Every shift that ever carried 'submitted'
-- originated from a real schedule, so those rows convert to
-- 'confirmed', and the shifts.status CHECK (created in migration
-- 007) drops 'submitted' so the value cannot come back.
--
-- The client performs the same conversion at load time
-- (normalizeShiftStatus maps 'submitted' -> 'confirmed' and every
-- cloud upload passes through it), so this migration and the client
-- agree; running both is idempotent. The `data` jsonb payloads are
-- NOT rewritten here: a stale 'submitted' inside a payload is
-- converted by the client the next time the record loads, and the
-- converted value is what the next upload writes back.
--
-- Idempotent: safe to re-run.

update public.shifts set status = 'confirmed' where status = 'submitted';

alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts add constraint shifts_status_check
  check (status in ('proposed', 'confirmed', 'rejected', 'canceled', 'completed'));
