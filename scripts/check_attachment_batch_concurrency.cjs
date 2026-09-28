#!/usr/bin/env node
'use strict';
// Exercise the shipped batch coordinator with a controlled Storage boundary.
// The fixture proves bounded concurrency, stable order, and rollback after a
// failure while another upload is still in flight; it never touches live data.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function actualFunction(name){
  let start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name+' is present');
  if(source.slice(start-6,start)==='async ')start-=6;
  for(let end=source.indexOf('{',start);end<source.length;end++){
    if(source[end]!=='}')continue;
    const candidate=source.slice(start,end+1);
    try{new vm.Script(candidate);return candidate;}catch(_error){}
  }
  throw new Error('Cannot extract '+name);
}
function fixture(){
  const starts=[];
  const pending=new Map();
  const cleanup=[];
  const feedback=[];
  let active=0;
  let maximum=0;
  const context={
    Date,Promise,Math,ATTACHMENT_BATCH_TIMEOUT_MS:120000,ATTACHMENT_UPLOAD_TIMEOUT_MS:30000,
    preflightAttachmentsForSupabase:async files=>files,
    normalizeFileMeta:file=>file,
    formatStorageUploadError:error=>error.message,
    attachmentUploadError:(message,metadata)=>Object.assign(new Error(message),metadata),
    attachmentUploadFeedback:total=>({
      update:(done,name)=>feedback.push({done,name,total}),
      finish:error=>feedback.push({finish:error||'success',total})
    }),
    uploadAttachmentWithTrackedTimeout:file=>{
      active++;
      maximum=Math.max(maximum,active);
      starts.push(file.n);
      return new Promise((resolve,reject)=>{
        pending.set(file.n,{
          resolve:()=>{active--;resolve({...file,path:'fictional/'+file.n});},
          reject:()=>{active--;reject(new Error('fictional storage failure'));}
        });
      });
    },
    cleanupUploadedSupabaseAttachments:async(groups,label)=>{cleanup.push({files:groups.flat().map(file=>file.n),label});return groups.flat().length;}
  };
  vm.createContext(context);
  vm.runInContext(actualFunction('uploadAttachmentsToSupabase'),context);
  return {context,starts,pending,cleanup,feedback,getMaximum:()=>maximum};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  let f=fixture();
  let promise=f.context.uploadAttachmentsToSupabase([{n:'a.pdf'},{n:'b.pdf'},{n:'c.pdf'}],{});
  await tick();
  assert.deepEqual(f.starts,['a.pdf','b.pdf'],'at most two uploads start together');
  f.pending.get('b.pdf').resolve();
  await tick();
  assert.deepEqual(f.starts,['a.pdf','b.pdf','c.pdf'],'next upload starts as soon as a slot is free');
  f.pending.get('c.pdf').resolve();
  f.pending.get('a.pdf').resolve();
  const result=await promise;
  assert.deepEqual(Array.from(result,file=>file.n),['a.pdf','b.pdf','c.pdf'],'saved files retain the original form order');
  assert.equal(f.getMaximum(),2,'parallel work is bounded at two files');
  assert.equal(f.cleanup.length,0,'a completed batch is not rolled back');
  assert.equal(f.feedback.at(-1).finish,'success','completion is reported only after all files complete');

  f=fixture();
  promise=f.context.uploadAttachmentsToSupabase([{n:'a.pdf'},{n:'b.pdf'},{n:'c.pdf'}],{});
  const failure=assert.rejects(promise,/第 1 個附件「a\.pdf」上傳失敗/);
  await tick();
  f.pending.get('a.pdf').reject();
  await tick();
  assert.deepEqual(f.starts,['a.pdf','b.pdf'],'failure prevents the queued file from starting');
  f.pending.get('b.pdf').resolve();
  await failure;
  assert.deepEqual(Array.from(f.cleanup[0].files),['b.pdf'],'an in-flight success is also cleaned after a failure');
  assert.match(f.feedback.at(-1).finish,/附件「a\.pdf」上傳失敗/,'the failed file is named for a useful retry');
  console.log('Attachment batch concurrency: 9 checks passed (fictional Storage boundary).');
})().catch(error=>{console.error(error);process.exitCode=1;});
