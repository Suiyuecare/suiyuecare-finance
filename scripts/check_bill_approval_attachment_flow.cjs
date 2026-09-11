#!/usr/bin/env node
'use strict';
// Real shipped Bill/FileReader/upload coordinator/CAS/RPC adapter/timeline and
// private-download functions. DOM, authority service and remote transports are
// fictional local boundaries; this does not claim live Storage/RLS acceptance.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),source=read('index.html');
const clone=x=>JSON.parse(JSON.stringify(x));let count=0;
function check(label,value){assert.ok(value,label);count++;console.log('PASS '+label);}
function range(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function fn(name){let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;
 for(let i=source.indexOf('{',start);i<source.length;i++)if(source[i]==='}'){const candidate=source.slice(start,i+1);try{new vm.Script(candidate);return candidate;}catch(_){}}
 throw new Error('Cannot extract actual '+name);}
const origin='https://storage.example.invalid';
function fixture(opts={}){
 const trace={reads:[],uploads:[],rpc:[],alerts:[],cleanup:[],downloads:[],signs:[],failures:[],feedback:[],completed:[]};
 const input={id:'bill-appr-files',files:[{name:'FICT-BILL-001_虛構九月照護費.pdf',type:'application/pdf',size:16}]};
 const dom={'bill-appr-files':input,'bill-appr-c':{value:'本機虛構附件測試',removeAttribute(){},setAttribute(){},focus(){}},'bill-appr-add-user':{value:''}};
 const bill={id:'fictional-bill-1',no:'FICT-BILL-001',item:'虛構九月照護費',eid:'FICT-ENTITY',dc:'FICT-DEPT',amt:1250,rowVersion:7,approvalStatus:'pending_accountant',steps:[{rk:'applicant_submit',a:'approved',files:[]},{rk:'accountant_bill',uid:'FICT-ACCOUNTANT',status:'pending_accountant',a:'',files:[]}]};
 let identity='fictional-uuid-1';
 class Reader{readAsDataURL(file){trace.reads.push(file.name);if(opts.readFail){this.error=new Error('fictional file read failure');this.onerror();}else{this.result='data:'+file.type+';base64,UEZERklDVFVSRQ==';this.onload();}}}
 const c={console:{warn(){},info(){},error(){}},URL,Blob,FileReader:Reader,setTimeout,clearTimeout,Date,Math,JSON,Number,Promise,
  SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',SUPABASE_URL:origin,SUPABASE_ANON_KEY:'fictional',ATTACHMENT_UPLOAD_TIMEOUT_MS:30000,ATTACHMENT_BATCH_TIMEOUT_MS:60000,
  APPROVAL_FROZEN_EXPECTED_STEPS:{identity:'',modal:null,bulk:{}},APPROVAL_ACTION_IN_FLIGHT:{},ATTACHMENT_DOWNLOAD_HEALTH:{},STEP_DOWNLOADS:[],REQS:[],INVS:[],BILLS:[bill],
  S:{demoLogin:false,user:{id:'FICT-ACCOUNTANT',role:'accountant',n:'虛構會計'}},el:id=>dom[id]||null,num:x=>Number(x||0),cloneSettingValue:clone,escAttr:x=>String(x||'').replace(/[&<>"']/g,'_'),normDate:x=>x,
  activeDataEnvironment:()=> 'test',todayIso:()=> '2026-09-11',approvalFastBootstrapIdentity:()=>identity,
  activeStep:r=>r.steps.find(s=>!s.a)||null,activeStepIndex:r=>r.steps.findIndex(s=>!s.a),approvalMutationRuntimeReady:()=>!opts.runtimeDenied,
  approvalRecordSourceTable:()=> 'bills',approvalFastFinalizationProbe:false,approvalRowIsLocallyVerified:()=>!opts.unverified,
  financeRuntimeAccess:(action,table,r,{step})=>({ok:!opts.denied&&step?.uid===c.S.user.id}),approvalRecordReconcilePending:()=>false,
  approvalRecordsActionAvailability:(table,rows)=>({ok:!opts.scopeDenied,rows,message:'fixture scope denied'}),requireApprovalRecordsActionAvailability:()=>!opts.scopeDenied,
  approvalRowsHaveReconcilePending:()=>false,hasSupabase:()=>true,billBatchLimitError:()=>null,canReturnPreviousStep:()=>true,confirmReturnPreviousAction:()=>true,
  // Storage access/preflight has independent tests. Keep this transport boundary
  // explicit, and assert the real batch coordinator delivers full local bytes.
  preflightAttachmentsForSupabase:async files=>files,uploadAttachmentToSupabase:async(file,ctx)=>{trace.uploads.push({file:clone(file),ctx:clone(ctx)});if(opts.uploadFail)throw new Error('fictional storage denied');
   return {...file,url:'',bucket:'finance-attachments',path:'bills/test/FICT-BILL-001/bill_approval/uploaded.pdf',storagePath:'bills/test/FICT-BILL-001/bill_approval/uploaded.pdf'};},
  cleanupUploadedSupabaseAttachments:async(groups,label)=>{trace.cleanup.push({groups:clone(groups),label});return 0;},
  attachmentUploadError:(message,meta)=>Object.assign(new Error(message),meta),formatStorageUploadError:e=>e.message||String(e),
  incomeActionContext:()=>({key:'fictional-idempotent-key'}),clearIncomeActionContext(){},readbackApprovalStepMutation(){},
  financeMutationRpcWithAmbiguousRetry:async(name,args,length,readback,context,meta,call)=>({response:await call()}),
  getSb:()=>({rpc:async(name,args)=>{trace.rpc.push({name,args:clone(args)});if(opts.rpcError)return {error:opts.rpcError};
   for(const row of c.BILLS){row.steps[1]={...row.steps[1],a:'approved',n:'虛構會計',files:clone(args.p_files)};row.rowVersion++;}return {data:{ok:true,count:c.BILLS.length}};},storage:{from:bucket=>({createSignedUrl:async(p,expiry,options)=>{trace.signs.push({bucket,path:p,expiry,options});return {data:{signedUrl:origin+'/storage/v1/object/sign/'+bucket+'/'+p+'?token=fictional-only'}};}})}}),
  normalizeSettingValue:x=>x,isRpcMissing:()=>false,rawErrorText:e=>e.message||String(e),approvalRefreshAfterContentVersionChanged(){},
  reloadBillsByIds:async()=>true,approvalExpectedStepChanged:(kind,row,expected)=>row.rowVersion!==expected.row_version,approvalSetReconcilePending(){},refreshApprovalAfterCommittedAction:async()=>true,
  recordBillWriteFailure:(label,row,result)=>{trace.failures.push(result.error?.message);},buildBills(){},buildApprovals(){},closeAppr(){trace.closed=true;},
  alert:message=>{c.ACTION_FEEDBACK_ALERTED=true;trace.alerts.push(message);},friendlyErrorMessage:e=>e.message||String(e),canDownloadAttachment:()=>!opts.downloadDenied,recordAttachmentAccess(){},isReceiptBundleAttachment:()=>false,
  markAttachmentDownloadFailure:(file,kind)=>trace.failures.push(kind),attachmentDownloadFailureMessage:()=> 'fictional missing file',attachmentDownloadFailureKind:()=> 'permission',
  document:{createElement:()=>({style:{},click(){trace.downloads.push({href:this.href,name:this.download});}}),body:{appendChild(){},removeChild(){}},addEventListener(){}},
  fetch:()=>{throw new Error('Network forbidden in local fixture');},ACTION_FEEDBACK_ALERTED:false,ACTION_FEEDBACK_ACTIVE:0,
  showActionFeedback(){},hideActionFeedback(){},completeActionFeedback:title=>trace.completed.push(title),failActionFeedback:(title,message)=>trace.feedback.push({title,message})};c.window=c;
 vm.createContext(c);for(const file of ['finance-v4-engine-registry.js','attachment-engine.js','approval-engine.js'])vm.runInContext(read('assets/engines/'+file),c);
 const attachment=c.FinanceAttachmentEngine;Object.assign(c,{financeAttachmentEngine:()=>attachment,normalizeFileMeta:attachment.normalizeFileMeta,normalizeFiles:attachment.normalizeFiles,uniqueAttachments:attachment.uniqueFiles,attachmentStoragePath:attachment.storagePath,attachmentRecordNoFromPath:attachment.recordNoFromPath,attachmentRecordTypeFromPath:attachment.recordTypeFromPath,attachmentInList:attachment.inList,fileIdentity:attachment.fileIdentity});
 const names=['fileExt','fileToAttachment','readStepFiles','approvalActionPayload','approvalActionValidation','approvalActionValidationError','approvalActionPreflight',
  'uploadAttachmentWithTrackedTimeout','uploadAttachmentsToSupabase','canActStep','canActBill','billCreatedBucket','billGroupKey','billGroupRows','billGroupLeader','billGroupTotal','billGroupCount','billGroupNo',
  'approvalRowVersion','approvalFrozenExpectedState','approvalExpectedStepIds','approvalExpectedPayloadForKind','approvalFreezeExpectedSteps','approvalExpectedVersionsValid','approvalFrozenExpectedSteps','approvalValidatedExpectedSteps','approvalFreezeModalExpectedSteps','approvalModalExpectedSteps','billExpectedStepPayload',
  'billAttachmentFailure','uploadBillActionFiles','billActiveStepTransaction','approveBillGroupCore','returnBillGroupCore','rejectBillGroupCore','approvalContentVersionChangedError','approvalContentVersionFriendlyError','cleanupApprovalFilesAfterDefiniteFailure','attachmentDownloadHealthKey','stepAttachmentHtml','wrapApprovalActionLock','withActionFeedback','wrapActionFeedback','installActionFeedbackWrappers'];
 vm.runInContext(names.map(fn).join('\n')+'\n'+range('window.apprApproveBill=async function(','window.submitProcurementPaymentInfo='),c);
 vm.runInContext(range('function findAttachmentOwner(','function currentUserDownloadIds(')+range('function attachmentSignedDownloadUrl(','function storagePublicUrl(')+range('function attachmentDownloadFileName(','function stepAttachmentHtml('),c);
 c.approvalFreezeModalExpectedSteps('bill',c.BILLS);for(const name of ['apprApproveBill','apprReturnPreviousBill','apprRejectBill'])c.wrapApprovalActionLock(name);c.installActionFeedbackWrappers();
 return {c,bill,input,dom,trace,setIdentity:value=>{identity=value;}};
}
(async()=>{
 let f=fixture();await f.c.apprApproveBill(f.bill.id);
 check('actual FileReader and upload coordinator receive selected generated PDF bytes',f.trace.reads.length===1&&f.trace.uploads[0].file.url.startsWith('data:application/pdf;base64,')&&f.trace.uploads[0].ctx.recordType==='bills'&&f.trace.uploads[0].ctx.kind==='bill_approval');
 const call=f.trace.rpc[0];check('actual bill v2 RPC receives uploaded path, original version and active actor',call.name==='finance_bill_act_active_step_v2'&&call.args.p_files.length===1&&call.args.p_files[0].path.endsWith('uploaded.pdf')&&!call.args.p_files[0].url&&call.args.p_expected_steps[f.bill.id].row_version===7&&call.args.p_expected_steps[f.bill.id].finance_user_id==='FICT-ACCOUNTANT'&&call.args.p_data_environment==='test');
 check('successful readback exposes committed step attachment and closes modal',f.bill.steps[1].files[0].path===call.args.p_files[0].path&&f.trace.closed===true);
 const engine=f.c.FinanceApprovalEngine,rows=engine.timelineRows(f.bill,{}, {normalizeFiles:f.c.normalizeFiles,activeStep:f.c.activeStep});
 const markup=engine.approvalTimelineRowHtml(rows.find(r=>r.originalIndex===1),{stepAttachmentHtml:f.c.stepAttachmentHtml});
 check('actual subsequent approval timeline offers committed attachment download',markup.includes('downloadStepAttachment(')&&markup.includes('uploaded')===false&&f.c.STEP_DOWNLOADS.length===1);
 await f.c.downloadStepAttachment(0);check('actual step downloader signs private original path and uses bill name',f.trace.signs[0].path===call.args.p_files[0].path&&f.trace.signs[0].bucket==='finance-attachments'&&f.trace.signs[0].options.download===true&&f.trace.downloads[0].name==='FICT-BILL-001_虛構九月照護費.pdf');
 for(const opts of [{denied:true},{runtimeDenied:true},{unverified:true},{scopeDenied:true}]){f=fixture(opts);await f.c.apprApproveBill(f.bill.id);check('denied authority/runtime never reads/uploads or submits '+Object.keys(opts)[0],f.trace.reads.length===0&&f.trace.uploads.length===0&&f.trace.rpc.length===0);}
 f=fixture();f.bill.rowVersion=0;f.c.approvalFreezeModalExpectedSteps('bill',f.c.BILLS);await f.c.apprApproveBill(f.bill.id);check('missing positive content version stops before file I/O',f.trace.reads.length===0&&f.trace.rpc.length===0&&f.trace.alerts.length===1);
 f=fixture();f.setIdentity('different-fictional-uuid');await f.c.apprApproveBill(f.bill.id);check('changed identity invalidates modal version before file I/O',f.trace.reads.length===0&&f.trace.rpc.length===0);
 f=fixture({rpcError:{code:'40001',message:'content version changed'}});await f.c.apprApproveBill(f.bill.id);check('server CAS rejection retains local selection and cleans only uploaded attachment',f.trace.rpc.length===1&&f.trace.cleanup.some(x=>x.label.includes('版本衝突'))&&f.input.files.length===1&&!f.trace.closed&&f.bill.steps[1].files.length===0);
 for(const kind of ['readFail','uploadFail']){f=fixture({[kind]:true});const result=await f.c.apprApproveBill(f.bill.id);check(kind+' sends no RPC, retains selection and releases action lock',result===false&&f.trace.rpc.length===0&&f.input.files.length===1&&!f.trace.closed&&Object.keys(f.c.APPROVAL_ACTION_IN_FLIGHT).length===0);check(kind+' gives persistent actionable error and no false success',f.trace.alerts.length===1&&f.trace.alerts[0].includes('這次簽核尚未送出')&&f.trace.alerts[0].includes('已保留')&&f.trace.completed.length===0);}
 for(const [name,action,kind] of [['apprReturnPreviousBill','return','bill_return'],['apprRejectBill','reject','bill_reject']]){
  f=fixture();await f.c[name](f.bill.id);check(name+' passes selected attachment to its original atomic action',f.trace.rpc.length===1&&f.trace.rpc[0].args.p_action===action&&f.trace.rpc[0].args.p_files.length===1&&f.trace.uploads[0].ctx.kind===kind);
  for(const failure of ['readFail','uploadFail']){f=fixture({[failure]:true});const result=await f.c[name](f.bill.id);check(name+' '+failure+' stops before RPC with retained selection and actionable error',result===false&&f.trace.rpc.length===0&&f.input.files.length===1&&f.trace.alerts.some(x=>x.includes('這次簽核尚未送出'))&&f.trace.completed.length===0&&Object.keys(f.c.APPROVAL_ACTION_IN_FLIGHT).length===0);}
 }
 console.log('Bill attachment flow: '+count+' checks passed; fictional local transports only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
