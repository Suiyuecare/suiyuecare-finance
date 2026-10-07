#!/usr/bin/env node
'use strict';
// Exercise the actual applicant-revision export and upload helpers with
// fictional local files. No authentication or remote storage is used.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function source(name){
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);
  assert(match,'Missing '+name);
  const end=html.indexOf('\n}',match.index);
  assert(end>match.index,'Missing end of '+name);
  return html.slice(match.index,end+2);
}
const original={n:'原送件經費明細.xls',path:'original/immutable.xls',__revisionOriginal:true};
const state={
  lazyRows:[{id:'item-1',no:'AA00000001',date:'2026-10-08',item:'講義',applicantItemNote:'第一次備註',qty:1,unitName:'份',unitPrice:105,netAmount:100,taxAmount:5,grossAmount:105,total:105,taxMode:'gross_inclusive',file:'receipt.pdf'}],
  nrFiles:[original],nrRevisionPendingUploads:[],nrPassbookFile:null
};
let nextPath=1,removed=[],renders=0,failCleanup=false;
const context={
  S:state,Date,Promise,JSON,Number,Math,Error,console,
  num:v=>Number(v)||0,todayIso:()=> '2026-10-08',
  requestTypeLabel:()=> '費用申請',gE:()=>({full:'虛構公司'}),gD:()=>({n:'虛構部門'}),
  isLazyRequestType:()=>true,
  lazyTaxMode:row=>row.taxMode,
  lazyNetAmount:row=>Number(row.netAmount)||0,
  lazyTaxAmount:row=>Number(row.taxAmount)||0,
  lazyRowTotal:row=>Number(row.grossAmount)||0,
  renderNRFList:()=>{renders++;},
  attachmentStoragePath:file=>file&&file.path||'',
  cloneSettingValue:value=>JSON.parse(JSON.stringify(value)),
  normalizeFiles:files=>files||[],
  fileToAttachment:async file=>({...file}),
  uploadAttachmentsToSupabase:async files=>files.map(file=>({n:file.n,kind:file.kind,path:'staged/'+nextPath++,url:''})),
  cleanupUploadedSupabaseAttachments:async groups=>{
    if(failCleanup)throw Error('Storage cleanup failed');
    removed.push(groups.flat().map(file=>file.path));
    return groups.flat().length;
  }
};
vm.createContext(context);
vm.runInContext([
  'lazySpreadsheetNote','lazyDetailExcelAttachment',
  'forgetExpenseApplicantRevisionPendingUpload',
  'expenseRevisionDetailExportMeta','expenseRevisionDetailExportFingerprint',
  'prepareExpenseRevisionDetailExport','uploadExpenseRevisionDelta'
].map(source).join('\n'),context);
const record={no:'TEST-001',ver:2,app:'虛構申請人',eid:'E1',dc:'D1',type:'expense_reimbursement'};
const form={requestDate:'2026-10-08',amount:105,description:'虛構課程講義',payment:{expectedPayDate:'2026-10-30',payee:'虛構收款人',summary:'虛構銀行'}};
function generated(){return state.nrFiles.filter(file=>file.__revisionGeneratedExport);}
(async()=>{
  const firstFingerprint=await context.prepareExpenseRevisionDetailExport(record,form);
  assert.equal(generated().length,1);
  assert.equal(generated()[0].n,'經費明細表_TEST-001_補件v3.xls');
  assert(decodeURIComponent(generated()[0].url).includes('第一次備註'));
  assert.equal(state.nrFiles[0],original,'original attachment remains immutable');
  const first=await context.uploadExpenseRevisionDelta(record);
  assert.equal(first.requestFiles.length,1,'only versioned export is appended');
  assert.equal(first.stepFiles.length,1);
  assert.equal(first.requestFiles[0].kind,'revision_detail_sheet');
  assert.equal(state.nrFiles[0],original);
  await context.prepareExpenseRevisionDetailExport(record,form);
  assert.equal(generated().length,1,'same revision retry reuses the versioned export');
  assert.equal(generated()[0].__revisionUploadedMeta.path,first.requestFiles[0].path);
  assert.equal(removed.length,0,'a retry cannot clean its own staged attachment');
  state.lazyRows[0].applicantItemNote='補件後的最新備註';
  assert.notEqual(context.expenseRevisionDetailExportFingerprint(record,form),firstFingerprint);
  await context.prepareExpenseRevisionDetailExport(record,form);
  assert.equal(generated().length,1);
  assert(decodeURIComponent(generated()[0].url).includes('補件後的最新備註'));
  assert(!decodeURIComponent(generated()[0].url).includes('第一次備註'));
  assert.equal(JSON.stringify(removed),JSON.stringify([['staged/1']]),'only the unbound stale export is cleaned');
  assert.equal(state.nrRevisionPendingUploads.length,0);
  assert.equal(state.nrFiles[0],original);
  const second=await context.uploadExpenseRevisionDelta(record);
  assert.equal(second.requestFiles[0].path,'staged/2');
  assert.equal(second.requestFiles.length,1);
  state.lazyRows[0].applicantItemNote='第三次備註';
  failCleanup=true;
  await assert.rejects(context.prepareExpenseRevisionDetailExport(record,form),/Storage cleanup failed/);
  assert.equal(generated()[0].__revisionUploadedMeta.path,'staged/2','cleanup failure keeps prior staged export for retry');
  assert.equal(state.nrFiles[0],original);
  assert(renders>=2);
  console.log('PASS applicant revision appends current versioned XLS, retains original, reuses retry, replaces stale staged export, blocks failed cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
