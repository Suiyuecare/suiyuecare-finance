-- Read-only production catalog export; no production rows or credentials.
CREATE OR REPLACE FUNCTION public.finalize_expense_request(p_request_id text, p_status text, p_step integer, p_steps jsonb, p_amount numeric, p_bank_fee_amount numeric, p_voucher_id text, p_voucher_no text, p_entity_name text, p_voucher_entries jsonb, p_voucher_total numeric, p_voucher_description text, p_voucher_date date DEFAULT CURRENT_DATE, p_form_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_request public.expense_requests%rowtype;
  v_environment text;
  v_entry jsonb;
  v_entry_index integer := 0;
  v_entry_type text;
  v_entry_account text;
  v_entry_name text;
  v_entry_amount numeric;
  v_entry_debit numeric;
  v_entry_credit numeric;
  v_entry_description text;
  v_entry_key text;
  v_normalized_entries jsonb := '[]'::jsonb;
  v_debit_total numeric := 0;
  v_credit_total numeric := 0;
  v_voucher_total numeric;
  v_voucher_date date;
  v_unapproved_count integer := 0;
  v_final_unapproved boolean := false;
  v_active_index integer;
  v_payload_unapproved_count integer := 0;
  v_previous_write_context text;
  v_actor public.finance_users%rowtype;
  v_locked_original_amount numeric;
  v_locked_actual_amount numeric;
  v_locked_fee numeric;
  v_server_bank_fee numeric;
  v_expected_voucher_total numeric;
  v_advance_voucher_id text;
  v_advance_posted_at timestamptz;
  v_final_form_patch jsonb := '{}'::jsonb;
begin
  v_tenant_id := private.finance_require_authenticated_tenant();

  select request_row.data_environment
    into v_environment
  from public.expense_requests request_row
  where request_row.tenant_id = v_tenant_id
    and request_row.id = p_request_id;

  if not found then
    raise exception '找不到目前租戶的支出申請：%', p_request_id
      using errcode = 'P0002';
  end if;

  select request_row.*
    into v_request
  from public.expense_requests request_row
  where request_row.tenant_id = v_tenant_id
    and request_row.data_environment = v_environment
    and request_row.id = p_request_id
  for update;

  if not found then
    raise exception '支出申請的租戶或資料環境已變更，請重新整理後再試：%',
      p_request_id
      using errcode = '40001';
  end if;

  perform private.finance_assert_source_posting_actor(
    v_tenant_id,
    v_request.entity_id,
    v_request.department_code,
    'expense_request',
    v_request.id,
    v_request.applicant_id,
    false
  );
  v_actor := public.current_finance_user();

  v_environment :=
    pg_catalog.lower(coalesce(v_environment, 'production'));
  if v_environment not in ('production', 'test') then
    raise exception '支出申請資料環境不正確：%', v_request.no
      using errcode = '23514';
  end if;
  if v_request.voided_at is not null then
    raise exception '已作廢的支出申請不可入帳：%', v_request.no
      using errcode = '23514';
  end if;

  v_server_bank_fee := greatest(
    coalesce(v_request.bank_fee_amount, 0::numeric),
    0::numeric
  );
  v_expected_voucher_total := case
    when v_request.type = 'advance_request' then
      greatest(
        coalesce(
          v_request.estimated_amount,
          v_request.amount,
          0::numeric
        ),
        coalesce(
          v_request.actual_amount,
          v_request.amount,
          0::numeric
        )
      )
    when v_request.type = 'petty_cash_request'
         and coalesce(v_request.petty_mode, 'general') = 'initial'
      then coalesce(v_request.amount, 0)
    when v_request.type = 'petty_cash_request'
      then (2 * coalesce(v_request.amount, 0)) + v_server_bank_fee
    else coalesce(v_request.amount, 0) + v_server_bank_fee
  end;

  if v_request.voucher_id is not null
     or v_request.ledger_posted_at is not null
     or v_request.posting_locked_at is not null
     or v_request.status = 'completed' then
    if v_request.voucher_id is null
       or v_request.ledger_posted_at is null
       or v_request.posting_locked_at is null
       or v_request.status <> 'completed'
       or (
         v_request.type = 'advance_request'
         and not private.finance_advance_disbursement_truth_is_valid(
           v_request
         )
       )
       or not exists (
         select 1
         from public.vouchers voucher_row
         where voucher_row.tenant_id = v_tenant_id
           and voucher_row.data_environment = v_environment
           and voucher_row.id = v_request.voucher_id
           and voucher_row.no = v_request.voucher_id
           and voucher_row.request_id = v_request.id
           and voucher_row.entity_id = v_request.entity_id
           and voucher_row.posted is true
           and voucher_row.voided_at is null
           and pg_catalog.jsonb_typeof(
             coalesce(voucher_row.entries, '[]'::jsonb)
           ) = 'array'
           and pg_catalog.jsonb_array_length(
             coalesce(voucher_row.entries, '[]'::jsonb)
           ) >= 2
           and not exists (
             select 1
             from pg_catalog.jsonb_array_elements(
               coalesce(voucher_row.entries, '[]'::jsonb)
             ) voucher_entry
             where pg_catalog.jsonb_typeof(voucher_entry) <> 'object'
               or coalesce(voucher_entry ->> 't', '') not in ('dr', 'cr')
               or nullif(voucher_entry ->> 'ac', '') is null
               or nullif(voucher_entry ->> 'an', '') is null
               or nullif(voucher_entry ->> 'amt', '') is null
               or (voucher_entry ->> 'amt')::numeric <= 0
               or voucher_entry ->> 'dept' is distinct from
                 v_request.department_code
           )
           and (
             select
               pg_catalog.abs(
                 coalesce(
                   pg_catalog.sum(
                     (voucher_entry ->> 'amt')::numeric
                   ) filter (
                     where voucher_entry ->> 't' = 'dr'
                   ),
                   0
                 ) -
                 coalesce(
                   pg_catalog.sum(
                     (voucher_entry ->> 'amt')::numeric
                   ) filter (
                     where voucher_entry ->> 't' = 'cr'
                   ),
                   0
                 )
               ) <= 0.01
               and pg_catalog.abs(
                 coalesce(
                   pg_catalog.sum(
                     (voucher_entry ->> 'amt')::numeric
                   ) filter (
                     where voucher_entry ->> 't' = 'dr'
                   ),
                   0
                 ) - coalesce(voucher_row.total, 0)
               ) <= 0.01
             from pg_catalog.jsonb_array_elements(
               coalesce(voucher_row.entries, '[]'::jsonb)
             ) voucher_entry
           )
           and coalesce(voucher_row.total, 0) > 0
           and pg_catalog.abs(
             coalesce(voucher_row.total, 0) -
               v_expected_voucher_total
           ) <= 0.01
       )
       or not exists (
         select 1
         from public.ledger_entries ledger_row
         where ledger_row.tenant_id = v_tenant_id
           and ledger_row.data_environment = v_environment
           and ledger_row.voucher_no = v_request.voucher_id
           and ledger_row.source_type = 'expense_request'
           and ledger_row.source_id = v_request.id
           and ledger_row.reference_no = v_request.no
           and ledger_row.entity_id = v_request.entity_id
           and ledger_row.department_code is not distinct from
             v_request.department_code
           and ledger_row.posting_key like
             'tenant:' || v_tenant_id::text || ':expense:' ||
               v_request.no || ':%'
           and ledger_row.voided_at is null
         group by ledger_row.voucher_no
         having pg_catalog.count(*) = (
             select pg_catalog.jsonb_array_length(
               coalesce(voucher_row.entries, '[]'::jsonb)
             )
             from public.vouchers voucher_row
             where voucher_row.tenant_id = v_tenant_id
               and voucher_row.data_environment = v_environment
               and voucher_row.id = v_request.voucher_id
               and voucher_row.no = v_request.voucher_id
           )
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit), 0) -
             coalesce(pg_catalog.sum(ledger_row.credit), 0)
           ) <= 0.01
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit), 0) - (
               select voucher_row.total
               from public.vouchers voucher_row
               where voucher_row.tenant_id = v_tenant_id
                 and voucher_row.data_environment = v_environment
                 and voucher_row.id = v_request.voucher_id
                 and voucher_row.no = v_request.voucher_id
             )
           ) <= 0.01
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit), 0) -
               v_expected_voucher_total
           ) <= 0.01
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.credit), 0) -
               v_expected_voucher_total
           ) <= 0.01
       )
       or (
         select coalesce(
           pg_catalog.jsonb_agg(
             voucher_truth.entry
             order by voucher_truth.entry
           ),
           '[]'::jsonb
         )
         from (
           select pg_catalog.jsonb_build_object(
             't', voucher_entry ->> 't',
             'ac', voucher_entry ->> 'ac',
             'an', voucher_entry ->> 'an',
             'dept', voucher_entry ->> 'dept',
             'amt', (voucher_entry ->> 'amt')::numeric
           ) as entry
           from public.vouchers voucher_row
           cross join lateral pg_catalog.jsonb_array_elements(
             coalesce(voucher_row.entries, '[]'::jsonb)
           ) voucher_entry
           where voucher_row.tenant_id = v_tenant_id
             and voucher_row.data_environment = v_environment
             and voucher_row.id = v_request.voucher_id
             and voucher_row.no = v_request.voucher_id
             and voucher_row.request_id = v_request.id
             and voucher_row.posted is true
             and voucher_row.voided_at is null
         ) voucher_truth
       ) is distinct from (
         select coalesce(
           pg_catalog.jsonb_agg(
             ledger_truth.entry
             order by ledger_truth.entry
           ),
           '[]'::jsonb
         )
         from (
           select pg_catalog.jsonb_build_object(
             't', case
               when coalesce(ledger_row.debit, 0) > 0
                    and coalesce(ledger_row.credit, 0) = 0
                 then 'dr'
               when coalesce(ledger_row.credit, 0) > 0
                    and coalesce(ledger_row.debit, 0) = 0
                 then 'cr'
               else 'invalid'
             end,
             'ac', ledger_row.account_code,
             'an', ledger_row.account_name,
             'dept', ledger_row.department_code,
             'amt', case
               when coalesce(ledger_row.debit, 0) > 0
                    and coalesce(ledger_row.credit, 0) = 0
                 then ledger_row.debit
               when coalesce(ledger_row.credit, 0) > 0
                    and coalesce(ledger_row.debit, 0) = 0
                 then ledger_row.credit
               else greatest(
                 pg_catalog.abs(
                   coalesce(ledger_row.debit, 0::numeric)
                 ),
                 pg_catalog.abs(
                   coalesce(ledger_row.credit, 0::numeric)
                 )
               )
             end
           ) as entry
           from public.ledger_entries ledger_row
           where ledger_row.tenant_id = v_tenant_id
             and ledger_row.data_environment = v_environment
             and ledger_row.voucher_no = v_request.voucher_id
             and ledger_row.voided_at is null
         ) ledger_truth
       ) then
      raise exception '申請單 % 的完成標記與傳票分類帳不一致，已停止重試',
        coalesce(v_request.no, v_request.id)
        using errcode = '23514';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'voucher_id', v_request.voucher_id
    );
  end if;

  if coalesce(v_request.status, '') <> 'pending_voucher' then
    raise exception '申請單 % 尚未進入會計最終入帳關卡。',
      coalesce(v_request.no, v_request.id)
      using errcode = '23514';
  end if;

  select
    pg_catalog.count(*) filter (
      where not evaluated_step.approved
        and not evaluated_step.negative_terminal
    )::integer,
    coalesce(
      pg_catalog.bool_or(
        evaluated_step.role_key in ('accountant_final', 'accounting')
        and not evaluated_step.approved
      ),
      false
    )
    into v_unapproved_count, v_final_unapproved
  from (
    select
      coalesce(
        nullif(approval_step.value ->> 'rk', ''),
        nullif(approval_step.value ->> 'roleKey', ''),
        nullif(approval_step.value ->> 'role', ''),
        nullif(approval_step.value ->> 'key', ''),
        ''
      ) as role_key,
      (
        coalesce(approval_step.value ->> 'a', '') in ('approved', 'AUTO')
        or coalesce(approval_step.value ->> 'status', '') in (
          'approved', 'auto_approved', 'skipped'
        )
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'auto',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'autoSkip',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'autoMerged',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'skipped',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
      ) as approved,
      (
        coalesce(approval_step.value ->> 'a', '') in (
          'rejected', 'rejected_all', 'cancelled'
        )
        or coalesce(approval_step.value ->> 'status', '') in (
          'rejected', 'cancelled'
        )
      ) as negative_terminal
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(
          coalesce(v_request.steps, '[]'::jsonb)
        ) = 'array'
          then coalesce(v_request.steps, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) approval_step(value)
  ) evaluated_step;

  if v_unapproved_count <> 1 or not v_final_unapproved then
    raise exception '申請單 % 的簽核流程尚未完整走到最後會計關。',
      coalesce(v_request.no, v_request.id)
      using errcode = '23514';
  end if;

  select (approval_step.ordinality - 1)::integer
    into v_active_index
  from pg_catalog.jsonb_array_elements(v_request.steps)
    with ordinality approval_step(value, ordinality)
  where not (
    coalesce(approval_step.value ->> 'a', '') in ('approved', 'AUTO')
    or coalesce(approval_step.value ->> 'status', '') in (
      'approved', 'auto_approved', 'skipped'
    )
    or pg_catalog.lower(coalesce(
      approval_step.value ->> 'auto',
      'false'
    )) in ('true', 't', '1', 'yes', 'y')
    or pg_catalog.lower(coalesce(
      approval_step.value ->> 'autoSkip',
      'false'
    )) in ('true', 't', '1', 'yes', 'y')
    or pg_catalog.lower(coalesce(
      approval_step.value ->> 'autoMerged',
      'false'
    )) in ('true', 't', '1', 'yes', 'y')
    or pg_catalog.lower(coalesce(
      approval_step.value ->> 'skipped',
      'false'
    )) in ('true', 't', '1', 'yes', 'y')
  )
    and coalesce(approval_step.value ->> 'a', '') not in (
      'rejected', 'rejected_all', 'cancelled'
    )
    and coalesce(approval_step.value ->> 'status', '') not in (
      'rejected', 'cancelled'
    )
  limit 1;

  if v_active_index is null
     or private.finance_income_step_role(
       v_request.steps -> v_active_index
     ) not in ('accountant_final', 'accounting')
     or not private.finance_expense_actor_can_act(
       v_tenant_id,
       v_request,
       v_active_index,
       v_request.steps -> v_active_index,
       v_actor.id,
       v_actor.email,
       v_actor.role
     )
     or not private.finance_expense_is_exact_step_transition(
       v_request.steps,
       p_steps,
       v_active_index,
       'approved',
       v_actor.id,
       v_actor.name
     )
     or not private.finance_expense_new_files_are_owned(
       v_tenant_id,
       v_request,
       coalesce(
         v_request.steps -> v_active_index -> 'files',
         '[]'::jsonb
       ),
       coalesce(
         p_steps -> v_active_index -> 'files',
         '[]'::jsonb
       ),
       v_actor.id
     ) then
    raise exception '申請單 % 的最終會計步驟、處理人或附件不符合凍結簽核資料',
      coalesce(v_request.no, v_request.id)
      using errcode = '42501';
  end if;

  if p_step is distinct from
       pg_catalog.jsonb_array_length(p_steps) then
    raise exception '申請單 % 的流程步驟編號與伺服器流程不一致',
      coalesce(v_request.no, v_request.id)
      using errcode = '23514';
  end if;

  select pg_catalog.count(*) filter (
    where not evaluated_step.approved
      and not evaluated_step.negative_terminal
  )::integer
    into v_payload_unapproved_count
  from (
    select
      (
        coalesce(approval_step.value ->> 'a', '') in ('approved', 'AUTO')
        or coalesce(approval_step.value ->> 'status', '') in (
          'approved', 'auto_approved', 'skipped'
        )
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'auto',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'autoSkip',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'autoMerged',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
        or pg_catalog.lower(coalesce(
          approval_step.value ->> 'skipped',
          'false'
        )) in ('true', 't', '1', 'yes', 'y')
      ) as approved,
      (
        coalesce(approval_step.value ->> 'a', '') in (
          'rejected', 'rejected_all', 'cancelled'
        )
        or coalesce(approval_step.value ->> 'status', '') in (
          'rejected', 'cancelled'
        )
      ) as negative_terminal
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) =
          'array'
          then coalesce(p_steps, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) approval_step(value)
  ) evaluated_step;

  if coalesce(p_status, '') <> 'completed'
     or v_payload_unapproved_count <> 0 then
    raise exception '申請單 % 不可在仍有未完成簽核時切傳票。',
      coalesce(v_request.no, v_request.id)
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.vouchers voucher_row
    where voucher_row.tenant_id = v_tenant_id
      and voucher_row.data_environment = v_environment
      and voucher_row.request_id::text = v_request.id::text
      and voucher_row.posted is true
      and voucher_row.voided_at is null
      and coalesce(voucher_row.adjustment_type, '') not in (
        'reversal', 'adjustment'
      )
      and (
        voucher_row.no like 'V%'
        or exists (
          select 1
          from public.ledger_entries ledger_row
          where ledger_row.tenant_id = v_tenant_id
            and ledger_row.data_environment = v_environment
            and ledger_row.reference_no = v_request.no
            and ledger_row.posting_key like
              'tenant:' || v_tenant_id::text || ':expense:' ||
                v_request.no || ':%'
            and ledger_row.voided_at is null
        )
      )
      and not exists (
        select 1
        from public.vouchers reversal_row
        where reversal_row.tenant_id = v_tenant_id
          and reversal_row.data_environment = v_environment
          and reversal_row.adjusts_voucher_no = voucher_row.no
          and reversal_row.adjustment_type = 'reversal'
          and reversal_row.voided_at is null
      )
  ) then
    raise exception '申請單 % 已有尚未沖銷的有效傳票，禁止重複入帳。',
      coalesce(v_request.no, v_request.id)
      using errcode = '23505';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception '入帳金額不可為空或小於零'
      using errcode = '23514';
  end if;

  if v_request.type = 'purchase_request' then
    v_locked_actual_amount := v_request.actual_amount;
    if v_locked_actual_amount is null
       or v_locked_actual_amount <= 0
       or pg_catalog.abs(p_amount - v_locked_actual_amount) > 0.01
       or nullif(
         p_form_payload ->> 'purchaseFinalizedAmount',
         ''
       ) is null
       or pg_catalog.abs(
         (
           p_form_payload ->> 'purchaseFinalizedAmount'
         )::numeric - v_locked_actual_amount
       ) > 0.01
       or (
         nullif(
           v_request.form_payload
             -> 'purchaseActual'
             ->> 'actualAmount',
           ''
         ) is not null
         and pg_catalog.abs(
           (
             v_request.form_payload
               -> 'purchaseActual'
               ->> 'actualAmount'
           )::numeric - v_locked_actual_amount
         ) > 0.01
       )
       or pg_catalog.jsonb_typeof(
         coalesce(v_request.actual_files, '[]'::jsonb)
       ) <> 'array'
       or pg_catalog.jsonb_array_length(
         coalesce(v_request.actual_files, '[]'::jsonb)
       ) = 0 then
      raise exception '採購申請 % 的實際金額、最終金額或憑據不一致',
        v_request.no
        using errcode = '23514';
    end if;

    v_final_form_patch := pg_catalog.jsonb_build_object(
      'purchaseFinalizedAmount', v_locked_actual_amount,
      'purchaseFinalizedAt', pg_catalog.now(),
      'purchaseVariance',
        v_locked_actual_amount -
          coalesce(v_request.estimated_amount, v_request.amount, 0)
    );
  elsif v_request.type = 'advance_request' then
    v_locked_original_amount := coalesce(
      v_request.estimated_amount,
      v_request.amount
    );
    v_locked_actual_amount := p_amount;
    v_locked_fee := greatest(
      coalesce(v_request.bank_fee_amount, 0::numeric),
      0::numeric
    );
    v_advance_voucher_id := nullif(
      v_request.form_payload ->> 'advanceDisbursementVoucherId',
      ''
    );
    v_advance_posted_at := nullif(
      v_request.form_payload ->> 'advanceDisbursementPostedAt',
      ''
    )::timestamptz;

    if v_locked_original_amount is null
       or v_locked_original_amount <= 0
       or v_locked_actual_amount <= 0
       or not private.finance_advance_disbursement_truth_is_valid(
         v_request
       )
       or v_request.cash_posted_at is null
       or v_advance_voucher_id is null
       or v_advance_posted_at is null
       or v_request.cash_posted_at is distinct from v_advance_posted_at
       or nullif(
         p_form_payload ->> 'advanceFinalAmount',
         ''
       ) is null
       or pg_catalog.abs(
         (
           p_form_payload ->> 'advanceFinalAmount'
         )::numeric - v_locked_actual_amount
       ) > 0.01
       or nullif(
         p_form_payload ->> 'advanceOriginalAmount',
         ''
       ) is null
       or pg_catalog.abs(
         (
           p_form_payload ->> 'advanceOriginalAmount'
         )::numeric - v_locked_original_amount
       ) > 0.01
       or pg_catalog.lower(coalesce(
         p_form_payload ->> 'advanceSettlementConfirmed',
         'false'
       )) not in ('true', 't', '1', 'yes', 'y')
       or (
         v_request.actual_amount is not null
         and v_request.actual_amount > 0
         and pg_catalog.abs(
           v_request.actual_amount - v_locked_actual_amount
         ) > 0.01
       )
       or pg_catalog.jsonb_typeof(
         coalesce(v_request.actual_files, '[]'::jsonb)
       ) <> 'array'
       or pg_catalog.jsonb_array_length(
         coalesce(v_request.actual_files, '[]'::jsonb)
       ) < 2
       or not exists (
         select 1
         from public.vouchers voucher_row
         where voucher_row.tenant_id = v_tenant_id
           and voucher_row.data_environment = v_environment
           and voucher_row.id = v_advance_voucher_id
           and voucher_row.no = v_advance_voucher_id
           and voucher_row.request_id = v_request.id
           and voucher_row.entity_id = v_request.entity_id
           and voucher_row.posted is true
           and voucher_row.voided_at is null
           and voucher_row.no like 'ADV%'
           and pg_catalog.abs(
             coalesce(voucher_row.total, 0) -
               (v_locked_original_amount + v_locked_fee)
           ) <= 0.01
           and pg_catalog.jsonb_typeof(
             coalesce(voucher_row.entries, '[]'::jsonb)
           ) = 'array'
           and pg_catalog.jsonb_array_length(
             coalesce(voucher_row.entries, '[]'::jsonb)
           ) = case when v_locked_fee > 0 then 3 else 2 end
           and (
             select pg_catalog.count(*)
             from pg_catalog.jsonb_array_elements(
               coalesce(voucher_row.entries, '[]'::jsonb)
             ) voucher_entry
             where voucher_entry ->> 't' = 'dr'
               and voucher_entry ->> 'ac' = '1191'
               and pg_catalog.abs(
                 coalesce(
                   nullif(voucher_entry ->> 'amt', '')::numeric,
                   0
                 ) - v_locked_original_amount
               ) <= 0.01
           ) = 1
           and (
             select pg_catalog.count(*)
             from pg_catalog.jsonb_array_elements(
               coalesce(voucher_row.entries, '[]'::jsonb)
             ) voucher_entry
             where voucher_entry ->> 't' = 'cr'
               and voucher_entry ->> 'ac' = '1112'
               and pg_catalog.abs(
                 coalesce(
                   nullif(voucher_entry ->> 'amt', '')::numeric,
                   0
                 ) - (v_locked_original_amount + v_locked_fee)
               ) <= 0.01
           ) = 1
           and (
             select pg_catalog.count(*)
             from pg_catalog.jsonb_array_elements(
               coalesce(voucher_row.entries, '[]'::jsonb)
             ) voucher_entry
             where voucher_entry ->> 't' = 'dr'
               and voucher_entry ->> 'ac' = '6290'
               and pg_catalog.abs(
                 coalesce(
                   nullif(voucher_entry ->> 'amt', '')::numeric,
                   0
                 ) - v_locked_fee
               ) <= 0.01
           ) = case when v_locked_fee > 0 then 1 else 0 end
       )
       or not exists (
         select 1
         from public.ledger_entries ledger_row
         where ledger_row.tenant_id = v_tenant_id
           and ledger_row.data_environment = v_environment
           and ledger_row.voucher_no = v_advance_voucher_id
           and ledger_row.source_type = 'advance_disbursement'
           and ledger_row.source_id = v_request.id
           and ledger_row.reference_no = v_request.no
           and ledger_row.entity_id = v_request.entity_id
           and ledger_row.department_code is not distinct from
             v_request.department_code
           and ledger_row.posting_key like
             'tenant:' || v_tenant_id::text ||
               ':advance_disbursement:' || v_request.no || ':%'
           and ledger_row.voided_at is null
         group by ledger_row.voucher_no
         having pg_catalog.count(*) =
             case when v_locked_fee > 0 then 3 else 2 end
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit), 0) -
             coalesce(pg_catalog.sum(ledger_row.credit), 0)
           ) <= 0.01
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit) filter (
               where ledger_row.account_code = '1191'
             ), 0) - v_locked_original_amount
           ) <= 0.01
           and pg_catalog.count(*) filter (
             where ledger_row.account_code = '1191'
               and pg_catalog.abs(
                 ledger_row.debit - v_locked_original_amount
               ) <= 0.01
               and coalesce(ledger_row.credit, 0) = 0
           ) = 1
           and pg_catalog.count(*) filter (
             where ledger_row.account_code = '1112'
               and pg_catalog.abs(
                 ledger_row.credit -
                   (v_locked_original_amount + v_locked_fee)
               ) <= 0.01
               and coalesce(ledger_row.debit, 0) = 0
           ) = 1
           and pg_catalog.count(*) filter (
             where ledger_row.account_code = '6290'
               and pg_catalog.abs(
                 ledger_row.debit - v_locked_fee
               ) <= 0.01
               and coalesce(ledger_row.credit, 0) = 0
           ) = case when v_locked_fee > 0 then 1 else 0 end
       ) then
      raise exception '預支申請 % 缺少可信的撥款帳務、最終金額或憑據',
        v_request.no
        using errcode = '23514';
    end if;

    v_final_form_patch := pg_catalog.jsonb_build_object(
      'advanceFinalAmount', v_locked_actual_amount,
      'advanceOriginalAmount', v_locked_original_amount,
      'advanceSettlementDifference',
        v_locked_actual_amount - v_locked_original_amount,
      'advanceSettlementType', case
        when v_locked_actual_amount > v_locked_original_amount
          then 'supplement'
        when v_locked_actual_amount < v_locked_original_amount
          then 'refund'
        else 'equal'
      end,
      'advanceSettlementConfirmed', true,
      'advanceFinalSettledAt', pg_catalog.now(),
      'advanceAccountingStage', 'settled_to_actual_expense',
      'advanceFinalizedAt', pg_catalog.now()
    );
  elsif pg_catalog.abs(
    p_amount - coalesce(v_request.amount, 0)
  ) > 0.01 then
    raise exception '申請單 % 的入帳金額與鎖定申請金額不一致',
      v_request.no
      using errcode = '23514';
  end if;

  if v_request.type = 'advance_request' then
    if pg_catalog.abs(coalesce(p_bank_fee_amount, 0)) > 0.01 then
      raise exception '預支結算傳票不得重複計入撥款手續費：%',
        v_request.no
        using errcode = '23514';
    end if;
    v_expected_voucher_total := greatest(
      v_locked_original_amount,
      v_locked_actual_amount
    );
  elsif v_request.type = 'petty_cash_request'
        and coalesce(v_request.petty_mode, 'general') = 'initial' then
    if pg_catalog.abs(coalesce(p_bank_fee_amount, 0)) > 0.01
       or v_server_bank_fee > 0.01 then
      raise exception '零用金初次申請傳票不得計入銀行手續費：%',
        v_request.no
        using errcode = '23514';
    end if;
    v_expected_voucher_total := p_amount;
  elsif v_request.type = 'petty_cash_request' then
    if pg_catalog.abs(
      coalesce(p_bank_fee_amount, 0) - v_server_bank_fee
    ) > 0.01 then
      raise exception '零用金申請 % 的銀行手續費與鎖定來源不一致',
        v_request.no
        using errcode = '23514';
    end if;
    v_expected_voucher_total :=
      (2 * p_amount) + v_server_bank_fee;
  else
    if pg_catalog.abs(
      coalesce(p_bank_fee_amount, 0) - v_server_bank_fee
    ) > 0.01 then
      raise exception '申請單 % 的銀行手續費與鎖定來源不一致',
        v_request.no
        using errcode = '23514';
    end if;
    v_expected_voucher_total := p_amount + v_server_bank_fee;
  end if;

  if nullif(p_voucher_id, '') is null
     or nullif(p_voucher_no, '') is null then
    raise exception '傳票編號不可為空'
      using errcode = '23514';
  end if;
  if p_voucher_id <> p_voucher_no then
    raise exception '傳票識別碼與傳票號碼必須一致'
      using errcode = '23514';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(
       p_voucher_entries,
       'null'::jsonb
     )) <> 'array'
     or pg_catalog.jsonb_array_length(p_voucher_entries) = 0
     or pg_catalog.jsonb_array_length(p_voucher_entries) > 200 then
    raise exception '傳票分錄必須包含 1 至 200 筆'
      using errcode = '23514';
  end if;

  for v_entry in
    select entry_item.value
    from pg_catalog.jsonb_array_elements(p_voucher_entries)
      entry_item(value)
  loop
    v_entry_index := v_entry_index + 1;
    if pg_catalog.jsonb_typeof(v_entry) <> 'object' then
      raise exception '傳票第 % 筆分錄格式不正確', v_entry_index
        using errcode = '23514';
    end if;

    v_entry_type := pg_catalog.lower(coalesce(
      nullif(v_entry ->> 't', ''),
      nullif(v_entry ->> 'type', ''),
      ''
    ));
    v_entry_account := nullif(pg_catalog.btrim(coalesce(
      v_entry ->> 'ac',
      v_entry ->> 'account_code',
      ''
    )), '');
    v_entry_amount := coalesce(
      nullif(v_entry ->> 'amt', '')::numeric,
      nullif(v_entry ->> 'amount', '')::numeric,
      0
    );

    if v_entry_type not in ('dr', 'cr') then
      raise exception '傳票第 % 筆借貸別不正確', v_entry_index
        using errcode = '23514';
    end if;
    if v_entry_account is null
       or pg_catalog.char_length(v_entry_account) > 64 then
      raise exception '傳票第 % 筆會計科目不正確', v_entry_index
        using errcode = '23514';
    end if;
    v_entry_name := private.finance_tenant_account_name(
      v_tenant_id,
      v_entry_account
    );
    if v_entry_name is null then
      raise exception '傳票第 % 筆科目 % 不存在或已停用',
        v_entry_index,
        v_entry_account
        using errcode = '23503';
    end if;
    if v_entry_amount <= 0 then
      raise exception '傳票第 % 筆金額必須大於零', v_entry_index
        using errcode = '23514';
    end if;

    -- Department identity is owned by the source request.  A browser-proposed
    -- department is deliberately ignored instead of becoming accounting truth.
    v_entry_debit :=
      case when v_entry_type = 'dr' then v_entry_amount else 0 end;
    v_entry_credit :=
      case when v_entry_type = 'cr' then v_entry_amount else 0 end;
    v_debit_total := v_debit_total + v_entry_debit;
    v_credit_total := v_credit_total + v_entry_credit;
    v_normalized_entries := v_normalized_entries ||
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          't', v_entry_type,
          'ac', v_entry_account,
          'an', v_entry_name,
          'dept', v_request.department_code,
          'amt', v_entry_amount
        )
      );
  end loop;

  if pg_catalog.round(v_debit_total - v_credit_total, 2) <> 0 then
    raise exception '傳票借貸不平衡：借方 %、貸方 %',
      v_debit_total,
      v_credit_total
      using errcode = '23514';
  end if;

  if pg_catalog.abs(v_debit_total - v_expected_voucher_total) > 0.01
     or (
       p_voucher_total is not null
       and pg_catalog.abs(
         p_voucher_total - v_expected_voucher_total
       ) > 0.01
     ) then
    raise exception '傳票借方合計 % 必須等於伺服器鎖定總額 %',
      v_debit_total,
      v_expected_voucher_total
      using errcode = '23514';
  end if;
  v_voucher_total := v_expected_voucher_total;

  v_voucher_date := coalesce(p_voucher_date, current_date);
  perform private.finance_assert_period_open(
    v_tenant_id,
    v_environment,
    v_request.entity_id,
    v_voucher_date,
    'finalize expense request'
  );

  v_previous_write_context := pg_catalog.current_setting(
    'app.finance_expense_write_context',
    true
  );
  perform pg_catalog.set_config(
    'app.finance_expense_write_context',
    'finalize',
    true
  );

  update public.expense_requests request_row
     set amount = p_amount,
         estimated_amount = case
           when request_row.type in (
             'advance_request',
             'purchase_request'
           ) then coalesce(
             request_row.estimated_amount,
             request_row.amount
           )
           else request_row.estimated_amount
         end,
         actual_amount = case
           when request_row.type in (
             'advance_request',
             'purchase_request'
           ) then p_amount
           else request_row.actual_amount
         end,
         status = 'completed',
         step = pg_catalog.jsonb_array_length(p_steps),
         steps = p_steps,
         voucher_id = p_voucher_id,
         bank_fee_amount = case
           when request_row.type = 'advance_request'
             then request_row.bank_fee_amount
           else v_server_bank_fee
         end,
         form_payload =
           coalesce(request_row.form_payload, '{}'::jsonb)
           || v_final_form_patch
           || pg_catalog.jsonb_build_object(
             'ledgerPostedAt', pg_catalog.now(),
             'postingLockedAt', pg_catalog.now()
           ),
         ledger_posted_at = pg_catalog.now(),
         posting_locked_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where request_row.tenant_id = v_tenant_id
     and request_row.data_environment = v_environment
     and request_row.id = v_request.id;

  if not found then
    raise exception '支出申請最終狀態寫回失敗：%', v_request.no
      using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'app.finance_expense_write_context',
    coalesce(v_previous_write_context, ''),
    true
  );

  insert into public.vouchers (
    id,
    no,
    request_id,
    entity_id,
    entity_name,
    voucher_date,
    description,
    entries,
    total,
    creator,
    posted,
    posted_at,
    posting_locked_at,
    data_environment,
    tenant_id
  )
  values (
    p_voucher_id,
    p_voucher_no,
    v_request.id,
    v_request.entity_id,
    coalesce(
      private.finance_tenant_entity_name(
        v_tenant_id,
        v_request.entity_id
      ),
      v_request.entity_id
    ),
    v_voucher_date,
    coalesce(p_voucher_description, v_request.description, v_request.no),
    v_normalized_entries,
    v_voucher_total,
    coalesce(public.current_finance_user_name(), 'system'),
    true,
    pg_catalog.now(),
    pg_catalog.now(),
    v_environment,
    v_tenant_id
  );

  v_entry_index := 0;
  for v_entry in
    select entry_item.value
    from pg_catalog.jsonb_array_elements(v_normalized_entries)
      entry_item(value)
  loop
    v_entry_index := v_entry_index + 1;
    v_entry_type := v_entry ->> 't';
    v_entry_account := v_entry ->> 'ac';
    v_entry_name := v_entry ->> 'an';
    v_entry_amount := (v_entry ->> 'amt')::numeric;
    v_entry_debit :=
      case when v_entry_type = 'dr' then v_entry_amount else 0 end;
    v_entry_credit :=
      case when v_entry_type = 'cr' then v_entry_amount else 0 end;
    v_entry_description := case
      when v_entry_account = '6290'
        then coalesce(v_request.type_label, '申請') || ' 銀行手續費'
      when v_entry_type = 'cr'
        then coalesce(v_request.type_label, '申請') || ' 付款'
      else
        coalesce(v_request.type_label, '申請') || ' — ' ||
          coalesce(v_request.applicant, '')
    end;
    v_entry_key :=
      'tenant:' || v_tenant_id::text || ':expense:' ||
      v_request.no || ':' || v_entry_index || ':' ||
      v_entry_account || ':' || v_entry_type;

    insert into public.ledger_entries (
      entry_date,
      description,
      entity_id,
      department_code,
      debit,
      credit,
      account_code,
      account_name,
      reference_no,
      posting_key,
      source_type,
      source_id,
      source_no,
      voucher_no,
      data_environment,
      tenant_id
    )
    values (
      v_voucher_date,
      v_entry_description,
      v_request.entity_id,
      v_request.department_code,
      v_entry_debit,
      v_entry_credit,
      v_entry_account,
      v_entry_name,
      v_request.no,
      v_entry_key,
      'expense_request',
      v_request.id,
      v_request.no,
      p_voucher_no,
      v_environment,
      v_tenant_id
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'voucher_id', p_voucher_id
  );
end;
$function$;
