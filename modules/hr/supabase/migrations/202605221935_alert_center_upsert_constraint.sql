-- Give PostgREST upsert a concrete unique constraint for alert source records.

alter table public.alert_center_items
  alter column source_table set not null,
  alter column source_id set not null;

drop index if exists public.idx_alert_center_items_source;

alter table public.alert_center_items
  drop constraint if exists alert_center_items_source_unique;

alter table public.alert_center_items
  add constraint alert_center_items_source_unique
  unique (company_id, source_type, source_table, source_id);
