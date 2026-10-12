(function(root){
  'use strict';
  var runtime=null,owner='',receiptOwner='',epoch=0,active={},pending={},cursor=null,rows=[],busy=false,error='',notice='',saveTasks={};
  var RECEIPT_PREFIX='finance-cloud-draft-receipts-v1:';
  function h(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fail(message,code){var e=new Error(message);e.code=code;return e;}
  function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canonical(v[k]);}).join(',')+'}';return JSON.stringify(v);}
  function clone(v){return JSON.parse(JSON.stringify(v,function(_key,item){if((typeof Blob!=='undefined'&&item instanceof Blob)||(typeof item==='string'&&/^(?:blob:|data:[^,]*,)/i.test(item)))throw fail('本機檔案尚未上傳，不能標示為雲端保存。','UNSAVED_FILE');return item;}));}
  function store(){try{return runtime.storage||root.sessionStorage;}catch(_){return null;}}
  function receiptKey(){return RECEIPT_PREFIX+encodeURIComponent(receiptOwner);}
  function receipt(p){return {action:p.action,id:p.id,revision:p.revision,kind:p.kind,environment:p.environment,fingerprint:p.fingerprint,operationKey:p.operationKey||null};}
  function persist(){var storage=store();if(!storage)throw fail('無法保留這次草稿識別，請允許此分頁的儲存空間後再試。','RECEIPT_STORAGE');var value={};Object.keys(pending).forEach(function(k){value[k]=receipt(pending[k]);});storage.setItem(receiptKey(),JSON.stringify(value));}
  function loadReceipts(){var storage=store();if(!storage)return;try{var value=JSON.parse(storage.getItem(receiptKey())||'{}');['invoice','bill'].forEach(function(kind){var p=value[kind];if(p&&p.kind===kind&&/^[a-z0-9-]{1,80}$/i.test(p.id)&&Number.isSafeInteger(p.revision)&&p.revision>=0&&/^[a-f0-9]{64}$/.test(p.fingerprint)&&['save','reopen'].indexOf(p.action)>=0&&p.environment===runtime.environment())pending[kind]=receipt(p);});}catch(_){/* Corrupt receipts are not authority to create a different draft. */}}
  function current(){var next=runtime&&runtime.identity()||'',stable=runtime&&(runtime.ownerKey?runtime.ownerKey():next)||'';if(next!==owner||stable!==receiptOwner){owner=next;receiptOwner=stable;epoch++;active={};pending={};saveTasks={};cursor=null;rows=[];busy=false;error='';notice='';if(owner&&receiptOwner)loadReceipts();}return next;}
  function scope(){return {owner:current(),epoch:epoch};}
  function sameScope(token){return current()===token.owner&&epoch===token.epoch;}
  function assert(token){if(!token.owner||current()!==token.owner||epoch!==token.epoch)throw fail('登入身分已變更，未顯示或還原其他帳號的資料。','CLIENT_IDENTITY_CHANGED');}
  async function fingerprint(kind,environment,payload,files){var text=canonical({kind:kind,environment:environment,payload:payload,files:files||[]});var bytes=new TextEncoder().encode(text),digest=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}
  async function matches(data,p){return data&&data.id===p.id&&data.documentType===p.kind&&data.dataEnvironment===p.environment&&data.state!=='discarded'&&await fingerprint(p.kind,p.environment,data.payload,data.files)===p.fingerprint;}
  function removePending(kind){delete pending[kind];persist();}
  function clearCommitted(kind,id){if(active[kind]&&active[kind].id===id)delete active[kind];if(pending[kind]&&pending[kind].id===id)removePending(kind);}
  function updateRow(data){var i=rows.findIndex(function(r){return r.id===data.id;});if(i>=0)rows[i]=data;else rows.unshift(data);}
  function view(kind){current();if(!runtime||!owner)return '';var labels={draft:'已保存草稿',staging:'分段保存中',ready:'等待整筆送出',committed:'已送出',discarded:'已刪除'},disabled=busy?'disabled':'';
    return '<section class="card finance-cloud-drafts" data-cloud-kind="'+h(kind)+'" aria-busy="'+busy+'"><div class="cloud-head"><div><h3>我的雲端草稿與送件</h3><p>關閉分頁或換裝置後，可讀取本人原稿。只有核對完成的檔案才標示已保存。</p></div><div class="cloud-actions"><button type="button" class="btn-s" data-cloud-action="save" '+disabled+'>'+(pending[kind]?'確認上次草稿':'保存目前草稿')+'</button><button type="button" class="btn-s" data-cloud-action="list" '+disabled+'>讀取雲端記錄</button></div></div><p role="status" aria-live="polite" class="cloud-status">'+h(error||notice||(pending[kind]?'上次草稿結果尚待確認，將沿用原筆識別查詢。':''))+'</p>'+(rows.length?'<div class="cloud-table-scroll"><table><thead><tr><th>事由／更新時間</th><th>狀態</th><th>進度</th><th>操作</th></tr></thead><tbody>'+rows.filter(function(r){return r.documentType===kind;}).map(function(r){return '<tr><td>'+h(r.title||'未填事由')+'<small>'+h(r.updatedAt)+'</small></td><td>'+h(labels[r.state]||r.state)+'</td><td>'+h(r.stagedCount||0)+' / '+h(r.expectedCount||0)+'</td><td><button type="button" class="btn-s" data-cloud-action="open" data-cloud-id="'+h(r.id)+'" '+disabled+'>'+(r.state==='draft'?'還原草稿':'確認原筆結果')+'</button>'+(['staging','ready'].indexOf(r.state)>=0?' <button type="button" class="btn-s" data-cloud-action="reopen" data-cloud-id="'+h(r.id)+'" '+disabled+'>回到草稿修正</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'')+(cursor?'<button type="button" class="btn-s" data-cloud-action="more" '+disabled+'>讀取較早記錄</button>':'')+'</section>';
  }
  function paint(){if(runtime)runtime.paint(view);}
  async function list(more){if(busy)return;var token=scope();busy=true;error='';paint();try{var data=await runtime.client.list(runtime.environment(),more?cursor:null,50);assert(token);rows=more?rows.concat(data.rows):data.rows;cursor=data.nextCursor||null;notice=rows.length?'已讀取本人雲端記錄。':'目前沒有雲端記錄。';}catch(e){if(sameScope(token))error=e.message;}finally{if(sameScope(token)){busy=false;paint();}}}
  async function confirmSave(p,token){
    persist();
    var data;
    if(p.request){
      try{data=await runtime.client.reconcileSave(p.request);}catch(e){assert(token);if(e.code==='CLIENT_IDENTITY_CHANGED')throw e;data=await runtime.client.save(p.request);}
    }else{
      // After a reload only a non-sensitive receipt survives. Never reconstruct
      // a different request under the old UUID from whatever is now on screen.
      try{data=await runtime.client.read(p.id,p.environment);}catch(e){
        assert(token);var captured=await runtime.capture(p.kind);assert(token);
        if(await fingerprint(p.kind,p.environment,captured.payload,captured.files||[])!==p.fingerprint)throw fail('上次草稿尚未查回；目前內容不同，請先讀取原筆雲端記錄。系統未另建草稿。','PENDING_DRAFT_DIFFERENT');
        p.request={id:p.id,revision:p.revision,kind:p.kind,environment:p.environment,payload:clone(captured.payload),files:clone(captured.files||[])};
        data=await runtime.client.save(p.request);
      }
    }
    assert(token);if(!await matches(data,p))throw fail('雲端版本與上次完整內容不同，請讀取雲端記錄核對，系統未覆寫。','PT409');assert(token);return data;
  }
  async function saveWork(kind){var token=scope();if(busy)throw fail('請先等目前操作確認完成。','BUSY');busy=true;error='';paint();try{
    var p=pending[kind];
    if(p&&p.action==='reopen')return await reopenWork(p.id,kind,token,p);
    if(!p){var captured=await runtime.capture(kind);assert(token);var prior=active[kind];if(prior&&prior.state!=='draft')throw fail('請先確認原筆結果，或回到草稿修正。','DRAFT_STATE');
      var request={id:prior?prior.id:root.crypto.randomUUID(),revision:prior?prior.revision:0,kind:kind,environment:runtime.environment(),payload:clone(captured.payload),files:clone(captured.files||[])};
      p={action:'save',id:request.id,revision:request.revision,kind:kind,environment:request.environment,fingerprint:await fingerprint(kind,request.environment,request.payload,request.files),request:request,unsavedFiles:captured.unsavedFiles||0};assert(token);pending[kind]=p;persist();
      var data=await runtime.client.save(request);
    }else data=await confirmSave(p,token);
    assert(token);if(!await matches(data,p))throw fail('雲端回執與本次草稿不符，請確認原筆結果。','PT409');assert(token);
    active[kind]=data;updateRow(data);removePending(kind);
    var currentCapture=await runtime.capture(kind);assert(token);var unchanged=await fingerprint(kind,p.environment,currentCapture.payload,currentCapture.files||[])===p.fingerprint;assert(token);
    if(unchanged&&!(currentCapture.unsavedFiles||p.unsavedFiles)&&runtime.saved)runtime.saved(kind,data);
    notice='雲端已確認保存第 '+data.revision+' 版。'+(!unchanged?'目前表單另有變更，請再次保存。':'')+((currentCapture.unsavedFiles||p.unsavedFiles)?'本機選檔尚未上傳，換裝置時須重新選取。':'');return data;
  }catch(e){if(sameScope(token))error=e.message;throw e;}finally{if(sameScope(token)){busy=false;paint();}}}
  function save(kind){current();if(saveTasks[kind])return saveTasks[kind];var task=saveWork(kind);saveTasks[kind]=task;task.then(function(){if(saveTasks[kind]===task)delete saveTasks[kind];},function(){if(saveTasks[kind]===task)delete saveTasks[kind];});return task;}
  async function restore(kind,data,token){await runtime.restore(kind,data.payload&&data.payload.ui,data);assert(token);active[kind]=data;updateRow(data);if(pending[kind]&&pending[kind].id===data.id)removePending(kind);notice='已還原第 '+data.revision+' 版；請核對內容與附件後送出。';}
  async function acceptReopened(kind,previous,data,token){
    if(runtime.reopened)await runtime.reopened(kind,previous,data);assert(token);
    // The old operation is already cancelled on the server. Retire its receipt
    // before restoring so newly typed fields cannot trap a confirmed reopen.
    active[kind]=data;updateRow(data);if(pending[kind]&&pending[kind].id===data.id)removePending(kind);
    await restore(kind,data,token);return data;
  }
  async function reopenWork(id,kind,token,p){
    var previous=await runtime.client.read(id,runtime.environment());assert(token);if(previous.documentType!==kind)throw fail('草稿類型與目前表單不同。','DRAFT_KIND');
    if(previous.state==='committed'){var shown=await runtime.showResult(kind,previous);assert(token);clearCommitted(kind,id);notice=shown&&shown.displayPending?'原筆已正式送出，無法回到草稿；列表暫未更新，請稍後重新整理。':'原筆已正式送出，無法回到草稿，已查回原筆結果。';return previous;}
    if(typeof runtime.beforeRestore!=='function')throw fail('草稿修正檢查尚未就緒，請重新整理。','RESTORE_GUARD');
    if(p){if(!await matches(previous,p))throw fail('雲端內容已改變，請先重新讀取。','PT409');assert(token);
      if(previous.state==='draft'&&previous.revision===p.revision+1&&previous.operationKey==='cloud_'+kind+'_'+id+'_'+previous.revision){
        return await acceptReopened(kind,{id:id,revision:p.revision,operationKey:p.operationKey},previous,token);
      }
      if(previous.revision!==p.revision||previous.operationKey!==p.operationKey)throw fail('草稿版本已改變，請先重新讀取。','PT409');
    }
    await runtime.beforeRestore(kind,previous.payload&&previous.payload.ui,previous);assert(token);
    if(['staging','ready'].indexOf(previous.state)<0)throw fail('這筆目前不能回到草稿；請確認原筆結果。','DRAFT_STATE');
    if(!p){p={action:'reopen',id:id,revision:previous.revision,kind:kind,environment:previous.dataEnvironment,operationKey:previous.operationKey,fingerprint:await fingerprint(kind,previous.dataEnvironment,previous.payload,previous.files)};assert(token);pending[kind]=p;persist();}
    var data=await runtime.client.reopen(previous);assert(token);
    if(data.state!=='draft'||data.id!==previous.id||data.revision!==previous.revision+1||data.operationKey!=='cloud_'+kind+'_'+id+'_'+data.revision||!await matches(data,p))throw fail('草稿修正結果尚未確認，請確認原筆結果。','PT409');assert(token);
    return await acceptReopened(kind,previous,data,token);
  }
  async function reopen(id,kind){var token=scope();if(busy)return;busy=true;error='';paint();try{if(pending[kind]&&pending[kind].id!==id)throw fail('另一筆草稿結果尚待確認，請先確認上次草稿。','PENDING_DRAFT');return await reopenWork(id,kind,token,pending[kind]&&pending[kind].action==='reopen'?pending[kind]:null);}catch(e){if(sameScope(token))error=e.message;throw e;}finally{if(sameScope(token)){busy=false;paint();}}}
  async function open(id,kind){var token=scope();if(busy)return;busy=true;error='';paint();try{if(pending[kind]&&pending[kind].id!==id)throw fail('另一筆草稿結果尚待確認，請先確認上次草稿。','PENDING_DRAFT');if(pending[kind]&&pending[kind].action==='reopen')return await reopenWork(id,kind,token,pending[kind]);var data=await runtime.client.read(id,runtime.environment());assert(token);if(data.documentType!==kind)throw new Error('草稿類型與目前表單不同。');if(data.state==='draft'){await restore(kind,data,token);}else if(data.state==='committed'){var shown=await runtime.showResult(kind,data);assert(token);clearCommitted(kind,data.id);notice=shown&&shown.displayPending?'原筆已正式送出；列表暫未更新，請稍後重新整理，無須再次送件。':'已查回原筆正式結果，沒有另建單據。';}else if(data.state==='staging'||data.state==='ready'){var resumed=await runtime.resume(kind,data);assert(token);clearCommitted(kind,data.id);notice=resumed&&resumed.displayPending?'原筆已正式送出；列表暫未更新，請稍後重新整理，無須再次送件。':'原筆資料已送出並確認。';}else throw new Error('這筆草稿目前不可還原。');}catch(e){if(sameScope(token))error=e.message;}finally{if(sameScope(token)){busy=false;paint();}}}
  var installed=false;
  function install(r){runtime=r;current();if(root.document&&!installed){installed=true;root.document.addEventListener('click',async function(event){var b=event.target.closest&&event.target.closest('[data-cloud-action]');if(!b||busy)return;var section=b.closest('[data-cloud-kind]');if(!section)return;var kind=section.dataset.cloudKind;try{if(b.dataset.cloudAction==='save')await save(kind);else if(b.dataset.cloudAction==='list')await list(false);else if(b.dataset.cloudAction==='more')await list(true);else if(b.dataset.cloudAction==='open')await open(b.dataset.cloudId,kind);else if(b.dataset.cloudAction==='reopen')await reopen(b.dataset.cloudId,kind);}catch(_){/* Inline status keeps the form visible. */}});}}
  var api={install:install,view:view,save:save,list:list,open:open,reopen:reopen,active:function(kind){current();return active[kind]||null;},committed:function(kind,id){current();clearCommitted(kind,id);},invalidate:function(){owner='';receiptOwner='';epoch++;active={};pending={};saveTasks={};rows=[];cursor=null;},progress:function(p){current();notice=p.phase==='committing'?'內容已完整保存，正在確認整筆結果…':p.phase==='committed'?'整筆送件已確認。':'雲端明細已保存 '+p.saved+' / '+p.total+'，未建立部分單據。';paint();}};
  root.FinanceCloudDraftWorkspace=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
