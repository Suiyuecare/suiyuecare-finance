(function (global) {
  'use strict';
  var active = null;
  var labels = { awaiting_payment_validation: '核對銀行付款清冊', pending_bank_upload: '會計上傳兆豐', pending_account_check: '會計項目檢核', pending_cashier: '出納登錄放款結果', pending_applicant: '待原申請人確認', pending_voucher: '建立付款傳票並結案', closed: '已入帳結案' };
  var actions = { awaiting_payment_validation: 'bank_batch_validation', pending_bank_upload: 'bank_upload', pending_account_check: 'accounting_review', pending_cashier: 'bank_disbursement', pending_voucher: 'post_voucher' };
  var eventLabels = { received: '收到人資核准資料', bank_batch_validation: '核對銀行付款清冊', bank_upload: '登錄兆豐上傳結果', accounting_review: '完成會計項目檢核', bank_disbursement: '登錄放款結果', applicant_confirmation: '原申請人確認', posted_voucher: '核對傳票並結案' };
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(cents) { return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 2 }).format(cents / 100); }
  function dispose() { if (active) { active.alive = false; active.rows = []; active.pending = null; active.element.replaceChildren(); } active = null; }
  function valid(ctx) { return ctx.alive && active === ctx && ctx.isCurrent(); }
  function current(ctx, generation) { return valid(ctx) && ctx.generation === generation; }
  function permissionDenied(error) { return !!error && (error.code === '42501' || ['PGRST301', 'PGRST302', 'PGRST303'].indexOf(error.code) >= 0 || [401, 403].indexOf(error.status) >= 0 || error.context && [401, 403].indexOf(error.context.status) >= 0); }
  function deny(ctx, error) {
    // A denial from any request of this identity invalidates every in-flight read.
    if (!valid(ctx) || !permissionDenied(error)) return false;
    ctx.generation += 1; ctx.rows = []; ctx.pending = null; ctx.busy = false;
    ctx.element.querySelector('[data-hr-list]').replaceChildren();
    message(ctx, '目前無權讀取此薪資資料，已清除畫面內容。請確認授權後重新讀取。');
    return true;
  }
  function message(ctx, text) { if (valid(ctx)) { var node = ctx.element.querySelector('[data-hr-message]'); if (node) node.textContent = text; } }
  function shell(ctx) {
    ctx.element.innerHTML = '<div class="ph">人資付款交接</div><p class="ps">依人資核准版本核對清冊、登錄銀行處理結果，最後確認傳票。每一關保留實際處理人與佐證。</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button class="btn-s" type="button" data-hr-refresh>重新讀取</button></div><p role="status" aria-live="polite" data-hr-message></p><div data-hr-list></div>';
    ctx.element.querySelector('[data-hr-refresh]').addEventListener('click', function () { load(ctx); });
  }
  async function load(ctx) {
    if (!valid(ctx) || ctx.busy) return false;
    var generation = ++ctx.generation;
    ctx.rows = []; ctx.element.querySelector('[data-hr-list]').replaceChildren(); message(ctx, '正在確認權限與交接資料…');
    try {
      var response = await ctx.client.rpc('finance_hr_snapshot', {});
      if (response.error) throw response.error;
      if (!current(ctx, generation)) return false;
      ctx.rows = response.data && Array.isArray(response.data.obligations) ? response.data.obligations : [];
      if (ctx.pending) { var pendingRow = ctx.rows.find(function (row) { return row.obligationId === ctx.pending.obligationId; }); if (!pendingRow || pendingRow.financeVersion > ctx.pending.version) ctx.pending = null; }
      message(ctx, ctx.rows.length ? '共 ' + ctx.rows.length + ' 筆交接資料。' : '目前沒有可查看的交接資料。尚未送件或尚未完成薪資資料授權時，這裡會保持空白。');
      render(ctx); return true;
    } catch (error) { if (deny(ctx, error) || !current(ctx, generation)) return false; ctx.rows = []; ctx.element.querySelector('[data-hr-list]').replaceChildren(); message(ctx, '交接資料暫時無法讀取。請確認正式服務與薪資授權後重新讀取。'); return false; }
  }
  function render(ctx) {
    if (!valid(ctx)) return;
    var list = ctx.element.querySelector('[data-hr-list]'); list.replaceChildren();
    ctx.rows.forEach(function (row) {
      var card = document.createElement('section'); card.className = 'card'; card.style.cssText = 'padding:16px;margin:12px 0;overflow-wrap:anywhere';
      var actor = (row.route || [])[row.stageIndex]; var action = actions[row.status];
      var canAct = !!action && actor && actor.actorId === ctx.userId && row.amountsVisible;
      card.innerHTML = '<h2 style="font-size:16px;margin:0 0 8px">' + escape(row.period) + ' ' + (row.kind === 'bonus' ? '單獨獎金' : '月薪') + ' · ' + escape(row.legalEntityCode) + '</h2><p>' + escape(labels[row.status] || '待確認狀態') + ' · 預定發放 ' + escape(row.payDate) + '</p><p>核准實發總額：<strong>' + (row.amountsVisible ? escape(money(row.totalNetCents)) : '無查看權限') + '</strong></p><p style="font-size:12px">交接識別：' + escape(row.obligationId) + ' · 版本 ' + escape(row.financeVersion) + '</p><details><summary>處理紀錄</summary><ol>' + (row.events || []).map(function (ev) { return '<li>' + escape(eventLabels[ev.action] || ev.action) + ' · 已由：' + escape(ev.actor && ev.actor.name || '') + ' · ' + escape(ev.occurredAt) + '</li>'; }).join('') + '</ol></details>';
      if (row.status === 'pending_applicant') { var note = document.createElement('p'); note.textContent = '請原申請人回到人資系統完成確認，之後會送回會計核對傳票。'; card.appendChild(note); }
      if (row.status === 'closed') showVoucher(ctx, row, card);
      if (canAct && action === 'post_voucher') { voucherForm(ctx, row, card); }
      if (canAct && action !== 'post_voucher') {
        var form = document.createElement('form'); form.style.cssText = 'margin-top:14px;display:grid;gap:12px;max-width:640px';
        var monetary = ['bank_batch_validation', 'bank_upload', 'bank_disbursement'].indexOf(action) >= 0;
        form.innerHTML = '<label class="fg">' + (action === 'posted_voucher' ? '已入帳傳票識別碼' : '銀行收件／交易序號或查核紀錄編號') + '<input name="reference" required maxlength="200" autocomplete="off"></label>'
          + (monetary ? '<label class="fg">佐證上的實發總額（元）<input name="amount" required inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="請照清冊或銀行結果填寫"></label>' : '')
          + '<label class="fg">佐證文件<input name="evidence" type="file" required accept=".pdf,.csv,.xlsx,.png,.jpg,.jpeg"></label><p class="ps">會計需另行準備銀行付款清冊並逐筆核對收款帳號；本頁只核對實發總額，不產製兆豐匯款檔。請填寫原始佐證的可追溯編號，系統記錄文件指紋，文件由公司文管保存。</p>'
          + (action === 'bank_disbursement' ? '<p>僅在銀行已完成放款且結果可核對後登錄。本功能不會代為操作銀行轉帳。</p>' : '')
          + '<button class="btn-p" type="submit">' + escape(labels[row.status]) + '</button>';
        form.addEventListener('submit', function (event) { event.preventDefault(); submit(ctx, row, action, form); }); card.appendChild(form);
      }
      var sync = document.createElement('button'); sync.type = 'button'; sync.className = 'btn-s'; sync.style.marginTop = '12px'; sync.textContent = '同步進度至人資'; sync.addEventListener('click', function () { flush(ctx, row.obligationId); }); card.appendChild(sync);
      list.appendChild(card);
    });
  }
  async function showVoucher(ctx, row, card) {
    var generation = ctx.generation;
    try { var result = await ctx.client.rpc('finance_hr_voucher_options', { p_obligation_id: row.obligationId }); if (result.error) throw result.error; if (!current(ctx, generation) || !card.isConnected) return; if (!result.data || !result.data.voucher) return;
      var v = result.data.voucher, detail = document.createElement('details'); detail.innerHTML = '<summary>查看已入帳傳票 ' + escape(v.id) + '</summary><p>' + escape(v.date) + ' · ' + escape(v.description) + '</p><ul style="padding-left:20px;margin:8px 0">' + v.entries.map(function (entry) { return '<li>' + (entry.t === 'dr' ? '借方 ' : '貸方 ') + escape(entry.ac) + ' ' + escape(entry.an) + '：' + escape(money(Math.round(entry.amt * 100))) + '</li>'; }).join('') + '</ul>'; card.appendChild(detail);
    } catch (error) { if (!deny(ctx, error) && current(ctx, generation)) message(ctx, '傳票明細暫時未能讀取，請重新讀取。'); }
  }
  async function voucherForm(ctx, row, card) {
    var generation = ctx.generation;
    var note = document.createElement('p'); note.textContent = '正在讀取可用會計科目…'; card.appendChild(note);
    try { var response = await ctx.client.rpc('finance_hr_voucher_options', { p_obligation_id: row.obligationId }); if (response.error) throw response.error; if (!current(ctx, generation) || !card.isConnected) return;
      var accounts = response.data.accounts || [], options = '<option value="">請選擇科目</option>' + accounts.map(function (a) { return '<option value="' + escape(a.code) + '">' + escape(a.code + ' ' + a.name) + '</option>'; }).join('');
      var form = document.createElement('form'); form.style.cssText = 'margin-top:14px;display:grid;gap:12px;max-width:640px'; form.dataset.voucher = 'true';
      form.innerHTML = '<p>本張記錄已放款的實發淨額結算。請會計依已完成的薪資提列選擇清償科目與銀行科目，避免重複認列薪資費用；本張不自動計提應發薪資、保險或扣繳。</p><label class="fg">入帳日期（依實際付款憑證）<input name="voucherDate" type="date" required value="' + escape(row.payDate) + '"></label><div data-entry-list></div><button type="button" class="btn-s" data-add-entry>新增借貸分錄</button><p data-entry-total aria-live="polite"></p><label class="fg">核對紀錄編號<input name="reference" required maxlength="200"></label><label class="fg">入帳佐證文件<input name="evidence" type="file" required accept=".pdf,.csv,.xlsx,.png,.jpg,.jpeg"></label><p class="ps">文件指紋保存在受限的人資交接紀錄；原件請依公司文管方式保存。一般帳簿僅記錄本批彙總分錄。</p><label><input type="checkbox" name="reviewed" required style="width:16px;height:16px;padding:0;display:inline;vertical-align:middle"> 我已核對科目、借貸金額及入帳日期，確認建立正式傳票並結案。</label><button class="btn-p" type="submit">建立傳票、入帳並結案</button>';
      var lines = form.querySelector('[data-entry-list]');
      function sum() { var dr = 0, cr = 0; lines.querySelectorAll('[data-entry]').forEach(function (line) { var n = Math.round(Number(line.querySelector('[data-entry-amount]').value) * 100); if (line.querySelector('[data-entry-side]').value === 'dr') dr += n; else cr += n; }); form.querySelector('[data-entry-total]').textContent = '借方 ' + money(dr) + ' ／ 貸方 ' + money(cr) + ' ／ 核准實發 ' + money(row.totalNetCents); }
      function add(side, cents) { if (lines.children.length >= 50) return; var line = document.createElement('div'); line.dataset.entry = 'true'; line.style.cssText = 'display:grid;gap:8px;border:1px solid #ddd;padding:12px;margin-bottom:8px;border-radius:8px'; line.innerHTML = '<label class="fg">借貸方向<select data-entry-side required><option value="dr">借方</option><option value="cr">貸方</option></select></label><label class="fg">會計科目<select data-entry-account required>' + options + '</select></label><label class="fg">金額（元）<input data-entry-amount required type="number" min="0.01" step="0.01" value="' + (cents ? cents / 100 : '') + '"></label><button type="button" class="btn-s">移除此列</button>'; line.querySelector('[data-entry-side]').value = side; line.querySelector('button').addEventListener('click', function () { line.remove(); sum(); }); line.addEventListener('input', sum); lines.appendChild(line); }
      add('dr', row.totalNetCents); add('cr', row.totalNetCents); sum(); form.querySelector('[data-add-entry]').addEventListener('click', function () { add('dr', 0); }); form.addEventListener('submit', function (e) { e.preventDefault(); submit(ctx, row, 'post_voucher', form); }); note.remove(); card.appendChild(form);
    } catch (error) { if (!deny(ctx, error) && current(ctx, generation)) note.textContent = '會計科目暫時無法讀取，請確認權限後重新讀取。'; }
  }
  async function flush(ctx, obligationId) {
    if (!valid(ctx)) return;
    var generation = ctx.generation;
    try { var res = await ctx.client.functions.invoke('hr-payroll-intake', { body: { type: 'callback.flush', obligationId: obligationId } }); if (res.error || !res.data || res.data.accepted !== true) throw res.error || new Error('SYNC'); if (!current(ctx, generation)) return; message(ctx, res.data.callbackPending ? 'Finance 紀錄已保留，還有進度等待同步至人資，可稍後重試。' : '進度已同步至人資系統。'); }
    catch (error) { if (!deny(ctx, error) && current(ctx, generation)) message(ctx, 'Finance 紀錄已保留，人資進度同步尚待完成。可稍後按「同步進度至人資」重試。'); }
  }
  async function submit(ctx, row, action, form) {
    if (!valid(ctx) || ctx.busy || !form.reportValidity()) return;
    var generation = ctx.generation;
    var values = new FormData(form), file = values.get('evidence');
    if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024) { message(ctx, '請選擇 10 MB 以內的佐證文件。'); return; }
    ctx.busy = true; form.querySelector('button[type="submit"]').disabled = true;
    try {
      var digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      if (!current(ctx, generation)) return;
      var ev = { kind: action === 'post_voucher' ? 'posted_voucher' : action, reference: String(values.get('reference')).trim(), sha256: digest };
      if (values.has('amount')) { var parts = String(values.get('amount')).split('.'); ev.totalNetCents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0')); if (!Number.isSafeInteger(ev.totalNetCents) || ev.totalNetCents !== row.totalNetCents) throw new Error('AMOUNT'); }
      if (action === 'posted_voucher') ev.voucherId = ev.reference;
      var entries = action === 'post_voucher' ? Array.from(form.querySelectorAll('[data-entry]')).map(function (line) { return { t: line.querySelector('[data-entry-side]').value, ac: line.querySelector('[data-entry-account]').value, amt: Number(line.querySelector('[data-entry-amount]').value) }; }) : null;
      if (entries && (entries.length < 2 || entries.reduce(function (s, x) { return s + (x.t === 'dr' ? Math.round(x.amt * 100) : 0); }, 0) !== row.totalNetCents || entries.reduce(function (s, x) { return s + (x.t === 'cr' ? Math.round(x.amt * 100) : 0); }, 0) !== row.totalNetCents)) throw new Error('BALANCE');
      var key = JSON.stringify([row.obligationId, row.financeVersion, action, ev, entries, values.get('voucherDate')]);
      if (ctx.pending && ctx.pending.key !== key) throw new Error('PENDING');
      if (!ctx.pending) ctx.pending = { key: key, requestId: crypto.randomUUID(), obligationId: row.obligationId, version: row.financeVersion };
      var result = action === 'post_voucher' ? await ctx.client.rpc('finance_hr_post_voucher', { p_obligation_id: row.obligationId, p_expected_version: row.financeVersion, p_request_id: ctx.pending.requestId, p_voucher_date: values.get('voucherDate'), p_entries: entries, p_evidence: ev }) : await ctx.client.rpc('finance_hr_command', { p_obligation_id: row.obligationId, p_expected_version: row.financeVersion, p_request_id: ctx.pending.requestId, p_action: action, p_evidence: ev });
      if (result.error) { if (current(ctx, generation) && /^[0-9A-Z]{5}$/.test(result.error.code || '')) ctx.pending = null; throw result.error; }
      if (!current(ctx, generation)) return;
      ctx.pending = null; ctx.busy = false; if (await load(ctx)) await flush(ctx, row.obligationId);
    } catch (error) { if (deny(ctx, error) || !current(ctx, generation)) return; message(ctx, error && error.message === 'BALANCE' ? '借方與貸方都必須等於核准實發總額，尚未入帳。' : error && /期間已關閉/.test(error.message) ? '此會計期間已關帳，請改用開放期間的日期；本次尚未入帳。' : error && error.message === 'AMOUNT' ? '佐證總額與人資核准實發總額不符，尚未送出。' : error && error.message === 'PENDING' ? '上一筆處理結果仍待確認，請保持原填寫內容重試或重新讀取狀態。' : '目前未能確認完成。請保留佐證並重新讀取狀態；相同內容重試會避免重複登錄。'); }
    finally { if (current(ctx, generation)) { ctx.busy = false; if (form.isConnected) form.querySelector('button[type="submit"]').disabled = false; } }
  }
  global.FinanceHrBridge = { mount: function (element, options) { dispose(); var ctx = Object.assign({ element: element, rows: [], pending: null, alive: true, busy: false, generation: 0 }, options); active = ctx; shell(ctx); load(ctx); }, dispose: dispose, escape: escape };
})(window);
