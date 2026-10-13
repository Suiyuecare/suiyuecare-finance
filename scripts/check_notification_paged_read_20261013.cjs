// Executes shipped notification loaders, rendering, and actions with fictional
// RLS-scoped transport rows. No production session, data mutation, or auth spoofing.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=source.slice(source.indexOf('function financeNotificationIdentity(){'),source.indexOf('// ══ 人員管理（執行長'));
const timeoutStart=source.indexOf('function withOperationTimeout('),timeoutEnd=source.slice(timeoutStart+1).search(/^function |^async function |^window\.|^var /m)+timeoutStart+1;
const nodes={};let queries=[],rows=[],error=null,pending=null,updateError=null,updates=0;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function table(){
  const q={ors:[],filters:[],orders:[],select(cols,opts){this.opts=opts;return this;},eq(k,v){this.filters.push([k,v]);return this;},or(v){this.ors.push(v);return this;},in(k,v){this.types=v;return this;},is(k,v){this.nullCreated=true;return this;},lt(k,v){this.beforeId=v;return this;},order(k,v){this.orders.push([k,v]);return this;},range(a,b){this.rangeValue=[a,b];return this;},limit(n){this.limitValue=n;return this;},abortSignal(signal){this.signal=signal;return this;},update(v){this.updateValue=v;return this;},then(resolve,reject){
    queries.push(this);
    if(pending)return pending.promise.then(resolve,reject);
    if(this.updateValue){updates++;if(updateError)return Promise.resolve({error:updateError}).then(resolve,reject);rows.forEach(row=>{if(row.allowed&&row.tenant_id==='tenant-a'&&row.data_environment==='production')row.read=true;});return Promise.resolve({error:null}).then(resolve,reject);}
    if(error)return Promise.resolve({data:null,error}).then(resolve,reject);
    let visible=rows.filter(row=>row.allowed&&this.filters.every(([k,v])=>row[k]===v));
    for(const filter of this.ors){
      if(filter.includes('read.eq.false,read.is.null'))visible=visible.filter(row=>row.read!==true);
      if(filter.includes('type.eq.system,type.is.null,type.eq.""'))visible=visible.filter(row=>!row.type||row.type==='system');
      if(filter.includes('created_at.eq.')){
        const match=filter.match(/created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"/);assert.ok(match,'compound keyset predicate');
        visible=visible.filter(row=>row.created_at===null||row.created_at<match[1]||(row.created_at===match[1]&&row.id<match[2]));
      }
    }
    if(this.nullCreated)visible=visible.filter(row=>row.created_at===null&&row.id<this.beforeId);
    if(this.types)visible=visible.filter(row=>this.types.includes(row.type));
    visible.sort((a,b)=>a.created_at===b.created_at?b.id.localeCompare(a.id):a.created_at===null?1:b.created_at===null?-1:b.created_at.localeCompare(a.created_at));
    const count=visible.length;
    if(this.rangeValue)visible=visible.slice(this.rangeValue[0],this.rangeValue[1]+1);
    if(this.limitValue)visible=visible.slice(0,this.limitValue);
    return Promise.resolve({data:visible.map(row=>({...row})),count:this.opts?.count==='exact'?count:null,error:null}).then(resolve,reject);
  }};return q;
}
const ctx={S:{user:{id:'fixture-a',email:'a@example.invalid',authUserId:'auth-a',role:'employee'},page:'dashboard',nT:'all'},financeWorkspaceIdentityBlocked:false,FINANCE_NOTIFICATION_STATE:null,NOTIFS:[],FINANCE_NOTIFICATION_TIMEOUT_MS:100,FINANCE_NOTIFICATION_PAGE_SIZE:40,FINANCE_NOTIFICATION_UNREAD_PAGE_SIZE:400,CURRENT_PERMISSION_SNAPSHOT:{loaded:true,permissions:[{scope:'department-a'}]},ROLE_PERMISSIONS:{employee:{notif:'read'}},currentFinanceAuthUserId:()=>ctx.S.user.authUserId,currentTenantId:()=> 'tenant-a',activeDataEnvironment:()=> 'production',normalizedRoleKey:u=>u.role,
  getSb:()=>({from:name=>{assert.equal(name,'notifications');return table();}}),mapNotif:n=>({...n,read:!!n.read,type:n.type||'system',dataEnv:n.data_environment,tenantId:n.tenant_id}),inActiveDataEnvironment:n=>n.dataEnv==='production'&&n.tenantId==='tenant-a',escAttr:s=>String(s).replace(/</g,'&lt;'),buildDash(){},dbUpdate:async(table,id)=>{if(updateError)return {ok:false,error:updateError};const row=rows.find(row=>row.id===id&&row.allowed);if(!row)return false;row.read=true;return true;},el:id=>nodes[id]||(nodes[id]={textContent:'',innerHTML:'',style:{},setAttribute(k,v){this[k]=v;}}),document:{querySelectorAll:()=>[]},AbortController,setTimeout,clearTimeout,console,Date,Promise};ctx.window=ctx;
vm.createContext(ctx);vm.runInContext(source.slice(timeoutStart,timeoutEnd),ctx);vm.runInContext(section,ctx);
let checks=0;function pass(name){checks++;console.log('PASS '+name);}
function row(i,extra={}){return {id:'n-'+String(i).padStart(5,'0'),created_at:'2026-10-13T03:00:00+00:00',title:'虛構通知 '+i,body:'測試',read:i%2===0,type:i%3===0?'approval':'system',tenant_id:'tenant-a',data_environment:'production',allowed:true,...extra};}
(async()=>{
  rows=Array.from({length:1107},(_,i)=>row(i));rows.push(row(5000,{allowed:false}),row(5001,{tenant_id:'tenant-b'}),row(5002,{data_environment:'test'}));
  await ctx.loadFinanceNotifications();assert.equal(ctx.financeNotificationView().unread,553);assert.equal(ctx.financeNotificationView().rows.length,553);assert.equal(queries.length,2);assert.ok(queries.every(q=>q.ors.includes('read.eq.false,read.is.null')));assert.ok(queries.every(q=>q.opts.count==='exact'));pass('startup reads full exact unread set only, paging below server limit');
  queries=[];await ctx.loadFinanceNotificationHistory();let history=ctx.financeNotificationHistoryState('all');assert.equal(history.rows.length,40);assert.equal(history.hasMore,true);assert.ok(queries.every(q=>!q.opts));assert.ok(nodes['notif-list'].innerHTML.includes('載入更多通知'));assert.equal(nodes['notif-sub'].textContent,'553 則未讀');pass('actual render exposes load more and independent precise unread badge');
  while(history.hasMore)await ctx.loadFinanceNotificationHistory({append:true});assert.equal(history.rows.length,1107);assert.equal(new Set(history.rows.map(x=>x.id)).size,1107);assert.ok(!nodes['notif-list'].innerHTML.includes('載入更多通知'));assert.equal(queries.length,28);assert.ok(queries.every(q=>q.limitValue===41&&!q.opts));pass('entire 1107-item history remains reachable beyond 1000, without all-history count');
  assert.ok(!ctx.NOTIFS.some(x=>['n-05000','n-05001','n-05002'].includes(x.id)));pass('query retains tenant/environment and server-authorized scope');
  ctx.S.nT='approval';await ctx.loadFinanceNotificationHistory();assert.ok(ctx.financeNotificationHistoryState('approval').rows.every(n=>n.type==='approval'));assert.ok(nodes['notif-list'].innerHTML.includes('虛構通知'));pass('tab filter reaches server and actual renderer');
  ctx.S.nT='system';await ctx.loadFinanceNotificationHistory();assert.ok(ctx.financeNotificationHistoryState('system').rows.every(n=>n.type==='system'));pass('system tab preserves mapped null/empty type behavior');
  ctx.S.nT='all';error={code:'57014'};await ctx.loadFinanceNotificationHistory();assert.equal(history.rows.length,1107);assert.equal(history.status,'error');assert.match(nodes['notif-load-status'].innerHTML,/通知紀錄讀取失敗/);assert.equal(ctx.financeNotificationView().unread,553);error=null;pass('history timeout preserves last verified list without false zero or badge loss');
  pending=deferred();const stale=ctx.loadFinanceNotificationHistory();await tick();ctx.S.user={...ctx.S.user,id:'fixture-b',authUserId:'auth-b'};ctx.renderNotifs();assert.equal(nodes['notif-list'].innerHTML,'');assert.equal(ctx.NOTIFS.length,0);pending.resolve({data:[row(9999)],error:null});await stale;pending=null;assert.equal(ctx.NOTIFS.length,0);pass('old identity history response cannot repaint new identity');
  ctx.S.user={...ctx.S.user,id:'fixture-a',authUserId:'auth-a'};await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();error={code:'42501'};await ctx.loadFinanceNotificationHistory();assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,null);assert.equal(nodes['notif-list'].innerHTML,'');error=null;pass('permission denial clears visible history and unread cache immediately');
  await ctx.loadFinanceNotifications();pending=deferred();const lateUnread=ctx.loadFinanceNotifications();await tick();const oldPending=pending;pending=null;error={code:'42501'};await ctx.loadFinanceNotificationHistory();error=null;oldPending.resolve({data:[row(9999,{read:false})],count:1,error:null});await lateUnread;assert.equal(ctx.financeNotificationView().unread,null);assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.FINANCE_NOTIFICATION_STATE.promise,null);pass('parallel late unread response cannot restore content after history permission denial');
  rows=[row(1,{read:false}),row(2,{read:false})];await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();await ctx.markNotifRead('n-00001');assert.equal(ctx.financeNotificationView().unread,1);assert.ok(ctx.financeNotificationHistoryState('all').rows.find(n=>n.id==='n-00001').read);pass('single mark-read rechecks server unread count and updates all cached tabs');
  updateError={code:'500'};assert.equal(await ctx.markAllRead(),false);assert.equal(ctx.financeNotificationView().unread,1);assert.equal(ctx.financeNotificationState().marking,false);updateError=null;await ctx.loadFinanceNotifications();
  ctx.S.page='notif';assert.equal(await ctx.markAllRead(),true);assert.equal(ctx.financeNotificationView().unread,0);assert.equal(ctx.financeNotificationState().marking,false);assert.ok(queries.filter(q=>q.updateValue).every(q=>q.ors.includes('read.eq.false,read.is.null')&&!q.rangeValue&&!q.limitValue));assert.ok(source.includes('所有可見通知標為已讀'));pass('bulk action scope is all server-visible unread records, no optimistic zero and no page-only limit');
  for(const code of ['401','403','42501','FINANCE_AUTH_IDENTITY_CHANGED']){
    rows=[row(1,{read:false}),row(2,{read:false})];await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();updateError={code};
    assert.equal(await ctx.markAllRead(),false);assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,null);assert.equal(nodes['notif-list'].innerHTML,'');assert.equal(ctx.financeNotificationState().marking,false);updateError=null;
  }pass('all-read authorization failures clear private history and badge for every auth-denial code');
  for(const error of [{code:'42501'}, {status:403}]){
    rows=[row(1,{read:false})];await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();updateError=error;
    await assert.rejects(ctx.markNotifRead('n-00001'),caught=>caught===error);assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,null);assert.equal(nodes['notif-list'].innerHTML,'');updateError=null;
  }pass('single-read denial retains original database code and clears private cached rows');
  rows=[row(1,{read:false})];await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();pending=deferred();const beforeMutationDenial=ctx.loadFinanceNotifications();await tick();const beforeMutationPending=pending;pending=null;updateError={code:'42501'};
  await assert.rejects(ctx.markNotifRead('n-00001'),error=>error.code==='42501');updateError=null;beforeMutationPending.resolve({data:[row(1,{read:false})],count:1,error:null});await beforeMutationDenial;assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,null);pass('earlier read cannot restore notification cache after mutation authorization denial');
  // Use the actual shipped SDK to verify emitted URL grammar, with no request.
  const sdkContext={console,URL,Headers,Request,Response,fetch:()=>{throw Error('SDK URL contract must not contact any server');},AbortController,WebSocket,setTimeout,clearTimeout,setInterval,clearInterval};vm.createContext(sdkContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/supabase-js-2.111.0.umd.js'),'utf8'),sdkContext);
  const sdk=sdkContext.supabase.createClient('https://fixture.invalid','fictional-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  for(const tab of ['all','unread','system','approval']){
    const actual=ctx.financeNotificationHistoryQuery(sdk,tab,{createdAt:'2026-10-13T03:00:00+00:00',id:'n-00042'}),url=actual.url;
    assert.equal(url.searchParams.getAll('or').length,1);assert.equal(url.searchParams.get('limit'),'41');assert.equal(url.searchParams.get('order'),'created_at.desc.nullslast,id.desc');assert.equal(url.searchParams.get('tenant_id'),'eq.tenant-a');assert.equal(url.searchParams.get('data_environment'),'eq.production');assert.equal(actual.headers.get('Prefer'),null);
    if(tab==='unread')assert.match(url.searchParams.get('or'),/^\(and\(or\(read.eq.false,read.is.null\),or\(created_at/);
    if(tab==='system')assert.match(url.searchParams.get('or'),/^\(and\(or\(type.eq.system,type.is.null,type.eq.""\),or\(created_at/);
  }pass('actual bundled Supabase SDK emits one nested-AND PostgREST logic parameter with stable keyset and no history exact-count');
  rows=[row(1,{read:false}),row(2,{created_at:null}),row(3,{created_at:null})];await ctx.loadFinanceNotificationHistory();assert.equal(ctx.financeNotificationHistoryState('all').rows.length,3);const nullQuery=ctx.financeNotificationHistoryQuery({from:table},'all',{createdAt:null,id:'n-00003'});assert.equal(nullQuery.nullCreated,true);assert.equal(nullQuery.beforeId,'n-00003');pass('legacy null timestamps have explicit stable cursor continuation');
  rows=[row(1,{read:false})];await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();const snapshotOwner=ctx.financeNotificationState(),historyOwner=ctx.financeNotificationHistoryState('all');
  pending=deferred();const oldScopeUnread=ctx.loadFinanceNotifications(),oldScopeHistory=ctx.loadFinanceNotificationHistory();await tick();const oldScopeResult=pending;pending=null;
  ctx.CURRENT_PERMISSION_SNAPSHOT={loaded:true,permissions:[{scope:'department-b'}]};ctx.renderNotifs();assert.notEqual(ctx.financeNotificationState(),snapshotOwner);assert.notEqual(ctx.financeNotificationHistoryState('all'),historyOwner);assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,null);assert.equal(nodes['notif-list'].innerHTML,'');
  rows=[];queries=[];await ctx.loadFinanceNotifications({reuseFresh:true});await ctx.loadFinanceNotificationHistory({reuseFresh:true});assert.equal(queries.length,2);assert.equal(ctx.financeNotificationView().unread,0);
  oldScopeResult.resolve({data:[row(1,{read:false})],count:1,error:null});await Promise.all([oldScopeUnread,oldScopeHistory]);assert.equal(ctx.NOTIFS.length,0);assert.equal(ctx.financeNotificationView().unread,0);assert.equal(ctx.financeNotificationHistoryState('all').rows.length,0);pass('same-person formal permission snapshot change clears cached history, forces reads and rejects both old pending responses');
  const realtimeStart=source.indexOf('async function readRealtimeScopedSource('),realtimeEnd=source.indexOf('\n}',realtimeStart)+2;vm.runInContext(source.slice(realtimeStart,realtimeEnd),ctx);
  rows=[row(1,{read:false}),row(2,{read:false})];ctx.S.page='notif';ctx.S.nT='all';await ctx.loadFinanceNotifications();await ctx.loadFinanceNotificationHistory();ctx.S.nT='approval';await ctx.loadFinanceNotificationHistory();ctx.S.nT='all';
  rows[0].read=true;rows.push(row(3,{read:false}));await ctx.readRealtimeScopedSource('notifications',()=>true);assert.equal(ctx.financeNotificationView().unread,2);assert.equal(ctx.financeNotificationHistoryState('all').rows.length,3);assert.ok(ctx.financeNotificationHistoryState('all').rows.find(x=>x.id==='n-00001').read);assert.ok(nodes['notif-list'].innerHTML.includes('虛構通知 3'));assert.equal(ctx.financeNotificationHistoryState('approval').status,'idle');pass('Realtime updates active history and read styling while retiring other tab caches');
  let dashboardBuilds=0;ctx.buildDash=()=>{dashboardBuilds++};ctx.S.page='newreq';queries=[];await ctx.readRealtimeScopedSource('notifications',()=>true);assert.equal(dashboardBuilds,0);assert.equal(queries.length,1);assert.ok(queries[0].opts.count==='exact');assert.equal(ctx.S.page,'newreq');pass('Realtime while editing only refreshes unread notifications without building forms, dashboard or historical sources');
  console.log(checks+' notification paging and actual UI behavior groups passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
