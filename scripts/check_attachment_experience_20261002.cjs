'use strict';
// Exercise the shipped handlers with fictional browser and Storage transports.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function between(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert(a>=0&&b>a,'source range '+start);
  return source.slice(a,b);
}
function windowHandler(name){
  const start=source.indexOf('window.'+name+'=');
  assert(start>=0,'handler '+name);
  const end=source.indexOf('\n};',start);
  assert(end>start,'handler end '+name);
  return source.slice(start,end+3);
}
function draftFixture(){
  const file=new Blob([Buffer.alloc(512)],{type:'application/pdf'});
  file.name='fixture.pdf';
  const counts={reads:0,uploads:0,writes:0,clean:0};
  const saved=[],alerts=[],uploadInputs=[],node={style:{display:'none'},textContent:''};
  let auth='auth-a',tenant='tenant-a',environment='production';
  const c={Date,Promise,WeakMap,Object,Array,String,Number,Error,Math,Blob,console:{warn(){},error(){}},setTimeout(){},
    S:{demoLogin:false,user:{id:'user-a',dc:'A100'},page:'newreq',nrType:'expense_reimbursement',nrStep:3,nrFiles:[file],nrDraftId:'',nrSavingDraft:false},DRAFTS:[],SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',
    num:value=>Number(value)||0,activeDataEnvironment:()=>environment,hasSupabase:()=>true,requireRemotePersistence:()=>true,allowLocalPersistence:()=>false,
    financeDraftReadIdentity:()=>[auth,tenant,environment].join('|'),draftReadinessForCurrentUser:()=>({identity:[auth,tenant,environment].join('|')}),
    fileExt:name=>String(name||'').split('.').pop().toLowerCase(),
    normalizeFileMeta:raw=>({n:raw.n||raw.name||'',mime:raw.mime||raw.type||'',size:raw.size||0,url:raw.url||'',path:raw.path||raw.storagePath||'',dataEnv:raw.dataEnv||environment,bucket:raw.bucket||'finance-attachments'}),
    attachmentRecordTypeFromPath:raw=>String(raw.path||'').split('/')[1],attachmentRecordNoFromPath:raw=>String(raw.path||'').split('/')[7],
    fileToAttachment:async raw=>{counts.reads++;return{n:raw.name,mime:raw.type,size:raw.size,url:'data:application/pdf;base64,UEZERg=='};},
    uploadAttachmentsToSupabase:async(files,context)=>{counts.uploads++;uploadInputs.push(files[0]);return[{...files[0],path:tenant+'/draft_requests/'+environment+'/2026/10/E1/A100/'+context.recordNo+'/draft_file/'+counts.uploads+'.pdf',bucket:'finance-attachments'}];},
    todayIso:()=> '2026-10-02',currentUserEntityId:()=> 'E1',localPersistenceDisabledMessage:()=> 'local disabled',
    isExpenseApplicantRevisionMode:()=>false,loadDrafts(){},requestTypeLabel:type=>type,collectNRFormState:()=>({fields:{'nr-app':'匿名員工','nr-desc':'保留草稿'}}),stampDraftOwner:d=>d,
    saveDraftRemote:async draft=>{counts.writes++;saved.push(draft);return counts.writes>1;},
    friendlyErrorMessage:error=>error&&error.message||'尚未確認',alert:text=>alerts.push(String(text)),renderDrafts(){},updateDraftCounters(){},buildApprovals(){},notifyDraftMutation(){},
    markNRClean(){counts.clean++;},el:id=>id==='nr-ok'?node:null};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(between('function sanitizeDraftFile(','function sanitizeTravelDraftFiles('),c);
  vm.runInContext(between('var DRAFT_FILE_UPLOAD_CACHE=','function collectNRFormState()'),c);
  vm.runInContext(windowHandler('nrSaveDraft'),c);
  return{c,file,counts,saved,alerts,uploadInputs,node,setScope(next){auth=next.auth||auth;tenant=next.tenant||tenant;environment=next.environment||environment;}};
}
function viewerFixture(){
  const files=[{n:'first.png',path:'private/first.png',url:'https://old.invalid/first.png'},{n:'second.png',path:'private/second.png'}];
  const nodes={
    'm-receipt-viewer':{style:{display:'none'}},
    'receipt-viewer-title':{textContent:''},
    'receipt-viewer-toolbar':{innerHTML:''},
    'receipt-viewer-body':{innerHTML:'',querySelector(selector){
      if(!/<(?:img|iframe)\b/.test(this.innerHTML))return null;
      if(selector.indexOf('receipt-viewer-img')<0)return null;
      return this.media||(this.media={style:{}});
    }}
  };
  let identity='auth-a',allowed=true,signer=async file=>'https://signed.invalid/'+file.n;
  const signed=[];
  const c={console:{warn(){}},REQS:[{id:'REQ-1',no:'REQ-1',files}],S:{},
    normalizeFiles:list=>list||[],attachmentStoragePath:file=>file.path||'',isReceiptBundleAttachment:()=>false,
    attachmentLooksImage:file=>/\.png$/.test(file.n),attachmentLooksPdf:file=>/\.pdf$/.test(file.n),fileIdentity:file=>file.path,
    attachmentDownloadIdentity:()=>identity,canDownloadAttachment:()=>allowed,
    signAttachmentUrl:file=>{signed.push(file.n);return signer(file);},
    attachmentDownloadFailureKind:()=> 'permission',attachmentDownloadFailureMessage:()=> '附件權限不足',
    escAttr:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    downloadFileMeta(){},alert(){},el:id=>nodes[id]||null};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(between('var RECEIPT_VIEWER_STATE=','function lazyExcelAttachment('),c);
  return{c,nodes,files,signed,setSigner:next=>signer=next,setIdentity:next=>identity=next,setAllowed:next=>allowed=next};
}
async function main(){
  {
    const file=new Blob([Buffer.from('%PDF-fictional')],{type:'application/pdf'});
    file.name='direct-draft.pdf';
    const trace={uploads:[],rows:[],signed:0};
    const client={storage:{from:()=>({upload:async(path,blob,options)=>{trace.uploads.push({path,blob,options});return{data:{path}};}})},
      from:()=>({insert:async row=>{trace.rows.push(row);return{data:row};}})};
    const c={Date,Math,Promise,Blob,console:{warn(){}},SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',
      S:{demoLogin:false,user:{id:'fictional-user'}},ATTACHMENT_UPLOAD_TIMEOUT_MS:30000,ATTACHMENT_BATCH_TIMEOUT_MS:120000,
      normalizeFileMeta:att=>({n:att.n||att.name,t:att.t||'pdf',mime:att.mime||att.type||'',size:att.size||0,url:att.url||'',path:att.path||'',kind:att.kind||'',bucket:att.bucket||'finance-attachments'}),
      attachmentStoragePath:att=>att.path||'',financeAttachmentEngine:()=>({needsRemoteUpload:att=>/^data:/i.test(att.url||'')}),attachmentEngineOptions:()=>({}),
      attachmentNeedsArchivePromotion:()=>false,dataUrlToBlob:()=>{throw Error('unexpected base64 decoding');},
      assertAttachmentUploadable:(att,blob)=>assert.equal(blob,file),
      buildAttachmentStoragePath:()=>({path:'draft_requests/production/fictional/direct-draft.pdf',name:'direct-draft.pdf',archive:{recordType:'draft_requests',recordNo:'fictional',kind:'draft_file',year:2026,ym:'2026-10',dataEnvironment:'production',tenantId:'fictional-tenant',entityId:'E1',departmentCode:'A100',recordDate:'2026-10-02',retentionUntil:'2036-10-02'}}),
      renameImageAttachmentsForRecord:files=>files,requireRemotePersistence:()=>true,hasSupabase:()=>true,
      ensureSupabaseStorageReady:async()=>({ok:true}),getSb:()=>client,tenantColumnsEnabled:()=>true,
      verifyUploadedAttachmentReadable:async()=>{trace.signed++;},
      isSchemaCacheMiss:()=>false,formatStorageUploadError:error=>error.message||String(error),
      attachmentUploadError:(message,details)=>Object.assign(Error(message),details),
      cleanupUploadedSupabaseAttachments:async()=>0,uploadAttachmentWithTrackedTimeout:(att,ctx)=>c.uploadAttachmentToSupabase(att,ctx)};
    c.window=c;vm.createContext(c);
    vm.runInContext(between('function attachmentNeedsRemoteUpload(','function attachmentNeedsArchivePromotion(')
      +between('function preflightAttachmentForUpload(','async function removeUploadedAttachmentObject(')
      +between('async function uploadAttachmentToSupabase(','function recordLateAttachmentCleanupFailure(')
      +between('async function uploadAttachmentsToSupabase(','function attachmentStoragePath('),c);
    const result=await c.uploadAttachmentsToSupabase([{n:file.name,mime:file.type,size:file.size,kind:'draft_file',uploadBlob:file}],{recordType:'draft_requests',recordNo:'fictional',kind:'draft_file'});
    assert.equal(trace.uploads.length,1);
    assert.equal(trace.uploads[0].blob,file,'Storage receives original Blob bytes without base64 conversion');
    assert.equal(trace.uploads[0].options.upsert,false);
    assert.equal(trace.rows[0].attachment_state,'staged');
    assert.equal(trace.rows[0].tenant_id,'fictional-tenant');
    assert.equal(trace.signed,1,'existing download verification still executes');
    assert.equal(result[0].path,trace.uploads[0].path);
    assert.equal(Object.hasOwn(result[0],'uploadBlob'),false,'persisted metadata never contains a Blob');
    console.log('PASS remote draft Storage pipeline uploads original Blob and returns clean scoped metadata');
  }
  {
    const x=draftFixture();
    assert.equal(await x.c.nrSaveDraft(),false);
    const firstId=x.c.S.nrDraftId,firstPath=x.saved[0].files[0].path;
    assert.equal(x.counts.uploads,1);
    assert.equal(x.counts.clean,0);
    assert.equal(x.node.style.display,'none');
    assert.equal(await x.c.nrSaveDraft(),true);
    assert.equal(x.counts.uploads,1,'unconfirmed draft retry reuses confirmed Storage object');
    assert.equal(x.counts.reads,0,'remote draft never base64-encodes the raw File');
    assert.equal(x.uploadInputs[0].uploadBlob,x.file,'remote draft sends the original Blob');
    assert.equal(x.uploadInputs[0].url,'','remote draft does not create a Data URL');
    assert.equal(x.saved[1].id,firstId);
    assert.equal(x.saved[1].files[0].path,firstPath);
    assert.equal(x.counts.clean,1,'only database-confirmed save shows success');
    assert.equal(x.c.S.nrFiles[0],x.file,'selected File remains available for preview/submit');
    await x.c.serializeDraftFiles('another-draft');
    assert.equal(x.counts.uploads,2,'different draft ID cannot reuse old path');
    x.setScope({tenant:'tenant-b'});await x.c.serializeDraftFiles(firstId);
    x.setScope({environment:'test'});await x.c.serializeDraftFiles(firstId);
    x.setScope({auth:'auth-b'});await x.c.serializeDraftFiles(firstId);
    assert.equal(x.counts.uploads,5,'tenant, environment and auth each isolate staged file reuse');
    console.log('PASS draft retry reuses one confirmed upload without claiming database success');
  }
  {
    const x=draftFixture();let failed=true;
    x.c.uploadAttachmentsToSupabase=async files=>{x.counts.uploads++;if(failed){failed=false;throw Error('fictional network error');}return[{...files[0],path:'tenant-a/draft_requests/production/retry.pdf'}];};
    await assert.rejects(x.c.serializeDraftFiles('draft-retry'));
    await x.c.serializeDraftFiles('draft-retry');
    assert.equal(x.counts.uploads,2,'failed upload never enters cache');
    console.log('PASS failed upload is retried rather than treated as saved');
  }
  {
    const x=draftFixture(),late=deferred();
    x.c.uploadAttachmentsToSupabase=async files=>{x.counts.uploads++;if(x.counts.uploads===1)return late.promise;return[{...files[0],path:'tenant-a/draft_requests/production/retry.pdf'}];};
    const oldSave=x.c.serializeDraftFiles('draft-identity');await tick();
    x.setScope({auth:'auth-b'});
    late.resolve([{n:'fixture.pdf',path:'tenant-a/draft_requests/production/old-user.pdf'}]);
    await assert.rejects(oldSave,/登入身分已變更/);
    await x.c.serializeDraftFiles('draft-identity');
    assert.equal(x.counts.uploads,2,'late result from old login must not seed the new login cache');
    console.log('PASS identity change during upload cannot reuse old account result');
  }
  {
    const x=viewerFixture(),first=deferred(),second=deferred();
    x.setSigner(file=>file.n==='first.png'?first.promise:second.promise);
    x.c.openReceiptViewerForRequest('REQ-1');
    x.c.receiptViewerMove(1);
    second.resolve('https://signed.invalid/second.png');await tick();
    assert.match(x.nodes['receipt-viewer-body'].innerHTML,/second\.png/);
    first.resolve('https://signed.invalid/first.png');await tick();
    assert.doesNotMatch(x.nodes['receipt-viewer-body'].innerHTML,/signed\.invalid\/first\.png/,'late first result cannot overwrite second');
    const calls=x.signed.length;
    x.c.receiptViewerZoom(0.2);x.c.receiptViewerRotate();
    assert.equal(x.signed.length,calls,'zoom and rotation do not issue fresh signed URLs');
    assert.match(x.nodes['receipt-viewer-body'].media.style.transform,/scale\(1\.2\).*rotate\(90deg\)/);
    console.log('PASS viewer ignores out-of-order signatures and avoids zoom re-signing');
  }
  {
    const x=viewerFixture(),late=deferred();x.setSigner(()=>late.promise);
    x.c.openReceiptViewerForRequest('REQ-1');x.c.closeReceiptViewer();
    late.resolve('https://signed.invalid/first.png');await tick();
    assert.equal(x.nodes['receipt-viewer-body'].innerHTML,'','closed viewer cannot be repainted by a late result');
    console.log('PASS closed viewer ignores late signatures');
  }
  {
    const x=viewerFixture(),late=deferred();x.setSigner(()=>late.promise);
    x.c.openReceiptViewerForRequest('REQ-1');x.setIdentity('auth-b');
    late.resolve('https://signed.invalid/first.png');await tick();
    assert.doesNotMatch(x.nodes['receipt-viewer-body'].innerHTML,/<img\b/);
    assert.match(x.nodes['receipt-viewer-body'].innerHTML,/登入身分/);
    console.log('PASS account switch blocks late private preview');
  }
  {
    const x=viewerFixture();x.setAllowed(false);
    x.c.openReceiptViewerForRequest('REQ-1');
    assert.equal(x.signed.length,0,'unauthorized file is never signed');
    assert.match(x.nodes['receipt-viewer-body'].innerHTML,/無法預覽/);
    x.setAllowed(true);x.setSigner(async()=>{throw Object.assign(Error('denied'),{status:403});});
    x.c.openReceiptViewerForRequest('REQ-1');await tick();
    assert.doesNotMatch(x.nodes['receipt-viewer-body'].innerHTML,/old\.invalid|<img\b/,'sign failure never renders stale URL');
    assert.match(x.nodes['receipt-viewer-body'].innerHTML,/附件權限不足/);
    x.setSigner(async()=> '');x.c.openReceiptViewerForRequest('REQ-1');await tick();
    assert.doesNotMatch(x.nodes['receipt-viewer-body'].innerHTML,/old\.invalid|<img\b/,'empty signing result never renders stale URL');
    x.setSigner(async()=> 'https://signed.invalid/first.png');x.c.openReceiptViewerForRequest('REQ-1');await tick();
    x.c.receiptViewerMediaFailed(x.c.RECEIPT_VIEWER_RENDER_GENERATION);
    assert.match(x.nodes['receipt-viewer-body'].innerHTML,/重新載入附件/);
    console.log('PASS denied, failed and media-error previews give safe retry states');
  }
  {
    const nodes={'batch-pw':{style:{}},'batch-prog':{style:{}},'batch-pl':{textContent:''},'batch-fn':{textContent:''},'batch-dz':{classList:{add(){}}}};
    const c={S:{},BATCH_INVOICE_READ_GENERATION:0,el:id=>nodes[id]};c.window=c;vm.createContext(c);
    vm.runInContext(between('function setBatchInvoiceUploadFile(','function invoiceOcrDataToBatchRows('),c);
    const selected={name:'invoice.pdf'};c.setBatchInvoiceUploadFile(selected);
    assert.equal(c.S.bUploadFile,selected);
    assert.equal(nodes['batch-prog'].style.width,'0%');
    assert.match(nodes['batch-pl'].textContent,/尚未保存/);
    assert.doesNotMatch(nodes['batch-pl'].textContent,/已上傳/);
    console.log('PASS selecting a batch invoice does not claim it was uploaded');
  }
  {
    const selected={name:'passbook.jpg',type:'image/jpeg',size:123};
    const statuses=[];let applied=0;
    const c={S:{nrRevisionConfirmationPending:false,nrPassbookFile:null},OPENAI_INVOICE_OCR_ENDPOINT:'https://example.invalid/ocr',SUPABASE_ANON_KEY:'fixture',
      employeeAcceptedFiles:files=>files,isExpenseApplicantRevisionMode:()=>false,renderEmployeePassbookFile(){},productModuleEnabled:()=>true,
      setPassbookStatus:text=>statuses.push(text),fileToAttachment:async()=>({url:'data:image/jpeg;base64,QQ=='}),
      fetch:async()=>({ok:true,json:async()=>({bank:'fictional'})}),applyPassbookInfo:()=>applied++,ocrErrorMessage:error=>error.message,
      console:{error(){}},alert(){}};
    c.window=c;vm.createContext(c);
    vm.runInContext(between('window.passbookFileChange=','function collectPaymentInfo('),c);
    await c.passbookFileChange({files:[selected],value:'x'});
    assert.equal(applied,1);
    assert(statuses.some(text=>text.includes('尚未保存')));
    assert(!statuses.some(text=>text.includes('已上傳')));
    console.log('PASS passbook OCR reports recognition without claiming Storage persistence');
  }
  {
    const first=deferred(),a={name:'old.jpg',type:'image/jpeg'},b={name:'new.jpg',type:'image/jpeg'};
    const statuses=[];let applied=0,fetchCount=0;
    const c={S:{nrRevisionConfirmationPending:false,nrPassbookFile:null},OPENAI_INVOICE_OCR_ENDPOINT:'https://example.invalid/ocr',SUPABASE_ANON_KEY:'fixture',
      employeeAcceptedFiles:files=>files,isExpenseApplicantRevisionMode:()=>false,renderEmployeePassbookFile(){},productModuleEnabled:()=>true,
      setPassbookStatus:text=>statuses.push(text),fileToAttachment:async()=>({url:'data:image/jpeg;base64,QQ=='}),
      fetch:()=>++fetchCount===1?first.promise:Promise.resolve({ok:true,json:async()=>({bank:'new'})}),
      applyPassbookInfo:()=>applied++,ocrErrorMessage:error=>error.message,console:{error(){}},alert(){}};
    c.window=c;vm.createContext(c);
    vm.runInContext(between('window.passbookFileChange=','function collectPaymentInfo('),c);
    const oldRun=c.passbookFileChange({files:[a],value:'a'});await tick();
    await c.passbookFileChange({files:[b],value:'b'});
    first.resolve({ok:true,json:async()=>({bank:'old'})});await oldRun;
    assert.equal(applied,1,'older OCR response cannot replace newest passbook details');
    assert.equal(c.S.nrPassbookFile,b);
    assert.match(statuses.at(-1),/送單成功後/);
    console.log('PASS older passbook OCR response cannot overwrite a replacement file');
  }
  console.log('OK: attachment experience regression checks');
}
module.exports={runAttachmentExperienceChecks:main};
if(require.main===module){
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
