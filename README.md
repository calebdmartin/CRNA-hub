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
Done on branch `muse/credentialing`: **Supabase Auth** (a signed-in user identity, so synced records belong to one user only) and **per-user tables with Row Level Security** (`nbcrna_profiles`, `aana_memberships`, `licenses`, `ce_records`, `portal_connections` — migration 001, already created in the project). Still blocked:
- **A Supabase Edge Function (or equivalent server-side connection)** — the only place a portal connection may be held. Portal credentials, if a portal ever supports an authorized connection, must never be stored in client JavaScript, localStorage, or the public repo.
- **Official portal access** — NBCRNA and AANA do not publish a public member API for third-party apps (checked November 2026). Until an authorized route exists for a given portal, that card can only be honest about the block; it must not claim verification. Public state-board verification lookups (e.g. Ohio eLicense, West Virginia lookup / Nursys) are a separate, earlier candidate for automatic status/expiration checks once the backend exists.
Until the Edge Function and an authorized portal route land, every credential record in the app is user-entered and labeled "not verified", and manual entry remains the fallback — never presented as a live portal pull.

## Ask Assistant — planned server version (not built yet)
When Supabase is connected, the real assistant should be a Supabase Edge Function, not client-side code:
- The AI provider API key lives only in the Edge Function's server-side secrets (never in the repo, never in client JavaScript, never in Vercel client env vars).
- The app calls only the Edge Function over HTTPS, authenticated as the signed-in user (Supabase Auth JWT, Row Level Security on the user's own tables).
- The function sends the model only the minimum needed to answer: the user's question plus a small, structured summary of their own records for that question (e.g. upcoming shifts, totals) — never facility notes/codes, never documents, and never patient information, and never a document's contents without the user's explicit authorization for that request.
- Rate limiting and a per-user request cap on the function; no clinical advice (redirect to professional sources); every answer about records must cite the records it used, and say plainly when data is missing.
- Until that function exists, the Assistant tab honestly says no live AI model is connected.

## Supabase Auth + credential sync (new on branch `muse/credentialing`)
The app now signs users in with Supabase Auth (email + password, via the Auth REST API — no extra JS dependency) and syncs credential records to the five migration-001 tables (`nbcrna_profiles`, `aana_memberships`, `licenses`, `ce_records`, `portal_connections`), each row scoped by `user_id = auth.uid()` under Row Level Security. A new **Account** tab shows signed-in state (email, signed-in vs signed-out) and the current mode, which is also shown in the header: cloud, on-device, signed-in-but-undecided, cloud-offline, or "Supabase not configured".
- **What syncs:** NBCRNA, AANA, licenses, CE records, and portal-connection status only. Shifts, facilities, mileage, and PTO stay on-device in this release.
- **No silent overwrites:** on first sign-in the Account tab offers an explicit choice — "Upload my on-device records to my account" or "Load cloud records onto this device" — and nothing syncs until the user picks one. Backups restore onto the device only and never overwrite the cloud account; uploading restored records is a separate, confirmed step on the Account tab. When signed out or offline, the app falls back to its existing localStorage behavior.
- **Connect cards are honest:** on the Credentials tab, signed-in + rows present = "Connected" with the last-synced time; signed-in but no rows = "Connected, no records yet"; signed out = "Not connected". Connect buttons still never fake a portal pull.
- **What still does NOT work:** live NBCRNA / AANA / state portal pulls. Those need a server-side Edge Function (next phase) and are not represented as working features anywhere in the app.

### Enabling Supabase in the preview (one step for the owner)
1. Open the Supabase dashboard for project `xgoghgihfhtnyevgapyp` → Project Settings → API → copy the **Publishable key**.
2. Paste it into `supabase-config.js`, replacing `PASTE_PUBLISHABLE_KEY_HERE`, and redeploy.
3. Sign in on the Account tab. Until that placeholder is replaced, the app shows "Supabase not configured" instead of failing silently, and works on-device exactly as before.
The publishable key is a public client key and is safe to embed. **Never** put the secret key or service-role key in this repo or any client file — those bypass Row Level Security and belong server-side only. No key of any kind is committed in this branch: `supabase-config.js` holds only the project URL and the placeholder.

## Important limitations
Credential records are user-entered and are not verified by NBCRNA, AANA, or any state board, even when synced to Supabase — sync moves records between the device and the account; it does not verify them. When Supabase is not configured (or the user is signed out), records are saved to this browser's localStorage and are not synced across devices. Back up regularly. There is no live AI model connection. There is no OCR for scanned/image-only PDFs or Excel uploads, no automatic driving detection, no geocoding, no alarm scheduling, no push notifications, and no QuickBooks/TurboTax direct integration. CSV exports can be used for manual workflows. Do not store passwords or patient information. Facility codes/notes on a shared device should be treated as sensitive because localStorage is not encrypted. Mileage tax treatment depends on facts; regular commuting is generally nondeductible. The mileage draft generator uses user-entered distances, not GPS.

## Existing starter data
Reads and migrates records from `crna-hub-starter-v1` without deleting the original. Restore from JSON if moving devices. Browser private mode, site data deletion, or browser changes can erase local records.


## Contract pictures (OCR)
Pictures of contracts (.png, .jpg, .jpeg, .webp; .heic only where the browser can decode it) are read entirely on the device with Tesseract.js, loaded from a CDN only when a picture is chosen — no picture is sent to a server for OCR, and no AI model reads it. OCR text goes through the same deterministic parser and the same preview/approval flow as text contracts, with every row flagged "from photo — check carefully" because OCR can misread digits and dates. Approved pictures are stored in IndexedDB on that device (not localStorage) and viewable from the Saved contracts list; cloud document storage is not enabled yet, so pictures do not sync to Supabase in this release.
