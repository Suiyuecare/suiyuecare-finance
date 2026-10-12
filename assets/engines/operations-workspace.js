(function(root){
  'use strict';
  var METRICS=['bootstrap','list','search','upload','download','submission','sync'];
  var OUTCOMES=['ok','error','timeout','aborted'];
  var runtime=null,observer=null,owner='',generation=0,record=null,busy=false,error='';
  function h(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function uuid(){if(root.crypto&&root.crypto.randomUUID)return root.crypto.randomUUID();throw new Error('此瀏覽器缺少安全事件識別碼。');}
  function errorOutcome(error){
    try{
      var candidate=error,aborted=false,seen=[];
      for(var depth=0;candidate&&depth<4&&seen.indexOf(candidate)<0;depth++){
        seen.push(candidate);
        var code=String(candidate.code||'').toUpperCase(),name=String(candidate.name||''),message=typeof candidate==='string'?candidate:String(candidate.message||''),status=Number(candidate.status||candidate.statusCode||0);
        if(['CLIENT_TIMEOUT','FINANCE_READ_TIMEOUT','PGRST003','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].indexOf(code)>=0||name==='TimeoutError'||status===408||status===504)return 'timeout';
        if(['FINANCE_RESULT_UNKNOWN','CLOUD_RESULT_UNKNOWN'].indexOf(code)>=0&&(candidate.timedOut===true||candidate.timeout===true))return 'timeout';
        if((!code||code==='57014'||code==='FINANCE_RESULT_UNKNOWN'||code==='CLOUD_RESULT_UNKNOWN'&&candidate.resultUnknown===true)&&/\b(?:timeout|timed out|deadline exceeded)\b|逾時/i.test(message))return 'timeout';
        if(name==='AbortError'||code==='CLIENT_CANCELLED'||code==='57014'&&/canceling statement due to user request/i.test(message))aborted=true;
        candidate=candidate.cause||candidate.error;
      }
      return aborted?'aborted':'error';
    }catch(_){return 'error';}
  }
  function resultOutcome(result){try{return result&&result.error?errorOutcome(result.error):result===false||result&&result.ok===false?'error':'ok';}catch(_){return 'error';}}
  function create(options){
    var queue=[],scope='',sending=null,timer=null,lastFlush=0;
    var now=options.now||Date.now,clock=options.clock||now;
    function sync(){var next=options.identity();if(next!==scope){scope=next;queue=[];lastFlush=0;}return next;}
    function elapsed(start){try{return clock()-start;}catch(_){return NaN;}}
    function add(metric,duration,outcome,expected){
      if(typeof expected!=='string'||!expected||!sync()||scope!==expected||METRICS.indexOf(metric)<0||OUTCOMES.indexOf(outcome)<0||!Number.isFinite(duration)||duration<0)return false;
      queue.push({eventId:uuid(),metric:metric,durationMs:Math.min(3600000,Math.round(duration)),outcome:outcome,measuredAt:new Date(now()).toISOString()});
      queue=queue.slice(-100);if(!timer)timer=root.setTimeout(function(){timer=null;flush().catch(function(){});},Math.max(1000,60000-(now()-lastFlush)));return true;
    }
    // Caller captures the full permission/auth epoch at the start of a UI action.
    // Missing or obsolete identities cannot adopt another actor's current scope.
    // Telemetry failure must never change an already-completed business result.
    function recordSample(metric,duration,outcome,expected){try{return add(metric,duration,outcome,expected);}catch(_){return false;}}
    async function flush(){
      var token=sync();if(!token||!queue.length)return {ok:true,inserted:0};if(sending)return sending;
      var rows=queue.slice(0,50),ids=new Set(rows.map(function(x){return x.eventId;})),environment=options.environment();lastFlush=now();
      sending=(async function(){try{var result=await options.rpc('finance_operation_samples_save_v1',{p_data_environment:environment,p_samples:rows});if(result&&result.error)throw result.error;var data=result&&Object.prototype.hasOwnProperty.call(result,'data')?result.data:result;if(!data||data.ok!==true)throw new Error('維運紀錄尚未確認保存。');if(sync()===token)queue=queue.filter(function(x){return !ids.has(x.eventId);});return data;}finally{sending=null;}})();return sending;
    }
    async function measure(metric,operation){var token='',start;try{token=sync();start=clock();}catch(_){}var result;try{result=await operation();}catch(err){recordSample(metric,elapsed(start),errorOutcome(err),token);throw err;}recordSample(metric,elapsed(start),resultOutcome(result),token);return result;}
    return {measure:measure,record:recordSample,flush:flush,pending:function(){sync();return queue.map(function(x){return Object.assign({},x);});},invalidate:function(){scope='';queue=[];if(timer){root.clearTimeout(timer);timer=null;}}};
  }
  function current(){var next=runtime&&runtime.identity()||'';if(next!==owner){owner=next;generation++;record=null;busy=false;error='';}return next;}
  function button(text,action,attrs){return '<button type="button" class="btn-s" data-fo-action="'+action+'" '+(attrs||'')+'>'+h(text)+'</button>';}
  function summary(label,value){return '<div class="fo-summary"><span>'+h(label)+'</span><strong>'+h(value)+'</strong></div>';}
  function view(){
    current();if(!runtime||!runtime.canView())return '';
    var metrics=record&&record.operations&&record.operations.metrics||[],alerts=record&&record.operations&&record.operations.alerts||[],identity=record&&record.identity||{},events=identity.events||[],info=identity.summary||{};
    var labels={bootstrap:'資料載入',list:'列表',search:'搜尋',upload:'上傳',download:'下載',submission:'送件',sync:'同步'};
    var html='<section class="health-flat-section finance-operations"><div class="health-flat-head"><div><div class="health-flat-title">維運與人員同步</div><p class="health-flat-subtitle">查看實際操作耗時與跨模組回應；紀錄僅含角色、類型、耗時與結果。</p></div>'+button(busy?'正在讀取…':'讀取維運狀態','load',busy?'disabled':'')+'</div><div aria-live="polite">'+(error?'<p class="fo-error" role="alert">'+h(error)+'</p>':'')+'</div>';
    if(!record)return html+'<p class="fo-empty">按「讀取維運狀態」取得最近資料。尚未取得證據時不顯示正常。</p></section>';
    html+='<div class="fo-summaries">'+summary('eDoc 等待同步',info.pending==null?'未取得':info.pending)+summary('eDoc 同步失敗',info.failed==null?'未取得':info.failed)+summary('未確認告警',alerts.filter(function(x){return !x.acknowledged_at;}).length)+'</div>';
    html+='<details open><summary>最近 24 小時的操作觀測</summary><div class="fo-table-scroll"><table><thead><tr><th>操作／角色</th><th>樣本</th><th>p95</th><th>失敗／逾時</th><th>驗收判讀</th></tr></thead><tbody>'+metrics.map(function(x){var target=x.metric==='search'?2000:['bootstrap','list'].indexOf(x.metric)>=0?3000:null;var status=x.success_count<20?'樣本不足':target==null?'依檔案與網路條件判讀':x.p95_ms<=target?'觀測符合目標':'超過目標';return '<tr><td>'+h(labels[x.metric]||x.metric)+' · '+h(x.actor_role)+'</td><td>'+h(x.sample_count)+'</td><td>'+h(x.p95_ms==null?'未取得':x.p95_ms+' ms')+'</td><td>'+h(x.error_count)+' / '+h(x.timeout_count)+'</td><td>'+h(status)+'</td></tr>';}).join('')+'</tbody></table></div>'+(metrics.length?'':'<p class="fo-empty">尚無有效操作樣本。固定資料與網路條件的效能驗收仍須另行執行。</p>')+'</details>';
    html+='<details><summary>故障告警（同一 15 分鐘區間去重）</summary><div class="fo-alerts">'+alerts.map(function(x){return '<article><strong>'+h(labels[x.metric]||x.metric)+' · '+h(x.actor_role)+'</strong><span>'+h(x.bucket)+' · 失敗 '+h(x.failure_count)+' / '+h(x.sample_count)+'</span>'+(x.acknowledged_at?'<small>已確認 '+h(x.acknowledged_at)+'</small>':runtime.canManage('ack')?button('已確認處理','ack','data-bucket="'+h(x.bucket)+'" data-metric="'+h(x.metric)+'" data-role="'+h(x.actor_role)+'"'):'<small>待管理員確認</small>')+'</article>';}).join('')+'</div>'+(alerts.length?'':'<p class="fo-empty">目前讀取範圍內沒有觸發門檻的告警。</p>')+'</details>';
    html+='<details><summary>跨模組人員同步</summary><p class="fo-note">來源事件保留穩定人員識別碼與版本。目標回應不等同已完成真人登入或舊 session 撤銷驗收。</p><div class="fo-table-scroll"><table><thead><tr><th>來源／版本</th><th>狀態</th><th>嘗試</th><th>目標回應</th><th>操作</th></tr></thead><tbody>'+events.map(function(x){return '<tr><td>'+h(x.aggregate_type)+' · '+h(x.aggregate_id)+'<small>版本 '+h(x.source_revision)+'</small></td><td>'+h(x.status)+(x.last_error_code?'<small>'+h(x.last_error_code)+'</small>':'')+'</td><td>'+h(x.attempt_count)+'</td><td>'+h(x.delivered_at||'尚未回應')+(x.response_digest?'<details><summary>回應摘要</summary><code>'+h(x.response_digest)+'</code><p>'+h(x.delivery_outcome||'')+'</p></details>':'')+'</td><td>'+(['failed','dead'].indexOf(x.status)>=0&&runtime.canManage('retry')?button('重試此版本','retry','data-id="'+h(x.id)+'" data-revision="'+h(x.source_revision)+'"'):'—')+'</td></tr>';}).join('')+'</tbody></table></div>'+(events.length===50?'<p class="fo-note">顯示最近 50 筆事件；較早歷史仍保留於伺服器。</p>':'');
    var hr=identity.hrTransport;if(hr)html+='<p class="fo-note">HR 專案傳輸版本 '+h(hr.sourceRevision)+'；回應版本 '+h(hr.acknowledgedRevision)+'；時間 '+h(hr.lastAcknowledgedAt||'未取得')+'。這是傳輸水位，不代表每一位人員已完成對照。</p>';
    return html+'</details></section>';
  }
  async function rpc(name,args){var r=await runtime.rpc(name,args);if(r&&r.error)throw r.error;var d=r&&Object.prototype.hasOwnProperty.call(r,'data')?r.data:r;if(!d||d.ok!==true)throw new Error('維運結果尚未確認。');return d;}
  function paint(){if(runtime&&runtime.paint)runtime.paint(view());}
  async function load(){var token=current(),version=++generation;busy=true;error='';paint();try{var all=await Promise.allSettled([runtime.canObserve()?rpc('finance_operations_read_v1',{p_data_environment:runtime.environment()}):Promise.resolve(null),runtime.canPeople()?rpc('finance_identity_delivery_status_v1',{p_limit:50,p_before:null}):Promise.resolve(null)]);if(current()!==token||version!==generation)return;record={operations:all[0].status==='fulfilled'?all[0].value:null,identity:all[1].status==='fulfilled'?all[1].value:null};error=all.filter(function(x){return x.status==='rejected';}).map(function(x){return x.reason&&x.reason.message||'維運資料讀取失敗';}).join('；');}catch(e){if(current()===token&&generation===version)error=e.message;}finally{if(current()===token&&version===generation){busy=false;paint();}}}
  async function click(event){var target=event.target.closest&&event.target.closest('[data-fo-action]');if(!target||!runtime)return;var action=target.dataset.foAction;if(action==='load')return load();if(['ack','retry'].indexOf(action)<0||busy||!runtime.canManage(action))return;var token=current();busy=true;target.disabled=true;try{if(action==='ack')await rpc('finance_operation_alert_ack_v1',{p_data_environment:runtime.environment(),p_bucket:target.dataset.bucket,p_metric:target.dataset.metric,p_actor_role:target.dataset.role});else if(action==='retry')await rpc('finance_identity_delivery_retry_v1',{p_event_id:target.dataset.id,p_expected_revision:Number(target.dataset.revision)});if(current()===token){busy=false;await load();}}catch(e){if(current()===token){error=e.message||'維運操作失敗';busy=false;paint();}}finally{target.disabled=false;}}
  function install(options){runtime=options;observer=create({rpc:options.rpc,identity:options.identity,environment:options.environment,clock:function(){return root.performance&&root.performance.now?root.performance.now():Date.now();}});if(root.document)root.document.addEventListener('click',click);return observer;}
  var api={create:create,install:install,view:view,load:load,invalidate:function(){owner='';record=null;generation++;if(observer)observer.invalidate();},measure:function(metric,operation){return observer?observer.measure(metric,operation):operation();},record:function(metric,duration,outcome,expected){return observer?observer.record(metric,duration,outcome,expected):false;},errorOutcome:errorOutcome,flush:function(){return observer?observer.flush():Promise.resolve({ok:true,inserted:0});}};
  root.FinanceOperationsWorkspace=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
