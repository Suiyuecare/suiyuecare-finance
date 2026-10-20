-- Evidence-only correction receipts. Does not mutate vouchers or make payments.
set local lock_timeout='5s';
set local statement_timeout='120s';
create table finance_apm_private.correction_proposals (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,obligation_id uuid not null references finance_hr_private.finance_hr_obligations(obligation_id),
 correction_batch_id uuid not null,correction_source_hash text not null check(correction_source_hash~'^[0-9a-f]{64}$'),original_batch_id uuid not null,
 reversal_voucher_id text not null references public.vouchers(id),refund jsonb not null,proposed_by text not null,reference text not null,
 source_evidence jsonb not null,evidence_hash text not null,created_at timestamptz not null default clock_timestamp(),unique(correction_batch_id)
);
create table finance_apm_private.correction_receipts (
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null unique references finance_apm_private.correction_proposals(id),
 receipt jsonb not null,verified_by text not null,verified_at timestamptz not null default clock_timestamp()
);
create unique index apm_reversal_voucher_once on finance_apm_private.correction_proposals(reversal_voucher_id);
create index apm_correction_obligation on finance_apm_private.correction_proposals(obligation_id);
create index apm_correction_tenant on finance_apm_private.correction_proposals(tenant_id,created_at desc);
do $$declare t text;begin foreach t in array array['correction_proposals','correction_receipts'] loop
 execute format('alter table finance_apm_private.%I enable row level security',t);
 execute format('alter table finance_apm_private.%I force row level security',t);
 execute format('revoke all on finance_apm_private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable before update or delete on finance_apm_private.%I for each row execute function finance_apm_private.immutable()',t);
