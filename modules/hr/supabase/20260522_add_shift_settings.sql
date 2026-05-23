-- Add flexible shift settings for HRIS shift management.
-- Core scheduling fields stay in public.shifts; UI and rule extensions live here.

alter table public.shifts
  add column if not exists settings jsonb not null default '{}'::jsonb;
