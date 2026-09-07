(function (global) {
  'use strict';
  // This module never updates REQS optimistically and never treats a checkbox
  // as proof of cash. Every action uses the server's versioned correction RPC.
  var operations = Object.create(null);
  var dialog = null;
  var trigger = null;
  var serial = 0;
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function identity() {
    return [global.currentTenantId(), global.activeDataEnvironment(), (global.S.user || {}).id,
      (global.S.user || {}).authUserId || (global.S.user || {}).auth_user_id || ''].join('|');
  }
  function guardIdentity(expected) {
    if (!global.S || global.S.demoLogin || !global.hasSupabase() || !global.S.user || identity() !== expected) {
      throw new Error('登入身分或環境已變更，請重新開啟更正流程；先前輸入不會送到其他帳號。');
    }
  }
  function amount(value) { return 'NT$' + Number(value || 0).toLocaleString('zh-TW'); }
  function userName(id) {
    var user = typeof global.userById === 'function' ? global.userById(id) : null;
    return user ? (user.n || user.name || id) : (id || '尚未指定');
  }
  function errorMessage(error) {
    return error && (error.message || error.details || error.detail) || '服務暫時無法確認結果，請保留目前畫面再試；不要另開重複提案。';
  }
  function close() {
    if (dialog) { dialog.close(); dialog.remove(); dialog = null; }
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }
  function show(title, body) {
    close(); trigger = document.activeElement;
    dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(1040px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid #dfc7a8;border-radius:16px;color:#3b2410;background:#fffcf8';
    dialog.innerHTML = '<div style="padding:20px;box-sizing:border-box"><div style="display:flex;justify-content:space-between;gap:16px;align-items:center">'
      + '<h2 id="finance-correction-title" style="margin:0;font-size:22px">' + escapeHtml(title) + '</h2>'
      + '<button type="button" data-close aria-label="關閉金額更正">關閉 ×</button></div>'
      + '<p data-feedback role="status" aria-live="polite" style="line-height:1.6"></p><div data-body>' + body + '</div></div>';
    dialog.setAttribute('aria-labelledby', 'finance-correction-title');
    document.body.appendChild(dialog);
    dialog.querySelector('[data-close]').onclick = close;
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) close(); });
    dialog.showModal();
    return dialog;
  }
  function message(container, text, failed) {
    var feedback = container.querySelector('[data-feedback]');
    feedback.textContent = text;
    feedback.style.color = failed ? '#9b1c1c' : '#38633b';
  }
  function linesHtml(lines) {
    return '<div style="overflow:auto;margin:12px 0"><table style="min-width:620px;width:100%;border-collapse:collapse"><thead><tr>'
      + '<th>明細</th><th>未稅／費用</th><th>進項稅</th><th>含稅</th><th>借方科目</th><th>貸方科目</th></tr></thead><tbody>'
      + (lines || []).map(function (line, index) {
        return '<tr>' + [line.description || ('第 ' + (index + 1) + ' 列'), amount(line.netAmount), amount(line.taxAmount), amount(line.grossAmount),
          line.debitAccount + ' ' + (line.debitAccountName || ''), line.creditAccount + ' ' + (line.creditAccountName || '')]
          .map(function (value) { return '<td style="padding:10px;border-bottom:1px solid #eadbc8">' + escapeHtml(value) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  async function read(requestId, expectedIdentity) {
    guardIdentity(expectedIdentity);
    var result = await global.getSb().rpc('finance_expense_correction_read_v1', {
      p_request_id: requestId || null, p_data_environment: global.activeDataEnvironment()
    });
    guardIdentity(expectedIdentity);
    if (result.error) throw result.error;
    if (!result.data || result.data.ok !== true) throw new Error('更正服務回傳不完整，沒有更動正式資料。');
    return result.data;
  }
  async function act(args, expectedIdentity) {
    guardIdentity(expectedIdentity);
    var fingerprint = expectedIdentity + '|' + JSON.stringify(args);
    if (!operations[fingerprint]) {
      operations[fingerprint] = (global.crypto && global.crypto.randomUUID)
        ? global.crypto.randomUUID() : ('correction_' + Date.now() + '_' + (++serial));
    }
    var result = await global.getSb().rpc('finance_expense_correction_action_v1', Object.assign({}, args, {
      p_operation_key: operations[fingerprint], p_data_environment: global.activeDataEnvironment()
    }));
    guardIdentity(expectedIdentity);
    if (result.error) throw result.error;
    if (!result.data || result.data.ok !== true) throw new Error('尚未確認正式保存結果；再次按相同操作會使用原識別碼確認，不會重複建立。');
    // Retain the operation key through an uncertain readback. Identical retry
    // always returns the original committed outcome from the database.
    if (typeof global.reloadRequestsByIds === 'function') await global.reloadRequestsByIds([args.p_request_id]);
    return result.data;
  }
  global.startExpenseAccountingCorrection = async function (original, work) {
    var expectedIdentity = identity();
    var patch = global.expenseApprovalTransactionPatch(work);
    var node = show('提出金額更正', '<p>人工修訂將先保存為更正提案，不會直接更改核定本金，也不會切傳票。</p>'
      + '<p><strong>原核定：' + amount(original.amt) + '　→　提案：' + amount(patch.amount) + '</strong></p>'
      + '<p>' + (global.requestCashPostedAt(original)
        ? '此單已有付款紀錄。主管覆核後，差額仍須由正式出納確認實際銀行補匯／退款；完成前不能入帳。'
        : '此單尚無正式付款紀錄。主管覆核完成後，才套用更正值；系統不會新增付款紀錄。') + '</p>'
      + linesHtml(patch.accounting_lines)
      + '<label>更正原因（至少 3 字）<textarea data-reason rows="3" style="width:100%;box-sizing:border-box"></textarea></label>'
      + '<label>獨立覆核主管<select data-reviewer style="width:100%;margin:8px 0"><option value="">載入合格人員中…</option></select></label>'
      + '<button type="button" data-submit disabled>保存更正提案</button>');
    try {
      var data = await read(original.id, expectedIdentity);
      var selector = node.querySelector('[data-reviewer]');
      selector.innerHTML = '<option value="">尚未指定（提案保留待指派，不會自動改派）</option>'
        + (data.reviewers || []).map(function (user) { return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + '</option>'; }).join('');
      var submit = node.querySelector('[data-submit]'); submit.disabled = false;
      submit.onclick = async function () {
        var reason = node.querySelector('[data-reason]').value.trim();
        if (reason.length < 3) { message(node, '請填寫至少 3 字的具體更正原因。', true); return; }
        submit.disabled = true;
        try {
          var result = await act({ p_request_id: original.id, p_action: 'propose', p_expected_version: Number(original.ver || 1),
            p_reason: reason, p_patch: patch, p_reviewer_id: selector.value || null }, expectedIdentity);
          message(node, '更正提案已正式保存。核定本金尚未變更，請由獨立主管覆核。', false);
          submit.textContent = '查看更正進度'; submit.onclick = function () { global.openExpenseAccountingCorrections(result.request_id); };
        } catch (error) { message(node, errorMessage(error) + '　目前人工輸入仍保留為草稿；沒有顯示入帳成功。', true); }
        submit.disabled = false;
      };
    } catch (error) { message(node, errorMessage(error), true); }
  };
  function statusLabel(status) {
    return { pending_review: '待獨立主管覆核', pending_cash: '待正式出納處理實際差額', applied: '已套用更正，回到最後會計入帳', rejected: '提案不通過，原核定不變', cancelled: '提案已取消，原核定不變' }[status] || status;
  }
  global.openExpenseAccountingCorrections = async function (requestId) {
    var expectedIdentity = identity();
    var node = show(requestId ? '金額更正與差額紀錄' : '金額更正待辦', '<p>讀取正式更正紀錄中…</p>');
    try {
      var data = await read(requestId, expectedIdentity);
      var body = node.querySelector('[data-body]'); body.textContent = '';
      if (!data.rows.length) { body.textContent = '目前沒有金額更正提案。'; return; }
      data.rows.forEach(function (row) {
        var card = document.createElement('section');
        card.style.cssText = 'padding:16px 0;border-bottom:1px solid #dbc4a6';
        card.innerHTML = '<h3>' + escapeHtml(row.requestNo) + ' · ' + escapeHtml(statusLabel(row.status)) + '</h3>'
          + '<p>原核定 ' + amount(row.originalAmount) + ' → 更正 ' + amount(row.proposedAmount) + '（差額 ' + amount(row.proposedAmount - row.originalAmount) + '）</p>'
          + '<p>提案人：' + escapeHtml(userName(row.proposerId)) + '；覆核人：' + escapeHtml(userName(row.reviewerId)) + '；正式出納：' + escapeHtml(userName(row.cashierId)) + '</p>'
          + '<p>原因：' + escapeHtml(row.reason) + '</p>'
          + '<details><summary>檢視五欄人工明細與稽核紀錄</summary>' + linesHtml((row.patch || {}).accounting_lines)
          + '<ol>' + (row.history || []).map(function (event) { return '<li>' + escapeHtml(event.at + ' · ' + userName(event.actorId) + ' · ' + event.action + ' · ' + event.reason) + '</li>'; }).join('') + '</ol></details>';
        if (!requestId) {
          var details = document.createElement('button'); details.type = 'button'; details.textContent = '開啟此單更正／指定覆核人';
          details.onclick = function () { global.openExpenseAccountingCorrections(row.requestId); }; card.appendChild(details);
        }
        var canAct = row.canReview || row.canSettle || row.canCancel;
        if (canAct) {
          card.insertAdjacentHTML('beforeend', '<label>本次處理說明<textarea data-reason rows="2" style="width:100%;box-sizing:border-box"></textarea></label>');
          if (row.canCancel) {
            card.insertAdjacentHTML('beforeend', '<select data-reviewer><option value="">選擇獨立覆核人</option>' + (data.reviewers || []).map(function (user) { return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + '</option>'; }).join('') + '</select>');
          }
          if (row.canSettle) {
            card.insertAdjacentHTML('beforeend', '<p>須使用已匯入銀行帳的實際交易。沒有對應交易時請先完成補匯／退款與銀行明細匯入，不能只勾選「已完成」。</p><select data-bank style="width:100%"><option value="">選擇實際銀行交易</option>'
              + (row.bankCandidates || []).map(function (bank) { return '<option value="' + escapeHtml(bank.id) + '">' + escapeHtml(bank.date + ' · ' + amount(bank.amount) + ' · ' + (bank.reference || bank.id)) + '</option>'; }).join('') + '</select>');
          }
          var choices = [];
          if (row.canReview) choices.push(['approve', '核准更正提案'], ['reject', '不通過']);
          if (row.canSettle) choices.push(['settle', '確認實際差額交易並套用更正']);
          if (row.canCancel) { if (requestId) choices.push(['assign', '指定覆核人']); choices.push(['cancel', '取消提案']); }
          choices.forEach(function (choice) {
            var button = document.createElement('button'); button.type = 'button'; button.textContent = choice[1]; button.style.margin = '8px 8px 0 0';
            button.onclick = async function () {
              var reason = card.querySelector('[data-reason]').value.trim();
              var bank = card.querySelector('[data-bank]'), reviewer = card.querySelector('[data-reviewer]');
              if (reason.length < 3 || (choice[0] === 'settle' && !bank.value) || (choice[0] === 'assign' && !reviewer.value)) {
                message(node, '請填寫具體處理說明，並選擇需要的覆核人／實際銀行交易。', true); return;
              }
              Array.from(card.querySelectorAll('button')).forEach(function (control) { control.disabled = true; });
              try {
                var result = await act({ p_request_id: row.requestId, p_action: choice[0], p_expected_version: row.version, p_reason: reason,
                  p_correction_id: row.id, p_bank_transaction_id: bank ? bank.value || null : null,
                  p_reviewer_id: choice[0] === 'assign' ? reviewer.value : null }, expectedIdentity);
                await global.openExpenseAccountingCorrections(requestId);
                if (dialog) message(dialog, result.status === 'applied' ? '更正已正式套用，尚未切傳票；請回原單完成最後會計入帳。' : '更正狀態已正式保存。', false);
              } catch (error) {
                message(node, errorMessage(error), true);
                Array.from(card.querySelectorAll('button')).forEach(function (control) { control.disabled = false; });
              }
            };
            card.appendChild(button);
          });
        }
        body.appendChild(card);
      });
    } catch (error) { message(node, errorMessage(error), true); }
  };
  global.accountingCorrectionPanelHtml = function (request) {
    if (!request) return '';
    var proposal = (request.formPayload || {}).accountingCorrection;
    return '<div style="padding:12px;margin:10px 0;border:1px solid #dfc7a8;border-radius:10px">'
      + (proposal ? escapeHtml(statusLabel(proposal.status)) + '　' : '')
      + '<button type="button" data-correction-request="' + escapeHtml(request.id) + '" onclick="openExpenseAccountingCorrections(this.dataset.correctionRequest)">金額更正／差額紀錄</button></div>';
  };
  global.expenseCorrectionCashEvents = function (request, kind) {
    return (((request || {}).formPayload || {}).correctionCashEvents || []).filter(function (event) {
      return event && event.correctionId && event.bankTransactionId && event.date && Number.isFinite(Number(event.amount));
    }).map(function (event) {
      return { date: event.date, amount: Number(event.amount), kind: kind || 'op', ref: request.no,
        desc: Number(event.amount) < 0 ? '金額更正實際補匯' : '金額更正實際退款', correctionId: event.correctionId };
    });
  };
  if (typeof module === 'object' && module.exports) module.exports = { escapeHtml: escapeHtml, linesHtml: linesHtml, statusLabel: statusLabel, cashEvents: global.expenseCorrectionCashEvents };
})(typeof window !== 'undefined' ? window : globalThis);
