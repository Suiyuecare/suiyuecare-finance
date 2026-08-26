-- Forward-only runtime hotfix for Finance -> eDoc sync v1.
--
-- PostgreSQL COALESCE is syntax, not a pg_catalog function. The initial v1
-- migration qualified it as pg_catalog.coalesce inside six stored functions;
-- those functions installed successfully but failed only when executed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $hotfix$
declare
  v_function regprocedure;
  v_definition text;
  v_fixed_definition text;
  v_updated integer := 0;
begin
  foreach v_function in array array[
    'private.finance_edoc_enrich_person_projection_v1(uuid,jsonb)'::regprocedure,
    'public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint)'::regprocedure,
    'public.finance_edoc_sync_claim_v1(integer,text,integer)'::regprocedure,
    'public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text)'::regprocedure,
    'public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer)'::regprocedure,
    'private.finance_wake_edoc_sync_worker_v1()'::regprocedure
  ] loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    if position('pg_catalog.coalesce(' in v_definition) = 0 then
      raise exception 'Finance -> eDoc coalesce hotfix preflight failed for %', v_function;
    end if;

    v_fixed_definition := pg_catalog.replace(
      v_definition,
      'pg_catalog.coalesce(',
      'coalesce('
    );
    execute v_fixed_definition;
    v_updated := v_updated + 1;
  end loop;

  if v_updated <> 6 then
    raise exception 'Finance -> eDoc coalesce hotfix updated % functions, expected 6', v_updated;
  end if;

  foreach v_function in array array[
    'private.finance_edoc_enrich_person_projection_v1(uuid,jsonb)'::regprocedure,
    'public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint)'::regprocedure,
    'public.finance_edoc_sync_claim_v1(integer,text,integer)'::regprocedure,
    'public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text)'::regprocedure,
    'public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer)'::regprocedure,
    'private.finance_wake_edoc_sync_worker_v1()'::regprocedure
  ] loop
    if position(
      'pg_catalog.coalesce(' in pg_catalog.pg_get_functiondef(v_function)
    ) > 0 then
      raise exception 'Finance -> eDoc coalesce hotfix postflight failed for %', v_function;
    end if;
  end loop;
end;
$hotfix$;

notify pgrst, 'reload schema';

commit;
