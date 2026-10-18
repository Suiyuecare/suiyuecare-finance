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
console.log('Mega remittance adapter: '+checks+' checks passed (synthetic data only).');
