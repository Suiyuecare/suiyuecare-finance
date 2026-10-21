'use strict';
// Actual exact-read, hydration, membership-verification and grouped rendering
// functions. Only transport, authenticated identity and peripheral UI are fake.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(name){
  let start=html.indexOf('function '+name+'(');assert(start>=0,name);
  if(html.slice(start-6,start)==='async ')start-=6;
  const eol=html.indexOf('\n',start);
  return html.slice(start,eol).endsWith('}')?html.slice(start,eol):html.slice(start,html.indexOf('\n}',eol)+2);
}
const clone=value=>JSON.parse(JSON.stringify(value));
let checks=0;
function pass(label){checks++;console.log('PASS '+label);}
function fixture(options={}){
  const rows=Array.from({length:95},(_,index)=>({id:'fictional-invoice-'+index,batchId:'fictional-batch',no:'FICT-'+index,
    approvalStatus:'pending_section_chief',approvalStep:2,status:'unpaid',stepKey:'1|section_chief|fictional-actor',
    steps:[{a:'approved'},{a:'',rk:'section_chief',uid:'fictional-actor'}],total:index+1}));
  const ids=rows.map(row=>row.id),summary={source_table:'invoices',group_key:'batch:fictional-batch',source_ids:ids,
    row_count:95,representative_source_id:ids[0],request_type:'invoice_request'};
  const c={Date,Promise,Object,Array,String,Number,Math,Set,Map,Error,JSON,console,
    S:{user:{id:'fictional-actor',authUserId:'fictional-auth'},demoLogin:false,page:'approvals'},
    REQS:[],BILLS:[],INVS:options.cached?clone(rows):[],APPROVAL_ROW_RUNTIME:{},identity:'fixture-identity',
    APPROVAL_FAST_BOOTSTRAP:{identity:'fixture-identity',verified:true,tasksVerified:true,summaryFingerprint:'current-summary',
      verifiedSummaryFingerprint:'',summaryCounts:{total:1,pending:1,cashier:0},summaryItems:[summary]},
    rows,ids,summary,phase:'prefetch',queries:[],issues:[],renders:[],membershipReads:0,active:0,maxActive:0,
    num:value=>Number(value)||0,cloneSettingValue:clone,hasSupabase:()=>true,
    approvalFastBootstrapIdentity:()=>c.identity,getSb:()=>c.client,
    withOperationTimeout:async query=>query,recordRemoteReadIssue:(label,error)=>c.issues.push({label,error}),
    mapReq:row=>row,mapBill:row=>row,mapInv:row=>row,inActiveDataEnvironment:()=>true,
    approvalSourcesCompleteForCurrentUser:()=>false,
    activeStep:row=>row.steps[1],activeStepIndex:()=>1,
    invoiceActiveApprovalStepKey:row=>row.stepKey,canActInvoice:()=>true,
    approvalSummaryItemIsReceipt:()=>false,approvalFastSummaryItemKey:item=>item.group_key,
    approvalRenderLoadingStateIfAvailable:reason=>c.renders.push(reason),buildApprovals:()=>c.renders.push('ready'),
    updateApprovalTodoBadge:()=>{},approvalFastWriteCache:()=>{},
    approvalFastVerifySummaryMembership:async()=>{c.membershipReads++;return options.membershipChanged?{ok:false,changed:true}:{ok:true,fingerprint:'current-summary',summary:{items:[summary],tasks:[]}};}
  };
  c.client={from(table){const q={table,select(){return q;},in(_key,values){q.ids=values;return q;},limit(value){q.limitValue=value;return q;},then(resolve,reject){
    const phase=c.phase;c.queries.push({phase,table,ids:q.ids.slice(),limit:q.limitValue});c.active++;c.maxActive=Math.max(c.maxActive,c.active);
    return Promise.resolve().then(()=>{
      if(phase==='prefetch'&&options.prefetchFailId&&q.ids.includes(options.prefetchFailId))return {error:new Error('Fictional prefetch timeout')};
      if(phase==='recover'&&options.retryFails)return {error:new Error('Fictional retry timeout')};
      if(phase==='recover'&&options.switchIdentity)c.identity='different-identity';
      return {data:clone(rows.filter(row=>q.ids.includes(row.id)&&row.id!==options.omitId))};
    }).finally(()=>{c.active--;}).then(resolve,reject);
  }};return q;}};
  vm.createContext(c);
  vm.runInContext([
    'uniqueRemoteStrings','remoteRowKey','mergeRemoteRowsByKey','remoteRowsMissingIds','runRemoteJobsWithConcurrency',
    'loadRowsByIdsForApprovalFallback','approvalFastSourceIds','approvalFastSummarySourceIds','approvalFastSummaryItemsHaveCompleteSourceIds',
    'prefetchApprovalFastSummaryRows','approvalRowRuntimeForCurrentUser','approvalRowRuntimeKey','approvalRowCurrentStepFingerprint',
    'approvalRowMarkVerified','approvalRowRuntimePruneToSummary','approvalRowRuntimeCommitTrustedSummary',
    'approvalMarkCompleteSummaryGroupsVerified','approvalRowsMarkUnavailable','approvalRowIsLocallyVerified','approvalTrustedSummaryItems',
    'approvalFastCountsAreValid','approvalPendingInvoiceSummaryItems','finalizeApprovalFastBootstrapFromRows','hydrateApprovalFastBootstrap'
  ].map(source).join('\n'),c);
  c.approvalFastActionableCounts=()=>{const count=c.approvalPendingInvoiceSummaryItems().filter(item=>!item.approvalBatchLoading).length;return {total:count,pending:count,cashier:0};};
  c.run=async()=>{
    const prefetched=await c.prefetchApprovalFastSummaryRows(c.client,[summary]);
    c.prefetched=prefetched;c.phase='recover';
    return c.hydrateApprovalFastBootstrap({identity:'fixture-identity',tasks:[],summaryItems:[summary],summaryFingerprint:'current-summary',prefetchedRows:prefetched});
  };
  return c;
}
async function main(){
  {
    const c=fixture();assert.equal(await c.run(),true);
    assert.deepEqual(c.queries.map(query=>query.ids.length),[40,40,15]);
    assert.deepEqual(c.queries.map(query=>query.limit),[45,45,20]);
    assert.equal(c.maxActive,2);assert.equal(c.INVS.length,95);assert.equal(c.membershipReads,1);
    const item=c.approvalPendingInvoiceSummaryItems()[0];assert.equal(item.approvalBatchLoading,false);assert.equal(item.rows.length,95);
    pass('95 invoice rows read in bounded 40/40/15 chunks become one complete actionable batch');
  }
  for(const start of [0,40,80]){
    const c=fixture({prefetchFailId:'fictional-invoice-'+start});assert.equal(await c.run(),true);
    assert.equal(c.prefetched.invoices.approvalLoadComplete,false);
    const retry=c.queries.filter(query=>query.phase==='recover');assert.equal(retry.length,1);
    assert.deepEqual(retry[0].ids,c.ids.slice(start,start+40));
    assert.equal(c.INVS.length,95);assert.equal(c.APPROVAL_FAST_BOOTSTRAP.hydrated,true);
    assert.equal(c.membershipReads,1);assert.equal(c.issues.length,1);
    assert.equal(Object.keys(c.APPROVAL_ROW_RUNTIME.verified).length,95);
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].approvalBatchLoading,false);
    pass('prefetch chunk '+(start/40+1)+' failure recovers only missing rows and does not falsely retain loading/failure');
  }
  for(const cached of [false,true]){
    const c=fixture({prefetchFailId:'fictional-invoice-80',retryFails:true,cached});assert.equal(await c.run(),false);
    assert.equal(c.APPROVAL_FAST_BOOTSTRAP.hydrated,false);assert.equal(Object.keys(c.APPROVAL_ROW_RUNTIME.verified).length,0);
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].approvalBatchLoading,true);
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].rows.length,0);
    assert.equal(c.INVS.length,cached?95:80);
    pass('unrecovered last 15 rows block the entire batch'+(cached?' even when old cached siblings exist':''));
  }
  {
    const c=fixture({omitId:'fictional-invoice-94',cached:true});assert.equal(await c.run(),false);
    assert.equal(c.prefetched.invoices.approvalLoadComplete,true);
    assert.equal(Object.keys(c.APPROVAL_ROW_RUNTIME.verified).length,0);
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].approvalBatchLoading,true);
    pass('successful transport missing one requested row cannot authorize a partially loaded batch');
  }
  {
    const c=fixture({prefetchFailId:'fictional-invoice-0',membershipChanged:true});assert.equal(await c.run(),false);
    assert.equal(c.INVS.length,95);assert.equal(c.membershipReads,1);assert.equal(Object.keys(c.APPROVAL_ROW_RUNTIME.verified).length,0);
    assert.equal(c.APPROVAL_FAST_BOOTSTRAP.verifiedSummaryFingerprint,'');
    pass('recovered rows still require unchanged authoritative membership before authorization');
  }
  {
    const c=fixture({prefetchFailId:'fictional-invoice-0',switchIdentity:true});assert.equal(await c.run(),false);
    assert.equal(c.INVS.length,0);assert.equal(c.membershipReads,0);assert.equal(c.APPROVAL_ROW_RUNTIME.identity,undefined);
    pass('identity switch while retrying cannot publish or authorize the previous account rows');
  }
  console.log('OK: '+checks+' exact approval hydration recovery checks');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
