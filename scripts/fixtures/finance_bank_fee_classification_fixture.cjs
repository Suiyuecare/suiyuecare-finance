'use strict';
// Anonymous in-memory schema only. Actual reviewed revision SQL is unchanged;
// identity and future organization route are narrow fixture interfaces.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function createFixture(root=path.resolve(__dirname,'../..')){
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const fixture=read('scripts/check_finalize_accounting_lines_atomic.js');
  const marker="  const old=await create('baseline-drift')";assert.equal(fixture.split(marker).length,2);
  let prefix=fixture.slice(0,fixture.indexOf(marker)).replace(/^#![^\n]*\n/,'');
  prefix=prefix.replace('(async()=>{try{','return (async()=>{try{');
  const f=await new Function('require','__dirname','__filename',prefix+`return {db,admin,as,state,create,tenant,actorId,actorName,auth};}catch(e){await db.close();throw e;}})();`)(require,path.join(root,'scripts'),path.join(root,'scripts/check_finalize_accounting_lines_atomic.js'));
  const {db,admin,tenant,actorId}=f;
  try{
    await admin(`create schema extensions;create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then pg_catalog.sha256($1) else null end$$;
      alter table public.finance_users add column created_at timestamptz default now();
      alter table public.expense_requests add column payee text,add column bank_type text,add column bank_name text,add column bank_branch text,add column bank_no text,add column expected_pay_date date,add column bank_account text,add column fee_bearer text;
      create table private.finance_income_document_operations(tenant_id uuid not null,data_environment text not null,operation_type text not null,idempotency_key text not null,request_digest text not null,actor_finance_user_id text not null,operation_status text not null default 'in_progress',result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,primary key(tenant_id,data_environment,operation_type,idempotency_key));
      create function private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer) returns jsonb language plpgsql as $$begin
      if $1<>'${tenant}' or $2<>'${actorId}' or $3 not in ('payment_request','hr_expense_request','purchase_request') or $4<>'D1' or $8<>1 or jsonb_array_length($7)<>5 or $7->2->>'rk'<>'accountant' or $7->2->>'uid'<>'other' then raise exception 'Fixed anonymous route scope mismatch' using errcode='42501';end if;return $7;end$$;`);
    await admin(read('scripts/fixtures/finance_expense_revision_operations_20260912.sql'));
    const deps=read('scripts/fixtures/finance_correction_dependencies_20260907.sql');
    for(const name of ['finance_income_active_step_index','finance_income_step_role','finance_income_status_from_steps']){
      const m=deps.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?\\$function\\$;'));assert(m,name);await admin(m[0]);
    }
    await admin(read('scripts/fixtures/finance_expense_revision_runtime_20260912.sql'));
    const args='text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text';
    await admin(`revoke all on all functions in schema private from public,anon,authenticated,service_role;
      revoke all on function public.finance_expense_resubmit_applicant_revision(${args}) from public,anon,authenticated,service_role;
      grant execute on function public.finance_expense_resubmit_applicant_revision(${args}) to authenticated,service_role;`);
    await admin('insert into public.system_settings values($1,$2,$3)',[tenant,'bank_transfer_fees',JSON.stringify({E1:15})]);
    f.read=read;return f;
  }catch(e){await db.close();throw e;}
};

