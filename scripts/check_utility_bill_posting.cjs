'use strict';
// Executes the shipped doConfirmVoucher handler in a network-free VM. The
// already-authorized workflow/period gates, DOM and persistence boundaries are
// fixtures; tax, principal, settlement and entry-construction code stays real.
// No Playwright, database, credentials or production service is required.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function functionSource(name){
 const marker='function '+name+'(',start=source.indexOf(marker);assert.ok(start>=0,'real function exists: '+name);
 const opening=source.indexOf('{',start);let depth=0;
 for(let i=opening;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);}
 throw new Error('Unclosed real function: '+name);
}
const handlerStart=source.indexOf('window.doConfirmVoucher=async function(');
const handlerEnd=source.indexOf('\n};\n\n// ══ FIX 2',handlerStart);
assert.ok(handlerStart>=0&&handlerEnd>handlerStart,'exact real finalization handler boundaries');
const handler=source.slice(handlerStart,handlerEnd+4);
const helperNames=[
 'accountingUtilityBillDetected','accountingLaborFeeDetected','accountingManualFieldNames','accountingLineManualFields','accountingLineFieldIsHuman',
 'lazyHasValue','normalizeLazyTaxMode','lazyTaxMode','lazyAmountParts','requestTaxAmount','requestGrossAmount','requestNetTaxSplit',
 'requestLedgerPostedAt','requestPostingLocked','requestApprovalStepCompleted','approvedStepCount','requestWorkflowStepCount',
 'advanceOriginalAmount','advanceActualAmount','advanceSettlementInfo','expensePostingAmount','accountingLineIsSystemFee','principalAccountingLines'
];
// The release owner may extract entry construction to a named real helper.
// Keep this list explicit so an absent implementation fails, never substitutes
// a test copy of the production algorithm.
const extraHelpers=['advanceUsesUtilityAccountingLines','advanceFinalAccountingHtml','advanceFinalAccountOptions'];
const accounts=Object.fromEntries([['6202','水電費'],['6201','文具用品'],['6207','修繕費'],['1112','銀行存款'],['1191','暫付款'],['1144','進項稅額']].map(([c,n])=>[c,{c,n}]));
function makeLine(description,net,tax,account){return {id:'line_'+account,description,netAmount:net,taxAmount:tax,grossAmount:net+tax,debitAccount:account,debitAccountName:accounts[account].n,creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'D1',manualFields:['netAmount','taxAmount','grossAmount'],manualOverride:true,valueAuthority:'human'};}
function makeContext(spec){
 const actual=spec.lines.reduce((n,x)=>n+x.grossAmount,0),id='fictional-'+spec.name;
 const r={id,no:'LOCAL-'+spec.name,type:'advance_request',tL:'預支申請',app:'虛構申請人',eid:'E1',dc:'D1',status:'pending_voucher',amt:spec.principal,estimatedAmt:spec.principal,actualAmt:actual,dr:'6202',drN:'水電費',cr:'1112',crN:'銀行存款',steps:[{rk:'applicant_submit',a:'approved'},{rk:'accountant_final',a:''}],formPayload:{advanceOriginalAmount:spec.principal,advanceFinalAmount:actual,accountingLines:clone(spec.lines),lazyRows:[{item:'水費',netAmount:130,taxAmount:6,grossAmount:136,taxMode:'gross_inclusive'}]}};
 if(spec.noUtility)r.formPayload.lazyRows=[{item:'文具',netAmount:1000,taxAmount:50,grossAmount:1050,taxMode:'gross_inclusive'}];
 const trace={serial:[],rpc:[],alerts:[],remembered:[],writes:[],errors:[]};
 const dom={'advance-final-amt':{value:spec.finalAmount===undefined?actual:spec.finalAmount},'advance-final-dr':{value:spec.finalAccount||'6202'},'advance-final-settlement-confirm':{checked:true}};
 const c={window:{},console:{log(){},warn(){},error(e){trace.errors.push(e&&e.message||String(e));}},Date,Math,JSON,Set,Map,Number,
  BUSINESS_TAX_RATE:0.05,num:v=>Number(v||0),fmt:v=>String(v),cloneSettingValue:clone,
  S:{demoLogin:true,user:{id:'fictional-accountant',n:'虛構會計',role:'accountant'}},REQS:[r],POSTING_IN_FLIGHT:{},VOUCHERS:[],LEDGER:[],
  loadExpensePostingPending:()=>null,expensePostingIdentity:()=>'anonymous-tax-fixture',withOperationTimeout:async p=>p,
  el:id=>dom[id]||null,alert:message=>trace.alerts.push(message),canActRequest:()=>true,requestLedgerRowsExist:()=>false,ensureOpenPostingPeriod:()=>true,
  purchaseReadyForFinalAccounting:()=>({ok:true}),pettyReadyForFinalAccounting:()=>({ok:true}),advanceReadyForFinalAccounting:()=>({ok:true}),
  approvalActionPayload:async()=>({comment:'本機虛構覆核',files:[],addUid:''}),approvalActionPreflight:()=>true,hasVisibleAccountingInputs:()=>false,
  rememberAccountingReviewDraft:r=>trace.remembered.push(clone(r)),
  accountByCode:code=>accounts[code]||null,advanceDefaultFinalDebitCode:()=>'6202',expenseDebitAccounts:()=>Object.values(accounts).filter(x=>/^6/.test(x.c)),
  uploadApprovalFiles:async p=>p,
  // Step authorization/progression has its own tests. Complete the synthetic
  // last step so this test reaches the real finalization implementation.
  approveActiveStep:r=>{r.steps.at(-1).a='approved';r.status='completed';},
  todayIso:()=>'2026-09-09',todaySlash:()=>'2026/09/09',requestBankFeeAmount:()=>15,
  nextVoucherNo:async(...args)=>{trace.serial.push(args);return 'LOCAL-V-'+spec.name;},
  callAccountingRpc:async(name,args)=>{trace.rpc.push({name,args:clone(args)});return {ok:true,data:{idempotent:false,voucher_id:args.p_voucher_id}};},
  gE:()=>({s:'虛構照護公司'}),activeDataEnvironment:()=>'test',ledgerPostingKey:v=>v,
  pushNotification(){},persistAccountingLinesRemote:async r=>{trace.writes.push({kind:'lines',lines:clone(r.formPayload.accountingLines)});return {ok:true};},
  dbInsert:async(table,row)=>{trace.writes.push({table,row:clone(row)});return {ok:true};},notifDbRow:x=>x,
  saveLocalAppStateSoon(){},buildAll(){},openDetail(){},hasSupabase:()=>false,
  fetch:()=>{throw new Error('Network is forbidden in this VM');}
 };
 vm.createContext(c);vm.runInContext([...helperNames,...extraHelpers].map(functionSource).join('\n')+'\n'+handler,c,{filename:'actual-finance-finalization.js'});
 return {c,r,trace,original:JSON.stringify(r),actual};
}
function totals(entries){const map={};for(const e of entries){const key=e.t+':'+e.ac;map[key]=(map[key]||0)+e.amt;}return map;}
const report=[];
(async()=>{
 const water=makeLine('水費11508',136,0,'6202'),paper=makeLine('一般文具',1000,50,'6201');
 const success=[];
 for(const principal of [100,136,200])success.push({name:'water-'+principal,lines:[water],principal});
 for(const principal of [1000,1186,1400])success.push({name:'mixed-'+principal,lines:[water,paper],principal});
 success.push({name:'ordinary-tax-60',lines:[water,makeLine('合法文具憑據',1000,60,'6201')],principal:1196});
 success.push({name:'ordinary-legacy-flow',lines:[paper],principal:1050,noUtility:true,finalAccount:'6207'});
 for(const spec of success){
  const {c,r,trace,actual}=makeContext(spec);
  const form=c.advanceFinalAccountingHtml(r,'advance-final');
  if(spec.noUtility){assert.match(form,/<select id="advance-final-dr">/,'ordinary advance keeps the account selector');assert.doesNotMatch(form,/依會計覆核明細逐筆入帳/);}
  else{assert.doesNotMatch(form,/<select id="advance-final-dr">/,'utility advance never displays an ineffective single-account selector');assert.match(form,/依會計覆核明細逐筆入帳/);assert.match(form,/advance-final-amt/);assert.match(form,/advance-final-settlement-confirm/);}
  await c.window.doConfirmVoucher(r.id);
  assert.deepEqual(trace.alerts,[],spec.name+' unexpected failure');assert.equal(trace.serial.length,1,spec.name+' reserves one number');assert.equal(trace.rpc.length,1,spec.name+' uses one finalization RPC');
  const call=trace.rpc[0];assert.equal(call.name,'finalize_expense_request');
  const expected={};
  for(const line of spec.lines){const account=spec.noUtility?spec.finalAccount:line.debitAccount;expected['dr:'+account]=(expected['dr:'+account]||0)+line.netAmount;if(line.taxAmount)expected['dr:1144']=(expected['dr:1144']||0)+line.taxAmount;}
  expected['cr:1191']=spec.principal;
  if(spec.principal>actual)expected['dr:1112']=spec.principal-actual;
  if(spec.principal<actual)expected['cr:1112']=actual-spec.principal;
  assert.deepEqual(totals(call.args.p_voucher_entries),expected,spec.name+' real handler respects each expense subject and settlement');
  assert.equal(call.args.p_amount,actual);assert.equal(call.args.p_bank_fee_amount,0,'disbursement fee is never paid twice');assert.equal(call.args.p_voucher_total,Math.max(actual,spec.principal));
  assert.equal(call.args.p_form_payload.lazyRows[0].taxAmount,spec.noUtility?50:6,'original receipt is preserved');
  assert.deepEqual(call.args.p_form_payload.accountingLines,spec.lines,'reviewed lines reach the finalizer unchanged');
  assert.equal(c.POSTING_IN_FLIGHT['request-ledger:'+r.id],undefined,'success releases lock');
  report.push({name:spec.name,entries:call.args.p_voucher_entries,amount:actual,principal:spec.principal});
 }
 const invalidCases=[
  {name:'invalid-water-tax',lines:[makeLine('水費11508',130,6,'6202')],principal:136,message:/水費|電費|水電/},
  {name:'detail-final-amount-mismatch',lines:[water,paper],principal:1186,finalAmount:1200,message:/明細合計.*最後實際支出金額不一致/}
 ];
 for(const invalid of invalidCases){
  const {c,r,trace,original}=makeContext(invalid);await c.window.doConfirmVoucher(r.id);
  assert.equal(trace.serial.length,0,invalid.name+' never reserves a voucher number');assert.equal(trace.rpc.length,0,invalid.name+' never calls an accounting RPC');assert.equal(trace.writes.length,0,invalid.name+' never writes a record');
  assert.equal(c.POSTING_IN_FLIGHT['request-ledger:'+r.id],undefined,'entry-construction rejection releases in-flight lock');
  assert.equal(JSON.stringify(r),original,'failed attempt preserves source request and raw human amounts');
  assert.ok(trace.alerts.some(x=>invalid.message.test(x)),'reviewer sees an actionable error');
  // A second invocation must retry validation, rather than getting stuck behind
  // the old in-flight lock or consuming a number on the retry.
  const firstAlerts=trace.alerts.length;await c.window.doConfirmVoucher(r.id);
  assert.equal(trace.alerts.length,firstAlerts+1);assert.equal(trace.serial.length,0);assert.equal(trace.rpc.length,0);
  assert.ok(!trace.alerts.some(x=>x.includes('此申請單正在入帳中')),'failed entry construction can be retried');
  report.push({name:invalid.name,serialCalls:0,rpcCalls:0,lockReleased:true,originalPreserved:true});
 }
 report.forEach(result=>console.log('PASS real doConfirmVoucher: '+result.name));
 console.log('OK: '+report.length+' utility/ordinary/refund/supplement/failure cases');
 const outputIndex=process.argv.indexOf('--output');
 if(outputIndex>=0){assert.ok(process.argv[outputIndex+1],'--output requires an evidence JSON path');fs.writeFileSync(path.resolve(process.argv[outputIndex+1]),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
