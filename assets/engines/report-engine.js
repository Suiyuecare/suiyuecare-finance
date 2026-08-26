(function (global) {
  'use strict';

  function money(value) {
    var n = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function sum(rows, picker) {
    return (rows || []).reduce(function (total, row) {
      return total + money(typeof picker === 'function' ? picker(row) : row && row[picker]);
    }, 0);
  }

  function groupBy(rows, picker) {
    return (rows || []).reduce(function (groups, row) {
      var key = typeof picker === 'function' ? picker(row) : row && row[picker];
      key = key == null || key === '' ? 'unknown' : String(key);
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
      return groups;
    }, Object.create(null));
  }

  function callOption(options, key, fallback) {
    options = options || {};
    return typeof options[key] === 'function' ? options[key] : fallback;
  }

  function identity(value) {
    return value;
  }

  function htmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statementPeriodLabel(period) {
    period = String(period || '');
    if (/^\d{4}-\d{2}$/.test(period)) return period.slice(0, 4) + '年' + Number(period.slice(5, 7)) + '月';
    if (/^\d{4}-Q[1-4]$/.test(period)) return period.slice(0, 4) + '年' + period.slice(5);
    if (/^\d{4}$/.test(period)) return period + '年全年';
    return period || '目前期間';
  }

  function reportMonths(range, basePeriod, options) {
    options = options || {};
    var todayMonth = callOption(options, 'todayMonth', function () {
      var date = new Date();
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    });
    var count = { '3m': 3, '6m': 6, '12m': 12 }[range] || 3;
    var base = String(basePeriod || todayMonth() || '').trim();
    if (!/^\d{4}-\d{2}$/.test(base)) base = todayMonth();
    var y = Number(base.slice(0, 4));
    var m = Number(base.slice(5, 7));
    var out = [];
    for (var i = count - 1; i >= 0; i -= 1) {
      var d = new Date(y, m - 1 - i, 1);
      out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    return out;
  }

  function statementCashBookBalance(rows, options) {
    options = options || {};
    var isCashAccount = callOption(options, 'isCashAccount', function () { return false; });
    var isDuplicate = callOption(options, 'isDuplicateRequestCashLedger', function () { return false; });
    var debit = callOption(options, 'debit', function (row) { return row && row.dr; });
    var credit = callOption(options, 'credit', function (row) { return row && row.cr; });
    return (rows || []).filter(function (row) {
      return isCashAccount((row && (row.ac || row.account || row.account_code)) || '', row) && !isDuplicate(row);
    }).reduce(function (total, row) {
      return total + money(debit(row)) - money(credit(row));
    }, 0);
  }

  function expenseStatementDate(row, options) {
    options = options || {};
    var normalizeDate = callOption(options, 'normalizeDate', identity);
    var ledgerPostedAt = callOption(options, 'ledgerPostedAt', function () { return ''; });
    var cashPostedAt = callOption(options, 'cashPostedAt', function () { return ''; });
    row = row || {};
    return normalizeDate(ledgerPostedAt(row) || cashPostedAt(row) || row.expectedPayDate || row.date || row.request_date || row.createdAt || row.created_at);
  }

  function expenseStatementAmount(row, options) {
    options = options || {};
    var cashPostedAt = callOption(options, 'cashPostedAt', function () { return ''; });
    var cashAmount = callOption(options, 'cashAmount', function (r) { return money(r && (r.actualAmt || r.actual_amount || r.amt || r.amount)); });
    var fundingBaseAmount = callOption(options, 'fundingBaseAmount', function (r) { return money(r && (r.actualAmt || r.actual_amount || r.amt || r.amount)); });
    row = row || {};
    if (cashPostedAt(row)) return money(cashAmount(row));
    return money(row.actualAmt || row.actual_amount || row.amt || row.amount || fundingBaseAmount(row));
  }

  function expenseStatementTypeLabel(row, options) {
    options = options || {};
    var requestTypeLabel = callOption(options, 'requestTypeLabel', function (type) { return String(type || '一般支出'); });
    return (row && row.tL) || requestTypeLabel(row && row.type) || String((row && row.type) || '一般支出');
  }

  function expenseStatementApplicant(row) {
    var payload = (row && row.formPayload) || (row && row.form_payload) || {};
    var profile = payload.applicantProfile || {};
    return (row && row.app) || (row && row.applicant) || profile.name || profile.displayName || '未填申請人';
  }

  function expenseStatementCandidate(row, options) {
    options = options || {};
    var isDone = callOption(options, 'isDone', function () { return false; });
    var cashPostedAt = callOption(options, 'cashPostedAt', function () { return ''; });
    var ledgerPostedAt = callOption(options, 'ledgerPostedAt', function () { return ''; });
    if (!row || row.status === 'rejected' || row.status === 'cancelled') return false;
    return !!(isDone(row) || cashPostedAt(row) || ledgerPostedAt(row) || row.voucherId || row.voucher_id);
  }

  function emptyGapBucket() {
    return { count: 0, total: 0 };
  }

  function bumpGapBucket(bucket, amount) {
    bucket.count += 1;
    bucket.total += money(amount);
    return bucket;
  }

  function expenseStatementGapRows(summary) {
    return (summary && summary.rows || []).slice().sort(function (a, b) {
      return money(b.amount) - money(a.amount);
    });
  }

  function reportDataCompletenessSummary(eid, period, datasets, options) {
    datasets = datasets || {};
    options = options || {};
    var active = callOption(options, 'inActiveDataEnvironment', function () { return true; });
    var inPeriod = callOption(options, 'inPeriod', function (value, currentPeriod) {
      if (!currentPeriod || currentPeriod === 'all') return true;
      return String(value || '').slice(0, String(currentPeriod).length) === String(currentPeriod);
    });
    var entityOf = callOption(options, 'entityOf', function (row) { return row && row.eid; });

    function rows(name) {
      return Array.isArray(datasets[name]) ? datasets[name] : [];
    }

    function inScope(row, dateKey) {
      if (!row || !active(row)) return false;
      if (eid && eid !== 'all' && String(entityOf(row) || '') !== String(eid)) return false;
      if (!dateKey) return true;
      return inPeriod(row[dateKey] || '', period);
    }

    var bankAccounts = rows('bankAccounts').filter(function (account) {
      return inScope(account);
    });
    var bankTransactions = rows('bankTransactions').filter(function (tx) {
      return inScope(tx, 'date');
    });
    var bankStatementImports = rows('bankStatementImports').filter(function (item) {
      if (!inScope(item)) return false;
      return !period || period === 'all' || item.statementPeriod === period || inPeriod(item.importedAt || '', period);
    });
    var periodCloses = rows('periodCloses').filter(function (close) {
      return inScope(close) && close.period === period && close.status === 'closed';
    });
    var warnings = [];
    if (!bankAccounts.length) warnings.push('尚未設定銀行帳戶');
    if (!bankTransactions.length) warnings.push('本期間尚無銀行交易明細');
    if (!bankStatementImports.length) warnings.push('本期間尚無銀行匯入批次');
    if (!periodCloses.length) warnings.push('本期間尚未月結');
    return {
      bankAccounts: bankAccounts.length,
      bankTxs: bankTransactions.length,
      bankImports: bankStatementImports.length,
      closed: periodCloses.length > 0,
      warnings: warnings,
    };
  }

  function bucket(value) {
    value = value || {};
    return {
      count: money(value.count),
      total: money(value.total),
      net: money(value.net),
    };
  }

  function statementInvestorStats(input, options) {
    input = input || {};
    options = options || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var b = input.b || {};
    var revRows = Array.isArray(input.revRows) ? input.revRows : [];
    var expRows = Array.isArray(input.expRows) ? input.expRows : [];
    var cf = input.cf || {};
    var tb = input.tb || {};
    var bridge = input.bridge || {};
    var expenseGap = input.expenseGap || {};
    var data = input.data || {};
    var totalRev = sum(revRows, 'v');
    var totalExp = sum(expRows, 'v');
    var net = totalRev - totalExp;
    var assetTotal = money(b.assetTotal);
    var liabTotal = money(b.liabTotal);
    var equityTotal = money(b.equityTotal);
    var balanceDiff = assetTotal - (liabTotal + equityTotal);
    var debtRatio = assetTotal ? liabTotal / assetTotal * 100 : 0;
    var margin = totalRev ? net / totalRev * 100 : 0;
    var issues = [];
    var bridgeNotPosted = bucket(bridge.notPosted);
    var bridgeRevenueMismatch = bucket(bridge.revenueAmountMismatch);
    var bridgeCashMismatch = bucket(bridge.cashAmountMismatch);
    var bridgePaidNoCash = bucket(bridge.paidNoCash);
    var expenseNotPosted = bucket(expenseGap.notPosted);
    var expenseHrNotPosted = bucket(expenseGap.hrNotPosted);
    var expenseCashPostedNoLedger = bucket(expenseGap.cashPostedNoLedger);
    var warnings = Array.isArray(data.warnings) ? data.warnings : [];

    if (!money(input.ledgerRowCount)) {
      issues.push({ level: 'bad', title: '本期沒有正式分類帳分錄', detail: '三表沒有可供投資人查核的本期入帳來源。' });
    }
    if (!tb.ok && Array.isArray(tb.checks)) {
      tb.checks.filter(function (check) { return !check.pass; }).slice(0, 4).forEach(function (check) {
        issues.push({ level: 'bad', title: check.name + '異常', detail: '差額 ' + format(check.diff) + '。' + check.desc });
      });
    }
    if (Math.abs(balanceDiff) >= 0.5) {
      issues.push({ level: 'bad', title: '資產負債表不平', detail: '資產與負債加權益差額 ' + format(balanceDiff) + '，需要先查分類帳。' });
    }
    if (bridgeNotPosted.count) {
      issues.push({ level: 'warn', title: '發票尚未進三表', detail: bridgeNotPosted.count + ' 筆，含稅 ' + format(bridgeNotPosted.total) + '；損益表不會先補估這些收入。' });
    }
    if (bridgeRevenueMismatch.count) {
      issues.push({ level: 'bad', title: '收入分錄金額與發票不符', detail: bridgeRevenueMismatch.count + ' 筆，合計 ' + format(bridgeRevenueMismatch.total) + '。' });
    }
    if (bridgeCashMismatch.count) {
      issues.push({ level: 'bad', title: '收款分錄金額與發票不符', detail: bridgeCashMismatch.count + ' 筆，合計 ' + format(bridgeCashMismatch.total) + '。' });
    }
    if (bridgePaidNoCash.count) {
      issues.push({ level: 'warn', title: '已收款但未入現金流', detail: bridgePaidNoCash.count + ' 筆發票已標記收款，但現金流分類帳尚未完整。' });
    }
    if (expenseNotPosted.count) {
      issues.push({ level: 'warn', title: '支出尚未進三表', detail: expenseNotPosted.count + ' 筆，合計 ' + format(expenseNotPosted.total) + '；其中人事費用 ' + expenseHrNotPosted.count + ' 筆 ' + format(expenseHrNotPosted.total) + '。' });
    }
    if (expenseCashPostedNoLedger.count) {
      issues.push({ level: 'bad', title: '已付款但缺正式分類帳', detail: expenseCashPostedNoLedger.count + ' 筆已付款支出沒有正式分類帳，三表支出與現金流會偏低。' });
    }
    if (net > 0 && money(cf.net) < 0) {
      issues.push({ level: 'warn', title: '帳面獲利但現金流出', detail: '本期損益 ' + format(net) + '，但現金淨流出 ' + format(Math.abs(money(cf.net))) + '，需看應收、預付或付款時點。' });
    }
    if (net < 0 && money(cf.net) > 0) {
      issues.push({ level: 'warn', title: '帳面虧損但現金流入', detail: '本期損益 ' + format(net) + '，但現金淨流入 ' + format(money(cf.net)) + '，需確認是否為借款、股東往來或收回舊款。' });
    }
    if (totalRev && totalExp / totalRev > 0.9) {
      issues.push({ level: 'warn', title: '費用吃掉收入比例偏高', detail: '費用約佔收入 ' + (totalExp / totalRev * 100).toFixed(1) + '%，投資人會想看支出科目 Top。' });
    }
    warnings.forEach(function (warning) {
      issues.push({ level: 'warn', title: '報表輔助資料待補', detail: warning + '，會影響現金與月結可信度。' });
    });

    var bad = issues.filter(function (issue) { return issue.level === 'bad'; }).length;
    var warn = issues.filter(function (issue) { return issue.level === 'warn'; }).length;
    return {
      b: b,
      revRows: revRows,
      expRows: expRows,
      cf: cf,
      tb: tb,
      bridge: bridge,
      expenseGap: expenseGap,
      data: data,
      totalRev: totalRev,
      totalExp: totalExp,
      net: net,
      margin: margin,
      assetTotal: assetTotal,
      liabTotal: liabTotal,
      equityTotal: equityTotal,
      balanceDiff: balanceDiff,
      cashBalance: money(input.cashBalance),
      debtRatio: debtRatio,
      issues: issues,
      bad: bad,
      warn: warn,
      status: bad ? 'bad' : (warn ? 'warn' : 'ok'),
    };
  }

  function statementVerdictLabel(status) {
    return status === 'ok' ? '三表目前可做經營判讀' : (status === 'bad' ? '三表需先修正再判讀' : '三表可看，但要帶著疑點查');
  }

  function statementChartNarrative(period, stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var periodLabel = callOption(options, 'periodLabel', statementPeriodLabel);
    var netLabel = money(stats.net) >= 0 ? '賺錢' : '虧損';
    var cashNet = money(stats.cf && stats.cf.net);
    var cashLabel = cashNet >= 0 ? '現金增加' : '現金減少';
    return {
      title: periodLabel(period) + ' 結論',
      body: '本期' + netLabel + ' ' + format(Math.abs(money(stats.net))) + '，' + cashLabel + ' ' + format(Math.abs(cashNet)) + '。如果損益與現金方向不一致，通常要追應收款、預付款、借款或付款時點。',
    };
  }

  function statementStructureModel(stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var pieRows = [
      { name: '負債', v: Math.max(0, money(stats.liabTotal)), color: '#f97316' },
      { name: '權益', v: Math.max(0, money(stats.equityTotal)), color: '#16a34a' },
    ];
    if (!pieRows.some(function (row) { return row.v > 0.4; })) {
      pieRows = [
        { name: '收入', v: Math.max(0, money(stats.totalRev)), color: '#ea880c' },
        { name: '支出', v: Math.max(0, money(stats.totalExp)), color: '#b0d8f8' },
      ];
    }
    return {
      pieRows: pieRows,
      note: '資產 ' + format(stats.assetTotal) + '，由負債 ' + format(stats.liabTotal) + ' 與權益 ' + format(stats.equityTotal) + ' 支撐；負債比 ' + money(stats.debtRatio).toFixed(1) + '%。若圓餅比例異常，先看資產負債表是否平衡與股東往來。',
    };
  }

  function statementDiagnostics(stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var tb = stats.tb || {};
    var bridge = stats.bridge || {};
    var expenseGap = stats.expenseGap || {};
    var data = stats.data || {};
    var bridgeNotPosted = bucket(bridge.notPosted);
    var bridgeRevenueMismatch = bucket(bridge.revenueAmountMismatch);
    var bridgeCashMismatch = bucket(bridge.cashAmountMismatch);
    var expenseNotPosted = bucket(expenseGap.notPosted);
    var expenseHrNotPosted = bucket(expenseGap.hrNotPosted);
    var expenseCashPostedNoLedger = bucket(expenseGap.cashPostedNoLedger);
    var posted = bucket(bridge.posted);
    var cash = bucket(bridge.cash);
    var warnings = Array.isArray(data.warnings) ? data.warnings : [];
    var bridgeLevel = bridgeNotPosted.count || bridgeRevenueMismatch.count || bridgeCashMismatch.count ? (bridgeRevenueMismatch.count || bridgeCashMismatch.count ? 'bad' : 'warn') : 'ok';
    var expenseLevel = expenseCashPostedNoLedger.count ? 'bad' : (expenseNotPosted.count ? 'warn' : 'ok');
    var healthLevel = warnings.length ? 'warn' : 'ok';
    var tbLevel = tb.ok ? 'ok' : 'bad';
    var cashGap = Math.max(0, posted.total - cash.total);
    return [
      { label: '三表試算平衡', value: tb.ok ? '通過' : '需檢查', sub: '本期借貸差額 ' + format(money(tb.periodDebit) - money(tb.periodCredit)), level: tbLevel },
      { label: '發票橋接', value: bridgeNotPosted.count + ' 筆待入', sub: '未入三表含稅 ' + format(bridgeNotPosted.total), level: bridgeLevel },
      { label: '支出入帳缺口', value: expenseNotPosted.count + ' 筆待入', sub: '人事 ' + expenseHrNotPosted.count + ' 筆；金額 ' + format(expenseNotPosted.total), level: expenseLevel },
      { label: '收款現金流', value: format(cashGap), sub: '已入帳但尚未轉現金流的可能差額', level: cashGap ? 'warn' : 'ok' },
      { label: '資料完整度', value: warnings.length ? '需補 ' + warnings.length + ' 項' : '正常', sub: warnings.slice(0, 2).join('、') || '銀行、月結、輔助資料未見主要缺口', level: healthLevel },
    ];
  }

  function statementMoneyRows(stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var tb = stats.tb || {};
    var bridge = stats.bridge || {};
    var expenseGap = stats.expenseGap || {};
    var data = stats.data || {};
    var bridgeNotPosted = bucket(bridge.notPosted);
    var expenseNotPosted = bucket(expenseGap.notPosted);
    var warnings = Array.isArray(data.warnings) ? data.warnings : [];
    return [
      { name: '本期借貸差額', amount: format(money(tb.periodDebit) - money(tb.periodCredit)), detail: '正式分類帳本期借貸是否平衡。', level: Math.abs(money(tb.periodDebit) - money(tb.periodCredit)) > 0.5 ? 'bad' : '' },
      { name: '資產負債差額', amount: format(stats.balanceDiff), detail: '資產總額與負債加權益的差距。', level: Math.abs(money(stats.balanceDiff)) > 0.5 ? 'bad' : '' },
      { name: '發票未入三表', amount: bridgeNotPosted.count + ' 筆 · ' + format(bridgeNotPosted.net), detail: '這是損益表收入真正還沒認列的未稅金額。', level: bridgeNotPosted.count ? 'warn' : '' },
      { name: '支出未入三表', amount: expenseNotPosted.count + ' 筆 · ' + format(expenseNotPosted.total), detail: '已付款/已完成但還沒找到正式分類帳；三表不會補估支出。', level: expenseNotPosted.count ? 'warn' : '' },
      { name: '銀行 / 月結輔助', amount: warnings.length ? warnings.length + ' 項待補' : '已補齊', detail: warnings.join('、') || '銀行帳戶、交易匯入與月結輔助資料目前沒有主要缺口。', level: warnings.length ? 'warn' : '' },
    ];
  }

  function statementVerdictModel(entityName, periodText, stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var label = statementVerdictLabel(stats.status);
    return {
      label: label,
      body: entityName + ' · ' + periodText + '：收入 ' + format(stats.totalRev) + '、支出 ' + format(stats.totalExp) + '、本期損益 ' + format(stats.net) + '；期末現金 ' + format(stats.cf && stats.cf.end) + '。資產 ' + format(stats.assetTotal) + '，負債加權益 ' + format(money(stats.liabTotal) + money(stats.equityTotal)) + '，差額 ' + format(stats.balanceDiff) + '。' + (stats.status === 'ok' ? ' 目前借貸、發票入帳與資料完整度沒有明顯紅旗。' : ' 下方列出投資人會先追問的缺口，建議照順序查。'),
    };
  }

  function statementFlowRows(stats, options) {
    options = options || {};
    stats = stats || {};
    var format = callOption(options, 'format', function (value) { return String(value); });
    var bridge = stats.bridge || {};
    var bridgePosted = bucket(bridge.posted);
    var bridgeNotPosted = bucket(bridge.notPosted);
    var bridgeCash = bucket(bridge.cash);
    var cashGap = Math.max(0, bridgePosted.total - bridgeCash.total);
    return [
      { title: '1. 發票與收入', lines: ['已進三表 ' + bridgePosted.count + ' 筆；尚未進三表 ' + bridgeNotPosted.count + ' 筆。', '損益表只認未稅收入，不拿發票含稅額硬補。'] },
      { title: '2. 損益表', lines: ['收入 ' + format(stats.totalRev) + ' - 支出 ' + format(stats.totalExp) + ' = ' + format(stats.net) + '。', '用來看有沒有真的賺錢。'] },
      { title: '3. 資產負債表', lines: ['資產 ' + format(stats.assetTotal) + '；負債 ' + format(stats.liabTotal) + '；權益 ' + format(stats.equityTotal) + '。', '用來看錢、應收與負債結構。'] },
      { title: '4. 現金流量表', lines: ['本期現金淨變動 ' + (money(stats.cf && stats.cf.net) >= 0 ? '+' : '') + format(stats.cf && stats.cf.net) + '；期末 ' + format(stats.cf && stats.cf.end) + '。', '已入帳但未收款差額 ' + format(cashGap) + '。'] },
    ];
  }

  function statementInvestorCardHtml(label, value, sub, color, options) {
    var escape = callOption(options, 'escape', htmlEscape);
    return '<div class="statement-investor-card"><div class="statement-investor-label">' + escape(label) + '</div><div class="statement-investor-value" style="color:' + escape(color || '#172033') + '">' + escape(value) + '</div><div class="statement-investor-sub">' + escape(sub || '') + '</div></div>';
  }

  function statementMoneyRowHtml(row, options) {
    row = row || {};
    var escape = callOption(options, 'escape', htmlEscape);
    return '<div class="statement-money-row ' + escape(row.level || '') + '"><div><div class="statement-money-name">' + escape(row.name) + '</div><div>' + escape(row.detail || '') + '</div></div><div class="statement-money-amount">' + escape(row.amount) + '</div></div>';
  }

  function statementDiagnosticChipHtml(label, value, sub, level, options) {
    var escape = callOption(options, 'escape', htmlEscape);
    return '<div class="statement-diagnostic-chip ' + escape(level || '') + '"><div class="statement-diagnostic-label">' + escape(label) + '</div><div class="statement-diagnostic-value">' + escape(value) + '</div><div class="statement-diagnostic-sub">' + escape(sub || '') + '</div></div>';
  }

  function statementRankListHtml(items, kind, options) {
    options = options || {};
    items = Array.isArray(items) ? items : [];
    var escape = callOption(options, 'escape', htmlEscape);
    var format = callOption(options, 'format', function (value) { return String(value); });
    var traceActionHtml = callOption(options, 'traceActionHtml', function () { return ''; });
    var deptActionHtml = callOption(options, 'deptActionHtml', function () { return ''; });
    var emptyHtml = options.emptyHtml || '<div style="font-size:11px;color:#94a3b8;padding:8px">目前沒有資料。</div>';
    if (!items.length) return emptyHtml;
    var max = Math.max.apply(null, items.map(function (item) { return Math.abs(money(item && item.v)); })) + 1;
    return items.slice(0, 8).map(function (item) {
      item = item || {};
      var key = item.key == null ? '' : item.key;
      var p = Math.max(3, Math.round(Math.abs(money(item.v)) / max * 100));
      var action = '';
      if (kind === 'revenue' || kind === 'expense') action = traceActionHtml(kind, key) || '';
      if (kind === 'dept') action = deptActionHtml(item.dc || key) || '';
      return '<div class="statement-rank-row"><div class="statement-rank-name">' + escape(item.n || item.label || key) + '</div><div class="statement-rank-amount">' + escape(format(item.v)) + '</div><div class="statement-rank-bar"><div class="statement-rank-fill" style="width:' + p + '%"></div></div><div style="grid-column:1/-1">' + action + '</div></div>';
    }).join('');
  }

  function renderStatementPie(canvas, legend, rows, options) {
    options = options || {};
    rows = (rows || []).filter(function (row) { return Math.abs(money(row && row.v)) > 0.4; });
    var total = rows.reduce(function (count, row) { return count + Math.abs(money(row && row.v)); }, 0);
    var escape = callOption(options, 'escape', htmlEscape);
    var format = callOption(options, 'format', function (value) { return String(value); });
    if (!total) {
      if (canvas) {
        var emptyCtx = canvas.getContext && canvas.getContext('2d');
        if (emptyCtx) {
          var ew = canvas.width;
          var eh = canvas.height;
          var ecx = ew / 2;
          var ecy = eh / 2;
          var er = Math.min(ew, eh) / 2 - 16;
          emptyCtx.clearRect(0, 0, ew, eh);
          emptyCtx.beginPath();
          emptyCtx.arc(ecx, ecy, er, 0, Math.PI * 2);
          emptyCtx.fillStyle = '#f8f0e4';
          emptyCtx.fill();
          emptyCtx.beginPath();
          emptyCtx.arc(ecx, ecy, er * 0.58, 0, Math.PI * 2);
          emptyCtx.fillStyle = '#fffdf9';
          emptyCtx.fill();
          emptyCtx.fillStyle = '#8b7358';
          emptyCtx.font = '700 16px sans-serif';
          emptyCtx.textAlign = 'center';
          emptyCtx.textBaseline = 'middle';
          emptyCtx.fillText('無資料', ecx, ecy);
        }
      }
      if (legend) legend.innerHTML = '<div style="font-size:11px;color:#94a3b8">目前沒有可視覺化的比例資料。</div>';
      return;
    }
    if (canvas && canvas.getContext) {
      var ctx = canvas.getContext('2d');
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var r = Math.min(w, h) / 2 - 14;
      var start = -Math.PI / 2;
      ctx.clearRect(0, 0, w, h);
      rows.forEach(function (row) {
        var slice = Math.abs(money(row && row.v)) / total * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + slice);
        ctx.closePath();
        ctx.fillStyle = (row && row.color) || '#ea880c';
        ctx.fill();
        start += slice;
      });
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf9';
      ctx.fill();
      ctx.fillStyle = '#263244';
      ctx.font = '700 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('100%', cx, cy - 4);
      ctx.fillStyle = '#8b7358';
      ctx.font = '600 11px sans-serif';
      ctx.fillText('資金來源', cx, cy + 16);
    }
    if (legend) {
      legend.innerHTML = rows.map(function (row) {
        row = row || {};
        var pct = Math.abs(money(row.v)) / total * 100;
        return '<div class="statement-legend-row"><span class="statement-legend-dot" style="background:' + escape(row.color || '#ea880c') + '"></span><span class="statement-legend-name">' + escape(row.name) + '</span><span class="statement-legend-value">' + escape(format(row.v)) + ' · ' + pct.toFixed(1) + '%</span></div>';
      }).join('');
    }
  }

  function resetChartBars(barGroups) {
    (barGroups || []).forEach(function (group) {
      if (!group) return;
      if (group._b1) {
        group._b1.style.filter = '';
        group._b1.style.transform = '';
      }
      if (group._b2) {
        group._b2.style.filter = '';
        group._b2.style.transform = '';
      }
      if (group._bars) group._bars.style.filter = '';
      if (group._lbl) {
        group._lbl.style.color = '#94a3b8';
        group._lbl.style.fontWeight = '';
      }
    });
  }

  function renderInteractiveChart(container, config, options) {
    options = options || {};
    config = config || {};
    var doc = global.document;
    if (!container || !doc) return;
    var labels = Array.isArray(config.labels) ? config.labels : [];
    var arr1 = Array.isArray(config.arr1) ? config.arr1 : [];
    var arr2 = Array.isArray(config.arr2) ? config.arr2 : [];
    var netArr = Array.isArray(config.netArr) ? config.netArr : [];
    var label1 = config.label1 || '收入';
    var label2 = config.label2 || '支出';
    var col1 = config.col1 || '#ea880c';
    var col2 = config.col2 || '#b0d8f8';
    var format = callOption(options, 'format', function (value) { return String(value); });
    var max1 = Math.max.apply(null, arr1.concat([1]));
    var max2 = Math.max.apply(null, arr2.concat([1]));
    var maxVal = Math.max(max1, max2) || 1;
    container.innerHTML = '';
    container.style.position = 'relative';

    var tip = doc.createElement('div');
    tip.style.cssText = 'position:absolute;background:#1e293b;color:#fff;border-radius:8px;padding:9px 13px;font-size:11px;pointer-events:none;display:none;z-index:10;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.25);line-height:1.7;transition:opacity .15s';
    container.appendChild(tip);

    var wrap = doc.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:flex-end;gap:0;padding:0 8px 0 8px;height:190px;position:relative';
    var yAxis = doc.createElement('div');
    yAxis.style.cssText = 'display:flex;flex-direction:column-reverse;justify-content:space-between;height:150px;margin-right:6px;padding-bottom:28px;flex-shrink:0';
    for (var yi = 0; yi <= 4; yi += 1) {
      var yLbl = doc.createElement('div');
      yLbl.style.cssText = 'font-size:9px;color:#a08060;text-align:right;white-space:nowrap';
      yLbl.textContent = Math.round(maxVal * yi / 4 / 1000) + 'K';
      yAxis.appendChild(yLbl);
    }
    wrap.appendChild(yAxis);

    var lineCanvas = doc.createElement('canvas');
    lineCanvas.style.cssText = 'position:absolute;bottom:28px;left:0;right:0;pointer-events:none;z-index:3';
    lineCanvas.height = 150;
    wrap.appendChild(lineCanvas);
    var barGroups = [];
    var activeIdx = [-1];

    labels.forEach(function (lb, i) {
      var grp = doc.createElement('div');
      grp.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:0;cursor:pointer;position:relative;';
      grp.dataset.idx = i;
      var bars = doc.createElement('div');
      bars.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:150px;width:100%;justify-content:center;transition:filter .15s;';
      var b1 = doc.createElement('div');
      var h1 = Math.round(money(arr1[i]) / maxVal * 136);
      b1.style.cssText = 'width:38%;background:' + col1 + ';border-radius:3px 3px 0 0;height:' + h1 + 'px;min-height:2px;transition:height .25s cubic-bezier(.34,1.56,.64,1),filter .15s,transform .15s;transform-origin:bottom center;';
      var b2 = doc.createElement('div');
      var h2 = Math.round(money(arr2[i]) / maxVal * 136);
      b2.style.cssText = 'width:38%;background:' + col2 + ';border-radius:3px 3px 0 0;height:' + h2 + 'px;min-height:2px;transition:height .25s cubic-bezier(.34,1.56,.64,1),filter .15s,transform .15s;transform-origin:bottom center;';
      bars.appendChild(b1);
      bars.appendChild(b2);
      var lbl = doc.createElement('div');
      lbl.style.cssText = 'font-size:9px;color:#94a3b8;margin-top:5px;height:18px;display:flex;align-items:center;transition:color .15s,font-weight .15s';
      lbl.textContent = lb;
      grp.appendChild(bars);
      grp.appendChild(lbl);
      grp._b1 = b1;
      grp._b2 = b2;
      grp._lbl = lbl;
      grp._bars = bars;
      grp.addEventListener('click', function (ev) {
        var idx = parseInt(this.dataset.idx, 10);
        if (activeIdx[0] === idx) {
          activeIdx[0] = -1;
          resetChartBars(barGroups);
          tip.style.display = 'none';
          return;
        }
        activeIdx[0] = idx;
        resetChartBars(barGroups);
        var g = barGroups[idx];
        if (!g) return;
        g._b1.style.filter = 'brightness(1.2) drop-shadow(0 0 4px ' + col1 + '88)';
        g._b1.style.transform = 'scaleY(1.06)';
        g._b2.style.filter = 'brightness(1.2) drop-shadow(0 0 4px ' + col2 + '88)';
        g._b2.style.transform = 'scaleY(1.06)';
        g._bars.style.filter = 'drop-shadow(0 2px 8px rgba(0,0,0,.18))';
        g._lbl.style.color = 'var(--brtxt)';
        g._lbl.style.fontWeight = '600';
        var net = money(netArr[idx]);
        tip.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:5px">20' + htmlEscape(String(lb).replace('/', '/')) + '</div>'
          + '<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:' + col1 + '">● ' + htmlEscape(label1) + '</span><span style="font-weight:600">' + htmlEscape(format(arr1[idx])) + '</span></div>'
          + '<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:' + col2 + '">● ' + htmlEscape(label2) + '</span><span style="font-weight:600">' + htmlEscape(format(arr2[idx])) + '</span></div>'
          + '<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.15)"><span style="color:' + (net >= 0 ? '#4ade80' : '#f87171') + '">● 淨額</span><span style="font-weight:600;color:' + (net >= 0 ? '#4ade80' : '#f87171') + '">' + (net >= 0 ? '+' : '') + htmlEscape(format(net)) + '</span></div>';
        tip.style.display = 'block';
        var rect = grp.getBoundingClientRect();
        var cRect = container.getBoundingClientRect();
        var tx = rect.left - cRect.left + rect.width / 2 - 75;
        if (tx < 0) tx = 0;
        if (tx + 160 > cRect.width) tx = cRect.width - 160;
        tip.style.left = tx + 'px';
        tip.style.top = '2px';
        ev.stopPropagation();
      });
      wrap.appendChild(grp);
      barGroups.push(grp);
    });
    container.appendChild(wrap);
    container.addEventListener('click', function () {
      resetChartBars(barGroups);
      tip.style.display = 'none';
    });

    function drawLine() {
      lineCanvas.width = wrap.offsetWidth || 600;
      var ctx = lineCanvas.getContext && lineCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      if (!barGroups.length) return;
      var yAxisW = (yAxis.offsetWidth || 28) + 14;
      var colW = (lineCanvas.width - yAxisW) / labels.length;
      var maxNet = Math.max.apply(null, netArr);
      var minNet = Math.min.apply(null, netArr);
      var netRange = (maxNet - minNet) || 1;
      function getNetY(value) {
        return 136 * (1 - (value - minNet) / netRange);
      }
      ctx.strokeStyle = '#2a9040';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      netArr.forEach(function (value, i) {
        var cx = yAxisW + (i + 0.5) * colW;
        var cy = getNetY(value);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      netArr.forEach(function (value, i) {
        var cx = yAxisW + (i + 0.5) * colW;
        var cy = getNetY(value);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#2a9040';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
    global.setTimeout(drawLine, 50);
    if (global.addEventListener) global.addEventListener('resize', drawLine);
  }

  var api = {
    money: money,
    sum: sum,
    groupBy: groupBy,
    statementPeriodLabel: statementPeriodLabel,
    reportMonths: reportMonths,
    statementCashBookBalance: statementCashBookBalance,
    expenseStatementDate: expenseStatementDate,
    expenseStatementAmount: expenseStatementAmount,
    expenseStatementTypeLabel: expenseStatementTypeLabel,
    expenseStatementApplicant: expenseStatementApplicant,
    expenseStatementCandidate: expenseStatementCandidate,
    emptyGapBucket: emptyGapBucket,
    bumpGapBucket: bumpGapBucket,
    expenseStatementGapRows: expenseStatementGapRows,
    reportDataCompletenessSummary: reportDataCompletenessSummary,
    statementInvestorStats: statementInvestorStats,
    statementVerdictLabel: statementVerdictLabel,
    statementChartNarrative: statementChartNarrative,
    statementStructureModel: statementStructureModel,
    statementDiagnostics: statementDiagnostics,
    statementMoneyRows: statementMoneyRows,
    statementVerdictModel: statementVerdictModel,
    statementFlowRows: statementFlowRows,
    statementInvestorCardHtml: statementInvestorCardHtml,
    statementMoneyRowHtml: statementMoneyRowHtml,
    statementDiagnosticChipHtml: statementDiagnosticChipHtml,
    statementRankListHtml: statementRankListHtml,
    renderStatementPie: renderStatementPie,
    renderInteractiveChart: renderInteractiveChart,
  };

  global.FinanceV4Engines.register('reports', api);
  global.FinanceReportEngine = api;
})(window);
