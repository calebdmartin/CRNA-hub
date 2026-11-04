# CRNA Hub — functional local-first release

This is a static, mobile-friendly application. Deploy it on Vercel using **Framework Preset: Other**, **Root Directory: `./`**, and **Build Command: none**. Upload the *contents* of this folder to the repository root (not the ZIP itself). Vercel should redeploy when `main` is updated.

## Included
- Dashboard with interactive month-grid calendar and day selection
- Shift management, facility-specific default rates, monthly income totals, shift CSV export
- Hospital profiles with rates, one-way distance, and offline notes
- W-2 PTO hours ledger with balance and accrual rules (manual accrual posting)
- Credential/license expiration tracking
- NBCRNA certification, AANA membership, and state license tracking (separate sections, user-entered records only — no automatic verification, no API sync, no document uploads; document fields hold a filename or note only)
- Credential deadlines on the dashboard, with per-license reminder windows (default 90/60/30/7 days)
- Mileage log, export, and schedule-based trip **drafts** requiring verification
- CSV schedule import, JSON backup/restore
- Offline service worker for cached app shell (after initial online visit)

## Important limitations
This is **not** a Supabase-authenticated multi-user app. Credential records are user-entered and are not verified by NBCRNA, AANA, or any state board. The local data shape (nbcrna, aana, licenses, ce_records) is intended to map to future Supabase tables with a user_id, but no cloud sync exists yet. Records are saved to this browser's localStorage and are not synced across devices. Back up regularly. There is no OCR for screenshot/PDF/Excel uploads, no automatic driving detection, no geocoding, no alarm scheduling, no push notifications, and no QuickBooks/TurboTax direct integration. CSV exports can be used for manual workflows. Do not store passwords or patient information. Facility codes/notes on a shared device should be treated as sensitive because localStorage is not encrypted. Mileage tax treatment depends on facts; regular commuting is generally nondeductible. The mileage draft generator uses user-entered distances, not GPS.

## Existing starter data
Reads and migrates records from `crna-hub-starter-v1` without deleting the original. Restore from JSON if moving devices. Browser private mode, site data deletion, or browser changes can erase local records.
