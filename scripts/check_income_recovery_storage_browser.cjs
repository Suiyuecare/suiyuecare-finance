#!/usr/bin/env node
'use strict';
// Real Chromium/WebKit Web Storage + IndexedDB + WebCrypto and production
// transaction/reconciliation functions. HTTP server is a fictional financial
// service; this test does not claim production SQL or employee-account proof.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pw=require('playwright'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const out=process.argv[2]||'/tmp/finance-income-recovery-storage-browser';
function fn(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(match,name);return source.slice(match.index,source.indexOf('\n}',match.index)+2);}
const start=source.indexOf('var INCOME_SUBMISSION_PENDING={}'),end=source.indexOf('\nasync function insertMembershipOrgSubmittedRecord',start),adapter=source.slice(start,end);
const definitions=['incomeSubmissionRpcItem','incomeFileSignature','incomeFieldValues','incomeDirtySnapshot','withOperationTimeout','supabaseAuthErrorInfo','currentFinanceReleaseContract','financeReleaseContractFromHtml','verifyProductionReleaseContractForSubmission'].map(fn).join('\n');
const engine=fs.readFileSync(path.join(root,'assets/engines/income-recovery-store.js'),'utf8');
let records=new Map(),writes=[],mode='success',lookupOffline=false,latestContract='fictional-contract';
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/index.html?finance_release_check=')){res.setHeader('Content-Type','text/html');return res.end('<meta name="finance-release-contract" content="'+latestContract+'">');}
 if(req.url.startsWith('/release-manifest.json?finance_release_check=')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({contract:'finance-release-artifact-v2',build_target:'production',source_commit:'a'.repeat(40)}));}
 if(req.method!=='POST'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta name="finance-release-contract" content="fictional-contract"><meta name="finance-release-sha" content="'+'a'.repeat(40)+'"><input id="b-reason"><div id="pg-invoices"></div><div id="pg-bills"></div><script>'+engine+'</script>');}
 let body='';for await(const data of req)body+=data;const {name,args}=JSON.parse(body);
 res.setHeader('Content-Type','application/json');
 if(name==='finance_income_reconcile_submission_v1'){
  if(lookupOffline){res.statusCode=503;return res.end(JSON.stringify({error:{code:'NETWORK'}}));}
  const row=records.get(args.p_idempotency_key);return res.end(JSON.stringify({data:{ok:true,state:row?'committed':'confirmed_not_committed',result:row||null}}));
 }
 writes.push(args);
 if(mode==='rollback'){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),10);return;}
 if(!records.has(args.p_idempotency_key))records.set(args.p_idempotency_key,{ok:true,rows:args.p_items.map((item,i)=>({id:'saved-'+i,no:'FICT-'+i,client_item_key:item.client_item_key,batch_id:'FICT-BATCH'}))});
 if(mode==='lost'){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),10);return;}
 res.end(JSON.stringify({data:records.get(args.p_idempotency_key)}));
});
const setup=`
var S={user:{id:'fictional-person',authUserId:'fictional-auth'},demoLogin:false,bRows:[],bUploadFiles:[],billFiles:[]},BILL_ROWS=[],INVS=[],BILLS=[];
var INVOICE_BATCH_MAX_ITEMS=500,BILL_BATCH_MAX_ITEMS=150,FINANCE_DRAFT_IDENTITY_EPOCH=0,financeAuthIdentityEpoch=0,CURRENT_PERMISSION_SNAPSHOT={},financeLogoutInProgress=false,financeGoogleAccountSwitchInProgress=false,INCOME_SUBMISSION_RETRY_STATE={},BATCH_INVOICE_READ_GENERATION=0;
var diagnostics=[],alerts=[],dirty=false;
function currentFinanceAuthUserId(){return S.user.authUserId;}function currentTenantId(){return 'fictional-tenant';}function activeDataEnvironment(){return 'test';}function hasSupabase(){return true;}
function currentFinanceReleaseContract(){return 'fictional-contract';}function expenseSubmissionOperationIdentity(){return JSON.stringify([S.user.authUserId,S.user.id]);}
var PRODUCTION_APP_URL=location.origin+'/';function formalOnlineMode(){return true;}
function sessionGetItem(key){return sessionStorage.getItem(key);}function sessionRemoveItem(key){sessionStorage.removeItem(key);}function safeRemoveItem(key){localStorage.removeItem(key);}
function el(id){return document.getElementById(id);}function num(value){return Number(value)||0;}function cloneSettingValue(value){return JSON.parse(JSON.stringify(value));}function cloneApprovalStepsForRecord(value){return cloneSettingValue(value);}function stableSnapshotValue(value){return value;}
function invoiceIdentifierType(value){return value||'電子發票';}function todayIso(){return '2026-10-14';}function billBatchLimitError(){return '';}
function recordOpsEvent(type,severity,title,detail,meta){diagnostics.push({type,meta});}function expenseApplicantRevisionRpcErrorIsAmbiguous(error){return error.code==='NETWORK'||error.code==='CLIENT_TIMEOUT';}
function getSb(){return {rpc:async function(name,args){try{return await(await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json();}catch(error){return {error:{code:'NETWORK',message:'Fictional transport lost response'}};}}};}
function syncBatchRowsFromDom(){}function syncBillRowsFromDom(){}function renderBatchTable(){}function renderBillEntryTable(){}function renderBillAttachments(){}function renderBillList(){}function renderInvTable(){}function renderBatchInvTable(){}function buildApprovals(){}function markIncomeDocClean(){}function hasUnsavedIncomeDocChanges(){return dirty;}
function defaultInvoiceBatchRow(){return {};}function defaultBillRow(){return {};}function showConfirmedBillSubmission(){}
async function reloadInvoicesByIds(ids){INVS=ids;return true;}async function reloadBillsByIds(ids){BILLS=ids;return true;}
window.alert=function(message){alerts.push(message);};window.confirm=function(){return true;};
${definitions}\n${adapter}
function makeRecords(count,kind){
 var description='私密草稿不可出現在WebStorage'.repeat(420);S.bRows=Array.from({length:count},(_,i)=>({buyer:'Fictional buyer '+i,desc:description,total:100}));BILL_ROWS=S.bRows.map((row,i)=>({payer:row.buyer,item:description,amt:100}));el('b-reason').value='Fictional preserved purpose';
 return Array.from({length:count},(_,i)=>({id:'temp-'+i,eid:'E1',dc:'D1',amt:100,total:100,buyer:'Fictional buyer '+i,payer:'Fictional payer '+i,item:description,desc:description,steps:[{rk:'applicant_submit',files:[{path:'private/scoped/original.xlsx',bucket:'finance-attachments',n:'私密附件.xlsx',kind:kind==='bill'?'bill_initial':'invoice_source',size:59123,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]}],submissionFormUi:i===0?{mode:kind==='bill'?'bill':'batch',snapshot:incomeDirtySnapshot(kind==='bill'?'bills':'invoices')}:null}));
}
function fillNearQuota(store,prefix){var chunk='x'.repeat(64*1024),i=0;try{for(;i<200;i++)store.setItem(prefix+i,chunk);}catch(error){store.removeItem(prefix+(i-1));return i;}throw Error('Expected bounded Web Storage quota');}
`;
let browser;const evidence={scope:'Actual production JS adapter, real browser storage/crypto, fictional HTTP service only',cases:[]};
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 for(const browserName of ['chromium','webkit']){
  browser=await pw[browserName].launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),cases=[];evidence.cases.push({browser:browserName,checks:cases});
  const check=(label,condition)=>{assert(condition,browserName+' '+label);cases.push(label);console.log('PASS '+browserName+' '+label);};
  const reset=async()=>{records=new Map();writes=[];mode='success';lookupOffline=false;latestContract='fictional-contract';await page.goto(url);await page.evaluate(async()=>{localStorage.clear();sessionStorage.clear();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('finance-income-recovery-v1');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});});await page.evaluate(setup);};
  for(const [count,kind] of [[190,'invoice'],[500,'invoice'],[150,'bill']]){
   await reset();const near=await page.evaluate(()=>({session:fillNearQuota(sessionStorage,'quota-s-'),local:fillNearQuota(localStorage,'quota-l-')}));
   check(kind+' '+count+' real Web Storage is near quota',near.session>10&&near.local>10);
   const result=await page.evaluate(async({count,kind})=>{const rows=makeRecords(count,kind);window.sentRows=rows;return await submitIncomeDocumentTransaction(kind,rows);},{count,kind});
   check(kind+' '+count+' submits once despite payload exceeding session quota',result.ok&&writes.length===1&&writes[0].p_items.length===count);
   const proof=await page.evaluate(async(kind)=>{
    const marker=incomeSubmissionRecoveryMarker(kind),saved=await FinanceIncomeRecoveryStore.load(marker.owner,kind,marker.operationKey);
    const row=await new Promise((resolve,reject)=>{const r=indexedDB.open('finance-income-recovery-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('snapshots').objectStore('snapshots').get(JSON.stringify([marker.owner,kind]));q.onsuccess=()=>{db.close();resolve(q.result);};q.onerror=()=>reject(q.error);};});
    return {markerBytes:JSON.stringify(marker).length,privateLeak:JSON.stringify(localStorage).includes('私密')||JSON.stringify(sessionStorage).includes('私密'),hasSnapshot:!!saved.formUi,encrypted:row.encrypted instanceof ArrayBuffer&&row.key.extractable===false&&!('payload' in row)};
   },kind);
   check(kind+' '+count+' stores compact opaque receipt and encrypted draft',proof.markerBytes<40000&&!proof.privateLeak&&proof.hasSnapshot&&proof.encrypted);
   await page.reload();await page.evaluate(setup);await page.evaluate(kind=>recoverPendingIncomeSubmission(kind),kind);
   check(kind+' '+count+' reload reconciles original COMMIT without another submit',writes.length===1&&await page.evaluate(kind=>!incomeSubmissionRecoveryMarker(kind),kind));
  }
  await reset();mode='lost';lookupOffline=true;
  await page.evaluate(async()=>{const rows=makeRecords(190,'invoice');window.results=await Promise.all([submitIncomeDocumentTransaction('invoice',rows),submitIncomeDocumentTransaction('invoice',rows)]);});
  check('double click plus lost COMMIT response dispatches exactly once',writes.length===1&&records.size===1&&await page.evaluate(()=>!!incomeSubmissionRecoveryMarker('invoice')));
  await page.reload();await page.evaluate(setup);lookupOffline=false;await page.evaluate(()=>recoverPendingIncomeSubmission('invoice'));
  check('cold reload resolves committed result and never resends payload',writes.length===1&&await page.evaluate(()=>INVS.length===190&&!incomeSubmissionRecoveryMarker('invoice')));
  await reset();mode='lost';lookupOffline=true;
  const other=await context.newPage();await other.goto(url);await other.evaluate(setup);
  await Promise.all([page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice'))),other.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')))]);
  check('two real browser tabs reserve one operation through Web Locks',writes.length===1&&records.size===1);
  await other.close();const reopened=await context.newPage();await reopened.goto(url);await reopened.evaluate(setup);lookupOffline=false;await reopened.evaluate(()=>recoverPendingIncomeSubmission('invoice'));
  check('new tab recovers shared durable receipt without session payload',writes.length===1&&await reopened.evaluate(()=>INVS.length===190&&!incomeSubmissionRecoveryMarker('invoice')));await reopened.close();
  await reset();const race=await page.evaluate(async()=>{
    const owner=incomeSubmissionOwner(),save=FinanceIncomeRecoveryStore.save(owner,'invoice','logout-race',{formUi:{snapshot:'private draft'}});
    const results=await Promise.allSettled([save,FinanceIncomeRecoveryStore.clearOwner(owner)]);
    return results[0].status==='rejected'&&await FinanceIncomeRecoveryStore.load(owner,'invoice','logout-race')===null;
  });check('logout while encryption is pending cannot recreate private cached draft',race);
  await reset();const logoutTab=await context.newPage();await logoutTab.goto(url);await logoutTab.evaluate(setup);
  await page.evaluate(()=>{window.originalEncrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=async function(){window.encryptStarted=true;await new Promise(resolve=>window.resumeEncryption=resolve);return originalEncrypt(...arguments);};window.pendingSave=FinanceIncomeRecoveryStore.save(incomeSubmissionOwner(),'invoice','cross-tab-logout',{formUi:{snapshot:'private'}}).then(()=>true,()=>false);});
  await page.waitForFunction(()=>window.encryptStarted);await logoutTab.evaluate(()=>FinanceIncomeRecoveryStore.clearOwner(incomeSubmissionOwner()));
  await page.evaluate(()=>resumeEncryption());
  check('logout from another tab revokes an in-flight encrypted save atomically',await page.evaluate(async()=>await pendingSave===false&&await FinanceIncomeRecoveryStore.load(incomeSubmissionOwner(),'invoice','cross-tab-logout')===null));await logoutTab.close();
  await reset();mode='lost';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  await page.reload();await page.evaluate(setup);lookupOffline=false;
  await page.evaluate(()=>{FinanceIncomeRecoveryStore.load=async()=>{throw Object.assign(Error('Blocked IndexedDB read'),{code:'CLIENT_TIMEOUT'});};return recoverPendingIncomeSubmission('invoice');});
  check('unavailable private draft storage still permits authoritative result lookup',writes.length===1&&await page.evaluate(()=>INVS.length===190&&!incomeSubmissionRecoveryMarker('invoice')&&diagnostics.some(x=>x.meta.stage==='draft_restore')));
  await reset();mode='rollback';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  await page.reload();await page.evaluate(setup);lookupOffline=false;await page.evaluate(()=>{FinanceIncomeRecoveryStore.load=async()=>{throw Object.assign(Error('Temporary IDB read failure'),{code:'CLIENT_TIMEOUT'});};return recoverPendingIncomeSubmission('invoice');});
  check('confirmed rollback retains receipt when encrypted draft is temporarily unreadable',await page.evaluate(()=>!!incomeSubmissionRecoveryMarker('invoice')));
  await page.reload();await page.evaluate(setup);await page.evaluate(()=>recoverPendingIncomeSubmission('invoice'));
  check('later retry recovers original draft after temporary IndexedDB read failure',writes.length===1&&await page.evaluate(()=>S.bRows.length===190&&S.bUploadFiles.length===1&&!incomeSubmissionRecoveryMarker('invoice')));
  await reset();mode='rollback';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  await page.reload();await page.evaluate(setup);lookupOffline=false;await page.evaluate(()=>recoverPendingIncomeSubmission('invoice'));
  check('sealed rollback restores original 190 rows and source attachment metadata',writes.length===1&&await page.evaluate(()=>S.bRows.length===190&&S.bUploadFiles[0].path==='private/scoped/original.xlsx'&&el('b-reason').value==='Fictional preserved purpose'&&!incomeSubmissionRecoveryMarker('invoice')));
  await reset();mode='rollback';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  await page.reload();await page.evaluate(setup);lookupOffline=false;await page.evaluate(()=>{dirty=true;el('b-reason').value='New unsent draft';return recoverPendingIncomeSubmission('invoice');});
  check('rollback recovery does not overwrite a newer draft',await page.evaluate(()=>el('b-reason').value==='New unsent draft'&&!!INCOME_RECOVERED_DRAFTS.invoice&&document.querySelector('#income-submission-recovery-invoice').textContent.includes('恢復前次表單')));
  await page.reload();await page.evaluate(setup);await page.evaluate(()=>{dirty=true;el('b-reason').value='New unsent draft';return recoverPendingIncomeSubmission('invoice');});
  check('deferred rollback draft survives another reload without losing its receipt',await page.evaluate(()=>!!INCOME_RECOVERED_DRAFTS.invoice&&!!incomeSubmissionRecoveryMarker('invoice')&&el('b-reason').value==='New unsent draft'));
  await page.getByRole('button',{name:'恢復前次表單'}).click();check('explicit restore recovers original after preserving new draft choice',await page.evaluate(()=>S.bRows.length===190&&el('b-reason').value==='Fictional preserved purpose'));
  await reset();mode='lost';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  const originalOwner=await page.evaluate(()=>incomeSubmissionOwner());await page.evaluate(()=>{S.user={id:'different-person',authUserId:'different-auth'};financeAuthIdentityEpoch++;});
  check('different identity cannot see marker or encrypted snapshot',await page.evaluate(async()=>incomeSubmissionRecoveryMarker('invoice')===null&&await FinanceIncomeRecoveryStore.load(incomeSubmissionOwner(),'invoice','invented')===null));
  await page.evaluate(owner=>FinanceIncomeRecoveryStore.clearOwner(owner),originalOwner);
  check('explicit logout cleanup deletes private snapshot but retains opaque receipt',await page.evaluate(async(owner)=>{const raw=Object.entries(localStorage).find(([key])=>key.startsWith('finance_income_submission_recovery_v1:'))[1],marker=JSON.parse(raw);return !!marker&&await FinanceIncomeRecoveryStore.load(owner,'invoice',marker.operationKey)===null;},originalOwner));
  await reset();await page.evaluate(()=>{fillNearQuota(localStorage,'quota-');try{for(var i=0;i<300;i++)localStorage.setItem('last-free-space-'+i,'z'.repeat(1024));}catch(_){}});
  const blocked=await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(500,'invoice')));
  check('unpersistable receipt fails closed before RPC with named quota diagnostic',!blocked.ok&&writes.length===0&&await page.evaluate(()=>diagnostics.some(x=>x.meta.stage==='receipt_write'&&x.meta.errorName==='QuotaExceededError')));
  await reset();await page.evaluate(()=>{FinanceIncomeRecoveryStore.save=async()=>{throw Object.assign(new Error('Denied'),{name:'SecurityError'});};});
  const denied=await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  check('unpersistable encrypted draft fails closed and retains entered rows',!denied.ok&&writes.length===0&&await page.evaluate(()=>S.bRows.length===190&&diagnostics.some(x=>x.meta.stage==='draft_persist'&&x.meta.errorName==='SecurityError')));
  await reset();latestContract='new-fictional-contract';
  const stale=await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));
  check('actual release gate detects changed HTTP contract before receipt and RPC, preserving entered rows',!stale.ok&&writes.length===0&&await page.evaluate(()=>S.bRows.length===190&&!incomeSubmissionRecoveryMarker('invoice')&&diagnostics.some(x=>x.meta.code==='CLIENT_RELEASE_STALE')));
  await reset();mode='lost';lookupOffline=true;await page.evaluate(()=>submitIncomeDocumentTransaction('invoice',makeRecords(190,'invoice')));await page.reload();await page.evaluate(setup);lookupOffline=false;await page.evaluate(()=>{verifyProductionReleaseContractForSubmission=async()=>{throw Error('Recovery must not need latest version');};return recoverPendingIncomeSubmission('invoice');});
  check('prior-operation recovery remains available after release changes',writes.length===1&&await page.evaluate(()=>INVS.length===190&&!incomeSubmissionRecoveryMarker('invoice')));
  await reset();
  const logoutStart=source.indexOf('window.financeLogout=async function(){'),logout=source.slice(logoutStart,source.indexOf('\n};',logoutStart)+3);
  await page.evaluate(`var stopped=0;function stopRealtime(){stopped++;}var PORTAL_MODULE_URL='/';window.FinanceModuleLogout={start:async function(options){await options.stopRealtime();return true;}};`+logout);
  const logoutContinues=await page.evaluate(async()=>{FinanceIncomeRecoveryStore.clearOwner=async()=>{throw Object.assign(Error('IDB denied'),{name:'SecurityError'});};return await financeLogout()===true&&stopped===1&&diagnostics.some(x=>x.meta.stage==='logout_cleanup');});
  check('private cache cleanup failure cannot prevent actual logout coordination',logoutContinues);
  await page.screenshot({path:path.join(out,browserName+'-recovery.png')});await browser.close();browser=null;
 }
 evidence.ok=true;evidence.finishedAt=new Date().toISOString();evidence.sources={indexSHA256:crypto.createHash('sha256').update(source).digest('hex'),recoveryStoreSHA256:crypto.createHash('sha256').update(engine).digest('hex')};
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Income recovery storage PASS '+out);
})().catch(error=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,evidence},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
