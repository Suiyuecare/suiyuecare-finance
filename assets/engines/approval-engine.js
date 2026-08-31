(function (global) {
  'use strict';

  function rowsFrom(item, rowsFn) {
    if (!item) return [];
    if (Array.isArray(item.rows) && item.rows.length) return item.rows;
    if (typeof rowsFn === 'function') return rowsFn(item.raw || item) || [];
    return item.raw ? [item.raw] : [item];
  }

  function anyRow(item, rowsFn, predicate) {
    return rowsFrom(item, rowsFn).some(function (row) {
      return typeof predicate === 'function' && predicate(row);
    });
  }

  function invoiceApprovalRowIsOpen(row, deps) {
    deps = deps || {};
    if (!row) return false;
    if (callDep(deps, 'flowIsTerminal', row)) return false;
    if (callDep(deps, 'requestIsRejected', row)) return false;
    var approvalStatus = String(row.approvalStatus || row.approval_status || '').toLowerCase();
    var documentStatus = String(row.status || '').toLowerCase();
    if (['completed', 'delivered', 'rejected', 'cancelled'].indexOf(approvalStatus) > -1) return false;
    if (['paid', 'void', 'voided', 'cancelled', 'rejected'].indexOf(documentStatus) > -1) return false;
    if (
      row.postingLockedAt ||
      row.posting_locked_at ||
      row.voidedAt ||
      row.voided_at ||
      row.revenuePosted ||
      row.revenue_posted
    ) return false;
    return !!callDep(deps, 'activeStep', row);
  }

  function invoiceActiveApprovalStepKey(row, deps) {
    deps = deps || {};
    if (!invoiceApprovalRowIsOpen(row, deps)) return '';
    var step = callDep(deps, 'activeStep', row) || {};
    var index = callDep(deps, 'activeStepIndex', row);
    var role = String(
      step.rk || step.roleKey || step.role_key || step.key || step.role || '',
    ).trim();
    var financeUserId = String(
      step.uid ||
        step.financeUserId ||
        step.finance_user_id ||
        step.userId ||
        step.user_id ||
        '',
    ).trim();
    var email = String(
      step.email ||
        step.userEmail ||
        step.user_email ||
        step.approverEmail ||
        step.approver_email ||
        '',
    ).trim().toLowerCase();
    var assignee = financeUserId
      ? 'finance-user:' + financeUserId
      : (email ? 'email:' + email : 'role:' + role);
    return [String(index), role, assignee].join('|');
  }

  function invoiceBatchActionRows(item, deps) {
    deps = deps || {};
    var trigger = item && item.raw ? item.raw : item;
    var triggerKey = invoiceActiveApprovalStepKey(trigger, deps);
    if (!triggerKey || !callDep(deps, 'canActInvoice', trigger)) return [];
    return rowsFrom(item, deps.invoiceGroupRows).filter(function (row) {
      return (
        invoiceApprovalRowIsOpen(row, deps) &&
        invoiceActiveApprovalStepKey(row, deps) === triggerKey &&
        !!callDep(deps, 'canActInvoice', row)
      );
    });
  }

  function hasUserStepAction(item, rowsFn, stepBelongsToUser) {
    return anyRow(item, rowsFn, function (row) {
      return ((row && row.steps) || []).some(function (step) {
        return stepBelongsToUser(step, row) && step.a && String(step.a).length > 0;
      });
    });
  }

  function callDep(deps, name) {
    var fn = deps && deps[name];
    if (typeof fn !== 'function') return null;
    return fn.apply(null, Array.prototype.slice.call(arguments, 2));
  }

  function returnLogsFromStep(step, deps) {
    deps = deps || {};
    var logs = [];
    if (!step) return logs;
    [step.actionLog, step.action_logs, step.actions].forEach(function (source) {
      (Array.isArray(source) ? source : []).forEach(function (log) {
        if (!log || !/退回上一關/.test(String(log.action || log.label || ''))) return;
        var duplicate = logs.some(function (item) {
          return String(item.at || '') === String(log.at || log.created_at || '')
            && String(item.comment || '') === String(log.comment || log.note || '');
        });
        if (duplicate) return;
        logs.push({
          by: log.by || log.actor_name || '',
          byId: log.byId || log.by_id || log.actor_id || '',
          at: log.at || log.created_at || '',
          date: callDep(deps, 'fromIsoDate', log.at || log.created_at) || '',
          comment: log.comment || log.note || '',
          step: step,
        });
      });
    });
    String(step.c || '').split(/\n+/).forEach(function (line) {
      line = String(line || '').trim();
      if (!line || !/退回上一關/.test(line)) return;
      if (logs.some(function (log) { return log.comment && line.indexOf(log.comment) > -1; })) return;
      var match = line.match(/退回上一關[（(]([^，,)）]+)(?:[，,]([^）)]+))?[）)][:：]?\s*(.*)$/);
      logs.push({
        by: match && match[1] ? match[1] : '',
        date: match && match[2] ? match[2] : '',
        comment: match && match[3] ? match[3] : line,
        step: step,
        fromText: true,
      });
    });
    return logs;
  }

  function stepWasReopenedByReturn(step, deps) {
    if (!step || step.a) return false;
    return returnLogsFromStep(step, deps || {}).length > 0;
  }

  function returnState(flow, deps) {
    deps = deps || {};
    var cur = callDep(deps, 'activeStep', flow);
    var index = callDep(deps, 'activeStepIndex', flow);
    var steps = (flow && flow.steps) || [];
    var logs = [];
    steps.forEach(function (step) {
      logs = logs.concat(returnLogsFromStep(step, deps));
    });
    var latest = logs.length ? logs[logs.length - 1] : null;
    var user = cur && cur.uid ? callDep(deps, 'userById', cur.uid) : null;
    return {
      active: !!(cur && cur.rk === 'applicant_revision'),
      current: cur,
      index: index,
      latest: latest,
      handler: (user && user.n) || (flow && flow.applicant) || (flow && flow.app) || '申請人',
      logs: logs,
    };
  }

  function stepDisplayComment(step, state) {
    var raw = String((step && step.c) || '').trim();
    if (!raw) return '';
    if (!(state && state.active)) return raw;
    return raw.split(/\n+/).filter(function (line) {
      return !/退回上一關/.test(String(line || ''));
    }).join('\n').trim();
  }

  function timelineRows(flow, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    var steps = ((flow && flow.steps) || []).slice();
    var hasSubmit = steps.some(function (step) { return step && step.rk === 'applicant_submit'; });
    var rows = [];
    var cur = callDep(deps, 'activeStep', flow);
    var state = returnState(flow, deps);
    var formalNo = 0;

    function autoSkipped(step) {
      return !!callDep(deps, 'autoSkippedStep', step);
    }

    function pushStep(step, originalIndex, synthetic) {
      if (!step || step.rk === 'applicant_revision') return;
      formalNo += 1;
      var afterReturnPause = state.active && originalIndex > state.index;
      var rejected = !!(step.a && step.a !== 'approved' && !afterReturnPause);
      var current = !!(cur === step && !state.active);
      var done = !!(step.a === 'approved' && !afterReturnPause && !current && !rejected);
      var paused = !!(afterReturnPause && !current && !rejected);
      var cls = current ? 'current' : (rejected ? 'rejected' : (done ? 'done' : (paused ? 'paused' : 'future')));
      var purpose = callDep(deps, 'stepPurpose', step) || '';
      if (paused && autoSkipped(step)) purpose = '待申請人補件重新送出後，系統會依重複主管規則自動略過。';
      else if (paused) purpose = '待申請人補件重新送出後，流程才會繼續回到本關。';
      rows.push({
        step: step,
        originalIndex: originalIndex,
        displayNo: formalNo,
        title: callDep(deps, 'stepTitle', step) || '',
        purpose: purpose,
        files: callDep(deps, 'normalizeFiles', step.files || []) || [],
        comment: stepDisplayComment(step, state),
        name: step.n || '',
        time: step.t || '',
        done: done,
        rejected: rejected,
        current: current,
        paused: paused,
        synthetic: !!synthetic,
        auto: autoSkipped(step),
        className: cls + (autoSkipped(step) ? ' auto' : ''),
      });
    }

    if (opts.includeSubmitFallback && !hasSubmit) {
      pushStep({
        r: '申請人送件',
        rk: 'applicant_submit',
        n: (flow && flow.app) || (flow && flow.applicant) || '',
        t: (flow && flow.date) || '',
        a: 'approved',
        files: [],
        c: '',
        purpose: '申請人建立表單、上傳附件並送出，系統正式開始簽核流程。',
      }, -1, true);
    }
    steps.forEach(function (step, index) { pushStep(step, index, false); });
    return rows;
  }

  function timelineProgressText(flow, deps) {
    var rows = timelineRows(flow, { includeSubmitFallback: true }, deps || {});
    var total = rows.length || 0;
    var state = returnState(flow, deps || {});
    if (state.active) return '退回補件中 · 補件後繼續流程';
    var current = rows.find(function (row) { return row.current; });
    if (current) return '步驟 ' + current.displayNo + '/' + total;
    var done = rows.filter(function (row) { return row.done; }).length;
    if (total && done >= total) return '已完成 ' + done + '/' + total;
    return total ? '步驟 ' + Math.min(done + 1, total) + '/' + total : '尚未建立流程';
  }

  function stepAttachmentMarkup(files, deps) {
    var rendered = callDep(deps || {}, 'stepAttachmentHtml', files || []);
    if (rendered !== null && typeof rendered !== 'undefined') return rendered;
    files = Array.isArray(files) ? files : [];
    if (!files.length) return '<div style="font-size:10px;color:#b8a58f;margin-top:3px">此關未上傳附件</div>';
    return '<div style="font-size:10px;color:#b8a58f;margin-top:3px">此關有 ' + files.length + ' 個附件</div>';
  }

  function stepFeedbackMarkup(comment, deps) {
    var rendered = callDep(deps || {}, 'stepFeedbackHtml', comment || '');
    if (rendered !== null && typeof rendered !== 'undefined') return rendered;
    comment = String(comment || '').trim();
    if (!comment) return '';
    return '<div class="step-feedback">' + htmlEscape(comment, deps) + '</div>';
  }

  function approvalReturnCardHtml(flow, deps) {
    deps = deps || {};
    var state = returnState(flow, deps);
    if (!state.active) return '';
    var latest = state.latest || {};
    var meta = [];
    meta.push('目前處理人：' + htmlEscape(state.handler, deps));
    if (latest.by) meta.push('退回人：' + htmlEscape(latest.by, deps));
    if (latest.date || latest.at) meta.push('退回時間：' + htmlEscape(latest.date || callDep(deps, 'fromIsoDate', latest.at) || latest.at, deps));
    var note = String(latest.comment || '請依退回意見補充或修正後重新送出。').trim();
    return '<div class="approval-return-card">'
      + '<div class="approval-return-title">目前狀態：退回申請人補件中</div>'
      + '<div class="approval-return-meta">' + meta.join(' ｜ ') + '</div>'
      + '<div class="approval-return-note">原因：' + htmlEscape(note, deps) + '</div>'
      + '<div class="approval-return-meta">申請人補件完成並重新送出後，系統才會回到下一個簽核關卡。</div>'
      + stepAttachmentMarkup((state.current && state.current.files) || [], deps)
      + '</div>';
  }

  function approvalTimelineRowHtml(row, deps) {
    deps = deps || {};
    row = row || {};
    var dot = row.done ? 'OK' : (row.rejected ? 'NO' : row.displayNo);
    var badges = '';
    if (row.current) badges += '<span class="approval-step-badge">目前</span>';
    else if (row.paused) badges += '<span class="approval-step-badge">' + (row.auto ? '待補件後自動跳關' : '待補件後繼續') + '</span>';
    else if (row.auto && row.done) badges += '<span class="approval-step-badge">系統自動跳關</span>';
    else if (row.rejected) badges += '<span class="approval-step-badge">已駁回</span>';
    var meta = (row.name ? ' — ' + htmlEscape(row.name, deps) : '') + (row.time ? ' <span class="approval-step-meta">' + htmlEscape(row.time, deps) + '</span>' : '');
    return '<div class="approval-step-row ' + htmlEscape(row.className || '', deps) + '"><div class="approval-step-dot">' + htmlEscape(dot, deps) + '</div><div class="approval-step-body">'
      + '<div class="approval-step-title">' + htmlEscape(row.title || '簽核關卡', deps) + meta + badges + '</div>'
      + '<div class="approval-step-purpose">' + htmlEscape(row.purpose || '依流程檢核此關資料。', deps) + '</div>'
      + stepAttachmentMarkup(row.files || [], deps)
      + stepFeedbackMarkup(row.comment || '', deps)
      + '</div></div>';
  }

  function approvalTimelineHtml(flow, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    var rows = timelineRows(flow, opts, deps);
    var body = rows.map(function (row) {
      return approvalTimelineRowHtml(row, deps);
    }).join('') || '<div style="font-size:11px;color:#94a3b8">尚未建立簽核流程</div>';
    return '<div class="approval-flow-stack">' + approvalReturnCardHtml(flow, deps) + '<div class="approval-timeline">' + body + '</div></div>';
  }

  function approverSelectHtml(id, deps, opts) {
    deps = deps || {};
    opts = opts || {};
    var users = callDep(deps, 'activeUniqueUsers') || [];
    var optionHtml = '<option value="">不加簽</option>' + users.map(function (u) {
      var role = callDep(deps, 'roleLabel', u) || (u && (u.rL || u.role)) || '';
      var label = callDep(deps, 'approverLabel', u) || ((u && u.n) + '（' + role + '）');
      return '<option value="' + htmlEscape(u && u.id, deps) + '">' + htmlEscape(label, deps) + '</option>';
    }).join('');
    var noteId = htmlEscape(opts.noteId || '', deps);
    var safeId = htmlEscape(id, deps);
    var hintId = safeId + '-hint';
    return '<label class="fl" for="' + safeId + '">加簽給指定員工（選填）</label><select id="' + safeId + '" data-approval-note-id="' + noteId + '" aria-describedby="' + hintId + '" onchange="updateApprovalAddSignRequirement(this)" style="margin-bottom:7px;font-size:12px">' + optionHtml + '</select><div id="' + hintId + '" style="font-size:10px;color:#8b7358;margin:-3px 0 7px">選擇後會先核准本關，再把該員工排為下一關加簽；此時加簽原因為必填。</div>';
  }

  function approvalActionFieldsHtml(noteId, fileId, assignId, deps, opts) {
    deps = deps || {};
    opts = opts || {};
    noteId = htmlEscape(noteId, deps);
    fileId = htmlEscape(fileId, deps);
    var noteHintId = noteId + '-requirement';
    return '<label class="fl" id="' + noteId + '-label" for="' + noteId + '">簽核備註（未加簽時選填）</label><textarea id="' + noteId + '" rows="2" placeholder="若選擇加簽人，請填寫加簽原因…" aria-describedby="' + noteHintId + '" style="margin-bottom:4px;font-size:12px"></textarea><div id="' + noteHintId + '" data-approval-note-requirement style="font-size:10px;color:#8b7358;margin:0 0 7px">選擇加簽人後，這一欄會變成必填。</div>'
      + '<label class="fl">本關附件（選填，後續簽核人可下載查看）</label><label class="approval-file-field"><input type="file" id="' + fileId + '" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" onchange="updateApprovalFileLabel(this)"><span class="approval-file-button">選擇檔案</span><span class="approval-file-name" id="' + fileId + '-name">未選擇任何檔案</span></label>'
      + (opts.allowAddSign === false ? '' : approverSelectHtml(assignId, deps, { noteId: noteId }));
  }

  function cloneWorkflowTemplate(template) {
    if (!template || typeof template !== 'object') return {};
    return Object.assign({}, template, {
      appliesTo: Array.isArray(template.appliesTo) ? template.appliesTo.slice() : [],
      steps: Array.isArray(template.steps) ? template.steps.map(function (step) {
        return step && typeof step === 'object' ? Object.assign({}, step) : step;
      }) : [],
      conditionalRoutes: Array.isArray(template.conditionalRoutes) ? template.conditionalRoutes.map(function (route) {
        return route && typeof route === 'object' ? Object.assign({}, route) : route;
      }) : [],
    });
  }

  function defaultWorkflowTemplates() {
    return [
      { id: 'expense_standard', name: '一般支出 / 報銷流程', appliesTo: ['expense_reimbursement', 'payment_request', 'advance_request', 'petty_cash_request', 'travel_request', 'refund_request', 'welfare_request', 'hr_expense_request'], enabled: true, steps: [
        { key: 'direct_supervisor', label: '申請人主管', required: true, purpose: '確認服務事實、金額與部門預算。' },
        { key: 'dept_manager', label: '申請人部門主任', required: true, purpose: '確認申請人所屬部門歸屬與跨課室影響。' },
        { key: 'admin_director', label: '行政部門主任', required: true, purpose: '確認行政流程、附件完整性與付款資料。' },
        { key: 'accountant', label: '會計', required: true, purpose: '確認科目、稅務與憑證。' },
        { key: 'ceo', label: '執行長檢視會計科目', required: true, purpose: '檢視付款風險與資金配置。' },
        { key: 'cashier', label: '出納放款', required: true, purpose: '依核准付款指示辦理撥款。' },
        { key: 'applicant_confirm', label: '申請人確認', required: true, purpose: '確認已收到款項或商品。' },
        { key: 'accountant_final', label: '會計確認入帳', required: true, purpose: '確認入帳與分類帳。' },
      ] },
      { id: 'purchase_standard', name: '採購申請流程', appliesTo: ['purchase_request'], enabled: true, steps: [
        { key: 'procurement_payment', label: '總務：找商品並填寫預估匯款資訊', required: true, purpose: '總務依申請需求找商品，填寫預估付款資料。' },
        { key: 'direct_supervisor', label: '申請人主管', required: true, purpose: '確認採購需求與部門預算。' },
        { key: 'dept_manager', label: '申請人部門主任', required: true, purpose: '確認申請人所屬部門的採購必要性與跨課室影響。' },
        { key: 'accountant', label: '會計', required: true, purpose: '確認科目、付款風險與憑證後續追蹤。' },
        { key: 'ceo', label: '執行長檢視會計科目', required: true, purpose: '檢視付款風險與資金配置。' },
        { key: 'cashier', label: '出納放款', required: true, purpose: '依核准付款指示辦理撥款。' },
        { key: 'applicant_confirm', label: '申請人確認收到採購商品', required: true, purpose: '確認總務採購的商品或服務已實際收到。' },
        { key: 'procurement_receipt', label: '總務提供採購憑據', required: true, purpose: '總務採購完成後上傳發票或憑據並填入最後正確金額。' },
        { key: 'accountant_final', label: '會計銷帳入帳', required: true, purpose: '會計確認憑據與最後金額後入帳。' },
      ] },
      { id: 'invoice_standard', name: '開立發票流程', appliesTo: ['invoice_request'], enabled: true, steps: [
        { key: 'direct_supervisor', label: '申請人主管', required: true, purpose: '確認開票原因與業務事實。' },
        { key: 'dept_manager', label: '申請人部門主任', required: true, purpose: '確認申請人所屬部門的收入歸屬與品項內容。' },
        { key: 'admin_director', label: '行政部門主任', required: true, purpose: '確認行政資料與附件完整。' },
        { key: 'accountant', label: '會計', required: true, purpose: '確認稅務、科目與發票資料。' },
        { key: 'ceo', label: '執行長', required: true, purpose: '最終授權。' },
        { key: 'accountant_invoice', label: '會計開立發票', required: true, purpose: '開立並上傳發票檔案；本關通過後自動進入收款追蹤。' },
        { key: 'applicant_invoice_delivery', label: '申請人交付發票確認', required: true, purpose: '申請人確認已取得會計開立的發票並交付對方；收款追蹤仍於會計開立發票後啟動。' },
      ] },
      { id: 'bill_standard', name: '申請繳費單流程', appliesTo: ['bill_request'], enabled: true, steps: [
        { key: 'direct_supervisor', label: '申請人主管', required: true, purpose: '確認繳費內容與服務事實。' },
        { key: 'dept_manager', label: '申請人部門主任', required: true, purpose: '確認申請人所屬部門的收入歸屬與期間。' },
        { key: 'admin_director', label: '行政部門主任', required: true, purpose: '確認繳費人與資料完整。' },
        { key: 'accountant', label: '會計', required: true, purpose: '確認應收金額與後續收款追蹤。' },
        { key: 'applicant_confirm', label: '申請人確認繳費單可提供', required: true, purpose: '確認內容可正式提供繳費人。' },
      ] },
      { id: 'shareholder_standard', name: '股東 / 公司間往來流程', appliesTo: ['shareholder_transaction'], enabled: true, steps: [
        { key: 'admin_director', label: '行政部門主任', required: true, purpose: '確認資金往來需求與資料完整。' },
        { key: 'accountant', label: '會計', required: true, purpose: '確認會計科目與公司間關係。' },
        { key: 'ceo', label: '執行長', required: true, purpose: '確認授權、風險與資金配置。' },
      ] },
    ];
  }

  function normalizeWorkflowTemplates(value, defaults) {
    defaults = Array.isArray(defaults) ? defaults : defaultWorkflowTemplates();
    var byId = {};
    defaults.forEach(function (template) {
      if (!template || !template.id) return;
      byId[template.id] = cloneWorkflowTemplate(template);
    });
    (Array.isArray(value) ? value : []).forEach(function (template) {
      if (!template || !template.id) return;
      byId[template.id] = Object.assign({}, byId[template.id] || {}, template);
      byId[template.id].appliesTo = Array.isArray(byId[template.id].appliesTo) ? byId[template.id].appliesTo : [];
      byId[template.id].steps = Array.isArray(byId[template.id].steps) ? byId[template.id].steps : [];
      byId[template.id].conditionalRoutes = Array.isArray(byId[template.id].conditionalRoutes) ? byId[template.id].conditionalRoutes : [];
    });
    var defaultIds = {};
    defaults.forEach(function (template) {
      if (template && template.id) defaultIds[template.id] = true;
    });
    return defaults.map(function (template) {
      return byId[template.id];
    }).concat(Object.keys(byId).filter(function (id) {
      return !defaultIds[id];
    }).map(function (id) {
      return byId[id];
    }));
  }

  function workflowStepKey(step) {
    return String((step && (step.key || step.rk || step.role)) || '').trim();
  }

  function workflowStepLabel(step, fallback, user) {
    var label = String((step && step.label) || fallback || '簽核').trim();
    var key = workflowStepKey(step);
    if (user && user.n && ['direct_supervisor', 'dept_manager'].indexOf(key) > -1 && label.indexOf(user.n) < 0) {
      label += '：' + user.n;
    }
    return label;
  }

  function workflowStepPurpose(step, key) {
    if (step && step.purpose) return step.purpose;
    key = key || workflowStepKey(step);
    var map = {
      direct_supervisor: '確認申請內容、服務事實、金額與部門預算。',
      dept_manager: '確認申請人所屬部門歸屬、收入/成本影響與跨課室事項。',
      admin_director: '確認行政流程、附件完整性與付款/收款資料。',
      accountant: '確認會計科目、稅務處理與憑證資料。',
      ceo: '檢視公司風險、付款或收入認列與資金配置。',
      cashier: '依核准付款指示辦理撥款。',
      applicant_confirm: '申請人確認款項、商品、發票或繳費單已完成交付。',
      accountant_final: '會計確認入帳與分類帳。',
      accountant_invoice: '會計依核准資料開立發票並上傳檔案。',
      applicant_invoice_delivery: '申請人確認發票已交付對方；本關完成後才正式認列收入。',
      procurement_payment: '總務依申請需求找商品並填寫預估付款資料。',
      procurement_receipt: '總務採購完成後上傳發票或憑據並填入最後正確金額。',
    };
    return map[key] || '依客製化簽核流程確認後送下一關。';
  }

  function workflowStepStatus(key, deps) {
    deps = deps || {};
    var map = {
      direct_supervisor: 'pending_section_chief',
      dept_manager: 'pending_dept_manager',
      admin_director: 'pending_admin_director',
      accountant: 'pending_accountant',
      ceo: 'pending_ceo',
      cashier: 'pending_cashier',
      applicant_confirm: 'pending_applicant_confirm',
      accountant_final: 'pending_voucher',
      accountant_invoice: 'pending_invoice_accountant',
      applicant_invoice_delivery: 'pending_invoice_delivery',
      procurement_payment: 'pending_procurement',
      procurement_receipt: 'pending_procurement',
      hr: 'pending_hr',
    };
    if (map[key]) return map[key];
    var stepFor = deps.stepFor || {};
    return stepFor[key] || ('pending_' + key);
  }

  function workflowRoleKeyForStep(key) {
    if (key === 'direct_supervisor') return 'direct_supervisor';
    if (key === 'procurement_payment' || key === 'procurement_receipt' || key === 'general_affairs') return key === 'general_affairs' ? 'general_affairs' : key;
    return key;
  }

  function workflowKeepsDistinctRoleStep(role, key) {
    var k = key || role;
    return ['direct_supervisor', 'dept_manager', 'admin_director', 'accountant', 'ceo', 'cashier', 'applicant_confirm', 'accountant_final', 'accountant_invoice', 'applicant_invoice_delivery', 'procurement_payment', 'procurement_receipt', 'general_affairs', 'hr'].indexOf(k) > -1;
  }

  function stepWorkflowKeyForRuntime(step, deps) {
    var key = callDep(deps, 'stepWorkflowKey', step);
    return String(key || workflowStepKey(step) || '').trim();
  }

  function firstStepIndexByKeys(steps, keys, deps) {
    var fromDep = callDep(deps, 'firstStepIndexByKeys', steps, keys);
    if (typeof fromDep === 'number') return fromDep;
    keys = keys || [];
    return (steps || []).findIndex(function (step) {
      return keys.indexOf(step && step.rk) > -1 || keys.indexOf(stepWorkflowKeyForRuntime(step, deps)) > -1;
    });
  }

  function moveStepAfterIndex(steps, fromIdx, afterIdx) {
    if (!Array.isArray(steps) || fromIdx < 0 || afterIdx < 0 || fromIdx === afterIdx || fromIdx === afterIdx + 1) return false;
    var item = steps.splice(fromIdx, 1)[0];
    if (fromIdx < afterIdx) afterIdx -= 1;
    steps.splice(afterIdx + 1, 0, item);
    return true;
  }

  function isTrueCeoReviewStep(step, deps) {
    var fromDep = callDep(deps, 'isTrueCeoReviewStep', step);
    if (typeof fromDep === 'boolean') return fromDep;
    return !!(step && step.rk === 'ceo' && stepWorkflowKeyForRuntime(step, deps) !== 'direct_supervisor');
  }

  function approvalRouteInvariantErrors(requestType, steps, deps, context) {
    deps = deps || {};
    var errors = [];
    steps = Array.isArray(steps) ? steps : [];
    steps.forEach(function (step, idx) {
      if (stepWorkflowKeyForRuntime(step, deps) === 'direct_supervisor' && step.rk !== 'direct_supervisor') {
        errors.push('第 ' + (idx + 1) + ' 關「申請人主管」被誤標成「' + (step.rk || '未知角色') + '」，系統已阻止送出，請重新整理後再試。');
      }
    });
    var adminIdx = firstStepIndexByKeys(steps, ['admin_director'], deps);
    var accountantIdx = firstStepIndexByKeys(steps, ['accountant'], deps);
    var ceoIdx = steps.findIndex(function (step) { return isTrueCeoReviewStep(step, deps); });
    var cashierIdx = firstStepIndexByKeys(steps, ['cashier'], deps);
    if (cashierIdx > -1) {
      if (adminIdx > -1 && cashierIdx < adminIdx) errors.push('出納放款不可排在行政部門主任之前。');
      if (accountantIdx > -1 && cashierIdx < accountantIdx) errors.push('出納放款不可排在會計之前。');
      if (ceoIdx > -1 && cashierIdx < ceoIdx) errors.push('出納放款不可排在執行長檢視會計科目之前。');
    }
    var policyCeoRequired = callDep(deps, 'approvalRoutingRoleRequired', 'ceo', context || {});
    var ceoRequired = typeof policyCeoRequired === 'boolean'
      ? policyCeoRequired
      : ['expense_reimbursement', 'payment_request', 'advance_request', 'petty_cash_request', 'travel_request', 'refund_request', 'welfare_request', 'hr_expense_request', 'purchase_request'].indexOf(requestType) > -1;
    if (ceoRequired && ceoIdx < 0) errors.push('流程缺少真正的「執行長檢視會計科目」關卡。');
    if (requestType === 'invoice_request') {
      var accountantInvoiceIdx = firstStepIndexByKeys(steps, ['accountant_invoice'], deps);
      var applicantDeliveryIdx = firstStepIndexByKeys(steps, ['applicant_invoice_delivery'], deps);
      if (applicantDeliveryIdx < 0) errors.push('開立發票流程缺少「申請人交付發票確認」關卡。');
      else if (accountantInvoiceIdx > -1 && applicantDeliveryIdx < accountantInvoiceIdx) errors.push('開立發票流程中「申請人交付發票確認」必須排在「會計開立發票」之後。');
    }
    return errors;
  }

  function approvalStepAutoClosed(step) {
    return !!(step && (step.a === 'AUTO' || step.auto || step.autoMerged || step.autoSkip || step.status === 'auto_approved'));
  }

  function normalizeRequestSemanticSteps(record, deps) {
    deps = deps || {};
    if (!record || !Array.isArray(record.steps)) return false;
    if (callDep(deps, 'flowIsTerminal', record)) return false;
    var changed = false;
    var steps = record.steps;
    var applicant = callDep(deps, 'userById', record.applicantId)
      || callDep(deps, 'userByEmail', record.applicantEmail)
      || ((callDep(deps, 'users') || []).find(function (user) { return user && user.n === record.app; }) || null);

    steps.forEach(function (step) {
      if (!step || stepWorkflowKeyForRuntime(step, deps) !== 'direct_supervisor' || step.rk === 'direct_supervisor') return;
      var user = step.uid ? callDep(deps, 'userById', step.uid) : null;
      step.rk = 'direct_supervisor';
      step.status = 'pending_section_chief';
      step.r = '申請人主管' + (user && user.n ? '：' + user.n : '');
      step.purpose = step.purpose && step.purpose.indexOf('確認服務事實') > -1 ? step.purpose : '確認申請內容、服務事實、金額與部門預算。';
      step.flowRepairNote = 'semantic_direct_supervisor_preserved';
      changed = true;
    });

    if (applicant && applicant.role === 'dept_manager') {
      var deptIdx = firstStepIndexByKeys(steps, ['dept_manager'], deps);
      if (deptIdx > -1) {
        var dept = steps[deptIdx];
        if (dept.uid !== applicant.id || !dept.autoSkip || dept.autoSkipReason !== CANONICAL_APPLICANT_SELF_AUTO_SKIP_REASON) {
          dept.uid = applicant.id;
          dept.r = '申請人部門主任：' + (applicant.n || '申請人');
          normalizeApplicantSelfStep(dept, applicant, record.type || '', deps);
          changed = true;
        }
      }
    }

    var directIdx = firstStepIndexByKeys(steps, ['direct_supervisor'], deps);
    var deptIdx2 = firstStepIndexByKeys(steps, ['dept_manager'], deps);
    if (directIdx > -1 && deptIdx2 > -1 && steps[deptIdx2] && steps[deptIdx2].autoSkip) {
      if (moveStepAfterIndex(steps, deptIdx2, directIdx)) changed = true;
    }

    var cashierIdx = firstStepIndexByKeys(steps, ['cashier'], deps);
    if (cashierIdx > -1) {
      var adminIdx = firstStepIndexByKeys(steps, ['admin_director'], deps);
      var accountantIdx = firstStepIndexByKeys(steps, ['accountant'], deps);
      var ceoIdx = steps.findIndex(function (step) { return isTrueCeoReviewStep(step, deps); });
      var mustFollow = Math.max(adminIdx, accountantIdx, ceoIdx);
      if (mustFollow > -1 && cashierIdx < mustFollow && steps[cashierIdx] && steps[cashierIdx].a !== 'approved') {
        if (moveStepAfterIndex(steps, cashierIdx, mustFollow)) changed = true;
      }
    }

    if (changed) {
      var activeIdx = steps.findIndex(function (step) { return !step.a; });
      record.step = activeIdx > -1 ? activeIdx + 1 : steps.length;
      record.status = activeIdx > -1 ? (steps[activeIdx].status || record.status) : 'completed';
      record.formPayload = Object.assign({}, record.formPayload || {}, {
        flowNormalizedAt: new Date().toISOString(),
        flowNormalizedReason: 'semantic_workflow_order_repair',
      });
    }
    return changed;
  }

  function normalizeCeoCashierOrder(record, deps) {
    deps = deps || {};
    if (!record || !Array.isArray(record.steps)) return false;
    if (callDep(deps, 'flowIsTerminal', record)) return false;
    var changed = false;
    var steps = record.steps;
    steps.forEach(function (step) {
      if (!step || step.rk !== 'ceo') return;
      if (step.r !== '執行長檢視會計科目') {
        step.r = '執行長檢視會計科目';
        changed = true;
      }
      if (!step.purpose || /授權|核准付款|實際放款|出納/.test(step.purpose)) {
        step.purpose = '執行長檢視會計科目、付款風險與資金配置；此關不代表實際放款。';
        changed = true;
      }
    });
    var ceoIdx = steps.findIndex(function (step) { return isTrueCeoReviewStep(step, deps); });
    var cashierIdx = steps.findIndex(function (step) { return step && step.rk === 'cashier'; });
    if (ceoIdx > -1 && cashierIdx > -1 && cashierIdx < ceoIdx && steps[cashierIdx].a !== 'approved') {
      if (moveStepAfterIndex(steps, cashierIdx, ceoIdx)) changed = true;
    }
    if (changed) {
      var activeIdx = steps.findIndex(function (step) { return !step.a; });
      if (activeIdx > -1) {
        record.step = activeIdx + 1;
        record.status = steps[activeIdx].status || record.status;
      }
      record.formPayload = Object.assign({}, record.formPayload || {}, {
        flowNormalizedAt: new Date().toISOString(),
        flowNormalizedReason: 'ceo_review_before_cashier',
      });
    }
    return changed;
  }

  function requestRequiresCashierStep(record, deps) {
    deps = deps || {};
    if (!record || !Array.isArray(record.steps)) return false;
    if (callDep(deps, 'flowIsTerminal', record)) return false;
    if (['completed', 'cancelled', 'rejected'].indexOf(record.status) > -1) return false;
    var steps = record.steps || [];
    if (steps.some(function (step) { return step && step.rk === 'cashier'; })) return false;
    return steps.some(function (step) { return step && step.rk === 'accountant'; })
      && steps.some(function (step) { return step && (step.rk === 'applicant_confirm' || step.rk === 'accountant_final'); });
  }

  function ensureRequestCashierStep(record, deps) {
    deps = deps || {};
    if (!requestRequiresCashierStep(record, deps)) return false;
    var cashier = callDep(deps, 'cashierUser') || {};
    var cashStep = {
      r: '出納放款',
      rk: 'cashier',
      uid: cashier.id || '',
      n: '',
      a: '',
      t: '',
      c: '',
      files: [],
      status: 'pending_cashier',
      purpose: '出納確認付款指示後執行撥款；現階段由執行長暫代。現金流量表於本關通過後認列銀行流出。',
    };
    var steps = record.steps || [];
    var ceoIdx = steps.findIndex(function (step) { return isTrueCeoReviewStep(step, deps); });
    var accountantIdx = steps.findIndex(function (step) { return step && step.rk === 'accountant'; });
    var applicantConfirmIdx = steps.findIndex(function (step) { return step && step.rk === 'applicant_confirm'; });
    var insertIdx = ceoIdx > -1 ? ceoIdx + 1 : (accountantIdx > -1 ? accountantIdx + 1 : applicantConfirmIdx);
    if (insertIdx < 0) insertIdx = steps.length;
    steps.splice(insertIdx, 0, cashStep);
    var activeIdx = steps.findIndex(function (step) { return !step.a; });
    var alreadyCashPosted = !!callDep(deps, 'requestCashPostedAt', record);
    if (['pending_applicant_confirm', 'pending_voucher'].indexOf(record.status) > -1 && !alreadyCashPosted && activeIdx === insertIdx) {
      record.status = 'pending_cashier';
      record.step = insertIdx + 1;
    } else {
      record.step = activeIdx > -1 ? activeIdx + 1 : steps.length;
      if (activeIdx > -1) record.status = steps[activeIdx].status || record.status;
    }
    record.formPayload = Object.assign({}, record.formPayload || {}, {
      flowNormalizedAt: new Date().toISOString(),
      flowNormalizedReason: 'insert_cashier_after_ceo',
    });
    return true;
  }

  function approvalStepAllowsApplicantSelf(step, requestType, appUser, deps) {
    return !!step && applicantSelfPendingAllowed(step, deps || {});
  }

  function approvalRuntimeStepErrors(appUser, requestType, steps, deps, context) {
    deps = deps || {};
    var errors = approvalRouteInvariantErrors(requestType, steps || [], deps, context || {});
    (steps || []).forEach(function (step, idx) {
      var selfAuditError = applicantSelfAuditError(step, appUser, deps);
      if (selfAuditError) errors.push('第 ' + (idx + 1) + ' 關：' + selfAuditError);
      var autoStep = approvalStepAutoClosed(step);
      if (!step.uid && !autoStep) errors.push('第 ' + (idx + 1) + ' 關「' + (step.r || step.rk || '未命名關卡') + '」沒有指定簽核人。');
    });
    return errors;
  }

  function approvalRuntimeActorKindForStep(step, deps) {
    var configured = String(step && (
      step.runtimeActorKind || step.actorKind || step.actor_kind || step.workflowActorKind
    ) || '').trim();
    if (configured) return configured;
    var key = stepWorkflowKeyForRuntime(step, deps || {}) || (step && step.rk) || '';
    if (['applicant_submit', 'applicant_confirm', 'applicant_invoice_delivery'].indexOf(key) > -1) return 'applicant';
    if (key === 'dept_manager') return 'dept_manager';
    if (key === 'accountant_final' || key === 'accountant_invoice') return 'accountant';
    if (key === 'procurement_payment' || key === 'procurement_receipt' || key === 'general_affairs') return 'general_affairs';
    if (['direct_supervisor', 'admin_director', 'accountant', 'ceo', 'cashier'].indexOf(key) > -1) return key;
    if (key) return 'finance_role';
    return '';
  }

  function approvalRuntimeRoleKeyForStep(step, actorKind, deps) {
    var key = stepWorkflowKeyForRuntime(step, deps || {}) || (step && step.rk) || '';
    if (actorKind === 'org_unit_head') {
      var target = String(step && (
        step.workflowActorTarget || step.actorTarget || step.actor_target || step.target
        || step.workflowActorRef || step.actorRef || step.actor_ref
      ) || '').trim();
      var level = String(step && (
        step.workflowActorTargetUnitType || step.targetUnitType || step.target_unit_type
      ) || '').trim();
      if (target === 'specified_level' && level) return level;
      return target || level || 'nearest_parent';
    }
    if (actorKind === 'general_affairs') return 'general_affairs';
    if (actorKind === 'finance_role') return key;
    if (key === 'accountant_final' || key === 'accountant_invoice') return 'accountant';
    return (step && step.rk) || key || actorKind || '';
  }

  function approvalRuntimeCandidateId(candidate) {
    return candidate && (candidate.effective_finance_user_id || candidate.effectiveFinanceUserId || candidate.finance_user_id || candidate.financeUserId || candidate.id) || '';
  }

  function approvalRuntimeOriginalCandidateId(candidate) {
    return candidate && (candidate.finance_user_id || candidate.financeUserId || candidate.id) || '';
  }

  function approvalRuntimeTopLevelSelfCandidate(payload, key, actorKind, appUser, requestedDepartmentCode) {
    payload = payload || {};
    var candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    var missingReason = String(payload.missing_reason || payload.error || '').trim().toUpperCase();
    var stepKey = String(key || '').trim();
    var normalizedActorKind = String(actorKind || '').trim();
    if (payload.ok === true || candidates.length || missingReason !== 'NO_MATCHING_ACTOR') return null;
    if (['direct_supervisor', 'dept_manager'].indexOf(stepKey) < 0) return null;
    if (['direct_supervisor', 'dept_manager', 'department_manager'].indexOf(normalizedActorKind) < 0) return null;
    if (!appUser || !appUser.id || String(appUser.role || '').trim().toLowerCase() !== 'ceo') return null;

    var context = payload.applicant_context || payload.applicantContext || {};
    var financeUser = context.finance_user || context.financeUser || {};
    var primaryRole = context.primary_role || context.primaryRole || {};
    var department = context.department || {};
    var chain = context.approval_chain || context.approvalChain || {};
    var contextUserId = String(financeUser.id || '').trim();
    var contextRole = String(primaryRole.role_key || primaryRole.roleKey || financeUser.role || '').trim().toLowerCase();
    var contextDepartmentCode = String(
      payload.department_code || payload.departmentCode || department.code
      || primaryRole.department_code || primaryRole.departmentCode || financeUser.department_code || financeUser.departmentCode || ''
    ).trim();
    var expectedDepartmentCode = String(requestedDepartmentCode || appUser.dc || appUser.department_code || '').trim();
    var unresolvedChainId = stepKey === 'direct_supervisor'
      ? (chain.direct_supervisor_finance_user_id || chain.directSupervisorFinanceUserId)
      : (chain.department_manager_finance_user_id || chain.departmentManagerFinanceUserId);

    if (context.ok !== true || contextUserId !== String(appUser.id)) return null;
    if (contextRole !== 'ceo' || primaryRole.can_approve === false || primaryRole.canApprove === false) return null;
    if (!contextDepartmentCode || !expectedDepartmentCode || contextDepartmentCode !== expectedDepartmentCode) return null;
    if (String(unresolvedChainId || '').trim()) return null;

    return {
      finance_user_id: String(appUser.id),
      effective_finance_user_id: String(appUser.id),
      name: financeUser.name || appUser.n || appUser.name || appUser.email || '執行長',
      email: financeUser.email || appUser.email || '',
      role: 'ceo',
      role_label: financeUser.role_label || financeUser.roleLabel || appUser.roleLabel || '執行長',
      entity_id: financeUser.entity_id || financeUser.entityId || appUser.eid || '',
      department_code: contextDepartmentCode,
      source: 'top_level_self',
    };
  }

  function approvalRuntimeStepLabel(step, key, user, deps) {
    var name = user && (user.n || user.email);
    if (!name) return (step && (step.r || step.rk)) || '簽核';
    if (key === 'direct_supervisor') return '申請人主管：' + name;
    if (key === 'dept_manager') return '申請人部門主任：' + name;
    if (key === 'applicant_confirm') return (step && step.r) || '申請人確認';
    if (key === 'applicant_invoice_delivery') return (step && step.r) || '申請人交付確認（舊流程）';
    var fallback = step && (step.r || callDep(deps || {}, 'roleLabel', step.rk) || key);
    return (step && step.r) || workflowStepLabel(step, fallback, user);
  }

  function approvalRuntimeShouldResolveStep(step, deps) {
    if (!step) return false;
    var key = stepWorkflowKeyForRuntime(step, deps || {}) || step.rk || '';
    return !!key && key !== 'applicant_submit';
  }

  function numValue(value, deps) {
    var parsed = callDep(deps || {}, 'num', value);
    if (typeof parsed === 'number' && !Number.isNaN(parsed)) return parsed;
    parsed = Number(String(value || '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function htmlEscape(value, deps) {
    var escaped = callDep(deps || {}, 'escAttr', value);
    if (escaped !== null && typeof escaped !== 'undefined') return escaped;
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function approvalRuntimeSourceTableForRecord(kind) {
    if (kind === 'invoice') return 'invoices';
    if (kind === 'bill') return 'bills';
    if (kind === 'shareholder') return 'expense_requests';
    return 'expense_requests';
  }

  function approvalRuntimeRequestType(kind, record) {
    if (kind === 'invoice') return 'invoice_request';
    if (kind === 'bill') return 'bill_request';
    if (kind === 'shareholder') return 'shareholder_transaction';
    return record && record.type ? record.type : 'expense_reimbursement';
  }

  function approvalRuntimeFormSnapshot(record, kind, extra, deps) {
    deps = deps || {};
    record = record || {};
    extra = extra || {};
    var rows = extra.rows || [];
    var applicantId = extra.applicantId || record.applicantId || callDep(deps, 'currentUserId') || '';
    var sourceNo = extra.sourceNo || record.no || record.batchNo || '';
    var requestType = extra.requestType || approvalRuntimeRequestType(kind, record);
    var departmentCode = record.dc || record.departmentCode || record.department_code || '';
    var totalAmount = numValue(extra.total || record.amt || record.total, deps);
    var dataEnvironment = record.dataEnv || callDep(deps, 'activeDataEnvironment') || '';
    return {
      kind: kind || 'expense',
      id: record.id || '',
      no: sourceNo,
      type: requestType,
      request_type: requestType,
      typeLabel: record.tL || record.item || record.method || '',
      type_label: record.tL || record.item || record.method || '',
      entityId: record.eid || '',
      entity_id: record.eid || '',
      entityName: record.en || record.entL || '',
      entity_name: record.en || record.entL || '',
      departmentCode: departmentCode,
      department_code: departmentCode,
      applicant: record.app || record.applicant || '',
      applicantId: applicantId,
      applicant_id: applicantId,
      applicant_finance_user_id: applicantId,
      applicantEmail: record.applicantEmail || '',
      applicant_email: record.applicantEmail || '',
      amount: totalAmount,
      total: totalAmount,
      total_amount: totalAmount,
      status: record.status || record.approvalStatus || '',
      currentStep: record.step || record.approvalStep || '',
      current_step: record.step || record.approvalStep || '',
      batchId: record.batchId || extra.batchId || '',
      batch_id: record.batchId || extra.batchId || '',
      batchNo: record.batchNo || extra.batchNo || '',
      batch_no: record.batchNo || extra.batchNo || '',
      batchCount: rows.length || numValue(record.batchCount, deps),
      batch_count: rows.length || numValue(record.batchCount, deps),
      batchTotal: numValue(extra.total || record.batchTotal || record.total || record.amt, deps),
      batch_total: numValue(extra.total || record.batchTotal || record.total || record.amt, deps),
      rowIds: rows.map(function (row) { return row && row.id || ''; }).filter(Boolean),
      row_ids: rows.map(function (row) { return row && row.id || ''; }).filter(Boolean),
      rowNos: rows.map(function (row) { return row && (row.no || row.payer || row.buyer) || ''; }).filter(Boolean).slice(0, 80),
      row_nos: rows.map(function (row) { return row && (row.no || row.payer || row.buyer) || ''; }).filter(Boolean).slice(0, 80),
      dataEnvironment: dataEnvironment,
      data_environment: dataEnvironment,
      syncedFrom: 'frontend_legacy_steps',
    };
  }

  function approvalRuntimeRequiredErrorMessage(result) {
    if (!result) return '未回傳簽核任務建立結果';
    if (result.error) return result.error.message || String(result.error);
    if (result.result && result.result.error) return result.result.error;
    if (result.reason) return result.reason;
    return '簽核任務沒有成功建立';
  }

  function approvalRuntimeRollbackNotice(rollback) {
    if (!rollback || rollback.ok) return '';
    return '\n\n注意：系統嘗試撤銷剛寫入的資料時，有部分資料可能被權限或資料庫擋下，已寫入系統事件紀錄。請把這個訊息交給系統管理員確認，不要重複送單。';
  }

  function approvalRuntimeGroupSource(kind, record, deps) {
    if (!record) return record;
    var grouped = null;
    if (kind === 'invoice') grouped = callDep(deps || {}, 'invoiceGroupLeader', record);
    if (kind === 'bill') grouped = callDep(deps || {}, 'billGroupLeader', record);
    return grouped || record;
  }

  function approvalRuntimeLogSafeId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || ('log_' + Date.now());
  }

  function approvalRuntimeLogSource(kind, record, deps) {
    var runtimeKind = kind === 'receipt' ? 'invoice' : kind;
    var source = approvalRuntimeGroupSource(runtimeKind, record, deps || {}) || record || {};
    return {
      kind: runtimeKind || 'expense',
      table: approvalRuntimeSourceTableForRecord(runtimeKind || 'expense'),
      id: String(source.id || ''),
      no: String(source.batchNo || source.no || source.id || ''),
    };
  }

  function approvalRuntimeLogSlotId(kind, record, deps) {
    var source = approvalRuntimeLogSource(kind, record, deps || {});
    return 'approval-runtime-log-' + approvalRuntimeLogSafeId(source.table) + '-' + approvalRuntimeLogSafeId(source.id || source.no || kind);
  }

  function approvalRuntimeLogsSlotHtml(slotId, deps) {
    return '<div class="approval-runtime-log" id="' + htmlEscape(slotId, deps) + '"><div class="approval-runtime-log-title">正式簽核紀錄 <span>讀取中</span></div><div class="approval-runtime-log-empty">正在讀取資料庫中的正式簽核任務與 audit log。</div></div>';
  }

  function approvalRuntimeLogActorName(log, deps) {
    var id = log && log.actor_finance_user_id || log && log.actorFinanceUserId || '';
    var user = id ? callDep(deps || {}, 'userById', id) : null;
    return (user && (user.n || user.email)) || id || '系統';
  }

  function approvalRuntimeLogEventLabel(log) {
    var type = String(log && log.event_type || log && log.eventType || '');
    var payload = log && log.payload || {};
    var action = String(payload.action || '');
    var map = {
      instance_created_from_published_workflow: '建立正式簽核',
      instance_synced_from_legacy_steps: '鏡射舊流程',
      task_approve: '核准',
      task_approved: '核准',
      task_reject: '駁回',
      task_return: '退回',
      task_return_previous: '退回上一關',
      task_cancel: '取消',
      task_skip: '跳過',
      task_add_sign: '加簽',
      task_transfer: '轉派',
      delegation_created: '建立代理',
      delegation_cancelled: '取消代理',
    };
    if (map[type]) return map[type];
    if (action && map['task_' + action]) return map['task_' + action];
    return type || '簽核事件';
  }

  function approvalRuntimeLogTime(log, deps) {
    var raw = log && log.created_at || log && log.createdAt || '';
    if (!raw) return '';
    var date = callDep(deps || {}, 'fromIsoDate', raw) || '';
    var time = (String(raw).match(/T(\d{2}:\d{2})/) || [])[1] || '';
    return [date, time].filter(Boolean).join(' ');
  }

  function approvalRuntimeLogComment(log) {
    var comment = String(log && log.comment || '').trim();
    if (comment) return comment;
    var payload = log && log.payload || {};
    if (payload.task_count) return '已建立 ' + payload.task_count + ' 個簽核任務。';
    if (payload.next_task_id) return '流程已移動到下一個待辦。';
    if (payload.instance_status) return '流程狀態：' + payload.instance_status;
    return '';
  }

  function approvalRuntimeLogsHtml(logs, state, deps) {
    logs = Array.isArray(logs) ? logs : [];
    state = state || {};
    var header = '<div class="approval-runtime-log-title">正式簽核紀錄 <span>' + htmlEscape(state.sourceNo || state.sourceId || 'DB audit log', deps) + '</span></div>';
    if (state.error) {
      return '<div class="approval-runtime-log">' + header + '<div class="approval-runtime-log-empty">正式簽核紀錄目前無法讀取，畫面暫以表單內簽核流程顯示；系統已留下事件紀錄供管理員追查。</div></div>';
    }
    if (!logs.length) {
      return '<div class="approval-runtime-log">' + header + '<div class="approval-runtime-log-empty">資料庫尚未回傳正式簽核紀錄，暫以表單內簽核流程顯示。</div></div>';
    }
    return '<div class="approval-runtime-log">' + header + logs.map(function (log) {
      var event = approvalRuntimeLogEventLabel(log);
      var comment = approvalRuntimeLogComment(log);
      return '<div class="approval-runtime-log-row"><div><div class="approval-runtime-log-event">' + htmlEscape(event, deps) + '</div><div class="approval-runtime-log-meta">' + htmlEscape(approvalRuntimeLogTime(log, deps), deps) + '</div></div><div><div>' + htmlEscape(approvalRuntimeLogActorName(log, deps), deps) + '</div>' + (comment ? '<div class="approval-runtime-log-meta">' + htmlEscape(comment, deps) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function approvalRuntimeTaskMatchesRecord(task, sourceTable, record) {
    if (!task || !record) return false;
    if (task.source_table !== sourceTable) return false;
    var rid = String(record.id || '');
    if (rid && String(task.source_id || '') === rid) return true;
    var snap = task.form_snapshot || {};
    var ids = [].concat(snap.rowIds || [], snap.row_ids || []).map(String);
    if (rid && ids.indexOf(rid) > -1) return true;
    var no = String(record.batchNo || record.no || record.id || '');
    if (no && String(task.source_no || '') === no) return true;
    var nos = [].concat(snap.rowNos || [], snap.row_nos || []).map(String);
    if (no && nos.indexOf(no) > -1) return true;
    var batchId = String(record.batchId || '');
    return !!batchId && (String(snap.batchId || snap.batch_id || '') === batchId || String(task.source_no || '') === batchId);
  }

  function approvalRuntimeActionMeta(kind, record, action, extra, deps) {
    var source = approvalRuntimeGroupSource(kind, record, deps || {}) || record || {};
    return Object.assign({
      kind: kind || 'expense',
      action: action || 'approve',
      sourceTable: approvalRuntimeSourceTableForRecord(kind),
      sourceId: String(source.id || record && record.id || ''),
      sourceNo: String(source.batchNo || source.no || record && record.no || ''),
      dataEnv: callDep(deps || {}, 'activeDataEnvironment') || '',
      tenantId: callDep(deps || {}, 'currentTenantId') || '',
    }, extra || {});
  }

  async function runWithTimeout(deps, promise, label, ms) {
    var timeout = deps && deps.withOperationTimeout;
    if (typeof timeout === 'function') return timeout(promise, label, ms);
    return promise;
  }

  function cloneApprovalSteps(steps, deps) {
    var cloned = callDep(deps || {}, 'cloneApprovalStepsForRecord', steps);
    if (Array.isArray(cloned)) return cloned;
    return JSON.parse(JSON.stringify(steps || []));
  }

  function approvalRuntimeLegacyOnlyResult(kind, record, sourceNo, reason, extra, deps) {
    extra = extra || {};
    deps = deps || {};
    reason = reason || callDep(deps, 'approvalRuntimeDisabledReason') || 'approval_runtime_not_installed';
    callDep(deps, 'markApprovalRuntimeUnavailable', reason, null, {
      kind: kind || 'expense',
      sourceId: record && record.id || '',
      sourceNo: sourceNo || record && (record.no || record.batchNo) || '',
      requestType: extra.requestType || approvalRuntimeRequestType(kind, record),
    });
    return { ok: true, skipped: true, runtime: 'legacy_steps_only', reason: reason };
  }

  async function syncApprovalRuntimeFromSteps(kind, record, steps, extra, deps) {
    extra = extra || {};
    deps = deps || {};
    if (callDep(deps, 'demoLogin')) return { ok: true, skipped: true, reason: 'demo' };
    var client = callDep(deps, 'getClient');
    if (!client || !record || !record.id || !Array.isArray(steps) || !steps.length) return { ok: false, skipped: true, reason: 'missing_context' };
    var sourceTable = extra.sourceTable || approvalRuntimeSourceTableForRecord(kind);
    var requestType = extra.requestType || approvalRuntimeRequestType(kind, record);
    var sourceNo = extra.sourceNo || record.batchNo || record.no || record.id;
    var applicantId = extra.applicantId || record.applicantId || callDep(deps, 'currentUserId') || '';
    if (callDep(deps, 'approvalRuntimeLikelyAvailable') === false) {
      return approvalRuntimeLegacyOnlyResult(kind, record, sourceNo, 'approval_runtime_not_installed', Object.assign({}, extra, { requestType: requestType }), deps);
    }
    var payload = {
      p_source_table: sourceTable,
      p_source_id: String(extra.sourceId || record.id),
      p_source_no: String(sourceNo || ''),
      p_request_type: requestType,
      p_applicant_finance_user_id: applicantId || null,
      p_steps: cloneApprovalSteps(steps, deps),
      p_form_snapshot: approvalRuntimeFormSnapshot(record, kind, extra, deps),
      p_data_environment: record.dataEnv || callDep(deps, 'activeDataEnvironment'),
    };
    var publishedPayload = {
      p_source_table: payload.p_source_table,
      p_source_id: payload.p_source_id,
      p_source_no: payload.p_source_no,
      p_request_type: payload.p_request_type,
      p_applicant_finance_user_id: payload.p_applicant_finance_user_id,
      p_form_snapshot: payload.p_form_snapshot,
      p_data_environment: payload.p_data_environment,
      p_legacy_steps: payload.p_steps,
    };
    try {
      var published = await runWithTimeout(deps, client.rpc('finance_approval_create_instance_from_workflow', publishedPayload), '正式簽核流程任務建立', 15000);
      if (published.error) throw published.error;
      if (published.data && published.data.ok === false) {
        var workflowError = published.data.error || '正式簽核流程尚未設定完整';
        callDep(deps, 'recordOpsEvent', 'approval_runtime_create_failed', 'critical', '正式簽核流程任務建立失敗', (sourceNo || record.id || '表單') + ' 無法由 published workflow 建立 runtime：' + workflowError, {
          kind: kind || 'expense',
          sourceTable: sourceTable,
          sourceId: payload.p_source_id,
          sourceNo: sourceNo || '',
          requestType: requestType,
          error: workflowError,
          missingSteps: published.data.missing_steps || [],
          dataEnv: callDep(deps, 'activeDataEnvironment'),
          tenantId: callDep(deps, 'currentTenantId'),
        });
        return { ok: false, runtime: 'published_workflow', error: new Error(workflowError), payload: publishedPayload, result: published.data };
      }
      if (published.data && published.data.ok) {
        return { ok: true, runtime: 'published_workflow', instanceId: published.data.instance_id || '', payload: publishedPayload, result: published.data };
      }
      throw new Error('正式簽核流程任務建立未回傳結果');
    } catch (primaryErr) {
      var primaryMessage = primaryErr && primaryErr.message ? primaryErr.message : String(primaryErr || 'unknown error');
      console.warn('Published workflow runtime sync failed; falling back to legacy step bridge:', primaryMessage, publishedPayload);
      if (callDep(deps, 'isApprovalRuntimeUnavailableError', primaryErr)) {
        return approvalRuntimeLegacyOnlyResult(kind, record, sourceNo, 'published_workflow_runtime_unavailable', Object.assign({}, extra, { requestType: requestType }), deps);
      }
      callDep(deps, 'recordOpsEvent', 'approval_runtime_create_fallback', 'warn', '正式簽核流程任務建立改用舊鏡射備援', (sourceNo || record.id || '表單') + ' 尚未能由 published workflow 建立 runtime，改用 legacy steps bridge：' + primaryMessage, {
        kind: kind || 'expense',
        sourceTable: sourceTable,
        sourceId: payload.p_source_id,
        sourceNo: sourceNo || '',
        requestType: requestType,
        error: primaryMessage,
        dataEnv: callDep(deps, 'activeDataEnvironment'),
        tenantId: callDep(deps, 'currentTenantId'),
      });
    }
    try {
      var res = await runWithTimeout(deps, client.rpc('finance_approval_sync_instance_from_steps', payload), '簽核 runtime 任務同步', 12000);
      if (res.error) throw res.error;
      return { ok: true, runtime: 'legacy_steps_bridge', instanceId: res.data || '', payload: payload };
    } catch (err) {
      var message = err && err.message ? err.message : String(err || 'unknown error');
      if (callDep(deps, 'isApprovalRuntimeUnavailableError', err)) {
        return approvalRuntimeLegacyOnlyResult(kind, record, sourceNo, 'legacy_steps_runtime_unavailable', Object.assign({}, extra, { requestType: requestType }), deps);
      }
      callDep(deps, 'recordOpsEvent', 'approval_runtime_sync_failed', 'critical', '簽核 runtime 任務同步失敗', (sourceNo || record.id || '表單') + ' 未能鏡射到 approval_instances / approval_tasks：' + message, {
        kind: kind || 'expense',
        sourceTable: sourceTable,
        sourceId: payload.p_source_id,
        sourceNo: sourceNo || '',
        requestType: requestType,
        error: message,
        dataEnv: callDep(deps, 'activeDataEnvironment'),
        tenantId: callDep(deps, 'currentTenantId'),
      });
      console.warn('Approval runtime sync failed:', message, payload);
      return { ok: false, error: err, payload: payload };
    }
  }

  async function requireApprovalRuntimeForSubmittedRecord(kind, record, steps, extra, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    var result = await syncApprovalRuntimeFromSteps(kind, record, steps, extra, deps);
    if (result && result.ok) return result;
    var msg = approvalRuntimeRequiredErrorMessage(result);
    callDep(deps, 'recordOpsEvent', 'approval_runtime_required_failed', 'critical', (opts.label || '送單') + '未建立簽核待辦', (record && (record.no || record.batchNo || record.id) || '表單') + ' 已阻止送出：' + msg, {
      kind: kind || 'expense',
      sourceId: record && record.id || '',
      sourceNo: record && (record.no || record.batchNo) || '',
      requestType: extra && extra.requestType || '',
      error: msg,
      dataEnv: callDep(deps, 'activeDataEnvironment'),
      tenantId: callDep(deps, 'currentTenantId'),
    });
    var err = new Error('簽核待辦建立失敗：' + msg);
    err.runtimeResult = result;
    throw err;
  }

  async function rollbackSubmittedRowsAfterRuntimeFailure(table, rows, attachmentGroups, label, deps) {
    deps = deps || {};
    rows = (rows || []).filter(Boolean);
    var failures = [];
    for (var i = 0; i < rows.length; i += 1) {
      try {
        var res = await callDep(deps, 'dbDelete', table, rows[i].id);
        if (!callDep(deps, 'settingsWriteResultOk', res)) failures.push(table + ':' + (rows[i].id || '') + ' ' + ((res && res.error && (res.error.message || JSON.stringify(res.error))) || '刪除失敗'));
      } catch (e) {
        failures.push(table + ':' + (rows[i] && rows[i].id || '') + ' ' + (e && e.message ? e.message : e));
        console.warn('Runtime failure rollback delete skipped:', table, rows[i] && rows[i].id, e && e.message ? e.message : e);
      }
    }
    if (attachmentGroups && attachmentGroups.length) {
      await callDep(deps, 'cleanupUploadedSupabaseAttachments', attachmentGroups, (label || '送單簽核待辦建立失敗') + '附件清理');
    }
    if (failures.length) {
      callDep(deps, 'recordOpsEvent', 'approval_runtime_rollback_failed', 'critical', (label || '送單') + ' runtime 失敗後撤銷資料未完全成功', failures.join('；'), {
        table: table,
        rowCount: rows.length,
        failures: failures,
        dataEnv: callDep(deps, 'activeDataEnvironment'),
        tenantId: callDep(deps, 'currentTenantId'),
      });
    }
    return { ok: !failures.length, failures: failures };
  }

  async function loadApprovalRuntimeLogsForRecord(kind, record, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    if (callDep(deps, 'demoLogin')) return { ok: true, logs: [], source: approvalRuntimeLogSource(kind, record, deps), skipped: true };
    var client = callDep(deps, 'getClient');
    var source = approvalRuntimeLogSource(kind, record, deps);
    if (!client || !source.id) return { ok: false, logs: [], source: source, error: new Error('missing_source') };
    var cacheKey = source.table + ':' + source.id;
    var cached = callDep(deps, 'approvalRuntimeLogCacheGet', cacheKey);
    if (!opts.force && cached) return cached;
    try {
      var res = await runWithTimeout(deps, client.rpc('finance_approval_logs_for_source', { p_source_table: source.table, p_source_id: source.id }), '正式簽核紀錄查詢', 8000);
      if (res.error) throw res.error;
      var result = { ok: true, logs: Array.isArray(res.data) ? res.data : [], source: source };
      callDep(deps, 'approvalRuntimeLogCacheSet', cacheKey, result);
      return result;
    } catch (err) {
      var message = err && err.message ? err.message : String(err || 'unknown error');
      callDep(deps, 'recordOpsEventDedup', 'approval_runtime_logs_load_failed', 'warn', '正式簽核紀錄讀取失敗', (source.no || source.id || '表單') + ' 無法讀取 approval_logs：' + message, {
        kind: source.kind,
        sourceTable: source.table,
        sourceId: source.id,
        sourceNo: source.no,
        error: message,
        dataEnv: callDep(deps, 'activeDataEnvironment'),
        tenantId: callDep(deps, 'currentTenantId'),
      });
      return { ok: false, logs: [], source: source, error: err };
    }
  }

  async function findApprovalRuntimePendingTask(kind, record, deps) {
    deps = deps || {};
    if (callDep(deps, 'demoLogin')) return null;
    var client = callDep(deps, 'getClient');
    if (!client || !record) return null;
    var sourceTable = approvalRuntimeSourceTableForRecord(kind);
    var source = approvalRuntimeGroupSource(kind, record, deps) || record;
    var res = await runWithTimeout(deps, client.rpc('finance_approval_tasks_for_current_user', { p_status: 'pending' }), '簽核 runtime 待辦查詢', 8000);
    if (res.error) throw res.error;
    var rows = Array.isArray(res.data) ? res.data : [];
    return rows.find(function (task) { return approvalRuntimeTaskMatchesRecord(task, sourceTable, source); })
      || rows.find(function (task) { return approvalRuntimeTaskMatchesRecord(task, sourceTable, record); })
      || null;
  }

  async function syncApprovalRuntimeAction(kind, record, action, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    if (callDep(deps, 'demoLogin')) return { ok: true, skipped: true, reason: 'demo' };
    var client = callDep(deps, 'getClient');
    if (!client || !record) return { ok: false, skipped: true, reason: 'missing_context' };
    try {
      var task = await findApprovalRuntimePendingTask(kind, record, deps);
      if (!task) return { ok: false, skipped: true, reason: 'task_not_found' };
      var rpcName = 'finance_approval_act_task';
      var payload = { p_task_id: task.task_id, p_action: action || 'approve', p_comment: opts.comment || '', p_decision_files: opts.files || [] };
      if (action === 'add_sign') {
        if (!opts.addUid) return { ok: false, skipped: true, reason: 'missing_add_sign_user' };
        rpcName = 'finance_approval_add_sign_task';
        payload = { p_task_id: task.task_id, p_assignee_finance_user_id: opts.addUid, p_comment: opts.comment || '', p_decision_files: opts.files || [] };
      }
      var res = await runWithTimeout(deps, client.rpc(rpcName, payload), '簽核 runtime 動作同步', 12000);
      if (res.error) throw res.error;
      return { ok: true, data: res.data, task: task };
    } catch (err) {
      var message = err && err.message ? err.message : String(err || 'unknown error');
      console.warn('Approval runtime action sync failed; legacy approval already persisted:', message, approvalRuntimeActionMeta(kind, record, action, {}, deps));
      callDep(deps, 'recordOpsEventDedup', 'approval_runtime_action_fallback', 'warn', '簽核 runtime 動作同步改用舊流程', message, approvalRuntimeActionMeta(kind, record, action, { error: message }, deps));
      return { ok: false, error: err };
    }
  }

  async function syncApprovalRuntimeApproveAction(kind, record, comment, files, addUid, deps) {
    return syncApprovalRuntimeAction(kind, record, addUid ? 'add_sign' : 'approve', { comment: comment || '', files: files || [], addUid: addUid || '' }, deps || {});
  }

  function workflowCleanStep(step, deps) {
    deps = deps || {};
    var key = workflowStepKey(step);
    var meta = callDep(deps, 'stepMeta', key) || {};
    var actorKind = String((step && (step.actorKind || step.actor_kind)) || meta.actorKind || meta.actor_kind || '').trim();
    var actorTarget = String((step && (step.actorTarget || step.actor_target || step.target)) || meta.actorTarget || meta.actor_target || meta.target || '').trim();
    var targetUnitType = String((step && (step.targetUnitType || step.target_unit_type)) || meta.targetUnitType || meta.target_unit_type || '').trim();
    var actorRef = String((step && (step.actorRef || step.actor_ref)) || meta.actorRef || meta.actor_ref || '').trim();
    var rawAllowCrossEntity = step && step.allowCrossEntity !== undefined
      ? step.allowCrossEntity
      : step && step.allow_cross_entity !== undefined
        ? step.allow_cross_entity
        : meta.allowCrossEntity !== undefined
          ? meta.allowCrossEntity
          : meta.allow_cross_entity;
    return {
      key: key,
      label: String((step && step.label) || meta.label || key || '簽核').trim(),
      required: !(step && step.required === false),
      purpose: String((step && step.purpose) || meta.purpose || '').trim(),
      actorKind: actorKind,
      actorTarget: actorTarget,
      targetUnitType: targetUnitType,
      actorRef: actorRef,
      allowCrossEntity: workflowBoolValue(rawAllowCrossEntity, false, deps),
    };
  }

  function workflowCleanConditionalRoute(route, index, deps) {
    deps = deps || {};
    route = route || {};
    var id = String(route.id || route.key || '').trim() || ('route_' + ((index || 0) + 1));
    var rawField = route.field || route.fieldKey || route.field_key || route.targetField;
    var field = callDep(deps, 'normalizeConditionField', rawField) || String(rawField || 'amount').trim();
    var operator = callDep(deps, 'normalizeConditionOperator', field, route.operator || route.op) || String(route.operator || route.op || 'eq').trim();
    var value = callDep(deps, 'conditionValueForField', field, route.value);
    if (value === null || typeof value === 'undefined') value = route.value;
    var value2 = callDep(deps, 'conditionValue2ForField', field, route.value2 || route.max);
    if (value2 === null || typeof value2 === 'undefined') value2 = route.value2 || route.max || '';
    return {
      id: id,
      label: String(route.label || ('條件路線 ' + ((index || 0) + 1))).trim(),
      enabled: route.enabled !== false,
      field: field,
      operator: operator,
      value: value,
      value2: value2,
      steps: (Array.isArray(route.steps) ? route.steps : []).map(function (step) {
        return workflowCleanStep(step, deps);
      }).filter(function (step) {
        return step.key || step.label;
      }),
    };
  }

  function workflowCleanTemplate(template, deps) {
    template = template || {};
    deps = deps || {};
    return {
      id: String(template.id || '').trim(),
      name: String(template.name || '').trim(),
      appliesTo: (Array.isArray(template.appliesTo) ? template.appliesTo : []).map(function (type) {
        return String(type || '').trim();
      }).filter(Boolean),
      enabled: template.enabled !== false,
      steps: (Array.isArray(template.steps) ? template.steps : []).map(function (step) {
        return workflowCleanStep(step, deps);
      }).filter(function (step) {
        return step.key || step.label;
      }),
      conditionalRoutes: (Array.isArray(template.conditionalRoutes) ? template.conditionalRoutes : []).map(function (route, index) {
        return workflowCleanConditionalRoute(route, index, deps);
      }).filter(function (route) {
        return route.id && route.label;
      }),
    };
  }

  function workflowConditionalRoutes(template, deps) {
    return (Array.isArray(template && template.conditionalRoutes) ? template.conditionalRoutes : []).map(function (route, index) {
      return workflowCleanConditionalRoute(route, index, deps || {});
    });
  }

  function workflowSelectRoute(template, ctx, deps) {
    deps = deps || {};
    var routes = workflowConditionalRoutes(template, deps);
    for (var i = 0; i < routes.length; i += 1) {
      var matches = callDep(deps, 'routeMatches', routes[i], ctx || {});
      if (matches === true) return routes[i];
    }
    return null;
  }

  function workflowTemplateStepsForContext(template, ctx, deps) {
    deps = deps || {};
    template = workflowCleanTemplate(template, deps);
    var route = workflowSelectRoute(template, ctx || {}, deps);
    var steps = route && route.steps && route.steps.length ? route.steps : template.steps;
    return { route: route, steps: steps || [] };
  }

  function workflowTemplateForRequestType(requestType, value, defaults) {
    var templates = normalizeWorkflowTemplates(value, defaults);
    var template = templates.find(function (entry) {
      return entry && entry.enabled !== false && Array.isArray(entry.appliesTo) &&
        entry.appliesTo.indexOf(requestType) > -1 && Array.isArray(entry.steps) && entry.steps.length;
    }) || null;
    return { templates: templates, template: template };
  }

  function workflowApplyTypeOwners(templates, deps) {
    deps = deps || {};
    var owners = {};
    (templates || []).map(function (template) {
      return workflowCleanTemplate(template, deps);
    }).forEach(function (template) {
      if (!template || template.enabled === false) return;
      (template.appliesTo || []).forEach(function (type) {
        if (!owners[type]) owners[type] = [];
        owners[type].push(template.id);
      });
    });
    return owners;
  }

  function workflowTemplateValidationDeps(deps) {
    deps = deps || {};
    return {
      knownStepKeys: callDep(deps, 'knownStepKeys') || [],
      coreRequestTypes: callDep(deps, 'coreRequestTypes') || [],
      requestTypeLabel: function (type) {
        return callDep(deps, 'requestTypeLabel', type) || type;
      },
      stepMeta: function (key) {
        return callDep(deps, 'stepMeta', key) || { key: key, label: key || '簽核' };
      },
      recommendedKeysForType: function (type) {
        return callDep(deps, 'recommendedKeysForType', type) || [];
      },
      conditionFieldMeta: function (field) {
        return callDep(deps, 'conditionFieldMeta', field) || { key: field, label: field || '條件', type: 'text' };
      },
      num: function (value) {
        var parsed = callDep(deps, 'num', value);
        if (typeof parsed === 'number' && !Number.isNaN(parsed)) return parsed;
        parsed = Number(String(value || '').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
      },
    };
  }

  function validateWorkflowTemplateConfig(template, templates, deps) {
    deps = deps || {};
    var helpers = workflowTemplateValidationDeps(deps);
    template = workflowCleanTemplate(template, deps);
    templates = (templates || []).map(function (entry) {
      return workflowCleanTemplate(entry, deps);
    });
    var rows = [];
    var owners = workflowApplyTypeOwners(templates, deps);
    var known = helpers.knownStepKeys;
    var core = helpers.coreRequestTypes;
    if (!template.id) rows.push({ level: 'fail', label: '流程代碼', detail: '流程代碼不可空白。' });
    if (!template.name) rows.push({ level: 'fail', label: '流程名稱', detail: '流程名稱不可空白。' });
    if (template.enabled !== false && !template.appliesTo.length) rows.push({ level: 'fail', label: '適用單據', detail: '啟用中的流程至少要指定一種單據。' });
    (template.appliesTo || []).forEach(function (type) {
      if ((owners[type] || []).length > 1) rows.push({ level: 'fail', label: '適用單據重複', detail: '「' + helpers.requestTypeLabel(type) + '」同時被 ' + owners[type].join('、') + ' 接管，正式引擎只會抓第一個，請保留一個啟用流程。' });
      if (core.indexOf(type) < 0) rows.push({ level: 'warn', label: '舊版自訂單據類型', detail: '「' + type + '」目前沒有對應的前台表單，系統會保留歷史設定但鎖定編輯，也不會讓使用者建立或送出此類單據。' });
    });
    var requiredSteps = (template.steps || []).filter(function (step) { return step.required !== false; });
    if (template.enabled !== false && !requiredSteps.length) rows.push({ level: 'fail', label: '關卡設定', detail: '啟用中的流程至少要有一個啟用關卡。' });
    (template.steps || []).forEach(function (step, index) {
      var key = workflowStepKey(step);
      if (!key) rows.push({ level: 'fail', label: '第 ' + (index + 1) + ' 關', detail: '關卡代碼不可空白。' });
      else if (known.indexOf(key) < 0) rows.push({ level: 'fail', label: '第 ' + (index + 1) + ' 關', detail: '「' + key + '」不是系統支援的關卡或正式角色，無法儲存；請從關卡元件庫選擇。' });
      if (!String(step.label || '').trim()) rows.push({ level: 'warn', label: '第 ' + (index + 1) + ' 關', detail: '建議填寫顯示名稱，避免前台只看到關卡代碼。' });
    });
    (template.conditionalRoutes || []).forEach(function (route, routeIndex) {
      var routeLabel = route.label || ('條件路線 ' + (routeIndex + 1));
      var routeMeta = helpers.conditionFieldMeta(route.field);
      if (route.enabled !== false && routeMeta.type === 'number' && route.operator === 'between' && helpers.num(route.value2) <= 0) rows.push({ level: 'fail', label: routeLabel, detail: '區間條件需要填寫第二個金額。' });
      if (route.enabled !== false && routeMeta.type === 'number' && route.operator !== 'between' && helpers.num(route.value) <= 0) rows.push({ level: 'warn', label: routeLabel, detail: '此條件金額為 0，可能會讓大部分單據都進入此路線。' });
      if (route.enabled !== false && routeMeta.type === 'text' && !String(route.value || '').trim()) rows.push({ level: 'fail', label: routeLabel, detail: '文字條件「' + routeMeta.label + '」需要填寫條件值。' });
      var routeRequired = (route.steps || []).filter(function (step) { return step.required !== false; });
      if (route.enabled !== false && !routeRequired.length) rows.push({ level: 'fail', label: routeLabel, detail: '啟用中的條件路線至少要有一個啟用關卡。' });
      (route.steps || []).forEach(function (step, index) {
        var key = workflowStepKey(step);
        if (!key) rows.push({ level: 'fail', label: routeLabel + ' 第 ' + (index + 1) + ' 關', detail: '關卡代碼不可空白。' });
        else if (known.indexOf(key) < 0) rows.push({ level: 'fail', label: routeLabel + ' 第 ' + (index + 1) + ' 關', detail: '「' + key + '」不是系統支援的關卡或正式角色，無法儲存；請從關卡元件庫選擇。' });
      });
    });
    var keys = requiredSteps.map(workflowStepKey);
    if (template.enabled !== false && (template.appliesTo || []).indexOf('invoice_request') > -1 && keys.indexOf('accountant_invoice') < 0) {
      rows.push({ level: 'fail', label: '開立發票必要關卡', detail: '開立發票流程必須包含「會計開立發票」。此關通過後系統才會建立收款追蹤。' });
    }
    var recommended = [];
    (template.appliesTo || []).forEach(function (type) {
      helpers.recommendedKeysForType(type).forEach(function (key) {
        if (recommended.indexOf(key) < 0) recommended.push(key);
      });
    });
    recommended.forEach(function (key) {
      if (keys.indexOf(key) < 0) rows.push({ level: 'warn', label: '建議關卡', detail: template.name + ' 缺少「' + helpers.stepMeta(key).label + '」；若是刻意客製可忽略，否則流程可能與標準單據預期不同。' });
    });
    if (!rows.length) rows.push({ level: 'ok', label: '模板結構', detail: '流程代碼、適用單據與關卡結構通過。' });
    return rows;
  }

  function workflowTemplateConfigHealthRecords(templates, deps) {
    deps = deps || {};
    var rows = [];
    (templates || []).forEach(function (template) {
      validateWorkflowTemplateConfig(template, templates, deps).forEach(function (row) {
        if (row.level === 'ok') return;
        rows.push({
          group: '客製化流程設定',
          label: ((template && (template.name || template.id)) || '未命名流程') + '：' + row.label,
          table: template && template.id,
          status: row.level === 'fail' ? 'fail' : 'warn',
          detail: row.detail,
        });
      });
    });
    if (!rows.length) rows.push({ group: '客製化流程設定', label: '流程模板結構', status: 'ok', detail: '所有流程模板代碼、適用單據與關卡結構通過。' });
    return rows;
  }

  function workflowBlockingValidationRows(templates, deps) {
    var rows = [];
    (templates || []).forEach(function (template) {
      validateWorkflowTemplateConfig(template, templates, deps || {}).filter(function (row) {
        return row.level === 'fail';
      }).forEach(function (row) {
        rows.push(((template && (template.name || template.id)) || '未命名流程') + '｜' + row.label + '：' + row.detail);
      });
    });
    return rows;
  }

  function approvalRoleLabel(role, deps) {
    return callDep(deps || {}, 'roleLabel', role) || role;
  }

  function approvalFirstUser(role, deps) {
    if (role === 'cashier') return approvalCashierUser(deps);
    return callDep(deps || {}, 'firstUserByRole', role) || null;
  }

  function approvalCashierUser(deps) {
    return callDep(deps || {}, 'cashierUser') || callDep(deps || {}, 'firstUserByRole', 'cashier') || null;
  }

  function approvalScopedRole(role, deps) {
    return !!callDep(deps || {}, 'scopedApprovalRole', role);
  }

  function approvalGlobalRole(role, deps) {
    return !!callDep(deps || {}, 'globalApprovalRole', role);
  }

  function approvalScopedUser(role, appUser, deps) {
    return callDep(deps || {}, 'scopedUserByRole', role, appUser) || null;
  }

  function approvalSameUser(a, b, deps) {
    var fromDep = callDep(deps || {}, 'sameApprovalUser', a, b);
    if (typeof fromDep === 'boolean') return fromDep;
    return !!(a && b && a.id && b.id && a.id === b.id);
  }

  function approvalAutoMergedDeptManagerStep(label, user, status, sourceLabel, deps) {
    var fromDep = callDep(deps || {}, 'autoMergedDeptManagerStep', label, user, status, sourceLabel);
    if (fromDep) return fromDep;
    return {
      r: label || ('申請人部門主任：' + ((user && user.n) || '')),
      rk: 'dept_manager',
      uid: user && user.id ? user.id : '',
      n: '系統自動跳關',
      a: 'approved',
      t: '',
      c: '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
      status: status || 'pending_dept_manager',
      purpose: '此關與「' + (sourceLabel || '申請人上一層級主管') + '」為同一位簽核人。為避免重複簽核，前一關通過後本關自動同步通過。',
      autoSkip: true,
      autoSkipReason: 'same_direct_supervisor_and_dept_manager',
    };
  }

  function approvalDirectSupervisor(appUser, deps) {
    var user = callDep(deps || {}, 'directSupervisorUser', appUser) || null;
    if (user && !user.id) return null;
    return user;
  }

  function approvalDeptManager(appUser, deps) {
    var user = callDep(deps || {}, 'approvalDeptManagerUser', appUser) || null;
    if (user && !user.id) return null;
    return user;
  }

  function approvalStep(label, role, status, user, purpose, extra) {
    return Object.assign({
      r: label,
      rk: role,
      uid: user && user.id ? user.id : '',
      n: '',
      a: '',
      t: '',
      c: '',
      status: status,
      purpose: purpose || '',
    }, extra || {});
  }

  // A required review role must never disappear merely because the canonical
  // resolver selected the applicant.  Keep the exact workflow shape and leave
  // an auditable, already-approved system step instead of creating a self-
  // approval task.  Operational/terminal steps remain actionable by the same
  // person because completing that work is not approving their own request.
  var APPLICANT_SELF_PENDING_STEP_KEYS = [
    'applicant_submit',
    'applicant_confirm',
    'applicant_invoice_delivery',
    'accountant_final',
    'accountant_invoice',
    'procurement_payment',
    'procurement_receipt',
    'cashier',
  ];
  var CANONICAL_APPLICANT_SELF_AUTO_SKIP_REASON = 'canonical_actor_is_applicant';
  var CANONICAL_APPLICANT_SELF_AUTO_SKIP_NAME = '系統自動跳關';
  var CANONICAL_APPLICANT_SELF_AUTO_SKIP_COMMENT = '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。';

  function applicantSelfStepKey(step, deps) {
    return stepWorkflowKeyForRuntime(step, deps || {}) || String(step && step.rk || '').trim();
  }

  function applicantSelfPendingAllowed(step, deps) {
    return APPLICANT_SELF_PENDING_STEP_KEYS.indexOf(applicantSelfStepKey(step, deps)) > -1;
  }

  function clearCanonicalApplicantSelfAutoSkip(step) {
    if (!step || step.autoSkipReason !== CANONICAL_APPLICANT_SELF_AUTO_SKIP_REASON) return step;
    step.a = '';
    step.n = '';
    step.t = '';
    step.c = '';
    step.autoSkip = false;
    delete step.autoSkipReason;
    delete step.autoSkipAudit;
    return step;
  }

  function normalizeApplicantSelfStep(step, appUser, requestType, deps) {
    if (!step || !appUser || !appUser.id) return step;
    var key = applicantSelfStepKey(step, deps);
    var assignedToApplicant = !!step.uid && String(step.uid) === String(appUser.id);
    if (!assignedToApplicant || applicantSelfPendingAllowed(step, deps)) return step;
    step.uid = appUser.id;
    step.a = 'approved';
    step.n = CANONICAL_APPLICANT_SELF_AUTO_SKIP_NAME;
    step.t = '';
    step.c = CANONICAL_APPLICANT_SELF_AUTO_SKIP_COMMENT;
    step.autoSkip = true;
    step.autoSkipReason = CANONICAL_APPLICANT_SELF_AUTO_SKIP_REASON;
    step.autoSkipAudit = {
      actor: 'system',
      applicantFinanceUserId: String(appUser.id),
      workflowStepKey: key,
      rule: 'no_self_approval',
    };
    step.purpose = '本關依正式組織解析為申請人本人。為避免自我簽核，保留完整流程軌跡並由系統自動跳關。';
    return step;
  }

  function normalizeApplicantSelfSteps(steps, appUser, requestType, deps) {
    return (Array.isArray(steps) ? steps : []).map(function (step) {
      return normalizeApplicantSelfStep(step, appUser, requestType, deps || {});
    });
  }

  function applicantSelfAuditError(step, appUser, deps) {
    if (!step || !appUser || !appUser.id) return '';
    var key = applicantSelfStepKey(step, deps);
    var assignedToApplicant = !!step.uid && String(step.uid) === String(appUser.id);
    var canonicalAutoSkip = step.autoSkipReason === CANONICAL_APPLICANT_SELF_AUTO_SKIP_REASON;
    if (canonicalAutoSkip) {
      if (!assignedToApplicant || step.autoSkip !== true || step.a !== 'approved') {
        return '關卡「' + (step.r || key || '未命名關卡') + '」的申請人自動跳關稽核資料不一致。';
      }
      if (step.n !== CANONICAL_APPLICANT_SELF_AUTO_SKIP_NAME || step.c !== CANONICAL_APPLICANT_SELF_AUTO_SKIP_COMMENT) {
        return '關卡「' + (step.r || key || '未命名關卡') + '」的申請人自動跳關說明遭到變更。';
      }
      if (applicantSelfPendingAllowed(step, deps)) {
        return '關卡「' + (step.r || key || '未命名關卡') + '」是可由本人完成的作業關，不可偽裝成自動跳關。';
      }
      return '';
    }
    if (assignedToApplicant && key !== 'applicant_submit' && applicantSelfPendingAllowed(step, deps) && approvalStepAutoClosed(step)) {
      return '關卡「' + (step.r || key || '未命名關卡') + '」是需由本人完成的作業關，不可預先通過或自動跳關。';
    }
    if (assignedToApplicant && !applicantSelfPendingAllowed(step, deps)) {
      return '關卡「' + (step.r || key || '未命名關卡') + '」是中間審核關，不可讓申請人核准自己的申請。';
    }
    return '';
  }

  function canonicalApplicantSelfFallbackUser(key, user, appUser) {
    if (user) return user;
    if (appUser && appUser.id && appUser.role === 'ceo' && ['direct_supervisor', 'dept_manager'].indexOf(key) > -1) {
      return appUser;
    }
    return null;
  }

  function approvalAddRoleStep(steps, role, label, status, assignedUser, appUser, deps) {
    if (!role) return;
    var user = assignedUser || (approvalScopedRole(role, deps) ? null : approvalScopedUser(role, appUser, deps));
    user = canonicalApplicantSelfFallbackUser(role, user, appUser);
    if (!user && !approvalGlobalRole(role, deps) && !approvalScopedRole(role, deps)) return;
    if (steps.some(function (step) { return step.rk === role; })) return;
    steps.push(normalizeApplicantSelfStep(approvalStep(label || approvalRoleLabel(role, deps), role, status, user), appUser, '', deps));
  }

  function appendDeptManagerStep(steps, appUser, supervisor, deptManager, labelPrefix, status, sourceWhenSameSupervisor, deps, missingLabel) {
    if (appUser && appUser.role === 'dept_manager') {
      steps.push(approvalAutoMergedDeptManagerStep(labelPrefix + '：' + appUser.n, appUser, status, '申請人本人為部門主任', deps));
    } else if (deptManager && approvalSameUser(appUser, deptManager, deps)) {
      steps.push(approvalAutoMergedDeptManagerStep(labelPrefix + '：' + deptManager.n, deptManager, status, '申請人本人為部門主任', deps));
    } else if (deptManager && approvalSameUser(supervisor, deptManager, deps)) {
      steps.push(approvalAutoMergedDeptManagerStep(labelPrefix + '：' + deptManager.n, deptManager, status, sourceWhenSameSupervisor, deps));
    } else {
      approvalAddRoleStep(steps, 'dept_manager', deptManager ? labelPrefix + '：' + deptManager.n : (missingLabel || (labelPrefix + '（未設定）')), status, deptManager, appUser, deps);
    }
  }

  function buildPurchaseApprovalSteps(appUser, deps) {
    var generalAffairs = approvalFirstUser('general_affairs', deps);
    var steps = [
      approvalStep('總務：找商品並填寫預估匯款資訊', 'procurement_payment', 'pending_procurement', generalAffairs, '總務依申請需求找商品，填寫預估採購金額、收款人、銀行分行帳號與預計匯款日；此時尚不需要發票憑據。'),
    ];
    var supervisor = canonicalApplicantSelfFallbackUser('direct_supervisor', approvalDirectSupervisor(appUser, deps), appUser);
    approvalAddRoleStep(steps, 'direct_supervisor', supervisor ? '申請人主管通過：' + supervisor.n : '申請人主管（未設定）', 'pending_section_chief', supervisor, appUser, deps);
    var deptManager = canonicalApplicantSelfFallbackUser('dept_manager', approvalDeptManager(appUser, deps), appUser);
    appendDeptManagerStep(steps, appUser, supervisor, deptManager, '申請人部門主任通過', 'pending_dept_manager', '申請人主管', deps, '申請人部門主任（未設定）');
    approvalAddRoleStep(steps, 'accountant', '會計通過', 'pending_accountant', null, appUser, deps);
    approvalAddRoleStep(steps, 'ceo', '執行長檢視會計科目', 'pending_ceo', null, appUser, deps);
    approvalAddRoleStep(steps, 'cashier', '出納放款', 'pending_cashier', approvalCashierUser(deps), appUser, deps);
    steps.push(approvalStep('申請人確認收到採購商品', 'applicant_confirm', 'pending_applicant_confirm', appUser, '申請人確認總務採購的商品或服務已實際收到，確認後才進入總務補憑據。'));
    steps.push(approvalStep('總務提供採購憑據', 'procurement_receipt', 'pending_procurement', generalAffairs, '總務採購完成後上傳發票或憑據，並填入最後正確採購金額；會計將依此銷帳。'));
    steps.push(approvalStep('會計銷帳入帳', 'accountant_final', 'pending_voucher', approvalFirstUser('accountant', deps), '會計確認憑據與最後金額，通過後才產生傳票並連動三表。'));
    return normalizeApplicantSelfSteps(steps, appUser, 'purchase_request', deps);
  }

  function buildDefaultApprovalSteps(appUser, requestType, deps) {
    deps = deps || {};
    if (requestType === 'purchase_request') return buildPurchaseApprovalSteps(appUser, deps);
    var steps = [];
    var supervisor = canonicalApplicantSelfFallbackUser('direct_supervisor', approvalDirectSupervisor(appUser, deps), appUser);
    var deptManager = canonicalApplicantSelfFallbackUser('dept_manager', approvalDeptManager(appUser, deps), appUser);
    if (requestType === 'advance_request') {
      approvalAddRoleStep(steps, 'direct_supervisor', supervisor ? '主管通過：' + supervisor.n : '主管通過（未設定）', 'pending_section_chief', supervisor, appUser, deps);
      appendDeptManagerStep(steps, appUser, supervisor, deptManager, '申請人部門主任通過', 'pending_dept_manager', '主管通過', deps);
      approvalAddRoleStep(steps, 'admin_director', '行政部門主任', 'pending_admin_director', null, appUser, deps);
      approvalAddRoleStep(steps, 'accountant', '會計', 'pending_accountant', null, appUser, deps);
      approvalAddRoleStep(steps, 'ceo', '執行長檢視會計科目', 'pending_ceo', null, appUser, deps);
      approvalAddRoleStep(steps, 'cashier', '出納放款', 'pending_cashier', approvalCashierUser(deps), appUser, deps);
      steps.push(approvalStep('申請人提供最後支出最正確的憑據', 'applicant_confirm', 'pending_applicant_confirm', appUser, '請申請人上傳最後實際花費的發票、憑據照片與即時 Excel 明細，作為核銷依據。'));
      steps.push(approvalStep('會計收到最後憑據並入帳調整', 'accountant_final', 'pending_voucher', approvalFirstUser('accountant', deps), '會計收回實體憑據，確認多退少補，並以最後正確費用調整入帳；三表以本關最終金額認列。'));
      return normalizeApplicantSelfSteps(steps, appUser, requestType, deps);
    }
    approvalAddRoleStep(steps, 'direct_supervisor', supervisor ? '上一層級主管：' + supervisor.n : '上一層級主管（未設定）', 'pending_section_chief', supervisor, appUser, deps);
    appendDeptManagerStep(steps, appUser, supervisor, deptManager, '申請人部門主任', 'pending_dept_manager', '上一層級主管', deps);
    approvalAddRoleStep(steps, 'admin_director', '行政部門主任', 'pending_admin_director', null, appUser, deps);
    approvalAddRoleStep(steps, 'accountant', '會計', 'pending_accountant', null, appUser, deps);
    approvalAddRoleStep(steps, 'ceo', '執行長檢視會計科目', 'pending_ceo', null, appUser, deps);
    approvalAddRoleStep(steps, 'cashier', '出納放款', 'pending_cashier', approvalCashierUser(deps), appUser, deps);
    steps.push(approvalStep('申請人確認：確認已撥款', 'applicant_confirm', 'pending_applicant_confirm', appUser));
    steps.push(approvalStep('會計確認入帳', 'accountant_final', 'pending_voucher', approvalFirstUser('accountant', deps)));
    return normalizeApplicantSelfSteps(steps, appUser, requestType, deps);
  }

  function workflowBoolValue(value, fallback, deps) {
    var fromDep = callDep(deps || {}, 'workflowConditionBoolValue', value, fallback);
    if (typeof fromDep === 'boolean') return fromDep;
    if (value === true || value === 'true' || value === 1 || value === '1' || value === '是' || value === 'yes') return true;
    if (value === false || value === 'false' || value === 0 || value === '0' || value === '否' || value === 'no') return false;
    return fallback === false ? false : true;
  }

  function workflowAmountValue(ctx, deps) {
    var fromDep = callDep(deps || {}, 'workflowAmountFromContext', ctx || {});
    if (typeof fromDep === 'number' && !Number.isNaN(fromDep)) return fromDep;
    ctx = ctx || {};
    return numValue(ctx.amount || ctx.amt || ctx.total || ctx.estimatedAmount || ctx.estimated_amount || 0, deps);
  }

  function workflowTemplateForBuilder(requestType, deps) {
    var fromDep = callDep(deps || {}, 'workflowTemplateForRequestType', requestType);
    if (fromDep) return fromDep;
    var templates = callDep(deps || {}, 'workflowTemplates') || [];
    var defaults = callDep(deps || {}, 'defaultWorkflowTemplates') || defaultWorkflowTemplates();
    var result = workflowTemplateForRequestType(requestType, templates, defaults);
    return result && result.template ? result.template : null;
  }

  function workflowPickedSteps(template, ctx, deps) {
    var fromDep = callDep(deps || {}, 'workflowTemplateStepsForContext', template, ctx || {});
    if (fromDep && Array.isArray(fromDep.steps)) return fromDep;
    return workflowTemplateStepsForContext(template, ctx || {}, deps || {});
  }

  function workflowAssigneeForKey(key, ctx, step, deps) {
    var fromDep = callDep(deps || {}, 'workflowAssigneeForKey', key, ctx || {}, step || {});
    if (fromDep) return fromDep;
    ctx = ctx || {};
    if (key === 'direct_supervisor') return ctx.supervisor || null;
    if (key === 'dept_manager') return ctx.deptManager || null;
    if (key === 'admin_director') return approvalFirstUser('admin_director', deps);
    if (key === 'accountant' || key === 'accountant_final' || key === 'accountant_invoice') return approvalFirstUser('accountant', deps);
    if (key === 'ceo') return approvalFirstUser('ceo', deps);
    if (key === 'cashier') return approvalCashierUser(deps);
    if (key === 'applicant_confirm' || key === 'applicant_invoice_delivery') return ctx.appUser || null;
    if (key === 'procurement_payment' || key === 'procurement_receipt' || key === 'general_affairs') return approvalFirstUser('general_affairs', deps);
    if (key === 'hr') return approvalFirstUser('hr', deps);
    return approvalFirstUser(key, deps) || approvalScopedUser(key, ctx.appUser, deps);
  }

  function workflowAutoMergedSelfDeptStep(tStep, user, reason, deps) {
    var step = approvalAutoMergedDeptManagerStep(workflowStepLabel(tStep, '申請人部門主任', user), user, 'pending_dept_manager', reason || '申請人本人為部門主任', deps);
    step.autoSkipReason = 'applicant_is_dept_manager';
    step.c = '申請人本身就是本部門主任；為避免自己審自己的單，系統自動跳過本關並送往下一關。';
    step.purpose = '申請人本身就是部門主任。為避免自我簽核，本關保留流程軌跡並自動跳過。';
    return step;
  }

  function buildWorkflowTemplateSteps(appUser, requestType, opts, deps) {
    deps = deps || {};
    opts = opts || {};
    var template = workflowTemplateForBuilder(requestType, deps);
    if (!template) return null;
    var supervisor = approvalDirectSupervisor(appUser, deps);
    var resolvedDepartmentCode = opts.departmentCode || opts.department_code || (appUser && appUser.dc) || '';
    var deptManager = approvalDeptManager(appUser, deps);
    var ctx = {
      appUser: appUser,
      requestType: requestType,
      request_type: requestType,
      departmentCode: resolvedDepartmentCode,
      department_code: resolvedDepartmentCode,
      amount: workflowAmountValue(opts, deps),
      category: opts.category || opts.expense_category || opts.itemCategory || opts.item_category || requestType,
      is_purchase: workflowBoolValue(opts.is_purchase != null ? opts.is_purchase : opts.isPurchase, requestType === 'purchase_request', deps),
      requires_general_affairs: workflowBoolValue(opts.requires_general_affairs != null ? opts.requires_general_affairs : opts.requiresGeneralAffairs, requestType === 'purchase_request', deps),
      requires_accounting_review: workflowBoolValue(opts.requires_accounting_review != null ? opts.requires_accounting_review : opts.requiresAccountingReview, true, deps),
      supervisor: supervisor,
      deptManager: deptManager,
    };
    var picked = workflowPickedSteps(template, ctx, deps);
    var route = picked.route || null;
    var steps = [];
    (picked.steps || []).forEach(function (tStep) {
      var key = workflowStepKey(tStep);
      if (!key || tStep.required === false) return;
      var user = workflowAssigneeForKey(key, ctx, tStep, deps);
      user = canonicalApplicantSelfFallbackUser(key, user, appUser);
      var roleKey = workflowRoleKeyForStep(key, user);
      if (key === 'dept_manager' && appUser && appUser.role === 'dept_manager') {
        steps.push(workflowAutoMergedSelfDeptStep(tStep, appUser, '申請人本人為部門主任', deps));
        return;
      }
      if (key === 'dept_manager' && deptManager && approvalSameUser(supervisor, deptManager, deps)) {
        steps.push(approvalAutoMergedDeptManagerStep(workflowStepLabel(tStep, '申請人部門主任', deptManager), deptManager, 'pending_dept_manager', '申請人主管', deps));
        return;
      }
      if (key === 'dept_manager' && appUser && user && user.id === appUser.id) {
        steps.push(workflowAutoMergedSelfDeptStep(tStep, user, '申請人本人為部門主任', deps));
        return;
      }
      if (roleKey && steps.some(function (step) { return step.rk === roleKey; })) return;
      steps.push({
        r: workflowStepLabel(tStep, tStep.label || approvalRoleLabel(roleKey, deps) || key, user),
        rk: roleKey,
        uid: user && user.id ? user.id : '',
        n: '',
        a: '',
        t: '',
        c: '',
        files: [],
        status: workflowStepStatus(key, { stepFor: deps.stepFor || {} }),
        purpose: workflowStepPurpose(tStep, key),
        workflowTemplateId: template.id,
        workflowTemplateName: template.name,
        workflowRouteId: route ? route.id : 'default',
        workflowRouteName: route ? route.label : '預設路線',
        workflowStepKey: key,
        workflowActorKind: tStep.actorKind || tStep.actor_kind || '',
        workflowActorTarget: tStep.actorTarget || tStep.actor_target || tStep.target || '',
        workflowActorTargetUnitType: tStep.targetUnitType || tStep.target_unit_type || '',
        workflowActorRef: tStep.actorRef || tStep.actor_ref || '',
        workflowAllowCrossEntity: workflowBoolValue(
          tStep.allowCrossEntity !== undefined ? tStep.allowCrossEntity : tStep.allow_cross_entity,
          false,
          deps
        ),
      });
    });
    return steps.length ? normalizeApplicantSelfSteps(steps, appUser, requestType, deps) : null;
  }

  function ensureInvoiceApplicantDeliveryStep(steps, appUser) {
    steps = Array.isArray(steps) ? steps : [];
    if (!appUser || steps.some(function (step) { return step && step.rk === 'applicant_invoice_delivery'; })) return steps;
    var insertAt = steps.findIndex(function (step) { return step && step.rk === 'accountant_invoice'; });
    var step = approvalStep('申請人交付發票確認', 'applicant_invoice_delivery', 'pending_invoice_delivery', appUser, '申請人取得會計開立的發票後，確認已交付給客戶或對方單位。本關保留交付證明，完成後才正式認列收入。', {
      files: [],
      workflowStepKey: 'applicant_invoice_delivery',
    });
    if (insertAt > -1) steps.splice(insertAt + 1, 0, step);
    else steps.push(step);
    return steps;
  }

  function invoicePushStep(steps, appUser, label, role, status, user, purpose, opts) {
    opts = opts || {};
    if (role && steps.some(function (step) { return step.rk === role; })) return;
    steps.push(approvalStep(label, role, status, user, purpose));
  }

  function buildDefaultInvoiceApprovalSteps(appUser, departmentCode, deps) {
    deps = deps || {};
    var steps = [];
    var supervisor = canonicalApplicantSelfFallbackUser('direct_supervisor', approvalDirectSupervisor(appUser, deps), appUser);
    var deptManager = canonicalApplicantSelfFallbackUser('dept_manager', approvalDeptManager(appUser, deps), appUser);
    invoicePushStep(steps, appUser, supervisor ? '申請人主管：' + supervisor.n : '申請人主管（未設定）', 'direct_supervisor', 'pending_section_chief', supervisor, '確認申請內容、開票原因、客戶或開票對象與申請人業務是否相符。');
    if (appUser && appUser.role === 'dept_manager') {
      steps.push(approvalAutoMergedDeptManagerStep('申請人部門主任：' + appUser.n, appUser, 'pending_dept_manager', '申請人本人為部門主任', deps));
    } else if (deptManager && approvalSameUser(appUser, deptManager, deps)) {
      steps.push(approvalAutoMergedDeptManagerStep('申請人部門主任：' + deptManager.n, deptManager, 'pending_dept_manager', '申請人本人為部門主任', deps));
    } else if (deptManager && approvalSameUser(supervisor, deptManager, deps)) {
      steps.push(approvalAutoMergedDeptManagerStep('申請人部門主任：' + deptManager.n, deptManager, 'pending_dept_manager', '申請人主管', deps));
    } else {
      invoicePushStep(steps, appUser, deptManager ? '申請人部門主任：' + deptManager.n : '申請人部門主任（未設定）', 'dept_manager', 'pending_dept_manager', deptManager, '確認申請人所屬部門的收入歸屬、品項內容、專案或跨課室影響。');
    }
    invoicePushStep(steps, appUser, '行政部門主任', 'admin_director', 'pending_admin_director', approvalFirstUser('admin_director', deps), '確認行政流程、附件完整性、開票對象資料是否齊全。');
    invoicePushStep(steps, appUser, '會計', 'accountant', 'pending_accountant', approvalFirstUser('accountant', deps), '確認會計科目、稅務處理與發票資料，必要時要求補件。');
    invoicePushStep(steps, appUser, '執行長', 'ceo', 'pending_ceo', approvalFirstUser('ceo', deps), '最終授權，確認收入認列、公司風險與整體資金配置。');
    invoicePushStep(steps, appUser, '會計開立發票', 'accountant_invoice', 'pending_invoice_accountant', approvalFirstUser('accountant', deps), '會計依核准資料開立發票，並上傳發票檔案或相關憑據；本關通過後系統自動建立收款追蹤。', { allowSelf: true, allowSameUser: true });
    invoicePushStep(steps, appUser, '申請人交付發票確認', 'applicant_invoice_delivery', 'pending_invoice_delivery', appUser, '申請人取得會計開立的發票後，確認已交付給客戶或對方單位。本關保留交付證明，完成後才正式認列收入。', { allowSelf: true, allowSameUser: true });
    return normalizeApplicantSelfSteps(steps, appUser, 'invoice_request', deps);
  }

  function buildDefaultBillApprovalSteps(appUser, deps) {
    deps = deps || {};
    var steps = [];
    var supervisor = canonicalApplicantSelfFallbackUser('direct_supervisor', approvalDirectSupervisor(appUser, deps), appUser);
    var deptManager = canonicalApplicantSelfFallbackUser('dept_manager', approvalDeptManager(appUser, deps), appUser);
    steps.push(approvalStep(supervisor ? '申請人主管：' + supervisor.n : '申請人主管（未設定）', 'direct_supervisor', 'pending_section_chief', supervisor, '確認繳費內容、服務事實與申請人送出的資料是否合理。'));
    if (appUser && appUser.role === 'dept_manager') {
      var selfApplicant = approvalStep('申請人部門主任：' + appUser.n, 'dept_manager', 'pending_dept_manager', appUser, '申請人本身就是部門主任。為避免自我簽核，本關保留流程軌跡並自動跳過。');
      selfApplicant.a = 'approved';
      selfApplicant.n = '系統自動跳關';
      selfApplicant.autoSkip = true;
      selfApplicant.autoSkipReason = 'applicant_is_dept_manager';
      selfApplicant.c = '申請人本身就是本部門主任；為避免自己審自己的單，系統自動跳過本關並送往下一關。';
      steps.push(selfApplicant);
    } else if (deptManager && approvalSameUser(appUser, deptManager, deps)) {
      var selfDept = approvalStep('申請人部門主任：' + deptManager.n, 'dept_manager', 'pending_dept_manager', deptManager, '申請人本身就是部門主任。為避免自我簽核，本關保留流程軌跡並自動跳過。');
      selfDept.a = 'approved';
      selfDept.n = '系統自動跳關';
      selfDept.autoSkip = true;
      selfDept.autoSkipReason = 'applicant_is_dept_manager';
      selfDept.c = '申請人本身就是本部門主任；為避免自己審自己的單，系統自動跳過本關並送往下一關。';
      steps.push(selfDept);
    } else {
      steps.push(approvalStep(deptManager ? '申請人部門主任：' + deptManager.n : '申請人部門主任（未設定）', 'dept_manager', 'pending_dept_manager', deptManager, '確認申請人所屬部門的收入歸屬、費用期間、繳費項目與金額是否正確。'));
    }
    steps.push(approvalStep('行政部門主任', 'admin_director', 'pending_admin_director', approvalFirstUser('admin_director', deps), '確認行政流程、繳費人資料與應收內容是否完整。'));
    steps.push(approvalStep('會計', 'accountant', 'pending_accountant', approvalFirstUser('accountant', deps), '確認應收金額、會計追蹤與後續收款管理是否正確。'));
    steps.push(approvalStep('申請人確認繳費單可提供繳費人', 'applicant_confirm', 'pending_applicant_confirm', appUser, '最後回到申請人確認繳費單內容可正式提供繳費人。'));
    return normalizeApplicantSelfSteps(steps, appUser, 'bill_request', deps);
  }

  var api = {
    rowsFrom: rowsFrom,
    anyRow: anyRow,
    returnLogsFromStep: returnLogsFromStep,
    stepWasReopenedByReturn: stepWasReopenedByReturn,
    returnState: returnState,
    stepDisplayComment: stepDisplayComment,
    timelineRows: timelineRows,
    timelineProgressText: timelineProgressText,
    approvalReturnCardHtml: approvalReturnCardHtml,
    approvalTimelineRowHtml: approvalTimelineRowHtml,
    approvalTimelineHtml: approvalTimelineHtml,
    approverSelectHtml: approverSelectHtml,
    approvalActionFieldsHtml: approvalActionFieldsHtml,
    defaultWorkflowTemplates: defaultWorkflowTemplates,
    buildWorkflowTemplateSteps: buildWorkflowTemplateSteps,
    buildDefaultApprovalSteps: buildDefaultApprovalSteps,
    ensureInvoiceApplicantDeliveryStep: ensureInvoiceApplicantDeliveryStep,
    buildDefaultInvoiceApprovalSteps: buildDefaultInvoiceApprovalSteps,
    buildDefaultBillApprovalSteps: buildDefaultBillApprovalSteps,
    normalizeWorkflowTemplates: normalizeWorkflowTemplates,
    workflowStepKey: workflowStepKey,
    workflowStepLabel: workflowStepLabel,
    workflowStepPurpose: workflowStepPurpose,
    workflowStepStatus: workflowStepStatus,
    workflowAssigneeForKey: workflowAssigneeForKey,
    workflowRoleKeyForStep: workflowRoleKeyForStep,
    workflowKeepsDistinctRoleStep: workflowKeepsDistinctRoleStep,
    approvalRouteInvariantErrors: approvalRouteInvariantErrors,
    approvalStepAutoClosed: approvalStepAutoClosed,
    normalizeRequestSemanticSteps: normalizeRequestSemanticSteps,
    normalizeCeoCashierOrder: normalizeCeoCashierOrder,
    requestRequiresCashierStep: requestRequiresCashierStep,
    ensureRequestCashierStep: ensureRequestCashierStep,
    applicantSelfPendingAllowed: applicantSelfPendingAllowed,
    normalizeApplicantSelfStep: normalizeApplicantSelfStep,
    normalizeApplicantSelfSteps: normalizeApplicantSelfSteps,
    clearCanonicalApplicantSelfAutoSkip: clearCanonicalApplicantSelfAutoSkip,
    applicantSelfAuditError: applicantSelfAuditError,
    approvalStepAllowsApplicantSelf: approvalStepAllowsApplicantSelf,
    approvalRuntimeStepErrors: approvalRuntimeStepErrors,
    approvalRuntimeActorKindForStep: approvalRuntimeActorKindForStep,
    approvalRuntimeRoleKeyForStep: approvalRuntimeRoleKeyForStep,
    approvalRuntimeCandidateId: approvalRuntimeCandidateId,
    approvalRuntimeOriginalCandidateId: approvalRuntimeOriginalCandidateId,
    approvalRuntimeTopLevelSelfCandidate: approvalRuntimeTopLevelSelfCandidate,
    approvalRuntimeStepLabel: approvalRuntimeStepLabel,
    approvalRuntimeShouldResolveStep: approvalRuntimeShouldResolveStep,
    approvalRuntimeSourceTableForRecord: approvalRuntimeSourceTableForRecord,
    approvalRuntimeRequestType: approvalRuntimeRequestType,
    approvalRuntimeFormSnapshot: approvalRuntimeFormSnapshot,
    approvalRuntimeLegacyOnlyResult: approvalRuntimeLegacyOnlyResult,
    syncApprovalRuntimeFromSteps: syncApprovalRuntimeFromSteps,
    requireApprovalRuntimeForSubmittedRecord: requireApprovalRuntimeForSubmittedRecord,
    rollbackSubmittedRowsAfterRuntimeFailure: rollbackSubmittedRowsAfterRuntimeFailure,
    approvalRuntimeRequiredErrorMessage: approvalRuntimeRequiredErrorMessage,
    approvalRuntimeRollbackNotice: approvalRuntimeRollbackNotice,
    approvalRuntimeGroupSource: approvalRuntimeGroupSource,
    approvalRuntimeLogSafeId: approvalRuntimeLogSafeId,
    approvalRuntimeLogSlotId: approvalRuntimeLogSlotId,
    approvalRuntimeLogSource: approvalRuntimeLogSource,
    approvalRuntimeLogsSlotHtml: approvalRuntimeLogsSlotHtml,
    approvalRuntimeLogActorName: approvalRuntimeLogActorName,
    approvalRuntimeLogEventLabel: approvalRuntimeLogEventLabel,
    approvalRuntimeLogTime: approvalRuntimeLogTime,
    approvalRuntimeLogComment: approvalRuntimeLogComment,
    approvalRuntimeLogsHtml: approvalRuntimeLogsHtml,
    loadApprovalRuntimeLogsForRecord: loadApprovalRuntimeLogsForRecord,
    approvalRuntimeTaskMatchesRecord: approvalRuntimeTaskMatchesRecord,
    findApprovalRuntimePendingTask: findApprovalRuntimePendingTask,
    approvalRuntimeActionMeta: approvalRuntimeActionMeta,
    syncApprovalRuntimeAction: syncApprovalRuntimeAction,
    syncApprovalRuntimeApproveAction: syncApprovalRuntimeApproveAction,
    workflowCleanStep: workflowCleanStep,
    workflowCleanConditionalRoute: workflowCleanConditionalRoute,
    workflowCleanTemplate: workflowCleanTemplate,
    workflowSelectRoute: workflowSelectRoute,
    workflowTemplateStepsForContext: workflowTemplateStepsForContext,
    workflowTemplateForRequestType: workflowTemplateForRequestType,
    validateWorkflowTemplateConfig: validateWorkflowTemplateConfig,
    workflowTemplateConfigHealthRecords: workflowTemplateConfigHealthRecords,
    workflowBlockingValidationRows: workflowBlockingValidationRows,
    invoiceGroupApprovalRows: function (item, deps) {
      deps = deps || {};
      return rowsFrom(item, deps.invoiceGroupRows);
    },
    invoiceApprovalGroupCanAct: function (item, deps) {
      deps = deps || {};
      return anyRow(item, deps.invoiceGroupRows, deps.canActInvoice);
    },
    invoiceApprovalRowIsOpen: invoiceApprovalRowIsOpen,
    invoiceActiveApprovalStepKey: invoiceActiveApprovalStepKey,
    invoiceBatchActionRows: invoiceBatchActionRows,
    invoiceReceiptGroupCanAct: function (item, deps) {
      deps = deps || {};
      return anyRow(item, deps.invoiceGroupRows, deps.canActReceipt);
    },
    invoiceGroupIsMine: function (item, deps) {
      deps = deps || {};
      return anyRow(item, deps.invoiceGroupRows, deps.invoiceIsMine);
    },
    invoiceGroupRejectedByCurrentUser: function (item, deps) {
      deps = deps || {};
      return anyRow(item, deps.invoiceGroupRows, function (row) {
        return ((row && row.steps) || []).some(deps.stepRejectedByCurrentUser);
      });
    },
    groupHasUserStepAction: hasUserStepAction,
  };

  global.FinanceV4Engines.register('approvals', api);
  global.FinanceApprovalEngine = api;
})(window);
