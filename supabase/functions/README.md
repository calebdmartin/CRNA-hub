# CRNA Hub — live calendar sync: deploy + owner setup

This folder is the complete server side of live two-way calendar sync.
It is deployable with the Supabase CLI. Nothing in this folder contains
a secret, client ID, token, or password — those live only in Supabase
function secrets (server side) and in the provider consoles below.

## What is in here

- `google-auth/` — Google OAuth start + callback (PKCE, offline access).
- `outlook-auth/` — Microsoft Entra OAuth start + callback (PKCE).
- `sync-calendar/` — the sync engine: per-provider sync with sync tokens
  (Google), delta links (Outlook), and CalDAV sync-collection (Apple);
  Apple connect with an app-specific password; sync status, sync log,
  disconnect, auto-delete toggle, and deletion resolution.
- `portal-sync/` — live credential-portal connections for the Credentials
  tab: NBCRNA public verification by name (no password; Oracle APEX
  submit — implemented but UNPROVEN as of Nov 5, 2026, its submit
  endpoint 404s server-side), state-board verification attempts (WV and
  Ohio block automation and return the manual route instead of a fake
  pull), and AANA one-time member sign-in (credentials used in-memory
  for one attempt only, never stored or logged; SSO is bot-gated, so it
  usually reports that sign-in could not be completed). Every pulled
  record is labelled with its source and retrieval date in
  `portal_connections` / `nbcrna_profiles` / `aana_memberships` /
  `licenses` (migration 001 tables).
- `extract-contract/` — AI contract reading ("Read with AI", the PRIMARY
  path for contract photos): gpt-4o-mini vision read of the photos the
  user selected, returning structured rates + transcribed text into the
  same preview-before-save flow as OCR. On-device OCR is the labelled
  fallback only.
- `assistant-chat/` — live Assistant chat (Assistant tab): gpt-4o-mini
  answers the user's question from a minimal structured summary of
  their own records only (counts, totals, next shifts) — never facility
  notes/codes, documents, or patient information (server-side denylist
  backstop). Same `OPENAI_API_KEY` secret as `extract-contract`.
  Best-effort per-user throttle (1 per 10s, 30 per rolling hour);
  the durable per-user cap (`assistant_chat_log` table) is final-only
  and not yet built. DEPLOYED Nov 5, 2026 (`assistant-chat` v1,
  verify_jwt on); if it or the key is ever unavailable, the Assistant
  tab falls back to deterministic on-device answers, labelled honestly.
- `_shared/` — auth validation, AES-GCM token encryption, PostgREST
  helpers, shift/event mapping, and one provider module each
  (`google.ts`, `outlook.ts`, `caldav.ts`).
- `../supabase-schema-003.sql` — tables `calendar_connections`,
  `calendar_sync_map`, `calendar_oauth_states`,
  `calendar_pending_deletions`, `sync_log` (all RLS, own-rows only).
- `../supabase-schema-004.sql` — Apple import source: `source_calendar_url`
  / `source_calendar_name` on `calendar_connections` plus the
  `calendar_import_map` pairing table (RLS, own-rows only).

## Owner step 1 — run the migrations (once)

In the Supabase dashboard for project `xgoghgihfhtnyevgapyp`, open the
SQL Editor and run `supabase/supabase-schema-003.sql`, then
`supabase/supabase-schema-004.sql` (after 001/002). Migration 004 is
what lets a user pick an Apple calendar to import shifts from; without
it, sync still works against the dedicated "CRNA Hub" calendar, but the
import-source picker reports `migration_004_required` instead of
saving a source.

## Owner step 2 — deploy the functions (once)

```sh
supabase link --project-ref xgoghgihfhtnyevgapyp
supabase functions deploy google-auth outlook-auth sync-calendar
supabase functions deploy extract-contract assistant-chat
```

Or run the script in this repo (it takes no secrets as arguments):

```sh
sh supabase/deploy-calendar-sync.sh
```

## Owner step 3 — set function secrets (once, server side only)

```sh
supabase secrets set \
  APP_URL="https://<your-vercel-deployment-url>" \
  CALENDAR_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_ID="<from Google Cloud, step 4>" \
  GOOGLE_CLIENT_SECRET="<from Google Cloud, step 4>" \
  OUTLOOK_CLIENT_ID="<from Entra, step 5>" \
  OUTLOOK_CLIENT_SECRET="<from Entra, step 5>"
```

