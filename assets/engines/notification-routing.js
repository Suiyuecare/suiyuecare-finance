(function(global){
  'use strict';
  function runtime() {
    if (!global.FinanceApprovalRuntime) throw new Error('簽核功能尚未完成載入，請重新整理後再試。');
    return global.FinanceApprovalRuntime;
  }
  var types=['expense_requests','invoices','bills'];
  function identity(){return runtime().approvalFastBootstrapIdentity()+'|'+runtime().activeDataEnvironment()+'|'+runtime().isIdentityBlocked();}
  function entries(type){return type==='invoices'?runtime().INVS:(type==='bills'?runtime().BILLS:runtime().REQS);}
  function mapped(type,row){return type==='invoices'?runtime().mapInv(row):(type==='bills'?runtime().mapBill(row):runtime().mapReq(row));}
  function setEntries(type,rows){if(type==='invoices')runtime().INVS=rows;else if(type==='bills')runtime().BILLS=rows;else runtime().REQS=rows;}
  global.financeNotificationRecordType=function(n){
    var explicit=n.recordType||n.record_type||'';if(types.indexOf(explicit)!==-1)return explicit;
    if(n.type==='receipt')return 'invoices';
    var matches=types.filter(function(type){return (entries(type)||[]).some(function(row){return row.id===n.reqId;});});
    return matches.length===1?matches[0]:null;
  };
  global.openFinanceNotification=async function(id){
    if(runtime().isIdentityBlocked())return false;
    var n=runtime().NOTIFS.find(function(row){return row.id===id;}),expected=identity();if(!n)return false;
    if(!n.reqId){await runtime().markNotifRead(id);return true;}
    try{
      var explicit=n.recordType||n.record_type||(n.type==='receipt'?'invoices':'');
      var targets=types.indexOf(explicit)!==-1?[explicit]:types;
      var results=await Promise.all(targets.map(async function(type){
        if(runtime().S.demoLogin){var local=(entries(type)||[]).find(function(row){return row.id===n.reqId;});return local?{type:type,row:local}:null;}
        var result=await runtime().getSb().from(type).select('*').eq('id',n.reqId).eq('tenant_id',runtime().currentTenantId()).eq('data_environment',runtime().activeDataEnvironment()).maybeSingle();
        if(result.error)throw result.error;
        return result.data?{type:type,row:mapped(type,result.data)}:null;
      }));
      if(identity()!==expected)throw new Error('登入身分已變更，請重新開啟通知。');
      results=results.filter(Boolean);
      if(results.length!==1)throw new Error(results.length?'通知的來源資料不明確，請從簽核或收款清單查找原單。':'找不到此通知的原單，或您目前沒有讀取權限；通知仍保留未讀。');
      var match=results[0],rows=entries(match.type)||[];
      setEntries(match.type,rows.filter(function(row){return row.id!==match.row.id;}).concat([match.row]));
      if(typeof runtime().approvalRowsMarkVerified==='function')runtime().approvalRowsMarkVerified(match.type,[match.row]);
      if(match.type==='invoices'){
        if(n.type==='receipt')runtime().showReceiptTaskD(match.row);else runtime().showInvApprD(match.row);
      }else if(match.type==='bills')runtime().showBillApprD(match.row);
      else runtime().openDetail(match.row.id);
      // A missing/inaccessible source never silently consumes the unread item.
      await runtime().markNotifRead(id);return true;
    }catch(error){if(identity()===expected)global.alert('無法開啟通知：'+(error.message||'請稍後再試'));return false;}
  };
})(typeof window!=='undefined'?window:globalThis);
