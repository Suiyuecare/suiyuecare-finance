(function(global){
  'use strict';
  // Sum canonical server balances only. Workflow status never supplies money.
  var fields=['originalAmount','recognizedAmount','allowanceAmount','arAllowanceAmount','receivedAmount','pendingReceiptAmount','refundPayable','refundedAmount'];
  var derived=['outstandingAmount','signedOutstandingAmount','creditAmount','overdueAmount','unknownDueAmount'];
  function cents(value){
    if(typeof value!=='number'||!Number.isFinite(value))return null;
    var scaled=value*100,rounded=Math.round(scaled);
    return Number.isSafeInteger(rounded)&&Math.abs(scaled-rounded)<0.001?rounded:null;
  }
  function unavailable(errors,missing){var result={ready:false,count:0,settledCount:null,missingIds:missing||[],errors:errors||[]};fields.concat(derived).forEach(function(k){result[k]=null;});return result;}
  function summarize(items){
    if(!Array.isArray(items))return unavailable(['canonical_items_unavailable']);
    var seen=new Set(),sums={},errors=[],settled=0;fields.concat(derived).forEach(function(k){sums[k]=0;});
    items.forEach(function(row){
      if(!row||typeof row.invoiceId!=='string'||!row.invoiceId.trim()){errors.push('invoice_id_missing');return;}
      if(seen.has(row.invoiceId)){errors.push('duplicate_invoice:'+row.invoiceId);return;}seen.add(row.invoiceId);
      var amounts={},valid=true;fields.concat(['outstandingAmount']).forEach(function(k){var value=cents(row[k]);if(value===null){errors.push('invalid_amount:'+row.invoiceId+':'+k);valid=false;}else amounts[k]=value;});
      if(!valid)return;
      fields.forEach(function(k){sums[k]+=amounts[k];});
      var outstanding=amounts.outstandingAmount;sums.signedOutstandingAmount+=outstanding;sums.outstandingAmount+=Math.max(0,outstanding);sums.creditAmount+=Math.max(0,-outstanding);
      if(typeof row.overdueDays==='number'&&row.overdueDays>0)sums.overdueAmount+=Math.max(0,outstanding);
      if(!row.dueDate)sums.unknownDueAmount+=Math.max(0,outstanding);
      if(row.balanceStatus==='settled')settled++;
    });
    Object.keys(sums).forEach(function(k){if(!Number.isSafeInteger(sums[k]))errors.push('unsafe_total:'+k);});
    if(errors.length)return unavailable(errors);
    var result={ready:true,count:items.length,settledCount:settled,missingIds:[],errors:[]};Object.keys(sums).forEach(function(k){result[k]=sums[k]/100;});return result;
  }
  function summarizeInvoices(invoices,canonicalItems){
    if(!Array.isArray(invoices)||!Array.isArray(canonicalItems))return unavailable(['canonical_items_unavailable']);
    var index=new Map(),duplicates=new Set();canonicalItems.forEach(function(row){if(!row)return;if(index.has(row.invoiceId))duplicates.add(row.invoiceId);index.set(row.invoiceId,row);});
    var wanted=new Set(),selected=[],missing=[],errors=[];
    invoices.forEach(function(row){var id=typeof row==='string'?row:row&&(row.id||row.invoiceId);if(!id){errors.push('invoice_id_missing');return;}if(wanted.has(id)){errors.push('duplicate_requested_invoice:'+id);return;}wanted.add(id);if(duplicates.has(id))errors.push('duplicate_invoice:'+id);if(!index.has(id))missing.push(id);else selected.push(index.get(id));});
    return errors.length||missing.length?unavailable(errors,missing):summarize(selected);
  }
  function group(items,key){
    if(!Array.isArray(items))throw new TypeError('Canonical receivable items are required');
    var selector=typeof key==='function'?key:function(row){return row[key];},groups=new Map();
    items.forEach(function(row){var value=selector(row);if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);});
    return Array.from(groups,function(pair){return{key:pair[0],items:pair[1].slice(),summary:summarize(pair[1])};});
  }
  var api=Object.freeze({summarize:summarize,summarizeInvoices:summarizeInvoices,group:group});
  global.FinanceReceivablesEngine=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
