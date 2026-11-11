-- CRNA Hub — migration 013: push notification subscriptions + sent log
-- (Nov 11, 2026).
--
-- Caleb's north star (Nov 11, 2026): "I want all functions to be running
-- in the background as much as possible and send notifications when
-- action is needed. That's the whole point of the app. After initial
-- set up it should keep an eye on everything for the CRNA."
--
-- Push is the backbone of that: the push-watchdog Edge Function runs a
-- scheduled evaluation pass over every user's synced records and sends
-- a Web Push ONLY when a human action is genuinely required (renew a
-- credential, finish education hours, relink QGenda, sign in to a
-- portal, reconnect a calendar, add next month's shifts). These two
-- tables are its state:
--
--   * push_subscriptions — one row per user + device/browser that
--     turned push on. `endpoint` is the push service URL (unique per
--     user); `keys` holds the p256dh/auth pair the push service gave
--     that device; `tz` is the device's IANA timezone so the watchdog
--     can respect quiet hours (22:00–06:00 user-local) and local
--     dates. Written by the app with the user's own token (RLS below);
--     read by the watchdog with the service role.
--
--   * push_sent_log — one row per (user, trigger). `trigger_key`
--     encodes the trigger type + subject + threshold/episode (e.g.
--     "cert|WV APRN|2027-06-30|30", "qgenda|<episode-start>"), so a
--     notification can never repeat across devices or across watchdog
--     runs: the watchdog inserts the row BEFORE sending and skips any
--     trigger already logged. Client never writes here; the watchdog
--     (service role) owns it, so RLS simply gives users read access to
--     their own log rows for transparency.
--
-- Run AFTER migration 012. Idempotent: safe to re-run.
--
-- AFTER running this migration, Caleb must also (dashboard clicks, not
-- SQL): deploy the push-watchdog Edge Function and set its secrets —
-- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto:),
-- WATCHDOG_CRON_SECRET — and schedule the evaluate call (see the
-- commented pg_cron example at the bottom of this file).

create table if not exists public.push_subscriptions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  tz text,
  ua text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.push_sent_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger_key text not null,
  sent_at timestamptz default now(),
  primary key (user_id, trigger_key)
);
alter table public.push_sent_log enable row level security;
drop policy if exists "own push sent log" on public.push_sent_log;
create policy "own push sent log" on public.push_sent_log
  for select using (auth.uid() = user_id);
create index if not exists push_sent_log_user_idx on public.push_sent_log (user_id);

-- ---------------------------------------------------------------------
-- Scheduling the watchdog (OPTIONAL, run separately when ready — this
-- block is commented out on purpose; it needs pg_cron + pg_net enabled
-- and the WATCHDOG_CRON_SECRET value pasted in):
--
-- The evaluate endpoint is idempotent, so extra runs are harmless.
-- Every 6 hours keeps quiet-hours holds short: a notification that
-- lands in the 22:00–06:00 window is held and goes out on the first
-- run after 06:00 user-local.
--
-- select cron.schedule(
--   'crna-hub-push-watchdog',
--   '0 */6 * * *',
--   $$ select net.http_post(
--        url := 'https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/push-watchdog',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'x-watchdog-secret', '<WATCHDOG_CRON_SECRET>'
--        ),
--        body := jsonb_build_object('action', 'evaluate')
--      ); $$
-- );
-- ---------------------------------------------------------------------
