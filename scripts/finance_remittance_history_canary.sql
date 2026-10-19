-- Catalog checks and anonymous rejection only. Never uses a staff identity.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $mega_existing_authority$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  perform pg_catalog.set_config('search_path','',true);
  for expected in select * from (values
    ('public.current_finance_user()','6be8d5dcd919aa90abb13e9be00cc4eb',true,'s'),
    ('public.can_read_expense_request(public.expense_requests)','246cf9196ea0b5298108e431f562286f',false,'s'),
    ('private.finance_income_active_step_index(jsonb)','ee9262d3895a46cd966900b255efde9b',false,'i'),
    ('private.finance_income_step_role(jsonb)','be6a8e74dc4d01edce92881af09a05e1',false,'i'),
    ('private.finance_income_step_user_id(jsonb)','def324bfc6b15ffdf4b335a0b3527e62',false,'i')
  ) x(signature,definition_md5,security_definer,volatility) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
       or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from expected.security_definer or proc.provolatile::text is distinct from expected.volatility
       or proc.proconfig is distinct from array['search_path=""']::text[] then
      raise exception 'Mega remittance existing authority drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
end;
$mega_existing_authority$;
do $mega_function_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  perform pg_catalog.set_config('search_path','',true);
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('private','public') and p.proname like 'finance_mega_%')<>12 then
    raise exception 'Mega remittance function catalog drift' using errcode='55000';
  end if;
  for expected in select * from (values
    ('private.finance_mega_bank_code_v1(text)','0b9c9531fa3ca5b7b3691c18af4a3e4d',false,'i',false),
    ('private.finance_mega_code_from_row_v1(jsonb)','f1d6a475dbdeac7bda82cd1a64f42990',false,'i',false),
    ('private.finance_mega_event_immutable_v1()','a25de54820a513699a2f3e080f3b3458',false,'v',false),
    ('private.finance_mega_expense_v1(text,text,boolean)','419ff8082b442fb6a35ec18908fe8a0e',true,'v',false),
    ('private.finance_mega_first_v1(jsonb,text[])','ed765df69e90dfbeba9f71f0505a18e7',false,'i',false),
    ('private.finance_mega_hash_v1(jsonb)','ca3460b76eb4914cfb290277cee04273',false,'i',false),
    ('private.finance_mega_remittance_snapshot_v1(text,text)','d8fbd7798718ba3425e4b9413a11991f',true,'v',true),
    ('private.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb)','6291a7c091c68e99ea36d326befb251f',true,'v',true),
    ('private.finance_mega_row_v1(public.expense_requests,text)','e03a82fa31bc37dac8be11e1b9b1eff5',false,'i',false),
    ('private.finance_mega_snapshot_v1(public.expense_requests)','7a6698c61785e7215d630cd556b8e10d',true,'v',false),
    ('public.finance_mega_remittance_snapshot_v1(text,text)','58332e61aec57e7a0ba3cc989720481a',false,'v',true),
    ('public.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb)','1807e06238e4a34ae76fc95c5c51aaa9',false,'v',true)
  ) x(signature,definition_md5,security_definer,volatility,client_execute) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
       or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from expected.security_definer or proc.provolatile::text is distinct from expected.volatility
       or proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE') is distinct from expected.client_execute
       or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a
         where a.privilege_type='EXECUTE' and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres')
           and (not expected.client_execute or a.grantee<>(select oid from pg_catalog.pg_roles where rolname='authenticated'))) then
      raise exception 'Mega remittance function authority/source drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
end;
$mega_function_guard$;
do $mega_private_table_guard$
declare expected record; relation pg_catalog.pg_class%rowtype; shape text; constraints text;
begin
  for expected in select * from (values
    ('private.finance_mega_recipient_events_v1','id:bigint:true:a,tenant_id:uuid:true:,data_environment:text:true:,request_id:text:true:,source_hash:text:true:,row_key:text:true:,previous_hash:text:false:,value_hash:text:true:,actor_id:text:true:,occurred_at:timestamp with time zone:true:','PRIMARY KEY (id)'),
    ('private.finance_mega_recipient_supplements_v1','tenant_id:uuid:true:,data_environment:text:true:,request_id:text:true:,source_hash:text:true:,row_key:text:true:,row_fingerprint:text:true:,payee_name:text:false:,bank_code:text:false:,actor_id:text:true:,updated_at:timestamp with time zone:true:','CHECK ((data_environment = ANY (ARRAY[''production''::text, ''test''::text])))
PRIMARY KEY (tenant_id, data_environment, request_id, source_hash, row_key)
CHECK ((row_key ~ ''^(hr|refund|payment):[1-9][0-9]{0,6}$''::text))
CHECK ((source_hash ~ ''^[0-9a-f]{64}$''::text))')
  ) x(relation_name,column_shape,constraint_shape) loop
    select * into relation from pg_catalog.pg_class where oid=pg_catalog.to_regclass(expected.relation_name);
    select pg_catalog.string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.attidentity::text,',' order by a.attnum)
      into shape from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped;
    select pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(co.oid),E'\n' order by co.conname)
      -- PG18 adds NOT NULL catalog constraints; PG17 stores the same rule only
      -- in pg_attribute.attnotnull, already checked by the exact column shape.
      into constraints from pg_catalog.pg_constraint co where co.conrelid=relation.oid and co.contype<>'n';
    if relation.oid is null or relation.relkind<>'r' or not relation.relrowsecurity or not relation.relforcerowsecurity
       or pg_catalog.pg_get_userbyid(relation.relowner) is distinct from 'postgres' or shape is distinct from expected.column_shape
       or constraints is distinct from expected.constraint_shape
       or exists(select 1 from pg_catalog.pg_policy po where po.polrelid=relation.oid)
       or exists(select 1 from pg_catalog.pg_attribute at,lateral pg_catalog.aclexplode(at.attacl) acl
           where at.attrelid=relation.oid and acl.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres'))
       or exists(select 1 from pg_catalog.aclexplode(coalesce(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) a
           where a.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres')) then
      raise exception 'Mega remittance private table authority/shape drift: %',expected.relation_name using errcode='55000';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=pg_catalog.to_regclass('private.finance_mega_recipient_events_v1')
      and t.tgname='mega_recipient_event_immutable' and t.tgenabled='O' and t.tgtype=27
      and t.tgfoid=pg_catalog.to_regprocedure('private.finance_mega_event_immutable_v1()') and not t.tgisinternal)
     or exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid in (
       pg_catalog.to_regclass('private.finance_mega_recipient_events_v1'),pg_catalog.to_regclass('private.finance_mega_recipient_supplements_v1'))
       and not t.tgisinternal and t.tgname<>'mega_recipient_event_immutable') then
    raise exception 'Mega remittance audit trigger drift' using errcode='55000';
  end if;
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace,
      lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('s',c.relowner))) a
      where n.nspname='private' and c.relkind='S' and c.relname like 'finance_mega_%'
        and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres')) then
    raise exception 'Mega remittance audit sequence privilege drift' using errcode='55000';
  end if;
