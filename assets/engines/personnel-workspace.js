(function (global) {
  'use strict';
  var options = null, host = null, scopeIdentity = '', drawer = null, actionDialog = null, returnFocus = null, selectedId = '';
  var state = { query: '', company: '', role: '', tab: 'all', page: 1, toolsOpen: false };
  var PAGE_SIZE = 20, identityObserver = null;
  var roleClasses = { employee: 'basic', section_chief: 'blue', dept_manager: 'purple', admin_director: 'amber', general_affairs: 'teal', hr: 'blue', accountant: 'green', cashier: 'amber', ceo: 'amber', external_audit: 'basic', board: 'purple', shareholder: 'blue' };
  var scopeLabels = { self: '本人範圍', class: '課級範圍', department: '部門範圍', business_unit: '部門範圍', entity: '公司範圍', company: '公司範圍', tenant: '集團範圍', all: '全部授權範圍' };
  function h(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function node(value) { return typeof value === 'string' ? global.document.getElementById(value) : value; }
  function identity() { return options && options.getIdentity ? String(options.getIdentity()) : ''; }
  function current() { return !!(options && host && host.isConnected && identity() === scopeIdentity && !(options.isBlocked && options.isBlocked())); }
  function canManage() { return current() && !!(options.canManage && options.canManage()); }
  function users() { return current() && options.getUsers ? options.getUsers().slice() : []; }
  function findUser(id) { return users().find(function (u) { return String(u.id) === String(id); }); }
  function system(u) { return u.orgStatus === 'system_account'; }
  function active(u) { return u.active !== false; }
  function company(u) { return options.entity ? options.entity(u) || {} : {}; }
  function department(u) { return options.department ? options.department(u.dc) || {} : {}; }
  function roleLabel(u) { return options.roleLabel ? options.roleLabel(u) : u.rL || u.role || '未指定'; }
  function roleScope(u) { var s = options.scope ? options.scope(u) : 'self'; return scopeLabels[s] || (s ? String(s) + ' 範圍' : '本人範圍'); }
  function companyKey(u) { var c = company(u); return String(c.id || u.eid || c.code || c.full || c.s || ''); }
  function login(u) {
    var health = options.health ? options.health(u) || {} : { status: 'unknown' };
    var view = options.presentation ? options.presentation(health) : { label: '登入狀態待確認', detail: '請檢查登入狀態。', cls: 'b-gray' };
    var valid = !options.validLoginEmail || options.validLoginEmail(u.email);
    if (!valid) return { status: 'invalid', label: '非公司登入帳號', detail: '請確認這個帳號應使用的公司 Google 主帳號。', tone: 'red', health: health };
    var labels = { bound: 'Google 已綁定', waiting_first_login: system(u) ? '待指定帳號首次登入' : '待首次登入', pending_rebind: '待新帳號驗證', conflict: 'Google 帳號衝突', failed: '登入檢查失敗', unknown: '登入狀態待確認' };
    var tone = { bound: 'green', waiting_first_login: 'amber', pending_rebind: 'purple', conflict: 'red', failed: 'red' }[health.status] || 'basic';
    var detail = view.detail || '';
    if (system(u) && health.status === 'waiting_first_login') detail = '由帳號管理人使用指定的公司 Google 帳號登入驗證；這是系統帳號，並非具名員工。';
    return { status: health.status || 'unknown', label: labels[health.status] || view.label || '登入狀態待確認', detail: detail, tone: tone, health: health };
  }
  function needsAttention(u) { return active(u) && login(u).status !== 'bound'; }
  function badge(text, tone) { return '<span class="fpw-badge fpw-' + h(tone || 'basic') + '">' + h(text) + '</span>'; }
  function button(text, action, id, cls, extra) { return '<button type="button" tabindex="0" class="fpw-button ' + (cls || '') + '" data-fpw-action="' + action + '"' + (id == null ? '' : ' data-fpw-id="' + h(id) + '"') + (extra || '') + '>' + h(text) + '</button>'; }
  function displayCounts(data) { var humans = data.filter(function (u) { return !system(u); }).length; return humans + ' 位人員 · ' + (data.length - humans) + ' 個系統帳號'; }
  function filterData(all) {
    var query = state.query.trim().toLocaleLowerCase('zh-TW');
    return all.filter(function (u) {
      var c = company(u), d = department(u);
      if (state.tab === 'attention' && !needsAttention(u) || state.tab === 'system' && !system(u) || state.tab === 'inactive' && active(u)) return false;
      if (state.company && companyKey(u) !== state.company || state.role && u.role !== state.role) return false;
      return !query || [u.n, u.email, u.contactEmail, u.jobTitle, u.extension, roleLabel(u), roleScope(u), u.dc, d.n, c.s, c.full].join(' ').toLocaleLowerCase('zh-TW').indexOf(query) > -1;
    });
  }
  function personHtml(u, plain) {
    var different = String(u.contactEmail || u.email || '').toLowerCase() !== String(u.email || '').toLowerCase();
    return '<div class="fpw-person"><span class="fpw-avatar' + (system(u) ? ' fpw-avatar-system' : '') + '" aria-hidden="true">' + h(u.init || String(u.n || '?').slice(0, 1)) + '</span><div class="fpw-person-body">'
      + (plain ? '<strong class="fpw-name">' + h(u.n || '未命名') + '</strong>' : button(u.n || '未命名', 'view', u.id, 'fpw-name', ' aria-label="查看' + h(u.n || '此帳號') + '完整資料"'))
      + (system(u) ? '<span class="fpw-mini">系統帳號</span>' : '') + (different ? '<span class="fpw-mini fpw-contact-different">聯絡信箱不同</span>' : '')
      + '<div class="fpw-job">' + h(u.jobTitle || u.rL || roleLabel(u)) + '</div><div class="fpw-email" title="' + h(u.email || '') + '">' + h(u.email || '未設定登入信箱') + '</div></div></div>';
  }
  function companyHtml(u) { var d = department(u), c = company(u); return '<div class="fpw-department">' + h(d.n || '未指定部門') + '</div><div class="fpw-company"><span class="fpw-code">' + h(u.dc || '未填代碼') + '</span><span title="' + h(c.full || c.s || '') + '">' + h(c.s || c.full || '未指定公司') + '</span></div>'; }
  function roleHtml(u) { return badge(roleLabel(u), roleClasses[u.role] || 'basic') + '<div class="fpw-scope">' + h(roleScope(u)) + '</div>'; }
  function statusHtml(u) {
    var v = login(u);
    return '<div class="fpw-active">' + (active(u) ? '帳號啟用' : '帳號停用') + '</div>' + badge(v.label, v.tone)
      + (!active(u) ? '<div class="fpw-status-hint">停用狀態不因綁定而解除</div>' : v.status === 'pending_rebind' ? '<div class="fpw-status-hint">驗證前舊帳號仍可登入</div>' : v.status === 'waiting_first_login' ? '<div class="fpw-status-hint">需指定帳號登入一次</div>' : '');
  }
  function actionsHtml(u) { return canManage() ? '<div class="fpw-actions">' + button('編輯', 'edit', u.id, '', ' aria-label="編輯' + h(u.n || '此帳號') + '"') + button('⋯', 'more', u.id, 'fpw-more', ' aria-label="' + h(u.n || '此帳號') + '的更多操作" aria-haspopup="dialog"') + '</div>' : '<span class="fpw-readonly">唯讀 · 點姓名看明細</span>'; }
  function tabsHtml(all) {
    var tabs = [ ['all', '全部帳號', all.length], ['attention', '待處理登入', all.filter(needsAttention).length], ['system', '系統帳號', all.filter(system).length], ['inactive', '已停用', all.filter(function (u) { return !active(u); }).length] ];
    return '<div class="fpw-tabs" aria-label="帳號狀態篩選">' + tabs.map(function (t) { return button(t[1], 'tab', t[0], 'fpw-tab' + (state.tab === t[0] ? ' is-selected' : ''), ' aria-pressed="' + (state.tab === t[0]) + '"').replace('</button>', '<span class="fpw-tab-count">' + t[2] + '</span></button>'); }).join('') + '</div>';
  }
  function filterOptions(all, key, label) {
    var seen = Object.create(null), list = [];
    all.forEach(function (u) { var id = key(u); if (id && !seen[id]) { seen[id] = true; list.push({ id: id, label: label(u) }); } });
    list.sort(function (a, b) { return a.label.localeCompare(b.label, 'zh-TW'); });
    return list;
  }
  function toolbarHtml(all) {
    var companies = filterOptions(all, companyKey, function (u) { var c = company(u); return c.s || c.full || '未指定公司'; });
    var roles = filterOptions(all, function (u) { return u.role; }, roleLabel);
    function choices(items, selected) { return items.map(function (item) { return '<option value="' + h(item.id) + '"' + (selected === item.id ? ' selected' : '') + '>' + h(item.label) + '</option>'; }).join(''); }
    return '<div class="fpw-toolbar"><div class="fpw-search"><label class="fpw-visually-hidden" for="fpw-search">搜尋姓名、部門或登入信箱</label><input id="fpw-search" type="search" placeholder="搜尋姓名、部門或登入信箱" autocomplete="off" value="' + h(state.query) + '">' + button('×', 'clear-search', null, 'fpw-search-clear', ' aria-label="清除搜尋"' + (state.query ? '' : ' hidden')) + '</div>'
      + '<label class="fpw-filter"><span>公司</span><select data-fpw-filter="company" data-fpw-native-filter="true" data-no-search="1"><option value="">全部公司</option>' + choices(companies, state.company) + '</select></label>'
      + '<label class="fpw-filter"><span>系統權限</span><select data-fpw-filter="role" data-fpw-native-filter="true" data-no-search="1"><option value="">全部權限</option>' + choices(roles, state.role) + '</select></label><span class="fpw-count" data-fpw-count aria-live="polite"></span></div>';
  }
  function tableHtml(page) {
    return '<div class="fpw-desktop"><table class="fpw-table" aria-label="人員與帳號列表"><colgroup><col style="width:30%"><col style="width:24%"><col style="width:15%"><col style="width:19%"><col style="width:12%"></colgroup><thead><tr><th scope="col">人員 / 職稱</th><th scope="col">公司 / 部門</th><th scope="col">系統權限</th><th scope="col">帳號狀態</th><th scope="col">操作</th></tr></thead><tbody>'
      + page.map(function (u) { return '<tr class="' + (needsAttention(u) ? 'fpw-row-attention ' : '') + (system(u) ? 'fpw-row-system' : '') + '"><td>' + personHtml(u) + '</td><td>' + companyHtml(u) + '</td><td>' + roleHtml(u) + '</td><td>' + statusHtml(u) + '</td><td>' + actionsHtml(u) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function cardsHtml(page) { return '<div class="fpw-mobile">' + page.map(function (u) { return '<article class="fpw-card' + (needsAttention(u) ? ' fpw-row-attention' : '') + '" aria-label="' + h(u.n || '未命名帳號') + '"><div class="fpw-card-head">' + personHtml(u) + roleHtml(u) + '</div><div class="fpw-card-department">' + companyHtml(u) + '</div><div class="fpw-card-bottom"><div>' + statusHtml(u) + '</div>' + actionsHtml(u) + '</div></article>'; }).join('') + '</div>'; }
  function paintList() {
    if (!current()) { suspend(); return; }
    var all = users(), data = filterData(all), pages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    state.page = Math.max(1, Math.min(state.page, pages));
    var start = (state.page - 1) * PAGE_SIZE, page = data.slice(start, start + PAGE_SIZE), list = host.querySelector('[data-fpw-list]');
    list.innerHTML = data.length ? tableHtml(page) + cardsHtml(page) : '<div class="fpw-empty"><strong>' + (all.length ? '找不到符合的人員或帳號' : '目前沒有可查看的人員資料') + '</strong><p>' + (all.length ? '試試其他姓名、信箱，或清除篩選條件。' : '請確認資料已載入，或重新整理頁面。') + '</p>' + (all.length ? button('清除所有條件', 'reset') : '') + '</div>';
    host.querySelector('[data-fpw-count]').textContent = displayCounts(data);
    host.querySelector('[data-fpw-footer]').innerHTML = '<span>' + (data.length ? '顯示第 ' + (start + 1) + '–' + (start + page.length) + ' 筆，共 ' + data.length + ' 個帳號' : '共 0 個帳號') + '</span><div class="fpw-paging"><span>每頁 20 筆</span>' + button('‹', 'previous', null, '', ' aria-label="上一頁"' + (state.page <= 1 ? ' disabled' : '')) + '<span aria-label="目前第 ' + state.page + ' 頁">' + state.page + ' / ' + pages + '</span>' + button('›', 'next', null, '', ' aria-label="下一頁"' + (state.page >= pages ? ' disabled' : '')) + '</div>';
    if (drawer && selectedId) { var selected = findUser(selectedId); if (selected) paintDrawer(selected); else closeOverlays(); }
  }
  function closeNode(d) { if (d) { if (d.open) d.close(); d.remove(); } }
  function closeOverlays(restore) { closeNode(drawer); closeNode(actionDialog); drawer = null; actionDialog = null; selectedId = ''; if (restore !== false && current() && returnFocus && returnFocus.isConnected) returnFocus.focus(); returnFocus = null; }
  function makeDialog(kind, title) {
    var d = global.document.createElement('dialog');
    d.className = 'fpw-dialog fpw-' + kind;
    d.setAttribute('data-finance-approval-dialog', 'personnel-' + kind);
    d.setAttribute('aria-labelledby', 'fpw-' + kind + '-title');
    d.setAttribute('data-fpw-identity', scopeIdentity);
    d.innerHTML = '<header class="fpw-dialog-head"><h2 id="fpw-' + kind + '-title">' + h(title) + '</h2>' + button('×', 'close', null, 'fpw-close', ' aria-label="關閉' + h(title) + '"') + '</header><div class="fpw-dialog-body" data-fpw-dialog-body></div>';
    d.addEventListener('click', handleClick);
    d.addEventListener('cancel', function (e) { e.preventDefault(); closeOverlays(); });
    d.addEventListener('close', function () { if (!d.open && d.isConnected) { if (d === drawer) drawer = null; if (d === actionDialog) actionDialog = null; d.remove(); if (current() && returnFocus && returnFocus.isConnected) returnFocus.focus(); } });
    d.addEventListener('click', function (e) { if (e.target !== d) return; var r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeOverlays(); });
    global.document.body.appendChild(d); return d;
  }
  function detailField(label, value, note) { return '<dt>' + h(label) + '</dt><dd>' + h(value || '未設定') + (note ? '<span class="fpw-field-note">' + h(note) + '</span>' : '') + '</dd>'; }
  function paintDrawer(u) {
    if (!drawer || !current()) return;
    var c = company(u), d = department(u), v = login(u), different = String(u.contactEmail || u.email || '').toLowerCase() !== String(u.email || '').toLowerCase();
    var supervisor = options.supervisor ? options.supervisor(u) : null;
    drawer.querySelector('[data-fpw-dialog-body]').innerHTML = '<div class="fpw-detail-person">' + personHtml(u, true) + '</div><div class="fpw-detail-status">' + statusHtml(u) + '</div>'
      + '<section class="fpw-detail-section"><h3>登入與聯絡資訊</h3><dl>' + detailField('公司登入信箱', u.email, '用於登入身分識別。') + detailField('組織聯絡信箱', u.contactEmail || u.email, '供工作聯繫，不會自動改變登入帳號。') + detailField('分機', u.extension) + '</dl>'
      + (different ? '<p class="fpw-note">登入與聯絡信箱不同，兩者分開管理。</p>' : '') + '<p class="fpw-note">' + h(v.detail) + '</p>' + (!active(u) ? '<p class="fpw-note">此帳號已停用；Google 綁定資訊保留作為歷史，不代表可以繼續使用 Finance。</p>' : '') + '</section>'
      + '<section class="fpw-detail-section"><h3>公司、部門與系統權限</h3><dl>' + detailField('完整法人名稱', c.full || c.s) + detailField('所屬部門', [u.dc, d.n].filter(Boolean).join(' ')) + detailField('系統權限', roleLabel(u)) + detailField('權限範圍', roleScope(u)) + (supervisor ? detailField('直屬主管', supervisor.n || supervisor.name || supervisor) : '') + detailField('資料來源', system(u) ? '系統帳號' : /pptx/i.test(u.orgSource || '') ? '簡報匯入' : u.orgSource || '人員資料') + '</dl></section>'
      + (canManage() ? '<section class="fpw-detail-section"><h3>其他操作</h3><div class="fpw-detail-actions">' + button('檢查登入', 'check-login', u.id) + button(active(u) ? '離職交接' : '啟用帳號', 'toggle', u.id, active(u) ? 'fpw-danger' : '', system(u) && active(u) ? ' disabled aria-describedby="fpw-system-note"' : '') + '</div>' + (system(u) ? '<p id="fpw-system-note" class="fpw-field-note">系統帳號由管理員依用途處理，不套用一般人員離職交接。</p>' : '') + (u.role === 'ceo' ? '<p class="fpw-field-note">執行長請使用專用交接程序，以保留最高管理權限。</p>' : '') + '</section>' : '<p class="fpw-note">此帳號資料為唯讀，編輯與交接須由有權限的管理者操作。</p>')
      + '<footer class="fpw-dialog-foot">' + button('關閉', 'close') + (canManage() ? button('編輯資料', 'edit', u.id, 'fpw-primary') : '') + '</footer>';
  }
  function openDetails(id, trigger) {
    var u = findUser(id); if (!u) return;
    closeOverlays(false); returnFocus = trigger || global.document.activeElement; selectedId = String(id);
    drawer = makeDialog('drawer', system(u) ? '系統帳號明細' : '人員明細'); paintDrawer(u); drawer.showModal(); drawer.querySelector('[data-fpw-action="close"]').focus();
  }
  function openMore(id, trigger) {
    var u = findUser(id); if (!u || !canManage()) return;
    closeOverlays(false); returnFocus = trigger || global.document.activeElement; selectedId = String(id);
    actionDialog = makeDialog('menu', (u.n || '此帳號') + ' · 更多操作');
    actionDialog.querySelector('[data-fpw-dialog-body]').innerHTML = button('查看完整資料', 'view', u.id) + button('檢查登入', 'check-login', u.id) + '<hr>'
      + button(active(u) ? '離職交接' : '啟用帳號', 'toggle', u.id, active(u) ? 'fpw-danger' : '', active(u) && system(u) ? ' disabled aria-describedby="fpw-menu-system-note"' : '')
      + button('刪除帳號', 'delete', u.id, 'fpw-danger', active(u) ? ' disabled aria-describedby="fpw-delete-note"' : '')
      + (active(u) ? '<p id="fpw-delete-note" class="fpw-field-note">啟用中的帳號請先完成離職交接，不能直接刪除。</p>' : '<p class="fpw-field-note">已有組織或簽核歷史的帳號須保留紀錄，系統會再次檢查。</p>')
      + (system(u) ? '<p id="fpw-menu-system-note" class="fpw-field-note">系統帳號不套用一般人員離職交接。</p>' : '') + (u.role === 'ceo' ? '<p class="fpw-field-note">執行長請改走專用交接程序。</p>' : '');
    actionDialog.showModal(); actionDialog.querySelector('[data-fpw-action="view"]').focus();
  }
  function callAction(action, id) {
    if (!canManage()) return;
    var u = findUser(id); if (!u) return;
    if (action === 'toggle' && active(u) && system(u) || action === 'delete' && active(u)) return;
    var handlers = { edit: options.onEdit, 'check-login': options.onCheckLogin, toggle: options.onToggle, delete: options.onDelete };
    var handler = handlers[action]; if (typeof handler !== 'function') return;
    closeOverlays(); handler(String(u.id));
  }
  function handleClick(event) {
    var b = event.target.closest && event.target.closest('[data-fpw-action]'); if (!b || b.disabled) return;
    if (!current()) { suspend(); return; }
    var action = b.getAttribute('data-fpw-action'), id = b.getAttribute('data-fpw-id');
    if (action === 'view') { openDetails(id, returnFocus || b); return; }
    if (action === 'more') { openMore(id, b); return; }
    if (action === 'close') { closeOverlays(); return; }
    if (action === 'tab') { state.tab = id; state.page = 1; repaint(true, b); return; }
    if (action === 'previous' || action === 'next') { state.page += action === 'next' ? 1 : -1; paintList(); var next = host.querySelector('[data-fpw-action="' + action + '"]'); if (next && !next.disabled) next.focus(); else host.querySelector('[data-fpw-footer]').focus(); return; }
    if (action === 'clear-search') { state.query = ''; state.page = 1; var search = host.querySelector('#fpw-search'); search.value = ''; b.hidden = true; paintList(); search.focus(); return; }
    if (action === 'reset') { state.query = ''; state.company = ''; state.role = ''; state.tab = 'all'; state.page = 1; repaint(); host.querySelector('#fpw-search').focus(); return; }
    if (action === 'tool' || action === 'add') { if (!canManage()) return; var tool = (options.tools || []).find(function (t) { return String(t.id) === id; }); if (action === 'add' && options.onAdd) options.onAdd(); else if (tool && typeof tool.run === 'function') tool.run(); return; }
    callAction(action, id);
  }
  function repaint(focusTab) {
    if (!current()) { suspend(); return; }
    host.classList.add('fpw');
    var all = users();
    // A role/company removed by a concurrent directory update must not leave a
    // hidden filter selected while the visible control says "all".
    if (state.company && !all.some(function (u) { return companyKey(u) === state.company; })) state.company = '';
    if (state.role && !all.some(function (u) { return u.role === state.role; })) state.role = '';
    host.innerHTML = tabsHtml(all) + toolbarHtml(all) + '<div data-fpw-list></div><footer class="fpw-footer" data-fpw-footer tabindex="-1"></footer><p class="fpw-guidance">新人接替職務：先新增人員，再為原人員辦理離職交接，保留過往單據與簽核歷史。</p>';
    host.onclick = handleClick;
    host.oninput = function (e) { if (e.target.id !== 'fpw-search' || !current()) return; state.query = e.target.value; state.page = 1; host.querySelector('[data-fpw-action="clear-search"]').hidden = !state.query; paintList(); };
    host.onchange = function (e) { var key = e.target.getAttribute('data-fpw-filter'); if (!key || !current()) return; state[key] = e.target.value; state.page = 1; paintList(); };
    paintList();
    if (focusTab) host.querySelector('[data-fpw-action="tab"][data-fpw-id="' + state.tab + '"]').focus();
    renderTools();
  }
  function renderTools() {
    var toolHost = options && node(options.toolHost); if (!toolHost) return;
    toolHost.classList.add('fpw-tool-host');
    if (!canManage()) { toolHost.replaceChildren(); return; }
    var existing = toolHost.querySelector('details'); if (existing) state.toolsOpen = existing.open;
    toolHost.innerHTML = '<div class="fpw-top-actions"><details class="fpw-tools"' + (state.toolsOpen ? ' open' : '') + '><summary>管理工具</summary><div class="fpw-tool-buttons">' + (options.tools || []).map(function (t) { return button(t.label, 'tool', t.id); }).join('') + '</div></details>' + (options.onAdd ? button('＋ 新增人員', 'add', null, 'fpw-primary') : '') + '</div>';
    toolHost.onclick = handleClick;
    toolHost.querySelector('details').addEventListener('toggle', function (e) { state.toolsOpen = e.target.open; });
  }
  function render(config) {
    if (!config || !config.getIdentity || !config.getUsers || !config.canManage) throw new Error('Personnel workspace requires current identity, authorized users and permission callbacks.');
    var target = node(config.host || 'user-wrap'), previous = scopeIdentity;
    options = config; host = target; scopeIdentity = identity();
    installIdentityObserver();
    if (!host) return false;
    if (previous && previous !== scopeIdentity || config.isBlocked && config.isBlocked()) {
      closeOverlays(false); state = { query: '', company: '', role: '', tab: 'all', page: 1, toolsOpen: false };
    }
    if (!current()) { suspend(); return false; }
    var search = host.querySelector('#fpw-search'), focused = search && global.document.activeElement === search, position = search ? search.selectionStart : null;
    repaint();
    if (focused) { search = host.querySelector('#fpw-search'); search.focus(); try { search.setSelectionRange(position, position); } catch (e) {} }
    return true;
  }
  function suspend() {
    closeOverlays(false);
    if (host) host.replaceChildren();
    var toolHost = options && node(options.toolHost); if (toolHost) toolHost.replaceChildren();
    state = { query: '', company: '', role: '', tab: 'all', page: 1, toolsOpen: false }; scopeIdentity = ''; options = null;
  }
  function installIdentityObserver() {
    if (identityObserver || !global.MutationObserver || !global.document.body) return;
    identityObserver = new global.MutationObserver(function () { if (options && (global.document.body.getAttribute('data-finance-identity-blocked') === 'true' || identity() !== scopeIdentity)) suspend(); });
    identityObserver.observe(global.document.body, { attributes: true, attributeFilter: ['data-finance-identity-blocked'] });
  }
  installIdentityObserver();
  if (!global.document.body) global.document.addEventListener('DOMContentLoaded', installIdentityObserver, { once: true });
  global.FinancePersonnelWorkspace = Object.freeze({ render: render, suspend: suspend, invalidate: suspend, openDetails: openDetails, snapshot: function () { return { query: state.query, company: state.company, role: state.role, tab: state.tab, page: state.page, pageSize: PAGE_SIZE }; } });
})(window);
