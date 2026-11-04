-- CRNA Hub — migration 003: live calendar sync (Google / Outlook / Apple).
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migrations 001 and 002. It creates only the tables the calendar
-- Edge Functions use. No secrets, tokens, or passwords are stored here in
-- plain text: token/password columns hold AES-GCM ciphertext produced by
-- the Edge Functions under CALENDAR_ENCRYPTION_KEY (a function secret).
--
-- Row Level Security mirrors migrations 001/002: each user sees only
-- their own rows through the API. The Edge Functions use the service-role
-- key and enforce the same per-user scoping in code (they must, because
-- RLS does not apply to the service role).

-- 1. One row per user per provider. Tokens are encrypted server-side.
create table if not exists public.calendar_connections (
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook', 'apple')),
  provider_account text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  encrypted_password text, -- Apple app-specific password only; NULL otherwise
  access_token_expires_at timestamptz,
  calendar_id text, -- Google/Outlook calendar id, or Apple calendar URL
  sync_token text, -- Google sync token / Apple CalDAV sync token
  delta_link text, -- Outlook Graph delta link
  status text not null default 'connected'
    check (status in ('connected', 'needs_reauth')),
  auto_delete boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, provider)
);
alter table public.calendar_connections enable row level security;
drop policy if exists "own calendar connections" on public.calendar_connections;
create policy "own calendar connections" on public.calendar_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Pairing between a CRNA Hub shift and a provider event, plus the
-- last-seen updated timestamps on both sides (the conflict rule inputs).
create table if not exists public.calendar_sync_map (
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook', 'apple')),
  shift_id text not null,
  provider_event_id text not null,
  provider_updated_at text,
  local_updated_at text,
  provider_etag text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, provider, shift_id),
  unique (user_id, provider, provider_event_id)
);
alter table public.calendar_sync_map enable row level security;
drop policy if exists "own calendar sync map" on public.calendar_sync_map;
create policy "own calendar sync map" on public.calendar_sync_map
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. One-time OAuth state (PKCE verifier). Rows live at most 10 minutes
-- and are deleted on callback; they hold no token, only a verifier.
create table if not exists public.calendar_oauth_states (
  state text primary key,
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook')),
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table public.calendar_oauth_states enable row level security;
drop policy if exists "own calendar oauth states" on public.calendar_oauth_states;
create policy "own calendar oauth states" on public.calendar_oauth_states
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Deletions flagged for user confirmation are ALSO visible here via
-- the sync log (shifts_flagged), but a pending-deletion row lets a
-- future server-side run keep the flag without the browser's memory.
create table if not exists public.calendar_pending_deletions (
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook', 'apple')),
  shift_id text not null,
  provider_event_id text,
  date text,
  facility text,
  type text,
  local_missing boolean not null default false,
  created_at timestamptz default now(),
  primary key (user_id, provider, shift_id)
);
alter table public.calendar_pending_deletions enable row level security;
drop policy if exists "own calendar pending deletions" on public.calendar_pending_deletions;
create policy "own calendar pending deletions" on public.calendar_pending_deletions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. One row per sync run, per provider — the visible sync log.
create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null check (provider in ('google', 'outlook', 'apple')),
  direction text not null default 'both'
    check (direction in ('both', 'connect', 'disconnect')),
  shifts_created integer not null default 0,
  shifts_updated integer not null default 0,
  shifts_flagged integer not null default 0,
  shifts_deleted integer not null default 0,
  error text,
  created_at timestamptz default now()
);
alter table public.sync_log enable row level security;
drop policy if exists "own sync log" on public.sync_log;
create policy "own sync log" on public.sync_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
