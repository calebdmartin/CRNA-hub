-- CRNA Hub — migration 004: Apple import-source calendar.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 003. It adds only what the Apple import source needs:
-- the user's chosen source calendar on the connection row, and a pairing
-- table for imported shifts. No secrets, tokens, or passwords are stored
-- here: the source choice is only a calendar URL and display name, and
-- the stored CalDAV credentials (encrypted, migration 003) are unchanged.
--
-- If this migration has NOT run yet, the app still works exactly as
-- before: sync runs against the dedicated "CRNA Hub" calendar only, and
-- the source picker reports `migration_004_required` instead of failing
-- silently. The import pairing table is likewise optional at runtime —
-- without it, import dedupe rests on the local date+facility+type guard
-- alone and source-side edits will not update the local shift.
--
-- Row Level Security mirrors migration 003: each user sees only their
-- own rows through the API. The Edge Functions use the service-role key
-- and enforce the same per-user scoping in code.

-- 1. The user's chosen Apple import-source calendar (e.g. "Caleb Work
-- Schedule"), one per Apple connection. NULL means "no import source":
-- sync reads the dedicated "CRNA Hub" calendar only.
alter table if exists public.calendar_connections
  add column if not exists source_calendar_url text;
alter table if exists public.calendar_connections
  add column if not exists source_calendar_name text;

-- 2. Pairing between a CRNA Hub shift and the source-calendar event it
-- was imported from, plus the last-seen updated timestamp on the source
-- side (the conflict-rule input for source-side edits).
--
-- This is deliberately a SEPARATE table from calendar_sync_map: a shift
-- can be paired with the dedicated calendar AND with its source event
-- at the same time, and the two pairings must never overwrite each
-- other. A row survives the local deletion of its shift on purpose: it
-- is what stops a deleted imported shift from being re-imported on the
-- next sync. Disconnect deletes these rows (a fresh connect re-imports).
create table if not exists public.calendar_import_map (
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook', 'apple')),
  shift_id text not null,
  source_calendar_url text not null,
  source_event_id text not null,
  source_updated_at text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, provider, shift_id),
  unique (user_id, provider, source_event_id)
);
alter table public.calendar_import_map enable row level security;
drop policy if exists "own calendar import map" on public.calendar_import_map;
create policy "own calendar import map" on public.calendar_import_map
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
