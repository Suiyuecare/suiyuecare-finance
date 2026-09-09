#!/usr/bin/env node
'use strict';
// Execute the real reviewed finalizer/dependencies on the existing anonymous
// PGlite fixture schema. Reuse only its setup/helpers; replace its test body.
// No application server, credentials, network client or operational DB is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'check_finalize_accounting_lines_atomic.js'),'utf8');
const marker="  const old=await create('baseline-drift')";
assert.equal(fixture.split(marker).length,2,'reviewed finalizer fixture setup anchor');
const setup=fixture.slice(0,fixture.indexOf(marker)).replace(/^#![^\n]*\n/,'');
const body=String.raw`
  const utilityMigration=read('supabase/migrations/20260909083825_finance_utility_gross_expense_guard_v1.sql');
  await db.query("update public.system_settings set value=value||'[ {\"c\":\"6202\",\"n\":\"Utilities\",\"on\":true} ]'::jsonb where key='accounts'");
  const bad={...clone(original),description:'115年8月電費',debitAccount:'6202',debitAccountName:'Utilities'};
  const good={...clone(bad),netAmount:1050,taxAmount:0};
  const legacy=await create('legacy-water',{form_payload:{accountingLines:[bad],untouched:'kept'}});
  const legacyHumanLine=human(bad,{taxAmount:45,netAmount:1005});
  const legacyHuman=await create('legacy-human-water',{form_payload:{accountingLines:[legacyHumanLine]}});
  const history=await create('historical-water',{status:'completed',ledger_posted_at:'2026-09-01T00:00:00Z',posting_locked_at:'2026-09-01T00:00:00Z',form_payload:{accountingLines:[bad]}});
  const legacyAdvances=[];
  for(const principal of [100,136,200]){
    const id='legacy-advance-water-'+principal,advanceNo='ADV_'+id,at=new Date().toISOString();
    const oldLine=human({...clone(bad),grossAmount:136,netAmount:129,taxAmount:7},{netAmount:130,taxAmount:6});
    const r=await create(id,{type:'advance_request',amount:principal,estimated_amount:principal,actual_amount:136,cash_posted_at:at,actual_files:[{path:'receipt'},{path:'proof'}],form_payload:{accountingLines:[oldLine],lazyRows:[{item:'水費11508',grossAmount:136,netAmount:130,taxAmount:6}],advanceDisbursementVoucherId:advanceNo,advanceDisbursementPostedAt:at,advanceDisbursementAmount:principal,advanceDisbursementBankFee:0}});
    const es=[{t:'dr',ac:'1191',an:'Advance',dept:'D1',amt:principal},{t:'cr',ac:'1112',an:'Bank',dept:'D1',amt:principal}];
    await admin('insert into public.vouchers(id,no,request_id,entity_id,entries,total,posted,posted_at,tenant_id,data_environment) values($1,$1,$2,$3,$4,$5,true,$6,$7,$8)',[advanceNo,id,'E1',JSON.stringify(es),principal,at,tenant,'test']);
    for(const [i,e]of es.entries())await db.query('insert into public.ledger_entries(tenant_id,data_environment,voucher_no,source_type,source_id,reference_no,entity_id,department_code,posting_key,account_code,account_name,debit,credit) values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12)',[tenant,'test',advanceNo,'advance_disbursement',id,'E1','D1','tenant:'+tenant+':advance_disbursement:'+id+':'+(i+1),e.ac,e.an,e.t==='dr'?e.amt:0,e.t==='cr'?e.amt:0]);
    legacyAdvances.push({r,oldLine,principal});
  }
  await db.exec('begin;'+migration+'\ncommit;');
  const acl=(await db.query("select proacl from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure")).rows[0].proacl;
  const correctionSource=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql').match(/create function private\.finance_correction_patch_v1\([\s\S]*?\$function\$;/)[0];await db.exec(correctionSource+"revoke all on function private.finance_correction_patch_v1(public.expense_requests,jsonb,text) from public,anon,authenticated,service_role");
  await db.exec('begin;'+utilityMigration+'\ncommit;');
  check('Utility migration preserves the existing finalizer execute ACL',JSON.stringify((await db.query("select proacl from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure")).rows[0].proacl)===JSON.stringify(acl));
  assert.deepEqual((await state(history.id)).form_payload,history.form_payload);check('Historical posted request is not backfilled');
  const classifierCases=[
    [{item:'水費11508'},true],[{description:'115年8月電費'},true],[{label:'水電費'},true],[{itemName:'水 電 費'},true],
    [{item:'\u3000\u00a0\ufeff',description:'水\n費'},true],[{item:'文具',description:'水費'},false],
    [{item:'瓦斯費',debitAccount:'6202'},false],[{description:'電費瓦斯合併帳單'},false],[{item:'郵電費'},false],
    [{item:'電信電費'},false],[{item:'電話電費'},false],[{item:'水電工程'},false],[{item:'水電費修繕'},false],
    [{item:'電費維修'},false],[{item:'水費安裝'},false],[{item:'電費材料'},false],[{item:'水費設備'},false],
    [{item:'電費補助'},false],[{item:'水費補貼'},false],[{item:'飲水機水費'},false],[{item:'電腦電費'},false],
    [{description:'自來水公司水費'},true],[{description:'台電電費'},true],[{description:'設備',itemName:'水費'},false],
    [{debitAccount:'6202',debitAccountName:'水電瓦斯費',description:'其他用途'},false],
    [{description:'電費',debitAccount:'6299'},true],[{item:'台電'},false],[{},false]
  ];
  const ui=read('index.html'),start=ui.indexOf('function accountingUtilityBillDetected('),end=ui.indexOf('\n}',start)+2;assert(start>0&&end>start);const frontend=new Function(ui.slice(start,end)+';return accountingUtilityBillDetected;')();
  for(const [row,expected] of classifierCases){const actual=(await db.query('select private.finance_utility_line_v1($1::jsonb) result',[JSON.stringify(row)])).rows[0].result;assert.equal(actual,expected,JSON.stringify(row));assert.equal(frontend(row),actual,'JS/SQL classifier parity '+JSON.stringify(row));}
  check('All 28 agreed classifier inclusion, exclusion, precedence and Unicode cases pass');
  await admin("update public.expense_requests set description='Unrelated note',updated_at=now() where id=$1",[legacy.id]);
  await admin("update public.expense_requests set form_payload=form_payload||'{\"note\":\"Unrelated note\"}'::jsonb where id=$1",[legacy.id]);
  check('Unchanged legacy accounting lines allow note and status metadata updates',(await state(legacy.id)).form_payload.accountingLines[0].taxAmount===50);
  await admin("update public.expense_requests set form_payload=form_payload||'{\"syncNote\":\"historical metadata\"}'::jsonb where id=$1",[history.id]);
  check('Historical posted metadata sync remains allowed',(await state(history.id)).form_payload.accountingLines[0].taxAmount===50);
  await deny('New utility accounting line with positive tax is denied',()=>create('new-positive-utility',{form_payload:{accountingLines:[bad]}}),['23514']);
  await deny('Utility net must equal gross even with zero tax',()=>create('new-invalid-net',{form_payload:{accountingLines:[{...good,netAmount:1000}]}}),['23514']);
  await deny('Utility debit account cannot smuggle gross amount into 1144',()=>create('new-tax-account',{form_payload:{accountingLines:[{...good,debitAccount:'1144'}]}}),['23514']);
  await deny('New manually authoritative utility tax is denied without erasing history',()=>create('new-manual-utility',{form_payload:{accountingLines:[legacyHumanLine]}}),['23514']);
  const freshBad=human(legacyHumanLine,{taxAmount:50,netAmount:1000});
  await deny('Saved human utility tax needs a compliant fresh review',()=>admin("update public.expense_requests set form_payload=jsonb_build_object('accountingLines',$2::jsonb) where id=$1",[legacyHuman.id,JSON.stringify([freshBad])]),['23514']);
  assert.deepEqual((await state(legacyHuman.id)).form_payload.accountingLines[0],legacyHumanLine);check('Rejected human edit preserves the complete old event chain');
  const humanFixed=human(legacyHumanLine,{netAmount:1050,taxAmount:0});
  await admin("update public.expense_requests set form_payload=jsonb_build_object('accountingLines',$2::jsonb) where id=$1",[legacyHuman.id,JSON.stringify([humanFixed])]);
  const humanSaved=(await state(legacyHuman.id)).form_payload.accountingLines[0];
  check('Fresh human zero-tax review is saved with the full old history',humanSaved.taxAmount===0&&humanSaved.netAmount===1050&&humanSaved.manualOverrideHistory.length===2);
  const proposal=(line)=>({amount:line.grossAmount,debit_account:line.debitAccount,debit_account_name:line.debitAccountName,credit_account:line.creditAccount,credit_account_name:line.creditAccountName,accounting_lines:[line],accounting_line_policy:'human_override_authoritative_v1'});
  await deny('Real correction proposal helper rejects positive utility tax before saving pending review',()=>admin('select private.finance_correction_patch_v1(jsonb_populate_record(null::public.expense_requests,$1::jsonb),$2::jsonb,$3)',[JSON.stringify(legacyHuman),JSON.stringify(proposal(freshBad)),actorId]),['23514']);
  const correctionGood=(await admin('select private.finance_correction_patch_v1(jsonb_populate_record(null::public.expense_requests,$1::jsonb),$2::jsonb,$3) patch',[JSON.stringify(legacyHuman),JSON.stringify(proposal(humanFixed)),actorId])).rows[0].patch;
  check('Real correction proposal helper retains fresh compliant human history',correctionGood.accounting_lines[0].taxAmount===0&&correctionGood.accounting_lines[0].manualOverrideHistory.length===2);
  const sameBad=await state(legacy.id);
  await deny('Finalization rejects an unchanged legacy positive-tax utility',()=>call(sameBad,[bad]),['23514']);await assertUntouched(sameBad);
  const sorted=(await admin("select tgname from pg_trigger where tgrelid='public.expense_requests'::regclass and not tgisinternal and tgtype&2=2 order by tgname"))[0].rows.map(r=>r.tgname);
  check('Utility guard runs after the real human-authority merge',sorted.indexOf('trg_zzz_finance_utility_expense_guard_v1')>sorted.indexOf('trg_zz_finance_preserve_human_accounting_authority'));
  for(const type of ['payment_request','expense_reimbursement','purchase_request','petty_cash_request']){
    const r=await create('utility-post-'+type,{type,debit_account:'6202',debit_account_name:'Utilities',bank_fee_amount:15,form_payload:{accountingLines:[good]},...(type==='purchase_request'?{actual_amount:1050,actual_files:[{path:'receipt'},{path:'proof'}]}:{})});
    await call(r,[good],{payload:{accountingLines:[good],purchaseFinalizedAmount:1050}});const saved=await state(r.id);
    const tally=(await db.query("select count(*) filter(where account_code='1144')::int tax_rows,sum(debit) filter(where account_code='6202') utility_expense from public.ledger_entries where source_id=$1",[r.id])).rows[0];
    const app=(await db.query('select payload from public.application_accounting_lines where request_id=$1',[r.id])).rows[0].payload;
    check(type+' real authenticated finalization posts gross expense, zero 1144 and matching saved lines',tally.tax_rows===0&&Number(tally.utility_expense)===1050&&app.taxAmount===0&&app.netAmount===1050&&JSON.stringify(app)===JSON.stringify(saved.form_payload.accountingLines[0]));
  }
  const gas={...clone(bad),description:'瓦斯費'};const gasReq=await create('gas-tax-retained',{form_payload:{accountingLines:[gas]}});await call(gasReq,[gas]);await admin('select 1');
  check('Nonutility gas sharing account 6202 keeps legitimate input tax',Number((await db.query("select sum(debit) amount from public.ledger_entries where source_id=$1 and account_code='1144'",[gasReq.id])).rows[0].amount)===50);
  const office={...clone(original),id:'line_2',description:'辦公用品'};
  const mixed=await create('mixed-tax',{amount:2100,form_payload:{accountingLines:[good,office],lazyRows:[{item:'水費',grossAmount:1050,netAmount:1000,taxAmount:50},{item:'辦公用品',grossAmount:1050,netAmount:1000,taxAmount:50}]}});await call(mixed,[good,office]);await admin('select 1');
  check('Mixed request retains only the nonutility 50 input tax',Number((await db.query("select sum(debit) amount from public.ledger_entries where source_id=$1 and account_code='1144'",[mixed.id])).rows[0].amount)===50);
  const aggregate={...clone(original),description:'採購最後實際支出'};
  const purchase=await create('collapsed-purchase',{type:'purchase_request',actual_amount:1050,actual_files:[{path:'receipt'},{path:'proof'}],form_payload:{accountingLines:[aggregate],lazyRows:[{item:'水費11508',grossAmount:1050,netAmount:1000,taxAmount:50}]}});
  await deny('Collapsed purchase description cannot hide saved water receipts',()=>call(purchase,[aggregate],{payload:{purchaseFinalizedAmount:1050,accountingLines:[aggregate]}}),['23514']);await assertUntouched(purchase);
  const validAggregate=human(aggregate,{netAmount:1050,taxAmount:0});await call(purchase,[validAggregate],{payload:{purchaseFinalizedAmount:1050,accountingLines:[validAggregate]}});check('Reviewed collapsed water purchase posts zero input tax',(await state(purchase.id)).status==='completed');
  for(const kind of ['water','mixed']){
    const id='advance-utility-'+kind,advanceNo='ADV_'+id,at=new Date().toISOString();
    const amount=kind==='mixed'?2100:1050;const raws=[{item:'水費',grossAmount:1050,netAmount:1000,taxAmount:50}];if(kind==='mixed')raws.push({item:'辦公用品',grossAmount:1050,netAmount:1000,taxAmount:50});
    const r=await create(id,{type:'advance_request',amount,estimated_amount:amount,actual_amount:amount,cash_posted_at:at,actual_files:[{path:'receipt'},{path:'proof'}],form_payload:{accountingLines:[],lazyRows:raws,advanceDisbursementVoucherId:advanceNo,advanceDisbursementPostedAt:at,advanceDisbursementAmount:amount,advanceDisbursementBankFee:0}});
    const originalEntries=[{t:'dr',ac:'1191',an:'Advance',dept:'D1',amt:amount},{t:'cr',ac:'1112',an:'Bank',dept:'D1',amt:amount}];
    await admin('insert into public.vouchers(id,no,request_id,entity_id,entries,total,posted,posted_at,tenant_id,data_environment) values($1,$1,$2,$3,$4,$5,true,$6,$7,$8)',[advanceNo,id,'E1',JSON.stringify(originalEntries),amount,at,tenant,'test']);
    for(const [i,e]of originalEntries.entries())await db.query('insert into public.ledger_entries(tenant_id,data_environment,voucher_no,source_type,source_id,reference_no,entity_id,department_code,posting_key,account_code,account_name,debit,credit) values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12)',[tenant,'test',advanceNo,'advance_disbursement',id,'E1','D1','tenant:'+tenant+':advance_disbursement:'+id+':'+(i+1),e.ac,e.an,e.t==='dr'?e.amt:0,e.t==='cr'?e.amt:0]);
    const args={amount,payload:{advanceFinalAmount:amount,advanceOriginalAmount:amount,advanceSettlementConfirmed:true,accountingLines:[]},entries:[{t:'dr',ac:'6202',amt:amount-100},{t:'dr',ac:'1144',amt:100},{t:'cr',ac:'1191',amt:amount}]};
    await deny('Advance '+kind+' rejects utility tax hidden in balanced entries',()=>call(r,[],args),['23514']);
    const expectedTax=kind==='mixed'?50:0;args.entries=[{t:'dr',ac:'6202',amt:amount-expectedTax},{t:'cr',ac:'1191',amt:amount}];if(expectedTax)args.entries.push({t:'dr',ac:'1144',amt:expectedTax});
    await call(r,[],args);check('Advance '+kind+' preserves settlement contract and only nonutility input tax',(await state(id)).status==='completed');
  }
  for(const {r,oldLine,principal}of legacyAdvances){
    const updated=human(oldLine,{netAmount:136,taxAmount:0});
    const es=[{t:'dr',ac:'6202',amt:136},{t:'cr',ac:'1191',amt:principal}];if(principal>136)es.push({t:'dr',ac:'1112',amt:principal-136});if(principal<136)es.push({t:'cr',ac:'1112',amt:136-principal});
    const payload={advanceFinalAmount:136,advanceOriginalAmount:principal,advanceSettlementConfirmed:true,accountingLines:[updated],cashAmount:999,accountingCorrection:{status:'applied'}};
    await deny('Advance '+principal+' stale manual tax change is denied',()=>call(r,[],{amount:136,entries:es,payload:{...payload,accountingLines:[{...oldLine,netAmount:136,taxAmount:0}]}}),['40001']);
    await deny('Advance '+principal+' forged reviewer is denied',()=>call(r,[],{amount:136,entries:es,payload:{...payload,accountingLines:[human(oldLine,{netAmount:136,taxAmount:0},'other')]}}),['40001']);
    await deny('Advance '+principal+' balanced but wrong expense subject is denied',()=>call(r,[],{amount:136,entries:es.map((e,i)=>i?e:{...e,ac:'6299'}),payload}),['23514']);
    await admin('update private.fixture_permissions set subjects=false where member_id=$1',[auth]);await deny('Advance '+principal+' subject permission deny remains enforced',()=>call(r,[],{amount:136,entries:es,payload}),['42501']);await admin('update private.fixture_permissions set subjects=true where member_id=$1',[auth]);
    const before=await state(r.id);assert.deepEqual(before.form_payload,r.form_payload);assert.equal(before.status,'pending_voucher');assert.equal((await db.query('select count(*)::int n from public.vouchers where request_id=$1',[r.id])).rows[0].n,1);check('Advance '+principal+' rejected edits preserve only original disbursement and old human history');
    await call(r,[updated],{amount:136,entries:es,payload});const saved=await state(r.id),app=(await db.query('select payload from public.application_accounting_lines where request_id=$1',[r.id])).rows[0].payload;
    assert.equal(saved.form_payload.accountingLines[0].taxAmount,0);assert.equal(saved.form_payload.accountingLines[0].netAmount,136);assert.equal(saved.form_payload.accountingLines[0].manualOverrideHistory.length,2);assert.deepEqual(app,saved.form_payload.accountingLines[0]);
    check('Advance '+principal+' saves current human zero-tax review atomically with refund/equal/supplement and preserves raw receipt',saved.status==='completed'&&saved.form_payload.lazyRows[0].taxAmount===6&&saved.form_payload.advanceSettlementDifference===136-principal&&saved.form_payload.cashAmount===undefined&&saved.form_payload.accountingCorrection===undefined);
    check('Advance '+principal+' posts full 136 water expense and no 1144',Number((await db.query("select sum(debit) amount from public.ledger_entries where source_id=$1 and account_code='6202'",[r.id])).rows[0].amount)===136&&(await db.query("select count(*)::int n from public.ledger_entries where source_id=$1 and account_code='1144'",[r.id])).rows[0].n===0);
  }
  {
    const id='advance-mixed-canonical',advanceNo='ADV_'+id,at=new Date().toISOString(),amount=2100;
    const second={...clone(office),debitAccount:'6207',debitAccountName:'Repairs'};
    const r=await create(id,{type:'advance_request',amount,estimated_amount:amount,actual_amount:amount,cash_posted_at:at,actual_files:[{path:'receipt'},{path:'proof'}],form_payload:{accountingLines:[good,second],lazyRows:[{item:'水費',grossAmount:1050,netAmount:1000,taxAmount:50},{item:'辦公用品',grossAmount:1050,netAmount:1000,taxAmount:50}],advanceDisbursementVoucherId:advanceNo,advanceDisbursementPostedAt:at,advanceDisbursementAmount:amount,advanceDisbursementBankFee:0}});
    const origEntries=[{t:'dr',ac:'1191',an:'Advance',dept:'D1',amt:amount},{t:'cr',ac:'1112',an:'Bank',dept:'D1',amt:amount}];
    await admin('insert into public.vouchers(id,no,request_id,entity_id,entries,total,posted,posted_at,tenant_id,data_environment) values($1,$1,$2,$3,$4,$5,true,$6,$7,$8)',[advanceNo,id,'E1',JSON.stringify(origEntries),amount,at,tenant,'test']);
    for(const [i,e]of origEntries.entries())await db.query('insert into public.ledger_entries(tenant_id,data_environment,voucher_no,source_type,source_id,reference_no,entity_id,department_code,posting_key,account_code,account_name,debit,credit) values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12)',[tenant,'test',advanceNo,'advance_disbursement',id,'E1','D1','tenant:'+tenant+':advance_disbursement:'+id+':'+(i+1),e.ac,e.an,e.t==='dr'?e.amt:0,e.t==='cr'?e.amt:0]);
    const reviewedOffice=human(second,{netAmount:990,taxAmount:60}),payload={advanceFinalAmount:amount,advanceOriginalAmount:amount,advanceSettlementConfirmed:true,accountingLines:[good,reviewedOffice]};
    await deny('Mixed advance cannot collapse distinct expense accounts into one header account',()=>call(r,[],{entries:[{t:'dr',ac:'6202',amt:2040},{t:'dr',ac:'1144',amt:60},{t:'cr',ac:'1191',amt:2100}],payload}),['23514']);
    await call(r,[],{entries:[{t:'dr',ac:'6202',amt:1050},{t:'dr',ac:'6207',amt:990},{t:'dr',ac:'1144',amt:60},{t:'cr',ac:'1191',amt:2100}],payload});const saved=await state(r.id);
    const exact=(await db.query('select account_code,debit,credit from public.ledger_entries where source_id=$1 and voucher_no=$2 order by account_code',[id,'V_'+id])).rows.map(e=>({...e,debit:Number(e.debit),credit:Number(e.credit)}));
    assert.deepEqual(exact,[{account_code:'1144',debit:60,credit:0},{account_code:'1191',debit:0,credit:2100},{account_code:'6202',debit:1050,credit:0},{account_code:'6207',debit:990,credit:0}]);
    check('Mixed advance preserves exact distinct subjects and the current nonutility human tax increase',saved.form_payload.accountingLines[1].taxAmount===60&&saved.form_payload.accountingLines[1].manualOverrideHistory.length===1&&saved.form_payload.accountingLines[0].taxAmount===0);
  }
  const initial=await create('initial-cash',{type:'petty_cash_request',petty_mode:'initial',form_payload:{accountingLines:[]},debit_account:'1111',debit_account_name:'Petty cash'});await call(initial,[],{entries:[{t:'dr',ac:'1111',amt:1050},{t:'cr',ac:'1112',amt:1050}]});check('Initial petty funding still uses the original asset-only contract',(await state(initial.id)).status==='completed');
  const denied=await create('unauthorized-utility',{form_payload:{accountingLines:[good]}});await deny('Non-accountant cannot use the finalizer',()=>call(denied,[good],{actor:'other'}),['42501']);await assertUntouched(denied);
  const fee=await create('fee-tamper',{form_payload:{accountingLines:[good]}});await deny('Locked bank-fee guard is retained',()=>call(fee,[good],{fee:9}),['23514']);await assertUntouched(fee);
  const closed=await create('closed-water',{form_payload:{accountingLines:[good]}});await admin("insert into public.period_closes values($1,'test','E1','2026-09','closed')",[tenant]);await deny('Closed-period guard is retained',()=>call(closed,[good],{date:'2026-09-09'}),['23514']);await assertUntouched(closed);await admin('delete from public.period_closes');
  // Recheck the deployed merge-history and final accounting contracts under
  // the new wrapper. Neither historical migration is edited or replaced.
  await admin('select 1');const audit=read('scripts/finance_approval_audit_postflight.sql'),hs=audit.indexOf(" select jsonb_agg(jsonb_build_object('operationId','saved-'"),he=audit.indexOf(' if not exists(select 1 from information_schema.columns',hs);assert(hs>0&&he>hs);await db.exec('do $$ declare v_history jsonb;v_old jsonb;v_event jsonb;v_new jsonb;v_result jsonb;v_conflict boolean:=false;begin\n'+audit.slice(hs,he)+'\nend;$$;');check('Deployed full human-history merge and stale revision postflight remain valid');
  await db.exec(read('scripts/finance_finalize_accounting_lines_postflight.sql').replace(/^\\set ON_ERROR_STOP on\s*/,''));check('Deployed final accounting postflight remains valid');
  await db.exec(read('scripts/finance_utility_tax_postflight.sql').replace(/^\\set ON_ERROR_STOP on\s*/,''));check('Repeatable read-only utility postflight passes');
  // Run the actual release canary text against anonymous identity/org fixtures.
  // The candidate SQL, role switch, finalizer and rollback checks are unmodified.
  await db.exec("create table auth.users(id uuid,email_confirmed_at timestamptz,is_anonymous boolean);create table auth.identities(user_id uuid,provider text);\n    create table public.finance_department_units(id uuid,tenant_id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);\n    create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);\n    alter table public.employee_department_roles add column metadata jsonb;\n    alter table public.expense_requests add column applicant_email text;\n    create table public.notification_delivery_events(request_id text,payload jsonb);\n    create table public.cash_movement_evidence_links(source_id text,source_no text);\n    create function public.finance_user_is_approval_identity_ready(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.finance_users where tenant_id=$1 and id=$2 and active and auth_user_id is not null)$$;\n    create function private.finance_org_effective_now_v2(jsonb) returns boolean language sql stable as $$select ($1->>'active')::boolean and ($1->>'effective_from')::date<=current_date and (($1->>'effective_to') is null or ($1->>'effective_to')::date>=current_date)$$;\n    create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.auth',true),''))::uuid$$;\n    create or replace function public.current_tenant_id() returns uuid language sql stable as $$select coalesce(nullif(current_setting('app.current_tenant_id',true),''),nullif(current_setting('test.tenant',true),''))::uuid$$;");
  await db.query('insert into auth.users values($1,now(),false);',[auth]);await db.query("insert into auth.identities values($1,'google')",[auth]);
  await db.query("insert into public.employee_department_roles values($1,$2,'D1','accountant',true,true,current_date,null,'{}')",[tenant,actorId]);
  await db.query("insert into public.finance_department_units values($1,$2,'J1101',true,true,true)",[auth,tenant]);await db.query("insert into public.finance_department_entity_scopes values($1,$2,'E6',true)",[tenant,auth]);
  const canary=read('scripts/finance_utility_tax_canary.sql'),out=await db.exec(canary.replace(/^\\set ON_ERROR_STOP on\s*/,''));assert.deepEqual(out.at(-1).rows[0].utility_tax_canary_result,{canary:'authenticated_utility_tax_v1',ok:true,rolled_back:true,utility_input_tax_absent:true});check('Actual authenticated release canary executes and rolls back every fixture row');
  await as();await deny('Private utility assertions are not directly callable by authenticated',()=>db.query("select private.finance_assert_utility_lines_v1('[]')"),['42501']);
  console.log('OK: '+tests+' utility gross-expense PostgreSQL checks passed');
}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,detail:e.detail,stack:e.stack});process.exitCode=1;});
`;
new Function('require','__dirname','__filename',setup+body)(require,__dirname,__filename);
