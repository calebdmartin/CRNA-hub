# CRNA Hub — functional local-first release

This is a static, mobile-friendly application. Deploy it on Vercel using **Framework Preset: Other**, **Root Directory: `./`**, and **Build Command: none**. Upload the *contents* of this folder to the repository root (not the ZIP itself). Vercel should redeploy when `main` is updated.

## Included
- Dashboard with interactive month-grid calendar and day selection
- Shift management, facility-specific default rates, monthly income totals, shift CSV export
- Hospital profiles with rates, one-way distance, and offline notes
- W-2 PTO hours ledger with balance and accrual rules (manual accrual posting)
- Credentials, connect-first: the Credentials tab now opens with three connection cards — NBCRNA, AANA, and State Licenses — each showing "Not connected", what it would pull automatically when connected, and a Connect button. Manual entry lives below, under a clear "Manual entry (fallback only)" heading, and is not the lead.
- NBCRNA certification, AANA membership, and state license tracking (separate sections, user-entered records only — no automatic verification, no API sync, no document uploads; document fields hold a filename or note only)
- Credential deadlines on the dashboard, with per-license reminder windows (default 90/60/30/7 days)
- Mileage log, export, and schedule-based trip **drafts** requiring verification
- CSV schedule import, JSON backup/restore
- Offline service worker for cached app shell (after initial online visit)
- Ask Assistant (local-first, Assistant tab): answers questions about CRNA Hub and about the user's own records stored on this device (upcoming shifts, monthly income from recorded shifts, credential deadlines, facilities, mileage, PTO, CE totals). It is NOT a live AI model — no network calls, no API key, and nothing is sent to any outside service. It never answers clinical questions and never quotes facility notes, passwords, or patient information.

## Credentials — connect-first design (manual entry is fallback only)
The intended product is fully integrated credentialing: when the user connects NBCRNA, AANA, and state nursing portals, the app pulls their information automatically, with minimal to no manual entry. The Credentials tab is built that way now — connection cards first, manual forms second, clearly labeled.
- **NBCRNA card** would pull: certification status, certification period, renewal / recertification deadline, MAC Ed / MAC Dev progress, and CPC check-in status.
- **AANA card** would pull: membership status, membership expiration, and CE transcript totals (Class A / Class B).
- **State Licenses card** would pull, per state: license status, license type (RN / APRN), license number, issue date, and expiration date.
- **Connect buttons do not fake a connection.** Clicking one shows an honest in-app message: automatic portal pull requires the Supabase backend (auth + secure server-side connection), which is not connected yet, so the button cannot pull live data today. No portal passwords are stored, and no client-side code attempts to scrape a portal.

## What is still blocked on Supabase (credentials)
- **Supabase Auth** — a signed-in user identity, so pulled records belong to one user only.
- **A Supabase Edge Function (or equivalent server-side connection)** — the only place a portal connection may be held. Portal credentials, if a portal ever supports an authorized connection, must never be stored in client JavaScript, localStorage, or the public repo.
- **Official portal access** — NBCRNA and AANA do not publish a public member API for third-party apps (checked November 2026). Until an authorized route exists for a given portal, that card can only be honest about the block; it must not claim verification. Public state-board verification lookups (e.g. Ohio eLicense, West Virginia lookup / Nursys) are a separate, earlier candidate for automatic status/expiration checks once the backend exists.
- **Per-user tables with Row Level Security** for the pulled records (nbcrna_profiles, aana_memberships, licenses, ce_records), replacing the local-only shape.
Until all of the above land, every credential record in the app is user-entered and labeled "not verified", and manual entry remains the fallback — never presented as a live portal pull.

## Ask Assistant — planned server version (not built yet)
When Supabase is connected, the real assistant should be a Supabase Edge Function, not client-side code:
- The AI provider API key lives only in the Edge Function's server-side secrets (never in the repo, never in client JavaScript, never in Vercel client env vars).
- The app calls only the Edge Function over HTTPS, authenticated as the signed-in user (Supabase Auth JWT, Row Level Security on the user's own tables).
- The function sends the model only the minimum needed to answer: the user's question plus a small, structured summary of their own records for that question (e.g. upcoming shifts, totals) — never facility notes/codes, never documents, and never patient information, and never a document's contents without the user's explicit authorization for that request.
- Rate limiting and a per-user request cap on the function; no clinical advice (redirect to professional sources); every answer about records must cite the records it used, and say plainly when data is missing.
- Until that function exists, the Assistant tab honestly says no live AI model is connected.

## Important limitations
This is **not** a Supabase-authenticated multi-user app. Credential records are user-entered and are not verified by NBCRNA, AANA, or any state board. The local data shape (nbcrna, aana, licenses, ce_records) is intended to map to future Supabase tables with a user_id, but no cloud sync exists yet. Records are saved to this browser's localStorage and are not synced across devices. Back up regularly. There is no live AI model connection. There is no OCR for screenshot/PDF/Excel uploads, no automatic driving detection, no geocoding, no alarm scheduling, no push notifications, and no QuickBooks/TurboTax direct integration. CSV exports can be used for manual workflows. Do not store passwords or patient information. Facility codes/notes on a shared device should be treated as sensitive because localStorage is not encrypted. Mileage tax treatment depends on facts; regular commuting is generally nondeductible. The mileage draft generator uses user-entered distances, not GPS.

## Existing starter data
Reads and migrates records from `crna-hub-starter-v1` without deleting the original. Restore from JSON if moving devices. Browser private mode, site data deletion, or browser changes can erase local records.
