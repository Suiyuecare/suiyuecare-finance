-- A stale personnel/Google binding revision is a business conflict, not a
-- PostgreSQL serialization failure. PostgREST retries SQLSTATE 40001, so an
-- explicit stale revision can otherwise keep one RPC backend busy indefinitely.
-- Keep all five messages, authorization checks, writes, and function grants
-- unchanged; real PostgreSQL serialization failures remain SQLSTATE 40001.
do $personnel_conflict_nonretry$
declare
  target record;
  function_oid oid;
  current_definition text;
  expected_definition text;
  source_conflicts integer;
begin
  for target in
    select * from (values
      (
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)',
        '72c2c2f437b26e8209603a371fff755ddfdd1b4d5db5a7fca29f2296b982bf6d',
        3
      ),
      (
        'public.finance_admin_save_user_google_login_v2(text,text,bigint)',
        '9898abc1966d39560c53f16fee8ccd92c4a04ed1b1f9a2aa6cda65c6b421cc2d',
        2
      )
    ) as expected(signature, source_sha256, conflict_count)
  loop
    function_oid := to_regprocedure(target.signature);
    if function_oid is null then
      raise exception 'Personnel conflict migration prerequisite is missing: %', target.signature;
    end if;

    current_definition := pg_get_functiondef(function_oid);
    if encode(extensions.digest(current_definition, 'sha256'), 'hex') <> target.source_sha256 then
      raise exception 'Personnel conflict migration source changed: %', target.signature;
    end if;

    source_conflicts := (
      length(current_definition)
      - length(replace(current_definition, 'using errcode = ''40001'';', ''))
    ) / length('using errcode = ''40001'';');
    if source_conflicts <> target.conflict_count then
      raise exception 'Personnel conflict migration count changed: %', target.signature;
    end if;

    expected_definition := replace(
      current_definition,
      'using errcode = ''40001'';',
      'using errcode = ''PT409'';'
    );
    execute expected_definition;

    if pg_get_functiondef(function_oid) is distinct from expected_definition then
      raise exception 'Personnel conflict migration verification failed: %', target.signature;
    end if;
  end loop;
end;
$personnel_conflict_nonretry$;