end loop;end $$;
create function finance_apm_private.correction_evidence(o finance_hr_private.finance_hr_obligations,reversal_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.vouchers;reversal public.vouchers;before_rows jsonb;after_rows jsonb;ev jsonb;begin
 select v.* into original from finance_hr_private.finance_hr_voucher_claims c join public.vouchers v on v.id=c.voucher_id where c.obligation_id=o.obligation_id;
 select * into reversal from public.vouchers where id=reversal_id;
 if original.id is null or reversal.id is null or reversal.id=original.id or original.tenant_id<>o.tenant_id or reversal.tenant_id<>o.tenant_id
  or original.entity_id<>o.legal_entity_code or reversal.entity_id<>o.legal_entity_code or original.data_environment<>'production' or reversal.data_environment<>'production'
  or original.posted is distinct from true or reversal.posted is distinct from true or original.posted_at is null or reversal.posted_at is null
  or original.voided_at is not null or reversal.voided_at is not null or reversal.adjusts_voucher_no is distinct from original.no
  or original.total<>o.total_net_cents/100.0 or reversal.total<>original.total
  or not exists(select 1 from finance_hr_private.finance_hr_events where obligation_id=o.obligation_id and action='bank_disbursement' and actor_system='finance')
 then raise exception 'FINANCE_APM_REAL_SETTLEMENT_AND_REVERSAL_REQUIRED';end if;
 select jsonb_agg(to_jsonb(t) order by t.account_code,t.department_code) into before_rows from (
  select account_code,coalesce(department_code,'') department_code,sum(debit) debit,sum(credit) credit from public.ledger_entries
  where tenant_id=o.tenant_id and entity_id=o.legal_entity_code and data_environment='production' and voided_at is null and voucher_no=original.no
  group by account_code,coalesce(department_code,'')) t;
 select jsonb_agg(to_jsonb(t) order by t.account_code,t.department_code) into after_rows from (
  select account_code,coalesce(department_code,'') department_code,sum(credit) debit,sum(debit) credit from public.ledger_entries
  where tenant_id=o.tenant_id and entity_id=o.legal_entity_code and data_environment='production' and voided_at is null and voucher_no=reversal.no
  group by account_code,coalesce(department_code,'')) t;
 if before_rows is null or before_rows is distinct from after_rows then raise exception 'FINANCE_APM_REVERSAL_LEDGER_MISMATCH';end if;
 if (select sum((x->>'debit')::numeric) from jsonb_array_elements(before_rows) x)<>original.total
  or (select sum((x->>'credit')::numeric) from jsonb_array_elements(before_rows) x)<>original.total then raise exception 'FINANCE_APM_REVERSAL_LEDGER_MISMATCH';end if;
 ev:=jsonb_build_object('originalVoucherId',original.id,'reversalVoucherId',reversal.id,'originalVoucher',to_jsonb(original),'reversalVoucher',to_jsonb(reversal),'reversedLines',before_rows);
 return ev;end $$;
create function finance_apm_private.correction_command(cmd text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;proposal finance_apm_private.correction_proposals;
 old finance_apm_private.commands;req uuid;h text;ev jsonb;receipt jsonb;result jsonb;receipt_id uuid:=gen_random_uuid();begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>32768 or cmd<>all(array['propose','verify','list'])
  or exists(select 1 from jsonb_object_keys(p) k where k<>all(array['requestId','obligationId','correctionBatchId','correctionSourceHash','originalBatchId','reversalVoucherId','refund','reference','proposalId'])) then raise exception 'FINANCE_APM_CORRECTION_INPUT_INVALID';end if;
 if not public.finance_auth_session_active() then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 a:=public.current_finance_user();
 if auth.uid() is null or a.auth_user_id is distinct from auth.uid() or not a.active or a.role not in('accountant','ceo') then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 if cmd='list' then
  return jsonb_build_object('proposals',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('receipt',(select receipt from finance_apm_private.correction_receipts where proposal_id=c.id)) order by c.created_at desc)
   from finance_apm_private.correction_proposals c join finance_hr_private.finance_hr_obligations x on x.obligation_id=c.obligation_id
   where c.tenant_id=a.tenant_id and finance_hr_private.finance_hr_reader(x.tenant_id,x.source_employer_id,a.id)),'[]'));
 end if;
 if cmd='verify' then select * into proposal from finance_apm_private.correction_proposals where id=(p->>'proposalId')::uuid and tenant_id=a.tenant_id;
  select * into o from finance_hr_private.finance_hr_obligations where obligation_id=proposal.obligation_id;
 else select * into o from finance_hr_private.finance_hr_obligations where obligation_id=(p->>'obligationId')::uuid;end if;
 if o.obligation_id is null or o.tenant_id<>a.tenant_id or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id) then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 req:=(p->>'requestId')::uuid;
 if req is null or length(btrim(coalesce(p->>'reference',''))) not between 10 and 1000 then raise exception 'FINANCE_APM_CORRECTION_REFERENCE_REQUIRED';end if;
 h:=finance_apm_private.hash(jsonb_build_object('correctionCommand',cmd,'payload',p));
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||a.id||req::text,831));
 perform pg_advisory_xact_lock(hashtextextended(o.obligation_id::text,617));
 select * into old from finance_apm_private.commands where tenant_id=a.tenant_id and actor_id=a.id and request_id=req;
 if found then if old.payload_hash<>h then raise exception 'FINANCE_APM_REPLAY_CONFLICT';end if;return old.result;end if;
 if cmd='propose' then
  if (p->>'correctionBatchId')::uuid is null or (p->>'originalBatchId')::uuid is null or p->>'correctionBatchId'=p->>'originalBatchId'
   or coalesce(p->>'correctionSourceHash','')!~'^[0-9a-f]{64}$' or jsonb_typeof(p->'refund') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p->'refund'))<>4 or exists(select 1 from jsonb_object_keys(p->'refund') k where k<>all(array['status','amountCents','reference','sha256']))
   or p->'refund'->>'status' is distinct from 'settled' or p->'refund'->>'amountCents' is distinct from o.total_net_cents::text
   or length(btrim(coalesce(p->'refund'->>'reference',''))) not between 10 and 500 or coalesce(p->'refund'->>'sha256','')!~'^[0-9a-f]{64}$'
  then raise exception 'FINANCE_APM_REFUND_EVIDENCE_REQUIRED';end if;
  ev:=finance_apm_private.correction_evidence(o,p->>'reversalVoucherId');
  insert into finance_apm_private.correction_proposals(tenant_id,obligation_id,correction_batch_id,correction_source_hash,original_batch_id,reversal_voucher_id,refund,proposed_by,reference,source_evidence,evidence_hash)
   values(a.tenant_id,o.obligation_id,(p->>'correctionBatchId')::uuid,p->>'correctionSourceHash',(p->>'originalBatchId')::uuid,p->>'reversalVoucherId',p->'refund',a.id,btrim(p->>'reference'),ev,finance_apm_private.hash(ev)) returning * into proposal;
  result:=jsonb_build_object('proposalId',proposal.id,'status','pending_independent_verification');
 else
  if proposal.proposed_by=a.id then raise exception 'FINANCE_APM_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
  ev:=finance_apm_private.correction_evidence(o,proposal.reversal_voucher_id);
  if finance_apm_private.hash(ev)<>proposal.evidence_hash then raise exception 'FINANCE_APM_SOURCE_CHANGED' using errcode='40001';end if;
  receipt:=jsonb_build_object('schemaVersion',1,'kind','finance_bonus_reversal','receiptId',receipt_id,'correctionBatchId',proposal.correction_batch_id,
   'correctionSourceHash',proposal.correction_source_hash,'originalBatchId',proposal.original_batch_id,'obligationId',o.obligation_id,'flowId',o.flow_id,'sourceEmployerId',o.source_employer_id,
   'originalSettlementHash',o.source_hash,'originalVoucherId',ev->'originalVoucherId','reversalVoucherId',proposal.reversal_voucher_id,'originalNetCents',o.total_net_cents,
   'ledgerHash',proposal.evidence_hash,'refund',proposal.refund,'proposedBy',proposal.proposed_by,'verifiedBy',a.id,'verifiedAt',clock_timestamp());
  receipt:=receipt||jsonb_build_object('receiptHash',finance_apm_private.hash(receipt));
  insert into finance_apm_private.correction_receipts(id,proposal_id,receipt,verified_by) values(receipt_id,proposal.id,receipt,a.id);
  result:=jsonb_build_object('status','verified','receipt',receipt);
 end if;
 insert into finance_apm_private.commands values(a.tenant_id,a.id,req,h,result,clock_timestamp());return result;end $$;
