-- CRNA Hub — migration 015: agent-read session + request state on
-- portal_connections (Nov 12, 2026, v143).
--
-- v142 made a portal check an AGENT READ: an AI agent, in a real
-- browser session the user signed in to themselves, reads the portal
-- and the result lands through applyPortalAgentRead. v143 builds the
-- SESSION + REQUEST side of that loop, so a read is triggered by one
-- user action ("I'm signed in — read it now") and due checks can
-- queue themselves — no screenshots, no user navigating the portal:
--
--   * session_state — 'live' | 'needs_signin' | 'unknown' (default
--     'unknown'). Set from read outcomes: a successful read proves
--     the session is live; a 'needs-sign-in' result proves it is not.
--     The Credentials cards show it in plain words ("Session live" /
--     "Needs your sign-in"), and the due-prompt machinery keys off
--     it: a due source with a live session never prompts (its read
--     is queued instead); a due source needing sign-in surfaces ONLY
--     the sign-in prompt, never a "check failed" alarm.
--   * read_requested_at — the read request queue. Set when the user
--     taps "I'm signed in — read it now", and quietly by the app's
--     sweep when a check comes due on a source whose session is
--     live. The reader service picks up rows with a pending request;
--     filing a result clears it.
--   * last_read_outcome — the outcome enum of the most recent agent
--     read: 'read' | 'needs-sign-in' | 'blocked' | 'not-found'.
--     (The monitor's fuller log stays in portal monitor state; this
--     column is the queue/session view on the connection row.)
--
-- RLS: portal_connections already has row level security enabled
-- with own-rows policies from its creating migration — every policy
-- is row-scoped (auth.uid() = user_id) and covers all columns, so
-- the new columns inherit exactly the same access. No policy
-- changes are needed; RLS is re-asserted below for completeness.
--
-- Run AFTER migration 014. Idempotent: safe to re-run. Until this
-- migration runs, the app degrades honestly: row creation falls
-- back to the pre-015 columns and the session loop stays dark —
-- nothing errors, nothing is faked.

alter table public.portal_connections
  add column if not exists session_state text not null default 'unknown';
alter table public.portal_connections
  add column if not exists read_requested_at timestamptz;
alter table public.portal_connections
  add column if not exists last_read_outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portal_connections_session_state_chk') then
    alter table public.portal_connections
      add constraint portal_connections_session_state_chk
      check (session_state in ('live', 'needs_signin', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portal_connections_last_read_outcome_chk') then
    alter table public.portal_connections
      add constraint portal_connections_last_read_outcome_chk
      check (last_read_outcome is null or last_read_outcome in ('read', 'needs-sign-in', 'blocked', 'not-found'));
  end if;
end $$;

alter table public.portal_connections enable row level security;
