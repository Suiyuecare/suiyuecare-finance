#!/usr/bin/env node
'use strict';
// Full real index/CSS and bundled Supabase SDK. Only Auth/identity/profile
// transports and the post-login workspace bootstrap are fictional. No Google
// employee impersonation, outside network or production business writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pw=require('playwright'),out=process.argv[2]||'/tmp/finance-oauth-account-guard-browser-20261013';
const {applyBuildEnvironment}=require('./finance_build_environment'),source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__oauthGuardQA={run:async function(code){return await eval(code)}};\n})();').replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'').replace('</head>','<script src="/assets/vendor/supabase-js-2.111.0.umd.js"></script></head>');
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(f!==root&&!f.startsWith(root+'/')){res.writeHead(403);return res.end();}res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'");if(f===root||f===path.join(root,'index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}if(!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(f));});
const setup=`(async function(){
 S.user=null;S.demoLogin=false;window.__entered=[];window.__requests=[];window.__diagnostics=[];window.__mode='provider';window.__storageFailure=false;window.__logoutAttempts=0;window.__oauthSelection=null;
 const expected='fictional.expected@suiyuecare.com',other='fictional.other@suiyuecare.com',id='10000000-0000-4000-8000-000000000001';window.__expected=expected;window.__other=other;
 const user=function(email){return{id:id,email:email,email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{email:email,email_verified:true}}]};};
 const session=function(email){const payload=btoa(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'}));return{access_token:'e30.'+payload+'.fixture-signature',refresh_token:'fixture-refresh-token',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:user(email)};};
 window.__seedSession=function(email){localStorage.setItem('fixture-finance-auth',JSON.stringify(session(email)));localStorage.setItem('fixture-finance-auth-code-verifier',JSON.stringify('fixture-code-verifier/PASSWORD_RECOVERY'));};__seedSession(expected);
 const sdkStorage={getItem:function(key){return localStorage.getItem(key);},setItem:function(key,value){localStorage.setItem(key,value);},removeItem:function(key){if(__storageFailure&&key.indexOf('fixture-finance-auth')===0)throw Error('Fictional storage removal denied');localStorage.removeItem(key);}};
 const fakeFetch=async function(input,options){const url=new URL(typeof input==='string'?input:input.url),method=options&&options.method||'GET';window.__requests.push({path:url.pathname,query:url.search,method:method});
 const reply=function(data,status){return new Response(JSON.stringify(data),{status:status||200,headers:{'Content-Type':'application/json'}});};
 if(url.pathname==='/auth/v1/token'){if(__mode==='exchange-failure')return reply({error:'invalid_grant',error_description:'Fictional expired code'},400);return reply(session(expected));}
 if(url.pathname==='/auth/v1/user')return reply(user(__mode==='mismatch'?other:expected));
 if(url.pathname==='/auth/v1/logout'){window.__logoutAttempts++;return new Response(null,{status:204});}
 if(url.pathname==='/rest/v1/rpc/finance_complete_current_google_account_link_v2')return reply({ok:true,status:'bound',auth_user_id:id,login_email:expected});
 if(url.pathname==='/rest/v1/finance_users')return reply({id:'fictional-finance-user',name:'虛構測試同仁',email:expected,auth_user_id:id,role:'employee',active:true,department_code:'FICT',entity_id:'E1'});
 throw Error('Forbidden fixture request '+url.pathname);
 };
 window.__client=window.supabase.createClient('https://fictional-auth.invalid','fictional-anon-key',{global:{fetch:fakeFetch},auth:{storage:sdkStorage,storageKey:'fixture-finance-auth',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'}});await __client.auth.initialize();
 getSb=function(){return __client;};isFinanceProductionBuild=function(){return true;};currentSupabaseSession=async function(){const response=await __client.auth.getSession();return response.data.session;};
 consumePortalFinanceHandoff=function(){return null;};captureApprovalDeepLinkFromUrl=function(){};redirectUnauthedFinanceToPortal=function(){return false;};
 reportFinanceOAuthDiagnostic=async function(detail){__diagnostics.push(detail);return{ok:true,skipped:true};};
 doEnter=function(profile){__entered.push(profile);S.user=profile;el('login-screen').style.display='none';el('auth-loading').style.display='none';};
 window.googleLogin=async function(){const result=await __client.auth.signInWithOAuth({provider:'google',options:{skipBrowserRedirect:true,redirectTo:location.origin+'/',queryParams:{prompt:'select_account'}}});if(result.error)throw result.error;__oauthSelection=result.data.url;return true;};
 safeSetItem(FINANCE_PORTAL_EMAIL_KEY,expected);safeSetItem(FINANCE_PORTAL_EMAIL_AT_KEY,String(Date.now()));safeSetItem(FINANCE_PORTAL_OAUTH_PENDING_KEY,'1');
 ['demo-login-title','demo-login-panel'].forEach(function(id){if(el(id))el(id).style.display='none';});
 return true;
})()`;
let browser;const evidence={scope:'Full actual index + bundled Supabase JS 2.111.0; intercepted Auth/identity/profile only; post-login doEnter recorded, not full workspace E2E',sourceHash:crypto.createHash('sha256').update(source).digest('hex'),cases:[]};
(async()=>{fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
for(const engine of ['chromium','webkit'])for(const width of [1440,390]){
 browser=await pw[engine].launch({headless:true});
 for(const scenario of ['provider-error','exchange-failure','mismatch-storage-failure','entry-mismatch-storage-failure','correct-account']){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390}),errors=[],external=[],record={engine,width,scenario,checks:[]};evidence.cases.push(record);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  const run=code=>page.evaluate(code=>window.__oauthGuardQA.run(code),code),check=(name,value)=>{assert(value,engine+' '+width+' '+scenario+': '+name);record.checks.push(name);};
  await page.goto(origin);await run(setup);
  const result=await run(`(async function(){
   __mode=${JSON.stringify(scenario)};var url='/';
   if(__mode==='provider-error')url='/?error=server_error&error_description='+encodeURIComponent('Database error updating user access_token=never-show-this');
   if(__mode==='exchange-failure')url='/?code=fixture-bad-code';
   if(__mode==='correct-account')url='/?code=fixture-good-code';
   if(__mode.includes('mismatch')){__mode='mismatch';__seedSession(__other);__storageFailure=true;}
   history.replaceState(null,'',url);
   window.__gateResult=${scenario==='entry-mismatch-storage-failure'?'await enterByEmail(__other,{session:(await __client.auth.getSession()).data.session})':'await bootAuthGate()'};
   return{gate:__gateResult,entered:__entered.length,requests:__requests,diagnostics:__diagnostics.map(x=>x.stage),error:el('login-err').textContent,stored:!!localStorage.getItem('fixture-finance-auth'),url:location.href};
  })()`);
  record.result=result;
  if(scenario==='correct-account'){
   check('correct Google identity reaches exactly one mocked workspace bootstrap',result.gate===true&&result.entered===1);
   check('real SDK performs PKCE exchange, bound identity RPC and scoped profile read',result.requests.some(x=>x.path==='/auth/v1/token')&&result.requests.filter(x=>x.path.includes('/rpc/')).length===1&&result.requests.some(x=>x.path==='/rest/v1/finance_users'&&x.query.includes('auth_user_id=eq.')));
   check('correct identity preserved',await run('S.user.email===__expected'));
  }else{
   check('handled failure cannot enter an old workspace or bind/read a profile',result.entered===0&&!result.requests.some(x=>x.path.startsWith('/rest/')));
   check('preexisting SDK session remains present so fail-closed is exercised',result.stored);
   if(scenario==='exchange-failure')check('real SDK exchange transport was exercised',result.requests.some(x=>x.path==='/auth/v1/token'));
   if(scenario.includes('mismatch'))check('wrong identity is rejected before binding despite failed storage removal',result.diagnostics.includes('oauth_email_match')&&await run('__logoutAttempts===1'));
   check('error remains specific, safe and actionable',result.error.includes('事件編號')&&(scenario.includes('mismatch')?result.error.includes('不同'):result.error.includes('Google'))&&!result.error.includes('never-show-this')&&!result.error.includes('Database error'));
   check('OAuth callback secrets scrubbed from visible URL',!/[?&](code|error|access_token)=/.test(result.url));
   const layout=await page.locator('#login-err').evaluate(node=>{const box=node.getBoundingClientRect();return{font:parseFloat(getComputedStyle(node).fontSize),left:box.left,right:box.right,height:box.height,overflow:document.documentElement.scrollWidth>innerWidth+1};});record.layout=layout;
   check('error readable and no page overflow',layout.font>=12&&layout.height>0&&layout.left>=0&&layout.right<=width+1&&!layout.overflow);
   const switcher=page.locator('#login-switch-account');check('account reselection recovery visibly available',await switcher.isVisible()&&await switcher.isEnabled());
   await page.screenshot({path:path.join(out,engine+'-'+width+'-'+scenario+'-before-recovery.png')});
   await switcher.click();
   if(scenario.includes('mismatch')){await page.waitForFunction(()=>document.querySelector('#login-err').textContent.includes('無法清除'));check('failed logout offers recovery and still cannot enter',await run('__entered.length===0&&el("login-err").textContent.includes("無痕視窗")'));}
   else{await page.waitForFunction(()=>!!window.__oauthSelection);check('actual reselect handler reaches SDK account selection without external navigation',await run('__entered.length===0&&new URL(__oauthSelection).searchParams.get("prompt")==="select_account"'));}
   await page.screenshot({path:path.join(out,engine+'-'+width+'-'+scenario+'.png')});
  }
  check('no JavaScript errors or external traffic',errors.length===0&&external.length===0);record.errors=errors;record.externalCount=external.length;console.log('PASS '+engine+' '+width+' '+scenario+' '+record.checks.length+' checks');await page.close();
 }
 await browser.close();browser=null;
}
fs.rmSync(path.join(out,'failure.json'),{force:true});fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('OAuth account guard browser PASS '+evidence.cases.reduce((n,c)=>n+c.checks.length,0)+' checks '+out);
})().catch(error=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,evidence},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
