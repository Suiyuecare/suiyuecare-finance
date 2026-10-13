'use strict';
// All identities and credentials below are fictional; HTTP is intercepted.
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const base=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.FINANCE_OAUTH_BOUNDARY_SOURCE || path.join(base,'index.html'),'utf8');
function extract(name){
 let m=source.indexOf('function '+name+'(');if(m<0)throw Error('missing '+name);
 if(source.slice(m-6,m)==='async ')m-=6;
 let start=source.indexOf('{',m),depth=0,quote='',esc=false,line=false,block=false;
 for(let i=start;i<source.length;i++){let c=source[i],n=source[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}if(quote){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===quote)quote='';continue;}if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return source.slice(m,i+1);}
 throw Error('unterminated '+name);
}
const actual=['authUserHasVerifiedGoogleIdentity','supabaseAuthUserPreferredEmail','isCompanyGoogleLoginEmail','financeExpectedLoginEmail','supabaseAuthErrorInfo','supabaseAuthErrorIsTransient','supabaseAuthErrorIsInvalidSession','supabaseAuthSessionExpiresAt','supabaseAuthSessionIsExpired','supabaseAuthCall','supabaseAuthResult','inspectCurrentSupabaseSessionInternal','inspectCurrentSupabaseSession','currentSupabaseSession','bindSupabaseAuthState','financeSessionMatchesWorkspace','financeLoginRemoteCall','completeCurrentGoogleAccountLinkV2','normalizeFinanceGoogleLoginHealth','financeGoogleLoginStatusKey','enterByEmail','completeOAuthFromUrl','handleOAuthReturn','bootAuthGate','enterOrAuthorizePortalFinance','consumePortalFinanceHandoff','financeAuthIncidentId','safeOAuthErrorCode','safeOAuthDiagnosticText','oauthProviderErrorInfo','financeOAuthErrorDisplayText','showFinanceOAuthFailure'];
const first='fictional.first@suiyuecare.com',second='fictional.second@suiyuecare.com',id='fictional-auth-first';
const user={id,email:first,email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{email:first,email_verified:true}}]};
const session={access_token:'fixture-non-jwt-access-token',refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
async function scenario(label,{seed=false,logoutFailure=false,url='https://fictional-finance.invalid/?code=fictional-code',handoff=false,startFailure=false,returnedEmail=first,storageDeleteFailure=false,exchangeFailure=false,expectedEmail=second,direct=false}={}){
 const trace=[],store=new Map(),nodes=new Map();let denySessionRemoval=false;
 const uid=returnedEmail===second?'fictional-auth-second':id;
 const fixtureUser={...user,id:uid,email:returnedEmail,identities:[{provider:'google',identity_data:{email:returnedEmail,email_verified:true}}]};
 const fixtureSession={...session,user:fixtureUser};
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>{if(denySessionRemoval&&k==='fixture-auth')throw Error('Fictional storage deletion failed');store.delete(k);}};
 if(expectedEmail){store.set('expected_email',expectedEmail);store.set('expected_at',String(Date.now()));}store.set('fixture-auth-code-verifier',JSON.stringify('fixture-verifier'));
 if(seed)store.set('fixture-auth',JSON.stringify(fixtureSession));
 if(handoff)url='https://fictional-finance.invalid/?portal=1&email='+encodeURIComponent(second);
 const loc=new URL(url);
 const fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!=='https://fictional-finance.invalid')throw Error('Offline fixture rejected an external network destination');trace.push('HTTP '+(init.method||'GET')+' '+u.pathname+(u.search||''));
   if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='pkce')return new Response(JSON.stringify(exchangeFailure?{code:'fixture_exchange_failed',message:'Fictional code exchange failure'}:fixtureSession),{status:exchangeFailure?400:200,headers:{'content-type':'application/json'}});
   if(u.pathname==='/auth/v1/user')return new Response(JSON.stringify(fixtureUser),{status:200,headers:{'content-type':'application/json'}});
   if(u.pathname==='/auth/v1/logout'){denySessionRemoval=storageDeleteFailure;return new Response(logoutFailure?JSON.stringify({code:'fixture_logout_error',message:'Fictional service refused local logout'}):null,{status:logoutFailure?503:204,headers:{'content-type':'application/json'}});}
   throw Error('unexpected offline request '+u.pathname+u.search);
 };
 const c={console:{warn:()=>{},log:()=>{}},URL,URLSearchParams,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,fetch,crypto:crypto.webcrypto,navigator:{onLine:true,userAgent:'fictional VM'},location:loc,history:{replaceState:()=>{}},document:{title:'Offline fictional fixture'},Date,Math,S:{user:null,demoLogin:false,page:'dashboard'},financeAuthIdentityEpoch:0,supabaseAuthSubscription:null,supabaseAuthCheckPromise:null,AUTH_RUNTIME_STATE:{},financeLogoutInProgress:false,financeWorkspaceIdentityBlocked:false,AUTH_REQUEST_RETRY_COUNT:0,AUTH_REQUEST_TIMEOUT_MS:1000,AUTH_SESSION_REFRESH_SKEW_SECONDS:30,FINANCE_USER_SAFE_COLUMNS:'id,email,auth_user_id,active',FINANCE_PORTAL_EMAIL_KEY:'expected_email',FINANCE_PORTAL_EMAIL_AT_KEY:'expected_at',FINANCE_PORTAL_EMAIL_TTL_MS:3600000,FINANCE_PORTAL_OAUTH_PENDING_KEY:'pending',FINANCE_PORTAL_OAUTH_MODE_KEY:'mode',FINANCE_PORTAL_ROLE_KEY:'role',FINANCE_PORTAL_SCOPE_KEY:'scope',safeGetItem:storage.getItem,safeSetItem:storage.setItem,safeRemoveItem:storage.removeItem,normalizeSettingValue:x=>x,
 el:k=>{if(!nodes.has(k))nodes.set(k,{style:{display:'none'},textContent:''});return nodes.get(k);},isFinanceProductionBuild:()=>true,captureApprovalDeepLinkFromUrl:()=>{},scrubOAuthUrl:()=>{},showFinanceOfflinePreviewNotice:()=>{},redirectUnauthedFinanceToPortal:()=>false,
 showFinanceLoginAccountGuidance:o=>trace.push('guidance '+o.state),showFinanceOAuthFailure:async(stage,code)=>trace.push('diagnostic '+stage+'/'+code),reportFinanceOAuthDiagnostic:async p=>{trace.push('diagnostic '+p.stage+'/'+p.code);return{ok:true};},isRpcMissing:()=>false,mapUser:x=>({id:x.id,email:x.email,authUserId:x.auth_user_id,active:true}),doEnter:x=>{trace.push('ENTER '+x.email);c.S.user=x;},currentFinanceAuthUserId:()=>c.S.user&&c.S.user.authUserId||'',currentTenantId:()=> 'fictional-tenant',captureFinanceWorkspaceRecoveryBeforeLock:()=>trace.push('capture-lock'),setFinanceWorkspaceIdentityBlocked:v=>{c.financeWorkspaceIdentityBlocked=v;trace.push('workspace-lock '+v);},lockFinanceWorkspaceIdentity:r=>trace.push('LOCK '+r),hideFinanceAuthRecovery:()=>{},setTopSyncStatus:()=>{},syncStatusText:()=>'',approvalPersonalTab:()=>false,
 withOperationTimeout:p=>Promise.resolve(p),supabaseAuthRetryDelay:async()=>{},startPortalFinanceGoogleLogin:async(email)=>{trace.push('startOAuth '+email);return !startFailure;},
 };
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(base+'/assets/vendor/supabase-js-2.111.0.umd.js','utf8'),c);
 const sdk={auth:new c.supabase.AuthClient({url:'https://fictional-finance.invalid/auth/v1',headers:{apikey:'fixture-only'},fetch,storage,storageKey:'fixture-auth',flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:false,skipAutoInitialize:false})};
 const client={auth:sdk.auth,rpc:async(name)=>{trace.push('RPC '+name);return{data:{ok:true,status:'bound',auth_user_id:uid,current_login_email:returnedEmail},error:null};},from:()=>({select:()=>({eq(){return this;},single:async()=>{trace.push('profile verified '+returnedEmail);return{data:{id:'fictional-finance-'+uid,email:returnedEmail,auth_user_id:uid,active:true},error:null};}})})};
 c.getSb=()=>client;vm.runInContext(actual.map(extract).join('\n'),c);
 sdk.auth.onAuthStateChange((event)=>trace.push('SDK '+event));c.bindSupabaseAuthState(client);await sdk.auth.getSession();store.set('fixture-auth-code-verifier',JSON.stringify('fixture-verifier'));
 const verified=direct?await c.currentSupabaseSession():null;
 const result=direct?await c.enterByEmail(returnedEmail,{session:verified}):await c.bootAuthGate();await new Promise(r=>setTimeout(r,30));
 const after=await sdk.auth.getSession();sdk.auth.stopAutoRefresh();
 return{label,result,entered:c.S.user&&c.S.user.email||null,expected:c.financeExpectedLoginEmail(),sessionRetained:!!after.data.session,observer:c.AUTH_RUNTIME_STATE.event,trace,loginError:c.el('login-err').textContent,loadingHidden:c.el('auth-loading').style.display==='none',loginVisible:c.el('login-screen').style.display==='flex'};
}
(async()=>{
 const definitions=[
  ['mismatch rejects and clears session',{},null,true],
  ['mismatch logout HTTP503 still clears SDK session',{logoutFailure:true},null,true],
  ['provider error cannot reuse another session',{seed:true,url:'https://fictional-finance.invalid/?error=server_error&error_description=fixture-failure'},null,true],
  ['handoff mismatch starts requested OAuth',{seed:true,handoff:true,logoutFailure:true},null,false],
  ['handoff failed OAuth cannot reuse cleared session',{seed:true,handoff:true,logoutFailure:true,startFailure:true},null,false],
  ['fresh correct Google callback enters requested account',{returnedEmail:second},second,false],
  ['provider error without old session stays logged out',{url:'https://fictional-finance.invalid/?error=server_error'},null,true],
  ['exchange error cannot reuse another session',{seed:true,exchangeFailure:true},null,true],
  ['mismatch storage deletion exception cannot enter old session',{storageDeleteFailure:true},null,true],
  ['handoff storage deletion and start failure cannot enter old session',{seed:true,handoff:true,startFailure:true,storageDeleteFailure:true},null,true],
  ['standalone no hint accepts its verified session',{seed:true,expectedEmail:'',url:'https://fictional-finance.invalid/'},first,false],
  ['standalone same hint accepts its verified session',{seed:true,expectedEmail:first,url:'https://fictional-finance.invalid/'},first,false],
  ['common enter guard blocks wrong hint before any claim',{seed:true,direct:true},null,true],
  ['common enter guard blocks wrong hint despite logout503',{seed:true,direct:true,logoutFailure:true},null,true],
  ['common enter guard blocks wrong hint despite storage exception',{seed:true,direct:true,storageDeleteFailure:true},null,true],
  ['common enter accepts same hint and verified Google',{seed:true,direct:true,expectedEmail:first},first,false],
  ['common enter accepts standalone without a hint',{seed:true,direct:true,expectedEmail:''},first,false],
  ['provider error preserves failure even when old hint matches',{seed:true,expectedEmail:first,url:'https://fictional-finance.invalid/?error=server_error'},null,true],
  ['provider error preserves failure with standalone old session',{seed:true,expectedEmail:'',url:'https://fictional-finance.invalid/?error=server_error'},null,true],
 ];
 let checks=0,failed=0;
 function check(name,ok){checks++;if(ok)console.log('PASS '+name);else{failed++;console.error('FAIL '+name);}}
 for(const [label,options,want,expectsError] of definitions){
  const row=await scenario(label,options);
  check(label+': entered account boundary',row.entered===want);
  if(want===null){
   check(label+': no Finance claim/profile before identity precondition',!row.trace.some(x=>x.startsWith('RPC ')||x.startsWith('profile verified')));
   if(expectsError){check(label+': diagnostic remains visible',!!row.loginError&&row.trace.some(x=>x.startsWith('diagnostic ')));check(label+': auth loading hidden and login shown',row.loadingHidden&&row.loginVisible);}
  }else{
   check(label+': one bound Finance claim only',row.trace.filter(x=>x==='RPC finance_complete_current_google_account_link_v2').length===1);
   check(label+': entered only the verified session identity',row.sessionRetained&&row.trace.includes('ENTER '+want));
  }
  if(options.direct)check(label+': actual SDK getUser precedes common entry',row.trace.includes('HTTP GET /auth/v1/user'));
  if(label.startsWith('mismatch rejects')||options.logoutFailure&&!options.storageDeleteFailure&&!options.direct){check(label+': actual SDK emits SIGNED_OUT and drops local token',row.observer==='SIGNED_OUT'&&!row.sessionRetained);}
 }
 console.log('Finance OAuth account boundary: '+(checks-failed)+' PASS, '+failed+' FAIL across '+definitions.length+' isolated actual-SDK scenarios');
 if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
