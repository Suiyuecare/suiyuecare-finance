(function(global){
 'use strict';
 var dialog=null,trigger=null,queueKey='',queuePending=null,operations=new Map();
 var labels={open:'待出納／會計查核',responded:'已回覆，待本人確認',resolved:'疑義已解決'};
 var actionLabels={report:'回報收款疑義',respond:'送出查核回覆',resolve:'確認疑義已解決'};
 function rt(){return global.FinanceApprovalRuntime;}
 function identity(){var r=rt(),u=r&&r.S.user||{};return r?[r.currentTenantId(),r.activeDataEnvironment(),u.id,u.authUserId||'',r.permissionIdentity()].join('|'):'';}
 function allowed(expected){var r=rt();return !!(r&&r.S.user&&!r.S.demoLogin&&r.hasSupabase()&&!r.isIdentityBlocked()&&identity()===expected);}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 async function rpc(name,args,expected){
  if(!allowed(expected))throw Error('登入身分或權限已變更，請以本人帳號重新開啟。');
  var timer;try{
   var result=await Promise.race([rt().getSb().rpc(name,args),new Promise(function(_,reject){timer=setTimeout(function(){reject(Error('連線逾時，結果尚待確認。請使用原動作重試確認。'));},15000);})]);
   if(!allowed(expected))throw Error('登入身分或權限已變更，已停止顯示先前資料。');
   if(result.error)throw result.error;
   if(!result.data||result.data.ok!==true)throw Error('尚未取得完整處理結果，請重試確認。');
   return result.data;
  }finally{clearTimeout(timer);}
 }
 function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}if(trigger&&trigger.isConnected)trigger.focus();}
 async function open(id){
  var expected=identity();if(!allowed(expected)){alert('請以本人正式帳號登入後查看收款疑義。');return;}
  close();trigger=document.activeElement;
  var node=document.createElement('dialog');dialog=node;node.className='payment-concern-dialog';node.setAttribute('data-finance-approval-dialog','payment-concern');node.setAttribute('aria-labelledby','payment-concern-title');
  node.innerHTML='<header><h2 id="payment-concern-title">收款疑義與回覆</h2><button type="button" data-close class="btn-g">關閉</button></header><p>回報不會重複付款，也不會替你確認收到款項。出納或會計可在「簽核管理 → 收款疑義」查核回覆。</p><p data-feedback role="status" aria-live="polite">正在讀取…</p><div data-body></div>';
  document.body.appendChild(node);node.querySelector('[data-close]').onclick=close;node.addEventListener('cancel',function(e){e.preventDefault();close();});node.showModal();
  var key=expected+'|'+id,body=node.querySelector('[data-body]'),feedback=node.querySelector('[data-feedback]');
  async function load(){
   if(!allowed(expected)||!node.isConnected)return;
   var text=body.querySelector('textarea'),draft=text&&text.value;
   try{
    var data=await rpc('finance_payment_concern_read_v1',{p_request_id:id,p_data_environment:rt().activeDataEnvironment()},expected);
    if(!node.isConnected||!allowed(expected))return;
    var row=data.rows[0],op=operations.get(key),actions=[];
    if(op)actions=[op.args.p_action];
    else if(!row&&data.canReport||row&&row.canReport)actions=['report'];
    else if(row){if(row.canRespond)actions.push('respond');if(row.canResolve)actions.push('resolve');}
    body.innerHTML=(row?'<strong>'+esc(row.requestNo)+' · '+esc(labels[row.status]||row.status)+'</strong><ol class="payment-concern-history">'+row.history.map(function(h){return '<li><strong>'+esc(actionLabels[h.action]||h.action)+' · '+esc(h.actorName)+'</strong><time>'+esc(new Date(h.at).toLocaleString('zh-TW'))+'</time><p>'+esc(h.message)+'</p></li>';}).join('')+'</ol>':'<p>尚未回報收款疑義。</p>')
     +(actions.length?'<label for="payment-concern-message">說明（必填，最多 2000 字）</label><textarea id="payment-concern-message" maxlength="2000" rows="4" placeholder="例如：尚未收到款項，或實收金額與申請不同"></textarea><div class="payment-concern-actions">'+actions.map(function(a){return '<button type="button" class="btn-p" data-action="'+a+'">'+esc(op?'重試確認原回報結果':actionLabels[a])+'</button>';}).join('')+'</div>':'')
     +'<button type="button" class="btn-g" data-reload>重新讀取回覆</button>';
    feedback.textContent=op?'上一筆結果尚待確認，重試會使用同一筆回報。':'';
    text=body.querySelector('textarea');if(text){text.value=op?op.args.p_message:draft||'';text.disabled=!!op;}
    body.querySelector('[data-reload]').onclick=load;
    body.querySelectorAll('[data-action]').forEach(function(button){button.onclick=async function(){
     if(!allowed(expected)||button.disabled)return;
     var pending=operations.get(key);
     if(!pending){var message=text.value.trim();if(!message){feedback.textContent='請填寫疑義或查核說明。';text.setAttribute('aria-invalid','true');text.focus();return;}
      pending={args:{p_request_id:id,p_action:button.dataset.action,p_message:message,p_expected_version:row?row.version:0,p_operation_id:crypto.randomUUID(),p_data_environment:rt().activeDataEnvironment()}};operations.set(key,pending);}
     if(pending.busy)return;pending.busy=true;text.disabled=true;body.querySelectorAll('button').forEach(function(b){b.disabled=true;});feedback.textContent='正在確認保存結果…';
     try{
      var readyTimer,ready;try{ready=await Promise.race([rt().ensureSupabaseWriteReady('收款疑義'),new Promise(function(_,reject){readyTimer=setTimeout(function(){reject(Object.assign(Error('登入驗證逾時，這次尚未送出回報。請重試。'),{code:'42501'}));},15000);})]);}finally{clearTimeout(readyTimer);}if(!ready.ok)throw Object.assign(Error('登入尚未就緒，請重新驗證後重試。'),{code:'42501'});
      await rpc('finance_payment_concern_action_v1',pending.args,expected);operations.delete(key);
      if(!node.isConnected||!allowed(expected))return;feedback.textContent='已保存收款疑義紀錄。';await load();loadQueue(true);
     }catch(e){
      if(e.code&&['42501','22023','40001','55000','23514'].indexOf(e.code)>-1)operations.delete(key);
      if(!node.isConnected||!allowed(expected))return;
      feedback.textContent=e.message||'暫時無法確認結果，請重試原回報。';
      text.disabled=operations.has(key);body.querySelectorAll('button').forEach(function(b){b.disabled=false;});
      if(operations.has(key))button.textContent='重試確認原回報結果';
     }finally{pending.busy=false;}
    };});
   }catch(e){if(node.isConnected&&allowed(expected)){feedback.textContent=e.message||'讀取失敗';if(!body.querySelector('[data-reload],[data-retry]'))body.insertAdjacentHTML('beforeend','<button type="button" class="btn-g" data-retry>重新讀取</button>');var retry=body.querySelector('[data-retry]');if(retry)retry.onclick=load;}}
  }
  await load();
 }
 async function loadQueue(force){
  var host=document.getElementById('payment-concern-queue'),expected=identity();if(!host)return;
  if(!allowed(expected)){host.replaceChildren();queueKey='';return;}
  if(!force&&queueKey===expected)return queuePending;
  queueKey=expected;
  host.innerHTML='<details class="payment-concern-queue"><summary>收款疑義</summary><div data-queue-body role="status">正在確認待辦…</div></details>';
  var body=host.querySelector('[data-queue-body]');
  queuePending=(async function(){try{
   var data=await rpc('finance_payment_concern_read_v1',{p_request_id:null,p_data_environment:rt().activeDataEnvironment()},expected);
   if(!allowed(expected)||!body.isConnected)return;
   body.innerHTML='<p>目前可查看的未結疑義 '+data.rows.length+' 筆（最多顯示 '+data.limit+' 筆）</p>'+data.rows.map(function(r){return '<button type="button" class="btn-g" data-concern-id="'+esc(r.requestId)+'">'+esc(r.requestNo)+' · '+esc(labels[r.status]||r.status)+'</button>';}).join('')+'<button type="button" class="btn-g" data-refresh>重新整理</button>';
   body.querySelectorAll('[data-concern-id]').forEach(function(b){b.onclick=function(){open(b.dataset.concernId);};});
   body.querySelector('[data-refresh]').onclick=function(){loadQueue(true);};
   if(data.rows.length)host.querySelector('details').open=true;
  }catch(e){if(allowed(expected)&&body.isConnected){queueKey='';body.innerHTML='<p>'+esc(e.message||'疑義待辦讀取失敗')+'</p><button type="button" class="btn-g" data-refresh>重試</button>';body.querySelector('button').onclick=function(){loadQueue(true);};}}
  })();return queuePending;
 }
 global.FinancePaymentConcerns=Object.freeze({open:open,loadQueue:loadQueue});
})(window);
