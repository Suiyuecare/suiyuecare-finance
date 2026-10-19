(function(global){
  'use strict';
  var BANK_ENGINE=typeof module!=='undefined'&&module.exports?require('./mega-remittance-engine.js'):null;
  var TYPES=['expense_reimbursement','payment_request','advance_request','petty_cash_request','travel_request','purchase_request','refund_request','welfare_request','hr_expense_request'];
  var HR_ITEMS=['salary_50','bonus','labor_fee_9a','labor_fee_9b','labor_insurance','health_insurance','labor_pension','supplemental_premium','severance_termination','hr_other'];
  var SOURCE_VERSION='mega-remittance-source-v2';
  var HISTORY_CUTOFF='2026-09-30T16:00:00Z';
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
  function present(value){return value!==undefined&&value!==null&&value!=='';}
  function pick(source,keys){
    for(var i=0;i<keys.length;i++)if(present(source[keys[i]]))return source[keys[i]];
    return '';
  }
  function payload(request){return object(request.formPayload||request.form_payload);}
  function text(value){return typeof value==='string'?value:'';}
  function issue(issues,rowKey,field,code,message){
    var row=rowKey?Number(rowKey.split(':')[1]):null;
    issues.push({row:row,excelRow:null,rowKey:rowKey||null,field:field,code:code,message:message});
  }
  function timestamp(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
    var day=value.slice(0,10),date=new Date(day+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return NaN;
    return Date.parse(value);
  }
  function eligibility(request,options){
    request=object(request);options=object(options);var fp=payload(request);
    // Only the authenticated snapshot adapter supplies this authority. A request
    // payload cannot opt itself into historical access or change its real stage.
    var purpose=options.exportPurpose===undefined?'payment':options.exportPurpose;
    function deny(code,reason){return {eligible:false,code:code,reason:reason,exportPurpose:purpose};}
    if(['payment','historical','waiting','unavailable'].indexOf(purpose)<0)return deny('export_purpose_invalid','尚未取得有效的匯出用途，請重新讀取。');
    if(TYPES.indexOf(request.type)<0)return deny('transaction_not_supported','此單據不是可產製匯款檔的付款申請。');
    if(purpose==='waiting')return deny('waiting_for_cashier','尚未到出納付款關卡；完成核准後會自動準備匯款檔。');
    if(purpose==='unavailable')return deny('export_unavailable','此單目前不符合匯款檔產製或歷史重建條件。');
    if(purpose==='payment'&&request.status!=='pending_cashier')return deny('not_pending_cashier','完成前段核准、到達出納放款關卡後才產製匯款檔。');
    if(fp.electronicLabor||object(fp.hrInfo).digital||fp.hrItem==='labor_electronic')return deny('electronic_labor_separate_flow','電子勞報依獨立的簽署與付款流程處理。');
    if(purpose==='payment'&&(pick(request,['cashPostedAt','cash_posted_at','ledgerPostedAt','ledger_posted_at','postingLockedAt','posting_locked_at','voucherId','voucher_id','voidedAt','voided_at','paidAt','paid_at'])||pick(fp,['cashPostedAt','cash_posted_at'])))return deny('already_paid_or_locked','此單已有付款、入帳或作廢紀錄，不能重新產製待付款檔。');
    if(!Array.isArray(request.steps)||!request.steps.length||Array.from(request.steps).some(function(step){return !step||typeof step!=='object'||Array.isArray(step);}))return deny('workflow_missing','尚未取得完整簽核關卡，請重新讀取單據。');
    var index;
    if(purpose==='historical'){
      if(['draft','pending_cashier','rejected','cancelled','canceled','withdrawn','void','voided'].indexOf(request.status)>-1||!request.status||pick(request,['voidedAt','voided_at']))return deny('historical_status_invalid','作廢、取消、駁回或尚未付款的單據不能重建已付款歷史檔。');
      var submitted=timestamp(options.submittedAt),created=timestamp(pick(request,['createdAt','created_at']));
      if(options.submissionSource!=='server_created_at'||options.historyCutoff!==HISTORY_CUTOFF||!Number.isFinite(submitted)||!Number.isFinite(created)||submitted!==created)return deny('historical_submission_unverified','尚未確認正式送出時間，不能重建歷史匯款檔。');
      if(submitted<Date.parse(HISTORY_CUTOFF))return deny('historical_before_cutoff','此單正式送出時間早於本次歷史補檔範圍。');
      var submission=request.steps[0],applicant=pick(request,['applicantId','applicant_id']);
      if(submission.rk!=='applicant_submit'||submission.a!=='approved'||!applicant||submission.uid!==applicant||typeof fp._submissionPayloadSha256V3!=='string'||!/^[0-9a-f]{64}$/.test(fp._submissionPayloadSha256V3))return deny('historical_submission_unverified','缺少可核對申請人的正式送出證據，不能重建歷史匯款檔。');
      var paid=timestamp(pick(request,['cashPostedAt','cash_posted_at']));
      if(!Number.isFinite(paid)||paid<submitted)return deny('historical_payment_unverified','尚未取得有效的正式付款紀錄，不能以預計日期或簽核顯示日期代替。');
      if(present(fp.correctionCashEvents)&&(!Array.isArray(fp.correctionCashEvents)||fp.correctionCashEvents.length))return deny('historical_correction_unsupported','此單有付款更正紀錄，需核對原付款及差額，不能合併推測歷史匯款。');
      if(present(fp.accountingCorrection)&&(typeof fp.accountingCorrection!=='object'||Array.isArray(fp.accountingCorrection)||Object.keys(fp.accountingCorrection).length))return deny('historical_correction_unsupported','此單有會計更正紀錄，不能以目前欄位推測原付款。');
      var cashierSteps=request.steps.filter(function(step){return step.rk==='cashier';});
      if(cashierSteps.length!==1||cashierSteps[0].a!=='approved')return deny('historical_cashier_unverified','歷史補檔須有出納實際核准付款紀錄。');
      index=request.steps.indexOf(cashierSteps[0]);
      if(request.steps.some(function(step){return step.a&&['approved','AUTO'].indexOf(step.a)<0;}))return deny('historical_workflow_invalid','此單有退回或未核准紀錄，不能當作已完成付款的歷史檔。');
    }else{
      index=request.steps.findIndex(function(step){return !step.a;});
      if(index<0||request.steps[index].rk!=='cashier')return deny('cashier_step_not_active','目前有效關卡不是出納放款，請重新確認簽核進度。');
    }
    if(request.steps.slice(0,index).some(function(step){return ['approved','AUTO'].indexOf(step.a)<0;}))return deny('prior_step_not_approved','出納之前仍有未核准的關卡，不能產製付款檔。');
    var method=pick(fp,['paymentType','payment_type']);
    if(['bank','transfer','匯款','銀行轉帳'].indexOf(method)<0)return deny('payment_method_not_bank','請確認核准單據已明確指定銀行轉帳付款。');
    return {eligible:true,code:'ready',reason:'',exportPurpose:purpose};
  }
  function wholeAmount(value,issues,rowKey,field){
    if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!/^[0-9]+(?:\.0{1,2})?$/.test(value)){
      issue(issues,rowKey,field,'amount_invalid','核准金額須為可精確處理的正整數，不會自動四捨五入。');return null;
    }
    var amount=Number(value);
    if(!Number.isSafeInteger(amount)||amount<=0){issue(issues,rowKey,field,'amount_invalid','核准金額須大於 0，且須能精確處理。');return null;}
    return amount;
  }
  function normalizedDate(value){
    if(typeof value!=='string')return '';
    var normalized=value.replace(/\//g,'-');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(normalized))return '';
    var date=new Date(normalized+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===normalized?normalized:'';
  }
  function explicitCode(value){
    if(typeof value!=='string')return '';
    var matches=value.match(/(?:^|[^0-9])([0-9]{7}|[0-9]{3})(?=$|[^0-9])/g)||[];
    var codes=matches.map(function(match){return match.replace(/^[^0-9]+/,'').replace(/[^0-9]+$/,'');}).filter(function(code,index,all){return all.indexOf(code)===index;});
    return codes.length===1?codes[0]:'';
  }
  function resolveBankCode(source,issues,rowKey){
    var code=pick(source,['轉入銀行代號','銀行代號','bankCode','bank_code','payee_bank_code']);
    var bankName=pick(source,['銀行別','銀行','bankName','bank_name','payee_bank_name']);
    var branchCode=pick(source,['分行代號','branchCode','branch_code','bank_branch_code']);
    var bankType=pick(source,['bankType','bank_type']);
    if(!present(code))code=explicitCode(bankName);
    if(!present(code)&&bankType==='mega'&&!/(?:非|不是)\s*兆豐|\bnon[\s-]*mega\b/i.test(text(bankName)))code='017';
    if(typeof code==='string'&&/^[0-9]{3}$/.test(code)&&present(branchCode)){
      if(typeof branchCode==='string'&&/^[0-9]{4}$/.test(branchCode))code+=branchCode;
      else issue(issues,rowKey,'bankCode','branch_code_invalid','分行代號須保留完整 4 位文字數字，不能以數字型別補零推測。');
    }
    if(bankType==='mega'&&present(code)&&typeof code==='string'&&!/^017(?:[0-9]{4})?$/.test(code))issue(issues,rowKey,'bankCode','bank_type_conflict','銀行類別與銀行代號不一致，請核對原始資料。');
    if(bankType==='other'&&typeof code==='string'&&/^017(?:[0-9]{4})?$/.test(code))issue(issues,rowKey,'bankCode','bank_type_conflict','銀行類別與銀行代號不一致，請核對原始資料。');
    return code;
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value===undefined?null:value);
  }
  function resolve(request,options){
    request=object(request);options=object(options);var allowed=eligibility(request,options),issues=[],rows=[],keys=[],excluded=[],fp=payload(request),mode='bulk',historical=allowed.exportPurpose==='historical';
    var result={eligible:allowed.eligible,ok:false,exportPurpose:allowed.exportPurpose,reasonCode:allowed.code,mode:mode,rows:[],sourceRowKeys:[],issues:issues,excludedRows:excluded,summary:null,context:null,snapshot:null,snapshotText:null,requestId:pick(request,['id']),expectedTotal:null};
    if(!allowed.eligible){issue(issues,null,'status',allowed.code,allowed.reason);return result;}
    var hr=object(fp.hrInfo),refund=object(fp.refundInfo),procurement=object(fp.procurementPaymentInfo),estimate=object(fp.purchaseEstimate);
    var hrItem=pick(fp,['hrItem'])||pick(object(hr.item),['id']);
    if(request.type==='hr_expense_request'){
      if(HR_ITEMS.indexOf(hrItem)<0)issue(issues,null,'hrItem','hr_item_missing','請確認核准的人事費用類別，才能選用薪轉或整批匯款格式。');
      if(fp.hrItem&&object(hr.item).id&&fp.hrItem!==hr.item.id)issue(issues,null,'hrItem','hr_item_conflict','人事費用類別資料不一致，請重新確認核准版本。');
      if(['salary_50','bonus'].indexOf(hrItem)>-1)mode='payroll';
    }
    result.mode=mode;
    var context={requestId:pick(request,['id']),requestNo:pick(request,['no']),entityId:pick(request,['eid','entity_id']),departmentCode:pick(request,['dc','department_code']),requestType:request.type,status:request.status,version:pick(request,['ver','rowVersion','row_version']),updatedAt:pick(request,['updatedAt','updated_at']),payDate:normalizedDate(pick(request,['expectedPayDate','expected_pay_date'])),feeBearer:pick(request,['feeBearer','fee_bearer']),bankFeeAmount:pick(request,['bankFeeAmount','bank_fee_amount']),dataEnvironment:pick(request,['dataEnv','data_environment']),tenantId:pick(request,['tenantId','tenant_id'])};
    context.exportPurpose=allowed.exportPurpose;context.submittedAt=options.submittedAt||null;context.submissionSource=options.submissionSource||null;context.historyCutoff=options.historyCutoff||null;
    context.paidAt=historical?pick(request,['cashPostedAt','cash_posted_at']):null;context.sourceBasis=historical?'current_saved_reconstruction':'current_approved_request';
    result.context=context;
    if(!context.requestId||typeof context.requestId!=='string')issue(issues,null,'requestId','request_id_missing','尚未取得正式單據識別碼。');
    if(!context.entityId||typeof context.entityId!=='string')issue(issues,null,'entityId','entity_missing','尚未取得付款法人，不能混合產製匯款檔。');
    if(!context.payDate)issue(issues,null,'payDate','payment_date_missing','請確認有效的預計匯款日期。');
    var principalValue=pick(request,['amt','amount']);
    if(request.type==='purchase_request'||request.type==='advance_request'){
      principalValue=pick(request,['estimatedAmt','estimated_amount']);
      if(historical&&request.type==='advance_request'){
        var original=pick(fp,['advanceOriginalAmount','advanceDisbursementAmount']);
        if(present(original))principalValue=original;
      }
      if(historical&&request.type==='purchase_request'){
        if(!present(principalValue))principalValue=pick(estimate,['procurementAmount']);
        if(!present(principalValue))principalValue=pick(procurement,['amount']);
      }else if(request.type==='purchase_request'){
        if(!present(principalValue))principalValue=pick(procurement,['amount']);
        if(!present(principalValue))principalValue=pick(estimate,['procurementAmount']);
      }
      if(!present(principalValue)&&!historical)principalValue=pick(request,['amt','amount']);
      if(!present(principalValue)&&historical)issue(issues,null,'principalAmount','historical_principal_missing','缺少原核定撥款本金，不能用最後核銷金額推測原匯款。');
    }
    var principal=wholeAmount(principalValue,issues,null,'principalAmount'),sourceRows,prefix;
    if(historical){
      var cash=wholeAmount(fp.cashAmount,issues,null,'cashAmount'),savedFee=context.bankFeeAmount,fee=null;
      if((typeof savedFee==='number'||typeof savedFee==='string'&&/^[0-9]+(?:\.0{1,2})?$/.test(savedFee))&&Number.isSafeInteger(Number(savedFee))&&Number(savedFee)>=0)fee=Number(savedFee);
      else issue(issues,null,'bankFeeAmount','historical_fee_missing','缺少有效的已存公司手續費，不能推算原匯款本金。');
      if(cash!==null&&fee!==null&&(cash-fee<=0||!Number.isSafeInteger(cash-fee)||principal===null||cash-fee!==principal))issue(issues,null,'principalAmount','historical_cash_mismatch','已存付款總額扣除手續費後，與原核准本金不同；請先核對歷史付款。');
    }
    if(request.type==='hr_expense_request'){sourceRows=Array.isArray(hr.rows)?hr.rows:fp.hrRows;prefix='hr';}
    else if(request.type==='refund_request'){sourceRows=Array.isArray(refund.rows)?refund.rows:fp.refundRows;prefix='refund';}
    else {sourceRows=[request];prefix='payment';}
    if(!Array.isArray(sourceRows)||!sourceRows.length){issue(issues,null,'rows','source_rows_missing','尚未取得完整的核准付款明細，不能只用總額產製。');sourceRows=[];}
    var supplementMap={};
    if(options.supplements!==undefined&&!Array.isArray(options.supplements))issue(issues,null,'supplements','supplements_invalid','收款補充資料格式不完整，請重新讀取。');
    Array.from(Array.isArray(options.supplements)?options.supplements:[]).forEach(function(supplement){
      var s=object(supplement),key=s.rowKey;
      if(typeof key!=='string'||!new RegExp('^'+prefix+':[1-9][0-9]*$').test(key)||Number(key.split(':')[1])>sourceRows.length){issue(issues,null,'supplements','supplement_row_invalid','收款補充資料不屬於此核准版本的明細。');return;}
      if(supplementMap[key]){issue(issues,key,'supplements','supplement_duplicate','同一列有重複的收款補充資料。');return;}
      supplementMap[key]=s;
    });
    var bankTotal=0,cashTotal=0,sourceTotal=0;
    Array.from(sourceRows).forEach(function(source,index){
      var key=prefix+':'+(index+1);
      if(!source||typeof source!=='object'||Array.isArray(source)){issue(issues,key,'row','source_row_invalid','核准付款明細有不完整的列，請重新讀取。');return;}
      var name,account,identity='',amountValue,bankSource=source;
      if(prefix==='payment'){
        name=pick(source,['payee']);account=pick(source,['bankNo','bank_no']);amountValue=principalValue;
      }else if(prefix==='refund'){
        name=pick(source,['accountName','account_name']);account=pick(source,['accountNo','account_no']);amountValue=pick(source,['refundAmount','refund_amount']);
      }else{
        name=pick(source,['收款人姓名','戶名','姓名','accountName','account_name','payee','payee_name','name']);
        identity=pick(source,['存款人身份證號','identityNo','identity_no','身分證字號','身份證字號']);
        account=pick(source,['銀行帳號','轉入帳號','帳號','accountNo','account_no','bankNo','bank_no','bank_account','account_number','account']);
        amountValue=pick(source,['金額','轉帳金額','匯款金額','payment_amount','amount']);
      }
      var amount=wholeAmount(amountValue,issues,key,'amount');
      if(amount!==null)sourceTotal+=amount;
      if(prefix==='refund'){
        var refundMethod=pick(source,['method']);
        if(refundMethod==='現金'||refundMethod==='cash'){
          if(amount!==null)cashTotal+=amount;
          excluded.push({rowKey:key,row:index+1,method:'現金',amount:amount});
          if(supplementMap[key])issue(issues,key,'supplements','cash_row_supplement','現金退費明細不能套用銀行收款補充資料。');
          return;
        }
        if(['銀行轉帳','bank'].indexOf(refundMethod)<0)issue(issues,key,'method','refund_method_missing','此列尚未明確記錄銀行轉帳或現金退款方式。');
      }
      var bankCode=resolveBankCode(bankSource,issues,key),supplement=supplementMap[key];
      if(supplement){
        if(present(supplement.name)){
          if(present(name)&&name!==supplement.name)issue(issues,key,'name','supplement_name_conflict','補充戶名與核准明細已有戶名不同，請重新核對。');
          else name=supplement.name;
        }
        if(present(supplement.bankCode)){
          if(present(bankCode)&&bankCode!==supplement.bankCode&&!(typeof bankCode==='string'&&/^[0-9]{3}$/.test(bankCode)&&typeof supplement.bankCode==='string'&&/^[0-9]{7}$/.test(supplement.bankCode)&&supplement.bankCode.slice(0,3)===bankCode))issue(issues,key,'bankCode','supplement_bank_conflict','補充銀行代號與核准明細不同，不能覆寫原銀行。');
          else bankCode=supplement.bankCode;
        }
      }
      rows.push({name:name,identityNo:identity,bankCode:bankCode,account:account,amount:amount});keys.push(key);
      if(amount!==null)bankTotal+=amount;
    });
    if(!Number.isSafeInteger(sourceTotal)||!Number.isSafeInteger(bankTotal)||!Number.isSafeInteger(cashTotal))issue(issues,null,'principalAmount','total_unsafe','付款明細合計超過可精確處理範圍。');
    if(principal!==null&&sourceTotal!==principal)issue(issues,null,'principalAmount','principal_mismatch','明細本金合計與核准付款本金不同；手續費不得併入收款金額。');
    if(prefix==='hr'){
      var declared=pick(hr,['paymentTotal','total']);
      if(present(declared)){var declaredAmount=wholeAmount(declared,issues,null,'hrPaymentTotal');if(declaredAmount!==null&&declaredAmount!==sourceTotal)issue(issues,null,'hrPaymentTotal','hr_total_mismatch','人事核准實發合計與逐列匯款金額不同。');}
    }
    if(!rows.length)issue(issues,null,'rows','no_bank_rows','此單沒有可產製銀行匯款檔的轉帳明細。');
    var engine=BANK_ENGINE||global.FinanceMegaRemittance;
    if(rows.length&&engine&&typeof engine.validate==='function'){
      var checked=engine.validate({mode:mode,rows:rows});
      checked.issues.forEach(function(problem){var sourceKey=problem.row?keys[problem.row-1]:null;issue(issues,sourceKey,problem.field,problem.code,problem.message);});
    }else if(rows.length)issue(issues,null,'engine','bank_engine_missing','銀行格式檢核元件尚未載入，請重新整理。');
    result.expectedTotal=bankTotal;
    result.summary={paymentCount:rows.length,bankPrincipal:bankTotal,cashPrincipal:cashTotal,approvedPrincipal:principal,excludedCashCount:excluded.length};
    result.sourceRowKeys=keys;
    // Private UI may show missing-field editors for these rows. It must require
    // ok === true before invoking any workbook builder or download action.
    result.rows=rows;
    if(issues.length)return result;
    result.ok=true;
    result.snapshot={schemaVersion:SOURCE_VERSION,context:context,mode:mode,hrItem:hrItem||'',rows:rows,sourceRowKeys:keys,excludedRows:excluded,summary:result.summary,workflow:request.steps.map(function(step){return {role:step.rk,actorId:step.uid||'',action:step.a||'',at:step.t||'',status:step.status||''};})};
    // This includes confidential account/payroll data. Hash in memory; never log,
    // display, or use the plaintext as an exposed version identifier/cache key.
    result.snapshotText=canonical(result.snapshot);
    return result;
  }
  var api=Object.freeze({sourceSchemaVersion:SOURCE_VERSION,eligibility:eligibility,resolve:resolve});
  global.FinanceMegaRemittanceSource=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
