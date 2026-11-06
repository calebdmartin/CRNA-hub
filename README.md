# CRNA Hub — web preview (`muse/credentialing`)

A mobile-friendly app for independent CRNAs: your schedule, your income, and your professional life in one place. Tagline: *Less Admin. More Patient Care.*

This branch is the **web preview**. The finished product is a native iOS app — where this preview needs a stand-in (Apple calendar, portal sign-in, background sync), the copy says so plainly, in a dashed-amber "Preview stand-in" box. Nothing here fakes a connection.

Deploy on Vercel with **Framework Preset: Other**, **Root Directory: `./`**, **Build Command: none**. Upload the *contents* of this folder to the repository root. Vercel redeploys when this branch is updated.

## What's in the app

- **Dashboard** — month calendar, upcoming shifts, credential deadlines, estimated paychecks, and income in three totals: **C** confirmed only, **S** submitted-inclusive, **P** proposed-inclusive (year to date + predicted annual). Unpriced shifts are counted, never $0.
- **Shifts** — add/edit by hand, or import from a calendar, a schedule file, or QGenda (below). Every shift has a status (proposed / submitted / confirmed / …); changing it re-prices C/S/P at once. W-2 salary days (Off / PTO) are never double-counted.
- **Facilities** — each hospital with its pay rule (hourly, flat 8/10/12h, 24h call, second call, overnight bonus). Blank means "not taken here", never $0. Facilities drive calendar import: an event titled with just the facility name still imports.
- **Pay stubs** — one stub per agency, optional. The app reads the pay frequency and pay date and puts an estimated paycheck on your calendar per agency. Estimates only — never in the C/S/P totals, never pushed to your real calendar. The stub itself is never stored.
- **Credentials** — NBCRNA, AANA, and state licenses, connect-first (below). Certification documents (ACLS / BLS / PALS / NRP) with expiration dates read from the document. Reminders 90/60/30/7 days.
- **Mileage** — log trips, auto-calculate from home (or a hotel stay), weekly review to confirm a whole week at once. Round trip by default; each trip counts once.
- **PTO** — W-2 PTO ledger with balance and accrual.
- **Assistant** — live AI (gpt-4o-mini) via the `assistant-chat` Edge Function, answering from a small summary of your own records. Falls back to labelled on-device answers when the live model is down. Never clinical, never quotes facility notes, never touches patient info.
- **Account** — sign in (Supabase Auth), step-1 profile, live sync, QGenda, schedule upload, JSON backup/restore. No Import & Backup tab — its pieces live here (sync + uploads in step 2, backup below them, contract import on Facilities).

## Getting started — 5 steps, in order

1. **Create your account** — email + password, the name as it appears on your schedule, employment type (W-2, 1099, or both), and an optional monthly income goal (or skip it). Done when the account exists.
2. **Sync calendars or upload a schedule** — connect a calendar, or upload a schedule file. The app pulls only from the calendar you pick — never writes to it. Done when a calendar, a schedule, or the QGenda feed is connected.
3. **Add facilities & contracts** — from a contract upload, a calendar suggestion, or by hand. Pay stubs optional. Done when a facility has a rate or a contract.
4. **Connect credentialing services and licenses** — NBCRNA, AANA, state licenses. You sign in yourself; the app never sees or stores a portal password. Done when a credential record is on file — that does not mean a portal pulled it.
5. **Upload certifications** — ACLS, BLS, PALS, NRP. The app reads the expiration date and reminds you 3 months out. Done when a certification is saved.

The income goal lives in step 1 only — it was removed from the Dashboard Nov 5, 2026.

## Calendar sync — live, two-way

Connect once per provider, then pick the calendar your shifts already live in (e.g. "Caleb Work Schedule"). The app pulls from that calendar only and keeps its own calendar behind the scenes for shifts you add here. Your work calendar is never written to.

- **Two-way push:** every shift you add or edit here lands in the app's own calendar on the next sync. Each shift shows its state on Dashboard → Saved shifts: **On your calendar / Not yet synced / Pending deletion**.
- **Newest edit wins.** A shift deleted on the provider side waits in Pending deletions for your call (Delete here too / Keep here) unless auto-delete is on (default off). A shift you delete here is sent as a tombstone — never silently re-imported.
- **Ask-first hospitals:** shifts at a hospital with no pay rule are held, not imported — the sync suggests it ("We noticed shifts at … — add it as a facility?") with three paths: sync your calendar, upload a contract, or enter the rate by hand. Nothing is added without your tap.
- **Imported shifts arrive as proposed**, never auto-confirmed. No pay rule yet? Unpriced, never $0.
- **Manual fallback:** .ics import/export lives inside the sync section (import with preview + duplicate detection, export all or this month, per-shift "Add to Google / Outlook" links). It is a fallback, not the sync path.

