#!/usr/bin/env node
'use strict';
// Actual applicant-revision browser code and live catalog RPC/cache snapshot.
// Anonymous local PGlite only. Auth and one fixed future-route snapshot are
// fixture interfaces; unchanged full organization route validation remains in
// the existing route-authority suite and authenticated protected-release canary.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),html=read('index.html'),clone=x=>JSON.parse(JSON.stringify(x));
function source(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(m,name);const end=html.indexOf('\n}',m.index);assert(end>m.index);return html.slice(m.index,end+2);}
const recovery=html.slice(html.indexOf('function expenseRevisionPendingStorageKey('),html.indexOf('async function expenseApplicantRevisionRpc('));
let passed=0;function check(label,yes=true){assert(yes,label);passed++;console.log('PASS '+label);}
async function runCases(f){
 const {db,admin,as,state,create,tenant,actorId,actorName,auth}=f;
 await admin(`create schema extensions;create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then pg_catalog.sha256($1) else null end$$;
 alter table public.finance_users add column created_at timestamptz default now();
 alter table public.expense_requests add column payee text,add column bank_type text,add column bank_name text,add column bank_branch text,add column bank_no text,add column expected_pay_date date,add column bank_account text,add column fee_bearer text;
 create table private.finance_income_document_operations(tenant_id uuid not null,data_environment text not null,operation_type text not null,idempotency_key text not null,request_digest text not null,actor_finance_user_id text not null,operation_status text not null default 'in_progress',result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,primary key(tenant_id,data_environment,operation_type,idempotency_key));
 create function private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer) returns jsonb language plpgsql as $$begin
 if $1<>'${tenant}' or $2<>'${actorId}' or $3<>'payment_request' or $4<>'D1' or $8<>1 or jsonb_array_length($7)<>5 or $7->2->>'rk'<>'accountant' or $7->2->>'uid'<>'other' then raise exception 'Fixed anonymous route scope mismatch' using errcode='42501';end if;return $7;end$$;`);
 await admin(read('scripts/fixtures/finance_expense_revision_operations_20260912.sql'));
 const deps=read('scripts/fixtures/finance_correction_dependencies_20260907.sql');
 for(const name of ['finance_income_active_step_index','finance_income_step_role','finance_income_status_from_steps']){const m=deps.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?\\$function\\$;'));assert(m,name);await admin(m[0]);}
 await admin(read('scripts/fixtures/finance_expense_revision_runtime_20260912.sql'));
 await admin("revoke all on function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) from public;grant execute on function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) to authenticated;revoke all on all functions in schema private from public,authenticated");
 await admin('insert into public.system_settings values($1,$2,$3)',[tenant,'bank_transfer_fees',JSON.stringify({E1:15})]);
 const stamp='2026-09-01T00:00:00.000Z',date='2026-09-12';
 function map(row){return {...clone(row),eid:row.entity_id,dc:row.department_code,app:row.applicant,applicantId:row.applicant_id,amt:Number(row.amount),desc:row.description,formPayload:clone(row.form_payload),updatedAt:row.updated_at,bankType:row.bank_type,bankName:row.bank_name,bankBranch:row.bank_branch,bankNo:row.bank_no,payee:row.payee,expectedPayDate:row.expected_pay_date,bankAcc:row.bank_account,feeBearer:row.fee_bearer,date:row.request_date,pettyMode:row.petty_mode,voucherId:row.voucher_id,ledgerPostedAt:row.ledger_posted_at,postingLockedAt:row.posting_locked_at};}
 const patch={amount:1050,description:'匿名補件測試內容',payee:'匿名收款人',bank_type:'mega',bank_name:'匿名銀行',bank_branch:'匿名分行',bank_no:'TEST-ONLY',expected_pay_date:date,bank_account:'anonymous fixture',fee_bearer:'',request_date:date,files:[],petty_mode:null,form_payload:{requestPurpose:'匿名補件測試',requestNote:'補充資料',receiptType:'receipt',paymentType:'bank',isFixedExpense:false,is_fixed_expense:false,lazyRows:[{item:'匿名文具',total:1050}],refundRows:[],purchaseRows:[],hrRows:[],hrItem:'',pettyMode:'',passbookFiles:[],travelInfo:null,refundInfo:null,purchaseInfo:null,hrInfo:null}};
 async function sql(args,actor){await as(actor);const keys=['p_request_id','p_action','p_idempotency_key','p_expected_ver','p_expected_updated_at','p_expected_active_step_index','p_comment','p_form_patch','p_step_files','p_data_environment'];return{data:(await db.query('select public.finance_expense_resubmit_applicant_revision('+keys.map((_,i)=>'$'+(i+1)).join(',')+') result',keys.map(k=>['p_form_patch','p_step_files'].includes(k)?JSON.stringify(args[k]):args[k]))).rows[0].result,error:null};}
 function ctx(row,options={}){
  const store=options.store||new Map(),c={window:{},S:{user:{id:actorId,n:actorName,authUserId:auth},demoLogin:false,nrRevisionRid:row.id},REQS:[map(row)],POSTING_IN_FLIGHT:{},INCOME_ACTION_RETRY_STATE:{},store,calls:[],alerts:[],cleanups:0,feedback:[],Date,Promise,JSON,Number,Math,Error,console};let n=0;
  const expected={id:row.id,no:row.no,eid:row.entity_id,dc:row.department_code,type:row.type,app:row.applicant,applicantId:actorId,ver:1,updatedAt:stamp,activeStepIndex:1};c.S.nrRevisionExpected=expected;
  const client={rpc:async(name,args)=>{assert.equal(name,'finance_expense_resubmit_applicant_revision');const i=n++;c.calls.push(clone(args));if(options.transport)return options.transport({args,i,c,commit:()=>sql(args,options.actor)});return sql(args,options.actor);}};
  Object.assign(c,{setTimeout:(fn,ms)=>setTimeout(fn,ms>=5000?Math.min(ms,options.timeoutMs||2000):ms),clearTimeout,getSb:()=>client,hasSupabase:()=>true,currentTenantId:()=>c.tenant||tenant,activeDataEnvironment:()=>c.env||'test',
   sessionGetItem:k=>store.get(k)||null,sessionSetItem:(k,v)=>{if(options.storageFails)return false;store.set(k,v);return true;},sessionRemoveItem:k=>store.delete(k),cloneSettingValue:clone,normalizeSettingValue:x=>x,normalizeFiles:x=>clone(x||[]),num:x=>Number(x)||0,stableSnapshotValue:x=>x,jsonArrayValue:x=>x||[],attachmentStoragePath:x=>x.path||'',
   allowLegacyClientFlowRepair:()=>false,canActRequest:r=>!c.loadExpenseRevisionPending()&&r.status==='pending_applicant_confirm',requestIsMine:r=>r.applicantId===c.S.user.id,canActStep:()=>true,requestPostingLocked:r=>!!r.ledgerPostedAt,
   incomeActionContext:(_kind,action)=>({key:'revision-frozen-'+row.id+'-'+action,slot:'slot-'+row.id}),clearIncomeActionContext:()=>{},
   readExpenseApplicantRevisionRow:async id=>{if(options.readFails)throw Error('Read failed');const saved=map(await state(id));c.REQS=[saved];return saved;},
   reloadRequestsByIds:async ids=>{if(options.readFails)throw Error('Read failed');c.REQS=[map(await state(ids[0]))];return true;},
   alert:x=>c.alerts.push(String(x)),friendlyErrorMessage:e=>e&&e.message||String(e),escAttr:x=>String(x).replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),
   clearExpenseApplicantRevisionMode:()=>{c.S.nrRevisionRid='';c.S.nrRevisionConfirmationPending=null;},clearNRDirtyBaseline:()=>{},completeActionFeedback:(title)=>c.feedback.push(title),buildAll:()=>{},openDetail:()=>{},openApprovalTab:()=>{},renderNRFList:()=>{},cleanupUploadedSupabaseAttachments:()=>{c.cleanups++;throw Error('outcome confirmation must not delete uploads');}
  });
  const functions=['stableSnapshotValue','expensePostingIdentity','expenseTransactionIdentityCurrent','supabaseAuthErrorInfo','withOperationTimeout','expenseApplicantRevisionRpcErrorIsAmbiguous','callExpenseApplicantRevisionRpcOnce','expenseApplicantRevisionGuard','expenseApplicantRevisionExpectedSnapshot','expenseRevisionFilePaths','expenseRevisionContainsFilePaths','expenseRevisionDateKey','expenseRevisionValueMatches','expenseApplicantRevisionPatchMatches','expenseApplicantRevisionReadbackCommitted','flowStatusValue','flowIsTerminal','autoAdvanceDuplicateDeptManagerSteps','activeStep','activeStepIndex','expenseApplicantRevisionRpc'];
  vm.createContext(c);vm.runInContext(functions.map(source).join('\n')+'\n'+recovery,c);return c;
 }
 async function fresh(label,options={},extra={}){const row=await create('revision-'+label,{applicant_id:actorId,applicant:actorName,status:'pending_applicant_confirm',step:2,ver:1,updated_at:stamp,request_date:date,form_payload:{},files:[{path:'old-proof.pdf',n:'原有憑據.pdf'}],steps:[{rk:'applicant_submit',uid:actorId,a:'approved',files:[]},{rk:'applicant_revision',uid:actorId,a:'',files:[]},{rk:'accountant',uid:'other',a:'',status:'pending_accountant',files:[]},{rk:'admin_director',uid:'other',a:'',status:'pending_admin_director',files:[]},{rk:'ceo',uid:'other',a:'',status:'pending_ceo',files:[]}],...extra});return{row,c:ctx(row,options)};}
 async function counts(id){await admin('select 1');return(await db.query("select (select count(*)::int from public.module_audit_logs where row_id=$1 and action like 'APPLICANT_REVISION_%') audit,(select count(*)::int from private.finance_income_document_operations where idempotency_key like '%'||$1||'%') operations,(select count(*)::int from public.vouchers where request_id=$1) vouchers,(select count(*)::int from public.ledger_entries where source_id=$1) ledger",[id])).rows[0];}
 async function unchanged(row){const saved=await state(row.id),n=await counts(row.id);assert.equal(saved.status,row.status);assert.equal(saved.ver,1);assert.deepEqual(saved.form_payload,row.form_payload);assert.equal(n.audit,0);assert.equal(n.operations,0);assert.equal(n.vouchers,0);assert.equal(n.ledger,0);}
 for(const action of ['resubmit','cancel']){
  const {row,c}=await fresh('lost-'+action,{transport:async({i,commit})=>{const out=await commit();if(i===0)throw Error('Failed to fetch');return out;}});
  const result=await c.expenseApplicantRevisionRpc(c.REQS[0],action,'匿名原因',action==='resubmit'?patch:{},[],c.S.nrRevisionExpected);if(!result.ok)throw result.error;assert(result.ok);const saved=await state(row.id),n=await counts(row.id);
  check('Actual SQL '+action+' lost committed response replays identical frozen key and content',c.calls.length===2&&JSON.stringify(c.calls[0])===JSON.stringify(c.calls[1])&&n.audit===1&&n.operations===1&&saved.ver===2&&saved.status===(action==='cancel'?'cancelled':'pending_accountant'));
  check(action+' preserves original attachment and produces no cash/voucher/ledger writes',saved.files.length===1&&n.vouchers===0&&n.ledger===0&&c.cleanups===0);
 }
 for(const action of ['resubmit','cancel']){
  const {row,c}=await fresh('readback-'+action,{transport:async({commit})=>{await commit();throw Error('Failed to fetch');}});const out=await c.expenseApplicantRevisionRpc(c.REQS[0],action,'保留原原因',action==='resubmit'?patch:{},[],c.S.nrRevisionExpected);check('Both lost '+action+' responses require exact actor/action/patch source readback before completion',out.ok&&out.readbackConfirmed&&c.calls.length===2&&c.store.size===0);
 }
 for(const action of ['resubmit','cancel']){
  const {row,c}=await fresh('reload-'+action,{transport:async()=>new Promise(()=>{}),readFails:true,timeoutMs:10});const result=await c.expenseApplicantRevisionRpc(c.REQS[0],action,'保留原原因',action==='resubmit'?patch:{},[],c.S.nrRevisionExpected);assert(result.unknown);await unchanged(row);assert(c.store.size===1);
  check(action+' unknown remains blocked with a real recovery button',!c.canActRequest(c.REQS[0])&&c.expenseRevisionRecoveryHtml().includes('reconcilePendingExpenseRevision()'));
  const pending=c.loadExpenseRevisionPending();const otherAttempt=await c.expenseApplicantRevisionRpc(c.REQS[0],action==='cancel'?'resubmit':'cancel','another action',{},[],c.S.nrRevisionExpected);check('Pending '+action+' cannot turn into a different mutation',otherAttempt.unknown&&c.calls.length===2);
  const recovered=ctx(row,{store:c.store});assert(recovered.loadExpenseRevisionPending());await recovered.window.reconcilePendingExpenseRevision();const saved=await state(row.id),n=await counts(row.id);
  check('Reload '+action+' confirms original operation, never recollects altered UI or deletes uploaded files',JSON.stringify(recovered.calls[0])===JSON.stringify(pending.rpcArgs)&&n.operations===1&&n.audit===1&&saved.ver===2&&recovered.cleanups===0&&recovered.store.size===0&&!recovered.POSTING_IN_FLIGHT['expense-revision:'+row.id]);
 }
 {
  const {row,c}=await fresh('quota',{storageFails:true});const result=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);await unchanged(row);check('Revision storage quota failure stops before RPC without a fake unknown lock',!result.ok&&!result.unknown&&c.calls.length===0&&!c.loadExpenseRevisionPending());
 }
 for(const [name,options,extra]of [['nonowner',{actor:'other'},{}],['anonymous',{actor:'anonymous'},{}],['paid',{}, {cash_posted_at:stamp}],['stale',{},{}]]){
  const {row,c}=await fresh(name,options,extra);if(name==='stale')await admin("update public.expense_requests set ver=2 where id=$1",[row.id]);const result=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);assert(!result.ok&&!result.unknown,JSON.stringify(result));const n=await counts(row.id);check('Actual SQL '+name+' rejection keeps source/cache/audit atomic',c.calls.length===1&&n.operations===0&&n.audit===0&&n.vouchers===0&&n.ledger===0);
 }
 {
  const {row,c}=await fresh('amount-mismatch');const bad=clone(patch);bad.amount=1060;const result=await c.expenseApplicantRevisionRpc(c.REQS[0],'resubmit','原因',bad,[],c.S.nrRevisionExpected);await unchanged(row);check('Mismatched detail amount is rejected by actual resubmit business rules',!result.ok&&!result.unknown&&c.calls.length===1);
 }
 {
  const {row,c}=await fresh('late-audit-failure');await admin("create function private.revision_test_audit_fail() returns trigger language plpgsql as $$begin if new.action='APPLICANT_REVISION_CANCEL' then raise exception 'fixture late audit failure' using errcode='23514';end if;return new;end$$;create trigger revision_test_fail before insert on public.module_audit_logs for each row execute function private.revision_test_audit_fail()");const out=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);await unchanged(row);check('Late SQL audit failure rolls back source and in-progress idempotency record',!out.ok&&!out.unknown);await admin('drop trigger revision_test_fail on public.module_audit_logs');
 }
 {
  const {row,c}=await fresh('identity',{transport:async({c,commit})=>{await commit();c.S.user.id='changed';throw Error('Failed to fetch');}});const out=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);check('A changed identity stops revision replay and cannot load another actor pending payload',out.identityChanged&&c.calls.length===1&&!c.loadExpenseRevisionPending());
 }
 {
  const {row,c}=await fresh('malformed',{transport:async()=>({data:{ok:true,id:'wrong',action:'cancel',idempotent_replay:false},error:null}),readFails:true});const out=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);await unchanged(row);check('Wrong document success is unknown and cannot complete the form',out.unknown&&c.calls.length===2&&c.loadExpenseRevisionPending());
 }
 {
  const {row,c}=await fresh('different-key-content');const originalResult=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','保留原因',{},[],c.S.nrRevisionExpected);assert(originalResult.ok);let denied;try{await sql({...clone(c.calls[0]),p_comment:'different payload'});}catch(e){denied=e;}check('Actual cache rejects reused key with changed content',denied&&denied.code==='23505');
 }
 {
  const {row,c}=await fresh('pending-scope',{transport:async()=>new Promise(()=>{}),readFails:true,timeoutMs:10});await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);const savedStore=new Map(c.store),pending=c.loadExpenseRevisionPending();assert(pending);
  for(const [field,value]of [['env','production'],['tenant','different']]){const next=ctx(row,{store:new Map(savedStore)});next[field]=value;assert.equal(next.loadExpenseRevisionPending(),null);}check('Revision durable pending payload is isolated by tenant and data environment');
  const recovered=ctx(row,{store:savedStore,storageFails:true});await recovered.window.reconcilePendingExpenseRevision();check('Previously uncertain persisted revision remains safely retryable if new storage writes fail',recovered.calls.length===1&&(await state(row.id)).status==='cancelled');
 }
 {
  let release;const {row,c}=await fresh('parallel-confirm',{transport:({commit})=>new Promise(resolve=>{release=()=>commit().then(resolve);})});const work=c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);await c.window.reconcilePendingExpenseRevision();assert.equal(c.calls.length,1);await release();assert((await work).ok);check('Recovery cannot start concurrently with the initial revision dispatch',c.alerts.some(x=>x.includes('請勿重複點擊'))&&!c.POSTING_IN_FLIGHT['expense-revision:'+row.id]);
 }
 {
  const {row,c}=await fresh('read-identity');let release;const chain={select(){return this;},eq(){return this;},limit(){return new Promise(resolve=>release=resolve);}};c.getSb=()=>({from:()=>chain});c.mapReq=map;vm.runInContext(source('readExpenseApplicantRevisionRow'),c);const before=JSON.stringify(c.REQS),work=c.readExpenseApplicantRevisionRow(row.id);c.S.user.id='changed';release({data:[{...row,status:'cancelled'}],error:null});assert.equal(await work,null);check('Late revision readback cannot alter another user cache',JSON.stringify(c.REQS)===before);
 }
 {
  const {row,c}=await fresh('auth-lock',{transport:async({c,commit})=>{const out=await commit();c.financeWorkspaceIdentityBlocked=true;return out;}});const out=await c.expenseApplicantRevisionRpc(c.REQS[0],'cancel','原因',{},[],c.S.nrRevisionExpected);const identity=c.expensePostingIdentity();check('Auth lock suppresses late revision completion even when S.user is unchanged',out.identityChanged&&c.alerts.length===0&&c.feedback.length===0&&c.loadExpenseRevisionPending());c.financeWorkspaceIdentityBlocked=false;assert.equal(c.expensePostingIdentity(),identity);check('Re-authenticating the same owner retains the original durable recovery key',c.loadExpenseRevisionPending().rpcArgs.p_idempotency_key===c.calls[0].p_idempotency_key);
 }
 {
  const {row,c}=await fresh('read-auth-lock');let release;const chain={select(){return this;},eq(){return this;},limit(){return new Promise(resolve=>release=resolve);}};c.getSb=()=>({from:()=>chain});c.mapReq=()=>{throw Error('blocked workspace cannot map source');};vm.runInContext(source('readExpenseApplicantRevisionRow'),c);const before=JSON.stringify(c.REQS),work=c.readExpenseApplicantRevisionRow(row.id);c.financeWorkspaceIdentityBlocked=true;release({data:[row],error:null});assert.equal(await work,null);check('Late revision readback under auth lock cannot merge source or show old result',JSON.stringify(c.REQS)===before);
 }
 {
  const {row,c}=await fresh('committed-upload-read-window');
  c.S.nrRevisionPendingUploads=[{path:'committed.pdf'}];c.S.nrFiles=[{__revisionUploadedMeta:{path:'committed.pdf'}}];
  let entered,release;const reading=new Promise(resolve=>entered=resolve);c.reloadRequestsByIds=async()=>{entered();return new Promise(resolve=>release=resolve);};
  vm.runInContext(['discardExpenseApplicantRevisionMode','cleanupExpenseApplicantRevisionPendingUploads'].map(source).join('\n'),c);
  const original=clone(patch);original.files=[{path:'committed.pdf'}];
  // The real SQL attachment ownership guard is exercised by the pre-existing
  // fixture cases; only its acknowledgement is substituted for this DOM race.
  c.callExpenseApplicantRevisionRpcOnce=async()=>({data:{ok:true,id:row.id,action:'resubmit',idempotent_replay:false},error:null});
  const work=c.expenseApplicantRevisionRpc(c.REQS[0],'resubmit','原因',original,[],c.S.nrRevisionExpected);await reading;
  await assert.rejects(c.discardExpenseApplicantRevisionMode('navigation while readback pending'),e=>e.code==='APPLICANT_REVISION_CONFIRMATION_PENDING');
  assert.equal(c.cleanups,0);assert.equal(c.S.nrRevisionPendingUploads.length,0);assert.equal(c.S.nrFiles[0].__revisionOriginal,true);assert.equal(c.S.nrFiles[0].__revisionUploadedMeta,undefined);
  release(true);assert((await work).ok);await c.discardExpenseApplicantRevisionMode('navigation after readback');
  check('Confirmed revision retains navigation guard during readback and never cleans committed attachment paths',c.cleanups===0);
 }
 {
  const {row,c}=await fresh('protect-committed-subset');const bound={path:'bound.pdf'},unbound={path:'unbound.pdf'},book={path:'book.pdf'};
  c.S.nrRevisionPendingUploads=[bound,unbound,book];c.S.nrFiles=[{__revisionUploadedMeta:bound},{__revisionUploadedMeta:unbound}];c.S.nrPassbookFile={__revisionUploadedMeta:book};
  const pending={recordId:row.id,action:'resubmit',rpcArgs:{p_step_files:[bound],p_form_patch:{form_payload:{passbookFiles:[book]}}}};
  c.protectExpenseRevisionCommittedUploads(pending);
  assert.deepEqual(clone(c.S.nrRevisionPendingUploads),[unbound]);assert.equal(c.S.nrFiles[0].__revisionOriginal,true);assert.deepEqual(c.S.nrFiles[1].__revisionUploadedMeta,unbound);assert.equal(c.S.nrPassbookFile,null);assert.deepEqual(clone(c.S.nrRevisionOriginalPassbookFiles),[book]);
  check('Only positively bound resubmit uploads leave cleanup candidates; unrelated delta remains eligible');
  c.S.nrRevisionPendingUploads=[bound];c.S.nrFiles=[{__revisionUploadedMeta:bound}];c.protectExpenseRevisionCommittedUploads({...pending,action:'cancel'});
  check('Cancellation keeps unused uploaded delta eligible for its existing cleanup',c.S.nrRevisionPendingUploads.length===1&&c.S.nrFiles[0].__revisionUploadedMeta===bound);
 }
 console.log('OK: '+passed+' actual applicant-revision browser + PostgreSQL reliability checks passed');
}
const fixture=read('scripts/check_finalize_accounting_lines_atomic.js'),marker="  const old=await create('baseline-drift')";assert.equal(fixture.split(marker).length,2);
new Function('require','__dirname','__filename','runCases',fixture.slice(0,fixture.indexOf(marker)).replace(/^#![^\n]*\n/,'')+`await runCases({db,admin,as,state,create,tenant,actorId,actorName,auth});}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.stack});process.exitCode=1;});`)(require,__dirname,__filename,runCases);
