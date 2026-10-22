-- Successful dual-reviewed correction receipts freeze only their linked ledger evidence.
-- Further corrections must append new vouchers/receipts; no historical rewrite.
-- VOLATILE deliberately takes a fresh command snapshot after the advisory lock wait.
create function finance_apm_private.receipt_evidence_locked(voucher_id text)returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from finance_apm_private.correction_receipts r where r.receipt->>'originalVoucherId'=voucher_id or r.receipt->>'reversalVoucherId'=voucher_id)
$$;
create function finance_apm_private.guard_receipt_voucher()returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('apm-voucher:'||old.id,847));
 if finance_apm_private.receipt_evidence_locked(old.id)then raise exception 'FINANCE_APM_RECEIPT_EVIDENCE_IMMUTABLE'using errcode='55000';end if;
 if tg_op='DELETE'then return old;end if;return new;end $$;
create function finance_apm_private.guard_receipt_ledger()returns trigger language plpgsql security definer set search_path='' as $$declare v record;begin
 for v in select x.id from public.vouchers x where(tg_op<>'INSERT'and x.tenant_id=old.tenant_id and x.entity_id=old.entity_id and x.data_environment=old.data_environment and x.no=old.voucher_no)or(tg_op<>'DELETE'and x.tenant_id=new.tenant_id and x.entity_id=new.entity_id and x.data_environment=new.data_environment and x.no=new.voucher_no)order by x.id loop
  perform pg_advisory_xact_lock(hashtextextended('apm-voucher:'||v.id,847));
  if finance_apm_private.receipt_evidence_locked(v.id)then raise exception 'FINANCE_APM_RECEIPT_EVIDENCE_IMMUTABLE'using errcode='55000';end if;
 end loop;if tg_op='DELETE'then return old;end if;return new;end $$;
create trigger apm_receipt_voucher_guard before update or delete on public.vouchers for each row execute function finance_apm_private.guard_receipt_voucher();
create trigger apm_receipt_ledger_guard before insert or update or delete on public.ledger_entries for each row execute function finance_apm_private.guard_receipt_ledger();
alter function finance_apm_private.correction_evidence(finance_hr_private.finance_hr_obligations,text)rename to correction_evidence_before_lock;
create function finance_apm_private.correction_evidence(o finance_hr_private.finance_hr_obligations,reversal_id text)returns jsonb language plpgsql security invoker set search_path='' as $$declare id text;begin
 for id in select v.id from public.vouchers v where v.id=reversal_id or exists(select 1 from finance_hr_private.finance_hr_voucher_claims c where c.obligation_id=o.obligation_id and c.voucher_id=v.id)order by v.id loop
  perform pg_advisory_xact_lock(hashtextextended('apm-voucher:'||id,847));
 end loop;return finance_apm_private.correction_evidence_before_lock(o,reversal_id);end $$;
revoke all on function finance_apm_private.receipt_evidence_locked(text),finance_apm_private.guard_receipt_voucher(),finance_apm_private.guard_receipt_ledger(),finance_apm_private.correction_evidence(finance_hr_private.finance_hr_obligations,text),finance_apm_private.correction_evidence_before_lock(finance_hr_private.finance_hr_obligations,text)from public,anon,authenticated,service_role;
