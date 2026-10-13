'use strict';
// Exercise the shipped submitNR, actual refund Excel/bundle and Storage pipeline.
// Only auth/route/business RPC and Storage transports use fictional data. No
// employee session, HTTP fetch, formal storage or production database is used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {officeFile}=require('./check_formal_resumable_upload.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
function between(a,b){const first=source.indexOf(a),last=source.indexOf(b,first);assert(first>=0&&last>first,a);return source.slice(first,last);}
function fn(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(match,name);const end=source.indexOf('\n}',match.index);assert(end>match.index,name);return source.slice(match.index,end+2);}
const htmlHandler=between('window.submitNR=async function(){','\n// ══ 放款申請');
// The submitted incident text exactly identified this former local read catch:
// "附件讀取失敗，請重新選擇檔案後再送出". It does not identify a DOMException.
// This legacy preparation branch reproduces dc480d0's <6 MiB FileReader path;
// the test's NotReadableError is a controlled fault, not an incident assertion.
const legacyRead=`async function fileToAttachment(file,opts){
 if(file&&(file.url||file.path||file.storagePath||file.storage_path))return {n:file.n||file.name,t:fileExt(file.n||file.name),mime:file.mime||file.type||'',size:file.size,url:file.url||'',path:file.path||file.storagePath,bucket:file.bucket};
 if(opts&&opts.directLarge&&file instanceof Blob&&file.size>=ATTACHMENT_RESUMABLE_THRESHOLD_BYTES)return {n:file.name,t:fileExt(file.name),mime:file.type,size:file.size,url:'',uploadBlob:file};
 return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve({n:file.name,t:fileExt(file.name),mime:file.type,size:file.size,url:reader.result});};reader.onerror=function(){reject(reader.error||new Error('file read failed'));};reader.readAsDataURL(file);});
}`;
const quiet={warn(){},error(){},info(){}};
const incidentMessage='附件讀取失敗，請重新選擇檔案後再送出';
const legacyHandler=htmlHandler.replaceAll('{directUpload:true}','{directLarge:true}').replace(/    var readDiagnostic=[^\n]+\n    console.warn\([^\n]+\);\n    alert\([^\n]+\);/,"    alert("+JSON.stringify(incidentMessage)+");");
assert(legacyHandler.includes(incidentMessage)&&!legacyHandler.includes('var readDiagnostic='),'controlled before handler retains exact incident catch');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let checks=0;
function check(label,value){assert(value,label);checks++;}
function fixture(options={}){
 const trace={order:[],uploads:[],downloads:[],signed:[],metadata:[],removed:[],events:[],alerts:[],dispatches:[],readerCalls:0,logs:[]};
 const user={id:'fictional-employee',authUserId:'00000000-0000-4000-8000-000000000501',n:'Fictional employee',email:'fictional-office@suiyuecare.com',active:true,dc:'DAYCARE',eid:'E1'};
 const tenant='00000000-0000-4000-8000-000000000599';
 const originalFiles=[officeFile('docx',3*1024*1024,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),officeFile('docx',Math.floor(1.3*1024*1024),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),officeFile('xlsx',Math.floor(57.9*1024),options.emptyMime?'':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')];
 const fields={'nr-amt':'100','nr-desc-purpose':'Fictional refund','nr-desc':'Fictional test request','nr-ent':'E1','nr-dept':'DAYCARE','nr-date':'2026-10-13'};
 const nodes=Object.fromEntries(Object.entries(fields).map(([id,value])=>[id,{value,style:{}}]));
 const objects=new Map(),draftPaths=[];
 const refund={originalReferenceType:'繳費單',originalReferenceNo:'FICTIONAL-BILL',originalPaymentDate:'2026-10-01',originalAmount:1000,reason:'重複繳費',description:'Fictional refund',receivableAmount:900,receivedAmount:1000,refundAmount:100,calculationNote:'1000 - 900',method:'銀行轉帳',bankName:'Fictional bank',branchName:'Fictional branch',accountName:'Fictional payee',accountNo:'0000000000'};
 const c={Blob,File,DOMException,Uint8Array,TextEncoder,URL,AbortController,Date,Math,JSON,Object,Array,Number,String,Error,Promise,Map,WeakMap,Set,parseFloat,isFinite,atob,btoa,queueMicrotask,
  console:quiet,setTimeout:(callback,ms)=>setTimeout(callback,Math.min(ms,20)),clearTimeout,
  S:{user,demoLogin:false,nrType:'refund_request',nrRec:'none',nrPay:'bank',nrFiles:originalFiles,nrPassbookFile:null,nrSubmitting:false,nrDraftMissingFileCount:0,nrDraftId:options.savedDraft?'fictional-draft':'',refundRows:[refund]},
  REQS:[],INVS:[],USERS:[user,{id:'fictional-reviewer',authUserId:'fictional-reviewer-auth',active:true}],POSTING_IN_FLIGHT:{},NR_TYPES:[{id:'refund_request',n:'退費申請'}],
  AMAP:{refund_request_none_bank:{dr:'2131',drN:'應付費用',cr:'1112',crN:'銀行存款'}},
  ATTACHMENT_MAX_BYTES:50*1024*1024,ATTACHMENT_RESUMABLE_THRESHOLD_BYTES:6*1024*1024,ATTACHMENT_UPLOAD_TIMEOUT_MS:90000,ATTACHMENT_LARGE_UPLOAD_TIMEOUT_MS:1200000,
  SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',DEFAULT_TENANT_ID:tenant,DATA_ENV_PRODUCTION:'production',DATA_ENV_TEST:'test',FINANCE_ATTACHMENT_RECORD_TYPES:['draft_requests','expense_requests','invoices','bills','vouchers'],
  FINANCE_ATTACHMENT_MIME_ALLOW:{'application/vnd.ms-excel':true,'application/vnd.openxmlformats-officedocument.wordprocessingml.document':true,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':true,'application/octet-stream':true,'text/html':true},FINANCE_ATTACHMENT_EXT_ALLOW:{docx:true,xlsx:true,xls:true,html:true},
  financeWorkspaceIdentityBlocked:false,currentFinanceAuthUserId:()=>user.authUserId,currentTenantId:()=>tenant,activeDataEnvironment:()=> 'production',hasSupabase:()=>true,requireRemotePersistence:()=>true,tenantColumnsEnabled:()=>true,tenantStoragePathEnabled:()=>true,
  fmt:value=>'NT$'+String(value),currentUserEntityId:()=> 'E1',todayIso:()=> '2026-10-13',num:value=>Number(value)||0,el:id=>nodes[id]||null,
  loadExpenseRevisionPending:()=>null,loadExpenseSubmissionPending:()=>null,verifyProductionReleaseContractForSubmission:async()=>({ok:true}),guardSubmissionIdentityDirectory:async()=>true,finalizeLazyAccountingDrafts(){},
  collectPaymentInfo:()=>({payee:'Fictional payee',bankName:'Fictional bank',bankBranch:'Fictional branch',bankNo:'0000000000',expectedPayDate:'2026-10-20',summary:'Fictional bank',feeBearer:'己方支出'}),isLazyRequestType:()=>false,currentNewReqApplicantUser:()=>user,expenseSubmissionIdentityError:()=>'',
  expenseDescriptionValidationValues:(purpose,note)=>({purpose,note}),requiredMissingItems:()=>[],formFieldLabel:(_form,_key,fallback)=>fallback,
  isExpenseApplicantRevisionMode:()=>false,normalizeRequestEntityDept:()=>({ok:true,eid:'E1',dc:'DAYCARE'}),resolveRequestAccountingMap:map=>({ok:true,map}),gE:()=>({s:'Fictional company',full:'Fictional company'}),gD:()=>({n:'Fictional department'}),currentNewReqFixedExpense:()=>false,
  applicantSubmitStep:()=>({rk:'applicant_submit',uid:user.id,a:'submitted'}),buildApprovalSteps:()=>[{rk:'ceo',uid:'fictional-reviewer',a:'',status:'pending_ceo'}],prepareApprovalRouteForSubmit:async(_u,_t,_d,_o,steps)=>({ok:true,steps}),stepActorProblem:()=>null,stepActorProblemSeverity:()=> 'fail',stepTitle:s=>s.rk||'',
  nextExpenseRequestNo:async()=>{trace.order.push('number');return 'FICTIONAL-20261013';},membershipOrgDraftUuid:()=>require('node:crypto').randomUUID(),requestNextStepLabel:()=> 'Fictional reviewer',showSubmitConfirm:async()=>true,requestWorkflowStepCount:steps=>steps.length,
  ensureSubmissionIdentityDirectoryReady:async()=>({ok:true,authReady:{ok:true}}),ensureSupabaseWriteReady:async()=>({ok:true}),ensureSupabaseStorageReady:async()=>({ok:true}),
  financeSessionMatchesWorkspace:session=>!c.financeWorkspaceIdentityBlocked&&session.user.id===user.authUserId&&session.user.email===user.email,
  productModuleEnabled:()=>true,productModuleById:()=>null,showFinanceAuthRecovery(){},
  showActionFeedback(){},setActionFeedback(){},failActionFeedback(){},completeActionFeedback(){},refreshExpenseSubmissionRecoveryActions(){},recordOpsEvent:(...args)=>{trace.events.push(args);return{id:'fictional-event'};},
  healthErrorMessage:e=>e&&e.message||String(e||''),healthIsZeroishResult:()=>true,healthBriefJson:()=>'',workflowOptionalReadAvailable:()=>true,isSchemaCacheMiss:()=>false,
  requestBankFeeAmount:()=>0,applicantProfileData:()=>({id:user.id,email:user.email}),currentFinanceReleaseContract:()=>({version:'fictional'}),buildAccountingLines:()=>[],principalAccountingLines:rows=>rows,
  saveExpenseSubmissionPending:record=>({ok:true,pending:{requestId:record.id}}),expenseSubmissionOperationIdentity:()=> 'fixture-identity',expenseSubmissionOperationCurrent:()=>!c.financeWorkspaceIdentityBlocked,
  submitExpenseRequestWithAmbiguousRecovery:async record=>{trace.dispatches.push(JSON.parse(JSON.stringify(record)));trace.order.push('dispatch');return{ok:false,unknown:true,error:Error('fictional uncertain response')};},
  friendlyErrorMessage:error=>error.message,formatStorageUploadError:error=>error.message,alert:message=>trace.alerts.push(message),
  attachmentEngineOptions:()=>({defaultBucket:'finance-attachments',recordTypes:c.FINANCE_ATTACHMENT_RECORD_TYPES,tenantId:()=>tenant,dataEnvironment:()=> 'production'}),
  isImageFileMeta:()=>false,isFinanceAttachmentRecordType:type=>c.FINANCE_ATTACHMENT_RECORD_TYPES.includes(type),
  refundDetailColumns:()=>['original_type','original_no','description','refund_amount','method','bank_name','branch_name','account_name','account_no'],refundDetailLabel:(key,fallback)=>fallback||key,refundDetailRequired:()=>false,refundScenarioLabel:()=> '未開發票',
  ensureFinanceDocumentLibrary(){throw Error('Office-only must not load PDF engine');},
  cleanupStagedUploadsBestEffort(){throw Error('unused');}
 };
 c.console={warn:(...args)=>trace.logs.push(args),info(){},error:(...args)=>trace.logs.push(args)};c.window=c;c.FinanceV4Engines={register(){}};
 c.FileReader=class {constructor(){trace.readerCalls++;}readAsDataURL(file){if(options.failReader){this.error=new DOMException('DO NOT LOG private-name.docx /private/path?token=secret','NotReadableError');queueMicrotask(()=>this.onerror());return;}file.arrayBuffer().then(bytes=>{this.result='data:'+(file.type||'application/octet-stream')+';base64,'+Buffer.from(bytes).toString('base64');this.onload();});}};
 const client={auth:{getSession:async()=>({data:{session:{access_token:'fictional-token',user:{id:user.authUserId,email:user.email}}}})},
  from:table=>({select(){return{limit:async()=>table==='notifications'&&options.notificationDenied?{error:{code:'42501',message:'fictional denied'}}:{data:[]}};},insert:async row=>{trace.metadata.push(row);return{data:row};},delete(){return{eq(){return{select:async()=>({data:[{id:'fictional-deleted'}]})};}};}}),
  rpc:async name=>{trace.order.push(name);if(name==='finance_identity_merge_audit')return{error:{code:'42501',message:'fictional administrator-only health'}};if(name==='finance_approval_actor_health')return new Promise(()=>{});return{data:[]};},
  storage:{from:()=>({upload:async(storagePath,blob,opts)=>{if(options.failNativeRead&&blob.type.includes('openxmlformats'))throw new DOMException('DO NOT LOG bank-proof.docx /private/path?token=secret','NotReadableError');trace.uploads.push({path:storagePath,blob,opts});objects.set(storagePath,blob);return{data:{path:storagePath}};},download:async storagePath=>{trace.downloads.push(storagePath);return{data:objects.get(storagePath),error:objects.has(storagePath)?null:Error('fictional missing source')};},createSignedUrl:async storagePath=>{trace.signed.push(storagePath);return{data:{signedUrl:'https://example.invalid/signed/'+trace.signed.length}};},remove:async paths=>{trace.removed.push(...paths);paths.forEach(p=>objects.delete(p));return{data:paths};}})}
 };
 c.getSb=()=>client;c.fetch=()=>{throw Error('Formal network forbidden');};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'assets/engines/attachment-engine.js'),'utf8'),c);
 const engine=c.FinanceAttachmentEngine;c.financeAttachmentEngine=()=>engine;c.fileExt=engine.fileExtension;c.normalizeFileMeta=f=>engine.normalizeFileMeta(f,c.attachmentEngineOptions());c.normalizeFiles=f=>engine.normalizeFiles(f,c.attachmentEngineOptions());c.attachmentRecordTypeFromPath=f=>engine.recordTypeFromPath(f,c.attachmentEngineOptions());c.attachmentRecordNoFromPath=f=>engine.recordNoFromPath(f,c.attachmentEngineOptions());c.attachmentLooksPdf=f=>engine.looksPdf(f);c.attachmentLooksImage=f=>engine.looksImage(f);
 const names=['withOperationTimeout','expenseAttachmentFailureDiagnostic','fileToAttachment','safeStorageName','renameImageAttachmentsForRecord','safeStorageSegment','safeStoragePath','archiveDateParts','attachmentRetentionUntil','attachmentArchiveContext','dataUrlToBlob','attachmentUploadError','attachmentMimeAllowed','assertAttachmentUploadable','assertSafeStorageObjectPath','attachmentNeedsRemoteUpload','attachmentNeedsArchivePromotion','buildAttachmentStoragePath','preflightAttachmentForUpload','preflightAttachmentsForSupabase','removeUploadedAttachmentObject','deleteAttachmentMetadata','cleanupAttachmentPersistence','verifyUploadedAttachmentReadable','financeAttachmentUploadScope','financeAttachmentUploadIdentityMatches','assertFinanceAttachmentUploadIdentity','uploadAttachmentToSupabase','uploadAttachmentWithTrackedTimeout','uploadAttachmentsToSupabase','newlyUploadedAttachmentResults','attachmentStoragePath','collectAttachmentStoragePaths','cleanupUploadedSupabaseAttachments','receiptPdfAttachment','receiptBundleAttachment','refundExcelAttachment','refundDetailProp','refundDetailValue','refundRowAmount','collectRefundInfo','systemHealthProbeRead','probeSystemHealthTable','probeSystemHealthRpc'];
 names.forEach(name=>vm.runInContext(fn(name),c));
 vm.runInContext(between('var SYSTEM_HEALTH_TABLE_CHECKS=[','function healthStatusLabel('),c);
 vm.runInContext(between('function p1HealthItemByKey(','function reportHealthIntroHtml('),c);
 c.SUBMISSION_ADVISORY_PROBE_TIMEOUT_MS=5;c.SUBMISSION_PREFLIGHT_TIMEOUT_MS=8;
 vm.runInContext(options.legacy?legacyHandler:htmlHandler,c);
 if(options.legacy)vm.runInContext(legacyRead,c);
 if(options.savedDraft)c.S.nrFiles=originalFiles.map((file,index)=>{const storagePath=tenant+'/draft_requests/production/2026/10/E1/DAYCARE/fictional-draft/draft_file/'+index+'.'+engine.fileExtension(file.name);objects.set(storagePath,file);draftPaths.push(storagePath);return{name:file.name,type:file.type,size:file.size,url:'',path:storagePath,storagePath,bucket:'finance-attachments',kind:'draft_file',draftOnly:false,dataEnv:'production',uploadedAt:'2026-10-13T00:00:00Z'};});
 if(options.unreadableReference)c.S.nrFiles=[{name:'unreadable.docx',type:originalFiles[0].type,size:originalFiles[0].size}];
 if(options.invalidMime)c.S.nrFiles=[new File(['PK generic archive'],'renamed.xlsx',{type:'application/zip'})];
 if(options.excelFails)c.refundExcelAttachment=()=>{throw Object.assign(Error('DO NOT LOG employee-name /private/file?token=secret'),{code:'CLIENT_TIMEOUT'});};
 return{c,trace,objects,originalFiles,draftPaths,nodes};
}
async function run(){
 checks=0;
 for(const options of [{},{emptyMime:true},{savedDraft:true},{savedDraft:true,emptyMime:true},{failReader:true}]){
  const f=fixture(options),selected=f.c.S.nrFiles;await f.c.submitNR();await tick();
  check('actual submit dispatches exactly once after all four attachments',f.trace.dispatches.length===1&&f.trace.uploads.length===4&&f.trace.signed.length===4&&f.trace.metadata.length===4);
  check('generated refund Excel is part of the same formal submission',f.trace.dispatches[0].files[0].n.startsWith('退費申請明細表_')&&f.trace.uploads[0].blob.type==='application/vnd.ms-excel');
  check('actual Excel contains refund reference and amount',(await f.trace.uploads[0].blob.text()).includes('FICTIONAL-BILL')&&(await f.trace.uploads[0].blob.text()).includes('<td>100</td>'));
  check('native originals never depend on FileReader',f.trace.readerCalls===0&&f.trace.dispatches[0].files.every(file=>!file.url&&!file.uploadBlob));
  check('diagnostic health errors remain advisory',f.trace.events.some(e=>e[0]==='submit_preflight'&&e[1]==='warn')&&!f.trace.events.some(e=>e[0]==='submit_preflight'&&e[1]==='critical'));
  check('health failures cannot block the actual upload pipeline',f.trace.order.indexOf('dispatch')>f.trace.order.indexOf('finance_approval_actor_health'));
  check('selected source files and form survive ambiguous outcome',f.c.S.nrFiles===selected&&f.nodes['nr-desc'].value==='Fictional test request'&&!f.c.S.nrSubmitting);
  for(let i=0;i<3;i++)check('original Office bytes remain exact',Buffer.from(await f.trace.uploads[i+1].blob.arrayBuffer()).equals(Buffer.from(await f.originalFiles[i].arrayBuffer())));
  if(options.savedDraft)check('actual promotion reads three originals and retains the old draft',f.trace.downloads.length===3&&f.draftPaths.every(p=>f.objects.has(p))&&!f.trace.removed.some(p=>f.draftPaths.includes(p)));
  check('staged metadata keeps tenant/actor/environment',f.trace.metadata.every(r=>r.tenant_id===f.c.currentTenantId()&&r.uploaded_by===f.c.S.user.id&&r.data_environment==='production'&&r.attachment_state==='staged'));
 }
 const old=fixture({legacy:true,failReader:true}),oldSelected=old.c.S.nrFiles;await old.c.submitNR();
 check('controlled old FileReader fault reproduces pre-upload stop',old.trace.readerCalls>0&&old.trace.uploads.length===0&&old.trace.dispatches.length===0);
 check('old failure order matches number + diagnostic health only',old.trace.order.join('|')==='number|finance_identity_merge_audit|finance_approval_actor_health');
 check('local read catch preserves selected sources and unlocks form',old.c.S.nrFiles===oldSelected&&!old.c.S.nrSubmitting&&old.trace.alerts.includes(incidentMessage));
 for(const options of [{unreadableReference:true,failReader:true},{failNativeRead:true},{savedDraft:true,failNativeRead:true},{excelFails:true},{invalidMime:true}]){
  const f=fixture(options),selected=f.c.S.nrFiles;await f.c.submitNR();
  check('failed preparation never dispatches a partial request',f.trace.dispatches.length===0&&f.c.S.nrFiles===selected&&!f.c.S.nrSubmitting);
  const events=f.trace.events.filter(e=>e[0]==='expense_attachment_preparation_failed');check('one bounded diagnostic records exact phase',events.length===1&&events[0][4].stage=== (options.excelFails?'refund_excel_prepare':options.invalidMime?'upload_preflight':options.unreadableReference?'source_read':'request_upload'));
  const event=events[0],meta=JSON.parse(JSON.stringify(event[4]));
  check('diagnostic has opaque attempt ID and only safe fields',/^expense_submit_[a-f0-9-]{36}$/i.test(meta.correlationId)&&Object.keys(meta).sort().join('|')==='correlationId|errorCode|errorName|stage');
  check('diagnostic contains no file name/content/path/token or original message',!JSON.stringify(event).includes('DO NOT LOG')&&!JSON.stringify(event).includes('private')&&!JSON.stringify(event).includes('token=')&&!JSON.stringify(event).includes('.docx')&&!JSON.stringify(event).includes('employee-name'));
  check('console contains no raw error/message/path/token or filename',!JSON.stringify(f.trace.logs).includes('DO NOT LOG')&&!JSON.stringify(f.trace.logs).includes('private')&&!JSON.stringify(f.trace.logs).includes('token=')&&!JSON.stringify(f.trace.logs).includes('.docx'));
  check('failure UI shows same correlation ID',f.trace.alerts.some(m=>m.includes(meta.correlationId)));
  if(options.failNativeRead||options.unreadableReference)check('NotReadableError yields actionable reselection without discarding form',meta.errorName==='NotReadableError'&&f.trace.alerts.some(m=>m.includes('重新選取')&&m.includes('保留')));
  if(options.savedDraft)check('failed promotion never deletes original draft objects',f.draftPaths.every(p=>f.objects.has(p))&&!f.trace.removed.some(p=>f.draftPaths.includes(p)));
 }
 const denied=fixture({notificationDenied:true});await denied.c.submitNR();
 check('genuine required contract denial still blocks before uploading',denied.trace.dispatches.length===0&&denied.trace.uploads.length===0&&denied.trace.events.some(e=>e[0]==='submit_preflight'&&e[1]==='critical'));
 const brokenLogger=fixture({excelFails:true});brokenLogger.c.recordOpsEvent=(...args)=>{if(args[0]==='expense_attachment_preparation_failed')throw Error('fictional diagnostic unavailable');brokenLogger.trace.events.push(args);return{id:'fictional-event'};};await brokenLogger.c.submitNR();check('diagnostic transport cannot break preserved failure UI',brokenLogger.trace.dispatches.length===0&&!brokenLogger.c.S.nrSubmitting&&brokenLogger.trace.alerts.some(m=>m.includes('事件識別')));
 console.log('Refund Office submitNR: '+checks+' checks PASS; controlled legacy read fault, native files, saved drafts, real refund Excel, privacy-safe diagnostics and fail-closed contract');
 return{checks};
}
module.exports={runRefundOfficeSubmissionChecks:run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
