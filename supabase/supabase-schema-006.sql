-- CRNA Hub — migration 006: QGenda subscription feed.
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 005. It widens the provider check on
-- calendar_connections so the qgenda-feed Edge Function can store a
-- user's personal QGenda Subscription URL (provider='qgenda').
--
-- The URL itself is never stored in plain text: the function encrypts
-- it with AES-GCM (CALENDAR_ENCRYPTION_KEY) into the
-- encrypted_password column — the column that holds "this connection's
-- secret" — and the app only ever shows it back masked (host + last 4
-- characters). No QGenda password is stored anywhere.
--
-- No new table, no new RLS policy: the existing "own calendar
-- connections" policy (auth.uid() = user_id) already scopes the row
-- to its owner. Until this migration runs, saving a QGenda feed fails
-- cleanly with qgenda_not_enabled instead of a database error.

alter table if exists public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;
alter table if exists public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'outlook', 'apple', 'qgenda'));
