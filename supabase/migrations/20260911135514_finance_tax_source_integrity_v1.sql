-- Bind tax classifications to a server-read source version. Historical profile
-- revisions remain immutable; legacy classifications require explicit re-review.
create function private.finance_tax_source_snapshot_v1(kind text, source jsonb, line_id text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare rows jsonb:='[]'; candidate jsonb; line jsonb; k text; matches integer:=0; idx bigint;
begin
 if source is null or coalesce(source->>'voided_at','')<>'' then return null;end if;
 if kind='invoice' then
  if line_id is not null then return null;end if;
  return jsonb_build_object('sourceType',kind,'sourceId',source->>'id','entityId',source->>'entity_id',
   'revision',coalesce((source->>'row_version')::numeric,0),'number',coalesce(source->>'no',''),
   'date',coalesce(source->>'invoice_date',''),'netAmount',source->'amount','taxAmount',source->'tax','grossAmount',source->'total',
   'description',coalesce(source->>'description',''),'buyerTaxId',coalesce(source->>'tax_id',''));
 elsif kind<>'expense_request' or line_id is null then return null;end if;
 foreach k in array array['lazyRows','detailRows','purchaseRows','refundRows','hrRows'] loop
  candidate:=source#>array['form_payload',k];
  if jsonb_typeof(candidate)='array' and jsonb_array_length(candidate)>0 then rows:=candidate;exit;end if;
 end loop;
 if jsonb_array_length(rows)=0 then rows:='[{}]'::jsonb;end if;
 for candidate,idx in select value,ordinality-1 from jsonb_array_elements(rows) with ordinality loop
  if coalesce(nullif(candidate->>'id',''),idx::text)=line_id then line:=candidate;matches:=matches+1;end if;
 end loop;
 if matches<>1 then return null;end if;
 return jsonb_build_object('sourceType',kind,'sourceId',source->>'id','sourceLineId',line_id,'entityId',source->>'entity_id',
  'revision',coalesce((source->>'ver')::numeric,1),'amount',source->'amount','description',coalesce(source->>'description',''),'line',line);
end $$;

create function private.finance_tax_source_read_v1(t uuid,e text,env text,kind text,id text,line_id text,lock_source boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source jsonb; snapshot jsonb; digest text; evidence jsonb;
begin
 if kind='invoice' then
  if lock_source then select to_jsonb(i) into source from public.invoices i where i.tenant_id=t and i.entity_id=e and coalesce(i.data_environment,'production')=env and i.id=finance_tax_source_read_v1.id and public.can_read_invoice(i) is true for update;
  else select to_jsonb(i) into source from public.invoices i where i.tenant_id=t and i.entity_id=e and coalesce(i.data_environment,'production')=env and i.id=finance_tax_source_read_v1.id and public.can_read_invoice(i) is true;end if;
 elsif kind='expense_request' then
  if lock_source then select to_jsonb(r) into source from public.expense_requests r where r.tenant_id=t and r.entity_id=e and coalesce(r.data_environment,'production')=env and r.id=finance_tax_source_read_v1.id and public.can_read_expense_request(r) is true for update;
  else select to_jsonb(r) into source from public.expense_requests r where r.tenant_id=t and r.entity_id=e and coalesce(r.data_environment,'production')=env and r.id=finance_tax_source_read_v1.id and public.can_read_expense_request(r) is true;end if;
 else raise exception using errcode='22023',message='Unsupported tax source type';end if;
 if source is not null and private.finance_expense_optional_permission_allows(t,public.current_finance_user_id(),'finance.request.view.all',jsonb_build_object('entity_id',e,'entityId',e,'legal_entity_code',e,'department_code',source->>'department_code','departmentCode',source->>'department_code','data_environment',env)) is distinct from true then source:=null;end if;
 snapshot:=private.finance_tax_source_snapshot_v1(kind,source,line_id);
 if snapshot is null then return jsonb_build_object('available',false);end if;
 -- Full evidence is fingerprinted only; raw attachments/banking payload are not
 -- returned by this API. Identity/environment are part of the digest.
 evidence:=jsonb_build_object('tenant',t,'entity',e,'environment',env,'snapshot',snapshot,
  'payload',source->'form_payload','files',source->'files','actualFiles',source->'actual_files','receiptFiles',source->'receipt_files');
 digest:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
 return jsonb_build_object('available',true,'snapshot',snapshot,'binding',jsonb_build_object('version',1,'fingerprint',digest));
end $$;

create function public.finance_reporting_tax_sources_v1(p_entity_id text,p_documents jsonb,p_data_environment text default 'production')
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment); d jsonb; result jsonb:='{}'; k text; expected text;
begin
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>100 then raise exception using errcode='22023',message='At most 100 exact tax source selectors are required';end if;
 for d in select value from jsonb_array_elements(p_documents) loop
  perform private.finance_reporting_shape_v1(d,'{"key":"text","sourceType":"invoice|expense_request","sourceId":"text","sourceLineId":"text"}',array['key','sourceType','sourceId']);
  k:=d->>'key';expected:=(d->>'sourceType')||':'||(d->>'sourceId')||case when d->>'sourceType'='expense_request' then ':'||coalesce(d->>'sourceLineId','') else '' end;
  if k<>expected or result ? k or (d->>'sourceType'='invoice' and d->>'sourceLineId' is not null) then raise exception using errcode='22023',message='Tax source key is invalid or duplicated';end if;
  result:=result||jsonb_build_object(k,private.finance_tax_source_read_v1((a->>'tenantId')::uuid,p_entity_id,p_data_environment,d->>'sourceType',d->>'sourceId',d->>'sourceLineId',false));
 end loop;
 return jsonb_build_object('ok',true,'entityId',p_entity_id,'dataEnvironment',p_data_environment,'sources',result);
end $$;

create function private.finance_tax_source_bind_documents_v1(t uuid,e text,env text,p jsonb,old jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare kv record; d jsonb; current_source jsonb; expected text;
begin
 -- The existing save RPC holds the profile advisory/row lock. Lock changed
 -- sources in deterministic order until profile+immutable revision commit.
 for kv in select key,value from jsonb_each(p->'documents') order by value->>'sourceType',value->>'sourceId',key loop
  d:=kv.value;
  if d is not distinct from old->'documents'->kv.key then continue;end if;
  expected:=(d->>'sourceType')||':'||(d->>'sourceId')||case when d->>'sourceType'='expense_request' then ':'||coalesce(d->>'sourceLineId','') else '' end;
  if kv.key<>expected then raise exception using errcode='22023',message='Changed classification requires the exact source key';end if;
  perform private.finance_reporting_shape_v1(d->'sourceBinding','{"version":"amount","fingerprint":"text"}',array['version','fingerprint']);
  current_source:=private.finance_tax_source_read_v1(t,e,env,d->>'sourceType',d->>'sourceId',d->>'sourceLineId',true);
  if current_source->>'available' is distinct from 'true' or d->'sourceBinding' is distinct from current_source->'binding' then
   raise exception using errcode='40001',message='Tax source changed or has not been verified; reload and review the original certificate';
  end if;
 end loop;
 return p;
end $$;

-- Preserve the complete existing company/path/CAS/audit authority contract.
do $install_tax_binding$
declare definition text; needle text:='"classificationReason":"text"'; endpoint text:=' return output;';
begin
 select pg_get_functiondef('private.finance_reporting_validate_v1(uuid,text,text,jsonb,jsonb,text,bigint)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,needle,''))<>length(needle) or length(definition)-length(replace(definition,endpoint,''))<>length(endpoint) then raise exception 'Tax classification validator baseline differs';end if;
 definition:=replace(definition,needle,'"classificationReason":"text","sourceBinding":"object"');
 definition:=replace(definition,endpoint,' return private.finance_tax_source_bind_documents_v1(t,e,env,output,old);');
 execute definition;
end;
$install_tax_binding$;
alter function private.finance_tax_source_snapshot_v1(text,jsonb,text) owner to postgres;
alter function private.finance_tax_source_read_v1(uuid,text,text,text,text,text,boolean) owner to postgres;
alter function private.finance_tax_source_bind_documents_v1(uuid,text,text,jsonb,jsonb) owner to postgres;
alter function public.finance_reporting_tax_sources_v1(text,jsonb,text) owner to postgres;
revoke all on function private.finance_tax_source_snapshot_v1(text,jsonb,text),private.finance_tax_source_read_v1(uuid,text,text,text,text,text,boolean),private.finance_tax_source_bind_documents_v1(uuid,text,text,jsonb,jsonb),public.finance_reporting_tax_sources_v1(text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_reporting_tax_sources_v1(text,jsonb,text) to authenticated;
