create table if not exists public.report_export_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  requested_by uuid references public.users(id),
  report_name text not null,
  report_category text,
  filter_params jsonb not null default '{}'::jsonb,
  row_count integer not null default 0,
  export_format text not null default 'csv',
  status text not null default 'completed',
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.report_export_batches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='report_export_batches' and policyname='hr manage report exports') then
    create policy "hr manage report exports" on public.report_export_batches
      for all to authenticated
      using (private.is_hr_admin())
      with check (private.is_hr_admin());
  end if;
end $$;
