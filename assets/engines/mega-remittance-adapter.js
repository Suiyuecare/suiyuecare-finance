(function(global){
  'use strict';
  // Translate only a freshly authorized server snapshot. Never use the list cache
  // or a browser draft as payment authority.
  function adapt(data,source){
    if(!data||data.ok!==true)return {ok:false,eligible:false,issues:[{message:'尚未取得已核准的匯款資料，請重新讀取。'}]};
    // Ineligible snapshots intentionally contain no private request or rows.
    // Only fixed server reason codes can cross this display boundary.
    if(['waiting','unavailable'].indexOf(data.exportPurpose)>-1&&typeof data.requestId==='string'&&data.requestId){
      var reasons={before_history_cutoff:'historical_before_cutoff',submission_evidence_missing:'historical_submission_unverified',cancelled_or_rejected:'historical_status_invalid',payment_not_applicable:'export_unavailable',accounting_correction_requires_review:'historical_correction_unsupported',cashier_evidence_missing:'historical_cashier_unverified',cashier_evidence_incomplete:'historical_cashier_unverified',payment_evidence_incomplete:'historical_payment_unverified',payment_timestamp_invalid:'historical_payment_unverified',historical_amount_incomplete:'historical_principal_missing',historical_amount_mismatch:'historical_cash_mismatch',awaiting_cashier:'waiting_for_cashier'};
      return {ok:true,authorized:true,eligible:false,exportPurpose:data.exportPurpose,reasonCode:Object.prototype.hasOwnProperty.call(reasons,data.reason)?reasons[data.reason]:'export_unavailable',
        requestId:data.requestId,stage:typeof data.stage==='string'?data.stage:'',sourceVersion:data.sourceVersion,sourceDigest:data.sourceDigest,
        submittedAt:data.submittedAt||null,submissionSource:data.submissionSource||null,historyCutoff:data.historyCutoff||null,
        sourceBasis:null,paidAt:null,mode:'',rows:[],expectedTotal:null,issues:[],excludedRows:[],canSupplement:false,supplementRows:[]};
    }
    if(!data.request||!source||typeof source.resolve!=='function')return {ok:false,eligible:false,issues:[{message:'尚未取得已核准的匯款資料，請重新讀取。'}]};
    var resolved=source.resolve(data.request,{supplements:data.supplements||[],exportPurpose:data.exportPurpose,
      submittedAt:data.submittedAt,submissionSource:data.submissionSource,historyCutoff:data.historyCutoff});
    var context=resolved.context||{};
    var supplementRows=[];
    if(data.canSupplement===true&&resolved.eligible===true)(resolved.issues||[]).forEach(function(issue){
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
      exportPurpose:resolved.exportPurpose,reasonCode:resolved.reasonCode,
      submittedAt:data.submittedAt||null,submissionSource:data.submissionSource||null,historyCutoff:data.historyCutoff||null,
      paidAt:context.paidAt||null,sourceBasis:context.sourceBasis||null,
      requestId:context.requestId||data.request.id,requestNo:context.requestNo||data.request.no,
      sourceVersion:data.sourceVersion,sourceDigest:data.sourceDigest,
      mode:resolved.mode,rows:resolved.rows||[],expectedTotal:resolved.expectedTotal,
      issues:resolved.issues||[],excludedRows:resolved.excludedRows||[],
      entityLabel:context.entityId||data.request.entity_id,paymentDate:context.payDate||'',
      feeBearer:context.feeBearer||'',companyFee:context.bankFeeAmount,
      canSupplement:data.canSupplement===true&&resolved.eligible===true,supplementRows:supplementRows
    };
  }
  function filename(snapshot){
    var no=String(snapshot.requestNo||snapshot.requestId||'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100);
    return (snapshot.exportPurpose==='historical'?'已付款_歷史補檔_勿重複匯款_':'')+'兆豐_'+(snapshot.mode==='payroll'?'薪轉':'整批匯款')+'_'+no+'.xlsx';
  }
  var api=Object.freeze({adapt:adapt,filename:filename});
  global.FinanceMegaRemittanceAdapter=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
