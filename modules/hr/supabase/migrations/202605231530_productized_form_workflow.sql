alter table public.hr_requests
  add column if not exists request_no text,
  add column if not exists form_id text,
  add column if not exists form_title text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists returned_at timestamptz,
  add column if not exists resubmitted_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists attachment_status text not null default 'not_required',
  add column if not exists integration_status text not null default 'pending',
  add column if not exists integration_summary jsonb not null default '{}'::jsonb,
  add column if not exists revision_no int not null default 1,
  add column if not exists last_action_at timestamptz not null default now();

do $$
declare
  files_type text;
begin
  select data_type
  into files_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'hr_requests'
    and column_name = 'files';

  if files_type = 'jsonb' then
    update public.hr_requests
    set
      request_no = coalesce(request_no, no, id),
      form_title = coalesce(form_title, request_type),
      submitted_at = case when status not in ('草稿', 'draft') then coalesce(submitted_at, started_at, created_at) else submitted_at end,
      approved_at = case when status in ('已核准', 'approved') then coalesce(approved_at, ended_at, updated_at) else approved_at end,
      rejected_at = case when status in ('已駁回', 'rejected') then coalesce(rejected_at, ended_at, updated_at) else rejected_at end,
      cancelled_at = case when status in ('已取消', 'cancelled') then coalesce(cancelled_at, ended_at, updated_at) else cancelled_at end,
      last_action_at = coalesce(submitted_at, approved_at, rejected_at, cancelled_at, started_at, ended_at, updated_at, created_at, now()),
      attachment_status = case
        when jsonb_typeof(files) = 'array' and jsonb_array_length(files) > 0 then 'uploaded'
        else attachment_status
      end,
      integration_status = case
        when status = '已核准' then 'synced'
        when status in ('已駁回', '已取消') then 'not_required'
        else integration_status
      end
    where request_no is null
       or form_title is null
       or last_action_at is null;
  else
    update public.hr_requests
    set
      request_no = coalesce(request_no, no, id),
      form_title = coalesce(form_title, request_type),
      submitted_at = case when status not in ('草稿', 'draft') then coalesce(submitted_at, started_at, created_at) else submitted_at end,
      approved_at = case when status in ('已核准', 'approved') then coalesce(approved_at, ended_at, updated_at) else approved_at end,
      rejected_at = case when status in ('已駁回', 'rejected') then coalesce(rejected_at, ended_at, updated_at) else rejected_at end,
      cancelled_at = case when status in ('已取消', 'cancelled') then coalesce(cancelled_at, ended_at, updated_at) else cancelled_at end,
      last_action_at = coalesce(submitted_at, approved_at, rejected_at, cancelled_at, started_at, ended_at, updated_at, created_at, now()),
      attachment_status = case
        when coalesce(array_length(files, 1), 0) > 0 then 'uploaded'
        else attachment_status
      end,
      integration_status = case
        when status = '已核准' then 'synced'
        when status in ('已駁回', '已取消') then 'not_required'
        else integration_status
      end
    where request_no is null
       or form_title is null
       or last_action_at is null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_requests_request_no_key'
  ) then
    alter table public.hr_requests add constraint hr_requests_request_no_key unique (request_no);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_requests_attachment_status_check'
  ) then
    alter table public.hr_requests
      add constraint hr_requests_attachment_status_check
      check (attachment_status in ('not_required','missing','uploaded','verified'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_requests_integration_status_check'
  ) then
    alter table public.hr_requests
      add constraint hr_requests_integration_status_check
      check (integration_status in ('pending','linked','synced','blocked','not_required'));
  end if;
end $$;

create table if not exists public.hr_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.hr_requests(id) on delete cascade,
  company_id uuid references public.companies(id),
  uploaded_by uuid references public.users(id),
  file_name text not null,
  storage_bucket text,
  storage_path text,
  mime_type text,
  file_size bigint,
  attachment_status text not null default 'uploaded'
    check (attachment_status in ('uploaded','verified','rejected','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.hr_request_revisions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.hr_requests(id) on delete cascade,
  revision_no int not null,
  actor_user_id uuid references public.users(id),
  action text not null,
  reason text,
  values_snapshot jsonb not null default '{}'::jsonb,
  attachment_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_requests_form_status
  on public.hr_requests(form_id, status)
  where deleted_at is null;

create index if not exists idx_hr_requests_owner_action
  on public.hr_requests(current_owner_role, last_action_at desc)
  where deleted_at is null;

create index if not exists idx_hr_request_attachments_request
  on public.hr_request_attachments(request_id)
  where deleted_at is null;

create unique index if not exists idx_hr_request_attachments_unique_active
  on public.hr_request_attachments(request_id, file_name)
  where deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_request_attachments_request_file_key'
  ) then
    alter table public.hr_request_attachments
      add constraint hr_request_attachments_request_file_key unique (request_id, file_name);
  end if;
end $$;

create index if not exists idx_hr_request_revisions_request
  on public.hr_request_revisions(request_id, revision_no desc);

alter table public.hr_request_attachments enable row level security;
alter table public.hr_request_revisions enable row level security;

drop policy if exists "hr_request_attachments_select" on public.hr_request_attachments;
create policy "hr_request_attachments_select"
on public.hr_request_attachments
for select
using (
  exists (
    select 1
    from public.hr_requests r
    where r.id = request_id
      and (
        r.applicant_id = auth.uid()
        or public.current_role_key() = any(array['hr','admin_director','ceo'])
        or public.current_role_key() = r.current_owner_role
      )
  )
);

drop policy if exists "hr_request_attachments_insert" on public.hr_request_attachments;
create policy "hr_request_attachments_insert"
on public.hr_request_attachments
for insert
with check (
  uploaded_by = auth.uid()
  or public.current_role_key() = any(array['hr','admin_director','ceo'])
);

drop policy if exists "hr_request_attachments_update" on public.hr_request_attachments;
create policy "hr_request_attachments_update"
on public.hr_request_attachments
for update
using (
  uploaded_by = auth.uid()
  or public.current_role_key() = any(array['hr','admin_director','ceo'])
)
with check (
  uploaded_by = auth.uid()
  or public.current_role_key() = any(array['hr','admin_director','ceo'])
);

drop policy if exists "hr_request_revisions_select" on public.hr_request_revisions;
create policy "hr_request_revisions_select"
on public.hr_request_revisions
for select
using (
  exists (
    select 1
    from public.hr_requests r
    where r.id = request_id
      and (
        r.applicant_id = auth.uid()
        or public.current_role_key() = any(array['hr','admin_director','ceo'])
        or public.current_role_key() = r.current_owner_role
      )
  )
);

drop policy if exists "hr_request_revisions_insert" on public.hr_request_revisions;
create policy "hr_request_revisions_insert"
on public.hr_request_revisions
for insert
with check (
  actor_user_id = auth.uid()
  or public.current_role_key() = any(array['hr','admin_director','ceo'])
);
