(function (global) {
  'use strict';
  var EPS = 0.005;
  function number(v) { var n=Number(v==null||v===''?0:v); return Number.isFinite(n)?n:0; }
  function round(v) { return Math.round((number(v)+Number.EPSILON)*100)/100; }
  function sum(rows, pick) { return round((rows||[]).reduce(function(s,r){return s+number(typeof pick==='function'?pick(r):r[pick]);},0)); }
  function date(v) { return String(v||'').slice(0,10).replace(/\//g,'-'); }
  function utcDate(y,m,d) { return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10); }
  function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v)&&utcDate(Number(v.slice(0,4)),Number(v.slice(5,7)),Number(v.slice(8,10)))===v; }
  function periodBounds(period) {
    period=String(period||'all').replace(/\//g,'-');
    if(period==='all')return {start:'',end:''};
    if(/^\d{4}$/.test(period))return {start:period+'-01-01',end:period+'-12-31'};
    if(/^\d{4}-Q[1-4]$/.test(period)){
      var q=Number(period.slice(-1)),y=Number(period.slice(0,4));
      return {start:utcDate(y,(q-1)*3+1,1),end:utcDate(y,q*3+1,0)};
    }
    if(/^\d{4}-(0[1-9]|1[0-2])$/.test(period)){
      return {start:period+'-01',end:utcDate(Number(period.slice(0,4)),Number(period.slice(5,7))+1,0)};
    }
    throw new Error('Invalid financial reporting period: '+period);
  }
  function previousPeriod(period) {
    if(!period||period==='all')return null;
    periodBounds(period);
    if(/^\d{4}$/.test(period))return String(Number(period)-1);
    if(/-Q/.test(period)){var q=Number(period.slice(-1)),y=Number(period.slice(0,4));return (q===1?y-1:y)+'-Q'+(q===1?4:q-1);}
    var d=utcDate(Number(period.slice(0,4)),Number(period.slice(5,7))-1,1);return d.slice(0,7);
  }
  function normalizeRow(row,index) {
    row=row||{};
    return {
      id:String(row.id||''),date:date(row.date||row.entry_date),
      eid:String(row.eid||row.entity_id||''),dc:String(row.dc||row.department_code||''),
      ac:String(row.ac||row.account_code||'').trim(),an:String(row.an||row.account_name||''),
      dr:number(row.dr!=null?row.dr:row.debit),cr:number(row.cr!=null?row.cr:row.credit),
      ref:String(row.ref||row.reference_no||''),voucherNo:String(row.voucherNo||row.voucher_no||''),
      sourceType:String(row.sourceType||row.source_type||''),sourceId:String(row.sourceId||row.source_id||''),
      postingKey:String(row.postingKey||row.posting_key||''),desc:String(row.desc||row.description||''),
      voidedAt:row.voidedAt||row.voided_at||'',cashFlowClass:row.cashFlowClass||row.cash_flow_class||'',
      closingEntry:row.closingEntry===true||row.closing_entry===true,
      invalidAmount:!Number.isFinite(Number(row.dr!=null?row.dr:(row.debit||0)))||!Number.isFinite(Number(row.cr!=null?row.cr:(row.credit||0))),
      index:index
    };
  }
  function normalizeRows(rows) { return (rows||[]).map(normalizeRow); }
  function inBounds(row,bounds) { return validDate(row.date)&&(!bounds.start||row.date>=bounds.start)&&(!bounds.end||row.date<=bounds.end); }
  function isCash(ac) { return ac==='1111'||ac.indexOf('1112')===0; }
  function mapping(row,mappings) {
    var ac=typeof row==='object'?row.ac:row;
    if(mappings&&mappings.__byEntity)mappings=typeof row==='object'?mappings.__byEntity[row.eid]||{}:{};
    return mappings&&mappings[ac]&&typeof mappings[ac]==='object'?mappings[ac]:{};
  }
  function accountClass(ac,mappings) {
    var explicit=mapping(ac,mappings).statementClass;
    if(['asset','liability','equity','revenue','cost','expense','otherIncome','otherExpense','incomeTax'].indexOf(explicit)>-1)return explicit;
    ac=typeof ac==='object'?ac.ac:ac;
    if(ac==='AA1'||ac==='AA2')return 'liability';
    return {'1':'asset','2':'liability','3':'equity','4':'revenue','5':'cost','6':'expense','7':'otherIncome','9':'incomeTax'}[ac.charAt(0)]||'unclassified';
  }
  function profitClass(c) { return ['revenue','cost','expense','otherIncome','otherExpense','incomeTax'].indexOf(c)>-1; }
  function signedProfit(row,mappings) {
    var c=accountClass(row,mappings);
    if(mapping(row,mappings).ociCategory)return 0;
    return profitClass(c)?row.cr-row.dr:0;
  }
  function isClosing(row) { return row.closingEntry||['period_close','closing_entry','year_end_close'].indexOf(row.sourceType)>-1; }
  function groupRows(rows,pick,value) {
    var groups=Object.create(null);
    (rows||[]).forEach(function(row){
      var key=String(pick(row));
      if(!groups[key])groups[key]={key:key,n:row.ac+' '+row.an,ac:row.ac,an:row.an,v:0,dc:row.dc||'',rows:[]};
      groups[key].v+=number(value(row));groups[key].rows.push(row);
    });
    return Object.keys(groups).sort().map(function(key){var item=groups[key];item.v=round(item.v);return item;}).filter(function(r){return Math.abs(r.v)>=EPS;});
  }
  function profitLoss(rows,mappings,checks) {
    rows=(rows||[]).filter(function(r){return !isClosing(r);});mappings=mappings||{};checks=checks||{};
    var out={};
    var classes=[['revenue','revenueRows'],['cost','costRows'],['expense','expenseRows'],['otherIncome','otherIncomeRows'],['otherExpense','otherExpenseRows'],['incomeTax','incomeTaxRows']];
    classes.forEach(function(pair){
      out[pair[1]]=groupRows(rows.filter(function(r){return accountClass(r,mappings)===pair[0]&&!mapping(r,mappings).ociCategory;}),function(r){return r.ac;},function(r){return ['revenue','otherIncome'].indexOf(pair[0])>-1?r.cr-r.dr:r.dr-r.cr;});
      out[pair[0]]=sum(out[pair[1]],'v');
    });
    out.operatingExpense=out.expense;out.grossProfit=round(out.revenue-out.cost);
    out.operatingProfit=round(out.grossProfit-out.expense);
    out.profitBeforeTax=round(out.operatingProfit+out.otherIncome-out.otherExpense);
    out.netProfit=round(out.profitBeforeTax-out.incomeTax);
    out.totalRevenue=round(out.revenue+out.otherIncome);
    out.totalExpense=round(out.cost+out.expense+out.otherExpense+out.incomeTax);
    out.ociRows=groupRows(rows.filter(function(r){return ['reclassifiable','nonreclassifiable'].indexOf(mapping(r,mappings).ociCategory)>-1;}),function(r){return r.ac+'|'+mapping(r,mappings).ociCategory;},function(r){return r.cr-r.dr;}).map(function(r){r.ociCategory=mapping(r.rows[0],mappings).ociCategory;return r;});
    out.ociReclassifiable=sum(out.ociRows.filter(function(r){return r.ociCategory==='reclassifiable';}),'v');
    out.ociNonreclassifiable=sum(out.ociRows.filter(function(r){return r.ociCategory==='nonreclassifiable';}),'v');
    out.ociTotal=round(out.ociReclassifiable+out.ociNonreclassifiable);
    out.comprehensiveIncome=round(out.netProfit+out.ociTotal);
    var mapList=mappings.__byEntity?Object.keys(mappings.__byEntity).map(function(eid){return mappings.__byEntity[eid]||{};}):[mappings];
    out.ociConfigured=mapList.some(function(m){return Object.keys(m).some(function(ac){return !!mapping(ac,m).ociCategory;});});
    out.ociReviewed=checks.ociReviewed===true;
    return out;
  }
  function balanceSheet(rows,mappings) {
    mappings=mappings||{};var out={};
    [['asset','assets'],['liability','liabs'],['equity','equity']].forEach(function(pair){
      out[pair[1]]=groupRows(rows.filter(function(r){return accountClass(r,mappings)===pair[0];}),function(r){return r.ac;},function(r){return pair[0]==='asset'?r.dr-r.cr:r.cr-r.dr;});
    });
    // Include the remaining cumulative P&L balance, not merely this month's
    // profit. Real closing journals naturally reduce this residual to zero.
    out.unclosedProfit=sum(rows,function(r){return signedProfit(r,mappings);});
    out.unclosedOci=sum(rows,function(r){return mapping(r,mappings).ociCategory&&['asset','liability','equity'].indexOf(accountClass(r,mappings))<0?r.cr-r.dr:0;});
    out.dynamicProfit=Math.abs(out.unclosedProfit)>=EPS;
    if(out.dynamicProfit)out.equity.push({key:'unclosed_profit',n:'未結轉損益（截至期末試算）',v:out.unclosedProfit,virtual:true,rows:[]});
    if(Math.abs(out.unclosedOci)>=EPS)out.equity.push({key:'unclosed_oci',n:'未結轉其他綜合損益（截至期末試算）',v:out.unclosedOci,virtual:true,rows:[]});
    out.assetTotal=sum(out.assets,'v');out.liabTotal=sum(out.liabs,'v');out.equityTotal=sum(out.equity,'v');
    out.balanceDifference=round(out.assetTotal-out.liabTotal-out.equityTotal);out.source=rows.length?'ledger':'empty';
    return out;
  }
  function transactionKey(r) {
    var key=r.voucherNo||((r.sourceType&&r.sourceId)?r.sourceType+':'+r.sourceId:r.ref);
    return r.eid+'|'+r.date+'|'+(key||'unlinked:'+r.index);
  }
  function cashClass(row,mappings,override) {
    var explicit=override||row.cashFlowClass||mapping(row,mappings).cashFlowClass;
    if(['operating','investing','financing','noncash','unclassified'].indexOf(explicit)>-1)return explicit;
    var ac=row.ac,c=accountClass(row,mappings);
    if(/^15|^16/.test(ac))return 'investing';
    if(/^31|^32/.test(ac)||ac==='2192'||ac==='21911')return 'financing';
    if(profitClass(c)||/^112|^114|^1191|^211|^212|^213[124]|^214|^2195/.test(ac)||ac==='2191'||ac==='2199'||ac==='AA1'||ac==='AA2')return 'operating';
    return 'unclassified';
  }
  function cashFlow(rows,bounds,mappings,cashEvents,overrides) {
    mappings=mappings||{};overrides=overrides||{};
    var before=rows.filter(function(r){return bounds.start&&r.date<bounds.start;});
    var current=rows.filter(function(r){return inBounds(r,bounds);});
    var toEnd=rows.filter(function(r){return !bounds.end||r.date<=bounds.end;});
    var out={start:sum(before.filter(function(r){return isCash(r.ac);}),function(r){return r.dr-r.cr;}),opIn:0,opOut:0,op:0,inv:0,fin:0,unclassified:0,activities:[],internalTransfers:[],unpostedCashEvents:[]};
    var groups=Object.create(null);
    current.forEach(function(r){var key=transactionKey(r);(groups[key]||(groups[key]=[])).push(r);});
    Object.keys(groups).forEach(function(key){
      var tx=groups[key],cash=tx.filter(function(r){return isCash(r.ac);});if(!cash.length)return;
      var other=tx.filter(function(r){return !isCash(r.ac);}),flow=sum(cash,function(r){return r.dr-r.cr;});
      var difference=sum(tx,function(r){return r.dr-r.cr;});
      if(Math.abs(flow)<EPS&&other.every(function(r){return Math.abs(r.dr-r.cr)<EPS;})){
        out.internalTransfers.push({key:key,amount:sum(cash,function(r){return Math.max(0,r.dr-r.cr);}),rows:tx});return;
      }
      if(Math.abs(difference)>=EPS||!other.length){
        out.activities.push({key:key,class:'unclassified',amount:flow,reason:'來源分錄不完整或借貸不平',rows:tx});return;
      }
      var override=overrides[tx[0].eid+'|'+tx[0].ref]||'';
      var classes=Object.create(null);
      other.forEach(function(r){var c=cashClass(r,mappings,override);if(c==='noncash')c='unclassified';classes[c]=(classes[c]||0)+r.cr-r.dr;});
      var classAmounts=Object.keys(classes).map(function(c){return round(classes[c]);}).filter(function(amount){return Math.abs(amount)>=EPS;});
      if(classAmounts.some(function(amount){return amount>0;})&&classAmounts.some(function(amount){return amount<0;})){
        out.activities.push({key:key,class:'unclassified',amount:flow,reason:'同筆來源跨活動且含相反方向對方分錄，需覆核現金與非現金部分',rows:tx});return;
      }
      Object.keys(classes).forEach(function(c){var amount=round(classes[c]);if(Math.abs(amount)>=EPS)out.activities.push({key:key,class:c,amount:amount,reason:c==='unclassified'?'需指定現金流分類':'依來源對方科目',rows:tx});});
    });
    out.activities.forEach(function(a){if(a.class==='operating'){if(a.amount>=0)out.opIn+=a.amount;else out.opOut+=a.amount;}else if(a.class==='investing')out.inv+=a.amount;else if(a.class==='financing')out.fin+=a.amount;else out.unclassified+=a.amount;});
    ['opIn','opOut','inv','fin','unclassified'].forEach(function(k){out[k]=round(out[k]);});
    out.op=round(out.opIn+out.opOut);out.net=round(out.op+out.inv+out.fin+out.unclassified);out.end=round(out.start+out.net);
    out.bookEnd=sum(toEnd.filter(function(r){return isCash(r.ac);}),function(r){return r.dr-r.cr;});out.reconciliationDifference=round(out.end-out.bookEnd);
    (cashEvents||[]).forEach(function(e){
      if(!inBounds({date:date(e.date)},bounds))return;
      var matching=rows.some(function(r){return isCash(r.ac)&&r.eid===String(e.eid||'')&&((e.ref&&r.ref===e.ref)||(e.sourceId&&r.sourceId===e.sourceId));});
      if(!matching)out.unpostedCashEvents.push(Object.assign({},e,{amount:round(e.amount)}));
    });
    out.unpostedCashAmount=sum(out.unpostedCashEvents,'amount');out.source=rows.length?'ledger':'empty';return out;
  }
  function departmentRows(rows,mappings) {
    var groups=Object.create(null);
    rows.filter(function(r){return !isClosing(r);}).forEach(function(r){
      var c=accountClass(r,mappings);if(!profitClass(c)||mapping(r,mappings).ociCategory)return;
      var key=r.eid+'|'+r.dc;if(!groups[key])groups[key]={eid:r.eid,dc:r.dc,name:r.dc||'未指定部門',income:0,expense:0,net:0};
      if(c==='revenue'||c==='otherIncome')groups[key].income+=r.cr-r.dr;else groups[key].expense+=r.dr-r.cr;
    });
    return Object.keys(groups).sort().map(function(k){var r=groups[k];r.income=round(r.income);r.expense=round(r.expense);r.net=round(r.income-r.expense);r.total=round(Math.abs(r.income)+Math.abs(r.expense));return r;});
  }
  function warning(code,message) { return {code:code,message:message}; }
  function scopeRows(input) {
    return normalizeRows(input.ledger).filter(function(r){return !r.voidedAt&&(!input.entityId||input.entityId==='all'||r.eid===String(input.entityId))&&(!input.departmentCode||input.departmentCode==='all'||r.dc===String(input.departmentCode));});
  }
  function periodModel(all,period,input) {
    var bounds=periodBounds(period),mappings=input.accountMappingsByEntity?{__byEntity:input.accountMappingsByEntity}:input.accountMappings||{},checks=input.checks||{};
    var invalid=all.filter(function(r){return !validDate(r.date)||r.invalidAmount;}),valid=all.filter(function(r){return validDate(r.date)&&!r.invalidAmount;});
    var current=valid.filter(function(r){return inBounds(r,bounds);}),cumulative=valid.filter(function(r){return !bounds.end||r.date<=bounds.end;});
    var bs=balanceSheet(cumulative,mappings),pl=profitLoss(current,mappings,checks),cf=cashFlow(valid,bounds,mappings,input.cashEvents,input.cashFlowOverrides),warnings=[];
    var td=sum(current,'dr'),tc=sum(current,'cr'),cd=sum(cumulative,'dr'),cc=sum(cumulative,'cr');
    var trial={periodDebit:td,periodCredit:tc,periodDifference:round(td-tc),cumulativeDebit:cd,cumulativeCredit:cc,cumulativeDifference:round(cd-cc),balanceDifference:bs.balanceDifference,cashDifference:cf.reconciliationDifference};
    trial.checks=[['period','本期借貸平衡',trial.periodDifference],['cumulative','累計借貸平衡',trial.cumulativeDifference],['balance_sheet','資產負債表平衡',trial.balanceDifference],['cash_flow','期末現金與帳上現金',trial.cashDifference]].map(function(x){return {key:x[0],name:x[1],diff:x[2],pass:Math.abs(x[2])<EPS};});
    trial.ok=trial.checks.every(function(c){return c.pass;});
    if(invalid.length)warnings.push(warning('invalid_rows',invalid.length+' 筆分錄日期或金額無效，未納入計算'));
    if(!cumulative.length)warnings.push(warning('empty_ledger','此範圍尚無可計算的正式分類帳；零不代表已核對餘額'));
    if(!trial.ok)warnings.push(warning('statement_difference','報表仍有借貸或勾稽差額'));
    var unknown=current.filter(function(r){return accountClass(r,mappings)==='unclassified';});
    if(unknown.length)warnings.push(warning('unclassified_accounts',unknown.length+' 筆科目尚未配置報表分類'));
    if(cf.activities.some(function(a){return a.class==='unclassified';}))warnings.push(warning('unclassified_cash','仍有現金交易待指定活動分類'));
    if(cf.unpostedCashEvents.length)warnings.push(warning('unposted_cash',cf.unpostedCashEvents.length+' 筆已放款表單尚無正式現金分錄，另列待入帳'));
    if(bs.dynamicProfit)warnings.push(warning('unclosed_profit','權益包含截至期末尚未結轉的損益試算；未自動建立結帳分錄'));
    if(!checks.ociReviewed)warnings.push(warning('oci_review','其他綜合損益尚待確認；未配置或零金額不代表已確認不適用'));
    return {period:period,bounds:bounds,rowCount:current.length,cumulativeRowCount:cumulative.length,bs:bs,pl:pl,cf:cf,trialBalance:trial,departments:departmentRows(current,mappings),warnings:warnings};
  }
  function delta(current,previous) { return {current:round(current),previous:previous==null?null:round(previous),amount:previous==null?null:round(current-previous),percent:previous==null||Math.abs(previous)<EPS?null:round((current-previous)/Math.abs(previous)*100)}; }
  function buildModel(input) {
    input=Object.assign({},input||{});
    input.cashEvents=(input.cashEvents||[]).filter(function(e){return (!input.entityId||input.entityId==='all'||String(e.eid||'')===String(input.entityId))&&(!input.departmentCode||input.departmentCode==='all'||String(e.dc||'')===String(input.departmentCode));});
    var period=String(input.period||'all'),all=scopeRows(input),prevPeriod=input.comparisonPeriod===null?null:(input.comparisonPeriod||previousPeriod(period));
    var current=periodModel(all,period,input),prev=prevPeriod?periodModel(all,prevPeriod,Object.assign({},input,{checks:input.previousChecks||{}})):null;
    var completeness=Object.assign({complete:false,status:'unknown',rowCount:all.length},input.completeness||{}),warnings=current.warnings.slice(),checks=input.checks||{};
    if(completeness.complete!==true)warnings.unshift(warning('incomplete_ledger','正式分類帳尚未完整載入或驗證失敗；此報表不能視為完整餘額'));
    [['openingBalanceVerified','期初餘額尚未確認'],['bankReconciled','銀行對帳尚未確認'],['taxReconciled','稅務勾稽尚未確認'],['periodCloseReady','本期結帳檢查尚未確認']].forEach(function(x){if(checks[x[0]]!==true)warnings.push(warning(x[0],x[1]));});
    if(!input.entityId||input.entityId==='all')warnings.push(warning('aggregate_scope','全部法人為管理加總，未執行合併抵銷'));
    return {entityId:input.entityId||'all',departmentCode:input.departmentCode||'all',period:period,previousPeriod:prevPeriod,status:'draft',readyForReview:!warnings.length,scope:(!input.entityId||input.entityId==='all')?'aggregate':'entity',completeness:completeness,current:current,previous:prev,comparison:prev,warnings:warnings,
      changes:{revenue:delta(current.pl.totalRevenue,prev&&prev.pl.totalRevenue),expense:delta(current.pl.totalExpense,prev&&prev.pl.totalExpense),netProfit:delta(current.pl.netProfit,prev&&prev.pl.netProfit),comprehensiveIncome:delta(current.pl.comprehensiveIncome,prev&&prev.pl.comprehensiveIncome),cashEnd:delta(current.cf.end,prev&&prev.cf.end)}};
  }
  function exportSheets(model) {
    var current=model.current,previous=model.previous;
    var intro=[['財務報表（暫編）'],['法人',model.entityId],['期間',model.period],['比較期間',model.previousPeriod||'無'],['範圍',model.scope==='aggregate'?'全部法人管理加總（未合併抵銷）':'單一法人'],['資料完整',model.completeness.complete===true?'已完整載入':'尚未完整驗證']];
    function sheet(name,rows){return {name:name,rows:intro.concat([[]],rows)};}
    function fields(spec,now,old){return [['項目','本期','前期','差額']].concat(spec.map(function(x){var a=now[x[0]],b=old?old[x[0]]:null;return [x[1],a,b,b==null?null:round(a-b)];}));}
    function accountComparison(a,b){var map=Object.create(null);(a||[]).forEach(function(r){map[r.key]={name:r.n,current:r.v,previous:0};});(b||[]).forEach(function(r){if(!map[r.key])map[r.key]={name:r.n,current:0,previous:0};map[r.key].previous=r.v;});return Object.keys(map).sort().map(function(k){var r=map[k];return [r.name,r.current,previous?r.previous:null,previous?round(r.current-r.previous):null];});}
    var bs=[['項目','本期末','前期末','差額']];[['assets','資產'],['liabs','負債'],['equity','權益']].forEach(function(x){bs.push([x[1]]);bs=bs.concat(accountComparison(current.bs[x[0]],previous&&previous.bs[x[0]]));});
    bs=bs.concat(fields([['assetTotal','資產合計'],['liabTotal','負債合計'],['equityTotal','權益合計'],['balanceDifference','資產負債差額']],current.bs,previous&&previous.bs).slice(1));
    var pl=fields([['revenue','營業收入'],['cost','直接成本'],['grossProfit','毛利'],['operatingExpense','營業費用'],['operatingProfit','營業利益'],['otherIncome','營業外收入'],['otherExpense','營業外費用'],['profitBeforeTax','稅前損益'],['incomeTax','所得稅費用（利益）'],['netProfit','本期損益'],['ociReclassifiable','其他綜合損益：可重分類'],['ociNonreclassifiable','其他綜合損益：不重分類'],['ociTotal','其他綜合損益合計'],['comprehensiveIncome','綜合損益總額']],current.pl,previous&&previous.pl);
    pl.push([],['科目明細','本期','前期','差額']);['revenueRows','costRows','expenseRows','otherIncomeRows','otherExpenseRows','incomeTaxRows','ociRows'].forEach(function(k){pl=pl.concat(accountComparison(current.pl[k],previous&&previous.pl[k]));});
    var cf=fields([['start','期初現金'],['opIn','營業活動流入'],['opOut','營業活動流出'],['op','營業活動淨額'],['inv','投資活動淨額'],['fin','籌資活動淨額'],['unclassified','待分類現金淨額'],['net','本期現金淨變動'],['end','期末現金'],['bookEnd','分類帳期末現金'],['reconciliationDifference','現金勾稽差額'],['unpostedCashAmount','表單放款待入帳（未計入帳上現金）']],current.cf,previous&&previous.cf);
    return [sheet('資產負債表',bs),sheet('綜合損益表',pl),sheet('現金流量表',cf),sheet('試算平衡',[['檢查','差額','結果']].concat(current.trialBalance.checks.map(function(c){return [c.name,c.diff,c.pass?'通過':'異常'];}))),sheet('部門損益',[['法人','部門','收入','費用','損益']].concat(current.departments.map(function(r){return [r.eid,r.dc,r.income,r.expense,r.net];}))),sheet('覆核事項',[['項目','說明']].concat(model.warnings.map(function(w){return [w.code,w.message];})))];
  }
  async function loadLedgerPages(fetchPage,options) {
    options=options||{};var size=Math.max(1,Math.min(1000,Number(options.pageSize)||1000)),maxPages=Math.max(1,Number(options.maxPages)||10000),rows=[],seen=Object.create(null),total=null,pages=0;
    for(var offset=0;pages<maxPages;offset+=size){
      if(options.isCurrent&&options.isCurrent()!==true)throw new Error('Ledger identity changed during loading');
      var result=await fetchPage(offset,offset+size-1);pages++;
      if(result&&result.error)throw result.error;
      if(!result||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<0)throw new Error('Ledger page is missing an exact total');
      if(total===null)total=result.count;else if(total!==result.count)throw new Error('Ledger changed during pagination; refresh required');
      result.data.forEach(function(row){if(!row||!row.id||seen[String(row.id)])throw new Error('Ledger pagination returned a missing or duplicate row ID');seen[String(row.id)]=true;rows.push(row);});
      if(rows.length>total)throw new Error('Ledger pagination exceeded the exact total');
      if(options.onProgress)options.onProgress({rowCount:rows.length,total:total,pages:pages});
      if(rows.length===total){if(options.isCurrent&&options.isCurrent()!==true)throw new Error('Ledger identity changed during loading');return {data:rows,error:null,count:total,completeness:{complete:true,status:'complete',rowCount:rows.length,total:total,pages:pages,loadedAt:new Date().toISOString()}};}
      if(result.data.length!==size)throw new Error('Ledger pagination ended before the exact total');
    }
    throw new Error('Ledger pagination safety limit reached; data remains incomplete');
  }
  var api={periodBounds:periodBounds,previousPeriod:previousPeriod,normalizeRows:normalizeRows,accountClass:accountClass,isCash:isCash,profitLoss:profitLoss,balanceSheet:balanceSheet,cashFlow:cashFlow,departmentRows:departmentRows,buildModel:buildModel,exportSheets:exportSheets,loadLedgerPages:loadLedgerPages};
  global.FinanceFinancialStatements=api;
  if(global.FinanceV4Engines&&typeof global.FinanceV4Engines.register==='function')global.FinanceV4Engines.register('financial-statements',api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
