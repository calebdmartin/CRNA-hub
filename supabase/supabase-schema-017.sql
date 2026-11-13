-- CRNA Hub — migration 017: expense tracking (v158, Nov 12, 2026).
--
-- Run this in the Supabase SQL Editor for project xgoghgihfhtnyevgapyp,
-- AFTER migration 016.
--
--   * expenses: one row per business expense the user logs (by hand
--     or from a receipt photo they approved). Follows the exact
--     pattern of migration 010's pay_stubs: typed columns are
--     populated best-effort (reporting, exports), and the `data`
--     jsonb column carries the COMPLETE client record and is
--     authoritative on the way down — the client record is
--     camelCase and stringly typed, with fields no typed column
--     has (receipt file name / storage path / source), and a
--     data-safety sync must round-trip a record exactly.
--   * expense-receipts storage bucket: private, one folder per
--     user (<user_id>/<expense-id>-<file>), mirroring the
--     certification-documents bucket (migration 002). Receipt
--     photos are the user's own tax records — never public.
--
-- RLS mirrors every earlier migration: each user sees only their
-- own rows/objects through the API; the client always sends the
-- user's own token, so RLS is the enforcement, not app code.
-- Until this migration runs, expense cloud sync fails into the
-- app's usual offline state and expenses stay on-device — nothing
-- is lost and nothing breaks.

create table if not exists public.expenses (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expense_date date,
  vendor text,
  category text,
  facility text,
  amount numeric,
  data jsonb,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.expenses enable row level security;
drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists expenses_user_idx on public.expenses (user_id);
create index if not exists expenses_user_date_idx on public.expenses (user_id, expense_date);

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

drop policy if exists "own expense receipts read" on storage.objects;
create policy "own expense receipts read" on storage.objects
  for select using (bucket_id = 'expense-receipts' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "own expense receipts write" on storage.objects;
create policy "own expense receipts write" on storage.objects
  for insert with check (bucket_id = 'expense-receipts' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "own expense receipts update" on storage.objects;
create policy "own expense receipts update" on storage.objects
  for update using (bucket_id = 'expense-receipts' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "own expense receipts delete" on storage.objects;
create policy "own expense receipts delete" on storage.objects
  for delete using (bucket_id = 'expense-receipts' and auth.uid()::text = (storage.foldername(name))[1]);
