(function (global) {
  'use strict';
  var MAX_BYTES = 50 * 1024 * 1024;
  var sectionState = {}, previewDialog = null, previewUrl = '', previewOwner = null, previewGeneration = 0;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function sizeLabel(size) {
    if (size == null || !Number.isFinite(Number(size))) return '大小未提供';
    size = Number(size);
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function selectFiles(files, validate) {
    var accepted = [], rejected = [];
    Array.from(files || []).forEach(function (file) {
      try {
        if (Number(file.size) > MAX_BYTES) throw new Error('超過 50MB，請壓縮或拆成多個檔案後再選取。');
        if (validate) validate(file);
        accepted.push(file);
      } catch (error) { rejected.push({name:file.name || file.n || '附件', message:String(error.message || error)}); }
    });
    return {accepted:accepted, rejected:rejected};
  }
  function localBlob(file) {
    if (typeof Blob !== 'undefined' && file instanceof Blob) return file;
    var url = String(file && file.url || '');
    // Never fetch a remote, storage or arbitrary blob URL to preview a file.
    var match = /^data:([a-z0-9.+\/-]+)(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(url);
    if (!match || !/^(?:image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(match[1])) return null;
    try {
      var raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
      if (raw.length > MAX_BYTES) return null;
      return new Blob([Uint8Array.from(raw, function (c) { return c.charCodeAt(0); })], {type:match[1].toLowerCase()});
    } catch (_) { return null; }
  }
  async function safePreviewBlob(file) {
    var blob = localBlob(file);
    if (!blob || blob.size > MAX_BYTES) return null;
    var bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    var start = Array.from(bytes).map(function (v) { return String.fromCharCode(v); }).join('');
    var type = String(blob.type || '').toLowerCase();
    var safe = type === 'application/pdf' && start.indexOf('%PDF-') === 0
      || type === 'image/png' && [137,80,78,71,13,10,26,10].every(function (v,i) { return bytes[i] === v; })
      || type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      || type === 'image/gif' && /^GIF8[79]a/.test(start)
      || type === 'image/webp' && start.slice(0,4) === 'RIFF' && start.slice(8,12) === 'WEBP';
    return safe ? blob : null;
  }
  function nodeVisible(node) {
    if(!node || !node.isConnected)return false;
    if(typeof node.checkVisibility==='function')return node.checkVisibility();
    return !!node.getClientRects().length && global.getComputedStyle(node).visibility!=='hidden';
  }
  function closePreview() {
    previewGeneration++;
    if (previewDialog) { previewDialog.close(); previewDialog.remove(); previewDialog = null; }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
    if (previewOwner && previewOwner.isConnected) previewOwner.focus();
    previewOwner = null;
  }
  async function preview(file, opener) {
    closePreview();
    var generation = previewGeneration;
    var blob = await safePreviewBlob(file);
    if (generation !== previewGeneration || !opener || !opener.isConnected || !nodeVisible(opener) || document.body.dataset.financeIdentityBlocked === 'true') return;
    previewOwner = opener;
    var d = document.createElement('dialog');
    d.className = 'efux-preview'; d.setAttribute('data-finance-approval-dialog','local-file-preview'); d.setAttribute('aria-label', '本機附件檢查');
    var head = document.createElement('div'); head.className = 'efux-preview-head';
    var title = document.createElement('strong'); title.textContent = file.name || file.n || '附件';
    var close = document.createElement('button'); close.type = 'button'; close.textContent = '關閉檢查'; close.className = 'btn-g';
    close.addEventListener('click', closePreview); head.append(title, close); d.append(head);
    var note = document.createElement('p'); note.className = 'efux-file-note';
    note.textContent = blob ? '本機預覽，不會上傳或送出申請。' : '此格式無法安全預覽；原檔仍保留，請在自己的檔案程式確認內容。'; d.append(note);
    if (blob) {
      previewUrl = URL.createObjectURL(blob);
      if (blob.type === 'application/pdf') {
        // Browsers disable native PDF viewers inside a sandboxed iframe. Open
        // the signature-verified local PDF in an isolated native viewer instead
        // of granting scripts/same-origin access to embedded document content.
        note.textContent = 'PDF 不在此頁嵌入預覽。可另開本機原檔；若瀏覽器無法顯示，請下載後用 PDF 閱讀程式查看。不會上傳或送出申請。';
        var open = document.createElement('a'); open.className='btn-g'; open.href=previewUrl; open.target='_blank'; open.rel='noopener noreferrer'; open.textContent='另開 PDF 原檔'; d.append(open);
      } else {
        var img = document.createElement('img'); img.alt = '附件：' + title.textContent; img.src = previewUrl; d.append(img);
      }
      var download = document.createElement('a'); download.className = 'btn-g'; download.href = previewUrl; download.download = title.textContent; download.textContent = '下載本機原檔'; d.append(download);
    }
    d.addEventListener('cancel', function (event) { event.preventDefault(); closePreview(); });
    d.addEventListener('click', function (event) { if (event.target === d) closePreview(); });
    document.body.append(d); previewDialog = d; d.showModal(); close.focus();
  }
  function renderFiles(container, files, options) {
    if (!container) return;
    options = options || {};
    container.classList.add('efux-file-list'); container.replaceChildren();
    if (!files.length) { var empty = document.createElement('p'); empty.className='efux-file-note'; empty.textContent='尚未選擇附件'; container.append(empty); }
    files.forEach(function (file,index) {
      var row = document.createElement('div'); row.className = 'efux-file-row';
      var name = file.name || file.n || '附件';
      var info = document.createElement('div'); info.className = 'efux-file-info';
      var fullName = document.createElement('strong'); fullName.textContent = name;
      var meta = document.createElement('span'); meta.textContent = sizeLabel(file.size) + (file.__revisionOriginal ? ' · 原附件保留' : '');
      info.append(fullName,meta); row.append(info);
      var local = localBlob(file);
      if (local) { var view = document.createElement('button'); view.type='button'; view.className='btn-g'; view.textContent=local.type==='application/pdf'?'開啟／下載':'預覽'; view.setAttribute('aria-label',view.textContent+' '+name); view.addEventListener('click',function () { preview(file,view); }); row.append(view); }
      if (options.onRemove && !file.__revisionOriginal) { var remove = document.createElement('button'); remove.type='button'; remove.className='btn-g'; remove.textContent='移除'; remove.setAttribute('aria-label','移除 '+name); remove.addEventListener('click',function () { options.onRemove(index); }); row.append(remove); }
      container.append(row);
    });
  }
  function fileIssues(container, rejected) {
    if (!container) return;
    container.hidden = !rejected.length; container.setAttribute('role','status');
    container.innerHTML = rejected.length ? '<strong>以下附件未加入；其他合法附件已保留</strong><ul>' + rejected.map(function (item) { return '<li>'+esc(item.name)+'：'+esc(item.message)+'</li>'; }).join('') + '</ul>' : '';
  }
  function focusTarget(id) {
    var target = document.getElementById(id);
    if (!target) return;
    var ancestor = target.parentElement;
    while (ancestor) { if (ancestor.tagName === 'DETAILS') { ancestor.open = true; if(ancestor.dataset.efuxKey)sectionState[ancestor.dataset.efuxKey]=true; } ancestor = ancestor.parentElement; }
    if (target.matches('.combo-native-select')) target = target._combo?.querySelector('.combo-input') || target;
    if (target.type === 'file' && !nodeVisible(target)) target = target.closest('[role=button]') || target.closest('.travel-file-control') || target.parentElement;
    if (!target.matches('input,select,textarea,button,a,[tabindex]')) target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true}); target.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function clearIssues(root) {
    root.querySelectorAll('[data-efux-invalid]').forEach(function (node) { node.removeAttribute('aria-invalid'); node.removeAttribute('data-efux-invalid'); });
    var old = root.querySelector('#nr-validation-summary'); if (old) old.remove();
  }
  function showIssues(root, issues) {
    clearIssues(root);
    var seen = {}; issues = issues.filter(function (issue) { var key=issue.target+'|'+issue.message; if(seen[key])return false;seen[key]=true;return true; });
    if (!issues.length) return false;
    var box = document.createElement('section'); box.id='nr-validation-summary'; box.className='efux-validation'; box.tabIndex=-1; box.setAttribute('role','alert');
    box.innerHTML='<h3>尚有 '+issues.length+' 項需要確認，這張單尚未送出</h3><p>點選項目可前往欄位；已填資料與合法附件均保留。</p>';
    var list = document.createElement('ul');
    issues.forEach(function (issue) {
      var item=document.createElement('li'),button=document.createElement('button'); button.type='button'; button.textContent=issue.message;
      button.addEventListener('click',function () { focusTarget(issue.target); }); item.append(button);list.append(item);
      var target=document.getElementById(issue.target);if(target){target.setAttribute('aria-invalid','true');target.setAttribute('data-efux-invalid','true');}
    });
    box.append(list);root.prepend(box);box.focus({preventScroll:true});box.scrollIntoView({block:'start'});return true;
  }
  function mountSections(root, key) {
    if (!root) return;
    var cards=Array.from(root.querySelectorAll('.card')).filter(function (card) { return !card.parentElement.closest('.card,.efux-section') && card.querySelector(':scope > .chd .cht'); });
    var mobile=global.matchMedia('(max-width: 700px)').matches;
    cards.forEach(function (card,index) {
      var header=card.querySelector(':scope > .chd .cht');
      var title=header.textContent.replace(/^\s*2-\d+[.．]?\s*/,''); header.textContent=title;
      var details=document.createElement('details');details.className='efux-section';
      var stateKey=key+'|'+title;details.dataset.efuxKey=stateKey;
      var summary=document.createElement('summary');summary.textContent=title;details.append(summary);
      card.before(details); details.append(card);
      details.open=!mobile || (Object.prototype.hasOwnProperty.call(sectionState,stateKey)?sectionState[stateKey]:index===0);
      summary.addEventListener('click',function () { if(global.matchMedia('(max-width: 700px)').matches)sectionState[stateKey]=!details.open; });
    });
    // Keep the final actions visible without forcing payment fields or the long
    // explanatory approval overview to stay expanded. Moving DOM preserves inputs.
    var actions=root.querySelector('.nr-submit-actions');
    if(actions && !actions.parentElement.classList.contains('efux-submit-area')){var area=document.createElement('div');area.className='efux-submit-area';root.append(area);area.append(actions);}
    var help=root.querySelector('.efux-sections-help');
    if(!help && cards.length){help=document.createElement('p');help.className='efux-sections-help';help.textContent='依需要展開填寫區段；收合不會清除資料。完成後在下方暫存或送出。';root.prepend(help);}
  }
  function syncViewport() {
    var mobile=global.matchMedia('(max-width: 700px)').matches;
    document.querySelectorAll('.efux-section').forEach(function (node,index) { node.open=!mobile || (Object.prototype.hasOwnProperty.call(sectionState,node.dataset.efuxKey)?sectionState[node.dataset.efuxKey]:index===0); });
  }
  var api={MAX_BYTES:MAX_BYTES,sizeLabel:sizeLabel,selectFiles:selectFiles,safePreviewBlob:safePreviewBlob,renderFiles:renderFiles,fileIssues:fileIssues,showIssues:showIssues,clearIssues:clearIssues,focusTarget:focusTarget,mountSections:mountSections,closePreview:closePreview};
  if (typeof module === 'object' && module.exports) module.exports=api;
  global.FinanceEmployeeFormUX=api;
  if(global.addEventListener){global.addEventListener('resize',syncViewport);global.addEventListener('pagehide',closePreview);}
})(typeof window !== 'undefined' ? window : globalThis);
