\set ON_ERROR_STOP on

with schema_rows as (
  select
    'column'::text as kind,
    attrelid::regclass::text || '.' || attname as name,
    format_type(atttypid, atttypmod) || '|' || attnotnull || '|' || coalesce(pg_get_expr(adbin, adrelid), '') as definition
  from pg_attribute
  left join pg_attrdef
    on adrelid = attrelid
   and adnum = attnum
  where attrelid in ('public.notifications'::regclass, 'public.file_attachments'::regclass)
    and attnum > 0
    and not attisdropped

  union all

  select
    'constraint',
    conrelid::regclass::text || '.' || conname,
    pg_get_constraintdef(oid, true)
  from pg_constraint
  where conrelid in ('public.notifications'::regclass, 'public.finance_portal_roles'::regclass)

  union all

  select
    'index',
    schemaname || '.' || indexname,
    indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'notifications'

  union all

  select
    'policy',
    schemaname || '.' || tablename || '.' || policyname,
    concat_ws('|', permissive, roles::text, cmd, qual, with_check)
  from pg_policies
  where schemaname = 'public'
    and tablename = 'notifications'

  union all

  select
    'function',
    p.oid::regprocedure::text,
    concat_ws(
      '|',
      pg_get_userbyid(p.proowner),
      p.prosecdef::text,
      p.proconfig::text,
      p.proacl::text,
      md5(pg_get_functiondef(p.oid))
    )
  from pg_proc p
  where p.oid in (
    select to_regprocedure(signature)
    from unnest(array[
      'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)',
      'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)',
      'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)',
      'public.claim_approval_notification_delivery_events(integer,text,integer)',
      'private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)',
      'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)',
      'private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)',
      'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)',
      'private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text)',
      'private.finance_expense_idempotent_replay_result_v3(public.expense_requests)',
      'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)',
      'private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)',
      'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)',
      'public.finance_org_resolve_actor(text,text,text,text,text)',
      'private.finance_income_step_role(jsonb)',
      'public.finance_user_is_approval_identity_ready(uuid,text)'
    ]::text[]) as signatures(signature)
  )
),
notification_shape as (
  select
    count(*) filter (
      where attname in ('data_environment', 'tenant_id')
        and attnum > 0
        and not attisdropped
    ) = 2 as has_scope_columns
  from pg_attribute
  where attrelid = 'public.notifications'::regclass
),
parts as (
  select
    'schema'::text as k,
    coalesce(jsonb_agg(to_jsonb(x) order by x.kind, x.name)::text, '[]') as v
  from schema_rows x

  union all

  select
    'relations',
    coalesce(jsonb_agg(to_jsonb(x) order by x.oid)::text, '[]')
  from (
    select
      oid::regclass::text as oid,
      relrowsecurity,
      relforcerowsecurity,
      relacl
    from pg_class
    where oid in (
      'public.notifications'::regclass,
      'public.finance_portal_roles'::regclass,
      'public.file_attachments'::regclass,
      'private.approval_notification_assignment_state'::regclass
    )
  ) x

  union all

  select
    'notifications',
    (
      select md5(
        coalesce(
          string_agg(
            case
              when shape.has_scope_columns then concat_ws(
                '|',
                n.id::text,
                to_jsonb(n) ->> 'data_environment',
                to_jsonb(n) ->> 'tenant_id'
              )
              else n.id::text
            end,
            E'\n' order by n.id::text
          ),
          ''
        )
      )
      from public.notifications n
    )
  from notification_shape shape

  union all

  select
    'finance_portal_roles',
    md5(
      coalesce(
        (select string_agg(to_jsonb(r)::text, E'\n' order by r.id) from public.finance_portal_roles r),
        'null'
      )
    )

  union all

  select
    'employee',
    md5(
      coalesce(
        (
          select to_jsonb(e)::text
          from public.employees e
          where id = '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
        ),
        'null'
      )
    )

  union all

  select
    'ledger',
    md5(
      coalesce(
        (select string_agg(version, E'\n' order by version) from supabase_migrations.schema_migrations),
        ''
      )
    )
)
select md5(string_agg(k || '=' || v, E'\n' order by k)) as fingerprint
from parts;
