-- Member and organization administration FK index hardening.
-- Safe to rerun: indexes use IF NOT EXISTS and the postflight is read-only.

begin;

create index if not exists finance_member_admin_events_v1_finance_user_id_idx
  on private.finance_member_admin_events_v1 (finance_user_id);

create index if not exists finance_membership_org_versions_v1_source_version_id_idx
  on private.finance_membership_org_versions_v1 (source_version_id)
  where source_version_id is not null;

do $postflight$
begin
  if to_regclass('private.finance_member_admin_events_v1_finance_user_id_idx') is null then
    raise exception 'Member administration event FK index was not installed';
  end if;

  if to_regclass('private.finance_membership_org_versions_v1_source_version_id_idx') is null then
    raise exception 'Organization source-version FK index was not installed';
  end if;
end;
$postflight$;

commit;
