(function (global) {
  'use strict';
  // Read-only workpapers. This engine neither signs an audit opinion nor changes
  // accounting, permissions, PBC status, or the server's source fingerprint.
  var statements = global.FinanceFinancialStatements;
  if (!statements && typeof module !== 'undefined' && module.exports) statements = require('./financial-statements.js');
  var DISCLAIMER = '供查帳準備與內部覆核使用；系統核對、資料已提供及內部已覆核均不代表會計師已查核、簽證或結案。';
  var SAMPLING_NOTE = '全母體規則篩選的風險候選，非會計師審計抽樣、重大性判斷或不實交易結論。';
  var TEMPLATES = [
    ['A01', '案件與法人範圍', '法人登記、統編、法律形式、委任範圍與適用會計準則。'],
    ['A02', '完整母體與封存版本', '試算表、分類帳、明細帳、期初餘額及來源版本與總額；確認所有資料均已取得。'],
    ['A03', '索資與證據鏈', '原始憑證、合約、交付或驗收資料及查核記錄，保留與單據、傳票、分錄的對應。'],
    ['A04', '人工分錄與控制踰越', '人工分錄、調整與沖銷原因、權限及實際審批歷史。'],
    ['A05', '銀行核對與外部函證', '各帳戶完整對帳單與調節表；外部函證由會計師自行控制發送及回函。'],
    ['A06', '長照收入與應收可回收性', '服務契約與紀錄、付款人、申報核定、帳齡、期後收款與可回收性佐證。'],
    ['A07', '截止與未入帳負債', '期前後憑證、尚未到單及應計薪資、租金等負債；確認服務與入帳所屬期間。'],
    ['A08', '資產、租賃與盤點底稿', '資產台帳、權狀或合約、盤點、折舊、處分及適用時的存貨資料。'],
    ['A09', '關係人及跨法人往來', '關係人名冊、借貸及租賃、雙邊對帳與管理抵銷依據。'],
    ['A10', '四表、權益調節與附註', '比較報表、權益調節、出資與分配決議、必要附註索引；試算不等於已完成正式四表。'],
    ['A11', '帳稅差異與申報核對', '帳載金額至稅務調整與申報的勾稽、適用法源年度、扣繳及虧損資料；依案件確認適用範圍。'],
    ['A12', '結案聲明、期後事項與繼續經營', '具名聲明、未更正差異、期後事項、未來十二個月預測與到期債務；結論由受任會計師決定。']
  ];
  function text(v) { return v == null ? '' : String(v); }
  function field(row, names) { for (var i = 0; i < names.length; i++) if (row[names[i]] != null) return row[names[i]]; return null; }
  function integer(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
  function cents(v) {
    if (typeof v !== 'number' && !(typeof v === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(v))) return null;
    if (v === '' || !Number.isFinite(Number(v))) return null;
    var n = Number(v) * 100, rounded = Math.round(n);
    return Number.isSafeInteger(rounded) && Math.abs(n - rounded) < 0.001 ? rounded : null;
  }
  function money(v) { return v == null || !Number.isSafeInteger(v) ? null : v / 100; }
  function total(rows, pick) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) { var v = pick(rows[i]); if (v == null || !Number.isSafeInteger(v) || !Number.isSafeInteger(n + v)) return null; n += v; }
    return n;
  }
  function day(v) {
    var s = text(v).replace(/\//g, '-');
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      var timestamp = Date.parse(s); if (!Number.isFinite(timestamp)) return '';
      s = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var date = new Date(s + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s ? s : '';
  }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
  function ids(rows) { return unique(rows.map(function (r) { return r.id; })); }
  function sourceLinks(rows) {
    var seen = new Set(); return rows.filter(function (r) {
      var key = r.sourceType + '|' + r.sourceId;
      if (!r.sourceType || !r.sourceId || seen.has(key)) return false; seen.add(key); return true;
    }).map(function (r) { return {sourceType:r.sourceType, sourceId:r.sourceId}; });
  }
  function normalized(raw, index) {
    var dr = cents(field(raw, ['dr', 'debit'])), cr = cents(field(raw, ['cr', 'credit']));
    return {
      id:text(raw.id), index:index, entityId:text(field(raw, ['eid', 'entity_id', 'entityId'])),
      date:day(field(raw, ['date', 'entry_date'])), originalDate:text(field(raw, ['date', 'entry_date'])),
      departmentCode:text(field(raw, ['dc', 'department_code', 'departmentCode'])).trim(),
      accountCode:text(field(raw, ['ac', 'account_code', 'accountCode'])).trim(), accountName:text(field(raw, ['an', 'account_name', 'accountName'])),
      debit:money(dr), credit:money(cr), debitCents:dr, creditCents:cr,
      invalidAmount:dr === null || cr === null || dr < 0 || cr < 0,
      referenceNo:text(field(raw, ['ref', 'reference_no', 'referenceNo'])),
      voucherId:text(field(raw, ['voucherId', 'voucher_id'])), voucherNo:text(field(raw, ['voucherNo', 'voucher_no'])),
      sourceType:text(field(raw, ['sourceType', 'source_type'])), sourceId:text(field(raw, ['sourceId', 'source_id'])),
      postingKey:text(field(raw, ['postingKey', 'posting_key'])), description:text(field(raw, ['desc', 'description'])),
      voidedAt:text(field(raw, ['voidedAt', 'voided_at'])),
      closingEntry:raw.closingEntry === true || raw.closing_entry === true,
      manualEntry:raw.manualEntry === true || raw.manual_entry === true || raw.is_manual === true
    };
  }
  function statementRows(rows) {
    return rows.map(function (r) { return {id:r.id, date:r.date, eid:r.entityId, dc:r.departmentCode, ac:r.accountCode, an:r.accountName, dr:r.debit, cr:r.credit, sourceType:r.sourceType, sourceId:r.sourceId, voucherNo:r.voucherNo, ref:r.referenceNo, closingEntry:r.closingEntry}; });
  }
  function closing(r) { return r.closingEntry || ['period_close', 'closing_entry', 'year_end_close'].indexOf(r.sourceType) >= 0; }
  function mapping(r, profile) { return (profile.accountMappings || {})[r.accountCode] || {}; }
  function accountClass(r, profile) { return statements ? statements.accountClass(r.accountCode, profile.accountMappings || {}) : 'unclassified'; }
  function profitClass(c) { return ['revenue', 'cost', 'expense', 'otherIncome', 'otherExpense', 'incomeTax'].indexOf(c) >= 0; }
  function equityContribution(r, profile) {
    var c = accountClass(r, profile), oci = mapping(r, profile).ociCategory;
    return c === 'equity' || profitClass(c) || (oci && c !== 'asset' && c !== 'liability') ? r.creditCents - r.debitCents : 0;
  }
  function tableState(table, rows, entityId) {
    table = table || {};
    var count = field(table, ['total', 'expectedCount', 'count']), loaded = field(table, ['rowCount', 'loadedCount']);
    var scoped = field(table, ['scopedRowCount', 'scopedCount']);
    var ok = table.complete === true && ['loading', 'error', 'not_loaded', 'not_authorized', 'unknown'].indexOf(table.status) < 0 && integer(count) && integer(loaded) && count === loaded;
    if (table.entityId != null && text(table.entityId) !== entityId) ok = false;
    if (rows) ok = ok && (integer(scoped) ? scoped === rows.length : loaded === rows.length);
    return {complete:ok, status:ok ? 'complete' : text(table.status || 'unknown'), expectedCount:integer(count) ? count : null, loadedCount:integer(loaded) ? loaded : null, scopedCount:integer(scoped) ? scoped : null, loadedAt:text(table.loadedAt)};
  }
  function control(id, title, status, message, rows, amount, count) {
    return {id:id, title:title, status:status, message:message, amount:amount == null ? null : amount, count:count == null ? null : count, sourceIds:ids(rows || []), sourceLinks:sourceLinks(rows || [])};
  }
  function duplicateRows(rows, pick) {
    var groups = new Map(); rows.forEach(function (r) { var k = pick(r); if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); } });
    return Array.from(groups.values()).filter(function (g) { return g.length > 1; }).flat();
  }
  function trialBalance(rows, bounds, reliable, profile) {
    var groups = new Map(); rows.forEach(function (r) {
      var code = r.accountCode || '(缺科目)';
      if (!groups.has(code)) groups.set(code, {accountCode:code, accountName:r.accountName, rows:[]}); groups.get(code).rows.push(r);
    });
    return Array.from(groups.values()).sort(function (a,b) { return a.accountCode.localeCompare(b.accountCode); }).map(function (g) {
      var prior = g.rows.filter(function (r) { return bounds.start && r.date < bounds.start; }), current = g.rows.filter(function (r) { return !bounds.start || r.date >= bounds.start; });
      var opening = total(prior, function (r) { return r.debitCents - r.creditCents; }), dr = total(current, function (r) { return r.debitCents; }), cr = total(current, function (r) { return r.creditCents; });
      var end = total(g.rows, function (r) { return r.debitCents - r.creditCents; }), valid = reliable && opening !== null && dr !== null && cr !== null && end !== null;
      return {accountCode:g.accountCode, accountName:g.accountName, statementClass:accountClass(g.rows[0], profile), complete:valid,
        openingBalance:valid ? money(opening) : null, openingDebit:valid ? money(Math.max(0, opening)) : null, openingCredit:valid ? money(Math.max(0, -opening)) : null,
        periodDebit:valid ? money(dr) : null, periodCredit:valid ? money(cr) : null,
        closingBalance:valid ? money(end) : null, closingDebit:valid ? money(Math.max(0, end)) : null, closingCredit:valid ? money(Math.max(0, -end)) : null,
        observedOpeningBalance:money(opening), observedPeriodDebit:money(dr), observedPeriodCredit:money(cr), observedClosingBalance:money(end), sourceIds:ids(g.rows)};
    });
  }
  function equityRollforward(rows, bounds, reliable, profile) {
    var prior = rows.filter(function (r) { return bounds.start && r.date < bounds.start; }), current = rows.filter(function (r) { return !bounds.start || r.date >= bounds.start; });
    var opening = total(prior, function (r) { return equityContribution(r, profile); }), end = total(rows, function (r) { return equityContribution(r, profile); });
    var pnl = current.filter(function (r) { return !closing(r) && profitClass(accountClass(r, profile)) && !mapping(r, profile).ociCategory; });
    var oci = current.filter(function (r) { return !closing(r) && ['reclassifiable', 'nonreclassifiable'].indexOf(mapping(r, profile).ociCategory) >= 0; });
    var postedEquity = current.filter(function (r) { return accountClass(r, profile) === 'equity'; });
    var other = postedEquity.filter(function (r) { return !closing(r) && !mapping(r, profile).ociCategory; });
    var closings = current.filter(closing), closingEffect = total(closings, function (r) { return equityContribution(r, profile); });
    var profit = total(pnl, function (r) { return r.creditCents - r.debitCents; }), ociTotal = total(oci, function (r) { return r.creditCents - r.debitCents; });
    var otherTotal = total(other, function (r) { return r.creditCents - r.debitCents; }), posted = total(postedEquity, function (r) { return r.creditCents - r.debitCents; });
    var parts = [opening, profit, ociTotal, otherTotal, closingEffect], expected = total(parts, function (v) { return v; });
    var unknown = rows.filter(function (r) { return accountClass(r, profile) === 'unclassified'; });
    var ok = reliable && bounds.start !== '' && !unknown.length && end !== null && expected !== null;
    var status = !ok ? 'unknown' : expected !== end ? 'issue' : 'review';
    return {title:'權益變動調節底稿（待分類與佐證）', status:status, formalStatement:false,
      openingEquity:ok ? money(opening) : null, currentProfit:ok ? money(profit) : null, currentOci:ok ? money(ociTotal) : null,
      postedEquityMovement:ok ? money(posted) : null, otherEquityMovement:ok ? money(otherTotal) : null,
      closingEntryNetEffect:ok ? money(closingEffect) : null, expectedClosingEquity:ok ? money(expected) : null, closingEquity:ok ? money(end) : null,
      difference:ok ? money(end - expected) : null, unclassifiedMovementCount:other.length, sourceIds:ids(postedEquity.concat(closings)),
      movements:other.map(function (r) { return {id:r.id, accountCode:r.accountCode, amount:money(r.creditCents - r.debitCents), category:'待依決議及憑證分類', sourceType:r.sourceType, sourceId:r.sourceId}; }),
      message:'期初與期末含未結轉損益試算；本期損益及 OCI 不重複加計已入權益的 OCI 或結帳轉入。其他權益變動仍須分類、取得決議及比較附註；算術勾稽不代表期初已驗證或正式權益變動表已完成。'};
  }
  function pbcItems(auditCase, today) {
    var data = auditCase.caseData || {}, saved = data.items || {}, fingerprint = text(auditCase.sourceFingerprint);
    return TEMPLATES.map(function (template) {
      var item = saved[template[0]] || {}, status = ['pending','provided','reviewed'].indexOf(item.status) >= 0 ? item.status : 'pending';
      var applicability = ['unknown','applicable','not_applicable'].indexOf(item.applicability) >= 0 ? item.applicability : 'unknown';
      var links = Array.isArray(item.sourceLinks) ? item.sourceLinks.filter(function (link) { return link && text(link.sourceType) && text(link.sourceId); }).map(function (link) { return {sourceType:text(link.sourceType), sourceId:text(link.sourceId)}; }) : [];
      var reason = text(item.notes), evidence = text(item.evidenceReference), hasEvidence = !!evidence.trim() || links.length > 0;
      var prepared = !!text(item.preparedBy).trim() && !!text(item.preparedAt).trim(), reviewed = !!text(item.reviewedBy).trim() && !!text(item.reviewedAt).trim();
      var effective = status, staleReason = '';
      if (status === 'provided' && (!prepared || !hasEvidence || (applicability === 'not_applicable' && !reason.trim()))) effective = 'pending';
      if (status === 'reviewed') {
        if (!fingerprint || text(item.reviewedFingerprint) !== fingerprint) staleReason = '來源版本變更或缺少來源綁定，須重新覆核';
        else if (!reviewed || !prepared || text(item.preparedBy) === text(item.reviewedBy) || applicability === 'unknown' || !hasEvidence || (applicability === 'not_applicable' && !reason.trim())) staleReason = '缺少分別具名提供及覆核、適用性或證據記錄';
        if (staleReason) effective = 'stale';
      }
      var due = day(item.dueDate);
      return {id:template[0], title:template[1], description:template[2], ownerId:text(item.ownerId), dueDate:due, applicability:applicability,
        status:status, effectiveStatus:effective, evidenceReference:evidence, notes:reason, sourceLinks:links,
        preparedBy:text(item.preparedBy), preparedAt:text(item.preparedAt), reviewedBy:text(item.reviewedBy), reviewedAt:text(item.reviewedAt), reviewedFingerprint:text(item.reviewedFingerprint),
        staleReason:staleReason, overdue:!!(due && today && due < today && effective !== 'reviewed')};
    });
  }
  function buildModel(input) {
    input = input || {}; var entityId = text(input.entityId), period = text(input.period), today = day(input.today), bounds = {start:'',end:''}, periodValid = false;
    try { if (statements && period && period !== 'all') { bounds = statements.periodBounds(period); periodValid = true; } } catch (_) { /* an unknown scope must not become all periods */ }
    var scopeValid = !!entityId && entityId !== 'all' && periodValid, raw = Array.isArray(input.ledger) ? input.ledger : [], warnings = [];
    var all = raw.map(function (r,i) { return normalized(r || {}, i); });
    var foreignCount = all.filter(function (r) { return r.entityId !== entityId; }).length;
    // Foreign-company contents never enter exports, even when a caller passes a
    // tenant-wide cache by mistake. A concrete company is required for a case.
    var company = scopeValid ? all.filter(function (r) { return r.entityId === entityId; }) : [];
    var ledger = company.filter(function (r) { return !r.date || r.date <= bounds.end; });
    var active = ledger.filter(function (r) { return !r.voidedAt; }), invalid = active.filter(function (r) { return !r.date || r.invalidAmount; });
    var valid = active.filter(function (r) { return r.date && !r.invalidAmount; });
    var tables = (input.completeness || {}).tables || {}, sourceState = {};
    ['ledger','invoices','expense_requests'].forEach(function (key) { sourceState[key] = tableState(tables[key], key === 'ledger' ? raw : null, entityId); });
    var ledgerComplete = scopeValid && Array.isArray(input.ledger) && sourceState.ledger.complete;
    var populationComplete = ledgerComplete && sourceState.invoices.complete && sourceState.expense_requests.complete;
    var duplicateId = duplicateRows(active, function (r) { return r.id; }), duplicatePosting = duplicateRows(active, function (r) { return r.postingKey; });
    var missing = active.filter(function (r) { return !r.id || !r.sourceType || !r.sourceId || !r.postingKey || !(r.voucherId || r.voucherNo); });
    var duplicate = Array.from(new Set(duplicateId.concat(duplicatePosting))), trustworthy = ledgerComplete && !invalid.length && !duplicateId.length && !duplicatePosting.length;
    var profile = input.profile && input.profile.profile ? input.profile.profile : input.profile || {}, controls = [];
    if (!scopeValid) warnings.push('請選擇單一法人與有效月、季或年；查帳案件不能以全部法人管理加總代替。');
    if (foreignCount) warnings.push('輸入包含 ' + foreignCount + ' 筆其他法人或缺少法人資料，已排除且未匯出其內容。');
    if (!populationComplete) warnings.push('來源未證完整；未知金額保留空值，觀察到的小計不能替代完整餘額。');
    controls.push(control('C01','來源完整性與範圍',populationComplete ? 'pass' : 'unknown',populationComplete ? '三項來源均有相符的完整讀取筆數；僅代表資料載入，不代表憑證正確。' : '需完整取得正式分類帳、發票與申請；缺少 exact count、範圍或載入失敗均不當成零。',[],null,populationComplete ? raw.length : null));
    var groups = new Map(), missingVoucher = valid.filter(function (r) { return !(r.voucherId || r.voucherNo); });
    valid.forEach(function (r) { var key = r.voucherId || r.voucherNo; if (key) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); } });
    var voucherIssues = [], unsafeVoucher = false;
    groups.forEach(function (rows) { var dr = total(rows, function (r) { return r.debitCents; }), cr = total(rows, function (r) { return r.creditCents; }); if (dr === null || cr === null) unsafeVoucher = true; else if (dr !== cr) voucherIssues = voucherIssues.concat(rows); });
    controls.push(control('C02','逐張傳票借貸平衡',trustworthy && !missingVoucher.length && !unsafeVoucher && active.length ? (voucherIssues.length ? 'issue' : 'pass') : 'unknown',
      voucherIssues.length ? '觀察到個別傳票借貸不平；不同傳票相反差額不互相抵銷，資料不完整時尚不能定案。' : '按傳票識別逐張核對；缺識別、未載入或空母體不視為通過。同一列同時有借貸不會單獨判定錯誤。',voucherIssues,null,trustworthy && !missingVoucher.length && !unsafeVoucher ? groups.size : null));
    var sourceIssueCount = duplicate.length + missing.filter(function (r) { return duplicate.indexOf(r) < 0; }).length;
    controls.push(control('C03','重複分錄與來源識別',sourceIssueCount ? 'issue' : ledgerComplete ? 'pass' : 'unknown',
      '核對唯一分錄 ID、posting key、來源類型與 ID、傳票識別；同張單據有多條分錄本來合法，不按金額相同認定重複。',duplicate.concat(missing),null,ledgerComplete || sourceIssueCount ? sourceIssueCount : null));
    controls.push(control('C04','日期與金額有效性',invalid.length ? 'issue' : ledgerComplete ? 'pass' : 'unknown',
      '借貸須為非負且精確至分的金額；NULL、空白、非數值、超出精度或有效日期缺漏均須查明。貸餘額及合法同列借貸不屬負數輸入。',invalid,null,ledgerComplete || invalid.length ? invalid.length : null));
    var model = input.statementModel, modelCurrent = model && model.current;
    var statementScoped = !!(model && text(model.entityId) === entityId && text(model.period) === period && (!model.departmentCode || model.departmentCode === 'all') && model.completeness && model.completeness.complete === true);
    var canCompute = trustworthy && valid.length > 0 && !!statements, derived = canCompute ? statements.buildModel({entityId:entityId,period:period,ledger:statementRows(valid),accountMappings:profile.accountMappings || {},completeness:{complete:true},comparisonPeriod:null}) : null;
    var unclassified = valid.filter(function (r) { return !r.accountCode || accountClass(r,profile) === 'unclassified'; });
    var bs = modelCurrent && modelCurrent.bs, expectedBs = derived && derived.current.bs, bsKeys = ['assetTotal','liabTotal','equityTotal','balanceDifference'];
    var bsKnown = statementScoped && canCompute && !unclassified.length && bs && bsKeys.every(function (k) { return cents(bs[k]) !== null; });
    var bsMismatch = bsKnown && bsKeys.some(function (k) { return cents(bs[k]) !== cents(expectedBs[k]); });
    controls.push(control('C05','資產負債表與分類帳勾稽',bsKnown ? (bsMismatch || cents(bs.balanceDifference) !== 0 ? 'issue' : 'pass') : 'unknown',
      bsMismatch ? '傳入報表與相同法人、期間及科目映射的分類帳重算結果不同，需刷新來源。' : '核對資產＝負債＋權益及完整分類帳重算；未結轉損益仍為試算，並非已完成結帳或期初驗證。',[],bsKnown ? bs.balanceDifference : null,bsKnown ? valid.length : null));
    var cf = modelCurrent && modelCurrent.cf, cfKeys = ['start','net','end','bookEnd','reconciliationDifference'];
    var cfKnown = statementScoped && canCompute && cf && cfKeys.every(function (k) { return cents(cf[k]) !== null; });
    var cashPrior = valid.filter(function (r) { return r.date < bounds.start && statements.isCash(r.accountCode); }), cash = valid.filter(function (r) { return statements.isCash(r.accountCode); });
    var start = total(cashPrior,function(r){return r.debitCents-r.creditCents;}), end = total(cash,function(r){return r.debitCents-r.creditCents;});
    var cfMismatch = cfKnown && (start === null || end === null || cents(cf.start) !== start || cents(cf.bookEnd) !== end || cents(cf.end) !== end || cents(cf.net) !== end-start || cents(cf.reconciliationDifference) !== 0);
    var cashReview = cfKnown && ((cf.activities || []).some(function (r) { return r.class === 'unclassified'; }) || (cf.unpostedCashEvents || []).length > 0);
    controls.push(control('C06','現金期初、變動與期末勾稽',cfKnown ? (cfMismatch ? 'issue' : cashReview ? 'review' : 'pass') : 'unknown',
      '以正式現金分類帳驗算期初＋本期淨變動＝期末；未入帳現金事件及未分類活動另待覆核。這不是銀行對帳單調節或外部函證。',cash,cfKnown && end !== null ? money(cents(cf.end)-end) : null,cfKnown ? cash.length : null));
    var missingDept = active.filter(function (r) { return !r.departmentCode; }), badDimensions = Array.from(new Set(unclassified.concat(missingDept)));
    controls.push(control('C07','科目分類與部門識別',badDimensions.length ? 'issue' : ledgerComplete ? 'pass' : 'unknown',
      '檢查缺少科目、未分類科目及缺少部門代碼；不把目前停用的歷史科目視為錯誤。科目目錄、部門有效期間及允用範圍仍需正式設定佐證。',badDimensions,null,ledgerComplete || badDimensions.length ? badDimensions.length : null));
    var ar = input.receivables, arItems = ar && ar.items, recon = ar && ar.reconciliation;
    var arKnown = !!(ar && ar.complete === true && text(ar.entityId) === entityId && day(ar.asOf) === bounds.end && (!ar.departmentCode || ar.departmentCode === 'all') && Array.isArray(arItems) && integer(ar.totalCount) && ar.totalCount === arItems.length);
    var arValid = arKnown && arItems.every(function (r) { return r && text(r.invoiceId) && cents(r.outstandingAmount) !== null && (!r.entityId || r.entityId === entityId); }) && new Set(arItems.map(function (r) { return r.invoiceId; })).size === arItems.length;
    var reconFields = ['mappedLedgerNet','ledgerNet','unmappedLedgerNet','unmappedDebitAmount','unmappedCreditAmount','scopeDifference'];
    var reconKnown = arValid && recon && recon.reconciliationVisible === true && recon.reconciliationStatus === 'complete' && integer(recon.unmappedEntryCount) && reconFields.every(function (k) { return cents(recon[k]) !== null; });
    var arSum = arValid ? total(arItems,function(r){return cents(r.outstandingAmount);}) : null;
    var arProblem = reconKnown && (arSum === null || arSum !== cents(recon.mappedLedgerNet) || cents(recon.scopeDifference) !== 0 || recon.unmappedEntryCount > 0 || cents(recon.unmappedDebitAmount) !== 0 || cents(recon.unmappedCreditAmount) !== 0 || cents(recon.ledgerNet) !== cents(recon.mappedLedgerNet)+cents(recon.unmappedLedgerNet) || cents(recon.unmappedLedgerNet) !== cents(recon.unmappedDebitAmount)-cents(recon.unmappedCreditAmount));
    controls.push(control('C08','應收帳款與控制科目差異',reconKnown ? (arProblem ? 'issue' : 'pass') : 'unknown',
      '使用同法人、截止日且完整授權的正式應收；來源不明的借貸分開列示，即使 70 借／70 貸淨額為零仍待查明。未授權及缺少完整核對不當作零。',[],reconKnown ? recon.scopeDifference : null,reconKnown ? recon.unmappedEntryCount : null));
    var unknownDue = arValid ? arItems.filter(function (r) { return cents(r.outstandingAmount) > 0 && !day(r.dueDate); }) : [];
    var overdue = arValid ? arItems.filter(function (r) { return cents(r.outstandingAmount) > 0 && day(r.dueDate) && day(r.dueDate) < bounds.end; }) : [];
    var aging = control('C09','應收帳齡與到期日',arValid ? (unknownDue.length ? 'unknown' : overdue.length ? 'review' : 'pass') : 'unknown',
      '缺少到期日保留未知帳齡；逾期是可回收性覆核候選，不自動提列損失。期後今日不改寫案件截止日帳齡。',[],arValid ? money(total(unknownDue.length ? unknownDue : overdue,function(r){return cents(r.outstandingAmount);})) : null,arValid ? (unknownDue.length || overdue.length) : null);
    aging.sourceIds = arValid ? (unknownDue.length ? unknownDue : overdue).map(function (r) { return r.invoiceId; }) : []; aging.sourceLinks = aging.sourceIds.map(function (id) { return {sourceType:'invoice',sourceId:id}; }); controls.push(aging);
    var endMs = Date.parse(bounds.end+'T00:00:00Z'), candidates = valid.filter(function (r) { return r.date >= bounds.start; }).filter(function (r) {
      return r.manualEntry || ['manual','manual_journal','adjustment_voucher','journal_adjustment','reversal','closing_entry','year_end_close','period_close'].indexOf(r.sourceType) >= 0;
    }).map(function (r) { var periodEnd = endMs-Date.parse(r.date+'T00:00:00Z') <= 6*86400000; return {id:r.id,sourceType:r.sourceType,sourceId:r.sourceId,voucherNo:r.voucherNo,date:r.date,accountCode:r.accountCode,debit:r.debit,credit:r.credit,reasons:periodEnd ? ['人工或結帳分錄','期末最後七日'] : ['人工或結帳分錄'],population:'完整規則篩選候選；非審計抽樣結論'}; });
    var candidateIds = new Set(candidates.map(function(c){return c.id;}));
    controls.push(control('C10','人工及期末分錄覆核候選',candidates.length ? 'review' : ledgerComplete ? 'pass' : 'unknown',
      SAMPLING_NOTE+' 只依明確分錄類型與人工旗標，不從摘要文字推定舞弊。',valid.filter(function(r){return candidateIds.has(r.id);}),null,ledgerComplete || candidates.length ? candidates.length : null));
    var auditCase = input.auditCase || {}, items = pbcItems(auditCase,today), system = {pass:0,issue:0,unknown:0,review:0,total:controls.length}, internal = {pending:0,provided:0,reviewed:0,stale:0,total:items.length};
    controls.forEach(function(c){system[c.status]++;}); items.forEach(function(item){internal[item.effectiveStatus]++;});
    if (!text(auditCase.sourceFingerprint)) warnings.push('尚未取得伺服器來源指紋；內部覆核不能綁定目前資料版本。');
    if (invalid.length || duplicate.length) warnings.push('無效或重複分錄仍保留在來源索引；完整餘額暫不採信，不會靜默修正或刪除。');
    return {schemaVersion:1,templateVersion:1,title:'查帳準備底稿',scope:{entityId:entityId,period:period,start:bounds.start,end:bounds.end,today:today},
      sourceFingerprint:text(auditCase.sourceFingerprint),revision:integer(auditCase.revision)?auditCase.revision:null,sourceCounts:Object.assign({},auditCase.sourceCounts || {}),sourceState:sourceState,
      controls:controls,items:items,summary:{system:system,internalReview:internal},trialBalance:trialBalance(valid,bounds,trustworthy,profile),
      equityRollforward:equityRollforward(valid,bounds,trustworthy && valid.length > 0,profile),ledger:ledger,samplingCandidates:candidates,warnings:warnings,
      disclaimer:DISCLAIMER,samplingNote:SAMPLING_NOTE,engagementType:text((auditCase.caseData||{}).engagementType || 'both')};
  }
  function workbookSheets(model) {
    var intro = [['查帳準備與內部覆核底稿'],['法人',model.scope.entityId],['期間',model.scope.period],['起日',model.scope.start],['截止日',model.scope.end],
      ['來源指紋',model.sourceFingerprint || '尚未取得'],['案件版次',model.revision],['範本版次',model.templateVersion],['用途與限制',DISCLAIMER],['空白金額','未知或未證完整，不能當成零'],['候選限制',SAMPLING_NOTE]];
    function sheet(name, rows) { return {name:name,rows:intro.map(function(r){return r.slice();}).concat([[]],rows)}; }
    var eq = model.equityRollforward;
    return [
      sheet('說明與來源',[['來源','狀態','預期筆數','已讀筆數','指定範圍筆數','讀取時間']].concat(Object.keys(model.sourceState).map(function(k){var s=model.sourceState[k];return[k,s.complete?'完整':'未證完整',s.expectedCount,s.loadedCount,s.scopedCount,s.loadedAt];}),[[],['提醒']]).concat(model.warnings.map(function(w){return[w];}))),
      sheet('系統核對',[['檢核','項目','系統結果','說明','差額或待核對金額','筆數','分錄或單據 ID','來源類型與 ID']].concat(model.controls.map(function(c){return[c.id,c.title,c.status,c.message,c.amount,c.count,c.sourceIds.join('\n'),c.sourceLinks.map(function(s){return s.sourceType+':'+s.sourceId;}).join('\n')];}))),
      sheet('索資與內部覆核',[['編號','待提供資料','範圍','適用性','負責人','期限','內部有效狀態','證據索引','備註','來源連結','提供人','提供時間','覆核人','覆核時間','覆核來源指紋','重新覆核原因']].concat(model.items.map(function(i){return[i.id,i.title,i.description,i.applicability,i.ownerId,i.dueDate,i.effectiveStatus,i.evidenceReference,i.notes,i.sourceLinks.map(function(s){return s.sourceType+':'+s.sourceId;}).join('\n'),i.preparedBy,i.preparedAt,i.reviewedBy,i.reviewedAt,i.reviewedFingerprint,i.staleReason];}))),
      sheet('科目試算表',[['科目','名稱','分類','餘額完整','期初借方','期初貸方','本期借方','本期貸方','期末借方','期末貸方','觀察期初淨額','觀察本期借方','觀察本期貸方','觀察期末淨額','分類帳 ID']].concat(model.trialBalance.map(function(r){return[r.accountCode,r.accountName,r.statementClass,r.complete?'完整':'未證完整',r.openingDebit,r.openingCredit,r.periodDebit,r.periodCredit,r.closingDebit,r.closingCredit,r.observedOpeningBalance,r.observedPeriodDebit,r.observedPeriodCredit,r.observedClosingBalance,r.sourceIds.join('\n')];}))),
      sheet('權益調節底稿',[['狀態',eq.status],['限制',eq.message],['項目','金額'],['期初權益含未結轉損益',eq.openingEquity],['本期損益',eq.currentProfit],['本期 OCI',eq.currentOci],['其他權益變動待分類',eq.otherEquityMovement],['結帳分錄對整體權益淨影響',eq.closingEntryNetEffect],['推算期末權益',eq.expectedClosingEquity],['帳上期末權益含未結轉損益',eq.closingEquity],['差額',eq.difference],['已入帳權益科目變動（備查，不重複相加）',eq.postedEquityMovement],[],['分錄 ID','科目','金額','分類','來源類型','來源 ID']].concat(eq.movements.map(function(r){return[r.id,r.accountCode,r.amount,r.category,r.sourceType,r.sourceId];}))),
      sheet('分類帳來源索引',[['ID','法人','日期','原日期','科目','名稱','部門','借方','貸方','傳票 ID','傳票號','來源類型','來源 ID','來源單號','Posting key','摘要','作廢時間','無效金額']].concat(model.ledger.map(function(r){return[r.id,r.entityId,r.date,r.originalDate,r.accountCode,r.accountName,r.departmentCode,r.debit,r.credit,r.voucherId,r.voucherNo,r.sourceType,r.sourceId,r.referenceNo,r.postingKey,r.description,r.voidedAt,r.invalidAmount?'是':'否'];}))),
      sheet('人工分錄風險候選',[['分類帳 ID','日期','傳票','科目','借方','貸方','來源類型','來源 ID','篩選理由']].concat(model.samplingCandidates.map(function(r){return[r.id,r.date,r.voucherNo,r.accountCode,r.debit,r.credit,r.sourceType,r.sourceId,r.reasons.join('；')];})))
    ];
  }
  var api = Object.freeze({buildModel:buildModel,workbookSheets:workbookSheets,templates:function(){return TEMPLATES.map(function(t){return{id:t[0],title:t[1],description:t[2]};});}});
  global.FinanceAuditReadinessEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
