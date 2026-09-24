\set ON_ERROR_STOP on
-- Exact repaired sources only; no customer identities or document contents are emitted.
do $revenue_repair_postflight$
declare
  t constant uuid := '00000000-0000-0000-0000-000000000001';
  r public.revenue_recognition_rules%rowtype;
  expected record;
  i public.invoices%rowtype;
begin
  select * into strict r from public.revenue_recognition_rules
  where tenant_id=t and code='home_care_e8_g1101';
  if r.data_environment is distinct from 'production' or r.active is distinct from true
    or r.entity_id is distinct from 'E8' or r.department_code is distinct from 'G1101'
    or r.department_code_pattern is distinct from '^G1101$'
    or r.invoice_item_type is distinct from 'home_care'
    or r.revenue_account_code is distinct from '4101'
    or r.recognition_basis is distinct from 'invoice_issued'
    or r.priority is distinct from 100 or r.effective_from is distinct from date '2026-08-01'
    or r.effective_to is not null or r.payer_type is not null or r.funding_source is not null
    or r.invoice_identifier_type is not null or r.tax_rate is not null then
    raise exception 'Revenue repair rule scope differs from reviewed configuration';
  end if;
  if not exists(select 1 from public.revenue_recognition_rules
    where tenant_id=t and code='home_care_b1101' and active and entity_id is null
      and department_code is null and department_code_pattern='^B1101$'
      and invoice_item_type='home_care' and revenue_account_code='4101'
      and recognition_basis='invoice_issued' and data_environment='production') then
    raise exception 'Original Taipei home-care rule differs';
  end if;
  for expected in select * from (values
    ('inv_202608_00000000_000272','INV-202608-00000000-000272',58365::numeric,
      '4da7b508-890a-4ff2-b379-11c7fa32bbde'::uuid,'4606249d-d060-4eea-9ed5-8a093a3b59c6'::uuid),
    ('inv_202608_00000000_000273','INV-202608-00000000-000273',988147::numeric,
      'ae3b994f-62f5-4a90-b5d7-75eb8fcd7300'::uuid,'04996722-ef85-4d80-8e20-a3387d514ebb'::uuid)
  ) x(id,no,total,bank_id,receipt_ar_id) loop
    select * into strict i from public.invoices where id=expected.id;
    if i.tenant_id is distinct from t or i.data_environment is distinct from 'production'
      or i.no is distinct from expected.no or i.entity_id is distinct from 'E8'
      or i.department_code is distinct from 'G1101'
      or i.invoice_date is distinct from date '2026-08-01'
      or i.invoice_item_type is distinct from 'home_care'
      or i.amount is distinct from expected.total or i.total is distinct from expected.total
      or i.tax is distinct from 0::numeric or i.status is distinct from 'paid'
      or i.voided_at is not null or i.revenue_posted is distinct from true
      or i.revenue_posted_at is null or i.revenue_posting_state is distinct from 'posted'
      or i.revenue_posting_version is distinct from 2 or i.revenue_account_code is distinct from '4101'
      or i.revenue_rule_id is distinct from r.id or i.revenue_posting_error is not null
      or private.finance_invoice_fully_approved(i.steps) is distinct from true then
      raise exception 'Reviewed revenue repair source did not reconcile';
    end if;
    if not exists(select 1 from public.ledger_entries l
      where l.tenant_id=t and l.data_environment='production'
        and l.source_type='invoice' and l.source_id=i.id and l.voided_at is null
      having count(*)=2
        and count(*) filter(where l.entry_date=date '2026-08-01' and l.entity_id='E8'
          and l.department_code='G1101' and l.reference_no=expected.no
          and l.account_code='1123' and l.debit=expected.total and l.credit=0
          and l.posting_key='tenant:'||t::text||':invoice:'||expected.no||':revenue:v2:ar')=1
        and count(*) filter(where l.entry_date=date '2026-08-01' and l.entity_id='E8'
          and l.department_code='G1101' and l.reference_no=expected.no
          and l.account_code='4101' and l.credit=expected.total and l.debit=0
          and l.posting_key='tenant:'||t::text||':invoice:'||expected.no||':revenue:v2:income')=1
        and sum(l.debit)=sum(l.credit)) then
      raise exception 'Revenue repair must contain exactly one balanced source family per invoice';
    end if;
    if not exists(select 1 from public.ledger_entries l
      where l.tenant_id=t and l.data_environment='production' and l.reference_no=expected.no
        and (l.source_type is distinct from 'invoice' or l.source_id is distinct from i.id)
      having count(*)=2
        and count(*) filter(where l.id=expected.bank_id and l.entry_date=date '2026-09-07'
          and l.entity_id='E8' and l.department_code='G1101'
          and l.source_type is null and l.source_id is null and l.voided_at is null
          and l.account_code='1112' and l.debit=expected.total and l.credit=0
          and l.posting_key='invoice:'||expected.no||':receipt:bank')=1
        and count(*) filter(where l.id=expected.receipt_ar_id and l.entry_date=date '2026-09-07'
          and l.entity_id='E8' and l.department_code='G1101'
          and l.source_type is null and l.source_id is null and l.voided_at is null
          and l.account_code='1123' and l.credit=expected.total and l.debit=0
          and l.posting_key='invoice:'||expected.no||':receipt:ar')=1) then
      raise exception 'Revenue repair must retain the exact original September cash/receipt pair';
    end if;
  end loop;
end;
$revenue_repair_postflight$;
