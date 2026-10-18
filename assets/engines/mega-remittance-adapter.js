(function(global){
  'use strict';
  // Translate only a freshly authorized server snapshot. Never use the list cache
  // or a browser draft as payment authority.
  function adapt(data,source){
    if(!data||data.ok!==true||!data.request||!source||typeof source.resolve!=='function')return {ok:false,eligible:false,issues:[{message:'尚未取得已核准的匯款資料，請重新讀取。'}]};
    var resolved=source.resolve(data.request,{supplements:data.supplements||[]});
    var context=resolved.context||{};
    var supplementRows=[];
    if(data.canSupplement===true)(resolved.issues||[]).forEach(function(issue){
      if(!issue.rowKey||['name','bankCode'].indexOf(issue.field)<0||['text_required','bank_code_invalid','name_or_identity_required'].indexOf(issue.code)<0)return;
      var row=supplementRows.find(function(x){return x.rowKey===issue.rowKey;});
      if(!row){
        var sourceIndex=(resolved.sourceRowKeys||[]).indexOf(issue.rowKey),payment=(resolved.rows||[])[sourceIndex]||{};
        row={rowKey:issue.rowKey,row:issue.row,fields:[],account:payment.account,amount:payment.amount};supplementRows.push(row);
      }
      if(row.fields.indexOf(issue.field)<0)row.fields.push(issue.field);
    });
    return {
      ok:true,authorized:true,eligible:resolved.eligible,stage:data.request.status,
      requestId:context.requestId||data.request.id,requestNo:context.requestNo||data.request.no,
      sourceVersion:data.sourceVersion,sourceDigest:data.sourceDigest,
      mode:resolved.mode,rows:resolved.rows||[],expectedTotal:resolved.expectedTotal,
      issues:resolved.issues||[],excludedRows:resolved.excludedRows||[],
      entityLabel:context.entityId||data.request.entity_id,paymentDate:context.payDate||'',
      feeBearer:context.feeBearer||'',companyFee:context.bankFeeAmount,
      canSupplement:data.canSupplement===true,supplementRows:supplementRows
    };
  }
  function filename(snapshot){
    var no=String(snapshot.requestNo||snapshot.requestId||'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100);
    return '兆豐_'+(snapshot.mode==='payroll'?'薪轉':'整批匯款')+'_'+no+'.xlsx';
  }
  var api=Object.freeze({adapt:adapt,filename:filename});
  global.FinanceMegaRemittanceAdapter=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
