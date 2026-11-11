-- CRNA Hub — migration 014: multi-source calendar picks + push-log
-- wipe delete (Nov 11, 2026, v120).
--
-- Two unrelated gaps, one migration:
--
-- 1. calendar_connections.source_calendars / source_choice.
--    Caleb's fresh-setup test (Nov 11, 2026) exposed that the
--    work-calendar picker was Apple-only, buried in a collapsed
--    card, and skippable — he reconnected Apple after a start-over
--    wipe, was never asked which calendar to pull from, and zero
--    shifts imported behind a green "Connected". v120 makes the
--    source picker a required step for EVERY provider
--    (Apple/Google/Outlook):
--      * source_calendars — jsonb array of { ref, name } the user
--        ticked (ref = CalDAV URL for Apple, calendar id for
--        Google/Outlook). More than one calendar may be picked.
--      * source_choice — 'chosen' | 'none'. 'none' is a real,
--        remembered answer ("app calendar only — I have no work
--        calendar"), distinct from NULL (never asked). A reconnect
--        resets both to NULL so the picker runs again.
--    The legacy migration-004 columns source_calendar_url /
--    source_calendar_name stay and are mirrored from the first
--    picked entry, so older code paths keep working. Until this
--    migration runs, the app degrades honestly: a single Apple
--    source still saves through the legacy columns, and the client
--    remembers richer choices on-device (the server answers
--    migration_014_required, never a silent success).
--
-- 2. push_sent_log: allow a user to DELETE their own rows.
--    Migration 013 gave users SELECT-only access (the watchdog,
--    service role, owns writes). The start-over wipe (v120) deletes
--    the user's push state — subscriptions AND sent log — through
--    the app with the user's own token, so it needs a delete policy.
--    Scoped to the user's own rows, like every other policy here.
--
-- Run AFTER migration 013. Idempotent: safe to re-run.

alter table public.calendar_connections
  add column if not exists source_calendars jsonb;
alter table public.calendar_connections
  add column if not exists source_choice text;

drop policy if exists "own push sent log delete" on public.push_sent_log;
create policy "own push sent log delete" on public.push_sent_log
  for delete using (auth.uid() = user_id);
