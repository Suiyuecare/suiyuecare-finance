(function (global) {
  'use strict';

  var protectedFieldMap = {
    invoice_request: ['entity', 'applicant', 'department', 'reason', 'buyer', 'identifier_type', 'item_type', 'total', 'rate'],
    bill_request: ['entity', 'applicant', 'department', 'reason', 'payer', 'item', 'period', 'amount'],
    expense_request: ['entity', 'applicant', 'department', 'date', 'purpose', 'amount'],
    hr_transfer_detail: ['seq', 'bank_name', 'bank_code', 'branch_name', 'account_no', 'amount'],
    travel_detail: ['item', 'amount', 'limit'],
    purchase_detail: ['seq', 'item', 'qty', 'link'],
    refund_detail: ['original_type', 'original_no', 'reason', 'description', 'refund_amount', 'method', 'bank_name', 'branch_name', 'account_name', 'account_no'],
    shareholder_transaction: ['payer_type', 'payee_type', 'category', 'type', 'cash_direction', 'offset_required', 'date', 'amount'],
  };

  function normalizeFormType(type) {
    return String(type || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function coerceMoney(value) {
    var n = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function htmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function callDep(deps, name, args, fallback) {
    deps = deps || {};
    if (typeof deps[name] !== 'function') return fallback;
    try {
      var value = deps[name].apply(null, args || []);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function requiredMark(required) {
    return required ? ' *' : '';
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

  function defaultFieldConfigs() {
    return [
      { id: 'expense_request', name: '支出 / 放款申請', enabled: true, fields: [
        { key: 'entity', label: '開立法人', visible: true, required: true, hint: '由使用者或部門預設帶入' },
        { key: 'applicant', label: '申請人', visible: true, required: true, hint: '固定帶入目前登入者，具權限者可代填' },
        { key: 'department', label: '組別 / 部門', visible: true, required: true, hint: '用於簽核與分類帳' },
        { key: 'date', label: '表單填寫日期', visible: true, required: true, hint: '申請建立日期' },
        { key: 'purpose', label: '申請原因', visible: true, required: true, hint: '說明業務目的' },
        { key: 'note', label: '備註內容', visible: true, required: false, hint: '補充說明，可由 Excel 明細自動帶入' },
        { key: 'amount', label: '總金額', visible: true, required: true, hint: '支出或放款申請金額' },
        { key: 'attachments', label: '附件', visible: true, required: false, hint: '發票、憑據或補充文件' },
      ] },
      { id: 'hr_transfer_detail', name: '人事 104 匯款清冊', enabled: true, fields: [
        { key: 'seq', label: '序位', visible: true, required: true, hint: '由系統自動從 1 編號' },
        { key: 'bank_name', label: '銀行別', visible: true, required: true, hint: '收款銀行名稱' },
        { key: 'bank_code', label: '銀行代號', visible: true, required: true, hint: '三碼銀行代號' },
        { key: 'branch_name', label: '分行名稱', visible: true, required: true, hint: '收款分行名稱' },
        { key: 'account_no', label: '銀行帳號', visible: true, required: true, hint: '請以文字格式保留完整帳號' },
        { key: 'amount', label: '金額', visible: true, required: true, hint: '只填數字，不要輸入 NT$ 或逗號' },
        { key: 'note', label: '備註', visible: true, required: false, hint: '非必填，可保留會計用說明' },
      ] },
      { id: 'travel_detail', name: '差旅經費明細', enabled: true, fields: [
        { key: 'item', label: '費用項目', visible: true, required: true, hint: '住宿、交通、膳什、停車或其他費用' },
        { key: 'amount', label: '本次申請金額', visible: true, required: true, hint: '不得超過系統計算上限' },
        { key: 'limit', label: '申請金額上限', visible: true, required: true, hint: '依差旅辦法與同行人員層級自動計算' },
        { key: 'note', label: '說明', visible: true, required: false, hint: '其他費用需補充說明' },
        { key: 'files', label: '憑據', visible: true, required: false, hint: '膳什費免憑證，其餘依規定上傳' },
        { key: 'rule', label: '規則', visible: true, required: false, hint: '顯示此項費用的核銷規則' },
      ] },
      { id: 'purchase_detail', name: '採購需求明細', enabled: true, fields: [
        { key: 'seq', label: '項次', visible: true, required: true, hint: '由系統自動編號' },
        { key: 'item', label: '商品項目', visible: true, required: true, hint: '請填寫欲採購品項' },
        { key: 'qty', label: '數量', visible: true, required: true, hint: '請填寫數量' },
        { key: 'link', label: '商品連結', visible: true, required: true, hint: '請貼上商品網址或可供總務採購的來源' },
        { key: 'note', label: '備註', visible: true, required: false, hint: '規格、偏好品牌或補充說明' },
      ] },
      { id: 'refund_detail', name: '退費申請明細', enabled: true, fields: [
        { key: 'original_type', label: '原單類型', visible: true, required: true, hint: '繳費單、發票、收款紀錄或其他' },
        { key: 'original_no', label: '原單號 / 收款編號', visible: true, required: true, hint: '可追溯原始收款或單據' },
        { key: 'invoice_no', label: '原發票號碼', visible: true, required: false, hint: '發票作廢退回時必填' },
        { key: 'invoice_date', label: '原發票日期', visible: true, required: false, hint: '原發票日期' },
        { key: 'payment_date', label: '原收款日', visible: true, required: false, hint: '實際收款日期' },
        { key: 'original_amount', label: '原繳費金額', visible: true, required: false, hint: '原本繳費金額' },
        { key: 'reason', label: '退費原因', visible: true, required: true, hint: '選擇退費原因' },
        { key: 'other_reason', label: '其他退費原因', visible: true, required: false, hint: '原因為其他時填寫' },
        { key: 'description', label: '退費說明', visible: true, required: true, hint: '說明退款事由' },
        { key: 'receivable_amount', label: '應收金額', visible: true, required: false, hint: '原本應收金額' },
        { key: 'received_amount', label: '實收金額', visible: true, required: false, hint: '實際收到金額' },
        { key: 'refund_amount', label: '應退金額', visible: true, required: true, hint: '系統可由實收減應收自動帶入' },
        { key: 'calculation_note', label: '計算說明', visible: true, required: false, hint: '補充應退金額計算方式' },
        { key: 'method', label: '退款方式', visible: true, required: true, hint: '銀行轉帳或現金' },
        { key: 'bank_name', label: '銀行名稱', visible: true, required: true, hint: '銀行轉帳時必填' },
        { key: 'branch_name', label: '分行名稱', visible: true, required: true, hint: '銀行轉帳時必填' },
        { key: 'account_name', label: '戶名', visible: true, required: true, hint: '銀行轉帳時必填' },
        { key: 'account_no', label: '帳號', visible: true, required: true, hint: '銀行轉帳時必填' },
      ] },
      { id: 'shareholder_transaction', name: '股東 / 公司間往來', enabled: true, fields: [
        { key: 'payer_type', label: '貸方類型', visible: true, required: true, hint: '給錢的人為法人或自然人' },
        { key: 'payer_entity', label: '貸方法人', visible: true, required: true, hint: '貸方為法人時必填' },
        { key: 'payer_name', label: '貸方自然人姓名', visible: true, required: true, hint: '貸方為自然人時必填' },
        { key: 'payer_account_name', label: '付款戶名', visible: true, required: false, hint: '付款帳戶名稱' },
        { key: 'payer_bank', label: '付款銀行', visible: true, required: false, hint: '付款銀行名稱' },
        { key: 'payer_branch', label: '付款分行', visible: true, required: false, hint: '付款分行名稱' },
        { key: 'payer_account', label: '付款帳號', visible: true, required: false, hint: '付款帳號' },
        { key: 'payee_type', label: '借方類型', visible: true, required: true, hint: '收錢的人為法人或自然人' },
        { key: 'payee_entity', label: '借方法人', visible: true, required: true, hint: '借方為法人時必填' },
        { key: 'payee_name', label: '借方自然人姓名', visible: true, required: true, hint: '借方為自然人時必填' },
        { key: 'payee_account_name', label: '收款戶名', visible: true, required: false, hint: '收款帳戶名稱' },
        { key: 'payee_bank', label: '收款銀行', visible: true, required: false, hint: '收款銀行名稱' },
        { key: 'payee_branch', label: '收款分行', visible: true, required: false, hint: '收款分行名稱' },
        { key: 'payee_account', label: '收款帳號', visible: true, required: false, hint: '收款帳號' },
        { key: 'category', label: '交易性質', visible: true, required: true, hint: '股東資金、公司間資金、投資或利息手續費' },
        { key: 'type', label: '項目', visible: true, required: true, hint: '依交易性質選擇公司借貸、公司還款或其他細項' },
        { key: 'cash_direction', label: '資金方向', visible: true, required: true, hint: '資金流入、流出、公司間雙向或非現金' },
        { key: 'offset_required', label: '是否需沖銷原交易', visible: true, required: true, hint: '是否沖銷既有股東或公司間往來' },
        { key: 'date', label: '入帳日期', visible: true, required: true, hint: '交易入帳日期' },
        { key: 'amount', label: '金額', visible: true, required: true, hint: '請填寫本次往來金額' },
        { key: 'transfer_ref', label: '交易序號 / 匯款識別碼', visible: true, required: false, hint: '銀行交易序號、匯款備註碼或內部識別碼' },
        { key: 'bank_note', label: '銀行資訊備註', visible: true, required: false, hint: '補充銀行或資金調度說明' },
        { key: 'attachments', label: '附件', visible: true, required: false, hint: '合約、匯款證明、董事會決議或補充文件' },
        { key: 'note', label: '備註', visible: true, required: false, hint: '補充交易依據、合約或決議內容' },
      ] },
      { id: 'invoice_request', name: '開立發票', enabled: true, fields: [
        { key: 'entity', label: '開立法人', visible: true, required: true, hint: '由申請人或部門預設帶入' },
        { key: 'applicant', label: '申請人', visible: true, required: true, hint: '固定帶入目前登入者' },
        { key: 'department', label: '組別 / 部門', visible: true, required: true, hint: '用於簽核與收入歸屬' },
        { key: 'reason', label: '開立原因', visible: true, required: true, hint: '說明為何需要開立發票' },
        { key: 'buyer', label: '買受人', visible: true, required: true, hint: '客戶或單位名稱' },
        { key: 'identifier_type', label: '開立方式', visible: true, required: true, hint: '統編、電子發票、載具或領據' },
        { key: 'taxid', label: '統編/載具號碼', visible: true, required: false, hint: '統編、載具號碼或留空' },
        { key: 'item_type', label: '常用品項', visible: true, required: true, hint: '對應收入規則' },
        { key: 'desc', label: '品項說明', visible: true, required: false, hint: '可補充服務月份、案名或明細' },
        { key: 'total', label: '含稅總額', visible: true, required: true, hint: '稅額由稅率自動計算' },
        { key: 'rate', label: '稅率', visible: true, required: true, hint: '只填 0 或 5' },
      ] },
      { id: 'bill_request', name: '申請繳費單', enabled: true, fields: [
        { key: 'entity', label: '開立法人', visible: true, required: true, hint: '由申請人或部門預設帶入' },
        { key: 'applicant', label: '申請人', visible: true, required: true, hint: '固定帶入目前登入者' },
        { key: 'department', label: '組別 / 部門', visible: true, required: true, hint: '用於簽核與收入歸屬' },
        { key: 'reason', label: '開立原因', visible: true, required: true, hint: '說明繳費單用途' },
        { key: 'payer', label: '繳費人名稱', visible: true, required: true, hint: '只需繳費人名稱' },
        { key: 'item', label: '項目名稱', visible: true, required: true, hint: '居家服務費、課程費、餐費、耗材費' },
        { key: 'period', label: '服務月份 / 費用期間', visible: true, required: true, hint: '例：2026/06 或 2026/06/01-06/30' },
        { key: 'amount', label: '應收金額', visible: true, required: true, hint: '只填數字' },
      ] },
    ];
  }

  function protectedFieldKeys(formId) {
    return (protectedFieldMap[formId] || []).slice();
  }

  function isProtectedField(formId, key) {
    return protectedFieldKeys(formId).indexOf(key) > -1;
  }

  function findDefaultField(defaultConfigs, formId, key) {
    var cfg = (defaultConfigs || []).find(function (item) {
      return item && item.id === formId;
    });
    var fields = cfg && Array.isArray(cfg.fields) ? cfg.fields : [];
    return fields.find(function (field) {
      return field && field.key === key;
    }) || null;
  }

  function enforceProtectedFields(config, defaultConfigs) {
    var cfg = clone(config || {}) || {};
    cfg.fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    var byKey = {};
    cfg.fields.forEach(function (field) {
      if (field && field.key) byKey[field.key] = field;
    });

    protectedFieldKeys(cfg.id).forEach(function (key) {
      var field = byKey[key];
      if (!field) {
        field = clone(findDefaultField(defaultConfigs, cfg.id, key) || { key: key, label: key, hint: '' });
        cfg.fields.push(field);
        byKey[key] = field;
      }
      field.visible = true;
      field.required = true;
      field.protected = true;
    });

    return cfg;
  }

  function normalizeFieldConfigs(value, defaultConfigs) {
    var defaults = Array.isArray(defaultConfigs) ? defaultConfigs : [];
    var byId = {};
    defaults.forEach(function (config) {
      if (config && config.id) byId[config.id] = clone(config);
    });

    (Array.isArray(value) ? value : []).forEach(function (config) {
      if (!config || !config.id) return;
      byId[config.id] = Object.assign({}, byId[config.id] || {}, clone(config));
      byId[config.id].fields = Array.isArray(byId[config.id].fields) ? byId[config.id].fields : [];
    });

    var defaultIds = defaults.map(function (config) { return config && config.id; });
    return defaults.map(function (config) {
      return enforceProtectedFields(byId[config.id], defaults);
    }).concat(Object.keys(byId).filter(function (id) {
      return defaultIds.indexOf(id) === -1;
    }).map(function (id) {
      return enforceProtectedFields(byId[id], defaults);
    }));
  }

  function fieldConfig(configs, formId) {
    return (configs || []).find(function (config) {
      return config && config.id === formId && config.enabled !== false;
    }) || null;
  }

  function fieldMeta(configs, formId, key) {
    var config = fieldConfig(configs, formId);
    var fields = config && Array.isArray(config.fields) ? config.fields : [];
    return fields.find(function (field) {
      return field && field.key === key;
    }) || null;
  }

  function visible(configs, formId, key, fallback) {
    var field = fieldMeta(configs, formId, key);
    return field ? field.visible !== false : !!fallback;
  }

  function required(configs, formId, key, fallback) {
    var field = fieldMeta(configs, formId, key);
    if (field && field.visible === false) return false;
    return field ? !!field.required : !!fallback;
  }

  function label(configs, formId, key, fallback) {
    var field = fieldMeta(configs, formId, key);
    return (field && field.label) || fallback || key;
  }

  function hint(configs, formId, key, fallback) {
    var field = fieldMeta(configs, formId, key);
    return (field && field.hint) || fallback || '';
  }

  function requiredNote(formId, key) {
    return isProtectedField(formId, key) ? '系統必要欄位，會強制顯示與必填' : '';
  }

  function missingRequiredItems(configs, formId, items) {
    return (items || []).filter(function (item) {
      return required(configs, formId, item.key, item.required !== false) && !String(item.value == null ? '' : item.value).trim();
    }).map(function (item) {
      return item.label || label(configs, formId, item.key, item.key);
    });
  }

  var defaultTravelTypes = ['公務出差', '教育訓練', '會議', '拜訪', '場勘', '外部稽核', '督導訪視', '單位合作'];
  var travelKindLabels = {
    lodging: '住宿費',
    transport: '交通費',
    meal: '膳什費',
    parking: '停車費',
    other: '其他費用',
  };

  function travelKindLabel(kind) {
    return travelKindLabels[kind] || kind;
  }

  function travelRateTier(user) {
    return ['dept_manager', 'ceo'].indexOf(user && user.role) > -1 ? 'manager' : 'staff';
  }

  function travelRateTierLabel(user) {
    return travelRateTier(user) === 'manager' ? '部門主任/執行長級' : '一般組員級';
  }

  function travelHasAmountLimit(kind) {
    return ['lodging', 'meal'].indexOf(kind) > -1;
  }

  function travelFieldsHtml(options) {
    options = options || {};
    var types = Array.isArray(options.travelTypes) && options.travelTypes.length ? options.travelTypes : defaultTravelTypes;
    return '<div class="card" style="background:#fffaf3;border-color:#efd7b8;margin-bottom:9px"><div class="chd"><span class="cht">2-4. 差旅申請資料</span></div><div style="padding:11px">'
      + '<div class="fr2"><div class="fg"><label class="fl">差旅類型 *</label><select id="tr-type">' + types.map(function (item) {
        return '<option value="' + htmlEscape(item) + '">' + htmlEscape(item) + '</option>';
      }).join('') + '</select></div><div class="fg"><label class="fl">關聯專案／活動</label><input id="tr-project" placeholder="例：日照籌設、標案執行、居服拓區、訓練課程"></div></div>'
      + '<div class="fr2"><div class="fg"><label class="fl">出差事由 *</label><input id="tr-reason" placeholder="簡述為什麼需要出差"></div><div class="fg"><label class="fl">預期成果 *</label><input id="tr-outcome" placeholder="例：會議紀錄、訪視紀錄、報價單、照片、場勘報告"></div></div>'
      + '<div class="fr2"><div class="fg"><label class="fl">出發日期與時間 *</label><input type="datetime-local" id="tr-start" onchange="calcTravelDays();syncTravelRows()"></div><div class="fg"><label class="fl">返回日期與時間 *</label><input type="datetime-local" id="tr-end" onchange="calcTravelDays();syncTravelRows()"></div></div>'
      + '<div class="fr2"><div class="fg"><label class="fl">出發地 *</label><input id="tr-from" placeholder="公司、家裡、服務據點等"></div><div class="fg"><label class="fl">目的地 *</label><input id="tr-to" placeholder="地址或區域"></div></div>'
      + '</div></div>';
  }

  function travelExpenseItemHtml(key, labelText, fileLabel, deps) {
    key = String(key || '');
    labelText = labelText || travelKindLabel(key);
    fileLabel = fileLabel || labelText;
    var names = callDep(deps, 'travelFileNames', [key], '');
    var summary = callDep(deps, 'travelFileSummary', [key], '');
    var safeKey = htmlEscape(key);
    var jsKey = htmlEscape(JSON.stringify(key));
    return '<div class="travel-file-card">'
      + '<div class="travel-file-title">' + htmlEscape(labelText) + '</div>'
      + '<label for="tr-' + safeKey + '-file" class="travel-file-control" role="button" tabindex="0" onkeydown="travelFileKeydown(event,' + jsKey + ')" onpointerdown="rememberTravelUploadScroll()" ontouchstart="rememberTravelUploadScroll()">'
        + '<span class="travel-file-btn">選擇檔案</span>'
        + '<span class="travel-file-text">' + htmlEscape(summary || '可多選附件') + '</span>'
      + '</label>'
      + '<input class="travel-file-input" type="file" id="tr-' + safeKey + '-file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onchange="travelFileChange(' + jsKey + ',this)">'
      + '<div id="tr-' + safeKey + '-files" class="travel-file-status">' + htmlEscape(names || fileLabel + '尚未上傳') + '</div></div>';
  }

  function travelAttachmentGuideHtml(deps) {
    deps = deps || {};
    var days = callDep(deps, 'travelDaysNum', [], 1) || 1;
    return '<div style="background:#fffaf3;border:1px solid #efd7b8;border-radius:10px;padding:10px;min-height:100%;grid-column:1/-1">'
      + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px"><div><div style="font-size:14px;font-weight:800;color:#263244">差旅附件與同行人員</div><div style="font-size:12px;color:#8b7358;line-height:1.65;margin-top:3px">先選本趟參與差旅的員工，再依住宿、交通、停車、其他四類上傳憑據；每一類都可上傳多份資料。膳什費不用上傳憑據，系統會依同行人員與 0.5 天單位計算上限，金額仍可在明細表中自行調整。</div></div></div>'
      + '<div class="fr2"><div class="fg travel-people-field"><label class="fl">本趟同行人員 *（可複選）</label><div class="travel-people-picker"><div class="travel-people-search-row"><input type="search" id="tr-people-search" class="travel-people-search" autocomplete="off" placeholder="輸入姓名、Email、角色或部門搜尋..." oninput="travelPeopleSearch(this.value)" onfocus="travelPeopleSearch(this.value)"><span id="tr-people-count" class="travel-people-count">已選 0 人</span></div><div id="tr-people-chips" class="travel-people-chips"></div><div id="tr-people-box" class="travel-people-options"></div></div><div style="font-size:11px;color:#8b7358;margin-top:4px">清冊會使用目前系統 / Supabase 載入的啟用帳號。差旅級距只認部門主任與執行長；其他層級皆以一般組員計算。</div></div><div class="fg"><label class="fl">出差天數 *</label><input type="number" min="0.5" step="0.5" id="tr-days-manual" value="' + htmlEscape(days) + '" oninput="syncTravelRows()" onchange="syncTravelRows()"><div style="font-size:11px;color:#8b7358;margin-top:4px">膳什費以 0.5 天為單位計算；住宿晚數採天數無條件捨去，例如 1.5 天以 1 晚計。</div></div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:8px">'
        + travelExpenseItemHtml('lodging', '住宿費', '住宿憑據', deps)
        + travelExpenseItemHtml('transport', '交通費', '交通憑據', deps)
        + travelExpenseItemHtml('parking', '停車費', '停車憑據', deps)
        + travelExpenseItemHtml('other', '其他費用', '其他憑據', deps)
      + '</div>'
      + '<div style="font-size:11px;color:#8b7358;margin-top:8px">上傳憑據只會保存附件與帶入憑據狀態；2-2 經費明細表的本次申請金額請自行填寫或調整，住宿與膳什費不得超過系統計算上限。</div>'
    + '</div>';
  }

  function travelSheetHtml() {
    return '<div class="card"><div class="chd"><span class="cht">2-2. 經費明細表</span><div style="display:flex;gap:5px"><button class="btn-g" onclick="travelAddOtherRow()">新增其他項目</button><button class="btn-g" onclick="syncTravelRows()">重新計算上限</button></div></div><div style="padding:11px"><div style="font-size:11px;color:#8b7358;line-height:1.5;margin-bottom:8px">本次申請金額可自行編輯；住宿與膳什費不可大於申請金額上限，交通費、停車費、其他費用不設上限但須附憑據與說明。</div><div id="travel-sheet"></div></div></div>';
  }

  function travelPeopleSummary(people) {
    people = Array.isArray(people) ? people : [];
    return people.length ? people.map(function (user) {
      return user && (user.n || user.email || '未命名');
    }).filter(Boolean).join('、') : '選擇同行人員';
  }

  function travelPersonRowHtml(user, selected, deps) {
    deps = deps || {};
    user = user || {};
    var userId = user.id || '';
    var roleLabel = user.rL || callDep(deps, 'roleLabel', [user], '') || user.role || '';
    var deptLabel = callDep(deps, 'deptLabel', [user], '') || user.dc || '未填部門';
    var tierLabel = callDep(deps, 'rateTierLabel', [user], travelRateTierLabel(user));
    return '<button type="button" class="travel-person-row ' + (selected ? 'selected' : '') + '" aria-pressed="' + (selected ? 'true' : 'false') + '" onclick="travelPersonToggle(' + htmlEscape(JSON.stringify(userId)) + ')">'
      + '<span class="travel-person-check">' + (selected ? '✓' : '') + '</span>'
      + '<span class="travel-person-main"><span class="travel-person-name">' + htmlEscape(user.n || user.email || '未命名') + '</span><span class="travel-person-sub">' + htmlEscape(roleLabel + ' · ' + deptLabel) + '</span></span>'
      + '<span class="travel-person-tier">' + htmlEscape(tierLabel) + '</span>'
    + '</button>';
  }

  function fileExtension(name) {
    var match = String(name || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : '';
  }

  function nrFileListHtml(files, maxWidth) {
    maxWidth = maxWidth || 160;
    files = Array.isArray(files) ? files : [];
    if (!files.length) return '<div style="font-size:11px;color:#94a3b8;padding:3px 0">尚未上傳任何憑據</div>';
    return files.map(function (file, index) {
      var name = file && (file.name || file.n) || '附件';
      var ext = fileExtension(name).toUpperCase();
      return '<div class="file-chip"><span style="font-size:9px;background:var(--brxl);color:var(--brtxt);padding:1px 4px;border-radius:3px">' + htmlEscape(ext) + '</span><span style="max-width:' + htmlEscape(maxWidth) + 'px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + htmlEscape(name) + '</span><button onclick="nrRemoveFile(' + index + ')" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:12px;padding:0;line-height:1">×</button></div>';
    }).join('');
  }

  function receiptUploadPanelHtml(options, deps) {
    options = options || {};
    var isPayroll = options.kind === 'payroll';
    var title = options.label || (isPayroll ? '上傳薪資表 / 人事附件' : '上傳憑據');
    var hint = options.hint || (isPayroll ? '上傳薪資表、人事費用支出表、104 銀行轉帳明細或勞務報酬單' : '發票、憑據或補充文件');
    var required = options.required === true;
    var fileList = callDep(deps, 'nrFileListHtml', [180], nrFileListHtml([], 180));
    var payrollVisibleLabels = callDep(deps, 'hrTransferVisibleLabelList', [], '');
    var progressHtml = callDep(deps, 'lazyProgressHtml', [], '');
    var ocrBtn = options.ocr ? '<button type="button" class="btn-p" onclick="lazyAnalyze()">AI 解析憑據</button>' : '';
    var payrollAnalyzeAction = isPayroll ? (options.aiEnabled
      ? '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;padding:9px 10px;border-radius:8px;background:#fff7ed;border:1px solid #f0c987"><div style="font-size:11px;color:#7c3f00;line-height:1.55">已上傳薪資表、人事費用支出表、104 銀行轉帳明細或 9A / 9B 勞務報酬單後，請按右側分析；若表格包含 104 會計用欄位，系統會自動切換隱私模式，只回填匯款必要資料。</div><button type="button" class="btn-p" onclick="hrAnalyzePayroll()">AI 分析</button></div>'
      : '<div style="margin-top:8px;padding:9px 10px;border-radius:8px;background:#f8fafc;border:1px solid #dbe3ec;color:#64748b;font-size:11px;line-height:1.55">AI 匯入模組目前已停用；仍可上傳附件並在下方手動填寫明細。</div>') : '';
    var payrollTemplates = isPayroll ? '<div style="background:#fff;border:1px solid #f0e0c8;border-radius:8px;padding:9px;margin-bottom:8px"><div style="font-size:12px;font-weight:650;color:#334155;margin-bottom:6px">範本下載與上傳</div><div style="font-size:11px;color:#8b7358;line-height:1.6;margin-bottom:8px">可上傳薪資表、人事費用支出表、104 銀行轉帳明細或勞務報酬單。104 會計用格式只需含「' + htmlEscape(payrollVisibleLabels) + '」；公司別、部門代碼與部門名稱由表單自動帶入，不放進會計用 Excel。</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn-s" onclick="dlHrBankTransferTemplate(\'csv\')">下載104轉帳明細 CSV</button><button type="button" class="btn-s" onclick="dlHrBankTransferTemplate(\'xlsx\')">下載104轉帳明細 Excel</button><button type="button" class="btn-s" onclick="downloadStaticTemplate(\'assets/templates/hr_expense_template.xlsx\',\'人事費用支出.xlsx\')">下載完整人事費用 Excel</button><button type="button" class="btn-s" onclick="downloadStaticTemplate(\'assets/templates/labor_service_fee.docx\',\'勞務報酬單.docx\')">下載勞務報酬單 Word</button></div></div>' : '';
    return '<div style="background:#fffaf3;border:1px solid #efd7b8;border-radius:10px;padding:10px;min-height:100%">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px"><div><div style="font-size:12px;font-weight:650;color:#334155">' + htmlEscape(title) + (required ? ' *' : '') + '</div><div style="font-size:10px;color:#8b7358;margin-top:2px">' + htmlEscape(hint) + '</div></div>' + ocrBtn + '</div>'
      + payrollTemplates
      + '<div class="upload-zone" id="nr-dz" data-mobile-upload-source="camera-photo-files" onclick="document.getElementById(\'nr-file\').click()" ondragover="event.preventDefault();el(\'nr-dz\').classList.add(\'drag\')" ondragleave="el(\'nr-dz\').classList.remove(\'drag\')" ondrop="event.preventDefault();nrFileDrop(event)"><div style="font-size:11px;font-weight:650;letter-spacing:.08em;color:var(--brtxt);margin-bottom:3px">' + (isPayroll ? 'UPLOAD PAYROLL' : 'UPLOAD RECEIPTS') + '</div><div style="font-size:13px;font-weight:650;color:#334155;margin-bottom:3px">' + (isPayroll ? '點擊或拖放薪資表、人事費用支出表或勞務報酬單' : '點擊或拖放發票 / 收據 / PDF') + '</div><div style="font-size:11px;color:#94a3b8;line-height:1.5">' + (isPayroll ? '可從雲端硬碟、手機檔案、相簿或相機選取；Excel、PDF、Word、圖片皆可。' : '可從雲端硬碟、手機檔案、相簿或相機選取；亦可一次選多張 JPG、PNG、PDF、Word、Excel。') + '</div><input type="file" id="nr-file" style="display:none" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onchange="nrFileChange(this)"></div>'
      + (isPayroll ? '' : '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#fff7ed;border:1px solid #f0c987;color:#7c3f00;font-size:11px;line-height:1.55">提醒：請不要把很多張發票拍成同一張照片，OCR 可能只辨識到其中一張。</div>')
      + '<div id="nr-flist" style="margin-top:7px">' + fileList + '</div>'
      + payrollAnalyzeAction
      + (options.ocr ? '<div id="lazy-status" style="font-size:11px;color:#8b7358;margin-top:8px">上傳後按「OpenAI 解析憑據」，下方會產生可編輯表格。</div>' : (isPayroll ? '<div id="lazy-status" style="font-size:11px;color:#8b7358;margin-top:8px">上傳後按「OPENAI 分析」，系統會嘗試讀取薪資表、人事費用表或勞務報酬單，並回填 2-2 即時 Excel 明細表。</div>' : '<div style="font-size:11px;color:#8b7358;margin-top:8px">附件會隨申請單送簽核，主管可下載檢視。</div>'))
      + (options.ocr || isPayroll ? progressHtml : '')
    + '</div>';
  }

  function advanceRequestUploadPanelHtml(deps) {
    var fileList = callDep(deps, 'nrFileListHtml', [180], '');
    return '<div style="background:#fffaf3;border:1px solid #efd7b8;border-radius:10px;padding:10px;min-height:100%">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px"><div><div style="font-size:12px;font-weight:650;color:#334155">預支申請書下載與上傳</div><div style="font-size:10px;color:#8b7358;margin-top:2px;line-height:1.5">請先下載預支申請書填寫完成，再把填好的 Word / Excel / PDF 上傳回本區；這裡不是上傳消費憑據。</div></div><div style="display:flex;gap:5px;flex-shrink:0"><button class="btn-s" onclick="dlAdvanceTemplate(\'doc\')">Word</button><button class="btn-s" onclick="dlAdvanceTemplate(\'xls\')">Excel</button></div></div>'
      + '<div class="upload-zone" id="nr-dz" data-mobile-upload-source="camera-photo-files" onclick="document.getElementById(\'nr-file\').click()" ondragover="event.preventDefault();el(\'nr-dz\').classList.add(\'drag\')" ondragleave="el(\'nr-dz\').classList.remove(\'drag\')" ondrop="event.preventDefault();nrFileDrop(event)"><div style="font-size:11px;font-weight:650;letter-spacing:.08em;color:var(--brtxt);margin-bottom:3px">UPLOAD ADVANCE FORM</div><div style="font-size:13px;font-weight:650;color:#334155;margin-bottom:3px">上傳已填寫的預支申請書</div><div style="font-size:11px;color:#94a3b8;line-height:1.5">可從雲端硬碟、手機檔案、相簿或相機選取 Word、Excel、PDF 或掃描圖片；最後實際花費的發票憑據請於第 8 關再補上。</div><input type="file" id="nr-file" style="display:none" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onchange="nrFileChange(this)"></div>'
      + '<div id="nr-flist" style="margin-top:7px">' + fileList + '</div>'
      + '<div style="font-size:11px;color:#8b7358;margin-top:8px">預支款核准撥付後會先列為暫付款；正式出納放款通過時計入現金流，最後會計依第 8 關補上的正確憑據調整三表。</div>'
    + '</div>';
  }

  function passbookUploadPanelHtml() {
    return '<div style="background:#fffaf3;border:1px solid #efd7b8;border-radius:10px;padding:10px;min-height:100%">'
      + '<div style="font-size:12px;font-weight:650;color:#334155;margin-bottom:8px">上傳存摺封面</div>'
      + '<div class="fg" style="margin:0"><label class="fl">存摺封面（選填）</label><input type="file" id="nr-passbook-file" accept="image/*,.pdf" onchange="passbookFileChange(this)" style="font-size:11px;width:100%"><div id="nr-passbook-status" style="font-size:10px;color:#8b7358;margin-top:5px">可從雲端硬碟、手機檔案、相簿或相機選取存摺封面；系統會嘗試自動帶入 2-3 匯款資訊。</div></div>'
    + '</div>';
  }

  function paymentFieldsHtml(deps) {
    var accountOptions = callDep(deps, 'payeeAccountOptionsHtml', [], '');
    var today = callDep(deps, 'todayIso', [], '');
    return '<div style="background:#fff8ed;border:1px solid #efd7b8;border-radius:9px;padding:9px;margin-bottom:8px">'
      + '<div class="fr2"><div class="fg"><label class="fl">付款方式 *</label><select id="nr-pay-form" onchange="S.nrPay=this.value;updNRAcct()"><option value="bank" selected>銀行轉帳</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">備註：公司是兆豐銀行；收款銀行也是兆豐時不列手續費分錄</div></div><div class="fg"><label class="fl">總金額 *</label><input type="number" id="nr-amt" placeholder="0" oninput="updateNRRouteHealth()"></div></div>'
      + '<div class="fg"><label class="fl">手續費</label><select id="nr-fee-bearer" onchange="syncLazyBankFeeRow(true)"><option value="己方支出">己方支出</option><option value="對方支出">對方支出</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">己方支出且非兆豐收款銀行時，系統會依公司別設定自動切 Dr 6290 手續費，並在即時 Excel 增加免憑證明細</div></div>'
      + '<div class="fg"><label class="fl">常用匯款資料</label><select id="nr-payee-account" onchange="applyPayeeBankAccount(this.value)" style="font-size:11px">' + accountOptions + '</select><div style="font-size:10px;color:#8b7358;margin-top:3px">曾匯款過的收款人會自動建檔；同一人若有多個帳戶，選單會顯示銀行與帳號尾碼方便辨識。</div></div>'
      + '<div class="fg"><label class="fl">收款人 *</label><input id="nr-payee" placeholder="收款人姓名或公司名稱" oninput="refreshPayeeAccountSelect()"></div>'
      + '<div class="fg"><label class="fl">銀行類別 *</label><select id="nr-bank-type" onchange="bankTypeChanged()"><option value="mega">兆豐銀行</option><option value="other">非兆豐銀行</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">選擇非兆豐銀行且手續費為己方支出時，系統會多列公司設定的匯款手續費（預設 15 元）。</div></div>'
      + '<div class="fr3" id="nr-bank-detail"><div class="fg"><label class="fl">銀行資訊 *</label><input id="nr-bank-name" placeholder="例：玉山銀行 / 017 兆豐銀行" oninput="bankNameChanged()"></div><div class="fg"><label class="fl">分行 *</label><input id="nr-bank-branch" required placeholder="例：南京東路分行"></div><div class="fg"><label class="fl">帳號 *</label><input id="nr-bank-no" placeholder="例：808-678-000000"></div></div>'
      + '<div class="fg"><label class="fl">預計匯款日 *</label><input type="date" id="nr-paydate" value="' + htmlEscape(today) + '" oninput="this.dataset.userEdited=\'1\'" onchange="this.dataset.userEdited=\'1\'"></div>'
      + '</div>';
  }

  function hrBatchPaymentFieldsHtml(deps) {
    var today = callDep(deps, 'todayIso', [], '');
    return '<div style="background:#fff8ed;border:1px solid #efd7b8;border-radius:9px;padding:9px;margin-bottom:8px">'
      + '<div class="fr2"><div class="fg"><label class="fl">付款方式 *</label><select id="nr-pay-form" onchange="S.nrPay=this.value;updNRAcct()"><option value="bank" selected>銀行轉帳（整批匯款）</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">人事費用以薪資表或人事費用明細整批撥款，不填個別收款人與個別銀行資料。</div></div><div class="fg"><label class="fl">總金額 *</label><input type="number" id="nr-amt" placeholder="0" readonly></div></div>'
      + '<div class="fr2"><div class="fg"><label class="fl">整批匯款銀行類別 *</label><select id="hr-bank-type" onchange="hrTransferFeeChanged()"><option value="mega" selected>全數兆豐銀行</option><option value="other">含非兆豐銀行</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">若 104 清冊列出銀行代號，系統會以每列銀行判斷；空白時以此選項判斷。</div></div><div class="fg"><label class="fl">非兆豐轉帳費</label><select id="hr-fee-bearer" onchange="hrTransferFeeChanged()"><option value="對方支出" selected>對方吸收</option><option value="己方支出">我們自行吸收</option></select><div style="font-size:10px;color:#8b7358;margin-top:3px">選擇我們自行吸收時，非兆豐每筆依公司設定手續費計算；Excel 固定 7 欄，手續費會進摘要與備註。</div></div></div>'
      + '<div class="fg"><label class="fl">預計整批匯款日 *</label><input type="date" id="nr-paydate" value="' + htmlEscape(today) + '"></div>'
      + '</div>';
  }

  var api = {
    defaultFieldConfigs: defaultFieldConfigs,
    normalizeFormType: normalizeFormType,
    coerceMoney: coerceMoney,
    requiredMark: requiredMark,
    protectedFieldKeys: protectedFieldKeys,
    isProtectedField: isProtectedField,
    enforceProtectedFields: enforceProtectedFields,
    normalizeFieldConfigs: normalizeFieldConfigs,
    fieldConfig: fieldConfig,
    fieldMeta: fieldMeta,
    visible: visible,
    required: required,
    label: label,
    hint: hint,
    requiredNote: requiredNote,
    missingRequiredItems: missingRequiredItems,
    travelFieldsHtml: travelFieldsHtml,
    travelExpenseItemHtml: travelExpenseItemHtml,
    travelAttachmentGuideHtml: travelAttachmentGuideHtml,
    travelSheetHtml: travelSheetHtml,
    travelKindLabel: travelKindLabel,
    travelRateTier: travelRateTier,
    travelRateTierLabel: travelRateTierLabel,
    travelHasAmountLimit: travelHasAmountLimit,
    travelPeopleSummary: travelPeopleSummary,
    travelPersonRowHtml: travelPersonRowHtml,
    nrFileListHtml: nrFileListHtml,
    receiptUploadPanelHtml: receiptUploadPanelHtml,
    advanceRequestUploadPanelHtml: advanceRequestUploadPanelHtml,
    passbookUploadPanelHtml: passbookUploadPanelHtml,
    paymentFieldsHtml: paymentFieldsHtml,
    hrBatchPaymentFieldsHtml: hrBatchPaymentFieldsHtml,
  };

  global.FinanceV4Engines.register('forms', api);
  global.FinanceFormEngine = api;
})(window);
