'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(name,windowFn=false){
  let start=html.indexOf(windowFn?'window.'+name+'=':'function '+name+'(');
  assert(start>=0,'missing '+name);
  if(!windowFn&&html.slice(start-6,start)==='async ')start-=6;
  const eol=html.indexOf('\n',start);
  return html.slice(start,eol).endsWith(windowFn?'};':'}')
    ?html.slice(start,eol)
    :html.slice(start,html.indexOf(windowFn?'\n};':'\n}',eol)+(windowFn?3:2));
}
function plain(value){return JSON.parse(JSON.stringify(value));}
const ids=(prefix,count)=>Array.from({length:count},(_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
const group3=ids('g3',18),group4=ids('g4',13);
function makeRows(){
  return group3.map((id,index)=>({id,no:'INV-3-'+index,batchId:'batch-3',stepKey:'2|direct_supervisor|finance-user:boss',total:500,steps:[{}],approvalStatus:'pending',applicant:'甲'}))
    .concat(group4.map((id,index)=>({id,no:'INV-4-'+index,batchId:'batch-4',stepKey:'2|direct_supervisor|finance-user:boss',total:index===0?200:1700,steps:[{}],approvalStatus:'pending',applicant:'乙'})));
}
function makeSummary(){return [
  {source_table:'invoices',group_key:'batch:batch-3',source_ids:group3.slice(),row_count:18,representative_source_id:group3[0],source_no:'INV-3-0'},
  {source_table:'invoices',group_key:'batch:batch-4',source_ids:group4.slice(),row_count:13,representative_source_id:group4[0],source_no:'INV-4-0'}
];}
function setup(){
  const nodes={};
  const c={
    console,Date,Promise,Array,Object,String,Number,Math,Set,Map,JSON,Error,
    S:{aT:'p',demoLogin:false,apprSelected:{}},INVS:makeRows(),summaries:makeSummary(),window:{},APPROVAL_INVOICE_MODAL_GROUP:null,
    el:id=>nodes[id]||(nodes[id]={innerHTML:'',value:''}),
    approvalTrustedSummaryItems:()=>c.summaries,approvalSummaryItemIsReceipt:()=>false,
    approvalFastSummaryItemKey:item=>String(item.group_key||''),
    uniqueRemoteStrings:values=>[...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))],
    approvalRowIsLocallyVerified:(_table,row)=>!!row.verified,
    invoiceActiveApprovalStepKey:row=>row.stepKey||'',canActInvoice:row=>!!row&&row.canAct!==false,
    approvalRowRuntimeForCurrentUser:()=>({trustedTasksVerified:true}),
    approvalRecordsActionAvailability:(_table,rows)=>({ok:rows.length>0,rows}),
    approvalItemSourceTable:item=>item.kind==='inv'?'invoices':'',
    approvalFastBootstrapIdentity:()=> 'identity',approvalHistoryExactGroupRows:()=>null,
    invoiceApprovalRowIsOpen:()=>true,financeApprovalEngine:()=>null,
    normDate:value=>String(value||''),normalizeFiles:files=>files||[],
    num:value=>Number(value)||0,fmt:value=>'NT$'+Number(value).toLocaleString('en-US'),
    escAttr:value=>String(value==null?'':value).replaceAll('&','&amp;').replaceAll('"','&quot;'),
    financeInlineJsString:value=>JSON.stringify(String(value)),
    visibleInvoicesForCurrentUser:()=>c.INVS,
    invoiceGroupNo:row=>row.batchId?'整批 '+row.batchId:row.no,
    invoiceIsReceivable:()=>false,invApprovalLabel:()=> '待簽核',
    incomeManagementSearchState:()=>({invoice:''}),incomeApplicantWithdrawButtonHtml:()=>'',
    setTopSyncStatus:()=>{},alert:()=>{},
    approvalPersonalTab:()=>false,approvalDataLoadWarningHtml:()=>'',
    approvalApplySearchSort:data=>data,reconcileApprovalPageSelection:()=>{},
    approvalWaitColumnVisible:()=>true,approvalTableHeaderHtml:()=>'<thead></thead>',
    approvalPagerHtml:()=>'',refreshApprovalBulkCount:()=>{},syncApprovalWaitTimer:()=>{},
    approvalItemAvailability:()=>({ok:true}),approvalItemRejected:()=>false,
    approvalRowStatus:()=>({label:'待簽核',cls:'b-wait'}),
    approvalRowDept:()=>({name:'日照課'}),approvalRowApplicant:()=> '申請人',
    stepBelongsToUser:()=>false,approvalShortDate:()=> '2026-10-10',
    approvalRowExpectedPayDate:()=> '',approvalRowApplyDate:()=> '',
    activeStep:()=>({}),supervisorReviewIssues:()=>[],
    approvalWaitCellHtml:()=>'',employeeRequestProgressHtml:()=>''
  };
  c.INVS.forEach(row=>row.verified=true);
  vm.createContext(c);
  vm.runInContext([
    source('invoiceBatchFallbackKey'),source('invoiceGroupKey'),
    'var APPROVAL_INVOICE_MODAL_GROUP=null;',
    source('approvalInvoiceModalRows'),source('invoiceGroupRows'),source('invoiceBatchActionRows'),
    source('uniqueInvoiceGroups'),source('approvalItemKey'),source('approvalPendingInvoiceSummaryItems'),
    source('approvalPendingCandidateItems'),source('approvalItemActionAvailability'),
    source('approvalRowFormNo'),source('approvalRowType'),source('approvalRowAmount'),source('approvalRowSummary'),
    source('renderApprList'),source('renderInvTable'),source('renderInvoiceManagementList'),source('renderBatchInvTable'),
    source('approveInv',true)
  ].join('\n'),c);
  return {c,nodes};
}

