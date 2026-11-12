-- CRNA Hub — migration 016: calendar-link (ICS feed) connections.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 015. It widens the provider check on
-- calendar_connections so the ics-feed Edge Function can store a
-- user's personal calendar subscription link (provider='ics') —
-- Google Calendar's "Secret address in iCal format", Outlook's
-- published-calendar ICS link, an Apple shared calendar's link.
--
-- The link itself is never stored in plain text: the function
-- encrypts it with AES-GCM (CALENDAR_ENCRYPTION_KEY) into the
-- encrypted_password column — the column that holds "this
-- connection's secret" — and the app only ever shows it back masked
-- (host + last 4 characters). No calendar password is stored
-- anywhere; a link calendar is read-only by nature.
--
-- No new table, no new RLS policy: the existing "own calendar
-- connections" policy (auth.uid() = user_id) already scopes the row
-- to its owner. Until this migration runs, saving a calendar link
-- fails cleanly with ics_not_enabled instead of a database error.

alter table if exists public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;
alter table if exists public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'outlook', 'apple', 'qgenda', 'ics'));
