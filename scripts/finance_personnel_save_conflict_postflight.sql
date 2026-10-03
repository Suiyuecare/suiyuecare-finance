\set ON_ERROR_STOP on

-- Read only: the updated definitions must reproduce the reviewed production
-- originals byte for byte when the five PT409 SQLSTATEs are reversed.
begin read only;
do $personnel_conflict_postflight$
declare
  target record;
  function_oid oid;
  function_definition text;
  current_conflicts integer;
  function_metadata record;
begin
  for target in
    select * from (values
      (
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)',
        '72c2c2f437b26e8209603a371fff755ddfdd1b4d5db5a7fca29f2296b982bf6d',
        3,
        '{postgres=X/postgres}'
      ),
      (
        'public.finance_admin_save_user_google_login_v2(text,text,bigint)',
        '9898abc1966d39560c53f16fee8ccd92c4a04ed1b1f9a2aa6cda65c6b421cc2d',
        2,
        '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      )
    ) as expected(signature, original_sha256, conflict_count, function_acl)
  loop
    function_oid := to_regprocedure(target.signature);
    if function_oid is null then
      raise exception 'Personnel conflict postflight function missing: %', target.signature;
    end if;

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
    into function_metadata
    from pg_proc p
    where p.oid = function_oid;
    if pg_get_userbyid(function_metadata.proowner) <> 'postgres'
       or function_metadata.prosecdef is not true
       or function_metadata.proconfig is distinct from array['search_path=""']::text[]
       or function_metadata.acl is distinct from target.function_acl then
      raise exception 'Personnel conflict postflight owner, definer, search_path or ACL drifted: %', target.signature;
    end if;

    function_definition := pg_get_functiondef(function_oid);
    current_conflicts := (
      length(function_definition)
      - length(replace(function_definition, 'using errcode = ''PT409'';', ''))
    ) / length('using errcode = ''PT409'';');
    if current_conflicts <> target.conflict_count
       or position('using errcode = ''40001'';' in function_definition) > 0
       or encode(extensions.digest(
         replace(function_definition, 'using errcode = ''PT409'';', 'using errcode = ''40001'';'),
         'sha256'
       ), 'hex') <> target.original_sha256 then
      raise exception 'Personnel conflict postflight definition drifted: %', target.signature;
    end if;
  end loop;
end;
$personnel_conflict_postflight$;
select 'FINANCE_PERSONNEL_SAVE_CONFLICT_POSTFLIGHT_OK' as marker;
rollback;
