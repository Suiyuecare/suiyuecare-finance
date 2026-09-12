// Actual shipped functions in a VM, fictional identities only; no network or DB writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);const rest=source.slice(start),next=rest.slice(1).search(/^(?:(?:async )?function |window\.|var )/m);return next<0?rest:rest.slice(0,next+1);}
function install(ctx,names){vm.createContext(ctx);for(const name of names)vm.runInContext(fn(name),ctx);return ctx;}
const profile=()=>({id:'person-a',authUserId:'auth-a',email:'person-a@example.invalid',role:'employee',n:'林星河'});
let checks=0;function pass(name){checks++;console.log('PASS '+name);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
(async()=>{
  let calls=0,navigations=[],lastDialog,oauth,backup=true;
  const auth=install({S:{user:profile()},financeAuthIdentityEpoch:0,financeWorkspaceIdentityBlocked:true,financeReauthenticationAttempt:null,FINANCE_REAUTH_TIMEOUT_MS:20,
    currentFinanceAuthUserId(){return this.S?.user?.authUserId||auth.S.user.authUserId;},currentTenantId:()=> 'tenant-a',activeDataEnvironment:()=> 'real',
    ensureOfficialHostBeforeOAuth:()=>true,isOAuthBlockedUserAgent:()=>false,saveFinanceAuthRecoveryDraft:()=>backup,
    getSb:()=>({auth:{signInWithOAuth(args){calls++;return oauth(args);}}}),showFinanceAuthRecovery:x=>lastDialog=x,
    safeSetItem(){},setTopSyncStatus(){},oauthRedirectUrl:()=> 'https://finance.example.invalid/',
    FINANCE_PORTAL_EMAIL_KEY:'email',FINANCE_PORTAL_EMAIL_AT_KEY:'at',FINANCE_PORTAL_OAUTH_PENDING_KEY:'pending',FINANCE_PORTAL_OAUTH_MODE_KEY:'mode',
    SUPABASE_URL:'https://auth.example.invalid',window:{location:{assign:url=>navigations.push(url)}},URL,setTimeout,clearTimeout,console
  },['financeReauthenticationIdentity','financeReauthenticationDestination','startFinanceReauthentication','withOperationTimeout']);
  oauth=async()=>({error:{message:'offline'}});
  assert.equal(await auth.startFinanceReauthentication(),false);assert.equal(auth.financeReauthenticationAttempt,null);assert.equal(lastDialog.reason,'auth_verification_unavailable');assert.equal(auth.financeWorkspaceIdentityBlocked,true);pass('OAuth returned error leaves identity lock and retry state');
  oauth=()=>{throw Error('network threw');};assert.equal(await auth.startFinanceReauthentication(),false);assert.equal(auth.financeReauthenticationAttempt,null);pass('OAuth synchronous throw is caught and permits retry');
  const slow=deferred();oauth=()=>slow.promise;calls=0;
  const attempt=auth.startFinanceReauthentication();assert.equal(await auth.startFinanceReauthentication(),false);await attempt;
  assert.equal(calls,1);assert.match(lastDialog.message,/逾時/);assert.equal(auth.financeReauthenticationAttempt,null);
  slow.resolve({data:{url:'https://auth.example.invalid/auth/v1/authorize?provider=google'}});await pause(5);assert.equal(navigations.length,0);pass('single flight, bounded timeout, late response cannot redirect');
  oauth=async args=>{assert.equal(args.provider,'google');assert.equal(args.options.skipBrowserRedirect,true);assert.equal(args.options.queryParams.login_hint,'person-a@example.invalid');assert.equal(args.options.queryParams.prompt,'select_account');assert.equal(args.options.redirectTo,'https://finance.example.invalid/');return {data:{url:'https://auth.example.invalid/auth/v1/authorize?provider=google'}};};
  assert.equal(await auth.startFinanceReauthentication(),true);assert.equal(navigations.length,1);pass('retry preserves official OAuth redirect contract and explicit redirect only');
  for(const url of ['https://evil.example.invalid/auth/v1/authorize','https://auth.example.invalid/untrusted','https://username@auth.example.invalid/auth/v1/authorize']){oauth=async()=>({data:{url}});assert.equal(await auth.startFinanceReauthentication(),false);}assert.equal(navigations.length,1);pass('rejects unconfigured OAuth origin, path and userinfo');
  const switched=deferred();oauth=()=>switched.promise;const pending=auth.startFinanceReauthentication();await pause(0);auth.S.user={...profile(),authUserId:'auth-b',id:'person-b',email:'person-b@example.invalid'};lastDialog=null;switched.resolve({data:{url:'https://auth.example.invalid/auth/v1/authorize'}});await pending;assert.equal(navigations.length,1);assert.equal(lastDialog,null);pass('different identity cannot receive late redirect or old recovery rendering');
  auth.S.user=profile();const changed=deferred();oauth=()=>changed.promise;const p=auth.startFinanceReauthentication();auth.financeAuthIdentityEpoch++;changed.resolve({data:{url:'https://auth.example.invalid/auth/v1/authorize'}});await p;assert.equal(navigations.length,1);assert.equal(auth.financeReauthenticationAttempt,null);pass('auth event invalidates in-flight navigation');
  backup=false;calls=0;assert.equal(await auth.startFinanceReauthentication(),false);assert.equal(calls,0);assert.match(lastDialog.message,/安全暫存/);assert.equal(auth.financeReauthenticationAttempt,null);pass('failed recovery storage never leaves page; failure remains retryable');

  const mine=install({S:{user:profile()},currentUserIsNamed:name=>name===mine.S.user.n},['requestIsMine']);
  assert.equal(mine.requestIsMine({app:'林星河舊名',applicantId:'person-a',applicantEmail:'person-a@example.invalid'}),true);
  assert.equal(mine.requestIsMine({app:'林星河',applicantId:'person-b',applicantEmail:'person-b@example.invalid'}),false);
  assert.equal(mine.requestIsMine({app:'林星河'}),true);pass('canonical owner supports rename, excludes same-name different identity, retains legacy fallback');

  let response,reads=0,tenant='tenant-a',env='real',rendered=[],filters=[];
  const client={from(table){assert.equal(table,'notifications');const query={select(columns,opts){assert.equal(opts.count,'exact');return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},abortSignal(){return this;},then(resolve,reject){reads++;return Promise.resolve().then(()=>response()).then(resolve,reject);}};return query;}};
  const notice=install({S:{user:profile(),demoLogin:false,page:'dashboard'},financeWorkspaceIdentityBlocked:false,FINANCE_NOTIFICATION_STATE:null,NOTIFS:[],FINANCE_NOTIFICATION_TIMEOUT_MS:20,
    ROLE_PERMISSIONS:{employee:{notif:'read'}},currentFinanceAuthUserId:()=>notice.S.user.authUserId,currentTenantId:()=>tenant,activeDataEnvironment:()=>env,normalizedRoleKey:u=>u.role,
    getSb:()=>client,applyRemoteLimit:q=>q,REMOTE_BOOTSTRAP_LIMITS:{notifications:2500},mapNotif:n=>({...n}),inActiveDataEnvironment:n=>n.dataEnv===env,
    refreshFinanceNotificationViews(){rendered.push(notice.financeNotificationView());},escAttr:s=>String(s),URL,AbortController,setTimeout,clearTimeout,console
  },['financeNotificationIdentity','financeNotificationState','financeNotificationView','financeNotificationStatusHtml','loadFinanceNotifications','withOperationTimeout']);
  assert.equal(notice.financeNotificationView().unread,null);
  response=()=>new Promise(()=>{});reads=0;const first=notice.loadFinanceNotifications();const duplicate=notice.loadFinanceNotifications();await Promise.all([first,duplicate]);assert.equal(reads,1);assert.equal(notice.financeNotificationView().unread,null);assert.equal(notice.financeNotificationView().status,'error');assert.match(notice.financeNotificationStatusHtml(notice.financeNotificationView()),/重試載入通知/);assert.equal(notice.FINANCE_NOTIFICATION_STATE.promise,null);pass('first notification timeout remains unknown, retry visible, one read');
  response=()=>({data:[{id:'n-a',title:'本人通知',read:false,dataEnv:'real'}],count:1,error:null});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().unread,1);const stamp=notice.financeNotificationView().lastSuccessAt;assert.ok(stamp);assert.deepEqual(filters.slice(-2),[['tenant_id','tenant-a'],['data_environment','real']]);pass('successful scoped read establishes independent unread count and timestamp');
  response=()=>({data:null,error:{code:'CLIENT_TIMEOUT'}});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().unread,1);assert.equal(notice.financeNotificationView().lastSuccessAt,stamp);assert.match(notice.financeNotificationView().summary,/上次資料/);pass('failed refresh retains same-person last success with stale label');
  response=()=>({data:[],count:0,error:null});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().unread,0);assert.equal(notice.financeNotificationView().status,'ready');pass('successful empty response alone establishes zero');
  response=()=>({data:[{id:'n-a',read:false,dataEnv:'real'}],count:3000,error:null});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().partial,true);assert.match(notice.financeNotificationStatusHtml(notice.financeNotificationView()),/3000/);pass('bounded list explicitly identifies incomplete unread range');
  response=()=>({data:null,error:{code:'42501'}});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().unread,null);assert.equal(notice.NOTIFS.length,0);assert.equal(notice.financeNotificationView().lastSuccessAt,'');pass('authorization denial clears formerly visible notification content');
  const stale=deferred();response=()=>stale.promise;const old=notice.loadFinanceNotifications();await pause(0);notice.S.user={...profile(),authUserId:'auth-b',id:'person-b'};assert.equal(notice.financeNotificationView().unread,null);response=()=>({data:[],count:0,error:null});await notice.loadFinanceNotifications();stale.resolve({data:[{id:'secret-a',read:false,dataEnv:'real'}],count:1,error:null});await old;assert.equal(notice.financeNotificationView().unread,0);assert.equal(notice.NOTIFS.length,0);pass('old identity response cannot overwrite newer identity successful read');
  response=()=>({data:[{id:'b',read:false,dataEnv:'real'}],count:1,error:null});await notice.loadFinanceNotifications();env='test';assert.equal(notice.financeNotificationView().unread,null);assert.equal(notice.NOTIFS.length,0);tenant='tenant-b';assert.equal(notice.financeNotificationView().unread,null);pass('tenant and environment change clear old scope');
  const broken={from(){throw Error('builder throws');}};await notice.loadFinanceNotifications({client:broken});assert.equal(notice.FINANCE_NOTIFICATION_STATE.promise,null);response=()=>({data:[],count:0,error:null});await notice.loadFinanceNotifications();assert.equal(notice.financeNotificationView().status,'ready');pass('synchronous query construction failure clears single-flight and can retry');
  notice.ROLE_PERMISSIONS.employee.notif='none';assert.equal(notice.financeNotificationView().unread,null);notice.financeWorkspaceIdentityBlocked=true;assert.equal(notice.financeNotificationView().rows.length,0);pass('permission revision and identity lock invalidate visible cache');
  console.log(`${checks} employee auth / notification behavior checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
