#!/usr/bin/env node
'use strict';
// Real receipt engine + actual UI caller: lost post-COMMIT responses, browser
// reload, attachment cleanup and deadlines. No real identities or database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),engine=fs.readFileSync(path.join(root,'assets/engines/receipt-transactions.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));let checks=0;
function fn(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(match,name);return html.slice(match.index,html.indexOf('\n}',match.index)+2);}
function check(name,value){assert(value,name);checks++;}
function fixture(shared={}){
 const storage=shared.storage||new Map(),server=shared.server||new Map(),calls=shared.calls||[];
 const state={lost:0,denied:false,hang:false,ready:true,storageOk:true,reload:true,readHang:false,flags:[],alerts:[],cleanup:0,renders:0,epoch:0,auth:'fictional-auth',permission:'v1',hook:null};
 const rows=[{id:'fictional-invoice',rowVersion:3,status:'unpaid',no:'FICT-100'}],proof={n:'Fictional proof',path:'fixture/proof',bucket:'finance-attachments'};
 const runtime={S:{user:{id:'fictional-accountant',authUserId:'fictional-auth'},demoLogin:false},currentTenantId:()=> 'fictional-tenant',activeDataEnvironment:()=> 'test',isIdentityBlocked:()=>false,currentFinanceAuthUserId:()=>state.auth,permissionIdentity:()=>state.permission,identityEpoch:()=>state.epoch,
  sessionGetItem:key=>storage.get(key),sessionSetItem:(key,value)=>{if(!state.storageOk)return false;storage.set(key,value);return true;},ensureSupabaseWriteReady:async()=>({ok:state.ready}),
  expenseApplicantRevisionRpcErrorIsAmbiguous:e=>['NETWORK','CLIENT_TIMEOUT'].includes(e.code),reloadInvoicesByIds:async()=>state.readHang?new Promise(()=>{}):state.reload,
  approvalSetReconcilePending:(_kind,_ids,flag)=>state.flags.push(flag),setTopSyncStatus:()=>{},refreshApprovalAfterCommittedAction:async()=>true,
  getSb:()=>({rpc:async(name,args)=>{assert.equal(name,'finance_invoice_receipt_action_v2');calls.push(clone(args));if(state.hook)await state.hook();if(state.denied)return {error:{code:'42501',message:'Fictional denied'}};
   if(server.has(args.p_idempotency_key))assert.equal(server.get(args.p_idempotency_key),JSON.stringify(args));else server.set(args.p_idempotency_key,JSON.stringify(args));
   if(state.hang)return new Promise(()=>{});if(state.lost>0){state.lost--;return {error:{code:'NETWORK',message:'Response lost after commit'}};}return {data:{ok:true,count:args.p_invoice_ids.length}};
  }})};
 const c={FinanceApprovalRuntime:runtime,crypto:require('node:crypto').webcrypto,Promise,Error,JSON,Object,Number,Array,setTimeout:(callback,ms)=>setTimeout(callback,Math.min(ms,15)),clearTimeout,
  incomeSubmissionIdentity:()=>[runtime.S.user.id,state.auth,state.epoch,state.permission].join('|'),incomeSubmissionIdentityCurrent:expected=>expected===c.incomeSubmissionIdentity(),invoiceGroupRows:()=>rows,receiptTaskCandidate:()=>true,approvalRecordsActionAvailability:()=>({ok:true,rows}),receiptReviewedVersions:()=>({[rows[0].id]:3}),renderFinanceReceiptRecovery:()=>state.renders++,alert:message=>state.alerts.push(message),cleanupApprovalFilesAfterDefiniteFailure:async()=>state.cleanup++};
 c.window=c;vm.createContext(c);vm.runInContext(fn('withOperationTimeout'),c);runtime.withOperationTimeout=(pending,label,ms)=>c.withOperationTimeout(pending,label,ms);vm.runInContext(engine,c);vm.runInContext(fn('receiptGroupActionCore'),c);
 return {c,state,runtime,rows,proof,server,storage,calls,shared:{storage,server,calls},run:()=>c.receiptGroupActionCore(rows[0],'submit','Fictional note',[proof],{[rows[0].id]:3}),switchIdentity(){runtime.S.user={id:'fictional-B',authUserId:'fictional-auth-B'};state.auth='fictional-auth-B';state.epoch++;}};
}
(async()=>{
 let f=fixture();f.state.lost=1;await f.run();check('Lost first response reuses same frozen proof, version and operation key',f.calls.length===2&&JSON.stringify(f.calls[0])===JSON.stringify(f.calls[1])&&f.server.size===1&&f.c.financeReceiptPendingActions().length===0&&f.state.cleanup===0);
 f=fixture();f.state.lost=1;f.state.hook=async()=>{if(f.calls.length===2)f.state.denied=true;};const done=await f.run();
 check('Actual caller treats unknown then 42501 as pending, never rollback',done===0&&f.state.alerts.some(x=>x.startsWith('收款結果待確認'))&&f.state.cleanup===0&&f.state.flags.includes(true)&&f.server.size===1);
 check('Unknown result exposes recovery action and retains original payload',f.state.renders===1&&f.c.financeReceiptPendingActions().length===1);
 const key=f.calls[0].p_idempotency_key;f.state.denied=false;f.state.hook=null;await f.c.financeRetryReceiptAction(key);
 check('Explicit confirmation replays original operation without extra commit',f.server.size===1&&f.calls.at(-1).p_idempotency_key===key&&f.c.financeReceiptPendingActions().length===0);
 f=fixture();f.state.lost=2;await f.run();let fresh=fixture(f.shared);const pending=fresh.c.financeReceiptPendingActions()[0];await fresh.c.financeRetryReceiptAction(pending.key);
 check('Browser reload retains receipt key, proof and original expected version',fresh.server.size===1&&JSON.stringify(fresh.calls[0])===JSON.stringify(fresh.calls.at(-1))&&fresh.c.financeReceiptPendingActions().length===0);
 f=fixture();f.state.lost=2;await f.run();const priorCalls=f.calls.length;
 await assert.rejects(()=>f.c.financeReceiptAction(f.rows,'submit','Edited note',[{...f.proof,path:'fixture/changed'}],{'fictional-invoice':4},{amounts:{'fictional-invoice':1}}),error=>error.code==='FINANCE_MUTATION_RESULT_UNKNOWN');
 check('Edited proof/amount/version cannot silently open new operation while unknown',f.calls.length===priorCalls&&f.server.size===1);
 f=fixture();f.state.denied=true;await f.run();check('First definitive rejection keeps normal failure and staged-file cleanup',f.state.cleanup===1&&f.c.financeReceiptPendingActions().length===0&&f.server.size===0);
 f=fixture();f.state.storageOk=false;await f.run();check('Storage failure blocks before RPC without poisoning in-memory attempt',f.calls.length===0&&f.c.financeReceiptPendingActions().length===0&&f.state.cleanup===1);
 f=fixture();f.state.ready=false;await f.run();check('Pre-dispatch readiness failure is definite with no orphan pending key',f.calls.length===0&&f.c.financeReceiptPendingActions().length===0&&f.state.cleanup===1);
 f=fixture();f.state.hook=async()=>f.switchIdentity();await f.run();check('Identity switch suppresses old-account UI/attachment cleanup',f.state.alerts.length===0&&f.state.cleanup===0&&f.c.financeReceiptPendingActions().length===0&&f.calls.length===1);
 f=fixture();f.state.hook=async()=>{f.state.epoch+=2;};await f.run();check('A-B-A epoch invalidates receipt result',f.state.alerts.length===0&&f.state.cleanup===0&&f.c.financeReceiptPendingActions().length===1);
 f=fixture();f.state.hook=async()=>{f.state.auth='different-auth-with-stale-mapped-user';};await f.run();check('Auth identity change is detected even before mapped user updates',f.state.alerts.length===0&&f.state.cleanup===0&&f.c.financeReceiptPendingActions().length===0);
 f=fixture();f.state.hang=true;let started=Date.now();await f.run();check('Never resolving write finishes bounded wait with original key pending',Date.now()-started<1000&&f.state.cleanup===0&&f.c.financeReceiptPendingActions().length===1);
 f.state.hang=false;await f.c.financeRetryReceiptAction(f.calls[0].p_idempotency_key);check('Deadline releases engine lock so same operation can recover',f.server.size===1&&f.c.financeReceiptPendingActions().length===0);
 f=fixture();f.state.readHang=true;started=Date.now();await f.run();check('Hung readback is committed not failed and wait is bounded',Date.now()-started<1000&&f.state.cleanup===0&&f.c.financeReceiptPendingActions()[0].response.data.ok===true);
 fresh=fixture(f.shared);await fresh.c.financeRetryReceiptAction(fresh.c.financeReceiptPendingActions()[0].key);check('Stored acknowledgement only retries authoritative read, not write',fresh.calls.length===1&&fresh.c.financeReceiptPendingActions().length===0);
 f=fixture();f.state.hang=true;const concurrent=f.run();while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));await f.run();await concurrent;check('Concurrent caller does not double dispatch independent attempts',f.server.size===1&&f.calls.length===2&&f.state.cleanup===0);
 console.log('PASS: '+checks+' receipt actual caller/durable recovery checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