// Exercise the real HR normalization, collector and resubmit payload builder.
// Only DOM/configuration, attachment transport and page navigation are fixture
// interfaces; fee computations and the emitted RPC patch are production code.
module.exports.frontendHrRevision=async function frontendHrRevision(root,record,{rows=[],bearer='己方支出',setting=15,digital=false}){
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const clone=value=>JSON.parse(JSON.stringify(value));
  function extract(name){
    const marker='function '+name+'(',at=source.indexOf(marker);assert(at>=0,name);
    const start=source.slice(at-6,at)==='async '?at-6:at,open=source.indexOf('{',at);let depth=0;
    for(let i=open;i<source.length;i++){
      if(source[i]==='{')depth++;
      else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
    }
    throw new Error('Unclosed production function '+name);
  }
  const form={
    'nr-ent':{value:'E1'},'hr-bank-type':{value:'other'},'hr-fee-bearer':{value:bearer},
    'hr-period':{value:'2026-09'},'hr-labor-period':{value:'2026-09'},'nr-paydate':{value:'2026-09-12'},
    'nr-payee':{value:'Anonymous payee'},'nr-bank-name':{value:'非兆豐銀行'},
    'nr-bank-branch':{value:'Anonymous branch'},'nr-bank-no':{value:'TEST-ONLY'},'nr-fee-bearer':{value:bearer}
  };
  let emitted=null;
  const context=vm.createContext({
    console,BANK_TRANSFER_FEES:{E1:setting},BANK_TRANSFER_FEE:setting,
    S:{nrType:record.type,hrItem:digital?'labor_electronic':'salary_50',hrRows:clone(rows),nrFiles:[],nrRec:'receipt',nrPay:'bank',nrRevisionOriginalPassbookFiles:[]},
    REQS:[],window:{},el:id=>form[id]||null,financeFormEngine:()=>null,financeReportEngine:()=>null,
    currentUserEntityId:()=> 'E1',selectedBankType:()=> 'other',laborElectronicPlannedDates:()=> ['2026-09-12'],formFieldVisible:(_id,_key,fallback)=>fallback,
    formFieldRequired:(_id,_key,fallback)=>fallback,todayMonth:()=> '2026-09',
    cloneSettingValue:clone,expensePostingIdentity:()=>({fixture:true}),expenseTransactionIdentityCurrent:()=>true,
    loadExpenseRevisionPending:()=>null,expenseApplicantRevisionCurrentRecord:()=>record,
    expenseApplicantRevisionGuard:()=>({ok:true}),laborElectronicMarker:()=>digital,
    laborElectronicCached:()=>({fixture:true}),laborElectronicUninvited:()=>true,
    requestTypeLabel:()=> 'Anonymous HR',gE:()=>({full:'Anonymous company'}),gD:()=>({n:'Anonymous department'}),
    isLazyRequestType:()=>false,showSubmitConfirm:async()=>true,showActionFeedback:()=>{},
    prepareExpenseRevisionDetailExport:async()=>'',uploadExpenseRevisionDelta:async()=>({requestFiles:[],passbookFiles:[],stepFiles:[]}),
    expenseApplicantRevisionRpc:async(r,action,comment,patch,stepFiles)=>{assert.equal(action,'resubmit');assert.equal(r.id,record.id);emitted={patch:clone(patch),stepFiles:clone(stepFiles)};return{ok:true};},
    clearExpenseApplicantRevisionMode:()=>{},clearNRDirtyBaseline:()=>{},completeActionFeedback:()=>{},
    buildAll:()=>{},openApprovalTab:()=>{},alert:()=>{}
  });
  const constants=['HR_ITEMS','HR_DETAIL_COLS','HR_BANK_TRANSFER_COLS','HR_BANK_CODE_ALIASES'].map(name=>{
    const match=source.match(new RegExp('var '+name+'=\\[[\\s\\S]*?\\];'));assert(match,name);return match[0];
  });
  const names=['num','fmt','getBankTransferFee','hrItem','normalizeHrLaborType','normalizeHrMonthStrict',
    'hrSelectedPeriod','hrSelectedLaborPeriod','deriveHrExpensePeriod','isLaborHrItem','laborElectronicSelected',
    'hrPrivacyMode','hrBankTypeValue','hrFeeBearerValue','hrTransferFeePerRow',
    'hrDigitsOnly','hrLooksLikeBankAccountValue','hrRowAmount','hrNormalizeAmount','hrNormalizeTransferAmount',
    'normalizeHrAccountNumber','resolveHrPrivacyAccountAmount','hrExtractBankCode','hrBankNameFromCode',
    'hrCleanBankName','hrExtractBranchName','hrJoinNote','hrNormalizeTransferBankRow','hrNormalizeTransferRows','hrTransferRow',
    'hrTransferFieldKey','hrTransferFormId','hrTransferColumns','hrTransferColumnRequired',
    'hrRowIsMegaBank','hrTransferFeeForRow','hrTransferFeeRows','hrTransferFeeTotal','hrHasNonMegaTransferRows','hrRowsWithTransferFees',
    'collectHrExpenseInfo','collectPaymentInfo','submitExpenseApplicantRevisionFromForm'];
  vm.runInContext(constants.concat(names.map(extract)).join('\n'),context,{filename:'actual-frontend-hr-revision.js'});
  let info=null;
  if(digital){
    // Preserve the existing digital payload shape without exercising its separate
    // signing/invitation backend through the ordinary-expense fixture.
    info={digital:true,item:{id:'labor_electronic',label:'Electronic labor'},period:'2026-09',
      totalGrossCents:105000,serviceLines:[{id:'00000000-0000-4000-8000-000000000001',grossCents:105000}],
      plannedPaymentDates:['2026-09-12'],signerName:'Anonymous lecturer',inviteEmail:'lecturer@example.invalid',summary:'Anonymous digital fixture'};
  }else if(record.type==='hr_expense_request'){
    info=context.collectHrExpenseInfo();assert.deepEqual(clone(info.missing),[],'Fictional frontend form must be valid');
  }else{
    context.S.hrRows=[];context.S.hrItem='';
    context.S.lazyRows=[{item:'Anonymous item',total:1050}];
    if(bearer==='己方支出'&&setting)context.S.lazyRows.push({item:'銀行手續費（己方支出，免憑證）',qty:1,file:'免憑證',taxMode:'exempt',total:setting,grossAmount:setting,netAmount:setting,taxAmount:0,systemFee:true});
  }
  const sent=await context.submitExpenseApplicantRevisionFromForm({
    amount:info&&!info.digital?info.paymentTotal:1050,description:'Anonymous frontend revision',purpose:'Anonymous fee parity',note:'Fixture',
    hrInfo:info,isFixedExpense:false,requestDate:'2026-09-12',
    payment:context.collectPaymentInfo()
  });
  assert.equal(sent,true);assert(emitted,'Production form must emit its RPC patch');
  return emitted;
};
