(function (global) {
  'use strict';
  var active = null;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(value, cents) { return new Intl.NumberFormat('zh-TW', {style:'currency',currency:'TWD',maximumFractionDigits:cents?2:4}).format(Number(value)/(cents?100:1)); }
  function button(label, action, id, primary) { return '<button type="button" class="'+(primary?'btn-p':'btn-s')+'" data-apm-action="'+action+'"'+(id?' data-id="'+escape(id)+'"':'')+'>'+escape(label)+'</button>'; }
  function options(rows, label) { return '<option value="">'+escape(label||'請選擇')+'</option>'+rows.map(function(r){return '<option value="'+escape(r.id||r.code)+'">'+escape(r.name||r.label||r.code)+'</option>';}).join(''); }
  function field(label,name,type,extra){return '<label class="apm-bonus-field">'+escape(label)+'<input name="'+name+'" type="'+(type||'text')+'" '+(extra||'')+'></label>';}
  function select(label,name,rows,placeholder){return '<label class="apm-bonus-field">'+escape(label)+'<select name="'+name+'" aria-label="'+escape(label)+'" data-no-search="true">'+options(rows,placeholder)+'</select></label>';}
  function note(text){return '<p class="apm-bonus-note">'+escape(text)+'</p>';}
  function reason(){return '<label class="apm-bonus-field">核對依據<textarea name="reference" rows="2" maxlength="1000" placeholder="請填寫核對的案件、資料來源與結果（至少 10 字）"></textarea></label>';}
  function submit(label){return '<div class="apm-bonus-actions"><button class="btn-p" type="submit">'+escape(label)+'</button></div>';}
  function alive(ctx){return active===ctx&&ctx.alive&&ctx.isCurrent();}
  function current(ctx,generation){return alive(ctx)&&ctx.generation===generation;}
  function denied(error){return error&&(['42501','PGRST301','PGRST302','PGRST303'].indexOf(error.code)>=0||[401,403].indexOf(error.status)>=0);}
  function status(ctx,text){if(alive(ctx)){var node=ctx.element.querySelector('[data-apm-status]');if(node)node.textContent=text;}}
  function dispose(){if(!active)return;var ctx=active;active=null;ctx.alive=false;ctx.data=null;ctx.pending=null;ctx.preview=null;clearInterval(ctx.identityTimer);global.removeEventListener('beforeunload',ctx.unload);if(ctx.closeDialog)ctx.closeDialog(false);ctx.element.replaceChildren();}
  function deny(ctx){if(!alive(ctx))return;ctx.generation++;ctx.data=null;ctx.pending=null;ctx.busy=false;ctx.dirty=false;ctx.element.innerHTML='<p role="alert" class="apm-bonus-note">目前無權讀取季度獎金核對資料，畫面已清除。請確認授權後重新進入。</p>';}
  function lock(ctx,locked){ctx.element.querySelectorAll('input,select,textarea,button').forEach(function(node){if(node.hasAttribute('data-permanent-disabled'))return;node.disabled=locked;});}
  async function rpc(ctx,name,args){
    var timer;try{return await Promise.race([ctx.client.rpc(name,args),new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error('TIMEOUT'));},ctx.timeoutMs);})]);}finally{clearTimeout(timer);}
  }
  function friendly(error){var code=String(error&&error.message||'');
    if(/SOURCE_CHANGED|40001/.test(code)||error&&error.code==='40001')return '來源資料已更新，本次未完成。請重新讀取後再核對；已填內容先保留。';
    if(/INDEPENDENT_REVIEW/.test(code))return '需由另一位有權限的人員覆核，不能自行核准自己的提案。';
    if(/SNAPSHOT_EXISTS/.test(code))return '此季度已有核定營收，請重新讀取查看。';
    if(/CLOSED_QUARTER|PERIOD_NOT_ENDED/.test(code))return '必須是已結束且三個月份都已關帳的季度。';
    if(/REAL_SETTLEMENT|REVERSAL|REFUND/.test(code))return '原款、全額退款或沖銷傳票尚未符合條件，沒有建立更正回執。';
    if(/WORKBENCH_LIMIT/.test(code))return '資料量超出此工作區安全上限，請聯絡系統管理員，不能將不完整清單當成全部。';
    return '目前無法確認處理完成。請保留原內容，使用「以相同內容重試」確認結果。';
  }
  function rowDept(ctx,id){var m=ctx.data.mappings.find(function(x){return x.id===id;});var d=m&&ctx.data.departments.find(function(x){return x.code===m.department_code;});return d?d.name:m?m.department_code:'部門對照已變更';}
  function reviewForm(kind,id,label){return '<form data-apm-form="'+kind+'" data-id="'+escape(id)+'" novalidate>'+reason()+submit(label)+'</form>';}
  function renderRevenue(ctx){var d=ctx.data;var mappings=d.mappings.filter(function(m){return m.active;});
    var html='<section class="card apm-bonus-section"><h2>季度營收</h2>'+note('只使用 Finance 已關帳的正式營收。先建立覆核預覽，再由另一位授權人員核定。');
    if(!mappings.length)html+=note('尚無已核定的部門對照，請先到「公司部門對照」建立並完成覆核。');
    else if(!d.periods.length)html+=note('目前沒有三個月份皆已關帳的完整季度。');
    else html+='<form data-apm-form="preview" novalidate><div class="apm-bonus-grid">'+select('部門','mappingId',mappings.map(function(m){return {id:m.id,name:rowDept(ctx,m.id)};}))+select('已關帳季度','period',d.periods.map(function(p){return {id:p.year+'-'+p.quarter,name:p.year+' 年第 '+p.quarter+' 季'};}))+'</div>'+submit('建立營收覆核預覽')+'</form>';
    html+='</section><section class="apm-bonus-section"><h2>待覆核營收</h2>';
    if(!d.previews.length)html+=note('目前沒有待覆核營收。');
    d.previews.forEach(function(p){html+='<article class="card apm-bonus-item"><div class="apm-bonus-item-head"><div><h3>'+escape(rowDept(ctx,p.evidence.mappingId))+'</h3><p>'+escape(p.evidence.year)+' 年第 '+escape(p.evidence.quarter)+' 季</p></div><strong>'+escape(money(p.evidence.value))+'</strong></div><p>編製：'+escape(p.actorName)+' · '+escape(p.evidence.ledgerCount)+' 筆帳務</p>'+note('科目：'+p.evidence.accountCodes.join('、'));
      if(p.actorId!==d.actor.id)html+='<form data-apm-form="approve" data-id="'+escape(p.id)+'" novalidate><label class="apm-bonus-check"><input type="checkbox" name="confirmed"> 我已核對部門、季度、科目與營收金額</label>'+submit('核定並提供 APM')+'</form>';
      else html+=note('待另一位授權人員覆核；本預覽不是已核定營收。');html+='</article>';});
    html+='</section><details class="card apm-bonus-section"><summary>已核定營收（'+d.snapshots.length+'）</summary>';
    d.snapshots.forEach(function(s){html+='<div class="apm-bonus-history"><strong>'+escape(rowDept(ctx,s.mappingId))+' · '+escape(s.snapshot.period.year)+' 年第 '+escape(s.snapshot.period.quarter)+' 季</strong><span>'+escape(money(s.snapshot.value))+'</span><p>已由：'+escape(s.approvedBy)+' 核定</p></div>';});
    return html+'</details>';
  }
  function renderMappings(ctx){var d=ctx.data;var html='<details class="card apm-bonus-section"><summary>新增公司部門對照</summary>'+note('一次性設定：從 APM 複製公司與部門識別摘要。貼入內容只作核對參考，須由另一位執行長帳號核定，不會按名稱自動配對。')+'<form data-apm-form="mapping" novalidate><label class="apm-bonus-field">APM 公司部門識別摘要<textarea name="source" rows="3" spellcheck="false" placeholder="貼上 APM 複製的 JSON 摘要"></textarea></label>'+select('Finance 入帳部門','departmentCode',d.departments)+'<fieldset><legend>營收科目</legend><div class="apm-bonus-account-list">'+d.accounts.map(function(a){return '<label class="apm-bonus-check"><input type="checkbox" name="accountCodes" value="'+escape(a.code)+'">'+escape(a.code+' '+a.name)+'</label>';}).join('')+'</div></fieldset>'+reason()+submit('送交對照覆核')+'</form></details><section class="apm-bonus-section"><h2>部門對照</h2>';
    if(!d.mappings.length)html+=note('目前尚未建立對照。');
    d.mappings.forEach(function(m){var revoked=m.decisions.some(function(x){return x.decision==='revoked';});html+='<article class="card apm-bonus-item"><div class="apm-bonus-item-head"><h3>'+escape(rowDept(ctx,m.id))+'</h3><span class="badge '+(m.active?'b-ok':'b-wait')+'">'+(m.active?'已核定':revoked?'已停用':'待覆核')+'</span></div><p>科目：'+escape(m.account_codes.join('、'))+'</p><p>提案：'+escape(m.proposerName)+'</p><details><summary>對照與核對依據</summary><dl><dt>APM 公司</dt><dd>'+escape(m.apm_company_id)+'</dd><dt>APM 部門</dt><dd>'+escape(m.apm_department_id)+'</dd><dt>提案依據</dt><dd>'+escape(m.reference)+'</dd></dl>'+m.decisions.map(function(x){return '<p>已由：'+escape(x.actorName)+' '+(x.decision==='verified'?'核定':'停用')+' · '+escape(x.reference)+'</p>';}).join('')+'</details>';
      if(!revoked&&d.actor.role==='ceo'&&!m.active&&m.created_by!==d.actor.id)html+=reviewForm('mapping.verify',m.id,'核定此對照');
      else if(!revoked&&!m.active)html+=note('待另一位執行長帳號核定。');
      if(m.active&&d.actor.role==='ceo')html+='<details><summary>停止提供此對照</summary>'+note('停用後不再對 APM 提供此對照的營收。歷史核定紀錄保留。')+reviewForm('mapping.revoke',m.id,'確認停用')+'</details>';html+='</article>';});
    return html+'</section>';
  }
  function correctionOriginal(ctx,id){return ctx.data.obligations.find(function(x){return x.id===id;});}
  function renderCorrections(ctx){var d=ctx.data;var html='<section class="card apm-bonus-section"><h2>獎金更正回執</h2>'+note('只記錄已完成的全額退款與沖銷，不會代為退款、付款或再次計入薪資。');
    if(!d.obligations.length)html+=note('目前沒有具薪資閱讀權限的獨立獎金付款來源。');
    else html+='<form data-apm-form="correction" novalidate>'+select('原獎金付款來源','obligationId',d.obligations.map(function(o){return {id:o.id,name:o.period+' · '+(o.originalVoucherNumber||'尚無付款傳票')+' · '+money(o.totalNetCents,true)};}))+'<div data-apm-original-detail></div><div data-apm-correction-fields hidden><label class="apm-bonus-field">APM 更正案件識別摘要<textarea name="source" rows="3" spellcheck="false" placeholder="貼上「複製會計核對參考」的 JSON 摘要"></textarea></label>'+select('已入帳的完整沖銷傳票','reversalVoucherId',[])+field('退款銀行交易或對帳紀錄','refundReference','text','maxlength="500"')+field('全額退款佐證（最多 10 MB）','evidence','file','accept=".pdf,.csv,.xlsx,.png,.jpg,.jpeg"')+note('此處只保存檔案 SHA-256 指紋供核對，不會上傳原檔；請依既有公司文管方式保存佐證原件。')+'<label class="apm-bonus-check"><input type="checkbox" name="confirmed"> 已核對全額退款入帳，且所選沖銷傳票與原款一致</label>'+reason()+submit('送交更正回執覆核')+'</div></form>';
    html+='</section><section class="apm-bonus-section"><h2>更正處理紀錄</h2>';
    if(!d.corrections.length)html+=note('目前沒有更正提案。');
    d.corrections.forEach(function(p){html+='<article class="card apm-bonus-item"><div class="apm-bonus-item-head"><h3>'+escape(p.period)+' 獎金更正</h3><span class="badge '+(p.receipt?'b-ok':'b-wait')+'">'+(p.receipt?'回執已核定':'待另一人覆核')+'</span></div><p>沖銷傳票：'+escape(p.reversalVoucherNumber)+' · 退款 '+escape(money(p.refund.amountCents,true))+'</p><p>提案：'+escape(p.proposerName)+'</p><details><summary>案件與佐證核對資料</summary><dl><dt>原批次</dt><dd>'+escape(p.originalBatchId)+'</dd><dt>更正批次</dt><dd>'+escape(p.correctionBatchId)+'</dd><dt>更正資料指紋</dt><dd>'+escape(p.correctionSourceHash)+'</dd><dt>退款核對紀錄</dt><dd>'+escape(p.refund.reference)+'</dd><dt>退款檔案指紋</dt><dd>'+escape(p.refund.sha256)+'</dd><dt>提案依據</dt><dd>'+escape(p.reference)+'</dd></dl></details>';
      if(p.receipt)html+='<p>已由：'+escape(p.verifierName)+' 核定</p>'+button('複製回執識別','copy-receipt',p.id,false);
      else if(p.proposerId!==d.actor.id)html+=reviewForm('correction.verify',p.id,'確認核對並建立回執');
      else html+=note('不可自行覆核，請另一位具相同薪資資料權限的人員處理。');html+='</article>';});
    return html+'</section>';
  }
  function render(ctx){if(!alive(ctx)||!ctx.data)return;var d=ctx.data;
    ctx.element.innerHTML='<div class="apm-bonus-heading"><div><h1>季度獎金核對</h1><p>營收、部門對照與更正回執</p></div>'+button('重新讀取','refresh')+'</div><p data-apm-status role="status" aria-live="polite"></p><div class="apm-bonus-tools">'+select('公司','entityId',d.entities)+'</div><div class="apm-bonus-tabs" role="group" aria-label="核對工作類型">'+[['revenue','營收核定'],['mapping','公司部門對照'],['correction','更正回執']].map(function(t){return '<button type="button" class="btn-s" data-apm-action="tab" data-id="'+t[0]+'" aria-pressed="'+(ctx.tab===t[0])+'">'+t[1]+'</button>';}).join('')+'</div><div data-apm-content>'+(ctx.entity?(ctx.tab==='revenue'?renderRevenue(ctx):ctx.tab==='mapping'?renderMappings(ctx):renderCorrections(ctx)):note(d.entities.length?'請先選擇要核對的公司。':'沒有可操作的公司範圍，請確認正式授權。'))+'</div>';
    ctx.element.querySelector('[name="entityId"]').value=ctx.entity||'';
    if(ctx.pending)uncertain(ctx);
  }
  async function load(ctx,entity){if(!alive(ctx)||ctx.busy||ctx.pending)return;var generation=++ctx.generation;ctx.busy=true;lock(ctx,true);status(ctx,'正在確認權限與資料…');
    try{var response=await rpc(ctx,'finance_apm_workbench',{entity_id:entity||null});if(response.error)throw response.error;if(!current(ctx,generation))return;
      var d=response.data;if(!d||!d.actor||d.entityId!==(entity||null)||!['entities','departments','accounts','mappings','periods','previews','snapshots','obligations','corrections'].every(function(k){return Array.isArray(d[k]);}))throw new Error('INVALID_RESPONSE');
      ctx.entity=entity||'';ctx.data=d;ctx.dirty=false;render(ctx);status(ctx,'資料已更新。');return true;
    }catch(error){if(!current(ctx,generation))return false;if(denied(error)){deny(ctx);return false;}ctx.data=null;ctx.entity=entity||'';ctx.dirty=false;ctx.element.innerHTML='<h1>季度獎金核對</h1><p data-apm-status role="status" aria-live="polite"></p><div data-apm-content></div>'+button('重新讀取','refresh');status(ctx,'資料讀取失敗，請重新讀取；未將失敗當作空清單。');return false;}
    finally{if(current(ctx,generation)){ctx.busy=false;lock(ctx,false);}}
  }
  function uncertain(ctx){lock(ctx,true);var node=ctx.element.querySelector('[data-apm-status]');node.textContent='送出結果尚待確認，原內容已鎖定，請以相同內容重試。';var retry=document.createElement('button');retry.className='btn-s';retry.type='button';retry.dataset.apmAction='retry';retry.textContent='以相同內容重試';node.appendChild(retry);}
  function invalid(form,name,message){var input=form.elements.namedItem(name);if(input&&input.length&&!input.tagName)input=input[0];var old=form.querySelector('[data-apm-error]');if(old)old.remove();form.querySelectorAll('[aria-invalid]').forEach(function(n){n.removeAttribute('aria-invalid');});var error=document.createElement('p');error.dataset.apmError='true';error.id='apm-bonus-form-error';error.setAttribute('role','alert');error.className='apm-bonus-error';error.textContent=message;form.prepend(error);if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',error.id);input.focus();}throw new Error('VALIDATION');}
  function text(form,name,min){var value=String(new FormData(form).get(name)||'').trim();if(value.length<(min||1))invalid(form,name,min?'請填寫至少 '+min+' 字的核對依據。':'請完成此欄位。');return value;}
  function source(form,type){var value;try{value=JSON.parse(text(form,'source'));}catch(_){invalid(form,'source','請貼上從 APM 複製的完整 JSON 摘要。');}
    var keys=type==='mapping'?['schemaVersion','apmCompanyId','apmDepartmentId']:['schemaVersion','correctionBatchId','correctionSourceHash','originalBatchId'];
    if(!value||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(function(k){return keys.indexOf(k)<0;})||value.schemaVersion!==1||keys.filter(function(k){return k.endsWith('Id');}).some(function(k){return !UUID.test(value[k]||'');})||(type!=='mapping'&&(!/^[0-9a-f]{64}$/.test(value.correctionSourceHash||'')||value.correctionBatchId===value.originalBatchId)))invalid(form,'source','識別摘要格式不正確，請重新從 APM 複製，不要手動改寫。');
    delete value.schemaVersion;return value;
  }
  async function mutation(ctx,name,command,payload,form){
    if(!alive(ctx)||ctx.busy)return;var generation=ctx.generation;ctx.busy=true;lock(ctx,true);
    if(!ctx.pending)ctx.pending={name:name,args:{command:command,payload:Object.assign({requestId:crypto.randomUUID()},payload)}};
    try{var response=await rpc(ctx,ctx.pending.name,ctx.pending.args);if(response.error)throw response.error;if(!current(ctx,generation))return;
      var result=response.data;var sent=ctx.pending.args.command;
      var expected=sent==='snapshot.preview'?result&&result.previewHash&&result.evidence:sent==='snapshot.approve'?result&&result.status==='approved'&&result.snapshot:sent==='mapping.propose'?result&&result.status==='pending_verification'&&result.mappingId:sent==='mapping.verify'?result&&result.status==='verified':sent==='mapping.revoke'?result&&result.status==='revoked':sent==='propose'?result&&result.status==='pending_independent_verification'&&result.proposalId:sent==='verify'?result&&result.status==='verified'&&result.receipt:false;
      if(!expected)throw new Error('UNKNOWN_RESPONSE');
      ctx.pending=null;ctx.dirty=false;ctx.busy=false;var refreshed=await load(ctx,ctx.entity);if(refreshed)status(ctx,'操作已保存。只有標示「已核定」的資料才完成覆核。');
    }catch(error){if(!current(ctx,generation))return;if(denied(error)){deny(ctx);return;}
      if(error&&/^[0-9A-Z]{5}$/.test(error.code||'')){ctx.pending=null;lock(ctx,false);status(ctx,friendly(error));}
      else uncertain(ctx);
    }finally{if(current(ctx,generation))ctx.busy=false;}
  }
  async function submitForm(ctx,form){if(!alive(ctx)||ctx.busy||ctx.pending)return;var kind=form.dataset.apmForm;var p={entityId:ctx.entity};var cmd=kind;var name='finance_apm_metrics_command';
    try{
      if(kind==='mapping'){Object.assign(p,source(form,'mapping'));p.departmentCode=text(form,'departmentCode');p.accountCodes=new FormData(form).getAll('accountCodes');if(!p.accountCodes.length||p.accountCodes.length>50)invalid(form,'accountCodes','請選擇 1 至 50 個營收科目。');p.reference=text(form,'reference',10);cmd='mapping.propose';}
      else if(kind==='preview'){p.mappingId=text(form,'mappingId');var period=text(form,'period').split('-');p.year=Number(period[0]);p.quarter=Number(period[1]);cmd='snapshot.preview';}
      else if(kind==='approve'){var preview=ctx.data.previews.find(function(x){return x.id===form.dataset.id;});if(!preview||preview.actorId===ctx.data.actor.id)return;if(!new FormData(form).has('confirmed'))invalid(form,'confirmed','請先核對並勾選確認。');p.mappingId=preview.evidence.mappingId;p.year=preview.evidence.year;p.quarter=preview.evidence.quarter;p.previewHash=preview.previewHash;cmd='snapshot.approve';}
      else if(kind==='mapping.verify'||kind==='mapping.revoke'){p.mappingId=form.dataset.id;p.reference=text(form,'reference',10);}
      else if(kind==='correction.verify'){name='finance_apm_correction_command';cmd='verify';p={proposalId:form.dataset.id,reference:text(form,'reference',10)};}
      else if(kind==='correction'){
        name='finance_apm_correction_command';cmd='propose';p=source(form,'correction');p.obligationId=text(form,'obligationId');var o=correctionOriginal(ctx,p.obligationId);p.reversalVoucherId=text(form,'reversalVoucherId');
        if(!o||!o.paid||!o.reversals.some(function(v){return v.id===p.reversalVoucherId;}))invalid(form,'obligationId','請選擇已有實際付款及完整沖銷傳票的來源。');
        if(!new FormData(form).has('confirmed'))invalid(form,'confirmed','請先確認全額退款已入帳。');
        var ref=text(form,'refundReference',10);var file=new FormData(form).get('evidence');if(!(file instanceof File)||file.size<1||file.size>10485760)invalid(form,'evidence','請選擇 10 MB 以內的退款佐證文件。');
        p.reference=text(form,'reference',10);ctx.busy=true;lock(ctx,true);var generation=ctx.generation;
        try{var digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(!current(ctx,generation))return;p.refund={status:'settled',amountCents:o.totalNetCents,reference:ref,sha256:Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0');}).join('')};}
        finally{if(current(ctx,generation)){ctx.busy=false;lock(ctx,false);}}
      }else return;
      await mutation(ctx,name,cmd,p,form);
    }catch(error){if(error.message!=='VALIDATION'&&alive(ctx)){ctx.busy=false;lock(ctx,false);status(ctx,'尚未送出，請確認資料與佐證檔案後重試。');}}
  }
  function originalChanged(ctx,form){var o=correctionOriginal(ctx,form.elements.obligationId.value);var detail=form.querySelector('[data-apm-original-detail]');var fields=form.querySelector('[data-apm-correction-fields]');fields.hidden=true;form.elements.reversalVoucherId.innerHTML=options([]);detail.textContent='';if(!o)return;
    if(!o.paid){detail.textContent='此筆尚無 Finance 放款完成證據，不能使用退款沖銷回執。須先取得正式取消回執；目前此入口無法處理未付款取消，請勿填造退款。';return;}
    if(!o.reversals.length){detail.textContent='已付款，但尚無可用的完整沖銷傳票。請先依會計既有流程完成全額退款與沖銷；本頁不會代為退款或建傳票。';return;}
    detail.textContent='原實付 '+money(o.totalNetCents,true)+'，須全額退款並核對以下沖銷傳票。';form.elements.reversalVoucherId.innerHTML=options(o.reversals.map(function(v){return {id:v.id,name:v.number+' · '+money(v.total)};}));fields.hidden=false;
  }
  async function beforeLeave(){var ctx=active;if(!ctx||!alive(ctx)||(!ctx.dirty&&!ctx.pending))return true;if(ctx.busy){status(ctx,'正在確認送出結果，請稍候再離開。');return false;}
    if(ctx.dialog)return false;return new Promise(function(resolve){var dialog=document.createElement('dialog');ctx.dialog=dialog;dialog.className='apm-bonus-dialog';dialog.setAttribute('aria-labelledby','apm-bonus-leave-title');dialog.innerHTML='<h2 id="apm-bonus-leave-title">離開季度獎金核對？</h2><p>'+ (ctx.pending?'送出結果仍待確認，建議留在此頁以相同內容重試，避免重新提案。':'尚未送出的內容不會保存。')+'</p><div class="apm-bonus-actions">'+button('留在此頁','stay')+button('直接離開','leave')+'</div>';
      function finish(value){dialog.close();dialog.remove();ctx.dialog=null;ctx.closeDialog=null;resolve(value);}ctx.closeDialog=finish;dialog.addEventListener('cancel',function(e){e.preventDefault();finish(false);});dialog.addEventListener('click',function(e){var b=e.target.closest('[data-apm-action]');if(b)finish(b.dataset.apmAction==='leave');});document.body.appendChild(dialog);dialog.showModal();dialog.querySelector('button').focus();});
  }
  function mount(element,config){dispose();var ctx=Object.assign({element:element,alive:true,generation:0,busy:false,pending:null,data:null,entity:'',tab:'revenue',dirty:false,timeoutMs:20000},config);active=ctx;element.classList.add('apm-bonus-workbench');element.innerHTML='<h1>季度獎金核對</h1><p data-apm-status role="status" aria-live="polite"></p><div data-apm-content></div>'+button('重新讀取','refresh');
    ctx.unload=function(e){if(alive(ctx)&&(ctx.dirty||ctx.pending)){e.preventDefault();e.returnValue='';}};global.addEventListener('beforeunload',ctx.unload);
    ctx.identityTimer=setInterval(function(){if(active===ctx&&!ctx.isCurrent())dispose();},250);
    element.addEventListener('input',function(e){if(alive(ctx)&&e.target.closest('form'))ctx.dirty=true;});
    element.addEventListener('change',async function(e){if(!alive(ctx))return;if(e.target.name==='entityId'){var next=e.target.value;if(!await beforeLeave()){e.target.value=ctx.entity;return;}ctx.pending=null;await load(ctx,next);}else if(e.target.name==='obligationId')originalChanged(ctx,e.target.form);});
    element.addEventListener('submit',function(e){var form=e.target.closest('[data-apm-form]');if(form){e.preventDefault();submitForm(ctx,form);}});
    element.addEventListener('click',async function(e){var b=e.target.closest('[data-apm-action]');if(!b||!alive(ctx))return;var action=b.dataset.apmAction;if(action==='retry'){if(ctx.pending)await mutation(ctx);return;}if(ctx.busy||ctx.pending)return;
      if(action==='copy-receipt'){var row=ctx.data.corrections.find(function(x){return x.id===b.dataset.id;});if(!row||!row.receipt)return;try{await navigator.clipboard.writeText(row.receipt.receiptId);status(ctx,'回執識別已複製；這不是付款或人資勾稽完成證明。');}catch(_){status(ctx,'無法自動複製，回執識別：'+row.receipt.receiptId);}return;}
      if(!await beforeLeave())return;if(action==='refresh')await load(ctx,ctx.entity);if(action==='tab'){ctx.tab=b.dataset.id;ctx.dirty=false;render(ctx);ctx.element.querySelector('[data-apm-content]').setAttribute('tabindex','-1');ctx.element.querySelector('[data-apm-content]').focus();}});
    load(ctx,'');return {dispose:dispose,beforeLeave:beforeLeave};
  }
  global.FinanceApmBonusWorkbench={mount:mount,dispose:dispose,beforeLeave:beforeLeave};
})(window);
