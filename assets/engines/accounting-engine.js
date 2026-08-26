(function (global) {
  'use strict';

  var fallbackClassDefs = [
    { id: '1', label: '資產', range: '1xxx', normal: 'debit', desc: '現金、銀行、應收、預付、設備與保證金' },
    { id: '2', label: '負債', range: '2xxx', normal: 'credit', desc: '應付、預收、暫收、代收與往來款' },
    { id: '3', label: '權益', range: '3xxx', normal: 'credit', desc: '資本、公積、累積盈虧與本期損益' },
    { id: '4', label: '收入', range: '4xxx', normal: 'credit', desc: '服務收入、課程收入、補助收入與折讓' },
    { id: '5', label: '直接成本', range: '5xxx', normal: 'debit', desc: '照護、據點、培訓與直接人事成本' },
    { id: '6', label: '營業費用', range: '6xxx', normal: 'debit', desc: '行政、人事、租金、差旅、專業服務與一般營業費用' },
    { id: '7', label: '營業外', range: '7xxx', normal: 'credit', desc: '利息收入與其他非主要營業收入' },
    { id: '9', label: '所得稅', range: '9xxx', normal: 'debit', desc: '所得稅費用或利益' },
  ];

  function classDefs(defs) {
    return Array.isArray(defs) && defs.length ? defs : fallbackClassDefs;
  }

  function clone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      if (Array.isArray(value)) return value.slice();
      if (typeof value === 'object') return Object.assign({}, value);
      return value;
    }
  }

  function callOption(options, key, fallback) {
    options = options || {};
    return typeof options[key] === 'function' ? options[key] : fallback;
  }

  function htmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function code(account) {
    return String(account && account.c != null ? account.c : '').trim();
  }

  function classDef(id, defs) {
    return classDefs(defs).find(function (item) {
      return item && item.id === id;
    }) || { id: 'other', label: '未分類', range: '其他', normal: 'debit', desc: '尚未歸入標準科目類別' };
  }

  function classId(account) {
    var first = code(account).charAt(0);
    return ['1', '2', '3', '4', '5', '6', '7', '9'].indexOf(first) > -1 ? first : 'other';
  }

  function groupKey(account) {
    var accountCode = code(account);
    if (accountCode.indexOf('2195') === 0) return '2195';
    if (accountCode.indexOf('1112') === 0) return '1112';
    return accountCode.slice(0, 2) || '--';
  }

  function groupLabel(account) {
    var key = groupKey(account);
    var map = {
      '11': '流動資產',
      1112: '銀行存款明細',
      '15': '投資',
      '16': '固定資產',
      '19': '其他資產',
      '21': '流動負債',
      2195: '代收款明細',
      '29': '其他負債',
      '31': '股本',
      '32': '資本公積',
      '34': '保留盈餘',
      '41': '營業收入',
      '51': '服務與培訓成本',
      '52': '直接人事成本',
      '61': '行政人事費用',
      '62': '營業費用',
      '70': '利息收入',
      '71': '其他收入',
      '90': '所得稅',
    };
    return map[key] || (key === '--' ? '未編碼' : key + ' 科目');
  }

  function isActive(account) {
    return account && account.on !== false;
  }

  function allRows(accounts) {
    return (Array.isArray(accounts) ? accounts : []).filter(function (account) {
      return account && code(account);
    });
  }

  function visibleRows(accounts, options) {
    options = options || {};
    var query = String(options.query || '').toLowerCase().trim();
    var side = String(options.side || '').trim();
    var selectedClass = String(options.classId || 'all').trim() || 'all';
    var deptScopeText = typeof options.deptScopeText === 'function' ? options.deptScopeText : function (scope) {
      return String(scope || '');
    };

    return allRows(accounts).filter(function (account) {
      var def = classDef(classId(account), options.classDefs);
      var text = [account.c, account.n, account.s, deptScopeText(account.d, account), def.label, def.range, groupLabel(account)]
        .join(' ')
        .toLowerCase();
      return (!query || text.indexOf(query) > -1) &&
        (!side || account.s === side) &&
        (selectedClass === 'all' || classId(account) === selectedClass);
    });
  }

  function classCounts(rows, defs) {
    var counts = {};
    classDefs(defs).forEach(function (def) {
      if (def && def.id) counts[def.id] = 0;
    });
    (Array.isArray(rows) ? rows : []).forEach(function (account) {
      var id = classId(account);
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  function invalidDeptScopes(rows, deptCodes, options) {
    var known = Array.isArray(deptCodes) ? deptCodes : [];
    var selectionScope = callOption(options, 'selectionScope', function (account) {
      return { mode: 'all', departmentCodes: String(account && account.d || 'all').split(/[,，、\s]+/) };
    });
    return (Array.isArray(rows) ? rows : []).filter(function (account) {
      var normalized = selectionScope(account) || {};
      var tokens = Array.isArray(normalized.departmentCodes)
        ? normalized.departmentCodes
        : String(account && account.d || 'all').split(/[,，、\s]+/);
      return tokens.map(function (item) { return String(item || '').trim(); }).filter(Boolean).some(function (item) {
        if (!item || item === 'all' || item === '全部') return false;
        if (/^[A-Z]系$/i.test(item)) {
          return !known.some(function (code) { return String(code).charAt(0).toUpperCase() === item.charAt(0).toUpperCase(); });
        }
        if (item.slice(-1) === '*' && item.length > 1) {
          var prefix = item.slice(0, -1);
          return !known.some(function (code) { return String(code).indexOf(prefix) === 0; });
        }
        return known.indexOf(item) < 0;
      });
    });
  }

  function normalizeAccountingTemplates(value, defaults) {
    defaults = Array.isArray(defaults) ? defaults : [];
    var byId = {};
    defaults.forEach(function (template) {
      if (template && template.id) byId[template.id] = clone(template);
    });

    (Array.isArray(value) ? value : []).forEach(function (template) {
      if (!template || !template.id) return;
      byId[template.id] = Object.assign({}, byId[template.id] || {}, clone(template));
      byId[template.id].lines = Array.isArray(byId[template.id].lines) ? byId[template.id].lines : [];
    });

    var defaultIds = defaults.map(function (template) {
      return template && template.id;
    });
    return defaults.map(function (template) {
      return byId[template.id];
    }).concat(Object.keys(byId).filter(function (id) {
      return defaultIds.indexOf(id) === -1;
    }).map(function (id) {
      return byId[id];
    }));
  }

  function accountUsageHtml(summary, options) {
    summary = summary || {};
    var escape = callOption(options, 'escape', htmlEscape);
    return '<div class="account-list-usage"><div class="account-list-usage-main">' + escape(summary.main || '') + '</div><div class="account-list-usage-sub">' + escape(summary.sub || '') + '</div></div>';
  }

  function accountMissingUsageRefs(usage, accountCodes) {
    var known = {};
    (Array.isArray(accountCodes) ? accountCodes : []).forEach(function (accountCode) {
      if (accountCode != null && String(accountCode).trim()) known[String(accountCode).trim()] = true;
    });
    return Object.keys(usage || {}).filter(function (accountCode) {
      return !known[accountCode];
    }).sort();
  }

  function accountSummaryCards(rows, allRows, options) {
    options = options || {};
    rows = Array.isArray(rows) ? rows : [];
    allRows = Array.isArray(allRows) ? allRows : [];
    var activeFn = callOption(options, 'isActive', isActive);
    var selectionScope = callOption(options, 'selectionScope', function (account) {
      return account && account.selectionScope || { mode: 'all' };
    });
    var active = allRows.filter(activeFn);
    var debit = active.filter(function (account) { return account && account.s === 'debit'; }).length;
    var credit = active.filter(function (account) { return account && account.s === 'credit'; }).length;
    var restricted = active.filter(function (account) { return selectionScope(account).mode === 'restricted'; }).length;
    var inactive = allRows.length - active.length;
    return [
      ['正式啟用科目', active.length + ' 筆', '目前可被表單與傳票使用'],
      ['借方 / 貸方', debit + ' / ' + credit, '依正常餘額方向快速檢視'],
      ['公司／部門限制', restricted + ' 筆', restricted ? '只計算已正式啟用的限制規則' : '目前全部啟用科目皆為共用'],
      ['目前篩選結果', rows.length + ' 筆', inactive ? ('另有 ' + inactive + ' 筆停用科目') : '沒有停用科目'],
    ];
  }

  function accountSummaryHtml(cards, options) {
    var escape = callOption(options, 'escape', htmlEscape);
    return (cards || []).map(function (card) {
      card = card || [];
      return '<div class="account-summary-card"><div class="account-summary-label">' + escape(card[0]) + '</div><div class="account-summary-value">' + escape(card[1]) + '</div><div class="account-summary-sub">' + escape(card[2]) + '</div></div>';
    }).join('');
  }

  function accountClassTabsHtml(defs, counts, selectedClass, activeCount, options) {
    var escape = callOption(options, 'escape', htmlEscape);
    selectedClass = selectedClass || 'all';
    counts = counts || {};
    var buttons = ['<button class="account-class-btn ' + (selectedClass === 'all' ? 'on' : '') + '" onclick="filterAccClass(\'all\',this)">全部<span class="account-class-count">' + escape(activeCount || 0) + '</span></button>'];
    classDefs(defs).forEach(function (def) {
      buttons.push('<button class="account-class-btn ' + (selectedClass === def.id ? 'on' : '') + '" onclick="filterAccClass(\'' + escape(def.id) + '\',this)">' + escape(def.label) + '<span class="account-class-count">' + escape(counts[def.id] || 0) + '</span></button>');
    });
    return buttons.join('');
  }

  function accountMiniRowsHtml(rows, max, options) {
    options = options || {};
    var escape = callOption(options, 'escape', htmlEscape);
    var accountCode = callOption(options, 'code', code);
    var accountName = callOption(options, 'name', function (account) { return account && account.n; });
    var deptScopeText = callOption(options, 'deptScopeText', function (scope) { return String(scope || ''); });
    var limit = max || 6;
    rows = (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
      return String(accountCode(a)).localeCompare(String(accountCode(b)), 'zh-Hant');
    });
    var shown = rows.slice(0, limit).map(function (account) {
      return '<div class="account-mini-row"><span class="account-mini-code">' + escape(accountCode(account)) + '</span><span class="account-mini-name">' + escape(accountName(account)) + '</span><span class="account-mini-scope">' + escape(deptScopeText(account && account.d, account)) + '</span></div>';
    }).join('');
    if (rows.length > limit) shown += '<div style="font-size:10px;color:#94a3b8;margin-top:2px">另有 ' + escape(rows.length - limit) + ' 筆，請看下方明細表。</div>';
    return shown || '<div style="font-size:11px;color:#94a3b8">此類別目前沒有科目。</div>';
  }

  function accountListRowsHtml(rows, max, usage, options) {
    options = options || {};
    var escape = callOption(options, 'escape', htmlEscape);
    var accountCode = callOption(options, 'code', code);
    var accountName = callOption(options, 'name', function (account) { return account && account.n; });
    var accountGroup = callOption(options, 'groupLabel', groupLabel);
    var sideBadge = callOption(options, 'sideBadgeHtml', function (side) { return escape(side || ''); });
    var deptScopeText = callOption(options, 'deptScopeText', function (scope) { return String(scope || ''); });
    var usageSummary = callOption(options, 'accountUsageSummary', function () { return { main: '尚未使用', sub: '沒有預設規則或正式分錄' }; });
    var activeFn = callOption(options, 'isActive', isActive);
    rows = (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
      return String(accountCode(a)).localeCompare(String(accountCode(b)), 'zh-Hant');
    });
    var limit = max || 9999;
    var visible = rows.slice(0, limit);
    var html = visible.map(function (account) {
      return '<div class="account-list-row">'
        + '<div class="account-list-code">' + escape(accountCode(account)) + '</div>'
        + '<div><div class="account-list-name">' + escape(accountName(account)) + '</div><div class="account-list-group">' + escape(accountGroup(account)) + '</div></div>'
        + '<div>' + sideBadge(account && account.s, account) + '</div>'
        + '<div class="account-list-scope">' + escape(deptScopeText(account && account.d, account)) + '</div>'
        + accountUsageHtml(usageSummary(account, usage), { escape: escape })
        + '<div><span class="badge ' + (activeFn(account) ? 'b-ok' : 'b-gray') + '">' + (activeFn(account) ? '啟用' : '停用') + '</span></div>'
        + '</div>';
    }).join('');
    if (rows.length > limit) html += '<div class="account-list-more">另有 ' + escape(rows.length - limit) + ' 筆，請用搜尋或查看下方明細表。</div>';
    return html || '<div class="account-list-empty">此類別目前沒有科目。</div>';
  }

  function accountMapHtml(rows, allRows, options) {
    options = options || {};
    var escape = callOption(options, 'escape', htmlEscape);
    var activeFn = callOption(options, 'isActive', isActive);
    var classIdFn = callOption(options, 'classId', classId);
    var groupKeyFn = callOption(options, 'groupKey', groupKey);
    var groupLabelFn = callOption(options, 'groupLabel', groupLabel);
    var selectedClass = options.currentClass || 'all';
    var usage = options.usage || {};
    rows = Array.isArray(rows) ? rows : [];
    var visibleActive = rows.filter(activeFn);
    var defs = classDefs(options.classDefs);
    if (selectedClass === 'all') {
      return '<div class="account-list">' + defs.map(function (def) {
        var list = visibleActive.filter(function (account) { return classIdFn(account) === def.id; });
        var sideText = def.normal === 'debit' ? '正常餘額：借方' : '正常餘額：貸方';
        return '<section class="account-list-section"><div class="account-list-head">'
          + '<div class="account-list-index">' + escape(def.range) + '</div>'
          + '<div><div class="account-list-title">' + escape(def.label) + '</div></div>'
          + '<div class="account-list-desc">' + escape(def.desc) + '</div>'
          + '<div class="account-list-meta"><span class="badge ' + (def.normal === 'debit' ? 'b-ok' : 'b-wait') + '">' + escape(sideText) + '</span><span class="badge b-blue">' + escape(list.length) + ' 筆</span></div>'
          + '</div><div class="account-list-rows">' + accountListRowsHtml(list, 8, usage, options) + '</div></section>';
      }).join('') + '</div>';
    }
    var groups = {};
    visibleActive.forEach(function (account) {
      var key = groupKeyFn(account);
      if (!groups[key]) groups[key] = [];
      groups[key].push(account);
    });
    var keys = Object.keys(groups).sort();
    return '<div class="account-list">' + (keys.map(function (key) {
      var list = groups[key];
      var sample = list[0];
      return '<section class="account-list-section"><div class="account-list-head">'
        + '<div class="account-list-index">' + escape(key) + '</div>'
        + '<div><div class="account-list-title">' + escape(groupLabelFn(sample)) + '</div></div>'
        + '<div class="account-list-desc">此群組目前列出 ' + escape(list.length) + ' 筆科目。</div>'
        + '<div class="account-list-meta"><span class="badge b-blue">' + escape(list.length) + ' 筆</span></div>'
        + '</div><div class="account-list-rows">' + accountListRowsHtml(list, 999, usage, options) + '</div></section>';
    }).join('') || '<div class="account-list-empty">找不到符合的科目群組</div>') + '</div>';
  }

  function accountInsightsHtml(rows, options) {
    var escape = callOption(options, 'escape', htmlEscape);
    return (rows || []).map(function (row) {
      return '<div class="account-insight ' + (row && row.ok ? 'ok' : 'warn') + '">'
        + '<span class="account-insight-status">' + (row && row.ok ? '正常' : '注意') + '</span>'
        + '<div><div class="account-insight-title">' + escape(row && row.title) + '</div><div class="account-insight-body">' + escape(row && row.body) + '</div></div>'
        + '</div>';
    }).join('');
  }

  var api = {
    classDefs: classDefs,
    code: code,
    classDef: classDef,
    classId: classId,
    groupKey: groupKey,
    groupLabel: groupLabel,
    isActive: isActive,
    allRows: allRows,
    visibleRows: visibleRows,
    classCounts: classCounts,
    invalidDeptScopes: invalidDeptScopes,
    normalizeAccountingTemplates: normalizeAccountingTemplates,
    accountUsageHtml: accountUsageHtml,
    accountMissingUsageRefs: accountMissingUsageRefs,
    accountSummaryCards: accountSummaryCards,
    accountSummaryHtml: accountSummaryHtml,
    accountClassTabsHtml: accountClassTabsHtml,
    accountMiniRowsHtml: accountMiniRowsHtml,
    accountListRowsHtml: accountListRowsHtml,
    accountMapHtml: accountMapHtml,
    accountInsightsHtml: accountInsightsHtml,
  };

  global.FinanceAccountingEngine = api;
  global.FinanceV4Engines.register('accounting', api);
})(window);
