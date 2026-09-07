(function(global){
  'use strict';
  var types=['expense_requests','invoices','bills'];
  function identity(){return global.approvalFastBootstrapIdentity()+'|'+global.activeDataEnvironment();}
  function entries(type){return type==='invoices'?global.INVS:(type==='bills'?global.BILLS:global.REQS);}
  function mapped(type,row){return type==='invoices'?global.mapInv(row):(type==='bills'?global.mapBill(row):global.mapReq(row));}
  function setEntries(type,rows){if(type==='invoices')global.INVS=rows;else if(type==='bills')global.BILLS=rows;else global.REQS=rows;}
  global.financeNotificationRecordType=function(n){
    var explicit=n.recordType||n.record_type||'';if(types.indexOf(explicit)!==-1)return explicit;
    if(n.type==='receipt')return 'invoices';
    var matches=types.filter(function(type){return (entries(type)||[]).some(function(row){return row.id===n.reqId;});});
    return matches.length===1?matches[0]:null;
  };
  global.openFinanceNotification=async function(id){
    var n=global.NOTIFS.find(function(row){return row.id===id;}),expected=identity();if(!n)return false;
    if(!n.reqId){await global.markNotifRead(id);return true;}
    try{
      var explicit=n.recordType||n.record_type||(n.type==='receipt'?'invoices':'');
      var targets=types.indexOf(explicit)!==-1?[explicit]:types;
      var results=await Promise.all(targets.map(async function(type){
        if(global.S.demoLogin){var local=(entries(type)||[]).find(function(row){return row.id===n.reqId;});return local?{type:type,row:local}:null;}
        var result=await global.getSb().from(type).select('*').eq('id',n.reqId).eq('tenant_id',global.currentTenantId()).eq('data_environment',global.activeDataEnvironment()).maybeSingle();
        if(result.error)throw result.error;
        return result.data?{type:type,row:mapped(type,result.data)}:null;
      }));
      if(identity()!==expected)throw new Error('登入身分已變更，請重新開啟通知。');
      results=results.filter(Boolean);
      if(results.length!==1)throw new Error(results.length?'通知的來源資料不明確，請從簽核或收款清單查找原單。':'找不到此通知的原單，或您目前沒有讀取權限；通知仍保留未讀。');
      var match=results[0],rows=entries(match.type)||[];
      setEntries(match.type,rows.filter(function(row){return row.id!==match.row.id;}).concat([match.row]));
      if(typeof global.approvalRowsMarkVerified==='function')global.approvalRowsMarkVerified(match.type,[match.row]);
      if(match.type==='invoices'){
        if(n.type==='receipt')global.showReceiptTaskD(match.row);else global.showInvApprD(match.row);
      }else if(match.type==='bills')global.showBillApprD(match.row);
      else global.openDetail(match.row.id);
      // A missing/inaccessible source never silently consumes the unread item.
      await global.markNotifRead(id);return true;
    }catch(error){if(identity()===expected)global.alert('無法開啟通知：'+(error.message||'請稍後再試'));return false;}
  };
})(typeof window!=='undefined'?window:globalThis);
