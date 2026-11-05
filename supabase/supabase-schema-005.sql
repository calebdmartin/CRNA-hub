-- CRNA Hub — migration 005: Apple import-map delivery flags.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 004. It adds two flags to calendar_import_map so the
-- sync can tell the three states of an imported shift apart:
--
--   seen_locally   — the paired shift id has been seen in a sync payload
--                     from the browser, i.e. the shift actually reached
--                     the device. A row WITHOUT this flag was created by
--                     a sync whose response never arrived (for example
--                     the old 25-second proxy timeout), not by a user
--                     deletion.
--   deleted_locally — the user deleted the shift in the app (arrived as
--                     a tombstone). Only rows with this flag are never
--                     re-imported.
--
-- Why this matters: before 005, any import-map row whose shift was not
-- in the browser's payload was treated as "deleted, never re-import".
-- Rows created by syncs whose responses were lost therefore blocked
-- every one of their events forever — 231 parsed Holzer shifts skipped
-- on Nov 5, 2026 with 0 imported, even though nothing was ever
-- delivered. With 005, an unflagged row is repaired (the shift is
-- re-created with the same id) instead of skipped.
--
-- No secrets, tokens, or passwords are stored here. Both columns
-- default to false, so existing rows are treated as "not yet known
-- delivered, not known deleted" — the repair path — until a sync
-- observes them. The sync code degrades safely when these columns do
-- not exist yet (old skip behaviour) and the client "Re-import missing
-- shifts" button is the explicit repair until 005 runs.

alter table if exists public.calendar_import_map
  add column if not exists seen_locally boolean not null default false;
alter table if exists public.calendar_import_map
  add column if not exists deleted_locally boolean not null default false;
