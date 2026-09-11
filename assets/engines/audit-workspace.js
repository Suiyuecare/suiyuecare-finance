(function(global){
  'use strict';
  var runtime=null,session='',epoch=0,records=new Map(),versions=new Map(),operations=new Map(),dialogVersion=0;
  var state={section:'items',filter:'all',query:'',page:0},PAGE_SIZE=25;
  function h(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function copy(v){return JSON.parse(JSON.stringify(v));}
  function el(id){return global.document.getElementById(id);}
  function money(v){return v==null?'待核對':new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(v);}
  function identity(){var u=runtime&&runtime.user()||{};return runtime?[runtime.tenant(),runtime.environment(),u.id,u.authUserId||u.auth_user_id,runtime.role(),runtime.identityBlocked(),runtime.permissionIdentity()].join('|'):'';}
  function sync(){var next=identity();if(next!==session){session=next;epoch++;records.clear();versions.clear();operations.clear();state.page=0;closeDialog();}}
  function scope(){return {eid:el('rpt-ent')&&el('rpt-ent').value||'all',period:el('rpt-month')&&el('rpt-month').value||runtime.today().slice(0,7)};}
  function key(s){sync();return session+'|'+s.eid+'|'+s.period;}
  function active(s){return runtime.state().page==='reports'&&global.FinanceReportingWorkspace.state.tab==='audit'&&key(scope())===key(s);}
  function entityName(eid){var e=runtime.entities().find(function(x){return x.id===eid;});return e&&(e.full||e.n||e.s)||eid;}
  function userName(id){var u=runtime.users().find(function(x){return x.id===id;});return u&&(u.n||u.name)||id||'未指派';}
  function button(label,action,attrs,primary){return '<button type="button" class="rw-button'+(primary?' primary':'')+'" data-aw-action="'+h(action)+'" '+(attrs||'')+'>'+h(label)+'</button>';}
  function notice(text,error){return '<div class="rw-notice'+(error?' error':'')+'" role="'+(error?'alert':'status')+'">'+h(text)+'</div>';}
  function table(headers,rows){return '<div class="rw-table-wrap"><table class="rw-table"><thead><tr>'+headers.map(function(v){return '<th scope="col">'+h(v)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+row.map(function(v){return '<td>'+(v&&typeof v==='object'&&v.html!=null?v.html:h(v))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';}
  function badge(status){var labels={pass:'數值核對一致',issue:'有差異／待處理',unknown:'資料待確認',review:'待人工查核',pending:'待提供',provided:'已提供・待內部覆核',reviewed:'已內部覆核',stale:'來源已變更・須重核'};return '<span class="aw-badge '+h(status)+'">'+h(labels[status]||status)+'</span>';}
  function metric(label,value){return '<div class="rw-kpi"><span>'+h(label)+'</span><strong>'+h(value)+'</strong></div>';}
  async function rpc(name,args){var result=await runtime.rpc(name,args);if(result&&result.error)throw new Error(result.error.message||'讀取失敗');var data=result&&Object.prototype.hasOwnProperty.call(result,'data')?result.data:result;if(!data||data.ok===false)throw new Error(data&&data.message||'伺服器未確認保存結果');return data;}
  function readArgs(s){return {p_entity_id:s.eid,p_period:s.period,p_data_environment:runtime.environment()};}
  function repaint(s){if(active(s)&&el('finance-audit-workspace'))el('finance-audit-workspace').innerHTML=view(s);}
  function requireScope(s){if(s.eid==='all')throw new Error('請選擇一間受查公司；各法人分別建立查帳資料。');if(s.period==='all')throw new Error('請選擇年度、季度或月份，明確界定查帳期間。');return global.FinanceFinancialStatements.periodBounds(s.period);}
  async function load(s,force){
    var bounds=requireScope(s),k=key(s),token=identity(),generation=epoch;
    if(!force&&operations.has(k))return operations.get(k);
    if(!force&&records.has(k))return records.get(k);
    var version=(versions.get(k)||0)+1;versions.set(k,version);records.set(k,{status:'loading'});
    function current(){return identity()===token&&epoch===generation&&versions.get(k)===version;}
    var promise=(async function(){try{
      // Two server observations surround the complete local source reload. The
      // fingerprint detects changes; it does not lock or archive the books.
      var before=await rpc('finance_audit_case_read_v1',readArgs(s));if(!current())return null;
      await runtime.reload();if(!current())return null;
      var profile=await global.FinanceReportingWorkspace.loadProfile(s.eid,true);if(!current())return null;
      if(!profile||!profile.loaded||profile.error)throw new Error('公司報表設定尚未完整讀取。');
      var ar=null,arError='';try{ar=await rpc('finance_receivables_v1',{p_as_of:bounds.end,p_entity_id:s.eid,p_department_code:null,p_data_environment:runtime.environment()});}catch(error){arError=error.message;}
      if(!current())return null;
      if(ar)ar=Object.assign({},ar,{entityId:s.eid});
      var after=await rpc('finance_audit_case_read_v1',readArgs(s));if(!current())return null;
      if(!before.sourceFingerprint||before.sourceFingerprint!==after.sourceFingerprint)throw new Error('讀取期間來源帳務已變更。請重新核對，避免混用不同版本。');
      var ledger=copy(runtime.auditLedger(s.eid)),sources=copy(runtime.auditSources(s.eid)),complete=copy(runtime.completeness()),counts=after.sourceCounts||{};
      [['ledger',ledger],['invoices',sources.invoices],['expense_requests',sources.expense_requests]].forEach(function(pair){
        var t=complete.tables&&complete.tables[pair[0]];
        if(!t||t.complete!==true||!Array.isArray(pair[1])||!Number.isSafeInteger(counts[pair[0]])||pair[1].length!==counts[pair[0]])throw new Error('「'+({ledger:'分類帳',invoices:'發票',expense_requests:'申請單'})[pair[0]]+'」尚未完整核對筆數，請重新讀取。');
        t.scopedRowCount=pair[1].length;t.scopedCount=pair[1].length;
      });
      var statement=copy(runtime.statementModel(s.eid,s.period,{departmentCode:'all'}));
      var input={entityId:s.eid,period:s.period,statementModel:statement,ledger:ledger,completeness:complete,profile:copy(profile.profile),receivables:ar,auditCase:copy(after),today:runtime.today()};
      var record={status:'ready',caseRecord:after,input:input,sources:sources,loadedAt:new Date().toISOString(),arError:arError};
      record.model=global.FinanceAuditReadinessEngine.buildModel(input);records.set(k,record);return record;
    }catch(error){if(current())records.set(k,{status:'error',error:error.message||'讀取失敗'});return null;}
    finally{if(current()){operations.delete(k);repaint(s);}}})();operations.set(k,promise);return promise;
  }
  function itemRows(record){var items=record.model.items||[];return state.filter==='attention'?items.filter(function(i){return i.effectiveStatus!=='reviewed';}):items;}
  function renderItems(record){var canEdit=record.caseRecord.canEdit===true;
    return '<div class="rw-panel-head"><div><h3>查帳資料清單</h3><p class="rw-muted">先補齊佐證，再交由另一位授權同仁內部覆核。來源帳務變更時須重新核對。</p></div><div class="rw-actions">'+button(state.filter==='attention'?'顯示全部':'只看待處理','filter')+'</div></div><div class="aw-items">'+itemRows(record).map(function(item){
      return '<article class="aw-item"><div class="aw-item-title"><small>'+h(item.id)+'</small><h4>'+h(item.title)+'</h4>'+badge(item.effectiveStatus)+'</div><p>'+h(item.description||'')+'</p><dl><div><dt>負責人</dt><dd>'+h(userName(item.ownerId))+'</dd></div><div><dt>提供期限</dt><dd>'+h(item.dueDate||'未設定')+'</dd></div><div><dt>資料索引</dt><dd>'+h(item.evidenceReference||((item.sourceLinks||[]).length+' 筆來源單據'))+'</dd></div></dl><div class="aw-item-footer"><small>'+h(item.reviewedBy?'內部覆核：'+userName(item.reviewedBy)+' · '+String(item.reviewedAt||'').slice(0,10):'尚未完成內部覆核')+'</small>'+button(canEdit?'整理／覆核':'查看資料','item','data-item="'+h(item.id)+'"')+'</div></article>';
    }).join('')+'</div>';
  }
  function renderControls(record){var model=record.model;return notice('數值一致只代表這次勾稽結果。交易真實性、未入帳負債、函證與估計合理性，仍須查核人員執行程序。')+(record.arError?notice('應收資料暫未取得：'+record.arError,true):'')+'<div class="aw-controls">'+(model.controls||[]).map(function(c){return '<article class="aw-control"><div><h4>'+h(c.title)+'</h4>'+badge(c.status)+'</div><p>'+h(c.message||'')+'</p>'+((c.sourceIds||[]).length?button('查看來源（'+c.sourceIds.length+'）','control-sources','data-control="'+h(c.id)+'"'):'')+'</article>';}).join('')+'</div>';}
  function renderEquity(record){var e=record.model.equityRollforward||{};return notice('權益調節底稿用來協助準備第四張報表。出資、盈餘分配、其他權益變動及附註，仍須依決議、契約與適用準則逐項分類及覆核。')+table(['核對項目','金額'],[['期初權益',money(e.openingEquity)],['本期損益',money(e.currentProfit)],['其他綜合損益',money(e.currentOci)],['其他權益變動（待分類）',money(e.otherEquityMovement)],['結帳分錄淨影響',money(e.closingEntryNetEffect)],['調節後預計期末權益',money(e.expectedClosingEquity)],['期末權益',money(e.closingEquity)],['權益調節差額',money(e.difference)]])+notice('完整財務報表還需要兩期比較、權益變動表及附註。請在 A10 提供會計政策、重要估計、關係人、承諾或有事項等揭露底稿。')+button('整理四表與附註資料','item','data-item="A10"');}
  function sourceList(record){var q=state.query.trim().toLowerCase();return record.input.ledger.filter(function(r){return !q||[r.id,r.ref,r.sourceId,r.voucherNo,r.ac,r.an,r.desc,r.date,r.dr,r.cr].map(function(v){return String(v==null?'':v).toLowerCase();}).join(' ').includes(q);});}
  function sourceTable(rows,page){var max=Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1);page=Math.max(0,Math.min(page,max));return table(['日期','科目','來源／摘要','借方','貸方','追溯'],rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(function(r){return [r.date||r.entry_date,(r.ac||r.account_code)+' '+(r.an||r.account_name||''),(r.voucherNo||r.ref||r.sourceId||'來源待補')+' · '+(r.desc||r.description||''),money(r.dr==null?r.debit:r.dr),money(r.cr==null?r.credit:r.cr),{html:button('查看','ledger','data-ledger="'+h(r.id)+'"')}];}))+'<div class="rw-pager"><span>共 '+rows.length+' 筆 · 第 '+(page+1)+' 頁</span><div class="rw-actions">'+button('上一頁','source-page','data-delta="-1" '+(!page?'disabled':''))+button('下一頁','source-page','data-delta="1" '+(page>=max?'disabled':''))+'</div></div>';}
  function renderSources(record){var rows=sourceList(record);return notice('此處為所選公司已讀取的完整分類帳索引，含期初及期後來源。各報表與查核候選另依所選期間計算；篩選畫面不會刪減匯出母體。')+'<label class="aw-search">搜尋單號、科目、摘要或金額<input type="search" name="aw-source-query" value="'+h(state.query)+'" placeholder="例如：單號、租金、10000"></label>'+sourceTable(rows,state.page);}
  function view(s){
    sync();if(!runtime)return '';try{requireScope(s);}catch(error){return notice(error.message);}
    var k=key(s),record=records.get(k);if(!record){load(copy(s),false);record={status:'loading'};}
    if(record.status==='loading')return notice('正在逐一核對來源筆數與版本，整理查帳資料…');
    if(record.status==='error')return notice(record.error,true)+button('重新讀取並核對','reload','',true);
    var model=record.model,summary=model.summary||{},system=summary.system||{},review=summary.internalReview||{},caseData=record.caseRecord.caseData||{};
    var sections={items:'資料清單',controls:'帳務核對',equity:'權益與附註',sources:'分類帳母體'};
    return '<div class="aw-header"><div><p class="aw-eyebrow">會計師查帳準備</p><h2>先看缺項，再一路查到來源</h2><p>'+h(({financial:'財務報表簽證',tax:'所得稅簽證',both:'財務報表簽證＋所得稅簽證'})[caseData.engagementType]||'委任類型待確認')+' · '+h(entityName(s.eid))+' · '+h(s.period)+'</p></div><div class="rw-actions">'+button('案件設定','settings')+button('重新核對','reload')+button('匯出查帳 Excel','export-xlsx','',true)+button('下載來源索引 JSON','export-json')+'</div></div>'
      +'<div class="rw-kpis aw-kpis">'+metric('系統發現待處理',system.issue||0)+metric('系統資料待確認',system.unknown||0)+metric('已提供／待覆核',review.provided||0)+metric('已內部覆核',(review.reviewed||0)+' / '+(review.total||12))+'</div>'
      +notice('資料清單與內部覆核供受委任會計師查帳使用；不代表已取得查核意見或完成所得稅簽證。函證寄發與直接回函須由查核人員掌握。')
      +'<nav class="aw-sections" aria-label="查帳工作區">'+Object.keys(sections).map(function(id){return '<button type="button" class="rw-button" aria-current="'+(state.section===id?'page':'false')+'" data-aw-action="section" data-section="'+id+'">'+sections[id]+'</button>';}).join('')+'</nav>'
      +(state.section==='controls'?renderControls(record):state.section==='equity'?renderEquity(record):state.section==='sources'?renderSources(record):renderItems(record))
      +'<div class="aw-footnote"><span>核對時間 '+h(record.loadedAt.replace('T',' ').slice(0,19))+' UTC · 案件版本 '+h(record.caseRecord.revision)+'</span>'+button('查看修改歷程','history')+'<details><summary>本次來源識別</summary><p>伺服器來源指紋：<code>'+h(record.caseRecord.sourceFingerprint)+'</code></p><p>來源指紋用於發現變更；帳務仍可依授權流程更新，這不是檔案封存或關帳證明。</p></details></div>';
  }
  function recordNow(){var r=records.get(key(scope()));if(!r||r.status!=='ready')throw new Error('請先完成資料讀取。');return r;}
  function closeDialog(){dialogVersion++;var d=el('finance-audit-dialog');if(d&&d.open)d.close();}
  function dialog(title,body){closeDialog();var d=el('finance-audit-dialog');if(!d){d=global.document.createElement('dialog');d.id='finance-audit-dialog';d.className='rw-dialog finance-report-workspace aw-dialog';d.setAttribute('aria-labelledby','aw-dialog-title');global.document.body.appendChild(d);}d.dataset.scope=key(scope());d.innerHTML='<div class="rw-panel"><div class="rw-panel-head"><h2 id="aw-dialog-title">'+h(title)+'</h2>'+button('關閉','close')+'</div>'+body+'</div>';d.showModal();return d;}
  function field(label,name,value,type){return '<label>'+h(label)+'<input name="'+h(name)+'" type="'+h(type||'text')+'" value="'+h(value||'')+'" maxlength="2000"></label>';}
  function select(label,name,value,options){return '<label>'+h(label)+'<select name="'+h(name)+'">'+options.map(function(x){return '<option value="'+h(x[0])+'"'+(x[0]===value?' selected':'')+'>'+h(x[1])+'</option>';}).join('')+'</select></label>';}
  function textarea(label,name,value){return '<label>'+h(label)+'<textarea name="'+h(name)+'" rows="3" maxlength="2000">'+h(value||'')+'</textarea></label>';}
  function sourceOptions(record){var out=[];[['invoice','invoices'],['expense_request','expense_requests']].forEach(function(x){record.sources[x[1]].forEach(function(r){out.push({key:x[0]+':'+r.id,sourceType:x[0],sourceId:r.id,label:(x[0]==='invoice'?'發票 ':'申請 ')+(r.no||r.id)+' · '+(r.desc||r.purpose||r.tL||'')+' · '+money(r.total==null?r.amt:r.total)});});});return out;}
  function renderLinks(d,record){var links=d.__links||[],options=sourceOptions(record),box=d.querySelector('#aw-linked-sources');box.innerHTML=links.map(function(link,index){var found=options.find(function(o){return o.sourceType===link.sourceType&&o.sourceId===link.sourceId;});return '<div class="aw-link"><span>'+h(found?found.label:'來源待重新讀取')+'</span>'+(record.caseRecord.canEdit?button('移除','remove-source','data-index="'+index+'"'):'')+'</div>';}).join('')||'<p class="rw-muted">尚未連結來源單據</p>';}
  function showItem(id){var record=recordNow(),item=(record.caseRecord.caseData.items||{})[id]||{},template=record.model.items.find(function(i){return i.id===id;});if(!template)throw new Error('查帳項目不存在。');var canEdit=record.caseRecord.canEdit===true;
    var users=[['','未指派']].concat(runtime.users().filter(function(u){return u.active!==false;}).map(function(u){return [u.id,u.n||u.id];}));
    var form='<p>'+h(template.description||'')+'</p>'+badge(template.effectiveStatus)+'<form data-aw-form="item" data-item="'+h(id)+'"><fieldset '+(!canEdit?'disabled':'')+'><div class="rw-form">'+select('負責人','ownerId',item.ownerId||'',users)+field('提供期限','dueDate',item.dueDate,'date')+select('適用性','applicability',item.applicability||'unknown',[['unknown','待確認'],['applicable','適用'],['not_applicable','不適用（需理由與覆核）']])+'</div>'+textarea('佐證資料位置／檔名與版本','evidenceReference',item.evidenceReference)+textarea('查核說明、差異或不適用理由','notes',item.notes)+'<details class="rw-details"><summary>連結系統內來源單據</summary><p class="rw-muted">原始附件請在來源單據中檢視；這裡保存單據索引，不會複製附件。</p><div class="aw-source-picker"><label>搜尋來源單號或目的<input type="search" name="aw-link-query" placeholder="輸入單號或目的"></label><label>選擇来源<select name="sourcePick"><option value="">請選擇</option>'+sourceOptions(record).map(function(o){return '<option value="'+h(o.key)+'">'+h(o.label)+'</option>';}).join('')+'</select></label>'+button('加入來源','add-source')+'</div></details></fieldset><div id="aw-linked-sources"></div>';
    if(canEdit)form+='<div class="rw-form">'+select('本次處理','status',item.status==='reviewed'?'reviewed':item.status||'pending',[['pending','儲存待辦'],['provided','資料已提供，交內部覆核'],['reviewed','完成內部覆核']])+field('本次修改／覆核理由（必填）','reason','')+'</div><p class="rw-muted">完成內部覆核須由不同於資料準備人的授權同仁操作；內容有修改時，須先保存再交另一人覆核。</p><button type="submit" class="rw-button primary">保存紀錄</button>';
    form+='<p role="status" aria-live="polite"></p></form><p class="rw-muted">準備人：'+h(userName(item.preparedBy))+'；內部覆核人：'+h(item.reviewedBy?userName(item.reviewedBy):'尚未覆核')+'</p>';
    var d=dialog(id+' '+template.title,form);d.__record=record;d.__links=copy(item.sourceLinks||[]);renderLinks(d,record);
  }
  function showSettings(){var record=recordNow(),data=record.caseRecord.caseData,canEdit=record.caseRecord.canEdit===true;
    var d=dialog('查帳案件設定',notice('受查法人與期間採用報表上方的選擇。法律形式、適用報導架構及實際委任範圍，請依公司文件與會計師約定填寫。')+'<form data-aw-form="settings"><fieldset '+(!canEdit?'disabled':'')+'><div class="rw-form">'+select('準備項目','engagementType',data.engagementType||'both',[['both','財務報表簽證＋所得稅簽證'],['financial','財務報表簽證'],['tax','所得稅簽證']])+field('法律形式','legalForm',data.legalForm)+field('受委任會計師／事務所','auditorName',data.auditorName)+field('委任書／範圍文件索引','engagementReference',data.engagementReference)+'</div>'+field('修改理由（必填）','reason','')+'</fieldset>'+(canEdit?'<button type="submit" class="rw-button primary">保存設定</button>':'')+'<p role="status" aria-live="polite"></p></form>');d.__record=record;
  }
  async function submit(event){var form=event.target.closest('[data-aw-form]');if(!form)return;event.preventDefault();if(form.dataset.running==='true')return;
    var d=form.closest('dialog'),s=copy(scope()),token=identity(),dv=dialogVersion,record=d.__record,status=form.querySelector('[role=status]');
    if(d.dataset.scope!==key(s)||!record||record.caseRecord.canEdit!==true){status.textContent='目前身分或公司期間已變更，請重新開啟。';return;}
    var values={};new FormData(form).forEach(function(v,k){values[k]=String(v);});if(!String(values.reason||'').trim()){status.textContent='請填寫本次修改或覆核理由。';return;}
    form.dataset.running='true';var submitButton=form.querySelector('button[type=submit]');submitButton.disabled=true;
    try{var data=copy(record.caseRecord.caseData);if(form.dataset.awForm==='settings'){['engagementType','legalForm','auditorName','engagementReference'].forEach(function(k){data[k]=values[k]||null;});}else{var id=form.dataset.item,item=copy(data.items[id]||{});Object.assign(item,{ownerId:values.ownerId||null,dueDate:values.dueDate||null,evidenceReference:values.evidenceReference||'',notes:values.notes||'',applicability:values.applicability,status:values.status,sourceLinks:copy(d.__links||[])});data.items[id]=item;}
      if(form.dataset.awForm==='item'&&values.status==='reviewed')data.items[form.dataset.item].reviewedFingerprint=record.caseRecord.sourceFingerprint;
      var result=await rpc('finance_audit_case_save_v1',Object.assign(readArgs(s),{p_expected_revision:record.caseRecord.revision,p_expected_source_fingerprint:record.caseRecord.sourceFingerprint,p_case_data:data,p_reason:values.reason.trim()}));
      if(token!==identity()||dv!==dialogVersion||d.dataset.scope!==key(scope()))return;
      status.textContent='已保存案件版本 '+result.revision+'，正在重新核對。';await load(s,true);if(token!==identity()||dv!==dialogVersion)return;closeDialog();repaint(s);
    }catch(error){if(token===identity()&&dv===dialogVersion)status.textContent=(error.message||'保存未完成')+'；請保留填寫內容，重新核對後再試。';}
    finally{delete form.dataset.running;submitButton.disabled=false;}
  }
  function filename(s,ext){return (entityName(s.eid)+'_'+s.period+'_會計師查帳資料').replace(/[\\/:*?"<>|\r\n]/g,'_')+'.'+ext;}
  async function exportData(kind){var s=copy(scope()),token=identity();await load(s,true);if(token!==identity()||!active(s))throw new Error('身分或報表範圍已變更，請重新匯出。');var record=recordNow();
    if(kind==='xlsx'){if(!global.XLSX)throw new Error('Excel 匯出元件尚未載入。');var sheets=global.FinanceAuditReadinessEngine.workbookSheets(record.model).concat(global.FinanceFinancialStatements.exportSheets(record.input.statementModel)),wb=global.XLSX.utils.book_new(),used={};sheets.forEach(function(sheet){var name=sheet.name.slice(0,31),base=name,i=2;while(used[name])name=base.slice(0,27)+' '+i++;used[name]=true;var ws=global.XLSX.utils.aoa_to_sheet(sheet.rows);ws['!cols']=[{wch:30},{wch:34},{wch:26},{wch:26},{wch:26},{wch:26}];global.XLSX.utils.book_append_sheet(wb,ws,name);});global.XLSX.writeFile(wb,filename(s,'xlsx'));return;}
    var payload={schemaVersion:1,kind:'audit-preparation-source-index',scope:{entityId:s.eid,period:s.period,dataEnvironment:runtime.environment()},generatedAt:new Date().toISOString(),sourceObservedAt:record.loadedAt,sourceFingerprint:record.caseRecord.sourceFingerprint,caseRevision:record.caseRecord.revision,sourceCounts:record.caseRecord.sourceCounts,caseData:record.caseRecord.caseData,controls:record.model.controls,ledger:record.input.ledger,limitation:'來源索引及查帳準備資料，未包含附件檔案內容；不是封存、查核報告或申報完成證明。'};
    var canonical=JSON.stringify(payload),digest=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));if(token!==identity()||!active(s))throw new Error('報表範圍已變更，請重新匯出。');
    var content=JSON.stringify({payload:payload,payloadSha256:Array.from(new Uint8Array(digest)).map(function(n){return n.toString(16).padStart(2,'0');}).join('')},null,2),url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'})),a=global.document.createElement('a');a.href=url;a.download=filename(s,'json');a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  async function action(event){var node=event.target.closest('[data-aw-action]');if(!node)return;var a=node.dataset.awAction,d=node.closest('dialog');if(a==='close'){closeDialog();return;}if(d&&d.dataset.scope!==key(scope()))throw new Error('身分或期間已變更，請重新開啟。');
    if(a==='reload'){await load(copy(scope()),true);repaint(scope());}
    else if(a==='section'){state.section=node.dataset.section;state.page=0;repaint(scope());}
    else if(a==='filter'){state.filter=state.filter==='attention'?'all':'attention';repaint(scope());}
    else if(a==='item')showItem(node.dataset.item);
    else if(a==='settings')showSettings();
    else if(a==='export-xlsx'||a==='export-json'){if(node.dataset.running)return;node.dataset.running='true';node.disabled=true;try{await exportData(a==='export-xlsx'?'xlsx':'json');}finally{node.disabled=false;delete node.dataset.running;}}
    else if(a==='add-source'){var val=d.querySelector('[name=sourcePick]').value,source=sourceOptions(d.__record).find(function(x){return x.key===val;});if(source&&!d.__links.some(function(x){return x.sourceType===source.sourceType&&x.sourceId===source.sourceId;}))d.__links.push({sourceType:source.sourceType,sourceId:source.sourceId});renderLinks(d,d.__record);}
    else if(a==='remove-source'){d.__links.splice(Number(node.dataset.index),1);renderLinks(d,d.__record);}
    else if(a==='source-page'){state.page+=Number(node.dataset.delta);repaint(scope());}
    else if(a==='ledger'){var row=recordNow().input.ledger.find(function(r){return String(r.id)===node.dataset.ledger;});if(row){closeDialog();runtime.openLedger(row);}}
    else if(a==='control-sources'){var record=recordNow(),control=record.model.controls.find(function(c){return c.id===node.dataset.control;}),ids=control&&control.sourceIds||[],rows=record.input.ledger.filter(function(r){return ids.includes(r.id);});if(control&&control.id==='C09'){var invoices=record.sources.invoices.filter(function(i){return ids.includes(i.id);});dialog(control.title,table(['單號','摘要','來源'],invoices.map(function(i){return [i.no||i.id,i.desc||i.buyer||'',{html:button('查看發票','invoice','data-invoice="'+h(i.id)+'"')}];})));}else global.FinanceReportingWorkspace.openSourceRows(rows,0,control.title);}
    else if(a==='invoice'){var invoice=recordNow().sources.invoices.find(function(i){return i.id===node.dataset.invoice;});if(invoice){closeDialog();runtime.openInvoice(invoice.id);}}
    else if(a==='history'){var s=copy(scope()),token=identity(),dv=dialogVersion,data=await rpc('finance_audit_case_history_v1',readArgs(s));if(token!==identity()||!active(s)||dv!==dialogVersion)return;var rows=Array.isArray(data)?data:data.rows||data.history||[];dialog('查帳資料修改歷程',notice('顯示最近 100 筆修改原因與具名人員。歷史版本保留原樣，來源變更不會回寫舊紀錄。')+table(['版本','時間','人員','原因'],rows.map(function(r){return [r.revision,r.createdAt,userName(r.actorId),r.reason];})));}
  }
  function change(event){if(event.target.name==='aw-source-query'){state.query=event.target.value;state.page=0;repaint(scope());}else if(event.target.name==='aw-link-query'){var d=event.target.closest('dialog'),q=event.target.value.toLowerCase(),select=d.querySelector('[name=sourcePick]');select.innerHTML='<option value="">請選擇</option>'+sourceOptions(d.__record).filter(function(o){return o.label.toLowerCase().includes(q);}).map(function(o){return '<option value="'+h(o.key)+'">'+h(o.label)+'</option>';}).join('');}}
  function install(r){if(runtime)throw new Error('Audit workspace already installed');runtime=r;global.document.addEventListener('click',function(e){action(e).catch(function(error){dialog('操作未完成',notice(error.message||'請重新讀取後再試。',true));});});global.document.addEventListener('submit',submit);global.document.addEventListener('change',change);}
  global.FinanceAuditWorkspace={install:install,view:view,load:load,state:state,invalidate:function(){sync();epoch++;records.clear();versions.clear();operations.clear();closeDialog();}};
})(typeof window!=='undefined'?window:globalThis);
