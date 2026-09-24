(function (global) {
  'use strict';
  function runtime() {
    if (!global.FinanceApprovalRuntime) throw new Error('簽核功能尚未完成載入，請重新整理後再試。');
    return global.FinanceApprovalRuntime;
  }
  // Persist before dispatch: a client deadline cannot undo a server commit.
  // Retries, including after reload, must use the original proof and row versions.
  var stores=Object.create(null),running=Object.create(null);
  function owner(){var r=runtime(),u=r.S.user||{};return JSON.stringify([r.currentTenantId(),r.activeDataEnvironment(),u.id||'',r.currentFinanceAuthUserId?r.currentFinanceAuthUserId():u.authUserId||u.auth_user_id||'']);}
  function identity(){var r=runtime();return owner()+'|'+r.isIdentityBlocked()+'|'+(r.permissionIdentity?r.permissionIdentity():'')+'|'+(r.identityEpoch?r.identityEpoch():0);}
  function current(expected){return !!runtime().S.user&&!runtime().S.demoLogin&&!runtime().isIdentityBlocked()&&identity()===expected;}
  function verify(expected){if(!current(expected))throw unknown('登入身分或工作區已變更，請以原身分確認原收款結果。',true);}
  function storageKey(scope){return 'finance_receipt_pending_v2:'+scope;}
  function store(){
    var scope=owner();if(stores[scope])return stores[scope];
    var data;
    try{var raw=runtime().sessionGetItem(storageKey(scope));data=raw?JSON.parse(raw):{};}
    catch(_){throw new Error('原收款操作記錄無法讀取，請保留此頁並聯絡系統管理員，勿另行重送。');}
    if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).some(function(key){var op=data[key];return !op||op.key!==key||op.owner!==scope||!op.args||op.args.p_idempotency_key!==key||!Array.isArray(op.args.p_invoice_ids)||!op.args.p_invoice_ids.length;}))throw new Error('原收款操作記錄不完整，請保留此頁並聯絡系統管理員，勿另行重送。');
    stores[scope]=data;return data;
  }
  function save(operation){var data=store(),next=Object.assign({},data);next[operation.key]=operation;if(!runtime().sessionSetItem(storageKey(operation.owner),JSON.stringify(next)))throw new Error('無法安全保存原收款識別碼，尚未送出新交易；請保留附件並確認瀏覽器儲存空間。');stores[operation.owner]=next;}
  function remove(operation){if(operation.owner!==owner())return;var data=store();delete data[operation.key];runtime().sessionSetItem(storageKey(operation.owner),JSON.stringify(data));}
  function unknown(message,changed){var error=new Error(message||'收款結果待確認。原內容與識別碼已保留；請按「確認原處理結果」，勿變更金額另行重送。');error.code='FINANCE_MUTATION_RESULT_UNKNOWN';error.identityChanged=!!changed;return error;}
  function markUnknown(operation,message){if(operation.owner===owner()&&!runtime().isIdentityBlocked()&&runtime().approvalSetReconcilePending)runtime().approvalSetReconcilePending('invoice',operation.args.p_invoice_ids,true);return unknown(message);}
  function wait(promise,label,ms){return runtime().withOperationTimeout(promise,label,ms);}
  function pendingFor(ids){return Object.keys(store()).map(function(key){return store()[key];}).find(function(op){return op.owner===owner()&&op.args&&op.args.p_invoice_ids.some(function(id){return ids.indexOf(id)>-1;});});}
  async function run(operation){
    var expected=identity();verify(expected);
    if(running[operation.key])throw unknown('這批收款正在確認，請稍候。');
    running[operation.key]=true;
    try{
      if(runtime().ensureSupabaseWriteReady){var ready=await wait(runtime().ensureSupabaseWriteReady('收款處理'),'確認收款登入',10000);verify(expected);if(!ready.ok)throw new Error(ready.message||'登入驗證尚未完成');}
      var hadUnknown=operation.unknown===true,response=operation.response;
      if(!response){
        operation.unknown=true;save(operation);
        for(var attempt=0;attempt<2;attempt++){
          verify(expected);
          try{response=await wait(runtime().getSb().rpc('finance_invoice_receipt_action_v2',JSON.parse(JSON.stringify(operation.args))),'確認原收款交易',15000);}
          catch(error){response={error:error};}
          if(!current(expected))throw unknown('登入身分已變更，原收款結果待確認；請以原身分重新讀取。',true);
          if(response&&!response.error&&response.data&&response.data.ok===true&&Number(response.data.count)===operation.args.p_invoice_ids.length){operation.response=response;try{save(operation);}catch(_){}break;}
          var definitive=response&&response.error&&!(runtime().expenseApplicantRevisionRpcErrorIsAmbiguous&&runtime().expenseApplicantRevisionRpcErrorIsAmbiguous(response.error));
          if(attempt===0&&!hadUnknown&&definitive){remove(operation);throw response.error;}
          hadUnknown=true;
          if(attempt===1)throw markUnknown(operation);
        }
      }
      var ids=operation.args.p_invoice_ids,reloaded=false;
      try{reloaded=await wait(runtime().reloadInvoicesByIds(ids),'讀取收款結果',12000);}catch(_){}
      if(!current(expected))return {ok:true,committed:true,count:ids.length,refreshRequired:true,identityChanged:true};
      if(runtime().approvalSetReconcilePending)runtime().approvalSetReconcilePending('invoice',ids,!reloaded);
      if(!reloaded){runtime().setTopSyncStatus('收款已正式保存，最新狀態待同步；請確認原處理結果。');return {ok:true,committed:true,count:ids.length,refreshRequired:true};}
      if(runtime().refreshApprovalAfterCommittedAction){try{var refreshed=await wait(runtime().refreshApprovalAfterCommittedAction('receipt_'+operation.args.p_action,'invoices',ids),'同步收款待辦',12000);if(!current(expected))return {ok:true,committed:true,count:ids.length,refreshRequired:true,identityChanged:true};if(refreshed===false)return {ok:true,committed:true,count:ids.length,refreshRequired:true};}catch(_){return {ok:true,committed:true,count:ids.length,refreshRequired:true,identityChanged:!current(expected)};}}
      remove(operation);return {ok:true,committed:true,count:ids.length};
    }catch(error){
      if(!current(expected)&&!error.identityChanged)throw unknown('登入身分已變更，請以原身分確認原收款結果。',true);
      if(operation.unknown&&error.code!=='FINANCE_MUTATION_RESULT_UNKNOWN'&&store()[operation.key])throw markUnknown(operation,error.message);
      if(!operation.unknown)remove(operation);
      throw error;
    }finally{delete running[operation.key];}
  }
  global.financeReceiptPendingActions=function(){if(!runtime().S.user||runtime().S.demoLogin||runtime().isIdentityBlocked())return [];return Object.keys(store()).map(function(key){return store()[key];}).filter(function(op){return op.owner===owner()&&op.args;}).map(function(op){return JSON.parse(JSON.stringify(op));});};
  global.financeReceiptPendingForRows=function(rows){var op=pendingFor((rows||[]).map(function(row){return row.id;}));return op?JSON.parse(JSON.stringify(op)):null;};
  global.financeRetryReceiptAction=async function(key){var op=store()[key];if(!op||op.owner!==owner())throw new Error('找不到本人原收款操作，請重新讀取。');return run(op);};
  global.financeReceiptAction=async function(rows,action,note,files,versions,options){
    options=options||{};var expected=identity();verify(expected);
    if(!rows.length||rows.some(function(row){return !(Number(versions&&versions[row.id])>0);}))throw new Error('收款版本尚未確認，請重新開啟資料核對。');
    var ids=rows.map(function(row){return row.id;}).sort(),unique=runtime().uniqueAttachments||function(value){return value;};
    if(Array.isArray(files))files=unique(files);else if(files&&typeof files==='object'){var clean={};Object.keys(files).forEach(function(id){clean[id]=unique(files[id]);});files=clean;}
    var args={p_invoice_ids:ids,p_action:action,p_note:note||'',p_files:files||[],p_expected_versions:versions,p_data_environment:runtime().activeDataEnvironment(),p_amounts:action==='submit'?(options.amounts||null):null,p_received_date:action==='submit'?(options.receivedDate||null):null};
    var fingerprint=JSON.stringify(args),operation=pendingFor(ids);
    if(operation&&operation.fingerprint!==fingerprint)throw markUnknown(operation,'已有原收款結果待確認，請先按「確認原處理結果」。金額、附件或版本變更尚未另行送出。');
    if(!operation){var key=global.crypto.randomUUID();args.p_idempotency_key=key;operation={key:key,owner:owner(),fingerprint:fingerprint,args:JSON.parse(JSON.stringify(args)),unknown:false};save(operation);}
    return run(operation);
  };
})(typeof window!=='undefined'?window:globalThis);