**Preview stand-in (Apple only):** this web preview connects Apple through CalDAV with a one-time app-specific password. The finished app uses EventKit on the device — no password, ever. The stand-in gets no new features. Google/Outlook connect with one click through their consent screens; tokens live server-side only, with a visible sync log.

**Still to build:** a work-calendar picker for Google and Outlook matching Apple's (today only Apple has one); the Microsoft Entra app for Outlook is not registered yet, so Outlook is on the .ics fallback for now.

## Credentials & portals — connect-first

The Credentials tab opens with three connection cards — NBCRNA, AANA, State Licenses — each showing what it would pull, then a Connect button. Manual entry is one form below, clearly labelled "Manual entry (fallback only)". Certification documents sit directly under the State Licenses card.

**Connect opens the real portal for you to sign in yourself.** In the finished app that is Apple's system sign-in sheet (iPhone Passwords + Face ID; the app never sees your password). **Preview stand-in:** in this web preview it opens in a new tab, then "I signed in — check it" asks the assistant to read the record page you show it (screenshot or pasted text) and confirm what it saves in a preview. No portal passwords are stored, and no code here attempts to scrape a portal. A record is labelled Verified only when a pull/check actually returned a record (source + retrieval date).

**Per-source status (Nov 5, 2026 — re-check before claiming more):** NBCRNA public verification is unproven (its submit endpoint 404s server-side); AANA sign-in is SSO + bot-gated; WV and Ohio board lookups block automation (manual route + free Nursys e-Notify for push alerts; Nursys does not verify APRN licenses and is never claimed as a pull). The legacy server-side AANA sign-in endpoint (`connect-aana`, which took a username/password) was **deleted Nov 5, 2026** — the final product never hands the server a portal password, even transiently.

**Monitoring is an active assistant job:** weekly by default, faster near renewal (every 3 days inside 90 days, every 2 days inside 30, daily inside 7). Public checks run automatically where allowed; private portals run when you sign in, and the assistant prompts you to re-sign in when a check is due. In this preview checks cannot run while the app is closed — due checks are flagged and run on tap.

## Reading documents — AI first, OCR fallback

- **Contracts:** upload a contract (text, CSV, .ics, text-layer PDF, or photos — several at once, in order) and the app reads the facility name, address, and rates. Photos are read with **AI vision ("Read with AI" — recommended)** via the `extract-contract` Edge Function (gpt-4o-mini); on-device OCR (Tesseract.js) is the labelled fallback for when you have no connection — less accurate on rate tables. Nothing saves until you approve the preview. **No box for your shift type?** The contract panel also has a "Describe it in your own words" AI chat box: type a pay rule in plain language (e.g. "24hr call, first 8 hours $250/hr, then after 3pm 175/hr until 7am") and the AI (same `extract-contract` function, `rule` mode) returns a structured rule as an editable preview — asking a short clarifying question instead of guessing when something is ambiguous. Totals are computed by the deterministic income engine, never by the AI, and nothing saves until you tap "Use this rule" and then save the facility preview.
- **Schedule files:** spreadsheet (.xlsx), CSV, text-layer PDF, or a photo of a staff schedule. The app picks out only **your** shifts, by the name from step 1 — other people's rows are excluded, uncertain rows stay unchecked, nothing saves until you approve. Photos are read with AI (schedule mode); the rest on-device.
- **Pay stubs:** photo, PDF, or pasted text. AI vision first (paystub mode), deterministic parsing for pasted text / text-layer PDFs, manual entry as fallback. One estimated schedule per agency.
- **Certification documents:** text and text-layer PDFs are read from their text; **photos of cards are read on-device with OCR** (nothing is sent to a server for OCR) — the expiration date is stored as "extracted", editable any time. A document with no date says "no expiration found". Dates are never invented.
- **QGenda:** paste your personal "Your Subscription URL" from app.qgenda.com (Sync button). The app polls that ICS feed like any subscribed calendar, preview-before-save. The URL is stored encrypted server-side, never shown in full, never logged. No QGenda password, ever. No subscription URL? Sign in yourself and bring back a screenshot or Reports export through the schedule upload. The official QGenda REST API (per-hospital account, agreement, fees) is not built — a later per-hospital step.

