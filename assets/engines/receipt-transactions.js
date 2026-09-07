(function (global) {
  'use strict';
  var pending = Object.create(null);
  function identity() { return [global.currentTenantId(),global.activeDataEnvironment(),global.S.user&&global.S.user.id,global.S.user&&(global.S.user.authUserId||global.S.user.auth_user_id)].join('|'); }
  function verify(expected) { if(!global.S.user||global.S.demoLogin||identity()!==expected)throw new Error('登入身分或工作區已變更，請重新開啟收款資料。'); }
  global.financeReceiptAction = async function(rows,action,note,files,versions){
    var expected=identity();verify(expected);
    if(!rows.length||rows.some(function(row){return !(Number(versions&&versions[row.id])>0);}))throw new Error('收款版本尚未確認，請重新開啟資料核對。');
    var ids=rows.map(function(row){return row.id;}).sort();
    var unique=typeof global.uniqueAttachments==='function'?global.uniqueAttachments:function(value){return value;};
    if(Array.isArray(files))files=unique(files);else if(files&&typeof files==='object'){var clean={};Object.keys(files).forEach(function(id){clean[id]=unique(files[id]);});files=clean;}
    var args={p_invoice_ids:ids,p_action:action,p_note:note||'',p_files:files||[],p_expected_versions:versions,p_data_environment:global.activeDataEnvironment()};
    var fingerprint=expected+'|'+JSON.stringify(args);
    var operation=pending[fingerprint]||(pending[fingerprint]={key:global.crypto.randomUUID(),running:false});
    if(operation.running)throw new Error('這批收款正在處理，請稍候。');
    operation.running=true;args.p_idempotency_key=operation.key;
    try{
      if(typeof global.ensureSupabaseWriteReady==='function'){
        var ready=await global.ensureSupabaseWriteReady('收款處理');if(!ready.ok)throw new Error(ready.message||'登入驗證尚未完成');
      }
      verify(expected);
      var response;
      function uncertain(message){
        if(identity()===expected&&typeof global.approvalSetReconcilePending==='function')global.approvalSetReconcilePending('invoice',ids,true);
        var error=new Error(message);error.code='FINANCE_MUTATION_RESULT_UNKNOWN';return error;
      }
      for(var attempt=0;attempt<2;attempt++){
        try{response=await global.getSb().rpc('finance_invoice_receipt_action_v1',args);}
        catch(error){response={error:error};}
        if(identity()!==expected)throw uncertain('登入身分已變更，上一個身分的收款結果待確認；請使用原身分重新讀取。');
        if(!response.error)break;
        var ambiguous=typeof global.expenseApplicantRevisionRpcErrorIsAmbiguous==='function'&&global.expenseApplicantRevisionRpcErrorIsAmbiguous(response.error);
        if(!ambiguous)throw response.error;
        if(attempt===1){
          if(typeof global.approvalSetReconcilePending==='function')global.approvalSetReconcilePending('invoice',ids,true);
          var unknown=new Error('收款結果待確認。已使用同一操作識別碼重試；請勿另開分頁重送，重新讀取正式資料後再處理。');unknown.code='FINANCE_MUTATION_RESULT_UNKNOWN';throw unknown;
        }
      }
      if(!response.data||response.data.ok!==true||Number(response.data.count)!==rows.length){throw uncertain('收款回應不完整，結果待確認，請勿重複送出。');}
      // Never mutate or restore local rows/ledger: only authoritative readback
      // can change their displayed state, even when a committed read fails.
      var reloaded=false;
      try{reloaded=await global.reloadInvoicesByIds(ids);}catch(ignore){}
      if(identity()!==expected)return {ok:true,committed:true,count:rows.length,refreshRequired:true,identityChanged:true};
      if(typeof global.approvalSetReconcilePending==='function')global.approvalSetReconcilePending('invoice',ids,!reloaded);
      if(!reloaded){global.setTopSyncStatus('收款已正式保存，最新狀態待同步；請重新整理。');return {ok:true,committed:true,count:rows.length,refreshRequired:true};}
      if(typeof global.refreshApprovalAfterCommittedAction==='function'){try{var refreshed=await global.refreshApprovalAfterCommittedAction('receipt_'+action,'invoices',ids);if(refreshed===false)return {ok:true,committed:true,count:rows.length,refreshRequired:true,identityChanged:identity()!==expected};}catch(ignore){return {ok:true,committed:true,count:rows.length,refreshRequired:true};}}
      return {ok:true,committed:true,count:rows.length};
    }finally{operation.running=false;}
  };
})(typeof window!=='undefined'?window:globalThis);
