(function(global){
  'use strict';

  // Bank-file layout is intentionally separate from approval and payment execution.
  // Identifiers must arrive as strings; a numeric account may already have lost zeroes.
  var PAYROLL_HEADER = ['HEADER','收款人姓名','存款人身份證號','轉入銀行代號','轉入帳號','付款金額'];
  var BULK_HEADER = ['戶名','金額','銀行代號','帳號'];
  var MAX_PAYROLL_AMOUNT = 9999999999999;
  // Excel preserves only 15 significant decimal digits, less than JS safe integers.
  var MAX_EXCEL_INTEGER = 999999999999999;
  var MAX_EXCEL_ROWS = 1048576;
  var SCHEMA_VERSION = 'mega-remittance-v1';

  function addIssue(issues,row,field,code,message){
    issues.push({row:row,excelRow:row===null?null:row+1,field:field,code:code,message:message});
  }
  function controlCharacters(value){return /[\u0000-\u001f\u007f\ufffe\uffff]/.test(value);}
  function normalizeAccount(value){
    if(typeof value!=='string'||/[^0-9 -]/.test(value))return value;
    // Only bank-account formatting is removable. Keep malformed values intact
    // so validation rejects signs, control characters and non-ASCII lookalikes.
    var core=value.replace(/^ +| +$/g,'');
    return /^[0-9]+([ -]+[0-9]+)*$/.test(core)?core.replace(/[ -]/g,''):value;
  }
  function nameUnits(value){
    return Array.from(value).reduce(function(total,character){return total+(character.codePointAt(0)<=127?1:2);},0);
  }
  function readText(value,field,row,issues,required){
    if(value==null||value===''){
      if(required)addIssue(issues,row,field,'text_required','請填寫'+({name:'收款戶名',bankCode:'銀行代號',account:'收款帳號'}[field]||'欄位')+'。');
      return '';
    }
    if(typeof value!=='string'){
      addIssue(issues,row,field,'text_type_required',field==='bankCode'||field==='account'?'銀行代號與帳號必須保留文字格式及前導 0，請重新確認原始資料。':'此欄位必須為文字。');
      return '';
    }
    if(!value.trim()){
      addIssue(issues,row,field,'text_required','此欄位不能只有空白。');
      return '';
    }
    if(value.length>32767)addIssue(issues,row,field,'text_too_long','欄位超過 Excel 可保留的文字長度。');
    if(Array.from(value).some(function(c){var code=c.codePointAt(0);return code>=0xd800&&code<=0xdfff;}))addIssue(issues,row,field,'text_invalid_unicode','欄位含有不完整的文字編碼，請重新輸入。');
    if(controlCharacters(value))addIssue(issues,row,field,'text_control_characters','此欄位含有換行或無法匯入的控制字元。');
    return value;
  }
  function readAmount(value,row,mode,issues){
    if(typeof value!=='number'&&typeof value!=='string'){
      addIssue(issues,row,'amount','amount_invalid','付款金額必須為正整數。');return null;
    }
    if(typeof value==='string'&&!/^[0-9]+$/.test(value)){
      addIssue(issues,row,'amount','amount_invalid','付款金額請填正整數，不含逗號、小數、空白或科學記號。');return null;
    }
    var amount=Number(value);
    if(!Number.isSafeInteger(amount)||amount<=0){
      addIssue(issues,row,'amount','amount_invalid','付款金額必須為可精確處理的正整數。');return null;
    }
    if(amount>MAX_EXCEL_INTEGER){
      addIssue(issues,row,'amount','amount_excel_precision','付款金額超過 Excel 可精確保留的 15 位整數。');return null;
    }
    if(mode==='payroll'&&(amount>MAX_PAYROLL_AMOUNT||(typeof value==='string'&&value.length>13))){
      addIssue(issues,row,'amount','amount_too_long','薪轉付款金額最多 13 位整數。');return null;
    }
    return amount;
  }
  function validate(input){
    input=input&&typeof input==='object'?input:{};
    var mode=input.mode,source=input.rows,issues=[],normalized=[],total=0,totalUnsafe=false;
    if(mode!=='payroll'&&mode!=='bulk')addIssue(issues,null,'mode','mode_invalid','請指定薪轉或整批匯款格式。');
    if(!Array.isArray(source)||source.length===0){
      addIssue(issues,null,'rows','rows_required','沒有可產製的付款明細。');
      return {ok:false,issues:issues,normalizedRows:[],summary:null};
    }
    if(source.length>MAX_EXCEL_ROWS-(mode==='payroll'?2:1)){
      addIssue(issues,null,'rows','rows_too_many','付款明細超過 Excel 工作表列數上限，請拆分批次。');
      return {ok:false,issues:issues,normalizedRows:[],summary:null};
    }
    // Array.from makes sparse slots explicit invalid records instead of skipping them.
    Array.from(source).forEach(function(item,index){
      var row=index+1;
      if(!item||typeof item!=='object'||Array.isArray(item)){
        addIssue(issues,row,'row','row_invalid','付款明細不完整，請重新確認此列。');return;
      }
      var name=readText(item.name,'name',row,issues,mode==='bulk');
      var identity=mode==='payroll'?readText(item.identityNo,'identityNo',row,issues,false):'';
      var bankCode=readText(item.bankCode,'bankCode',row,issues,true);
      var accountText=readText(item.account,'account',row,issues,true);
      var account=normalizeAccount(accountText);
      var amount=readAmount(item.amount,row,mode,issues);
      if(mode==='payroll'){
        if(!name&&!identity)addIssue(issues,row,'name','name_or_identity_required','薪轉收款人姓名與身分證號至少需填一項。');
        if(nameUnits(name)>78)addIssue(issues,row,'name','name_too_long','薪轉戶名最多 39 個中文字或 78 個英數字，混合文字依相同長度計算。');
        if(Array.from(identity).length>10)addIssue(issues,row,'identityNo','identity_too_long','薪轉身分證號最多 10 個字元。');
        if(bankCode&&!(/^[0-9]{7}$/.test(bankCode)||bankCode==='017'))addIssue(issues,row,'bankCode','bank_code_invalid','薪轉需填完整 7 位銀行分支代號；兆豐本行可填 017。');
        if(account.length>14)addIssue(issues,row,'account','account_too_long','薪轉收款帳號最多 14 位數字。');
      }else if(bankCode&&!/^[0-9]+$/.test(bankCode)){
        addIssue(issues,row,'bankCode','digits_required','銀行代號只能包含數字，請保留前導 0。');
      }
      if(accountText&&(!account||/[^0-9]/.test(account)))addIssue(issues,row,'account','digits_required','收款帳號請填數字；數字之間可用半形空格或連字號分隔，請保留前導 0。');
      if(amount!==null){
        total+=amount;
        if(!Number.isSafeInteger(total)||total>MAX_EXCEL_INTEGER)totalUnsafe=true;
      }
      normalized.push({name:name,identityNo:identity,bankCode:bankCode,account:account,amount:amount});
    });
    if(totalUnsafe)addIssue(issues,null,'totalAmount','total_unsafe','付款總額超過 Excel 可精確保留的 15 位整數，請拆分批次後重新產製。');
    var ok=issues.length===0;
    return {ok:ok,issues:issues,normalizedRows:ok?normalized:[],summary:ok?{mode:mode,paymentCount:normalized.length,totalAmount:total}:null};
  }
  function buildWorkbook(input){
    var checked=validate(input);
    if(!checked.ok)return {ok:false,issues:checked.issues,workbook:null};
    var payroll=input.mode==='payroll',rows=[(payroll?PAYROLL_HEADER:BULK_HEADER).slice()],types=[payroll?['s','s','s','s','s','s']:['s','s','s','s']];
    checked.normalizedRows.forEach(function(row){
      rows.push(payroll?['PAYMENT',row.name,row.identityNo,row.bankCode,row.account,row.amount]:[row.name,row.amount,row.bankCode,row.account]);
      types.push(payroll?['s','s','s','s','s','n']:['s','n','s','s']);
    });
    if(payroll){
      // Computed numeric values are deliberate: a bank importer must not depend on
      // Excel first opening and recalculating formulas or stale cached totals.
      rows.push(['TRAILER','PAYMENT總筆數',checked.summary.paymentCount,'PAYMENT總金額',checked.summary.totalAmount,null]);
      types.push(['s','s','n','s','n',null]);
    }
    return {ok:true,issues:[],workbook:{schemaVersion:SCHEMA_VERSION,sheetName:'工作表1',rows:rows,types:types,summary:checked.summary}};
  }
  function buildXlsx(input,xlsx){
    var result=buildWorkbook(input);
    if(!result.ok)return {ok:false,issues:result.issues,bytes:null};
    if(!xlsx||typeof xlsx.write!=='function')return {ok:false,issues:[{row:null,excelRow:null,field:'file',code:'xlsx_unavailable',message:'Excel 產檔工具尚未載入，請重試。'}],bytes:null};
    var model=result.workbook,sheet={},columns=model.rows[0].length;
    model.rows.forEach(function(values,row){
      values.forEach(function(value,column){
        var type=model.types[row][column];
        if(type!==null)sheet[String.fromCharCode(65+column)+(row+1)]={t:type,v:value,z:type==='s'?'@':'0'};
      });
    });
    sheet['!ref']='A1:'+String.fromCharCode(64+columns)+model.rows.length;
    sheet['!cols']=(input.mode==='payroll'?[18,30,22,22,24,20]:[30,20,22,24]).map(function(width){return {wch:width};});
    var book={SheetNames:[model.sheetName],Sheets:{}};
    book.Sheets[model.sheetName]=sheet;
    try{
      var data=xlsx.write(book,{bookType:'xlsx',type:'array',compression:true});
      var bytes=data instanceof ArrayBuffer?new Uint8Array(data):data;
      if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('xlsx_output_invalid');
      return {ok:true,issues:[],bytes:bytes,summary:model.summary,schemaVersion:SCHEMA_VERSION,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    }catch(error){
      // Neither source values nor library exception text belong in the UI/log.
      return {ok:false,issues:[{row:null,excelRow:null,field:'file',code:'xlsx_generation_failed',message:'Excel 檔案未產生，原付款資料保留，請重試。'}],bytes:null};
    }
  }
  var api=Object.freeze({schemaVersion:SCHEMA_VERSION,normalizeAccount:normalizeAccount,validate:validate,buildWorkbook:buildWorkbook,buildXlsx:buildXlsx});
  global.FinanceMegaRemittance=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