Contract/cert pictures live in IndexedDB on this device; cloud document storage is not wired up yet, so pictures do not sync. The `certification-documents` bucket and `documents` table exist (migration 002) for that step.

## What syncs, what stays on this device

**Syncs (Supabase Auth + Row Level Security, migration 001 tables):** NBCRNA, AANA, licenses, CE records, portal-connection status. On first sign-in you pick a direction — "Upload my on-device records" or "Load cloud records" — and nothing syncs until you choose. Backups restore onto the device only, never over the cloud account.

**Stays on this device:** shifts, facilities, mileage, PTO, pay stubs, contracts. No server-side shifts table yet — so sync and monitoring run only while the app is open, and there is no cross-device data for those records. Back up regularly.

## Honest limits

- Income figures are estimates from your own rates and shifts — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes. (Shown on the Dashboard, Facilities, and contract previews.)
- Credential records are user-entered or assistant-portal-check unless a pull actually returned a record — sync moves records, it does not verify them.
- No live portal pulls work today (see per-source status above). No push notifications, no alarm scheduling, no automatic driving detection, no QuickBooks/TurboTax integration. CSV exports cover manual workflows.
- The durable per-user Assistant cap (`assistant_chat_log` table) is final-only and not yet built; the function enforces a best-effort throttle (1 per 10s, 30 per rolling hour).
- Do not store passwords or patient information. Facility notes live unencrypted in localStorage on a shared device — treat them as sensitive.

## Owner setup (one step each)

1. **Migrations** — in the Supabase SQL Editor for project `xgoghgihfhtnyevgapyp`, run `supabase-schema-003.sql`, `004`, `005`, then `006` (after 001/002). Note: **migrations 001–002 are not in this repo** — they were run directly in the project (Auth/RLS tables + `documents` table and `certification-documents` bucket). Commit them (or a consolidated schema) before anyone rebuilds from this repo alone. 006 adds the QGenda provider check.
2. **Deploy the functions** — `supabase link --project-ref xgoghgihfhtnyevgapyp`, then `supabase functions deploy google-auth outlook-auth sync-calendar extract-contract assistant-chat qgenda-feed` (or `sh supabase/deploy-calendar-sync.sh`). Full steps: `supabase/functions/README.md`.
3. **Set function secrets** (server side only, never in this repo): `APP_URL`, `CALENDAR_ENCRYPTION_KEY` (64 hex chars), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET`, and the one AI secret `OPENAI_API_KEY` (shared by `extract-contract` and `assistant-chat`). Until the key is set, both answer `openai_key_missing` and the app falls back to labelled on-device reading/answers.
4. **Google Cloud** — enable the Google Calendar API; Web OAuth client; redirect URI `https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/google-auth`; scope `https://www.googleapis.com/auth/calendar`. Add test users until Google verification passes.
5. **Microsoft Entra** — register the app (not done yet — Outlook is on .ics until it is); Web redirect URI `https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/outlook-auth`; delegated Graph permissions `Calendars.ReadWrite`, `offline_access`, `openid`, `profile`.
6. **Apple** — nothing for the owner to register, by design. In the finished app there is nothing for the user to type either (EventKit). The app-specific password is the web-preview stand-in only.

**Supabase config:** `supabase-config.js` already holds the project's publishable key (a public client key, safe to embed). **Never** put the secret key or service-role key in this repo or any client file — those bypass Row Level Security and belong server-side only.

## Final native designs (specs, in code)

- **Calendar sync (EventKit):** `README` section "Final native calendar sync" in the previous version is now this short spec — the sync panel already describes it, and `supabase/functions/_shared/calendar.ts` is the reference implementation for the parser and rules (facilities-driven parsing, dedupe, proposed status, unpriced-never-$0, ask-first suggestions, newest-wins, pending deletions). EventKit replaces CalDAV, the app-specific password, and the server-held Apple credential entirely; sync runs in the background (`EKEventStoreChangedNotification` + background fetch).
- **Portal sign-in (system sign-in sheet):** the spec lives as `PORTAL_NATIVE_SPEC` in `app.js` and in the header of `supabase/functions/portal-sync/index.ts`. The stand-in label is `PORTAL_STANDIN_LABEL` in `app.js`, rendered in a dashed-amber `.standin` box wherever the preview flow appears.

## Existing starter data

Reads and migrates records from `crna-hub-starter-v1` without deleting the original. Restore from JSON if moving devices. Browser private mode, site data deletion, or browser changes can erase local records.