create function finance_apm_private.correction_export(receipt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_apm_private.correction_receipts;p finance_apm_private.correction_proposals;o finance_hr_private.finance_hr_obligations;begin
 select * into r from finance_apm_private.correction_receipts where id=receipt_id;
 select * into p from finance_apm_private.correction_proposals where id=r.proposal_id;
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p.obligation_id;
 if r.id is null or finance_apm_private.hash(finance_apm_private.correction_evidence(o,p.reversal_voucher_id))<>p.evidence_hash then raise exception 'FINANCE_APM_RECEIPT_UNAVAILABLE';end if;
 return r.receipt;end $$;
create function public.finance_apm_correction_command(command text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_apm_private.correction_command(command,payload)$$;
create function public.finance_apm_correction_export(receipt_id uuid) returns jsonb language sql security invoker set search_path='' as $$select finance_apm_private.correction_export(receipt_id)$$;
revoke all on function finance_apm_private.correction_evidence(finance_hr_private.finance_hr_obligations,text),finance_apm_private.correction_command(text,jsonb),finance_apm_private.correction_export(uuid),public.finance_apm_correction_command(text,jsonb),public.finance_apm_correction_export(uuid) from public,anon,authenticated,service_role;
grant execute on function finance_apm_private.correction_command(text,jsonb),public.finance_apm_correction_command(text,jsonb) to authenticated;
grant execute on function finance_apm_private.correction_export(uuid),public.finance_apm_correction_export(uuid) to service_role;