- `OPENAI_API_KEY` is the one AI secret, shared by `extract-contract`
  and `assistant-chat` (set it once — both functions read it from their
  own environment). Until it is set, both functions answer
  `openai_key_missing` and the app says so plainly instead of failing
  silently: contract photos fall back to the labelled on-device OCR
  button, and the Assistant falls back to on-device answers.
- `APP_URL` is the URL users actually open (the Vercel preview or
  production URL). After a provider consent screen, the callback returns
  the user to `APP_URL?calendar_connected=<provider>`. If it is unset,
  the callback shows a plain "connected — return to CRNA Hub" page
  instead of guessing a URL.
- `CALENDAR_ENCRYPTION_KEY` must be 64 hex characters (32 bytes). It is
  the AES-GCM key for stored tokens/passwords. If it is ever rotated,
  existing stored tokens must be re-connected, because old ciphertext
  cannot be decrypted with a new key.
- Never put any of these values in this repo, in client code, in
  `supabase-config.js`, or in a Vercel client environment variable.

## Owner step 4 — Google Cloud OAuth app (once)

1. Google Cloud Console → create/select a project → APIs & Services →
   Library → enable **Google Calendar API**.
2. APIs & Services → Credentials → Create Credentials → OAuth client ID
   → Application type **Web application**.
3. Authorized redirect URI (exact, no trailing slash):
   `https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/google-auth`
4. Copy the client ID and client secret into the function secrets above.
5. Scopes requested at consent (shown to the user by Google):
   `https://www.googleapis.com/auth/calendar` — needed to create the
   dedicated "CRNA Hub" calendar and read/write events in it. The sync
   only ever touches that one calendar, never the user's other calendars.
6. Until the app passes Google verification (if required for the
   audience), test users must be added under Audience → Test users.
   That is a Google requirement, not something the app can bypass.

## Owner step 5 — Microsoft Entra app (once)

1. Entra portal (Microsoft Entra admin center) → App registrations →
   New registration. Supported account types: personal Microsoft
   accounts (and work/school accounts if you want them).
2. Redirect URI, platform **Web** (exact, no trailing slash):
   `https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/outlook-auth`
3. API permissions → Microsoft Graph, delegated:
   `Calendars.ReadWrite`, `offline_access`, `openid`, `profile`.
4. Certificates & secrets → New client secret; copy its value (not the
   ID) into the function secrets above, with the Application (client) ID.
5. The sync only ever touches the dedicated "CRNA Hub" calendar created
   in the user's mailbox, never their other calendars.

## Apple — no owner app to register (by design)

Apple offers no OAuth for third-party calendar apps, so there is nothing
for the owner to register and no client ID/secret. Each user, once, in
their own Apple account settings (appleid.apple.com → Sign-In and
Security → App-Specific Passwords), creates an app-specific password
named e.g. "CRNA Hub", then enters their Apple ID and that password once
in the app's Apple connect form. The password travels once over HTTPS to
`sync-calendar`, is validated with a CalDAV PROPFIND, and only its
AES-GCM ciphertext is stored server-side. It is never stored in the
browser, never shown again, and revoking it in Apple account settings
disconnects sync immediately. The app UI states this plainly instead of
pretending Apple is OAuth.

## Apple import source — pulling shifts from "Caleb Work Schedule"

The dedicated "CRNA Hub" calendar starts empty, so a user whose shifts
live in another iCloud calendar syncs nothing until they pick that
calendar as an import source (Apple card → "Import shifts from").
The flow is deliberately narrow:

- The app lists the user's iCloud calendars server-side
  (`GET sync-calendar?action=apple-calendars`, stored CalDAV
  credentials, password never returned) and the user picks one.
- The choice is saved with `POST { action: "set-apple-source-calendar",
  calendarUrl, calendarName }`. The URL is verified against the
  account's calendar home-set before anything is stored, and the
  dedicated calendar cannot be picked as its own source. Clearing the
  choice is the same call with an empty `calendarUrl`.
