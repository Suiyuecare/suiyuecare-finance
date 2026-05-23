-- Stable alert source key for company-scoped and global alerts.

alter table public.alert_center_items
  add column if not exists source_key text;

update public.alert_center_items
set source_key = concat_ws(':', coalesce(company_id::text, 'global'), source_type, source_table, source_id::text)
where source_key is null;

alter table public.alert_center_items
  alter column source_key set not null;

alter table public.alert_center_items
  drop constraint if exists alert_center_items_source_unique;

alter table public.alert_center_items
  add constraint alert_center_items_source_key_unique unique (source_key);
