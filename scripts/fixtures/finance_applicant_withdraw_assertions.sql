-- Functional assertions for the isolated PGlite fixture. Every failed call
-- must leave all members of its batch untouched.
do $test$
declare
  v_expected jsonb;
  v_result jsonb;
  v_blocked boolean;
  v_version bigint;
begin
  v_expected := private.fixture_expected_v1('bill',array['B1','B2']);
  v_result := public.finance_bill_withdraw_applicant_v1(
    array['B1','B2'],'bill-withdraw-0001','申請人更正資料',v_expected,'production'
  );
  if v_result->>'ok' <> 'true' or (v_result->>'count')::integer <> 2
     or v_result->>'idempotent_replay' <> 'false' then
    raise exception 'Bill batch withdrawal result differs';
  end if;
  if (select count(*) from public.bills
      where id in('B1','B2') and approval_status='cancelled' and status='cancelled'
        and row_version=2
        and steps->1->>'a'='cancelled'
        and steps->1->>'cancelledById'='F1'
        and steps->1->'actionLog'->0->>'action'='申請人自行抽單') <> 2 then
    raise exception 'Bill batch cancellation or audit differs';
  end if;
  if (select count(*) from public.collection_followups
      where source_table='bills' and source_id in ('B1','B2')
        and outstanding_amount=0 and payment_status='voided'
        and followup_status='void') <> 2
     or (select count(*) from public.income_document_closure_cases
      where source_table='bills' and source_id in ('B1','B2')
        and closure_status='closed_void') <> 2
     or (select count(*) from public.cash_movement_evidence_links
      where source_table='bills' and source_id in ('B1','B2')
        and cash_stage='void') <> 2 then
    raise exception 'Bill financial projections did not close';
  end if;
  v_result := public.finance_bill_withdraw_applicant_v1(
    array['B1','B2'],'bill-withdraw-0001','申請人更正資料',v_expected,'production'
  );
  if v_result->>'idempotent_replay' <> 'true'
     or (select max(row_version) from public.bills where id in('B1','B2')) <> 2 then
    raise exception 'Bill idempotent replay wrote twice';
  end if;

  v_expected := private.fixture_expected_v1('bill',array['B3']);
  v_blocked := false;
  begin
    perform public.finance_bill_withdraw_applicant_v1(
      array['B3'],'bill-withdraw-0002','不能只抽一張',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked or (select approval_status from public.bills where id='B3')='cancelled' then
    raise exception 'Partial bill batch was accepted';
  end if;

  v_expected := private.fixture_expected_v1('bill',array['B3','B4']);
  v_blocked := false;
  begin
    perform public.finance_bill_withdraw_applicant_v1(
      array['B3','B4'],'bill-withdraw-0003','整批含已付款',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked or (select approval_status from public.bills where id='B3')='cancelled' then
    raise exception 'Paid sibling did not roll back whole batch';
  end if;

  v_expected := private.fixture_expected_v1('bill',array['B6']);
  perform pg_catalog.set_config('request.jwt.claim.sub',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
  v_blocked := false;
  begin
    perform public.finance_bill_withdraw_applicant_v1(
      array['B6'],'bill-withdraw-0004','別人不能抽單',v_expected,'production'
    );
  exception when sqlstate '42501' then v_blocked := true;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
  if not v_blocked or (select approval_status from public.bills where id='B6')='cancelled' then
    raise exception 'Non-applicant could withdraw a bill';
  end if;

  v_expected := private.fixture_expected_v1('bill',array['B7']);
  update public.bills set approval_step=approval_step where id='B7';
  v_blocked := false;
  begin
    perform public.finance_bill_withdraw_applicant_v1(
      array['B7'],'bill-withdraw-0005','舊版資料不能抽單',v_expected,'production'
    );
  exception when sqlstate '40001' then v_blocked := true;
  end;
  if not v_blocked or (select approval_status from public.bills where id='B7')='cancelled' then
    raise exception 'Stale bill snapshot was accepted';
  end if;

  v_expected := private.fixture_expected_v1('bill',array['B8','B9']);
  v_blocked := false;
  begin
    perform public.finance_bill_withdraw_applicant_v1(
      array['B8','B9'],'bill-withdraw-projection-0001',
      '整批投影失敗必須回復',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked
     or (select count(*) from public.bills
         where id in ('B8','B9') and status='unpaid'
           and approval_status='pending_section_chief') <> 2
     or exists (select 1 from public.collection_followups
                where source_table='bills' and source_id in ('B8','B9'))
     or exists (select 1 from private.finance_income_document_operations
                where idempotency_key='bill-withdraw-projection-0001') then
    raise exception 'Projection exception failed to roll back the entire bill batch';
  end if;

  v_expected := private.fixture_expected_v1('invoice',array['I1','I2']);
  v_result := public.finance_invoice_withdraw_applicant_v1(
    array['I1','I2'],'invoice-withdraw-0001','申請人更正資料',v_expected,'production'
  );
  if v_result->>'ok' <> 'true' or (v_result->>'count')::integer <> 2 then
    raise exception 'Invoice batch withdrawal result differs';
  end if;
  if (select count(*) from public.invoices
      where id in('I1','I2') and approval_status='cancelled' and status='cancelled'
        and row_version=2 and steps->1->>'a'='cancelled') <> 2 then
    raise exception 'Invoice batch cancellation differs';
  end if;
  if (select count(*) from public.collection_followups
      where source_table='invoices' and source_id in ('I1','I2')
        and outstanding_amount=0 and payment_status='voided'
        and followup_status='void') <> 2
     or (select count(*) from public.income_document_closure_cases
      where source_table='invoices' and source_id in ('I1','I2')
        and closure_status='closed_void') <> 2
     or (select count(*) from public.cash_movement_evidence_links
      where source_table='invoices' and source_id in ('I1','I2')
        and cash_stage='void') <> 2 then
    raise exception 'Invoice financial projections did not close';
  end if;
  v_result := public.finance_invoice_withdraw_applicant_v1(
    array['I1','I2'],'invoice-withdraw-0001','申請人更正資料',v_expected,'production'
  );
  if v_result->>'idempotent_replay' <> 'true'
     or (select max(row_version) from public.invoices where id in('I1','I2')) <> 2 then
    raise exception 'Invoice idempotent replay wrote twice';
  end if;

  v_expected := private.fixture_expected_v1('invoice',array['I3']);
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I3'],'invoice-withdraw-0002','已入帳不得抽單',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Posted invoice was withdrawn';end if;

  update public.invoices
  set approval_status='pending_invoice_delivery',
      receipt_files='[]'::jsonb,
      steps=jsonb_set(steps,'{1,a}','"approved"'::jsonb)
  where id='I4';
  -- Make the last approval step the current one and mark the invoice issue step
  -- approved independently; this models the live issue-before-delivery route.
  update public.invoices
  set steps='[{"rk":"applicant_submit","uid":"F1","a":"approved"},
              {"rk":"accountant_invoice","uid":"F2","a":"approved"},
              {"rk":"applicant_invoice_delivery","uid":"F1","a":"","status":"pending_invoice_delivery"}]'::jsonb,
      approval_step=3
  where id='I4';
  v_expected:=jsonb_build_object('I4',jsonb_build_object(
   'row_version',(select row_version from public.invoices where id='I4'),
   'active_step_index',2,'role_key','applicant_invoice_delivery',
   'finance_user_id','F1','email','',
   'approval_status','pending_invoice_delivery'));
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I4'],'invoice-withdraw-0003','已開立不得抽單',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Issued invoice was withdrawn';end if;

  insert into public.invoice_lifecycle_events(id,tenant_id,data_environment,invoice_id)
  values('L1',public.current_tenant_id(),'production','I5');
  v_expected := private.fixture_expected_v1('invoice',array['I5']);
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I5'],'invoice-withdraw-0004','已有發票事件不得抽單',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Lifecycle invoice was withdrawn';end if;

  -- A deferred posting is still an unposted application. The same state must
  -- not bypass an actual posting timestamp or a genuinely posted state.
  v_expected := private.fixture_expected_v1('invoice',array['I6']);
  v_result := public.finance_invoice_withdraw_applicant_v1(
    array['I6'],'invoice-withdraw-deferred-0001',
    '收入入帳尚未開始，申請人抽回',v_expected,'production'
  );
  if v_result->>'ok' <> 'true'
     or (select count(*) from public.invoices
         where id='I6' and status='cancelled'
           and approval_status='cancelled'
           and revenue_posted_at is null
           and revenue_posting_state='deferred') <> 1 then
    raise exception 'Deferred but unposted invoice could not be withdrawn';
  end if;

  v_expected := private.fixture_expected_v1('invoice',array['I7']);
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I7'],'invoice-withdraw-deferred-0002',
      '已有入帳時間不得抽單',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked
     or (select status from public.invoices where id='I7')='cancelled' then
    raise exception 'Deferred invoice with posting timestamp was withdrawn';
  end if;

  v_expected := private.fixture_expected_v1('invoice',array['I8']);
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I8'],'invoice-withdraw-deferred-0003',
      '已入帳狀態不得抽單',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked
     or (select status from public.invoices where id='I8')='cancelled' then
    raise exception 'Posted-state invoice was withdrawn';
  end if;

  -- Even an upsert that returns without writing must fail the final
  -- projection assertion, preventing a false successful withdrawal.
  v_expected := private.fixture_expected_v1('invoice',array['I9']);
  v_blocked := false;
  begin
    perform public.finance_invoice_withdraw_applicant_v1(
      array['I9'],'invoice-withdraw-projection-0001',
      '投影未寫入不可成功',v_expected,'production'
    );
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked
     or (select status from public.invoices where id='I9') <> 'unpaid'
     or exists (select 1 from public.collection_followups
                where source_table='invoices' and source_id='I9')
     or exists (select 1 from private.finance_income_document_operations
                where idempotency_key='invoice-withdraw-projection-0001') then
    raise exception 'Missing cash projection did not roll back invoice';
  end if;

  v_blocked := false;
  begin
    update public.expense_requests set status='cancelled' where id='E1';
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked
     or (select status from public.expense_requests where id='E1')='cancelled' then
    raise exception 'Electronic-labor statement cancellation bypassed guard';
  end if;
end;
$test$;
