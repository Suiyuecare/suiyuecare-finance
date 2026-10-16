#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const createFixture=require('./fixtures/finance_bank_fee_classification_fixture.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));let checks=0,sequence=0;
const check=(label,value=true)=>{assert(value,label);checks++;console.log('PASS '+label);};
(async()=>{
 const f=await createFixture(root),{db,admin,as,state,create,tenant,actorId,actorName}=f;
 try{
  const stamp='2026-09-01T00:00:00.000Z',date='2026-09-12';
  const args='text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text';
  const signature='private.finance_expense_resubmit_applicant_revision_v1_unsafe('+args+')';
  const metadata=async()=>(await db.query("select md5(pg_get_functiondef(oid)) definition,proacl::text acl,proowner,proconfig,prosecdef,provolatile from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('_finance_bank_fee_classification_v1.sql'));assert.equal(migrations.length,1);
  const migration=f.read('supabase/migrations/'+migrations[0]);
  async function fresh(type='payment_request',extra={}){return create('bank-fee-'+(++sequence),{applicant_id:actorId,applicant:actorName,type,status:'pending_applicant_confirm',step:2,ver:1,updated_at:stamp,request_date:date,bank_fee_amount:0,form_payload:{},files:[],steps:[{rk:'applicant_submit',uid:actorId,a:'approved',files:[]},{rk:'applicant_revision',uid:actorId,a:'',files:[]},{rk:'accountant',uid:'other',a:'',status:'pending_accountant',files:[]},{rk:'admin_director',uid:'other',a:'',status:'pending_admin_director',files:[]},{rk:'ceo',uid:'other',a:'',status:'pending_ceo',files:[]}],...extra});}
  function patch({bank='非兆豐銀行',type='other',bearer='己方支出',fee=15,rows=null,feeRows=0}={}){
    const principal=rows?rows.reduce((n,r)=>n+Number(r['匯款金額']),0):1050;
    const p={amount:principal,description:'Anonymous bank fee revision fixture',payee:'Anonymous payee',bank_type:type,bank_name:bank,bank_branch:'Anonymous branch',bank_no:'TEST-ONLY',expected_pay_date:date,bank_account:bank,fee_bearer:bearer,request_date:date,files:[],petty_mode:null,form_payload:{requestPurpose:'Anonymous bank fee revision',requestNote:'Fixture',receiptType:'receipt',paymentType:'bank',isFixedExpense:false,is_fixed_expense:false,lazyRows:[{item:'Anonymous item',total:principal}],refundRows:[],purchaseRows:[],hrRows:rows||[],hrItem:'',pettyMode:'',passbookFiles:[],travelInfo:null,refundInfo:null,purchaseInfo:null,hrInfo:null}};
    if(rows){p.form_payload.lazyRows=[];p.form_payload.hrInfo={transferFeeBearer:bearer,transferFeeTotal:fee,transferFeeRows:feeRows,transferFeePerRow:bearer==='己方支出'?15:0,paymentTotal:principal,cashTotal:principal+fee,rows:clone(rows)};}
    else if(fee)p.form_payload.lazyRows.push({item:'銀行手續費（己方支出，免憑證）',qty:1,file:'免憑證',taxMode:'exempt',total:fee,grossAmount:fee,netAmount:fee,taxAmount:0,systemFee:true});
    return p;
  }
  async function call(r,p,{actor=actorId,key='fee-'+r.id,action='resubmit',version=r.ver}={}){await as(actor);return(await db.query('select public.finance_expense_resubmit_applicant_revision($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[r.id,action,key,version,stamp,1,'Anonymous revision',JSON.stringify(p),JSON.stringify([]),'test'])).rows[0].result;}
  async function denied(label,r,p,opts={}){let error;try{await call(r,p,opts);}catch(e){error=e;}assert(error&&['23514','42501','40001','22023','23505','55000'].includes(error.code),label+': '+(error&&error.message));const s=await state(r.id);assert.equal(s.ver,1);assert.equal(s.bank_fee_amount,r.bank_fee_amount);check(label);return error;}
  const hr=[{'銀行別':'非兆豐銀行','匯款金額':1050}];
  const old=await fresh('hr_expense_request');await denied('Old live helper reproduces rejection of a correct non-Mega HR fee',old,patch({rows:hr,feeRows:1}));
  await admin('select 1');const before=await metadata();assert.equal(before.definition,'5dedbec02d1440f855c69cdab2684515');
  const oldFingerprint=JSON.stringify(await state(old.id));await admin('begin;'+migration+'\ncommit;');const after=await metadata();
  check('Migration preserves private ACL, owner, security and search path',JSON.stringify({...before,definition:null})===JSON.stringify({...after,definition:null}));
  check('Migration never backfills an existing request',JSON.stringify(await state(old.id))===oldFingerprint);
  for(const [label,settings] of [
    ['negative Chinese',{bank:'非兆豐銀行'}],['negative spaced',{bank:'不是 兆豐銀行',type:''}],['negative English',{bank:'non-Mega Bank',type:''}],
    ['explicit other overrides legacy name',{bank:'兆豐銀行',type:'other'}],['explicit mega',{bank:'Anonymous bank',type:'mega',fee:0}],
    ['positive Chinese',{bank:'兆豐國際商業銀行',type:'',fee:0}],['positive English',{bank:'Mega Bank',type:'',fee:0}],['positive code',{bank:'017 Bank',type:'',fee:0}],
    ['other bank',{bank:'808 玉山銀行',type:'',fee:15}],['counterparty bears fee',{bearer:'對方支出',fee:0}]
  ]){const r=await fresh();const p=patch(settings);await call(r,p);const saved=await state(r.id);check(label+' stores derived bank fee exactly once',saved.bank_fee_amount===(settings.fee??15)&&saved.amount===1050&&saved.ver===2);const retry=await call(r,p);check(label+' identical retry is idempotent',retry.idempotent_replay===true&&(await state(r.id)).ver===2);}
  const hrCases=[
    ['negative Chinese',[{'銀行別':'非兆豐銀行','匯款金額':1050}],1,'other','己方支出'],
    ['negative English',[{'銀行別':'non mega','匯款金額':1050}],1,'other','己方支出'],
    ['mixed rows',[{'銀行代號':'017','銀行別':'兆豐銀行','匯款金額':500},{'銀行代號':'808','銀行別':'玉山銀行','匯款金額':550}],1,'other','己方支出'],
    ['empty row uses other batch',[{'匯款金額':1050}],1,'other','己方支出'],
    ['empty row uses Mega batch',[{'匯款金額':1050}],0,'mega','己方支出'],
    ['English Mega',[{'銀行別':'Mega Bank','匯款金額':1050}],0,'other','己方支出'],
    ['branch bank code',[{'銀行代號':'017-1234','匯款金額':1050}],0,'other','己方支出'],
    ['compact branch bank code',[{'銀行代號':'0171234','匯款金額':1050}],0,'other','己方支出'],
    ['account number is not bank code',[{'銀行別':'其他銀行','銀行帳號':'017 123456','匯款金額':1050}],1,'other','己方支出'],
    ['negative overrides inferred bank code',[{'銀行代號':'017','銀行別':'非兆豐銀行','匯款金額':1050}],1,'other','己方支出'],
    ['normalized English bank aliases',[{bank_code:'017',bank_name:'Mega Bank','匯款金額':1050}],0,'other','己方支出'],
    ['zero amount row excluded',[{'銀行別':'非兆豐銀行','匯款金額':0},{'銀行代號':'017','匯款金額':1050}],0,'other','己方支出'],
    ['counterparty',[{'銀行別':'非兆豐銀行','匯款金額':1050}],1,'other','對方支出']
  ];
  for(const [label,rows,feeRows,type,bearer] of hrCases){const fee=bearer==='己方支出'?feeRows*15:0,r=await fresh('hr_expense_request'),p=patch({rows,feeRows,type,bearer,fee});await call(r,p);const saved=await state(r.id);check('HR '+label+' uses row classification and payer',saved.bank_fee_amount===fee&&saved.amount===1050&&saved.form_payload.hrInfo.transferFeeTotal===fee);}
  const frontendRows=[
    {'銀行別':'非兆豐銀行','銀行代號':'808','分行名稱':'匿名分行','銀行帳號':'TEST-0000000000','金額':500},
    {'銀行別':'兆豐銀行','銀行代號':'017','分行名稱':'匿名分行','銀行帳號':'TEST-0000000001','金額':550}
  ];
  for(const [label,bearer,setting,expectedFee] of [
    ['own payer','己方支出',15,15],['counterparty','對方支出',15,0],
    ['configured zero fee','己方支出',0,0],['counterparty with zero fee','對方支出',0,0]
  ]){
    await admin("update public.system_settings set value=$1 where key='bank_transfer_fees'",[JSON.stringify({E1:setting})]);
    const r=await fresh('hr_expense_request'),emitted=await createFixture.frontendHrRevision(root,r,{rows:frontendRows,bearer,setting});
    const info=emitted.patch.form_payload.hrInfo;
    check('Actual frontend '+label+' records eligible transfer count even when company fee is zero',info.transferFeeRows===1&&info.transferFeeTotal===expectedFee);
    await call(r,emitted.patch);const saved=await state(r.id);
    check('Actual frontend '+label+' RPC is accepted and persists principal and fee once',saved.amount===1050&&saved.bank_fee_amount===expectedFee&&saved.form_payload.hrInfo.cashTotal===1050+expectedFee&&saved.ver===2);
    const retry=await call(r,emitted.patch);
    check('Actual frontend '+label+' RPC retry remains idempotent',retry.idempotent_replay===true&&(await state(r.id)).ver===2);
  }
  await admin("update public.system_settings set value=$1 where key='bank_transfer_fees'",[JSON.stringify({E1:15})]);
  const ordinary=await fresh(),ordinaryEmitted=await createFixture.frontendHrRevision(root,ordinary,{});
  check('Actual ordinary payment payload omits the digital-only reserved field',!Object.hasOwn(ordinaryEmitted.patch.form_payload,'electronicLabor'));
  await call(ordinary,ordinaryEmitted.patch);
  check('Actual ordinary payment form RPC persists principal and fee',(await state(ordinary.id)).bank_fee_amount===15&&(await state(ordinary.id)).amount===1050);
  const digital=await createFixture.frontendHrRevision(root,await fresh('hr_expense_request'),{digital:true});
  check('Actual digital form retains its electronic-labor payload shape',digital.patch.form_payload.hrInfo.digital===true&&digital.patch.form_payload.hrInfo.totalGrossCents===105000&&digital.patch.form_payload.electronicLabor.status==='pending_invite'&&digital.patch.form_payload.electronicLabor.totalGrossCents===105000&&digital.patch.form_payload.hrRows.length===0);
  for(const [label,opts] of [['anonymous',{actor:'anonymous'}],['other employee',{actor:'other'}],['stale version',{version:0}]]){await denied(label+' cannot revise fees',await fresh(),patch(),opts);}
  const bad=patch();bad.form_payload.lazyRows[1].total=99;await denied('Tampered fee row rejected',await fresh(),bad);
  const badHr=patch({rows:hr,feeRows:1});badHr.form_payload.hrInfo.transferFeeTotal=99;await denied('Tampered HR total rejected',await fresh('hr_expense_request'),badHr);
  await denied('Paid document cannot revise bank fees',await fresh('payment_request',{cash_posted_at:stamp}),patch());
  const cancellation=await fresh();await call(cancellation,{}, {action:'cancel'});check('Cancellation behavior remains unchanged',(await state(cancellation.id)).status==='cancelled');
  await admin('select 1');check('Revision never creates real payment or accounting rows',(await db.query('select (select count(*) from public.vouchers)+(select count(*) from public.ledger_entries) n')).rows[0].n===0);
  await as();let direct;try{await db.query('select '+signature.split('(')[0]+"('fixture','resubmit','key',1,now(),1,null,'{}','[]','test')");}catch(e){direct=e;}check('Private unsafe delegate remains inaccessible',direct&&direct.code==='42501');
  console.log(JSON.stringify({verified:true,checks,actualRevisionHelper:true,productionConnectionUsed:false,historyBackfilled:false}));
 }finally{await db.close();}
})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,detail:e.detail,stack:e.stack});process.exitCode=1;});
