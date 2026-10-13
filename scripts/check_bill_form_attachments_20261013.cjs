#!/usr/bin/env node
'use strict';
// Real submit/recovery/file conversion/upload coordinator. Only remote Storage,
// identity directory and RPC transports are fictional; no production writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const recoveryPath=path.join(__dirname,'check_income_submission_recovery.cjs');
const recovery=fs.readFileSync(recoveryPath,'utf8').split('\n(async()=>{')[0].replace(/^#![^\n]*\n/,'');
const base=new Function('require','__dirname',recovery+'\nreturn fixture;')(createRequire(recoveryPath),__dirname);
function fn(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(m,name);return html.slice(m.index,html.indexOf('\n}',m.index)+2);}
function handler(name){const start=html.indexOf('window.'+name+'=function(');assert(start>=0,name);return html.slice(start,html.indexOf('\n};',start)+3);}
const copy=x=>JSON.parse(JSON.stringify(x));let count=0;function check(name,ok){assert(ok,name);count++;console.log('PASS '+name);}
function fixture(shared){
 const f=base(shared),c=f.c,t={uploads:[],cleanup:[],preflight:[]};f.attachments=t;
 Object.assign(c,{Blob,File,FileReader:class{constructor(){throw Error('Native Office files must not use FileReader');}},SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',ATTACHMENT_RESUMABLE_THRESHOLD_BYTES:6*1024*1024,ATTACHMENT_UPLOAD_TIMEOUT_MS:30000,ATTACHMENT_LARGE_UPLOAD_TIMEOUT_MS:1200000,
  fileExt:name=>name.split('.').pop(),financeWorkspaceIdentityBlocked:false,FinanceEmployeeFormUX:require('../assets/engines/employee-form-ux.js'),assertAttachmentUploadable(file){if(file.size>50*1024*1024)throw Error('too large');},
  preflightAttachmentsForSupabase:async(files,ctx)=>{t.preflight.push({files,ctx});return files;},
  uploadAttachmentWithTrackedTimeout:async(file,ctx)=>{t.uploads.push({file,ctx,bytes:Buffer.from(await file.uploadBlob.arrayBuffer()).toString('base64')});if(f.state.hooks.upload)await f.state.hooks.upload();if(t.failAt===t.uploads.length)throw Error('fictional upload failure');ctx.onProgress(file.size,file.size,{fileIndex:t.uploads.length});return {n:file.n,size:file.size,mime:file.mime,bucket:'finance-attachments',path:'bills/test/file-'+t.uploads.length,kind:'bill_initial',__uploadCreatedThisAttempt:true};},
  cleanupUploadedSupabaseAttachments:async(groups,label)=>{t.cleanup.push({groups:copy(groups),label});},attachmentUploadError:(message,meta)=>Object.assign(new Error(message),meta),formatStorageUploadError:e=>e.message,normalizeFileMeta:f=>f,
  p1SubmissionPreflight:async(kind,options)=>{t.p1=options;return {ok:true};},failActionFeedback:(title,message)=>{t.feedback={title,message};}});
 ['renderBillAttachments','restoreBillAttachmentManifest','billInitialStepFiles','fileToAttachment','uploadAttachmentsToSupabase','newlyUploadedAttachmentResults'].forEach(name=>vm.runInContext(fn(name),c));
 ['billAttachmentChange','removeBillAttachment'].forEach(name=>vm.runInContext(handler(name),c));
 c.S.billFiles=[];c.S.billAttachmentOwner=c.incomeSubmissionOwner();
 f.select=(files)=>{c.S.billAttachmentPickerIdentity=c.incomeSubmissionIdentity();c.billAttachmentChange({files,value:'local'});};
 return f;
}
const files=()=>[new File(['PK\x03\x04Fictional Office body'],'佐證.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),new File(['PK\x03\x04Fictional sheet body'],'繳費明細.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})];
(async()=>{
 for(const rows of [1,95]){
  const f=fixture();f.c.BILL_ROWS=Array.from({length:rows},(_,i)=>({...f.c.BILL_ROWS[0],payer:'Fictional '+i}));const input=files();f.select(input);await f.c.submitBill();
  check(rows+' rows: exact bytes uploaded once per original Office file',f.attachments.uploads.length===2&&f.attachments.uploads.every((u,i)=>u.bytes===Buffer.from(i?'PK\x03\x04Fictional sheet body':'PK\x03\x04Fictional Office body').toString('base64')));
  check(rows+' rows: correct Storage scope + attachment preflight',f.attachments.p1.hasAttachments&&f.attachments.uploads.every(u=>u.ctx.recordType==='bills'&&u.ctx.entityId==='FICT-E'&&u.ctx.departmentCode==='FICT-D'&&u.ctx.kind==='bill_initial'));
  check(rows+' rows: one RPC all child steps retain same references',f.calls.length===1&&f.calls[0].p_items.length===rows&&f.calls[0].p_items.every(x=>x.steps[0].files.length===2&&JSON.stringify(x.steps[0].files)===JSON.stringify(f.calls[0].p_items[0].steps[0].files)));
  check(rows+' rows: no bytes/Blob enter RPC; saved rows keep refs',!JSON.stringify(f.calls).includes('uploadBlob')&&f.c.BILLS.every(x=>x.steps[0].files.length===2));
  check(rows+' rows: successful unchanged form clears originals',f.c.S.billFiles.length===0&&f.attachments.cleanup.length===0);
 }
 let f=fixture();f.select(files());f.attachments.failAt=2;await f.c.submitBill();
 check('partial upload failure never dispatches RPC',f.calls.length===0&&f.server.size===0&&f.c.S.billFiles.length===2&&f.c.S.billAttachmentStatus.includes('尚未送出'));
 check('coordinator cleans only files created before failure',f.attachments.cleanup.length===1&&f.attachments.cleanup[0].groups[0].length===1);
 f.attachments.failAt=0;await f.c.submitBill();check('retry retains original bytes and creates one complete request',f.calls.length===1&&f.calls[0].p_items[0].steps[0].files.length===2&&f.c.S.billFiles.length===0);
 f=fixture();f.select(files());f.state.deny=true;await f.c.submitBill();check('definite write refusal cleans staged refs, retains originals',f.server.size===0&&f.c.S.billFiles.length===2&&f.attachments.cleanup.length===1&&f.attachments.cleanup[0].groups[0].length===2);
 f=fixture();f.select(files());f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'offline'};await f.c.submitBill();const frozen=JSON.stringify(f.calls[0]),key=f.calls[0].p_idempotency_key;
 check('unknown write retains immutable source attachment refs',!!f.c.loadIncomeSubmissionPending('bill')&&f.attachments.cleanup.length===0&&f.c.S.billFiles.length===2);
 const reopened=fixture(f.shared);await reopened.c.submitBill();check('reopen reconciles same operation without uploading or duplicate RPC',reopened.calls.length===1&&reopened.calls[0].p_idempotency_key===key&&JSON.stringify(reopened.calls[0])===frozen&&reopened.attachments.uploads.length===0&&!reopened.c.loadIncomeSubmissionPending('bill'));
 f=fixture();f.select(files());f.state.hooks.upload=async()=>f.switchIdentity();await f.c.submitBill();check('changed identity during upload cannot dispatch bill',f.calls.length===0&&f.server.size===0&&f.attachments.uploads.length===1);
 f=fixture();f.select(files());f.state.hooks.upload=async()=>{f.c.CURRENT_PERMISSION_SNAPSHOT={permissions:[]};};await f.c.submitBill();check('changed permission snapshot during upload cannot dispatch bill',f.calls.length===0&&f.attachments.uploads.length===1);
 f=fixture();f.select(files());const manifest=copy(f.c.S.billFiles.map(f.c.incomeFileSignature));f.c.S.billFiles=[];f.c.restoreBillAttachmentManifest(manifest);await f.c.submitBill();
 check('auth recovery missing bytes block submission before upload/RPC',f.c.S.billFiles.every(x=>x.__billMissing)&&f.calls.length===0&&f.attachments.uploads.length===0);
 f.select(files());check('reselect exact metadata replaces recovery placeholders',f.c.S.billFiles.length===2&&f.c.S.billFiles.every(x=>x instanceof File));await f.c.submitBill();check('recovered originals complete normal submit',f.calls.length===1&&f.c.S.billFiles.length===0);
 f=fixture();f.c.S.billAttachmentPickerIdentity=f.c.incomeSubmissionIdentity();f.switchIdentity();f.c.billAttachmentChange({files:files(),value:'old picker'});check('late native picker after identity change adds no private files',f.c.S.billFiles.length===0);
 f=fixture();f.select(files());const snap=f.c.incomeDirtySnapshot('bills');f.c.removeBillAttachment(0);check('file removal changes dirty snapshot',snap!==f.c.incomeDirtySnapshot('bills')&&f.c.S.billFiles.length===1);
 f.c.POSTING_IN_FLIGHT.billSubmit=true;f.select(files());f.c.removeBillAttachment(0);check('submission lock prevents selection/removal mutation',f.c.S.billFiles.length===1);
 f.c.POSTING_IN_FLIGHT.billSubmit=false;f.switchIdentity();f.c.renderBillAttachments();check('attachment private state cannot carry across accounts',f.c.S.billFiles.length===0);
 f=fixture();f.select(files());f.state.hooks.rpc=async()=>{f.nodes['bill-reason'].value='Changed while submitting';};await f.c.submitBill();check('success cannot clear later form edits/files',f.c.S.billFiles.length===2&&f.nodes['bill-reason'].value==='Changed while submitting');
 console.log('Bill form attachments PASS '+count+' checks');
})().catch(e=>{console.error(e);process.exitCode=1;});
