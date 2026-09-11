(function (global) {
  'use strict';
  // Review workpapers only. Official paper field codes are not electronic filing records.
  var sources = [
    {id:'mof-form-20230831',title:'財政部 401／403／404 A4 申報書及填寫說明',url:'https://www.etax.nat.gov.tw/etwmain/etw212w/detail/189b50a490600000c0cddfef1a752804',accessed:'2026-09-10',published:'2023-08-31',localPath:'docs/reference/taiwan-vat-401-403-404-official-20230831.pdf',sha256:'f78296b7c16911d739a3d8042b5793fa4dfd9892105c7de8730190ea17ad5dd7'},
    {id:'mof-mixed-vat',title:'兼營營業人營業稅額計算辦法',url:'https://law-out.mof.gov.tw/LawContent.aspx?id=FL006087',accessed:'2026-09-10'},
    {id:'mof-filing-faq',title:'財政部電子申報繳稅服務網：營業稅 FAQ',url:'https://www.tax.nat.gov.tw/alltax-faq.html?id=2',accessed:'2026-09-10'},
    {id:'mof-utility-certificate',title:'公用事業電子發票進項憑證格式',url:'https://tax.nat.gov.tw/db/news_BLR/news_7.html',accessed:'2026-09-10'}
  ];
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function text(x) { return x == null ? '' : String(x).trim(); }
  function amount(x) {
    if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
    if (typeof x !== 'number' && !/^\d+(?:\.\d{1,2})?$/.test(text(x))) return null;
    var n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 1e12 && Math.abs(n * 100 - Math.round(n * 100)) < .00001 ? n : null;
  }
  function add(a,b) { return Math.round((a+b)*100)/100; }
  function date(x) { return /^\d{4}-\d{2}-\d{2}$/.test(text(x)) && !isNaN(Date.parse(x)) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x; }
  function utility(row) {
    var label=['item','description','label','itemName'].map(function(k){return text(row[k]);}).find(Boolean)||'';
    label=label.replace(/\s/g,'');return /水費|電費|水電費/.test(label)&&!/瓦斯|郵電|電信|電話|工程|修繕|維修|安裝|材料|設備|補助|補貼|飲水機|電腦/.test(label);
  }
  function validateProfile(profile) {
    var p=profile||{}, t=p.tax||{}, checks=[];
    function need(key,condition,label){if(!condition)checks.push({code:key,severity:'blocking',message:label+'待設定',sourceIds:[]});}
    need('FORM_TYPE',['401','403'].indexOf(t.formType)>-1,'公司申報書別');
    need('TAX_ID',/^\d{8}$/.test(text(t.taxId))&&!/^0+$/.test(text(t.taxId)),'公司統一編號');
    ['legalName','taxRegistrationNo','responsiblePerson','address'].forEach(function(k){need('PROFILE_'+k,!!text(t[k]),({legalName:'營業人名稱',taxRegistrationNo:'稅籍編號',responsiblePerson:'負責人',address:'營業地址'})[k]);});
    need('FILING_FREQUENCY',['monthly','bimonthly'].indexOf(t.filingFrequency)>-1,'申報頻率');
    if(t.filingFrequency==='monthly')need('MONTHLY_APPROVAL',!!text(t.monthlyApprovalReference),'按月申報核准依據');
    need('FILING_MODE',t.filingMode==='individual','本公司獨立申報範圍（總機構彙總需另行核對）');
    if(t.formType==='403')need('DEDUCTION_METHOD',['proportional','direct'].indexOf(t.deductionMethod)>-1,'403 扣抵方法');
    if(t.formType==='403'&&t.deductionMethod==='direct')need('DIRECT_METHOD_SINCE',date(t.directMethodSince),'直接扣抵法採用日期與三年限制核對');
    return checks;
  }
  var defs=[];
  function def(code,label,section,form){defs.push({code:String(code),label:label,section:section,form:form||'both'});}
  [[1,'三聯式／電腦發票應稅銷售額'],[2,'三聯式／電腦發票銷項稅額'],[5,'三聯收銀機／電子發票應稅銷售額'],[6,'三聯收銀機／電子發票銷項稅額'],[7,'零稅率：非經海關出口'],[9,'二聯式／二聯收銀機應稅銷售額'],[10,'二聯式／二聯收銀機銷項稅額'],[13,'免用發票應稅銷售額'],[14,'免用發票銷項稅額'],[15,'零稅率：經海關出口'],[17,'銷貨退回折讓應稅銷售額'],[18,'銷貨退回折讓稅額'],[19,'零稅率銷货退回折讓'],[21,'應稅銷售額合計'],[22,'銷項稅額合計'],[23,'零稅率銷售額合計'],[25,'銷售額總計'],[27,'內含其他固定資產銷售額']].forEach(function(x){def(x[0],x[1],'sales');});
  [[4,'三聯式／電腦發票免稅銷售額'],[8,'電子發票免稅銷售額'],[12,'二聯式免稅銷售額'],[16,'免用發票免稅銷售額'],[20,'免稅銷貨退回折讓'],[24,'免稅銷售額合計'],[26,'內含土地銷售額'],[52,'特種飲食業 25% 銷售額'],[53,'特種飲食業 25% 稅額'],[54,'特種飲食業 15% 銷售額'],[55,'特種飲食業 15% 稅額'],[56,'金融本業 2% 銷售額'],[57,'金融本業 2% 稅額'],[60,'再保收入銷售額'],[61,'再保收入稅額'],[62,'特種免稅收入'],[63,'特種稅額退回折讓銷售額'],[64,'特種稅額退回折讓稅額'],[65,'特種稅額銷售額合計'],[66,'特種稅額稅額合計'],[84,'銀行保險本業 5% 銷售額'],[85,'銀行保險本業 5% 稅額']].forEach(function(x){def(x[0],x[1],'sales','403');});
  [[28,'統一發票進貨費用金額'],[29,'統一發票進貨費用稅額'],[30,'統一發票固定資產金額'],[31,'統一發票固定資產稅額'],[32,'電子發票進貨費用金額'],[33,'電子發票進貨費用稅額'],[34,'電子發票固定資產金額'],[35,'電子發票固定資產稅額'],[36,'其他含稅憑證進貨費用金額'],[37,'其他含稅憑證進貨費用稅額'],[38,'其他含稅憑證固定資產金額'],[39,'其他含稅憑證固定資產稅額'],[40,'進貨費用退出折讓金額'],[41,'進貨費用退出折讓稅額'],[42,'固定資產退出折讓金額'],[43,'固定資產退出折讓稅額'],[44,'進貨費用扣抵基礎金額合計'],[45,'進貨費用扣抵基礎稅額合計'],[46,'固定資產扣抵基礎金額合計'],[47,'固定資產扣抵基礎稅額合計'],[48,'進貨費用總金額（含不得扣抵）'],[49,'固定資產總金額（含不得扣抵）'],[78,'海關進貨費用稅基'],[79,'海關進貨費用稅額'],[80,'海關固定資產稅基'],[81,'海關固定資產稅額']].forEach(function(x){def(x[0],x[1],'purchases');});
  def(50,'當期不得扣抵比例（%）','calculation','403');def(51,'403 得扣抵進項稅額','calculation','403');
  [[101,'本期銷項稅額'],[107,'得扣抵進項稅額合計'],[108,'上期累積留抵稅額'],[110,'可抵減稅額小計'],[111,'本期應實繳稅額'],[112,'本期申報留抵稅額'],[113,'得退稅限額'],[114,'本期應退稅額'],[115,'本期累積留抵稅額'],[73,'進口免稅貨物'],[74,'購買國外勞務給付額']].forEach(function(x){def(x[0],x[1],'calculation');});
  [[103,'購買國外勞務應納稅額'],[104,'特種稅額應納稅額'],[105,'年度／歇業調整補徵稅額'],[106,'應納稅額小計'],[109,'年度／歇業調整應退稅額'],[75,'購買國外勞務營業稅額'],[76,'購買國外勞務應納稅額']].forEach(function(x){def(x[0],x[1],'calculation','403');});
  function buildWorkpaper(input) {
    input=input||{};var profile=input.profile||{},tax=profile.tax||{},form=['401','403'].indexOf(tax.formType)>-1?tax.formType:null,period=input.period||{},entity=text(input.entityId),checks=validateProfile(profile),docs=[],fields={},seen={},salesOK=true,purchasesOK=true;
    var adjustments=Object.assign({},(tax.periods||{})[text(period.start)+'/'+text(period.end)]||{},input.adjustments||{}),complete=input.completeness||{};
    defs.filter(function(d){return d.form==='both'||d.form===form;}).forEach(function(d){fields[d.code]=Object.assign({},d,{value:0,knownSubtotal:0,status:'calculated',sourceIds:[]});});
    function issue(code,message,id,level){checks.push({code:code,message:message,severity:level||'blocking',sourceIds:id?[id]:[]});}
    function put(code,n,id){var f=fields[String(code)];if(!f)return;if(n===null){f.value=null;f.status='needs_review';return;}f.knownSubtotal=add(f.knownSubtotal,n);if(f.value!==null)f.value=add(f.value,n);if(id&&f.sourceIds.indexOf(id)<0)f.sourceIds.push(id);}
    function set(code,n,status){var f=fields[String(code)];if(!f)return;f.value=n;f.knownSubtotal=n;f.status=status||(n===null?'needs_configuration':'calculated');}
    function sum(codes){return codes.reduce(function(n,c){var f=fields[String(c)];return n===null||!f||f.value===null?null:add(n,f.value);},0);}
    function calc(code,plus,minus){var p=sum(plus),m=sum(minus||[]);set(code,p===null||m===null?null:add(p,-m));fields[String(code)].sourceIds=[].concat.apply([],plus.concat(minus||[]).map(function(k){return fields[String(k)].sourceIds;})).filter(function(x,i,a){return a.indexOf(x)===i;});}
    function blockSection(section){Object.keys(fields).forEach(function(k){var f=fields[k];if(f.section===section){f.value=null;f.status='partial';}});}
    function numSetting(key,label){var n=amount(adjustments[key]);if(n===null)issue('SETTING_'+key,label+'待設定，不能以零代替');return n;}
    if(!entity||entity==='all')issue('ENTITY_REQUIRED','營業稅工作底稿必須選一個明確申報法人');
    if(!date(period.start)||!date(period.end)||period.start>period.end)issue('PERIOD_INVALID','申報期間不完整或無效');
    if(!Array.isArray(input.sales)){salesOK=false;issue('SALES_SOURCE_FORMAT','銷項來源清單無效或尚未載入');}
    if(!Array.isArray(input.purchases)){purchasesOK=false;issue('PURCHASES_SOURCE_FORMAT','進項來源清單無效或尚未載入');}
    if(form==='403'&&tax.deductionMethod==='direct'&&date(tax.directMethodSince)&&date(period.end)&&tax.directMethodSince>period.end)issue('DIRECT_METHOD_PERIOD','所選申報期早於直接扣抵法開始日，請核對適用方法');
    if(complete.sales!==true){salesOK=false;issue('SALES_INCOMPLETE','銷項憑證清單尚未確認完整');}
    if(Object.prototype.hasOwnProperty.call(complete,'taxSources')&&complete.taxSources!==true)issue('TAX_SOURCES_INCOMPLETE','憑證來源版本及正式帳面稅尚未完整核對');
    if(complete.purchases!==true){purchasesOK=false;issue('PURCHASES_INCOMPLETE','進項憑證清單尚未確認完整');}
    if(date(period.start)&&date(period.end)){
      var start=new Date(period.start+'T00:00:00Z'),end=new Date(period.end+'T00:00:00Z'),next=new Date(end);next.setUTCDate(end.getUTCDate()+1);
      var months=(end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth()+1;
      if(start.getUTCDate()!==1||next.getUTCDate()!==1||(tax.filingFrequency==='bimonthly'&&(months!==2||start.getUTCMonth()%2!==0))||(tax.filingFrequency==='monthly'&&months!==1))issue('PERIOD_FREQUENCY','申報期間不符合公司已設定的完整月／雙月期');
    }
    var inputTotals={taxableOnly:0,exemptOnly:0,common:0,excluded:0,policyExcluded:0,originalTax:0},directUsageKnown=true;
    function visit(row,kind){
      row=row||{};var id=text(row.id),r=Object.assign({},copy(row),{kind:kind,issues:[],included:false}),valid=true,n=amount(row.netAmount),t=amount(row.originalTaxAmount),g=amount(row.grossAmount),sign=row.isReturn===true?-1:1,format=text(row.formatCode),taxClass=text(row.taxClass),isUtility=utility(row);
      function bad(code,message){valid=false;r.issues.push(code);issue(code,message,id);}
      if(row.sourceBindingStatus&&row.sourceBindingStatus!=='verified')bad('SOURCE_BINDING_REVIEW','憑證來源版本未綁定、已變更或尚未驗證，請重新核對');
      if(kind==='purchase'&&row.bookTaxStatus==='unresolved')bad('BOOK_TAX_UNRESOLVED','正式帳面進項稅尚未核對完成');
      if(row.sourceAvailable===false)bad('SOURCE_UNAVAILABLE','原始來源或明細目前無法核對；舊分類不可單獨作為申報依據');
      if(!id)bad('DOCUMENT_ID','憑證缺少穩定來源識別碼');
      if(id&&seen[kind+'|'+id])bad('DUPLICATE_DOCUMENT','同一來源憑證重複，未重複加總');seen[kind+'|'+id]=true;
      if(text(row.entityId)!==entity)bad('CROSS_ENTITY_DOCUMENT','憑證法人與本次申報法人不符');
      if(!date(row.date))bad('CERTIFICATE_DATE','憑證日期缺漏或無效');
      else if(date(period.start)&&date(period.end)&&(row.date<period.start||row.date>period.end))bad('CERTIFICATE_PERIOD','憑證不在本期；跨期申報需先確認申報歸期');
      if(taxClass!=='out_of_scope'&&!text(row.number))bad('CERTIFICATE_NUMBER','缺少發票、收據或其他憑證號碼');
      if(!text(row.evidenceReference))bad('CERTIFICATE_EVIDENCE','缺少可追溯原始憑證');
      if(taxClass==='out_of_scope'){
        if(!text(row.classificationReason))bad('EXCLUSION_REASON','排除本次申報需記錄會計確認原因');
        ['netAmount','originalTaxAmount','grossAmount'].forEach(function(k){if(row[k]!=null&&row[k]!==''&&amount(row[k])===null)bad('ORIGINAL_AMOUNTS','已填原始金額格式無效');});
        if(n!==null&&t!==null&&g!==null&&Math.abs(add(n,t)-g)>.001)bad('ORIGINAL_AMOUNT_MISMATCH','原始未稅額＋稅額不等於憑證總額');
        r.originalNetAmount=n;r.originalTaxAmount=t;r.grossAmount=g;r.bookTaxAmount=amount(row.bookTaxAmount);r.claimedTaxAmount=0;r.explicitlyExcluded=valid;
        if(!valid){if(kind==='sale')salesOK=false;else purchasesOK=false;}docs.push(r);return;
      }
      if(['taxable','zero_rated','exempt','out_of_scope','special'].indexOf(taxClass)<0)bad('TAX_CLASS_UNKNOWN','課稅別待確認；不得從零會計進項稅推定免稅');
      if(n===null||t===null||g===null)bad('ORIGINAL_AMOUNTS','原始未稅額、稅額或總額待確認');
      else if(Math.abs(add(n,t)-g)>.001)bad('ORIGINAL_AMOUNT_MISMATCH','原始未稅額＋稅額不等於憑證總額');
      if(['zero_rated','exempt','out_of_scope'].indexOf(taxClass)>-1&&t!==null&&t!==0)bad('NON_TAXABLE_HAS_TAX','所選課稅別與原始稅額不一致');
      if(taxClass==='special')bad('SPECIAL_TAX_REVIEW','特種稅額須依適用稅率及專用欄位另行覆核，本工作底稿不自動套用');
      if(row.isReturn===true&&(!text(row.originalDocumentId)||!text(row.evidenceReference)))bad('RETURN_EVIDENCE','退回折讓需原憑證連結及本期退折讓證明');
      if(kind==='purchase'){
        if(!/^\d{8}$/.test(text(row.sellerTaxId))||/^0+$/.test(text(row.sellerTaxId)))bad('SELLER_TAX_ID','進項憑證銷售人統編待確認');
        if(text(row.buyerTaxId)!==text(tax.taxId))bad('BUYER_TAX_ID','進項買受人統編與申報法人不符或缺漏');
        if(['expense','fixed_asset'].indexOf(row.assetKind)<0)bad('ASSET_KIND_UNKNOWN','進貨費用／固定資產類別待確認');
        if(['eligible','article19_excluded','not_claimed_policy'].indexOf(row.deduction)<0)bad('DEDUCTION_UNKNOWN','進項扣抵分類待確認');
        if(form==='403'&&tax.deductionMethod==='direct'&&['taxable_only','exempt_only','common'].indexOf(row.usage)<0){directUsageKnown=false;bad('DIRECT_USAGE_UNKNOWN','直接扣抵法需區分專供應稅、專供免稅及共同使用');}
        if(isUtility&&row.deduction==='eligible'&&t>0&&amount(row.bookTaxAmount)!==t)bad('UTILITY_BOOK_TAX_RECONCILIATION','水電帳單原始稅額保留；帳面進項稅未確認或與原始稅額不符，本次擬申報扣抵須先會計勾稽，不自動改帳或扣抵');
      }
      r.originalNetAmount=n;r.originalTaxAmount=t;r.grossAmount=g;r.bookTaxAmount=amount(row.bookTaxAmount);r.utilityGrossExpense=isUtility;r.claimedTaxAmount=null;
      var category;
      if(kind==='sale'){
        category={'31':[1,2,4],'32':[9,10,12],'35':[5,6,8],'36':[13,14,16]}[format];
        if(row.isReturn===true){if(['33','34'].indexOf(format)>-1)category=[17,18,20];else bad('RETURN_FORMAT','銷項退折讓須使用退折讓格式代號，不能混入本期一般銷售欄');}
        if(!category&&taxClass!=='out_of_scope')bad('SALES_FORMAT_UNKNOWN','銷項格式代號未支援或待確認');
        if(form==='401'&&taxClass==='exempt')bad('FORM_401_HAS_EXEMPT','401 公司本期含免稅銷售，請確認是否應採403，不自動切換');
        if(taxClass==='zero_rated'&&['customs','non_customs'].indexOf(row.zeroRateExport)<0)bad('ZERO_RATE_EVIDENCE','零稅率需確認海關出口類別及證明');
      } else {
        category={'21':[28,29],'25':[32,33],'22':[36,37],'28':[78,79]}[format];
        if(row.isReturn===true){if(['23','24'].indexOf(format)>-1)category=[40,41];else bad('RETURN_FORMAT','進項退出折讓須確認原始退折讓格式；海關退稅另行核對');}
        if(!category&&taxClass!=='out_of_scope')bad('PURCHASE_FORMAT_UNKNOWN','進項格式代號未支援或待確認');
      }
      if(!valid){if(kind==='sale')salesOK=false;else purchasesOK=false;docs.push(r);return;}
      r.included=true;
      if(kind==='sale'){
        if(taxClass==='taxable'){put(category[0],n,id);put(category[1],t,id);}
        else if(taxClass==='exempt')put(category[2],n,id);
        else if(taxClass==='zero_rated')put(row.isReturn?19:row.zeroRateExport==='customs'?15:7,n,id);
        if(row.assetKind==='fixed_asset')put(27,n*sign,id);
      } else {
        var fixed=row.assetKind==='fixed_asset',offset=fixed?2:0;
        put(fixed?49:48,n*sign,id);inputTotals.originalTax=add(inputTotals.originalTax,t*sign);
        if(row.deduction==='eligible'&&taxClass==='taxable'){
          put(category[0]+offset,n,id);put(category[1]+offset,t,id);
          var usage=row.usage==='taxable_only'?'taxableOnly':row.usage==='exempt_only'?'exemptOnly':'common';inputTotals[usage]=add(inputTotals[usage],t*sign);
          r.claimedTaxAmount=t*sign;
        } else {r.claimedTaxAmount=0;var k=row.deduction==='not_claimed_policy'?'policyExcluded':'excluded';inputTotals[k]=add(inputTotals[k],t*sign);}
      }
      docs.push(r);
    }
    (Array.isArray(input.sales)?input.sales:[]).forEach(function(r){visit(r,'sale');});
    (Array.isArray(input.purchases)?input.purchases:[]).forEach(function(r){visit(r,'purchase');});
    calc(21,[1,5,9,13],[17]);calc(22,[2,6,10,14],[18]);calc(23,[7,15],[19]);if(form==='403')calc(24,[4,8,12,16],[20]);
    calc(25,form==='403'?[21,23,24]:[21,23]);calc(44,[28,32,36,78],[40]);calc(45,[29,33,37,79],[41]);calc(46,[30,34,38,80],[42]);calc(47,[31,35,39,81],[43]);
    if(!salesOK)blockSection('sales');if(!purchasesOK)blockSection('purchases');
    // Unsupported paper sections remain explicitly blank, even for a draft.
    [26,52,53,54,55,56,57,60,61,62,63,64,65,66,73,74,75,76,82,84,85].forEach(function(c){if(fields[c])set(c,null,'manual_review');});
    var rawInput=sum([45,47]),deductible=rawInput,ratio=null,annualEstimate=null;
    if(form==='403'){
      if(typeof adjustments.nonDeductibleRatio==='number'&&adjustments.nonDeductibleRatio>=0&&adjustments.nonDeductibleRatio<=1)ratio=adjustments.nonDeductibleRatio;
      if(ratio===null)issue('NONDEDUCTIBLE_RATIO','403 不得扣抵比例待確認，不能假定0%');
      else if(Math.abs(ratio*100-Math.floor(ratio*100+1e-9))>1e-7){issue('RATIO_PRECISION','官方403不得扣抵比例採百分比小數點以下不計，請確認後輸入整數百分比');ratio=null;}
      if(adjustments.ratioExclusionsReviewed!==true)issue('RATIO_EXCLUSIONS','403 比例分母／土地及證券等排除項目尚未覆核');
      set(50,ratio===null?null:ratio*100);
      if(!directUsageKnown||rawInput===null||ratio===null||['direct','proportional'].indexOf(tax.deductionMethod)<0)deductible=null;
      else deductible=Math.round(tax.deductionMethod==='direct'?inputTotals.taxableOnly+inputTotals.common*(1-ratio):rawInput*(1-ratio));
      set(51,deductible);
      var annual=adjustments.annualTotals;
      if(annual&&['inputTax','article19ExcludedTax','deductedInputTax','nonDeductibleRatio'].every(function(k){return amount(annual[k])!==null;})&&annual.nonDeductibleRatio<=1){
        if(tax.deductionMethod==='proportional')annualEstimate=Math.round(annual.deductedInputTax-(annual.inputTax-annual.article19ExcludedTax)*(1-annual.nonDeductibleRatio));
        else if(amount(annual.exemptOnlyInputTax)!==null&&amount(annual.commonInputTax)!==null)annualEstimate=Math.round(annual.deductedInputTax-(annual.inputTax-annual.article19ExcludedTax-annual.exemptOnlyInputTax-annual.commonInputTax*annual.nonDeductibleRatio));
      }
      if(typeof adjustments.yearEndAdjustmentRequired!=='boolean'||(adjustments.yearEndAdjustmentRequired===true&&adjustments.annualAdjustmentReviewed!==true))issue('ANNUAL_ADJUSTMENT','年度／歇業調整適用性或計算尚未由會計確認');
      if(adjustments.yearEndAdjustmentRequired===true&&annualEstimate===null)issue('ANNUAL_TOTALS','年度調整缺少全年稅額與不得扣抵比例資料');
    }
    set(101,fields[22].value);set(107,deductible);
    var carry=numSetting('priorCarryforwardTax','上期累積留抵稅額'),extra=0,refundAdj=0;
    set(108,carry);
    if(form==='403'){
      var foreign=numSetting('foreignServicePayableTax','國外勞務應納稅額'),special=numSetting('specialTaxPayableTax','特種稅額應納稅額'),annualPay=numSetting('annualAdjustmentPayableTax','年度調整補徵稅額');
      if(foreign>0||special>0)issue('SUPPLEMENTAL_TAX_REVIEW','國外勞務／特種稅額為正數，需另附相應官方附表及專項勾稽；本底稿不能標示資料已齊備');
      refundAdj=numSetting('annualAdjustmentRefundTax','年度調整應退稅額');set(103,foreign);set(104,special);set(105,annualPay);set(109,refundAdj);extra=foreign===null||special===null||annualPay===null?null:foreign+special+annualPay;
      set(106,fields[101].value===null||extra===null?null:fields[101].value+extra);
    }
    var owed=form==='403'?fields[106].value:fields[101].value,credit=deductible===null||carry===null||refundAdj===null?null:deductible+carry+refundAdj;
    set(110,credit);set(111,owed===null||credit===null?null:Math.max(0,Math.round(owed-credit)));set(112,owed===null||credit===null?null:Math.max(0,Math.round(credit-owed)));
    var refundLimit=amount(adjustments.refundLimitConfirmedTax);
    if(refundLimit===null)issue('REFUND_LIMIT','零稅率／固定資產退稅限額待確認（無退稅亦須明確填0）');
    set(113,refundLimit,refundLimit===null?'needs_configuration':'reviewed_input');
    set(114,fields[112].value===null||refundLimit===null?null:Math.min(fields[112].value,refundLimit));
    set(115,fields[112].value===null||fields[114].value===null?null:fields[112].value-fields[114].value);
    if(annualEstimate!==null&&adjustments.yearEndAdjustmentRequired===true&&amount(adjustments.annualAdjustmentPayableTax)!==null&&amount(adjustments.annualAdjustmentRefundTax)!==null&&Math.round(adjustments.annualAdjustmentPayableTax-adjustments.annualAdjustmentRefundTax)!==annualEstimate)issue('ANNUAL_RECONCILIATION','年度調整輸入值與全年計算底稿不一致');
    if(rawInput!==null&&rawInput<0)issue('NEGATIVE_INPUT_TAX','進項退折讓超過本期可核對稅額，需會計處理跨期調整');
    docs.forEach(function(d){if(form==='403'&&d.included&&d.kind==='purchase'&&d.deduction==='eligible'&&d.claimedTaxAmount!==null){d.claimedTaxAmount=ratio===null?null:Math.round(d.claimedTaxAmount*(tax.deductionMethod==='direct'?(d.usage==='taxable_only'?1:d.usage==='exempt_only'?0:1-ratio):1-ratio));}});
    var claimedSum=docs.filter(function(d){return d.kind==='purchase'&&d.included;}).reduce(function(a,d){return a===null||d.claimedTaxAmount===null?null:add(a,d.claimedTaxAmount);},0);
    var roundingAdjustment=deductible===null||claimedSum===null?null:add(deductible,-claimedSum);
    if(roundingAdjustment)issue('INPUT_ROUNDING','逐憑證比例試算與全期合計四捨五入差額 '+roundingAdjustment+' 元；以全期合計底稿為準',null,'info');
    if(!form)Object.keys(fields).forEach(function(c){fields[c].status='needs_configuration';fields[c].value=null;});
    var blocking=checks.filter(function(c){return c.severity==='blocking';});
    return {version:1,status:validateProfile(profile).length?'needs_configuration':blocking.length?'needs_review':'ready_for_review',filingReady:false,form:form,entityId:entity,period:copy(period),fields:Object.keys(fields).map(function(k){return fields[k];}).sort(function(a,b){return Number(a.code)-Number(b.code);}),documents:docs,checks:checks,summary:{outputTax:fields[101].value,deductibleInputTax:form?deductible:null,inputRoundingAdjustment:roundingAdjustment,payableTax:fields[111].value,carryforwardTax:fields[115].value,originalInputTax:inputTotals.originalTax,policyExcludedInputTax:inputTotals.policyExcluded,annualAdjustmentEstimate:annualEstimate,blockingCount:blocking.length},officialSources:copy(sources)};
  }
  function workbookSheets(w) {
    var info=[['文件性質','401／403 預填工作底稿；不可作為已完成電子申報證明'],['狀態',w.status],['法人',w.entityId],['期間',w.period.start+' ~ '+w.period.end],['正式申報完成',false]];
    w.officialSources.forEach(function(s){info.push(['官方來源',s.title,s.url,s.accessed,s.sha256||'']);});
    var fieldRows=[['官方欄碼','欄位','預填金額（空白=待設定）','已知小計','狀態','來源識別碼']].concat(w.fields.map(function(f){return[f.code,f.label,f.value,f.knownSubtotal,f.status,f.sourceIds.join(';')];}));
    function docRows(kind){return [['來源','日期','憑證號','格式代號','課稅別','原始未稅','原始稅額','原始總額','帳面進項稅','扣抵分類','用途','預估扣抵稅','原始憑證','問題','帳面稅核對狀態','來源版本狀態']].concat(w.documents.filter(function(d){return d.kind===kind;}).map(function(d){return[d.id,d.date,d.number,d.formatCode,d.taxClass,d.originalNetAmount,d.originalTaxAmount,d.grossAmount,d.bookTaxAmount,d.deduction||'',d.usage||'',d.claimedTaxAmount,d.evidenceReference||'',d.issues.join(';'),({ready:'已核對',not_posted:'未入帳',not_applicable:'不適用',unresolved:'待核對'})[d.bookTaxStatus]||(d.bookTaxAmount==null?'待核對':'已核對'),({verified:'已核對來源版本',unverified:'須重新核對',changed:'來源已變更',loading:'讀取中'})[d.sourceBindingStatus]||'待確認'];}));}
    return [{name:'工作底稿說明',rows:info},{name:(w.form||'待設定')+'欄位核對',rows:fieldRows},{name:'銷項憑證',rows:docRows('sale')},{name:'進項扣抵明細',rows:docRows('purchase')},{name:'調整與勾稽',rows:[['程度','檢核代碼','說明','來源']].concat(w.checks.map(function(c){return[c.severity,c.code,c.message,c.sourceIds.join(';')];}))}];
  }
  var api={version:1,validateProfile:validateProfile,buildWorkpaper:buildWorkpaper,workbookSheets:workbookSheets,officialSources:copy(sources),fieldDefinitions:copy(defs)};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(global)global.FinanceTaxReportEngine=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
