begin;

drop policy if exists "active leave rules are readable for app clients" on public.system_settings;

create policy "active leave rules are readable for app clients"
on public.system_settings
for select
to anon, authenticated
using (
  setting_key = 'leave_type_rules'
  and category = 'leave_rules'
  and status = 'active'
  and deleted_at is null
);

commit;
