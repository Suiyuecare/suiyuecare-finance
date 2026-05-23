alter table public.announcement_reads
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledgement_text text,
  add column if not exists acknowledgement_snapshot jsonb not null default '{}'::jsonb;

create index if not exists idx_announcement_reads_acknowledged
on public.announcement_reads(announcement_id, acknowledged_at)
where deleted_at is null;
