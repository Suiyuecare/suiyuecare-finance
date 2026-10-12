(function (global) {
  'use strict';
  var runtime = null, identityVersion = 0, identityKey = '', pending = new Map();
  var labels = {
    no_import_record: '尚無銀行匯入紀錄', needs_reconciliation: '銀行項目待核對',
    empty_statement_requires_review: '空白對帳單待確認', matched_records: '已匯入項目已配對',
    no_accrual_record: '尚無薪資應計紀錄，需確認是否適用', pending_review: '薪資應計待處理',
    posted_records: '已有薪資應計入帳紀錄', requires_private_review: '需由有薪資權限的人員確認',
    not_applicable_test_environment: '測試環境不含正式薪資'
  };
  function h(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function currentIdentity() {
    if (!runtime) return '';
    var user = runtime.user ? runtime.user() : runtime.getActor ? runtime.getActor() : {};
    return JSON.stringify([runtime.tenant ? runtime.tenant() : '', runtime.environment ? runtime.environment() : runtime.getEnvironment ? runtime.getEnvironment() : 'production', user && (user.id || user.actorId), user && (user.auth_user_id || user.authUserId), runtime.permissionIdentity ? runtime.permissionIdentity() : '', runtime.identityBlocked ? runtime.identityBlocked() : false]);
  }
  function syncIdentity() { var next = currentIdentity(); if (next !== identityKey) { identityKey = next; identityVersion++; pending.clear(); } return identityVersion; }
  function installRuntime(value) { runtime = value; identityKey = ''; identityVersion++; pending.clear(); syncIdentity(); return api; }
  function environment() { return runtime.environment ? runtime.environment() : runtime.getEnvironment ? runtime.getEnvironment() : 'production'; }
  function args(scope) {
    if (!runtime) throw new Error('月結工作台尚未連線。');
    if (!scope || !scope.entityId || scope.entityId === 'all' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(scope.period || '')) throw new Error('請選擇單一法人及月結月份。');
    if (runtime.identityBlocked && runtime.identityBlocked()) throw new Error('請先完成登入身分確認。');
    return { p_entity_id: scope.entityId, p_period: scope.period, p_data_environment: environment() };
  }
  async function call(name, payload) {
    var version = syncIdentity(), expected = identityKey;
    var reading = name === 'finance_month_workspace_v1' || name === 'finance_month_snapshot_read_v1';
    var controller = reading && typeof global.AbortController === 'function' ? new global.AbortController() : null;
    var operation = runtime.rpc ? runtime.rpc(name, payload) : runtime.db.rpc(name, payload);
    if (controller && operation && typeof operation.abortSignal === 'function') operation = operation.abortSignal(controller.signal);
    var result = await new Promise(function (resolve, reject) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) return; settled = true;
        if (controller) controller.abort();
        var error = new Error(reading ? '月結資料讀取逾時，請重新讀取。' : '尚未確認這次操作是否完成，請先重新讀取最新快照，確認結果後再操作。');
        error.code = reading ? 'FINANCE_READ_TIMEOUT' : 'FINANCE_RESULT_UNKNOWN'; reject(error);
      }, reading ? 12000 : 30000);
      Promise.resolve(operation).then(function (value) { if (settled) return; settled = true; global.clearTimeout(timer); resolve(value); }, function (error) { if (settled) return; settled = true; global.clearTimeout(timer); reject(error); });
    });
    syncIdentity();
    if (version !== identityVersion || expected !== identityKey) throw new Error('登入身分或權限已變更，請重新載入月結資料。');
    if (result && result.error) { var err = new Error(result.error.message || '月結操作未完成。'); err.code = result.error.code; throw err; }
    return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
  }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  function money(value) { return number(value) === null ? '尚未確認' : 'NT$' + new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value); }
  function buildWorkspace(raw) {
    if (!raw || !raw.sourceFingerprint || !raw.entityId || !raw.period || !raw.ledgerSummary || !raw.bank || !raw.payroll || !Array.isArray(raw.periodCloses)) throw new Error('月結資料回應不完整，請重新載入。');
    var ledger = raw.ledgerSummary, bank = raw.bank, checks = raw.periodChecks || {}, rows = [], gaps = [];
    function row(key, label, status, detail, complete) { rows.push({ key: key, label: label, status: status, detail: detail, complete: !!complete }); if (!complete) gaps.push(label); }
    row('profile', '報表設定', raw.profileConfigured ? '已設定' : '尚未設定', raw.profileConfigured ? '已指定會計架構；科目與報表仍須核對。' : '先確認會計架構、期初餘額及科目對照。', raw.profileConfigured === true);
    row('ledger', '分類帳與試算', ledger.count > 0 ? ledger.balanced ? '借貸相符' : '借貸不平' : '尚無入帳紀錄', '借方 ' + money(ledger.debit) + '／貸方 ' + money(ledger.credit), ledger.count > 0 && ledger.balanced === true);
    row('bank', '銀行對帳', labels[bank.status] || '狀態待確認', '匯入 ' + (number(bank.importCount) === null ? '待確認' : bank.importCount) + ' 批；未配對 ' + (number(bank.unmatchedCount) === null ? '待確認' : bank.unmatchedCount) + ' 筆。已配對不代表期末銀行餘額已確認。', bank.status === 'matched_records' && checks.bankReconciled === true);
    row('payroll', '薪資應計', labels[raw.payroll.status] || '尚待確認', '依薪資歸屬月份核對；沒有紀錄不代表當月沒有薪資。', raw.payroll.status === 'posted_records' || raw.payroll.status === 'not_applicable_test_environment');
    if (raw.assets) { var assetLabels = { no_register_records: '尚無資產／預付登錄，需確認是否適用', no_due_this_month: '現有登錄本月無排程', pending_amortization: '本月折舊／攤提待處理', posted_records: '本月排程已入帳' }; row('assets', '固定資產與預付攤提', assetLabels[raw.assets.status] || '尚待確認', '本月排程 ' + raw.assets.scheduledCount + ' 筆；待處理 ' + raw.assets.pendingCount + ' 筆。', raw.assets.status === 'posted_records' || raw.assets.status === 'no_due_this_month'); }
    var closed = raw.periodCloses.length > 0 && raw.periodCloses.every(function (x) { return x.status === 'closed'; });
    row('close', '正式關帳', closed ? '已關帳' : raw.periodCloses.length ? '尚未關帳' : '尚無關帳紀錄', '採用與分類帳禁止過帳相同的正式關帳紀錄。', closed);
    row('archive', '原始憑證封存', raw.verifiedArchiveCount > 0 ? '已有封存驗證紀錄' : raw.archiveCount > 0 ? '已有封存，待驗證' : '尚無封存紀錄', '封存 ' + (raw.archiveCount || 0) + ' 批／已驗證 ' + (raw.verifiedArchiveCount || 0) + ' 批；仍須確認涵蓋本期全部憑證。', raw.verifiedArchiveCount > 0);
    var checksReady = ['openingBalanceVerified', 'bankReconciled', 'taxReconciled', 'periodCloseReady', 'ociReviewed'].every(function (key) { return checks[key] === true; });
    row('checks', '會計核對清單', checksReady ? '已填寫核對結果' : '仍有待確認項目', '包含期初、銀行、稅務、其他綜合損益及本期結帳；這是人員核對紀錄。', checksReady);
    return { raw: raw, rows: rows, gaps: gaps, recordedChecksComplete: gaps.length === 0, latestSnapshot: raw.latestSnapshot || null, canPrepare: raw.canPrepare === true };
  }
  function renderWorkspace(input) {
    var model = input && input.rows ? input : buildWorkspace(input), snapshot = model.latestSnapshot;
    var snapshotText = !snapshot ? '尚未建立快照' : '版本 ' + snapshot.revision + '・' + (snapshot.reviewedAt ? '已獨立覆核' : '待另一位授權人員覆核') + (snapshot.isCurrent ? '' : '・來源已變動，需建立新版本');
    return '<section class="card finance-month-workspace" aria-label="月結作業檢查"><div class="chd"><h3 class="cht">月結作業檢查</h3><span>' + h(model.raw.period) + '</span></div>' +
      '<div style="padding:16px;min-width:0"><p>各項狀態來自正式紀錄。缺少資料不會自動視為完成；內部快照覆核不等於正式財報簽證。</p>' +
      '<dl style="margin:0">' + model.rows.map(function (row) { return '<div style="padding:12px 0;border-bottom:1px solid var(--border,#ead8c4);overflow-wrap:anywhere"><dt style="font-weight:600">' + h(row.label) + '：' + h(row.status) + '</dt><dd style="margin:4px 0 0">' + h(row.detail) + '</dd></div>'; }).join('') + '</dl>' +
      '<p data-month-snapshot-status>' + h(snapshotText) + '</p><label style="display:block">建立／覆核說明<textarea data-month-reason maxlength="2000" rows="2" style="display:block;width:100%;box-sizing:border-box" placeholder="說明核對範圍、已確認內容或待補事項"></textarea></label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn-g" data-month-action="reload" style="min-height:44px">重新讀取</button>' +
      (model.canPrepare ? '<button type="button" class="btn-p" data-month-action="prepare" style="min-height:44px">建立本期快照</button>' : '') +
      (snapshot && snapshot.canReview ? '<button type="button" class="btn-p" data-month-action="review" style="min-height:44px">覆核此版本</button>' : '') +
      (snapshot ? '<button type="button" class="btn-g" data-month-action="download" style="min-height:44px">下載快照資料</button>' : '') + '</div><p data-month-message role="status" aria-live="polite"></p></div></section>';
  }
  async function loadWorkspace(scope) { var payload = args(scope), raw = await call('finance_month_workspace_v1', payload); if (raw.entityId !== payload.p_entity_id || raw.period !== payload.p_period || raw.environment !== payload.p_data_environment) throw new Error('月結回應的法人、月份或環境不符。'); return buildWorkspace(raw); }
  function reasonText(reason) { var value = String(reason || '').trim(); if (!value || value.length > 2000) throw new Error('請填寫 1 至 2000 字的說明。'); return value; }
  function uuid() { if (!global.crypto || typeof global.crypto.randomUUID !== 'function') throw new Error('目前瀏覽器無法建立安全操作識別碼，請更新瀏覽器。'); return global.crypto.randomUUID(); }
  function single(key, run) { syncIdentity(); var scoped = identityKey + '|' + key; if (pending.has(scoped)) return pending.get(scoped); var promise = Promise.resolve().then(run); pending.set(scoped, promise); promise.finally(function () { if (pending.get(scoped) === promise) pending.delete(scoped); }).catch(function () {}); return promise; }
  function prepareSnapshot(scope, model, reason, operationId) {
    var payload = args(scope), raw = model.raw || model;
    if (raw.entityId !== scope.entityId || raw.period !== scope.period || raw.environment !== payload.p_data_environment) return Promise.reject(new Error('月結範圍已變更，請重新載入。'));
    payload.p_expected_revision = raw.latestSnapshot ? raw.latestSnapshot.revision : 0; payload.p_expected_fingerprint = raw.sourceFingerprint;
    payload.p_reason = reasonText(reason);
    return single('prepare|' + scope.entityId + '|' + scope.period, function () { payload.p_operation_id = operationId || uuid(); return call('finance_month_snapshot_prepare_v1', payload); });
  }
  function reviewSnapshot(model, reason) { var snapshot = model.latestSnapshot || model.raw && model.raw.latestSnapshot; if (!snapshot || !snapshot.canReview) return Promise.reject(new Error('此快照尚不可覆核，請重新載入。')); var value = reasonText(reason); return single('review|' + snapshot.id, function () { return call('finance_month_snapshot_review_v1', { p_snapshot_id: snapshot.id, p_expected_fingerprint: snapshot.sourceFingerprint, p_reason: value }); }); }
  function readSnapshot(id) { return call('finance_month_snapshot_read_v1', { p_snapshot_id: id }); }
  function mount(container, scope) {
    var version = syncIdentity(), model = null, disposed = false, generation = 0;
    function active() { syncIdentity(); return !disposed && version === identityVersion && container.isConnected !== false; }
    function message(text) { var node = container.querySelector('[data-month-message]'); if (node) node.textContent = text; }
    function busy(value) { container.querySelectorAll('[data-month-action]').forEach(function (b) { b.disabled = value; }); container.setAttribute('aria-busy', String(value)); }
    async function reload() { var current = ++generation; container.setAttribute('aria-busy', 'true'); try { var next = await loadWorkspace(scope); if (active() && current === generation) { model = next; container.innerHTML = renderWorkspace(next); } } catch (error) { if (active() && current === generation) { container.innerHTML = '<section class="card" style="padding:16px"><p role="alert">' + h(error.message) + '</p><button type="button" class="btn-g" data-month-action="reload">重新讀取</button></section>'; } } finally { if (active() && current === generation) container.setAttribute('aria-busy', 'false'); } }
    async function clicked(event) {
      var button = event.target.closest('[data-month-action]'); if (!button || !container.contains(button) || button.disabled) return;
      if (!active()) { container.innerHTML = '<p role="alert">登入身分已變更，請重新開啟此頁。</p>'; return; }
      if (button.dataset.monthAction === 'reload') { await reload(); return; }
      if (!model) return;
      busy(true); var action = button.dataset.monthAction, reason = container.querySelector('[data-month-reason]');
      try {
        if (action === 'prepare') await prepareSnapshot(scope, model, reason && reason.value);
        else if (action === 'review') await reviewSnapshot(model, reason && reason.value);
        else if (action === 'download') {
          var result = await readSnapshot(model.latestSnapshot.id); if (!active()) return;
          var url = global.URL.createObjectURL(new global.Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
          var link = global.document.createElement('a'); link.href = url; link.download = '月結快照-' + scope.period + '-v' + result.revision + '.json'; link.click(); global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
          message('已下載內部來源快照；其中保留原版本及覆核狀態。');return;
        }
        if (!active()) return; await reload(); if (active()) message(action === 'review' ? '此版本已記錄獨立覆核；仍需完成畫面列出的待處理項目。' : '已建立不可覆寫的來源快照，請由另一位授權人員覆核。');
      } catch (error) { if (active()) message(error.message + (action === 'prepare' || action === 'review' ? ' 如連線中斷，請先重新讀取確認最新版本及覆核狀態。' : '')); }
      finally { if (active()) busy(false); }
    }
    container.addEventListener('click', clicked); container.innerHTML = '<p role="status">正在讀取月結紀錄…</p>'; var ready = reload();
    return { ready: ready, reload: reload, dispose: function () { disposed = true; generation++; container.removeEventListener('click', clicked); container.innerHTML = ''; } };
  }
  var api = { installRuntime: installRuntime, buildWorkspace: buildWorkspace, renderWorkspace: renderWorkspace, loadWorkspace: loadWorkspace, prepareSnapshot: prepareSnapshot, reviewSnapshot: reviewSnapshot, readSnapshot: readSnapshot, mount: mount, clear: function () { identityVersion++; pending.clear(); } };
  global.FinanceMonthCloseWorkspace = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
