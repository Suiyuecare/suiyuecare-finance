(function(global){
  'use strict';

  // The adapter must read an authorized, current server snapshot. This panel
  // never advances approvals or records a payment; prepared files stay in memory.
  var MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var INSTANCE_SEQUENCE=0;
  var HISTORY_CUTOFF='2026-09-30T16:00:00Z';
  var HISTORY_WARNING='已付款歷史補檔，勿重複匯款。此檔依目前保存的核定資料重建，並非當時實際送銀行的原始檔。';
  var PURPOSE_REASONS={not_pending_cashier:'此單尚未到出納付款關卡，完成前段核准後會自動產製。',waiting_approval:'此單尚未完成前段核准，到達出納付款關卡後會自動產製。',before_history_cutoff:'此單送出時間早於本次歷史補檔範圍。',history_before_cutoff:'此單送出時間早於本次歷史補檔範圍。',workflow_changed:'單據關卡已更新，請重新開啟單據確認。',request_cancelled:'此單已取消，不產製匯款檔。',request_rejected:'此單已駁回，不產製匯款檔。',cancelled_or_rejected:'此單已取消或駁回，不產製匯款檔。',transaction_not_supported:'此單據不是可產製銀行匯款檔的付款申請。',electronic_labor_separate_flow:'電子勞報依獨立的簽署與付款流程處理。',payment_method_not_bank:'此單未明確指定銀行轉帳，不產製銀行匯款檔。',historical_payment_unconfirmed:'尚未取得可確認的出納付款紀錄，不能產製已付款歷史檔。',historical_source_changed:'付款後資料曾異動，尚無足夠的當時付款明細可重建歷史檔。'};
  Object.assign(PURPOSE_REASONS,{waiting_for_cashier:'此單尚未到出納付款關卡，完成前段核准後會自動產製。',export_unavailable:'此單目前不符合匯款檔產製條件，請核對原單狀態與付款資料。',historical_before_cutoff:'此單送出時間早於本次歷史補檔範圍。',historical_submission_unverified:'無法確認正式送出時間，尚不能產製歷史檔。',historical_status_invalid:'此單目前狀態不符合歷史補檔條件。',historical_correction_unsupported:'付款後曾有金額更正，需核對當時逐筆付款資料，不能直接重建歷史檔。',historical_cashier_unverified:'尚未取得可確認的出納核准紀錄，不能產製已付款歷史檔。',historical_payment_unverified:'尚未取得可確認的出納付款紀錄，不能產製已付款歷史檔。',historical_principal_missing:'尚未取得當時已撥款的本金，不能以現在申請金額代替。',historical_cash_mismatch:'目前明細與已保存的出納付款金額不一致，請核對原始付款資料。',historical_workflow_invalid:'尚無完整且一致的已付款簽核紀錄，不能重建歷史檔。',historical_fee_missing:'尚未取得當時已存手續費，無法確認已撥款本金。'});
  var FIELD_LABELS={name:'收款戶名',identityNo:'身分證號',bankCode:'銀行代號',account:'收款帳號',amount:'付款金額',totalAmount:'付款總額',expectedTotal:'核定匯款總額',principalAmount:'核定付款本金',cashAmount:'出納已付總額',bankFeeAmount:'已存手續費',hrPaymentTotal:'人事實發合計',rows:'付款明細',mode:'匯款格式',stage:'目前關卡',status:'目前關卡',file:'Excel 檔案',row:'付款明細',payDate:'預計匯款日期',entityId:'付款法人',requestId:'正式單號',hrItem:'人事費用類別',supplements:'收款補充資料',method:'退費方式',engine:'格式檢核工具'};
  var ISSUE_LABELS={
    text_required:'尚未填寫。',text_type_required:'須保留文字格式及前導 0。',text_too_long:'超過 Excel 可保留的長度。',text_invalid_unicode:'文字編碼不完整。',text_control_characters:'含有無法匯入的控制字元。',
    amount_invalid:'必須是正整數。',amount_excel_precision:'超過 Excel 可精確保留的 15 位整數。',amount_too_long:'薪轉金額最多 13 位整數。',total_unsafe:'總額超過 Excel 可精確保留的範圍。',
    rows_required:'沒有可產製的付款明細。',rows_too_many:'超過 Excel 列數上限。',row_invalid:'資料不完整。',mode_invalid:'尚未指定整批匯款或薪轉。',
    name_or_identity_required:'薪轉姓名與身分證號至少需填一項。',name_too_long:'薪轉戶名超過格式長度。',identity_too_long:'身分證號超過格式長度。',bank_code_invalid:'薪轉需完整 7 位銀行分支代號；兆豐本行可填 017。',account_too_long:'薪轉帳號最多 14 位。',digits_required:'僅能填數字，並保留前導 0。',
    xlsx_unavailable:'產檔工具尚未載入，請重試。',xlsx_generation_failed:'產檔未完成，請重試。',principal_mismatch:'明細合計與已核定的匯款本金不一致，請先核對原單。',expected_total_invalid:'無法確認已核定的匯款本金，請先核對原單。',
    branch_code_invalid:'分行代號須保留完整 4 位文字數字。',bank_type_conflict:'銀行類別與代號不一致，請核對原單。',hr_item_missing:'請確認核定的人事費用類別，以選用正確格式。',hr_item_conflict:'原單的人事費用類別不一致，請核對核定版本。',request_id_missing:'尚未取得正式單據識別碼。',entity_missing:'尚未取得付款法人。',payment_date_missing:'請確認有效的預計匯款日期。',source_rows_missing:'尚未取得完整核定明細，不能僅用總額產檔。',source_row_invalid:'核定明細不完整，請重新讀取。',supplements_invalid:'資料格式不完整，請重新讀取。',supplement_row_invalid:'補充資料不屬於此核定版本。',supplement_duplicate:'同一列有重複補充資料。',cash_row_supplement:'現金項目不能套用銀行補充資料。',refund_method_missing:'請在原單明確指定銀行轉帳或現金退款。',supplement_name_conflict:'補充戶名與原單不一致，請重新核對。',supplement_bank_conflict:'補充代號與原單銀行不同，請重新核對。',hr_total_mismatch:'核定實發合計與逐列匯款金額不同。',no_bank_rows:'沒有可產製的銀行轉帳明細。',bank_engine_missing:'格式檢核工具尚未載入，請重試。'
  };
  Object.keys(PURPOSE_REASONS).forEach(function(code){if(!ISSUE_LABELS[code])ISSUE_LABELS[code]=PURPOSE_REASONS[code];});

  function installStyles(document){
    if(document.getElementById('finance-mega-remittance-styles'))return;
    var style=document.createElement('style');
    style.id='finance-mega-remittance-styles';
    style.textContent='.finance-mega-remittance{min-width:0;width:100%;font-family:var(--font-sans);color:#334155;text-align:left}.finance-mega-remittance .mega-body{padding:14px;display:grid;gap:12px;min-width:0}.finance-mega-remittance .mega-summary{font-weight:600;line-height:1.6;overflow-wrap:anywhere}.finance-mega-remittance .mega-note{margin:0;color:#64748b;font-size:13px;line-height:1.65;overflow-wrap:anywhere}.finance-mega-remittance .mega-actions{display:flex;flex-wrap:wrap;gap:8px}.finance-mega-remittance button{min-height:44px!important;max-width:100%;white-space:normal;line-height:1.5}.finance-mega-remittance button:focus-visible,.finance-mega-remittance input:focus-visible{outline:3px solid var(--br,#ea880c);outline-offset:2px}.finance-mega-remittance button:disabled{opacity:.6;cursor:wait}.finance-mega-remittance .mega-issues{margin:0;padding-left:22px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.finance-mega-remittance .mega-banner{margin:0;padding:10px 12px;border-radius:8px;background:var(--brxxl,#fff8ed);color:#7a4500;font-size:13px;line-height:1.6}.finance-mega-remittance .mega-fields{display:grid;gap:12px;border:1px solid #eedfc8;border-radius:8px;padding:12px;min-width:0}.finance-mega-remittance .mega-fields legend{padding:0 4px;font-size:13px;font-weight:600}.finance-mega-remittance .mega-field{display:grid;gap:6px;min-width:0;font-size:13px}.finance-mega-remittance .mega-field input{box-sizing:border-box;min-width:0;width:100%;min-height:44px;padding:8px 10px;border:1px solid #e0d0b8;border-radius:8px;font:inherit;color:inherit;background:#fff}.finance-mega-remittance .mega-supplements{display:grid;gap:12px;min-width:0}.finance-mega-remittance .mega-status{font-size:12px;max-width:100%;white-space:normal}.finance-mega-remittance .mega-heading{margin:0;font-size:14px;font-weight:600}.finance-mega-remittance .mega-body[aria-busy=true]{cursor:progress}';
    (document.head||document.documentElement).appendChild(style);
  }
  function positiveInteger(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=999999999999999;}
  function safeCount(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;}
  function safeIssue(issue){
    issue=issue&&typeof issue==='object'?issue:{};
    return {row:positiveInteger(issue.row)?issue.row:null,field:Object.prototype.hasOwnProperty.call(FIELD_LABELS,issue.field)?issue.field:'row',code:Object.prototype.hasOwnProperty.call(ISSUE_LABELS,issue.code)?issue.code:'unknown'};
  }
  function copyIssues(issues){return Array.isArray(issues)?issues.map(safeIssue):[];}
  function versionPresent(version){return (typeof version==='string'&&version.length>0)||(typeof version==='number'&&Number.isSafeInteger(version)&&version>=0);}
  function safeId(id){return typeof id==='string'&&id.length>0&&id.length<=200;}
  function sourceKey(snapshot){return String(snapshot.sourceVersion)+'|'+snapshot.sourceDigest;}
  function isHistoricalSnapshot(snapshot){
    return snapshot.exportPurpose==='historical'&&snapshot.sourceBasis==='current_saved_reconstruction'&&snapshot.submissionSource==='server_created_at'&&snapshot.historyCutoff===HISTORY_CUTOFF&&typeof snapshot.submittedAt==='string'&&Number.isFinite(Date.parse(snapshot.submittedAt))&&Date.parse(snapshot.submittedAt)>=Date.parse(HISTORY_CUTOFF)&&typeof snapshot.paidAt==='string'&&Number.isFinite(Date.parse(snapshot.paidAt))&&['cancelled','rejected','draft','pending_cashier'].indexOf(snapshot.stage)<0;
  }
  function filename(snapshot){
    var no=typeof snapshot.requestNo==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(snapshot.requestNo)?'_'+snapshot.requestNo:'';
    return (snapshot.exportPurpose==='historical'?'已付款_歷史補檔_勿重複匯款_':'')+'兆豐_'+(snapshot.mode==='payroll'?'薪轉':'整批匯款')+no+'.xlsx';
  }
  function create(options){
    options=options||{};
    if(typeof options.identityKey!=='function'||typeof options.readSnapshot!=='function'||typeof options.ensureXlsx!=='function')throw new Error('mega_ui_callbacks_required');
    var document=options.document||global.document;
    if(!document||typeof document.createElement!=='function')throw new Error('mega_ui_document_required');
    var buildXlsx=options.buildXlsx||(global.FinanceMegaRemittance&&global.FinanceMegaRemittance.buildXlsx);
    if(typeof buildXlsx!=='function')throw new Error('mega_ui_engine_required');
    installStyles(document);
    var instanceId=++INSTANCE_SEQUENCE;
    var container=null,recordId='',epoch=0,activeController=null,prepared=null,supplements=[],draftValues={},draftDigest='',sourceDigest='',operationIdentity='',status='idle',busy=false,issues=[],banner='',count=0,total=null,mode='',excludedCount=0,lastError='',focusAction='',urlTimers=[],context=null,fieldSequence=0,exportPurpose='',reasonCode='',historyAckKey='',paidAt='';
    var timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>=10?Math.min(options.timeoutMs,120000):20000;

    function identity(){try{var key=options.identityKey();return typeof key==='string'?key:'';}catch(error){return '';}}
    function discardPrepared(){if(prepared&&prepared.bytes&&typeof prepared.bytes.fill==='function')prepared.bytes.fill(0);prepared=null;}
    function cancel(){epoch++;if(activeController)activeController.abort();activeController=null;busy=false;}
    function clear(){
      cancel();discardPrepared();supplements=[];draftValues={};draftDigest='';sourceDigest='';operationIdentity='';recordId='';issues=[];banner='';count=0;total=null;mode='';excludedCount=0;lastError='';context=null;focusAction='';status='idle';exportPurpose='';reasonCode='';historyAckKey='';paidAt='';
      urlTimers.forEach(function(item){global.clearTimeout(item.timer);global.URL.revokeObjectURL(item.url);});urlTimers=[];
      if(container)container.replaceChildren();container=null;
    }
    function current(token){
      if(token.epoch!==epoch||!container||recordId!==token.recordId)return false;
      if(!token.identity||identity()!==token.identity){clear();return false;}
      if(!container.isConnected){clear();return false;}
      return true;
    }
    function begin(nextStatus){
      cancel();operationIdentity=identity();
      if(!operationIdentity){clear();return null;}
      activeController=typeof global.AbortController==='function'?new global.AbortController():null;
      var token={epoch:epoch,recordId:recordId,identity:operationIdentity,signal:activeController?activeController.signal:undefined};
      busy=true;status=nextStatus;lastError='';render();return token;
    }
    function deadline(factory,token){
      return new Promise(function(resolve,reject){
        var done=false;
        function finish(error,value){if(done)return;done=true;global.clearTimeout(timer);if(token.signal)token.signal.removeEventListener('abort',aborted);if(error)reject(error);else resolve(value);}
        function aborted(){finish(new Error('mega_cancelled'));}
        var timer=global.setTimeout(function(){if(done)return;finish(new Error('mega_timeout'));if(activeController&&token.epoch===epoch)activeController.abort();},timeoutMs);
        if(token.signal){if(token.signal.aborted){aborted();return;}token.signal.addEventListener('abort',aborted,{once:true});}
        Promise.resolve().then(function(){if(done)return;return factory();}).then(function(value){finish(null,value);},function(){finish(new Error('mega_read_failed'));});
      });
    }
    function node(tag,className,text){var item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;}
    function money(amount){return 'NT$'+Number(amount).toLocaleString('en-US');}
    function button(text,action,primary){
      var item=node('button',primary?'btn-p':'btn-s',text);item.type='button';item.dataset.megaAction=action;item.disabled=busy||(action==='download'&&exportPurpose==='historical'&&(!prepared||historyAckKey!==prepared.key));
      item.addEventListener('click',function(){focusAction=action;if(action==='download')download();else refresh();});return item;
    }
    function summaryText(){return (mode==='payroll'?'薪轉':'整批匯款')+' · '+count+' 筆 · '+money(total);}
    function render(){
      if(!container)return;
      var oldFocus=document.activeElement;
      var restoreFocus=oldFocus&&container.contains(oldFocus)?oldFocus.dataset.megaAction||focusAction:'';
      var card=node('section','card finance-mega-remittance');card.setAttribute('aria-label','兆豐匯款檔');card.dataset.megaState=status;
      var head=node('div','chd'),title=node('h3','cht mega-heading','兆豐匯款檔'),badge=node('span','badge mega-status '+(status==='ready'?'b-ok':status==='error'?'b-rej':'b-wait'));
      badge.textContent=status==='ready'&&exportPurpose==='historical'?'已付款 · 歷史補檔':({loading:'讀取中',preparing:'產製中',checking:'重新核對中',saving:'儲存中',ready:'已備妥',missing:'待補齊資料',waiting:'等待前段核准',unavailable:'不適用',ineligible:'尚未產製',denied:'無法存取',error:'未完成'}[status]||'尚未產製');
      badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');head.append(title,badge);card.appendChild(head);
      var body=node('div','mega-body');body.setAttribute('aria-busy',busy?'true':'false');
      if(exportPurpose==='historical'){
        var warning=node('p','mega-banner',HISTORY_WARNING);warning.dataset.megaHistoryWarning='true';body.appendChild(warning);
        if(paidAt)body.appendChild(node('p','mega-note','出納付款紀錄：'+new Date(paidAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})));
      }
      if(banner)body.appendChild(node('p','mega-banner',banner));
      if(total!==null&&count>0)body.appendChild(node('div','mega-summary',summaryText()));
      if(context){
        body.appendChild(node('p','mega-note','付款法人：'+context.entity+' · 預計匯款日期：'+context.date));
        body.appendChild(node('p','mega-note','手續費：'+context.feeBearer+(context.companyFee!==null?' · 公司手續費 '+money(context.companyFee):'')+(exportPurpose==='historical'?'。歷史核對用途，不可重複匯款。':'。匯入時依原單確認付款日期與手續費負擔。')));
      }
      if(excludedCount>0)body.appendChild(node('p','mega-note','另有 '+excludedCount+' 筆現金項目，不列入匯款檔。'));
      var description={loading:'正在讀取已核定的匯款資料…',preparing:'正在依兆豐格式產生 Excel…',checking:'正在重新核對身分、關卡與最新付款資料…',saving:'正在儲存補充資料並重新產製…',ready:exportPurpose==='historical'?'下載前會重新核對權限與來源。請先確認下方歷史檔用途。':'下載前會重新核對最新資料。此檔案依提供的兆豐格式產製，仍須由銀行系統檢核及執行匯款。',missing:'請先補齊以下資料；完整核對通過後才會產生整份檔案。',waiting:PURPOSE_REASONS[reasonCode]||'此單尚未到出納付款關卡，完成前段核准後會自動產製。',unavailable:PURPOSE_REASONS[reasonCode]||'此單目前不符合匯款檔產製條件，請核對原單狀態與付款資料。',ineligible:'此單目前不符合產製條件，尚未產生匯款檔。',denied:'目前無法取得此單的匯款資料，請確認登入身分與存取權限。',error:lastError==='mega_timeout'?'讀取逾時，尚未產生可下載的檔案。請重試。':'匯款檔準備未完成，原申請資料保留。請重試。'}[status];
      if(description)body.appendChild(node('p','mega-note',description));
      if(issues.length){
        var list=node('ul','mega-issues');
        issues.slice(0,20).forEach(function(issue){list.appendChild(node('li','',(issue.row?'第 '+issue.row+' 筆 · ':'')+FIELD_LABELS[issue.field]+'：'+(ISSUE_LABELS[issue.code]||'資料尚未完整或不符合格式，請核對原單。')));});
        if(issues.length>20)list.appendChild(node('li','','另有 '+(issues.length-20)+' 項待確認，請先核對付款明細。'));
        body.appendChild(list);
      }
      if(status==='missing'&&supplements.length&&typeof options.saveSupplement==='function')body.appendChild(supplementForm());
      if(status==='ready'&&exportPurpose==='historical'){
        var ackLabel=node('label','mega-history-ack'),ack=node('input');ack.type='checkbox';ack.checked=!!prepared&&historyAckKey===prepared.key;ack.disabled=busy;ack.dataset.megaAction='history-ack';
        ackLabel.style.cssText='display:flex;align-items:center;gap:10px;min-height:44px;line-height:1.6;cursor:pointer';ack.style.cssText='width:20px;height:20px;flex:none;margin:0';
        ack.addEventListener('change',function(){historyAckKey=ack.checked&&prepared?prepared.key:'';var downloadButton=container.querySelector('[data-mega-action="download"]');if(downloadButton)downloadButton.disabled=busy||!historyAckKey;});
        ackLabel.append(ack,node('span','','已知為已付款歷史檔，不會再次送銀行匯款'));body.appendChild(ackLabel);
      }
      var actions=node('div','mega-actions');
      if(status==='ready'||status==='checking')actions.appendChild(button(busy?'重新核對中…':exportPurpose==='historical'?'下載歷史 Excel':'下載 Excel','download',true));
      if(!busy&&status!=='denied'&&status!=='ineligible'&&status!=='unavailable')actions.appendChild(button(status==='ready'?'重新產製':status==='waiting'?'重新確認':'重試','refresh',false));
      if(actions.childNodes.length)body.appendChild(actions);
      card.appendChild(body);container.replaceChildren(card);
      if(!restoreFocus&&!busy&&focusAction&&document.activeElement===document.body)restoreFocus=focusAction;
      if(restoreFocus){var replacement=container.querySelector('[data-mega-action="'+restoreFocus+'"]');if(!replacement&&restoreFocus==='supplement')replacement=container.querySelector('[data-mega-action="download"],[data-mega-action="refresh"]');if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
    }
    function supplementForm(){
      var form=node('form','mega-supplements');form.setAttribute('aria-label','補充匯款資料');form.noValidate=true;
      form.appendChild(node('p','mega-note','可在此補上缺少的戶名或銀行代號；付款帳號與核定金額維持原單資料。'));
      supplements.forEach(function(row){
        var fields=node('fieldset','mega-fields');fields.appendChild(node('legend','','第 '+row.row+' 筆匯款資料'));
        if(row.account||row.amount!==null)fields.appendChild(node('p','mega-note','核定收款帳號：'+(row.account||'待確認')+(row.amount!==null?' · 金額 '+money(row.amount):'')));
        row.fields.forEach(function(field){
          var group=node('div','mega-field'),label=node('label','',FIELD_LABELS[field]),input=node('input');input.type='text';input.autocomplete='off';input.required=true;input.maxLength=field==='bankCode'?7:78;
          input.name=row.rowKey+'|'+field;input.dataset.rowKey=row.rowKey;input.dataset.field=field;
          var help=node('span','mega-note'),helpId='mega-input-help-'+instanceId+'-'+(++fieldSequence)+'-'+epoch;help.id=helpId;help.setAttribute('aria-live','polite');input.setAttribute('aria-describedby',helpId);input.setAttribute('aria-invalid','false');
          input.id=helpId+'-input';label.htmlFor=input.id;
          input.value=draftValues[input.name]||'';input.addEventListener('input',function(){draftValues[input.name]=input.value;draftDigest=sourceDigest;help.textContent='';input.setAttribute('aria-invalid','false');});
          if(field==='bankCode'){input.inputMode='numeric';input.pattern='[0-9]{3}|[0-9]{7}';}
          group.append(label,input,help);fields.appendChild(group);
        });form.appendChild(fields);
      });
      var submit=node('button','btn-p','儲存並重新產製');submit.type='submit';submit.dataset.megaAction='supplement';submit.disabled=busy;form.appendChild(submit);
      form.addEventListener('submit',function(event){
        event.preventDefault();if(busy)return;var firstInvalid=null,inputs=Array.from(form.querySelectorAll('input'));
        inputs.forEach(function(input){
          var value=input.value,message='';
          if(!value.trim())message='請填寫'+FIELD_LABELS[input.dataset.field]+'。';
          else if(input.dataset.field==='bankCode'&&!(mode==='payroll'?/^(017|[0-9]{7})$/:/^([0-9]{3}|[0-9]{7})$/).test(value))message=mode==='payroll'?'請填完整 7 位銀行分支代號；兆豐本行可填 017。':'請填 3 位銀行代號或完整 7 位銀行分支代號。';
          else if(input.dataset.field==='name'&&(/[\u0000-\u001f\u007f\ufffe\uffff]/.test(value)||Array.from(value).some(function(c){var code=c.codePointAt(0);return code>=0xd800&&code<=0xdfff;})||Array.from(value).reduce(function(sum,c){return sum+(c.codePointAt(0)<=127?1:2);},0)>78))message='戶名最多 39 個中文字或 78 個英數字，且不能含無效字元。';
          input.setAttribute('aria-invalid',message?'true':'false');var help=document.getElementById(input.getAttribute('aria-describedby'));if(help)help.textContent=message;if(message&&!firstInvalid)firstInvalid=input;
        });
        if(firstInvalid){firstInvalid.focus();return;}
        var rows=supplements.map(function(row){var result={rowKey:row.rowKey};row.fields.forEach(function(field){var input=inputs.find(function(item){return item.dataset.rowKey===row.rowKey&&item.dataset.field===field;});result[field]=input?input.value:'';});return result;});focusAction='supplement';saveSupplement(rows);
      });
      return form;
    }
    function takeSupplements(snapshot){
      if(snapshot.canSupplement!==true||!Array.isArray(snapshot.supplementRows)||typeof options.saveSupplement!=='function')return [];
      var seen={};return snapshot.supplementRows.slice(0,100).reduce(function(result,row){
        if(!row||typeof row.rowKey!=='string'||!/^(hr|refund|payment):[1-9][0-9]*$/.test(row.rowKey)||!positiveInteger(row.row)||seen[row.rowKey])return result;
        var fields=Array.isArray(row.fields)?row.fields.filter(function(field,index,all){return (field==='name'||field==='bankCode')&&all.indexOf(field)===index;}):[];
        if(fields.length){seen[row.rowKey]=true;result.push({rowKey:row.rowKey,row:row.row,fields:fields,account:typeof row.account==='string'&&/^[0-9]{1,100}$/.test(row.account)?row.account:'',amount:positiveInteger(row.amount)?row.amount:null});}return result;
      },[]);
    }
    function acceptSnapshot(snapshot,token){
      if(!current(token))return false;
      count=0;total=null;context=null;excludedCount=0;
      if(!snapshot||snapshot.authorized!==true){status='denied';discardPrepared();issues=[];supplements=[];draftValues={};mode='';exportPurpose='';historyAckKey='';paidAt='';reasonCode='';return false;}
      var purpose=snapshot.exportPurpose;
      reasonCode=Object.prototype.hasOwnProperty.call(PURPOSE_REASONS,snapshot.reasonCode)?snapshot.reasonCode:'';
      if(purpose!==exportPurpose){historyAckKey='';paidAt='';}
      exportPurpose=['payment','historical','waiting','unavailable'].indexOf(purpose)>-1?purpose:'';
      if(snapshot.eligible!==true||(purpose==='payment'&&snapshot.stage!=='pending_cashier')||(purpose==='historical'&&!isHistoricalSnapshot(snapshot))||['payment','historical'].indexOf(purpose)<0){
        status=purpose==='waiting'?'waiting':'unavailable';discardPrepared();issues=[];supplements=[];draftValues={};mode='';historyAckKey='';paidAt='';return false;
      }
      if(snapshot.requestId!==recordId||!versionPresent(snapshot.sourceVersion)||typeof snapshot.sourceDigest!=='string'||snapshot.sourceDigest.length===0)throw new Error('mega_snapshot_invalid');
      if(historyAckKey&&historyAckKey!==sourceKey(snapshot))historyAckKey='';
      paidAt=purpose==='historical'?snapshot.paidAt:'';
      if((sourceDigest&&sourceDigest!==snapshot.sourceDigest)||(draftDigest&&draftDigest!==snapshot.sourceDigest)){draftValues={};draftDigest='';}
      sourceDigest=snapshot.sourceDigest;mode=snapshot.mode;issues=copyIssues(snapshot.issues);supplements=takeSupplements(snapshot);
      if(snapshot.ok===false&&!issues.length)issues.push({row:null,field:'rows',code:'source_rows_missing'});
      context={entity:typeof snapshot.entityLabel==='string'&&snapshot.entityLabel.trim()?snapshot.entityLabel.slice(0,160):'待確認',date:typeof snapshot.paymentDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(snapshot.paymentDate)?snapshot.paymentDate:'待確認',feeBearer:['己方支出','對方支出'].indexOf(snapshot.feeBearer)>-1?snapshot.feeBearer:'待確認',companyFee:typeof snapshot.companyFee==='number'&&Number.isSafeInteger(snapshot.companyFee)&&snapshot.companyFee>=0?snapshot.companyFee:null};
      excludedCount=Array.isArray(snapshot.excludedRows)?snapshot.excludedRows.length:safeCount(snapshot.excludedCount);
      if(!positiveInteger(snapshot.expectedTotal))issues.push({row:null,field:'expectedTotal',code:'expected_total_invalid'});
      if(issues.length){status='missing';discardPrepared();return false;}
      return true;
    }
    async function prepare(snapshot,token){
      if(!acceptSnapshot(snapshot,token))return null;
      status='preparing';render();
      var library=await deadline(function(){return options.ensureXlsx();},token);
      if(!current(token))return null;
      var generated=await deadline(function(){return buildXlsx({mode:snapshot.mode,rows:snapshot.rows},library);},token);
      if(!current(token))return null;
      if(!generated||generated.ok!==true){status='missing';issues=copyIssues(generated&&generated.issues);if(!issues.length)issues=[{row:null,field:'file',code:'xlsx_generation_failed'}];discardPrepared();return null;}
      var summary=generated.summary||{};
      if(!positiveInteger(summary.paymentCount)||!positiveInteger(summary.totalAmount)||summary.mode!==snapshot.mode||!Array.isArray(snapshot.rows)||summary.paymentCount!==snapshot.rows.length||summary.totalAmount!==snapshot.expectedTotal){
        if(generated.bytes&&typeof generated.bytes.fill==='function')generated.bytes.fill(0);
        status='missing';issues=[{row:null,field:'expectedTotal',code:'principal_mismatch'}];discardPrepared();return null;
      }
      if(!(generated.bytes instanceof Uint8Array)||generated.bytes.length<4||generated.bytes[0]!==0x50||generated.bytes[1]!==0x4b)throw new Error('mega_file_invalid');
      return {key:sourceKey(snapshot),bytes:generated.bytes,filename:filename(snapshot),mode:snapshot.mode,exportPurpose:snapshot.exportPurpose,paymentCount:summary.paymentCount,totalAmount:summary.totalAmount};
    }
    function setPrepared(result){discardPrepared();prepared=result;count=result.paymentCount;total=result.totalAmount;mode=result.mode;issues=[];supplements=[];draftValues={};draftDigest='';status='ready';}
    function failed(error,token){if(!current(token))return;discardPrepared();supplements=[];sourceDigest='';issues=[];count=0;total=null;mode='';excludedCount=0;context=null;historyAckKey='';paidAt='';exportPurpose='';status='error';lastError=error&&error.message==='mega_timeout'?'mega_timeout':'mega_failed';}
    async function refresh(){
      if(!container||!recordId||busy)return false;
      banner='';count=0;total=null;excludedCount=0;context=null;issues=[];supplements=[];historyAckKey='';discardPrepared();
      var token=begin('loading');if(!token)return false;
      try{var snapshot=await deadline(function(){return options.readSnapshot(token.recordId,{signal:token.signal});},token);if(!current(token))return false;var result=await prepare(snapshot,token);if(result&&current(token))setPrepared(result);}
      catch(error){failed(error,token);}
      finally{if(current(token)){busy=false;render();}}
      return status==='ready';
    }
    function defaultSave(bytes,metadata){
      var blob=new global.Blob([bytes],{type:MIME}),url=global.URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=metadata.filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();
      var item={url:url,timer:global.setTimeout(function(){global.URL.revokeObjectURL(url);urlTimers=urlTimers.filter(function(value){return value!==item;});},1000)};urlTimers.push(item);
    }
    async function download(){
      if(busy||status!=='ready'||!prepared||(exportPurpose==='historical'&&historyAckKey!==prepared.key))return false;
      var oldKey=prepared.key,oldCount=prepared.paymentCount,oldTotal=prepared.totalAmount,oldMode=prepared.mode,oldPurpose=prepared.exportPurpose;
      banner='';var token=begin('checking');if(!token)return false;
      try{
        var snapshot=await deadline(function(){return options.readSnapshot(token.recordId,{signal:token.signal});},token);if(!current(token))return false;
        var result=await prepare(snapshot,token);if(!result||!current(token))return false;
        var changed=oldKey!==result.key||oldCount!==result.paymentCount||oldTotal!==result.totalAmount||oldMode!==result.mode||oldPurpose!==result.exportPurpose;setPrepared(result);
        if(changed){banner='資料已更新，請核對最新筆數與總額後，再按下載。';return false;}
        if(result.exportPurpose==='historical'&&historyAckKey!==result.key)return false;
        if(!current(token))return false;
        await deadline(function(){return (options.saveBytes||defaultSave)(result.bytes,{filename:result.filename,mime:MIME,requestId:token.recordId,sourceDigest:snapshot.sourceDigest,signal:token.signal});},token);
        if(!current(token))return false;banner='檔案已交由瀏覽器下載，請確認下載清單。';return true;
      }catch(error){failed(error,token);return false;}
      finally{if(current(token)){busy=false;render();}}
    }
    async function saveSupplement(rows){
      if(busy||status!=='missing'||!supplements.length||typeof options.saveSupplement!=='function')return false;
      var expectedDigest=sourceDigest;banner='';var token=begin('saving');if(!token)return false;
      try{
        var snapshot=await deadline(function(){return options.readSnapshot(token.recordId,{signal:token.signal});},token);if(!current(token))return false;
        if(!snapshot||snapshot.authorized!==true||snapshot.eligible!==true||!((snapshot.exportPurpose==='payment'&&snapshot.stage==='pending_cashier')||isHistoricalSnapshot(snapshot))||snapshot.requestId!==recordId||snapshot.canSupplement!==true){status='denied';supplements=[];draftValues={};count=0;total=null;mode='';excludedCount=0;context=null;historyAckKey='';exportPurpose='';paidAt='';return false;}
        if(snapshot.sourceDigest!==expectedDigest){banner='資料已更新，請重新確認尚缺的匯款資料。';var changedResult=await prepare(snapshot,token);if(changedResult&&current(token))setPrepared(changedResult);return false;}
        var saved=await deadline(function(){return options.saveSupplement(token.recordId,expectedDigest,rows,{signal:token.signal});},token);if(!current(token))return false;
        if(!saved||saved.ok!==true)throw new Error('mega_supplement_failed');
        var fresh=await deadline(function(){return options.readSnapshot(token.recordId,{signal:token.signal});},token);if(!current(token))return false;
        var result=await prepare(fresh,token);if(result&&current(token)){setPrepared(result);banner='補充資料已儲存，匯款檔已重新產製。';}return !!result;
      }catch(error){failed(error,token);return false;}
      finally{if(current(token)){busy=false;render();}}
    }
    function mount(target,id){
      clear();if(!target||typeof target.replaceChildren!=='function'||!safeId(id))return Promise.resolve(false);
      container=target;recordId=id;status='idle';return refresh();
    }
    // Only non-sensitive state is exposed for host integration and acceptance tests.
    function getState(){return {status:status,busy:busy,paymentCount:count,totalAmount:total,mode:mode,issueCount:issues.length,hasFile:!!prepared,exportPurpose:exportPurpose,historyAcknowledged:!!prepared&&historyAckKey===prepared.key};}
    return Object.freeze({mount:mount,refresh:refresh,clear:clear,download:download,getState:getState});
  }
  var api=Object.freeze({create:create});global.FinanceMegaRemittanceUI=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
