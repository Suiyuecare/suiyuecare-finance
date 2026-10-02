#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('var INVOICE_REVENUE_VERIFIED={};');
const end=html.indexOf('function hasInvoiceCashLedger(i){',start);
assert(start>=0&&end>start,'invoice revenue production functions must exist');
const source=html.slice(start,end);
let checks=0;
function eq(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}

function setup(post,read,initial={}){
 const calls=[],alerts=[],sync=[],identity={value:'actor-A'};
 const invoice={id:'invoice-A',no:'INV-A',tenantId:'tenant-A',dataEnv:'production',
  eid:'E1',dc:'D1',amt:105,tax:5,total:105,date:'2026/10/02',buyer:'Synthetic',
  approvalStatus:'delivered',steps:[{rk:'applicant_invoice_delivery',a:'approved'}],
  revenuePosted:false,revenuePostedAt:'',revenuePostingState:'not_posted',...initial};
 const ctx={console:{error(){},warn(){}},Number,Date,Math,POSTING_IN_FLIGHT:{},LEDGER:[],
  S:{user:{id:'actor-A'}},
  invoiceRevenuePostingReady(){return true;},hasInvoiceRevenueLedger(){return false;},
  invoiceRevenuePostedAt(i){return i.revenuePostedAt||'';},
  incomeSubmissionIdentity(){return identity.value;},
  incomeSubmissionIdentityCurrent(value){return !!value&&value===identity.value;},
  currentTenantId(){return 'tenant-A';},activeDataEnvironment(){return 'production';},
  isLocalRuntime(){return false;},invDept(i){return i.dc;},entityOfDept(){return 'E1';},
  invoiceRevenueAccount(){return {c:'4101',n:'Revenue'};},num:Number,
  ensureOpenPostingPeriod(){calls.push('period');return true;},
  withOperationTimeout(promise){return promise;},
  expenseApplicantRevisionRpcErrorIsAmbiguous(error){return error.code==='CLIENT_TIMEOUT'||/network/i.test(error.message||'');},
  async callAccountingRpc(name,args){calls.push(name);
   if(name==='post_invoice_revenue_v2')return post({invoice,args,calls,identity});
   if(name==='finance_invoice_revenue_result_v1')return read({invoice,args,calls,identity});
   throw new Error('unexpected RPC '+name);
  },
  setTopSyncStatus(message){sync.push(message);},alert(message){alerts.push(message);},
  saveLocalAppStateSoon(){}
 };
 vm.runInNewContext(source+'\nthis.postInvoiceRevenue=postInvoiceRevenue;',ctx,{filename:'index.html invoice revenue block'});
 return{invoice,calls,alerts,sync,identity,ctx,run:()=>ctx.postInvoiceRevenue(invoice)};
}
const confirmed=(overrides={})=>({ok:true,data:{invoice_id:'invoice-A',tenant_id:'tenant-A',
 data_environment:'production',confirmed:true,posted_at:'2026-10-02T15:00:00Z',posting_version:2,...overrides}});
const lost=()=>{const error=new Error('network response lost');error.code='CLIENT_TIMEOUT';throw error;};

(async()=>{
 let h=setup(lost,async()=>confirmed());
 eq(await h.run(),true,'lost response plus authoritative journal confirms posting');
 eq(h.calls.filter(x=>x==='post_invoice_revenue_v2').length,1,'writer called once');
 eq(h.calls.filter(x=>x==='finance_invoice_revenue_result_v1').length,1,'single read-only result check');
 eq(h.invoice.revenuePostedAt,'2026-10-02T15:00:00Z','uses database timestamp, not client clock');
 eq(h.invoice.revenuePostingVerified,true,'confirmed result is locally recognized despite stale ledger cache');
 eq(h.ctx.invoiceRevenueRecognized({...h.invoice,revenuePostingVerified:false}),true,
  'same-actor refresh keeps verified recognition with stale ledger cache');
 eq(h.ctx.invoiceRevenueRecognized({...h.invoice,revenuePostingVerified:false,revenuePostedAt:'2026-10-03T15:00:00Z'}),false,
  'changed posting timestamp invalidates readback evidence');
 eq(h.invoice.approvalStatus,'delivered','committed approval remains completed');
 eq(h.alerts.length,0,'no false failed-posting message');
 eq(Object.keys(h.ctx.POSTING_IN_FLIGHT).length,0,'posting lock released');

 h=setup(lost,async()=>confirmed({tenant_id:'tenant-B'}));
 eq(await h.run(),false,'cross-tenant result cannot prove this posting');
 eq(h.invoice.revenuePostingResultUnknown,true,'mismatch remains unknown');
 eq(h.invoice.revenuePostingState,'not_posted','ambiguous result is not labeled a definite accounting failure');
 eq(h.invoice.approvalStatus,'delivered','approval remains completed after unknown result');
 eq(h.alerts.length,1,'user receives unknown-result warning');
 eq(await h.run(),false,'same invoice cannot blindly retry after unknown');
 eq(h.calls.filter(x=>x==='post_invoice_revenue_v2').length,1,'no second posting RPC');

 h=setup(lost,async()=>{throw new Error('readback network failed');});
 eq(await h.run(),false,'readback outage remains unknown');
 eq(h.invoice.revenuePostingResultUnknown,true,'readback outage cannot be reported committed');

 h=setup(async()=>({ok:true,data:{ok:true,deferred:false,invoice_id:'other-invoice'}}),
  async()=>({ok:true,data:{confirmed:false,invoice_id:'invoice-A',tenant_id:'tenant-A',data_environment:'production'}}));
 eq(await h.run(),false,'successful transport with wrong invoice result remains unknown');
 eq(h.invoice.revenuePostingResultUnknown,true,'malformed writer result cannot trigger local posted fallback');
 eq(h.calls.filter(x=>x==='finance_invoice_revenue_result_v1').length,1,'malformed result gets same-invoice readback');

 h=setup(({identity})=>{identity.value='actor-B';lost();},async()=>confirmed());
 eq(await h.run(),false,'account switch discards old actor result');
 eq(h.calls.filter(x=>x==='finance_invoice_revenue_result_v1').length,0,'old actor cannot issue readback');
 eq(h.alerts.length,0,'old actor sees no stale notification');
 eq(h.invoice.revenuePostingState,'not_posted','old actor cannot mutate invoice state');

 h=setup(()=>{throw Object.assign(new Error('validation rejected'),{status:400});},async()=>confirmed());
 eq(await h.run(),false,'definite validation failure remains failure');
 eq(h.calls.filter(x=>x==='finance_invoice_revenue_result_v1').length,0,'definite failure needs no ambiguous readback');
 eq(h.invoice.revenuePostingState,'pending_accounting_review','definite failure stays in accounting review');

 h=setup(()=>{throw new Error('writer must not be called');},async()=>confirmed(),{
  revenuePosted:true,revenuePostedAt:'2026-10-02T15:00:00Z',revenuePostingState:'posted'});
 eq(await h.run(),true,'posted flags with stale ledger cache receive authoritative readback');
 eq(h.calls.filter(x=>x==='post_invoice_revenue_v2').length,0,'posted flags never trigger a blind writer retry');
 eq(h.calls.includes('period'),false,'closed accounting period cannot block read-only result check');

 console.log(`invoice revenue browser reconciliation: ${checks} checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