(async function main(){
  {
    const {c,nodes}=setup();
    const local=c.INVS.map(raw=>({kind:'inv',raw,rows:[raw]}));
    const pending=c.approvalPendingCandidateItems(local);
    assert.equal(pending.length,2);
    assert.deepEqual(plain(pending.map(item=>item.rows.length)),[18,13]);
    assert.deepEqual(plain(pending.map(item=>item.approvalSummaryGroupKey)),['batch:batch-3','batch:batch-4']);
    assert(pending.every(item=>!item.approvalBatchLoading&&c.approvalItemActionAvailability(item).ok));
    assert.deepEqual(plain(pending.map(c.approvalRowFormNo)),['整批 batch-3','整批 batch-4']);
    assert.deepEqual(plain(pending.map(c.approvalRowAmount)),[9000,20600]);
    assert(pending.every(item=>c.approvalRowSummary(item).includes('整批 '+item.rows.length+' 張')));
    c.renderApprList(pending);
    assert.equal((nodes['appr-list'].innerHTML.match(/data-appr-key=/g)||[]).length,2);
    assert.match(nodes['appr-list'].innerHTML,/整批 batch-3/);
    assert.match(nodes['appr-list'].innerHTML,/整批 batch-4/);
    assert.match(nodes['appr-list'].innerHTML,/NT\$9,000/);
    assert.match(nodes['appr-list'].innerHTML,/NT\$20,600/);
    assert.equal((nodes['appr-list'].innerHTML.match(/整批開立發票/g)||[]).length,2);
    c.renderInvTable();
    assert.equal((nodes['inv-tbody'].innerHTML.match(/<tr>/g)||[]).length,2);
    assert.equal((nodes['inv-tbody'].innerHTML.match(/查看整批簽核/g)||[]).length,2);
    c.renderBatchInvTable();
    assert.equal((nodes.bitbody.innerHTML.match(/<tr>/g)||[]).length,2);
    c.renderInvoiceManagementList();
    assert.equal((nodes['invoice-manage-list'].innerHTML.match(/data-invoice-batch=/g)||[]).length,2);
    assert.equal((nodes['invoice-manage-list'].innerHTML.match(/查看整批簽核/g)||[]).length,2);
    const opened=[];c.showInvApprD=(row,item)=>opened.push({row,item});
    await c.window.approveInv(group3[0]);await c.window.approveInv(group4[0]);
    assert.deepEqual(plain(opened.map(entry=>entry.item.rows.length)),[18,13]);
    console.log('PASS 18 + 13 invoices become two complete approval groups and two action entries');
  }
  {
    const {c}=setup();
    c.INVS.forEach(row=>{row.applicant='同一申請人';row.desc='相同開立原因';row.verified=true;});
    const groups=c.uniqueInvoiceGroups(c.INVS);
    assert.equal(groups.length,2);
    assert.deepEqual(plain(groups.map(group=>c.invoiceGroupRows(group).length)),[18,13]);
    const pending=c.approvalPendingCandidateItems(c.INVS.map(raw=>({kind:'inv',raw,rows:[raw]})));
    assert.equal(pending.length,2);
    assert.deepEqual(plain(pending.map(item=>item.approvalSummaryGroupKey)),['batch:batch-3','batch:batch-4']);
    console.log('PASS same reason and applicant on distinct submissions never merge across batch IDs');
  }
  {
    const {c}=setup();
    const file={path:'fictional/shared-source.pdf'};
    const legacy=[
      {id:'legacy-1',no:'INV-OLD-1',sourceBillId:'shared-bill',contractId:'shared-contract',period:'2026-10',steps:[{files:[file]}]},
      {id:'legacy-2',no:'INV-OLD-2',sourceBillId:'shared-bill',contractId:'shared-contract',period:'2026-10',steps:[{files:[file]}]}
    ];
    assert.deepEqual(plain(legacy.map(c.invoiceGroupKey)),['inv:legacy-1','inv:legacy-2']);
    assert.equal(c.uniqueInvoiceGroups(legacy).length,2);
    console.log('PASS legacy invoices sharing source attachment, bill, contract and period remain distinct applications');
  }
  {
    const {c,nodes}=setup();
    c.INVS=c.INVS.filter(row=>row.id!==group3[17]);
    const pending=c.approvalPendingCandidateItems(c.INVS.map(raw=>({kind:'inv',raw,rows:[raw]})));
    assert.equal(pending.length,2);
    assert.equal(pending[0].approvalBatchLoading,true);
    assert.equal(pending[0].rows.length,0);
    assert.equal(c.approvalItemActionAvailability(pending[0]).ok,false);
    assert.equal(pending[1].rows.length,13);
    c.renderApprList([pending[0]]);
    assert.equal((nodes['appr-list'].innerHTML.match(/<tr /g)||[]).length,1);
    assert.match(nodes['appr-list'].innerHTML,/整批載入中/);
    assert(!nodes['appr-list'].innerHTML.includes('openApprovalItem('));
    assert(!nodes['appr-list'].innerHTML.includes('class="appr-pick"'));
    c.renderInvTable();
    assert.equal((nodes['inv-tbody'].innerHTML.match(/整批載入中/g)||[]).length>=1,true);
    assert.equal((nodes['inv-tbody'].innerHTML.match(/查看整批簽核/g)||[]).length,1);
    console.log('PASS missing row keeps one disabled batch placeholder and never leaks a singleton action');
  }
  {
    const {c}=setup();
    c.summaries[1].source_ids[0]=group3[0];
    assert(c.approvalPendingInvoiceSummaryItems().every(item=>item.approvalBatchLoading));
    c.summaries=makeSummary();c.INVS[5].stepKey='3|accountant_invoice|finance-user:accountant';
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].approvalBatchLoading,true);
    c.INVS=makeRows().map(row=>Object.assign(row,{verified:true}));c.INVS.push({...c.INVS[0]});
    assert.equal(c.approvalPendingInvoiceSummaryItems()[0].approvalBatchLoading,true);
    console.log('PASS overlapping summary IDs and mixed approval steps fail closed');
  }
  {
    const {c,nodes}=setup();
    const item=c.approvalPendingInvoiceSummaryItems()[0];
    c.INVS.push({id:'extra-local',batchId:'batch-3',stepKey:item.rows[0].stepKey,total:1,verified:true,steps:[{}]});
    c.renderInvoiceManagementList();
    const banner=nodes['invoice-manage-list'].innerHTML.match(/data-invoice-batch="batch-3"[\s\S]*?<\/div>/);
    assert(banner);
    assert.match(banner[0],/NT\$9,000/);
    assert.doesNotMatch(banner[0],/NT\$9,001/);
    c.APPROVAL_INVOICE_MODAL_GROUP={key:item.approvalSummaryGroupKey,sourceIds:item.approvalSourceIds.slice(),identity:'identity'};
    const rows=c.invoiceGroupRows(item.raw),actionRows=c.invoiceBatchActionRows(item.raw);
    assert.deepEqual(plain(rows.map(row=>row.id)),group3);
    assert.deepEqual(plain(actionRows.map(row=>row.id)),group3);
    c.summaries[0].source_ids=group3.slice(0,17);
    assert.equal(c.invoiceBatchActionRows(item.raw).length,0);
    console.log('PASS modal detail and action use exactly trusted source IDs, never an extra local sibling');
  }
  {
    const calls=[],rows=makeRows(),c={
      console,Date,Promise,Object,Array,String,Number,Math,Set,Map,JSON,Error,S:{demoLogin:false},
      approvalActionValidation:()=>({ok:true}),
      approvalRecordsActionAvailability:(_table,explicit)=>({ok:true,rows:explicit}),
      approvalRowsHaveReconcilePending:()=>false,hasSupabase:()=>true,
      approvalValidatedExpectedSteps:(_rows,expected)=>expected,
      cloneSettingValue:value=>JSON.parse(JSON.stringify(value)),activeStep:row=>row.steps[0],
      invoiceNeedsReceivableFollowup:()=>false,
      incomeActionContext:()=>({key:'same-logical-action'}),normalizeFiles:files=>files,
      activeDataEnvironment:()=> 'production',
      getSb:()=>({rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data:{ok:true,count:args.p_invoice_ids.length},error:null});}}),
      financeMutationRpcWithAmbiguousRetry:async (_name,_args,_count,_readback,_context,_meta,callRpc)=>({response:await callRpc()}),
      normalizeSettingValue:value=>value,num:value=>Number(value)||0,
      reloadInvoicesByIds:async()=>false,setTopSyncStatus:()=>{},approvalSetReconcilePending:()=>{},
      refreshApprovalAfterCommittedAction:async()=>true,clearIncomeActionContext:()=>{},
      invoiceBatchActionRows:()=>{throw Error('explicit rows must be used');}
    };
    vm.createContext(c);vm.runInContext(source('invoiceActiveStepTransaction'),c);
    for(const expectedIds of [group3,group4]){
      const selected=rows.filter(row=>expectedIds.includes(row.id));
      const expected=Object.fromEntries(selected.map(row=>[row.id,{row_version:1,step_index:2}]));
      const result=await c.invoiceActiveStepTransaction(selected[0],'approve','',[],'',{},expected,selected);
      assert.equal(result.ok,true);assert.equal(result.count,expectedIds.length);
    }
    assert.equal(calls.length,2);
    assert.deepEqual(plain(calls.map(call=>call.args.p_invoice_ids)),[group3,group4]);
    assert(calls.every(call=>call.name==='finance_invoice_act_active_step_v2'));
    console.log('PASS one action per batch calls the transactional RPC once with all 18 or 13 exact IDs');
  }
  console.log('OK: invoice batch approval summary checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