- On every Apple sync, after the dedicated-calendar two-way sync, the
  function full-scans the source calendar (it has no sync token of its
  own — and the scan is unfiltered, so it returns the FULL history
  iCloud holds, past dates included, not a 2025–2028 window) and
  imports every event that parses as a work shift
  (`parseWorkShiftEvent` in `_shared/calendar.ts`). Recognition order:
  Holzer first, with its exact confirmed rates (Holzer 8 → 8-hour day
  $2,125; Holzer 10 → 10-hour shift $2,625; Holzer 8/2nd call →
  Second call, $3,000 weekday / $2,000 weekend; Holzer 24/1st call →
  24-hour call, $4,800 weekday / $4,200 weekend; Holzer 12 has no
  confirmed rate, so its pay stays blank); then the user's Facilities
  list, sent with each sync by the browser (name or alias, in the event
  title or the event location — even a bare facility name, or a bare
  shift pattern with the facility in the location), priced only from
  that facility's own pay rule; then a generic fallback for facilities
  not yet listed (facility-like title + shift pattern, e.g. "CAMC 8"),
  which always imports unpriced. Anything else is skipped and counted,
  never imported as junk, and no other calendar is read.
- A facility added after an import re-scans cleanly: skipped events
  leave no import-map row, so the next sync re-evaluates them, and a
  shift already imported unpriced is re-priced when its facility gains
  a pay rule. Facilities themselves live on-device, like shifts — the
  server stores none of them and no new migration is needed; the
  browser sends the list with every sync. Ask-first (Nov 5, 2026):
  shifts at a facility with no saved rule are NOT imported and no
  facility is created for them — the sync reports the hospital as a
  suggestion instead ("We noticed shifts at <Hospital> — add it as a
  facility?"), and the user picks one of three paths: sync your
  calendar, upload a contract, or manually enter the facility's
  hourly rate. Once the facility is added, the next sync re-scans the
  held events and imports them, priced.
- Imported shifts arrive as provider changes with source
  `apple-import` and note `Imported from <calendar name>`, and the sync
  response carries an `imported` summary (`sourceCalendarName`,
  `created`, `updated`, `skipped`, `duplicates`, plus `unpriced`,
  `skippedSuggested`, `suggestions`, and `newFacilities`) that the
  panel renders as "imported N shifts from Caleb Work Schedule".
- Dedupe is date + facility + shift type (never a second copy), and
  pairing lives in `calendar_import_map` (migration 004) — separate
  from `calendar_sync_map`, so a shift can be paired with the dedicated
  calendar AND its source event without either pairing overwriting the
  other. A source event that disappears is never treated as a deletion,
  and a locally deleted imported shift is never re-imported.
- Writes still go to the dedicated "CRNA Hub" calendar only — never
  into the source calendar. Imported shifts reach the dedicated
  calendar on the NEXT sync (once the browser sends them back as local
  shifts), via the normal local → provider step. Deletions still go
  through Pending deletions (default off).

## How the app detects "owner setup pending"

On opening the Import & Backup tab, the app calls
`GET /functions/v1/sync-calendar?action=config` (public booleans only).
If that call fails (functions not deployed) or a provider's flag is
false (its client ID/secret not set), the Connect button for that
provider reads **"Live sync setup not finished by the app owner yet"**
and opens the owner-setup wizard instead of starting OAuth. No
connection is faked. Once the functions are deployed and secrets are
set, the same buttons start the real OAuth flow with no app change.

## Conflict rule (implemented server-side and in the app)

Newest edit wins, compared by updated timestamps on both sides; equal
timestamps keep the local copy. Deletions are never silent: a
provider-side deletion is held as a pending deletion for the user to
confirm (or, if the user explicitly turns auto-delete on for that
provider, applied). A browser-confirmed local deletion is sent as a
tombstone and applied to the provider. Every run writes a `sync_log`
row (provider, direction, created/updated/flagged/deleted counts,
timestamp, error) shown in the app's sync log.

## What sync cannot do yet (honest limits)

- Sync runs when the app is open (on load for connected providers, on
  "Sync now", and shortly after a shift change). Shifts live in browser
  storage, not in a Supabase shifts table, so no server-side run can
  push into a closed browser. A future server-side shifts table plus a
  scheduled invocation would close that gap; it is not built here.
- Apple deletions are detected through CalDAV sync-collection (which
  iCloud supports). If a CalDAV server only supports the full etag-scan
  fallback, deletions on that server are not detected and are never
  guessed at.
- Google/Outlook test-user and verification requirements above are the
  providers' rules; the app cannot bypass them.