end;
$mega_private_table_guard$;
do $mega_ledger_guard$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261018074245'
      and name='finance_mega_remittance_private_v1'
      and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='2e59fbe1f2ea9b93f908d8c0a5f083c4') then
    raise exception 'Mega remittance sealed ledger missing or differs' using errcode='55000';
  end if;
end;
$mega_ledger_guard$;

do $history_correction_prerequisite$
begin
 if (select pg_catalog.string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod),',' order by a.attname) from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('private.expense_accounting_corrections_v1') and a.attnum>0 and not a.attisdropped and a.attname in ('tenant_id','data_environment','request_id','status')) is distinct from 'data_environment:text,request_id:text,status:text,tenant_id:uuid' then
  raise exception 'Remittance history correction prerequisite drift' using errcode='55000';
 end if;
end $history_correction_prerequisite$;

do $history_function_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname like 'finance_remittance_export_%')<>9 then raise exception 'Remittance history function catalog drift' using errcode='55000';end if;
  for expected in select * from (values
    ('private.finance_remittance_export_principal_v1(public.expense_requests)','10320aa10dc664671984e2501a162231',false,'i',false),
    ('private.finance_remittance_export_row_v1(public.expense_requests,text)','e0fe135cef2ccec2181c179e542d2e77',false,'i',false),
    ('private.finance_remittance_export_scope_v1(text,text,boolean)','152eb4b6c614fba3aba2dd3272204e89',true,'v',false),
    ('private.finance_remittance_export_snapshot_for_row_v1(public.expense_requests)','25d9490a423da746b94426afe525f7d7',true,'v',false),
    ('private.finance_remittance_export_snapshot_v1(text,text)','24dd17b62a8b57be49c0c6b82d1070c6',true,'v',true),
    ('private.finance_remittance_export_state_v1(public.expense_requests)','8c5d3823b5ca645c3d123bc3cef4ad62',true,'v',false),
    ('private.finance_remittance_export_supplement_save_v1(text,text,text,jsonb)','0670ce9f40779acd74fafc2a95ad520d',true,'v',true),
    ('public.finance_remittance_export_snapshot_v1(text,text)','c29403a2d6ed7da04ae7536460f8fd36',false,'v',true),
    ('public.finance_remittance_export_supplement_save_v1(text,text,text,jsonb)','f387ad820b04cc0f33d1794c1629805c',false,'v',true)
  ) x(signature,definition_md5,security_definer,volatility,client_execute) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
      or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
      or proc.prosecdef is distinct from expected.security_definer or proc.provolatile::text is distinct from expected.volatility
      or proc.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE') is distinct from expected.client_execute
      or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a
        where a.privilege_type='EXECUTE' and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres')
          and (not expected.client_execute or a.grantee<>(select oid from pg_catalog.pg_roles where rolname='authenticated')))
    then raise exception 'Remittance history function authority/source drift: %',expected.signature using errcode='55000';end if;
  end loop;
end $history_function_guard$;
do $history_ledger_guard$
begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261019032213' and name='finance_remittance_export_history_v1' and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='c28eda2b0c84f8e45193027829c337ac') then raise exception 'Remittance history sealed ledger missing or differs' using errcode='55000';end if;
end $history_ledger_guard$;
do $mega_no_identity$
declare denied boolean;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  if auth.uid() is not null then raise exception 'Remittance history canary requires no staff identity';end if;
  denied:=false;
  begin
    perform public.finance_remittance_export_snapshot_v1('anonymous-mega-canary','test');
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Remittance history read accepted anonymous identity' using errcode='42501';end if;
  denied:=false;
  begin
    perform public.finance_remittance_export_supplement_save_v1('anonymous-mega-canary','test','anonymous-digest','[]'::jsonb);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Remittance history save accepted anonymous identity' using errcode='42501';end if;
  execute 'reset role';
end;
$mega_no_identity$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $mega_rollback$
begin
  if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Remittance history canary remains open';end if;
end;
$mega_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_REMITTANCE_HISTORY_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_remittance_history_v1','ok',true,'rolled_back',true,
 'staff_identity_used',false,'business_mutation_performed',false) as remittance_history_canary_result;
