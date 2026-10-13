'use strict';
// Actual shipped frontend validators and bill transaction, fictional data only.
// Browser coverage consumes this declared fixture; it is not a DB authorization oracle.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FINANCE_BATCH_SOURCE_ROOT||path.join(__dirname,'..'));
const identity={auth_user_id:'qa-income-auth',finance_user_id:'qa-income-user',tenant_id:'00000000-0000-0000-0000-000000000001',data_environment:'test'};
const clone=value=>JSON.parse(JSON.stringify(value));
function functionSource(source,name){
  let start=source.indexOf('function '+name+'(');assert(start>=0,'Shipped function exists: '+name);
  if(source.slice(start-6,start)==='async ')start-=6;
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',lineEnd)+2;
  assert(end>start,name);return source.slice(start,end);
}
function row(table,prefix,index,batch,amount,status='pending_section_chief'){
  const id=prefix+'-'+String(index+1).padStart(6,'0');
  return{id,no:(table==='bills'?'BILL-':'INV-')+id,tenant_id:identity.tenant_id,data_environment:'test',entity_id:'F1',entity_name:'虛構公司',department_code:'D1',applicant:'虛構申請人',applicant_id:identity.finance_user_id,batch_id:batch||null,batch_count:0,status:'unpaid',approval_status:status,approval_step:2,row_version:1,amount,total:amount,tax:0,item:'虛構居家服務費',item_key:'homecare',payer_name:'虛構付款者 '+(index+1),buyer:'虛構買受人 '+(index+1),description:'相同事由申請',note:'',due_date:'2026-10-31',invoice_date:'2026-10-13',created_at:'2026-10-13T01:00:00Z',steps:[{rk:'applicant_submit',r:'申請人',uid:identity.finance_user_id,a:'approved',t:'2026-10-13',files:[]},{rk:'direct_supervisor',r:'上一層主管',uid:identity.finance_user_id,status,files:[]}],receipt_files:[],invoice_followup_status:'unreviewed',revenue_posting_state:'not_posted'};
}
function fixture(){
  const groups=[],hidden=[row('bills','PARTIAL-SECRET',0,'FICT-PARTIAL',99999)];
  function group(table,prefix,count,batch,amounts,statuses){
    const members=Array.from({length:count},(_,n)=>row(table,prefix,n,batch,Array.isArray(amounts)?amounts[n]:amounts,statuses&&statuses[n]));
    const counts={};members.forEach(r=>{counts[r.approval_status]=(counts[r.approval_status]||0)+1;});
    const item={history_key:table+':'+members[0].id,record_type:table,kind:table==='bills'?'bill':'inv',record_id:members[0].id,record_no:count>1?'整批 '+batch:members[0].no,batch_id:batch||'',source_count:count,source_ids:members.map(r=>r.id),personally_applied:true,personally_acted:false,participation_label:'我申請的',last_participated_at:'2026-10-13T01:00:00Z',summary:{entity_id:'F1',entity_name:'虛構公司',department_code:'D1',department_name:'虛構部門',applicant:'虛構申請人',description:'相同事由申請',type_label:table==='bills'?'申請繳費單':'開立發票',request_date:'2026-10-13',status:'unpaid',approval_status:Object.keys(counts).length===1?members[0].approval_status:'mixed',approval_status_counts:counts,source_count:count,amount:members.reduce((n,r)=>n+r.amount,0),has_attachments:false}};
    const result={item,members};groups.push(result);return result;
  }
  // More than 50 application groups: large groups appear after the first page.
  for(let n=0;n<52;n++)group('bills','SINGLE-'+String(n).padStart(2,'0'),1,'',10+n);
  const largeBill=group('bills','B320',320,'FICT-BILL-320',7);
  const largeInvoice=group('invoices','I312',312,'FICT-INVOICE-312',11);
  const fourBill=group('bills','BFOUR',4,'FICT-BILL-FOUR',[2204,4206,6934,1729]);
  const sameReasonA=group('bills','REASON-A',2,'FICT-REASON-A',35);
  const sameReasonB=group('bills','REASON-B',3,'FICT-REASON-B',40);
  const partial=group('bills','PARTIAL',3,'FICT-PARTIAL',[101,202,303]);
  const mixed=group('bills','MIXED',4,'FICT-MIXED',[10,20,30,40],['completed','pending_section_chief','rejected','cancelled']);
  const singleInvoice=group('invoices','I-SINGLE',1,'',83);
  function page(args){
    const query=String(args.p_search||'').toLowerCase();
    const filtered=groups.filter(g=>!query||[g.item.batch_id,g.item.summary.description,...g.members.map(r=>r.no)].some(v=>String(v).toLowerCase().includes(query)));
    const limit=args.p_limit,offset=args.p_offset;
    return{ok:true,mode:'summary',identity:clone(identity),projection_complete:true,total:filtered.length,all_total:groups.length,page:{limit,offset,has_more:offset+limit<filtered.length},items:clone(filtered.slice(offset,offset+limit).map(g=>g.item))};
  }
  function detail(key){
    const g=groups.find(g=>g.item.history_key===key);if(!g)return{error:{code:'42501',message:'Fictional denied'}};
    return{ok:true,identity:clone(identity),item:{...clone(g.item),source_rows:clone(g.members),participant_steps:[]}};
  }
  return{groups,hidden,largeBill,largeInvoice,fourBill,sameReasonA,sameReasonB,partial,mixed,singleInvoice,page,detail};
}
async function run(){
  const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),data=fixture();let checks=0;
  const check=(label,condition)=>{assert(condition,label);checks++;};
  const c={console,Date,Object,Array,String,Number,Set,Map,JSON,Error,S:{demoLogin:false},currentTenantId:()=>identity.tenant_id,activeDataEnvironment:()=>identity.data_environment,DEFAULT_TENANT_ID:identity.tenant_id};
  vm.createContext(c);['approvalHistoryStatusCountsValid','approvalHistoryValidatePage','approvalHistoryValidateDetail','approvalHistoryItemsFromPayload'].filter(name=>source.includes('function '+name+'(')).forEach(name=>vm.runInContext(functionSource(source,name),c));
  for(const group of [data.largeBill,data.largeInvoice,data.fourBill,data.partial,data.mixed,data.singleInvoice]){
    const payload=data.page({p_search:group.item.record_id,p_limit:50,p_offset:0});
    // Search by source number (a declared oracle), not by cached first-page rows.
    check('complete bill/invoice group validates '+group.item.batch_id,c.approvalHistoryValidatePage(payload,1,group.item.record_id)===true);
    check('detail includes all exact authorized members '+group.item.batch_id,c.approvalHistoryValidateDetail(data.detail(group.item.history_key),group.item.history_key).source_count===group.members.length);
    const mapped=c.approvalHistoryItemsFromPayload(payload)[0];
    check('frontend mapping preserves full count and exact source IDs',mapped.historySourceCount===group.members.length&&JSON.stringify(mapped.historySourceIds)===JSON.stringify(group.item.source_ids));
  }
  const pageTwo=data.page({p_limit:50,p_offset:50});check('server page 2 counts groups without splitting 320/312 members',pageTwo.items.some(i=>i.source_count===320)&&pageTwo.items.some(i=>i.source_count===312)&&c.approvalHistoryValidatePage(pageTwo,2,'')===true);
  for(const edit of [p=>p.items[0].source_ids.pop(),p=>p.items[0].source_ids[1]=p.items[0].source_ids[0],p=>p.items[0].batch_id='',p=>p.items[0].kind='req',p=>p.items[0].summary.source_count++,p=>p.items[0].summary.approval_status_counts={completed:3},p=>p.items.push(clone(p.items[0]))]){
    const p=data.page({p_search:'FICT-BILL-FOUR',p_limit:50,p_offset:0});edit(p);assert.throws(()=>c.approvalHistoryValidatePage(p,1,''));checks++;
  }
  for(const edit of [p=>p.item.source_rows.pop(),p=>p.item.source_rows[1].id=p.item.source_rows[0].id,p=>p.item.source_rows[0].tenant_id='foreign',p=>p.item.source_rows[0].data_environment='production',p=>p.item.source_rows[0].batch_id='different',p=>p.item.source_rows[0]=clone(data.hidden[0]),p=>p.item.summary.approval_status_counts={completed:3}]){
    const p=data.detail(data.fourBill.item.history_key);edit(p);assert.throws(()=>c.approvalHistoryValidateDetail(p,data.fourBill.item.history_key));checks++;
  }
  const overlapping=data.page({p_search:'FICT-BILL-FOUR',p_limit:50,p_offset:0});
  const second=clone(data.sameReasonA.item);second.source_ids[1]=data.fourBill.item.source_ids[1];overlapping.items.push(second);overlapping.total=2;
  assert.throws(()=>c.approvalHistoryValidatePage(overlapping,1,''));checks++;
  const calls=[],transactionRows=data.fourBill.members.map(r=>({...r,batchId:r.batch_id,amt:r.amount,approvalStatus:r.approval_status,approvalStep:r.approval_step,rowVersion:r.row_version}));
  Object.assign(c,{BILLS:transactionRows,approvalHistoryExactGroupRows:()=>null,billCreatedBucket:()=>'',approvalActionValidation:()=>({ok:true}),approvalRecordsActionAvailability:(_t,rows)=>({ok:true,rows}),approvalRowsHaveReconcilePending:()=>false,hasSupabase:()=>true,billBatchLimitError:()=>null,canActBill:r=>r.blocked!==true,canReturnPreviousStep:()=>true,cloneSettingValue:clone,normalizeFiles:f=>f,num:v=>Number(v)||0,incomeActionContext:()=>({key:'fictional-single-batch-action'}),getSb:()=>({rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data:{ok:true,count:args.p_bill_ids.length}});}}),financeMutationRpcWithAmbiguousRetry:async(_n,_a,_count,_readback,_context,_meta,callRpc)=>({response:await callRpc()}),normalizeSettingValue:v=>v,reloadBillsByIds:async()=>false,setTopSyncStatus:()=>{},approvalSetReconcilePending:()=>{},refreshApprovalAfterCommittedAction:async()=>true,clearIncomeActionContext:()=>{}});
  ['billGroupKey','billGroupRows','approvalExpectedStepIds','approvalExpectedVersionsValid','approvalValidatedExpectedSteps','billActiveStepTransaction'].forEach(name=>vm.runInContext(functionSource(source,name),c));
  const expected=Object.fromEntries(transactionRows.map(r=>[r.id,{row_version:1,step_index:2}]));
  const approved=await c.billActiveStepTransaction(transactionRows[0],'approve','',[],'',expected);
  check('future normal batch approval stays one RPC for all four IDs',approved.ok&&approved.count===4&&calls.length===1&&calls[0].name==='finance_bill_act_active_step_v2'&&JSON.stringify(calls[0].args.p_bill_ids)===JSON.stringify(data.fourBill.item.source_ids));
  check('future approval preserves every frozen content version',JSON.stringify(calls[0].args.p_expected_steps)===JSON.stringify(expected));
  transactionRows[2].blocked=true;const before=calls.length;
  check('mixed actionable state cannot cause partial approval',!(await c.billActiveStepTransaction(transactionRows[0],'approve','',[],'',expected)).ok&&calls.length===before);
  transactionRows[2].blocked=false;delete expected[transactionRows[2].id];
  check('incomplete frozen version set cannot dispatch a partial batch',!(await c.billActiveStepTransaction(transactionRows[0],'approve','',[],'',expected)).ok&&calls.length===before);
  console.log('Income batch history frontend: '+checks+' checks PASS; complete grouped payload, exact scoped detail and normal transactional bill approval');return{checks};
}
module.exports={fixture,identity,clone,functionSource,run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
