#!/usr/bin/env node
'use strict';
// Real browser finalizer + current PostgreSQL finalizer/migrations, with only
// transport, DOM and anonymous identity interfaces replaced. No network/DB URL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function source(name){
  const re=new RegExp('^(?:async )?function '+name+'\\(','m'),m=re.exec(html);assert(m,name+' exists');
  const end=html.indexOf('\n}',m.index);assert(end>m.index,name+' ends');return html.slice(m.index,end+2);
}
const helpers=html.slice(html.indexOf('var EXPENSE_POSTING_PENDING={};'),html.indexOf('// FIX 1：自動切傳票',html.indexOf('var EXPENSE_POSTING_PENDING={};')));
const handlerStart=html.indexOf('window.doConfirmVoucher=async function('),handler=html.slice(handlerStart,html.indexOf('\n};',handlerStart)+3);
assert(helpers&&handler,'exact production finalizer implementation');
let passed=0;function check(label,condition=true){assert(condition,label);passed++;console.log('PASS '+label);}
async function runCases(f){
 const {db,admin,as,state,create,original,human,entries,tenant,actorId,actorName,auth}=f;
 await admin(fs.readFileSync(path.join(root,'supabase/migrations/20260908065050_finance_finalize_accounting_lines_atomic_v1.sql'),'utf8'));
 const correction=fs.readFileSync(path.join(root,'supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql'),'utf8').match(/CREATE (?:OR REPLACE )?FUNCTION private\.finance_correction_patch_v1\([\s\S]*?\$function\$;/i);
 assert(correction,'actual correction dependency');await admin(correction[0]);
 await admin(fs.readFileSync(path.join(root,'supabase/migrations/20260909083825_finance_utility_gross_expense_guard_v1.sql'),'utf8'));
 const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),short=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit'}).format(new Date());
 const line=human(original,{netAmount:1050,taxAmount:0});
 function map(row){return {...clone(row),eid:row.entity_id,dc:row.department_code,amt:Number(row.amount),tL:'付款申請',app:'匿名申請人',dr:row.debit_account,drN:row.debit_account_name,cr:row.credit_account,crN:row.credit_account_name,formPayload:clone(row.form_payload),voucherId:row.voucher_id,ledgerPostedAt:row.ledger_posted_at,postingLockedAt:row.posting_locked_at};}
 async function rpc(args,actor){
  await as(actor);const keys=['p_request_id','p_status','p_step','p_steps','p_amount','p_bank_fee_amount','p_voucher_id','p_voucher_no','p_entity_name','p_voucher_entries','p_voucher_total','p_voucher_description','p_voucher_date','p_form_payload'];
  const values=keys.map(k=>['p_steps','p_voucher_entries','p_form_payload'].includes(k)?JSON.stringify(args[k]):args[k]);
  const out=await db.query('select public.finalize_expense_request('+keys.map((_,i)=>'$'+(i+1)).join(',')+') result',values);return {data:out.rows[0].result,error:null};
 }
 function context(row,opts={}){
  const store=opts.store||new Map(),c={S:{user:{id:actorId,n:actorName,authUserId:auth},demoLogin:false},REQS:[map(row)],NOTIFS:[],VOUCHERS:[],LEDGER:[],POSTING_IN_FLIGHT:{},window:{},Date,Promise,Error,Number,Math,JSON,console:{error:()=>{},warn:()=>{}},alerts:[],calls:[],serials:0,uploads:0,notices:0,external:0,reloaded:0,upserts:0,pending:{},store};
  let callIndex=0;
  const client={rpc:async(name,args)=>{assert.equal(name,'finalize_expense_request');const i=callIndex++;c.calls.push(clone(args));if(opts.transport)return opts.transport({args,i,c,commit:()=>rpc(args,opts.actor)});return rpc(args,opts.actor);}};
  Object.assign(c,{
   setTimeout:(fn,ms)=>setTimeout(fn,ms>=5000?Math.min(ms,opts.timeoutMs||2500):ms),clearTimeout,
   getSb:()=>client,hasSupabase:()=>true,currentTenantId:()=>c.tenant||tenant,activeDataEnvironment:()=>c.env||'test',
   sessionGetItem:k=>store.get(k)||null,sessionSetItem:(k,v)=>{if(opts.storageFails)return false;store.set(k,v);return true;},sessionRemoveItem:k=>store.delete(k),
   cloneSettingValue:clone,num:v=>Number(v)||0,normalizeSettingValue:v=>v,normalizeFiles:clone,financeInlineJsString:v=>JSON.stringify(String(v)).replace(/"/g,'&quot;'),
   alert:v=>c.alerts.push(String(v)),friendlyErrorMessage:e=>e&&e.message||String(e),setTopSyncStatus:()=>{},
   requestPostingLocked:r=>!!(r.ledgerPostedAt||r.postingLockedAt),requestLedgerRowsExist:()=>false,
   canActStep:()=>true,approvalRecordReconcilePending:(_k,r)=>!!c.pending[r.id],approvalSetReconcilePending:(_k,ids,value)=>ids.forEach(id=>c.pending[id]=value),
   ensureOpenPostingPeriod:()=>true,allowLegacyClientFlowRepair:()=>false,
   purchaseReadyForFinalAccounting:()=>({ok:true}),pettyReadyForFinalAccounting:()=>({ok:true}),
   approvalActionPayload:async()=>opts.payloadWait?opts.payloadWait:({comment:'',files:[],addUid:''}),approvalActionPreflight:()=>true,
   hasVisibleAccountingInputs:()=>false,rememberAccountingReviewDraft:()=>{},expensePostingAmount:r=>r.amt,
   uploadApprovalFiles:async p=>{c.uploads++;return p;},todayShort:()=>short,todayIso:()=>date,todaySlash:()=>date.replace(/-/g,'/'),
   requestTaxAmount:()=>0,requestCashPostedAt:()=>new Date().toISOString(),requestBankFeeAmount:()=>0,entriesFromAccountingLines:r=>entries(r.formPayload.accountingLines,{...r,amount:r.amt}),
   nextVoucherNo:async()=>{c.serials++;return 'V_'+row.id;},gE:()=>({s:'匿名公司'}),fmt:String,
   invalidateDashboardFinancialCache:()=>{},buildAll:()=>{if(opts.buildFails)throw Error('UI rendering failed');},openDetail:()=>{},
   persistAccountingLinesRemote:async()=>{c.upserts++;throw Error('postcommit client source overwrite forbidden');},
   reloadRequestsByIds:async()=>{c.reloaded++;if(opts.readFails)throw Error('read network failure');const saved=await state(row.id);c.REQS=[map(saved)];return true;},
   notifDbRow:n=>n,dbInsertOnce:async()=>{c.notices++;if(opts.noticeIdentityChange)c.S.user={id:'other',authUserId:'other'};if(opts.noticeFails)throw Error('notification network failed');return{ok:true};},deliverExternalNotification:()=>{c.external++;},
   saveLocalAppStateSoon:()=>{throw Error('formal workflow cannot fall back locally');},callAccountingRpc:()=>{throw Error('formal handler must use recovery transaction');}
  });
  const funcs=['supabaseAuthErrorInfo','withOperationTimeout','expenseApplicantRevisionRpcErrorIsAmbiguous','canActRequest','flowStatusValue','flowIsTerminal','autoAdvanceDuplicateDeptManagerSteps','activeStep','activeStepIndex','requestApprovalStepCompleted','approvedStepCount','requestWorkflowStepCount','syncRequestStatus','markRequestCashPosted','appendStepAction','approveActiveStep'];
  vm.createContext(c);vm.runInContext(funcs.map(source).join('\n')+'\n'+helpers+'\n'+handler,c);return c;
 }
 async function fresh(id,opts={},extra={}){const r=await create('reliability-'+id,{form_payload:{accountingLines:[clone(line)]},...extra});return{r,c:context(r,opts)};}
 async function storedCount(id){await admin('select 1');return(await db.query('select (select count(*)::int from public.vouchers where request_id=$1) vouchers,(select count(*)::int from public.ledger_entries where source_id=$1) ledger',[id])).rows[0];}
 async function pristine(r){const saved=await state(r.id),n=await storedCount(r.id);assert.equal(saved.status,'pending_voucher');assert.deepEqual(saved.form_payload,r.form_payload);assert.equal(n.vouchers,0);assert.equal(n.ledger,0);}
 async function completed(r,c){const saved=await state(r.id),n=await storedCount(r.id);assert.equal(saved.status,'completed',JSON.stringify({alerts:c.alerts,calls:c.calls}));assert.equal(n.vouchers,1);assert.equal(n.ledger,2);assert.equal(c.upserts,0);assert.equal(c.POSTING_IN_FLIGHT['request-ledger:'+r.id],undefined);assert.deepEqual(saved.form_payload.accountingLines[0],line);return saved;}
 {
  const {r,c}=await fresh('lost-after-commit',{transport:async({i,commit})=>{const out=await commit();if(i===0)throw Object.assign(Error('Failed to fetch'),{code:'NETWORK_ERROR'});return out;}});
  await c.window.doConfirmVoucher(r.id);await completed(r,c);if(!c.alerts.some(x=>x.includes('未重複建立分錄')))console.log({alerts:c.alerts,calls:c.calls.length,serials:c.serials});check('Lost response after real commit is confirmed by identical idempotent retry',c.calls.length===2&&JSON.stringify(c.calls[0])===JSON.stringify(c.calls[1])&&c.serials===1&&c.alerts.some(x=>x.includes('未重複建立分錄')));
  check('Atomic server source is never overwritten by a postcommit accounting-line upsert',c.upserts===0);
  check('Completion notification preserves request routing and existing external delivery',c.NOTIFS[0].reqId===r.id&&c.NOTIFS[0].recordType==='expense_requests'&&c.external===1);
 }
 {
  const {r,c}=await fresh('timeout-before-commit',{timeoutMs:800,transport:async({i,commit})=>i===0?new Promise(()=>{}):commit()});
  await c.window.doConfirmVoucher(r.id);await completed(r,c);check('Never-resolving first dispatch times out and retries the exact voucher once',c.calls.length===2&&JSON.stringify(c.calls[0])===JSON.stringify(c.calls[1])&&c.serials===1);
 }
 {
  const {r,c}=await fresh('unknown-both',{timeoutMs:15,transport:async()=>new Promise(()=>{})});
  await c.window.doConfirmVoucher(r.id);await pristine(r);check('Two lost responses remain unknown and release the in-flight UI lock',c.calls.length===2&&!c.POSTING_IN_FLIGHT['request-ledger:'+r.id]&&c.alerts.some(x=>x.includes('不能判定失敗或完成')));
  const entry=c.loadExpensePostingPending(r.id);assert(entry);check('Frozen exact submission survives page reload in actor/tenant/environment session scope',c.store.size===1&&entry.args.p_voucher_id==='V_'+r.id);
  check('Other edits are blocked while a dedicated same-transaction recovery action remains reachable',!c.canActRequest(c.REQS[0])&&c.expensePostingRecoveryHtml(c.REQS[0]).includes('確認原入帳結果'));
  const foreignStore=new Map(c.store);const recovered=context(r,{store:c.store});await recovered.window.doConfirmVoucher(r.id);await completed(r,recovered);check('Reload recovery does not reserve a new serial or reupload files',recovered.serials===0&&recovered.uploads===0&&JSON.stringify(recovered.calls[0])===JSON.stringify(c.calls[0])&&recovered.store.size===0);
  const foreign=context(r,{store:foreignStore});assert(foreign.loadExpensePostingPending(r.id));foreign.S.user.id='other';check('A different actor cannot access another actor pending arguments',foreign.loadExpensePostingPending(r.id)===null);foreign.S.user.id=actorId;foreign.env='production';check('Pending retries cannot cross data environments',foreign.loadExpensePostingPending(r.id)===null);foreign.env='test';foreign.tenant='different';check('Pending retries cannot cross tenants',foreign.loadExpensePostingPending(r.id)===null);
 }
 {
  const {r,c}=await fresh('timeout-after-commit',{timeoutMs:800,transport:async({i,commit})=>{const out=await commit();return i===0?new Promise(()=>{}):out;}});await c.window.doConfirmVoucher(r.id);await completed(r,c);check('A timed-out response after commit replays safely against the real idempotent SQL branch',c.calls.length===2&&c.serials===1&&c.alerts.some(x=>x.includes('未重複建立分錄')));
 }
 for(const [name,opts]of [['malformed-null',{transport:async()=>({data:null,error:null})}],['malformed-ok',{transport:async()=>({data:{ok:true},error:null})}],['wrong-voucher',{transport:async()=>({data:{ok:true,idempotent:false,voucher_id:'wrong'},error:null})}]]){
  const {r,c}=await fresh(name,opts);await c.window.doConfirmVoucher(r.id);await pristine(r);check(name+' is never accepted as posting success',c.calls.length===2&&c.loadExpensePostingPending(r.id)&&!c.alerts.some(x=>x.includes('已完成入帳')));
 }
 for(const [name,opts]of [['unauthorized',{actor:'other'}],['anonymous',{actor:'anonymous'}]]){
  const {r,c}=await fresh(name,opts);await c.window.doConfirmVoucher(r.id);await pristine(r);check('True SQL '+name+' rejection is definitive and does not retry',c.calls.length===1&&!c.loadExpensePostingPending(r.id)&&!c.POSTING_IN_FLIGHT['request-ledger:'+r.id]);
 }
 {
  const {r,c}=await fresh('closed-period');await admin("insert into public.period_closes values($1,'test','E1',$2,'closed')",[tenant,date.slice(0,7)]);
  await c.window.doConfirmVoucher(r.id);await pristine(r);check('Closed-period guard still fails atomically before voucher/source writes',c.calls.length===1&&!c.loadExpensePostingPending(r.id));await admin('delete from public.period_closes');
 }
 {
  const {r,c}=await fresh('lost-then-denied',{transport:async({i,commit})=>{if(i===0){await commit();throw Error('Failed to fetch');}return{data:null,error:{code:'42501',message:'Permission revoked after first dispatch'}};}});
  await c.window.doConfirmVoucher(r.id);await completed(r,c);check('Permission error following a lost committed response stays unknown, never claimed rolled back',c.loadExpensePostingPending(r.id)&&c.alerts.some(x=>x.includes('不能判定失敗或完成'))&&c.notices===0);
 }
 {
  const {r,c}=await fresh('identity-switch',{transport:async({c,commit})=>{await commit();c.S.user={id:'other',authUserId:'other'};throw Error('Failed to fetch');}});
  await c.window.doConfirmVoucher(r.id);await completed(r,c);check('Account switch stops retry and does not notify or apply the prior user UI',c.calls.length===1&&c.notices===0&&c.reloaded===0&&c.alerts.length===0);
 }
 {
  const {r,c}=await fresh('storage-quota',{storageFails:true});await c.window.doConfirmVoucher(r.id);await pristine(r);check('Storage quota failure before dispatch leaves no finalizer RPC, unknown context or in-flight lock',c.calls.length===0&&!c.loadExpensePostingPending(r.id)&&!c.POSTING_IN_FLIGHT['request-ledger:'+r.id]&&c.alerts.some(x=>x.includes('尚未送出任何入帳交易')));
 }
 {
  const {r,c}=await fresh('notice-identity',{noticeIdentityChange:true});await c.window.doConfirmVoucher(r.id);await completed(r,c);check('Late notification acknowledgement cannot insert old actor notice into a new actor cache',c.NOTIFS.length===0&&c.external===0&&c.alerts.length===0);
 }
 {
  const {r,c}=await fresh('auth-lock-after-commit',{transport:async({c,commit})=>{const out=await commit();c.financeWorkspaceIdentityBlocked=true;return out;}});await c.window.doConfirmVoucher(r.id);await completed(r,c);check('Auth lock with unchanged identity stops old result UI/notification while preserving recoverable pending storage',c.alerts.length===0&&c.NOTIFS.length===0&&c.reloaded===0&&c.loadExpensePostingPending(r.id));
 }
 {
  const {r,c}=await fresh('read-auth-lock');let release;c.loadRowsByIdsForApprovalFallback=()=>new Promise(resolve=>release=resolve);c.mapReq=()=>{throw Error('blocked identity must not map source');};vm.runInContext(source('reloadRequestsByIds'),c);const before=JSON.stringify(c.REQS),work=c.reloadRequestsByIds([r.id]);c.financeWorkspaceIdentityBlocked=true;const rows=[{...r,status:'completed'}];rows.approvalLoadComplete=true;release(rows);assert.equal(await work,false);check('Auth lock with unchanged user prevents late expense readback cache merge',JSON.stringify(c.REQS)===before);
 }
 for(const [label,options]of [['notification failure',{noticeFails:true}],['readback failure',{readFails:true}],['UI failure',{buildFails:true}]]){
  const {r,c}=await fresh(label.replace(/ /g,'-'),options);await c.window.doConfirmVoucher(r.id);await completed(r,c);check(label+' cannot invalidate acknowledged atomic posting or retain the button lock',c.calls.length===1&&c.alerts.some(x=>x.includes('已完成入帳'))&&!c.alerts.some(x=>x.includes('尚未入帳')));
 }
 {
  let resolve;const payloadWait=new Promise(r=>resolve=r),{r,c}=await fresh('double-click',{payloadWait});const first=c.window.doConfirmVoucher(r.id);await c.window.doConfirmVoucher(r.id);resolve({comment:'',files:[],addUid:''});await first;await completed(r,c);check('Lock precedes the first await, blocking two simultaneous clicks before attachment parsing',c.calls.length===1&&c.serials===1&&c.uploads===1&&c.alerts.some(x=>x.includes('請勿重複送出')));
 }
 {
  const {r,c}=await fresh('pending-stale-human');const next=human(line,{debitAccount:'6207'});c.REQS[0].formPayload.accountingLines=[{...clone(next),manualOverrideHistory:[]}];await c.window.doConfirmVoucher(r.id);await pristine(r);check('Frozen human audit integrity remains enforced by current SQL',c.calls.length===1&&!c.loadExpensePostingPending(r.id));
 }
 {
  const {r,c}=await fresh('voucher-conflict');await admin("insert into public.vouchers(id,no,request_id) values($1,$1,'other-source')",['V_'+r.id]);await c.window.doConfirmVoucher(r.id);await pristine(r);check('Late voucher insert failure rolls back source/accounting rows and cannot fake completion',c.calls.length===1&&!c.loadExpensePostingPending(r.id));
 }
 // Exact runtime read helper: a response from a prior identity or environment
 // must not contaminate the newly selected workspace before the caller notices.
 {
  const {r,c}=await fresh('read-identity');let release;c.approvalFastBootstrapIdentity=()=>c.S.user.id+'|'+c.env;c.loadRowsByIdsForApprovalFallback=()=>new Promise(resolve=>release=resolve);c.mapReq=map;c.approvalRowsMarkVerified=()=>{throw Error('old user rows must never be marked trusted');};c.approvalRowsMarkUnavailable=()=>{};
  vm.runInContext(source('reloadRequestsByIds'),c);const old=clone(c.REQS);const wait=c.reloadRequestsByIds([r.id]);c.S.user.id='changed';const rows=[{...r,status:'completed'}];rows.approvalLoadComplete=true;release(rows);assert.equal(await wait,false);check('Readback identity race cannot overwrite a new user request cache',JSON.stringify(c.REQS)===JSON.stringify(old));
 }
 {
  let resolve;const payloadWait=new Promise(r=>resolve=r),{r,c}=await fresh('switch-before-dispatch',{payloadWait});const wait=c.window.doConfirmVoucher(r.id);c.S.user.id='other';resolve({comment:'',files:[],addUid:''});await wait;await pristine(r);check('Identity change while parsing attachments prevents all uploads and posting dispatch',c.uploads===0&&c.calls.length===0&&c.serials===0&&!c.POSTING_IN_FLIGHT['request-ledger:'+r.id]);
 }
 // Real shared approval retry functions: malformed/unknown transport is never
 // converted to success by a changed step, and a retry uses the same key.
 for(const scenario of ['hang','malformed','denied-after-unknown','identity','readback-hang','definitive-denial']){
  const {r,c}=await fresh('step-'+scenario,{timeoutMs:15});c.approvalRowsMarkUnavailable=()=>{};c.recordOpsEvent=()=>{};c.formatStorageUploadError=e=>e.message;
  vm.runInContext(['callFinanceMutationRpcOnce','financeMutationPayloadMatches','markFinanceMutationResultUnknown','financeMutationRpcWithAmbiguousRetry'].map(source).join('\n'),c);
  const args={p_request_ids:[r.id],p_idempotency_key:'one-frozen-key'},calls=[];
  const call=()=>{calls.push(clone(args));if(scenario==='identity'){c.S.user.id='changed';return Promise.reject(Error('Failed to fetch'));}if(scenario==='definitive-denial')return{data:null,error:{code:'42501',message:'Unauthorized'}};if(scenario==='malformed'&&calls.length===1)return{data:null,error:null};if(calls.length===1||scenario==='readback-hang')return new Promise(()=>{});if(scenario==='denied-after-unknown')return{data:null,error:{code:'42501',message:'Permission changed'}};return{data:{ok:true,count:1},error:null};};
  const out=await c.financeMutationRpcWithAmbiguousRetry('finance_expense_act_active_step',args,1,()=>scenario==='readback-hang'?new Promise(()=>{}):Promise.resolve(true),{key:args.p_idempotency_key,slot:'fixture'},{kind:'expense',ids:[r.id],label:'申請單簽核'},call);
  if(['hang','malformed'].includes(scenario)){assert(out.retried&&out.response.data.ok);assert.deepEqual(calls,[args,args]);}
  else if(scenario==='identity'){assert(out.identityChanged&&out.unknown);assert.equal(calls.length,1);assert.equal(c.S.incomeApprovalReconcileContext,undefined);}
  else if(scenario==='definitive-denial'){assert.equal(out.response.error.code,'42501');assert.equal(calls.length,1);}
  else{assert(out.unknown);assert.equal(c.S.incomeApprovalReconcileContext.key,args.p_idempotency_key);assert.equal(c.pending[r.id],true);}
  check('Shared active-step recovery: '+scenario+' preserves the exact transaction and truthful result');
 }
 console.log('OK: '+passed+' expense posting handler + real PostgreSQL reliability checks passed');
}
const fixture=fs.readFileSync(path.join(__dirname,'check_finalize_accounting_lines_atomic.js'),'utf8'),marker="  const old=await create('baseline-drift')";
assert.equal(fixture.split(marker).length,2,'reviewed fixture setup anchor');
const setup=fixture.slice(0,fixture.indexOf(marker)).replace(/^#![^\n]*\n/,'');
new Function('require','__dirname','__filename','runCases',setup+`await runCases({db,admin,as,state,create,original,human,entries,tenant,actorId,actorName,auth});}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.stack});process.exitCode=1;});`)(require,__dirname,__filename,runCases);
