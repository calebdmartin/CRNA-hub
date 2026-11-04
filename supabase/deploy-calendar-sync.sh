#!/bin/sh
# CRNA Hub — deploy the calendar-sync Edge Functions.
# Takes NO secrets as arguments. Set secrets separately with
# `supabase secrets set ...` (see supabase/functions/README.md).
# Run from the repository root. Requires the Supabase CLI and a linked
# project (supabase link --project-ref xgoghgihfhtnyevgapyp).
set -eu
cd "$(dirname "$0")/.."
supabase functions deploy google-auth outlook-auth sync-calendar
echo "Deployed. Next: set function secrets (APP_URL, CALENDAR_ENCRYPTION_KEY,"
echo "GOOGLE_CLIENT_ID/SECRET, OUTLOOK_CLIENT_ID/SECRET) and run"
echo "supabase-schema-003.sql in the Supabase SQL Editor."
