'use strict';
const assert=require('node:assert/strict');
const adapter=require('../assets/engines/mega-remittance-adapter.js');
const source=require('../assets/engines/mega-remittance-source.js');
let checks=0;
function check(label,fn){fn();checks++;}
function response(overrides={}){
  return {ok:true,sourceVersion:3,sourceDigest:'opaque-server-digest',canSupplement:true,supplements:[],request:{
    id:'FICT-MEGA-ADAPTER',no:'TEST-001',entity_id:'FICT-ENTITY',type:'refund_request',status:'pending_cashier',ver:3,
    amount:300,expected_pay_date:'2026-10-20',fee_bearer:'己方支出',bank_fee_amount:15,
    steps:[{rk:'ceo',a:'approved'},{rk:'cashier',a:''}],form_payload:{paymentType:'bank',refundInfo:{rows:[
      {method:'cash',refundAmount:100},
      {method:'bank',refundAmount:200,accountNo:'00000000000001',accountName:'',bankName:''}
    ]}},...overrides
  }};
}
check('Failed server snapshot cannot be relabeled authorized',()=>{
  for(const value of [null,{}, {ok:false}, {ok:true}])assert.notEqual(adapter.adapt(value,source).authorized,true);
});
check('Missing bank details keep original source row despite excluded cash',()=>{
  const out=adapter.adapt(response(),source);
  assert.equal(out.authorized,true);assert.equal(out.expectedTotal,200);assert.equal(out.excludedRows.length,1);
  assert.equal(out.supplementRows.length,1);assert.deepEqual(out.supplementRows[0],{rowKey:'refund:2',row:2,fields:['name','bankCode'],account:'00000000000001',amount:200});
  assert(out.issues.length>0);
});
check('Read-only role has no supplement editor',()=>{
  const data=response();data.canSupplement=false;assert.deepEqual(adapter.adapt(data,source).supplementRows,[]);
});
check('Supplement resolves only server-authorized bank row and preserves amount',()=>{
  const data=response();data.supplements=[{rowKey:'refund:2',name:'虛構退款戶',bankCode:'017'}];
  const out=adapter.adapt(data,source);assert.equal(out.issues.length,0);assert.equal(out.rows.length,1);assert.equal(out.rows[0].amount,200);
  assert.equal(out.rows[0].account,'00000000000001');assert.deepEqual(out.supplementRows,[]);
});
check('Account and amount errors never become editable supplement fields',()=>{
  const data=response();data.request.form_payload.refundInfo.rows[1].accountNo='';data.request.form_payload.refundInfo.rows[1].refundAmount=-1;
  const out=adapter.adapt(data,source);assert(out.issues.some(x=>x.field==='account'));assert(out.issues.some(x=>x.field==='amount'));
  assert(out.supplementRows.every(row=>row.fields.every(field=>['name','bankCode'].includes(field))));
});
check('Version is opaque server identity, never confidential canonical source',()=>{
  const out=adapter.adapt(response(),source);assert.equal(out.sourceDigest,'opaque-server-digest');assert.equal(out.sourceVersion,3);
  assert(!Object.hasOwn(out,'snapshotText'));assert(!Object.hasOwn(out,'request'));
});
check('Known saved fee and payment date are passed without recomputing',()=>{
  const out=adapter.adapt(response(),source);assert.equal(out.companyFee,15);assert.equal(out.feeBearer,'己方支出');assert.equal(out.paymentDate,'2026-10-20');
});
check('Changed stage is ineligible despite successful stale wrapper',()=>{
  const out=adapter.adapt(response({status:'pending_ceo'}),source);assert.equal(out.eligible,false);assert.deepEqual(out.rows,[]);
});
function historicalResponse(){
  const data=response({status:'completed',created_at:'2026-10-01T00:00:00Z',cash_posted_at:'2026-10-02T03:00:00Z',applicant_id:'FICT-APPLICANT',voucher_id:'FICT-VOUCHER',ledger_posted_at:'2026-10-03T00:00:00Z'});
  data.request.steps=[{rk:'applicant_submit',a:'approved',uid:'FICT-APPLICANT'},{rk:'ceo',a:'AUTO'},{rk:'cashier',a:'approved'},{rk:'applicant_confirm'}];
  Object.assign(data.request.form_payload,{_submissionPayloadSha256V3:'a'.repeat(64),cashAmount:315});
  Object.assign(data,{exportPurpose:'historical',submittedAt:data.request.created_at,submissionSource:'server_created_at',historyCutoff:'2026-09-30T16:00:00Z',canSupplement:true});
  data.supplements=[{rowKey:'refund:2',name:'虛構退款戶',bankCode:'017'}];return data;
}
check('Explicit historical snapshot preserves real stage, payment evidence and original bank-only total',()=>{
  const data=historicalResponse(),before=JSON.stringify(data),out=adapter.adapt(data,source);
  assert.equal(out.eligible,true);assert.equal(out.exportPurpose,'historical');assert.equal(out.stage,'completed');assert.equal(out.expectedTotal,200);
  assert.equal(out.paidAt,data.request.cash_posted_at);assert.equal(out.sourceBasis,'current_saved_reconstruction');assert.equal(out.submittedAt,data.request.created_at);
  assert.equal(out.submissionSource,'server_created_at');assert.equal(out.historyCutoff,data.historyCutoff);assert.equal(out.sourceDigest,data.sourceDigest);assert.equal(out.sourceVersion,3);
  assert.equal(JSON.stringify(data),before);assert(!Object.hasOwn(out,'request'));assert(!Object.hasOwn(out,'snapshotText'));
});
check('No export purpose retains strict original response compatibility',()=>{
  const data=historicalResponse();delete data.exportPurpose;const out=adapter.adapt(data,source);
  assert.equal(out.eligible,false);assert.equal(out.exportPurpose,'payment');assert.deepEqual(out.rows,[]);
  const current=adapter.adapt(response(),source);assert.equal(current.eligible,true);assert.equal(current.exportPurpose,'payment');
});
check('Unknown export purpose cannot authorize a file',()=>{
  const data=historicalResponse();for(const purpose of ['preview','unsupported','',null]){data.exportPurpose=purpose;const out=adapter.adapt(data,source);assert.equal(out.eligible,false);assert.deepEqual(out.rows,[]);assert.equal(out.canSupplement,false);}
});
check('Historical missing source data remains editable only with current server supplement authority',()=>{
  const data=historicalResponse();data.supplements=[];let out=adapter.adapt(data,source);
  assert.equal(out.eligible,true);assert(out.issues.length>0);assert.equal(out.supplementRows[0].rowKey,'refund:2');assert.equal(out.supplementRows[0].amount,200);
  data.canSupplement=false;out=adapter.adapt(data,source);assert.equal(out.canSupplement,false);assert.deepEqual(out.supplementRows,[]);
});
check('Missing or mismatched historical payment evidence cannot expose supplement editor',()=>{
  const data=historicalResponse();data.request.cash_posted_at=null;const out=adapter.adapt(data,source);
  assert.equal(out.eligible,false);assert.equal(out.reasonCode,'historical_payment_unverified');assert.deepEqual(out.rows,[]);assert.deepEqual(out.supplementRows,[]);assert.equal(out.canSupplement,false);
});
check('Thin waiting snapshot carries metadata without demanding or leaking private source rows',()=>{
  const data={ok:true,requestId:'FICT-THIN',stage:'pending_ceo',sourceVersion:8,sourceDigest:'opaque-waiting-digest',exportPurpose:'waiting',reason:'awaiting_cashier',submittedAt:'2026-10-02T00:00:00Z',submissionSource:'server_created_at',historyCutoff:'2026-09-30T16:00:00Z',canSupplement:true,supplements:[{name:'MUST-NOT-LEAK'}]};
  const out=adapter.adapt(data,{resolve(){throw new Error('thin state must not resolve private rows');}});
  assert.equal(out.authorized,true);assert.equal(out.eligible,false);assert.equal(out.exportPurpose,'waiting');assert.equal(out.stage,'pending_ceo');assert.equal(out.reasonCode,'waiting_for_cashier');assert.equal(out.requestId,data.requestId);
  assert.equal(out.sourceVersion,8);assert.equal(out.sourceDigest,data.sourceDigest);assert.equal(out.canSupplement,false);assert.deepEqual(out.rows,[]);assert.deepEqual(out.supplementRows,[]);assert(!JSON.stringify(out).includes('MUST-NOT-LEAK'));
});
check('Thin unavailable reasons are translated through a fixed whitelist',()=>{
  const expected={before_history_cutoff:'historical_before_cutoff',submission_evidence_missing:'historical_submission_unverified',cancelled_or_rejected:'historical_status_invalid',payment_not_applicable:'export_unavailable',accounting_correction_requires_review:'historical_correction_unsupported',cashier_evidence_missing:'historical_cashier_unverified',cashier_evidence_incomplete:'historical_cashier_unverified',payment_evidence_incomplete:'historical_payment_unverified',payment_timestamp_invalid:'historical_payment_unverified',historical_amount_incomplete:'historical_principal_missing',historical_amount_mismatch:'historical_cash_mismatch'};
  for(const [reason,code] of Object.entries(expected)){
    const out=adapter.adapt({ok:true,exportPurpose:'unavailable',requestId:'FICT-THIN',stage:'completed',reason},source);
    assert.equal(out.reasonCode,code);assert.equal(out.eligible,false);assert.deepEqual(out.rows,[]);
  }
  const out=adapter.adapt({ok:true,exportPurpose:'unavailable',requestId:'FICT-THIN',reason:'PRIVATE-EXCEPTION-MUST-NOT-LEAK'},source);
  assert.equal(out.reasonCode,'export_unavailable');assert(!JSON.stringify(out).includes('PRIVATE-EXCEPTION'));
});
check('Thin metadata cannot invent success, omit request identity or promote historical source',()=>{
  for(const data of [{ok:false,exportPurpose:'waiting',requestId:'FICT'}, {ok:true,exportPurpose:'waiting'}, {ok:true,exportPurpose:'historical',requestId:'FICT'}])assert.notEqual(adapter.adapt(data,source).authorized,true);
});
check('Historical filename carries paid reference warning and cannot become a fresh payment filename',()=>{
  const out=adapter.adapt(historicalResponse(),source);assert.match(adapter.filename(out),/^已付款_歷史補檔_勿重複匯款_兆豐_整批匯款_TEST-001\.xlsx$/);
  assert.doesNotMatch(adapter.filename(adapter.adapt(response(),source)),/已付款|歷史補檔/);
});
console.log('Mega remittance adapter: '+checks+' checks passed (synthetic data only).');
