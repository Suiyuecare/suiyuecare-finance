#!/usr/bin/env node
'use strict';

// Real shipped modal in Chrome/WebKit; fictional people and a local fake RPC.
// This does not authenticate through Google or write to production.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium,webkit}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');
const outputDir=path.resolve(process.argv[2]||'/tmp/finance-personnel-save-browser-20261003');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sourceHash=crypto.createHash('sha256').update(source).digest('hex');
const anchor='bootAuthGate();\n\n})();';
assert.ok(source.includes(anchor),'missing finance closure anchor');
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
  .replace(anchor,"window.__personnelSaveQA={run:async function(code){return await eval(code);}};\n"+anchor)
  .replace(/<!-- DEMO_LOGIN_START -->[\s\S]*?<!-- DEMO_LOGIN_END -->/g,'')
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self'; form-action 'none'">`);
const server=http.createServer((req,res)=>{
  const requestUrl=new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+requestUrl.pathname);
  if(file!==root&&!file.startsWith(root+'/')){res.writeHead(403);return res.end();}
  if(file===root||file===path.join(root,'index.html')){
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
  }
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const checks=[];
const screenshots=[];
let browser;
function record(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push(name);}
const setup=`
  S.user={id:'admin-1',authUserId:'auth-1',n:'虛構人資',role:'hr',eid:'E1',dc:'D1'};
  S.demoLogin=false;S.page='users';
  el('main-wrap').style.display='flex';el('auth-loading').style.display='none';el('login-screen').style.display='none';
  ENTS=[{id:'E1',s:'虛構公司',full:'虛構公司',active:true}];
  DEPTS=[{c:'D1',n:'虛構部門',lv:1,active:true,newFormEntityCodes:['E1']}];
  USERS=[{id:'staff-1',tenantId:'tenant-a',n:'同一位員工',email:'person@suiyuecare.com',contactEmail:'person@suiyuecare.com',jobTitle:'職員',extension:'123',role:'employee',eid:'E1',dc:'D1',active:true,memberRevision:3}];
  window.__qaRows=[{id:'staff-1',tenant_id:'tenant-a',name:'同一位員工',email:'person@suiyuecare.com',org_contact_email:'person@suiyuecare.com',job_title:'職員',extension:'123',role:'employee',entity_id:'E1',department_code:'D1',active:true,member_revision:3}];
  window.__qaCalls=[];window.__qaMode='success';window.__qaAlerts=[];window.__qaBroadReloads=0;
  window.alert=function(value){window.__qaAlerts.push(String(value));};
  canManageUsers=function(){return S.user.role==='hr';};
  currentTenantId=function(){return 'tenant-a';};
  financeGoogleLoginHealthForUser=function(user){return {status:'waiting_first_login',email:user.email};};
  rememberFinanceGoogleLoginHealth=function(){};
  saveLocalAppStateSoon=function(){};renderUsers=function(){};renderUsersHealth=function(){};
  financeMemberRefreshAfterSave=function(){};
  loadRemoteData=function(){window.__qaBroadReloads++;throw Error('broad reload during member save');};
  getSb=function(){return {
    from:function(table){if(table!=='finance_users')throw Error('unexpected table '+table);
      var key,value;var query={select:function(cols){if(!cols.includes('member_revision'))throw Error('missing revision');return query;},
        eq:function(k,v){if(k!=='tenant_id'){key=k;value=v;}return query;},limit:function(){return query;},
        then:function(resolve,reject){return Promise.resolve({data:window.__qaRows.filter(function(row){return String(row[key])===String(value);}),error:null}).then(resolve,reject);}};
      return query;
    },
    rpc:async function(name,args){
      if(name!=='finance_admin_upsert_member_reliable_v1')throw Error('unexpected RPC '+name);
      window.__qaCalls.push(args);
      if(window.__qaMode==='deferred')return new Promise(function(resolve){window.__qaResolve=resolve;});
      if(window.__qaMode==='conflict')return {error:{code:'PT409',status:409,message:'人員資料已由其他人更新'}};
      if(window.__qaMode==='timeout')return {error:{status:504,message:'Gateway Timeout'}};
      var row={id:args.p_member.id||(args.p_member.login_email==='pending.person@suiyuecare.com'?'staff-pending':'staff-new'),tenant_id:'tenant-a',name:args.p_member.name,
        email:args.p_member.login_email,org_contact_email:args.p_member.contact_email,
        job_title:args.p_member.job_title,extension:args.p_member.extension,
        role:args.p_member.role,entity_id:args.p_member.entity_id,
        department_code:args.p_member.department_code,active:args.p_member.active,
        member_revision:args.p_expected_revision+1,created_at:new Date().toISOString()};
      window.__qaRows=window.__qaRows.filter(function(r){return r.id!==row.id;}).concat([row]);
      return {data:{ok:true,atomic:true,member:row}};
    }
  }};
  true;
`;
async function exercise(engineName,launcher,width,origin){
  browser=await launcher.launch(engineName==='chrome'?{channel:process.env.FINANCE_BROWSER_CHANNEL||'chrome',headless:true}:{headless:true});
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const run=code=>page.evaluate(code=>window.__personnelSaveQA.run(code.includes('await ')?'(async function(){'+code+'})()':code),code);
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__personnelSaveQA);
  await run(setup);
  await run("openEditU('staff-1')");
  if(!await page.locator('#user-personnel-turnover-hint').isVisible()){
    console.error('modal diagnostic',await run("({users:USERS.length,editId:USER_EDIT_ID,modal:el('m-add-user').style.display,hint:el('user-personnel-turnover-hint').style.display,alerts:window.__qaAlerts})"));
  }
  record(`${engineName} ${width} turnover guidance visible`,await page.locator('#user-personnel-turnover-hint').isVisible(),true);
  record(`${engineName} ${width} modal-open baseline`,await run('USER_EDIT_SNAPSHOT.memberRevision'),3);
  await page.locator('#un').fill('同一位員工更名');
  await run("USERS[0].memberRevision=4;USERS[0].n='背景變更過的姓名'");
  await page.locator('#user-modal-submit').click();
  await page.waitForFunction(()=>document.querySelector('#m-add-user').style.display==='none');
  record(`${engineName} ${width} uses modal revision after background refresh`,await run('window.__qaCalls[0].p_expected_revision'),3);
  record(`${engineName} ${width} confirmed edit closes promptly`,await page.locator('#m-add-user').isVisible(),false);
  record(`${engineName} ${width} broad reload not awaited`,await run('window.__qaBroadReloads'),0);
  await run("openEditU('staff-1');window.__qaMode='conflict'");
  await page.locator('#un').fill('保留的更正草稿');
  await page.locator('#user-modal-submit').click();
  await page.waitForFunction(()=>document.querySelector('#add-err').style.display==='block');
  record(`${engineName} ${width} PT409 preserves form`,await page.locator('#un').inputValue(),'保留的更正草稿');
  record(`${engineName} ${width} PT409 blocks blind resubmit`,await page.locator('#user-modal-submit').isDisabled(),true);
  record(`${engineName} ${width} PT409 gives refresh guidance`,/核對最新資料/.test(await page.locator('#add-err').innerText()),true);
  await run("openEditU('staff-1');window.__qaMode='timeout'");
  await page.locator('#user-modal-submit').click();
  await page.waitForFunction(()=>document.querySelector('#add-err').textContent.includes('結果待確認'));
  record(`${engineName} ${width} uncertain result blocks duplicate`,await page.locator('#user-modal-submit').isDisabled(),true);
  await run("closeModal('m-add-user');openEditU('staff-1')");
  record(`${engineName} ${width} uncertain edit remains blocked after reopen`,await page.locator('#user-modal-submit').isDisabled(),true);
  record(`${engineName} ${width} reopen explains pending result`,/上次儲存結果仍待確認/.test(await page.locator('#add-err').innerText()),true);
  record(`${engineName} ${width} original retry is available`,await page.locator('#user-retry-original').isVisible(),true);
  await page.waitForFunction(()=>!document.querySelector('#action-feedback')||!document.querySelector('#action-feedback').classList.contains('show'));
  await page.locator('#user-retry-original').scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const screenshot=path.join(outputDir,`${engineName}-${width}-original-retry.png`);
  await page.screenshot({path:screenshot,fullPage:false});screenshots.push(screenshot);
  await run("window.__qaMode='success'");
  await page.locator('#user-retry-original').click();
  await page.waitForFunction(()=>document.querySelector('#m-add-user').style.display==='none');
  record(`${engineName} ${width} retry uses identical receipt request`,await run('JSON.stringify(window.__qaCalls.at(-1))===JSON.stringify(window.__qaCalls.at(-2))'),true);
  await run("openAddUser();window.__qaMode='success'");
  record(`${engineName} ${width} turnover hint hidden for new person`,await page.locator('#user-personnel-turnover-hint').isVisible(),false);
  await page.locator('#un').fill('虛構新員工');
  await page.locator('#ue').fill('new.person@suiyuecare.com');
  await page.locator('#ud').selectOption('D1');
  await page.locator('#user-modal-submit').click();
  await page.waitForFunction(()=>document.querySelector('#m-add-user').style.display==='none');
  record(`${engineName} ${width} new person uses create revision`,await run('window.__qaCalls.at(-1).p_expected_revision'),0);
  record(`${engineName} ${width} new person appears once`,await run("USERS.filter(function(u){return u.email==='new.person@suiyuecare.com'}).length"),1);
  await run("openAddUser();window.__qaMode='timeout'");
  await page.locator('#un').fill('待確認新增人員');
  await page.locator('#ue').fill('pending.person@suiyuecare.com');
  await page.locator('#ud').selectOption('D1');
  await page.locator('#user-modal-submit').click();
  await page.waitForFunction(()=>document.querySelector('#add-err').textContent.includes('結果待確認'));
  await run("closeModal('m-add-user');openAddUser()");
  record(`${engineName} ${width} pending create selector visible`,await page.locator('#user-pending-create-select').isVisible(),true);
  record(`${engineName} ${width} pending create restores original name`,await page.locator('#un').inputValue(),'待確認新增人員');
  record(`${engineName} ${width} pending create restores original email`,await page.locator('#ue').inputValue(),'pending.person@suiyuecare.com');
  record(`${engineName} ${width} pending create offers original retry`,await page.locator('#user-retry-original').isVisible(),true);
  const pendingOption=await page.locator('#user-pending-create-select').inputValue();
  await page.locator('#user-pending-create-select').selectOption('');
  record(`${engineName} ${width} unrelated new person resets role`,await page.locator('#ur').inputValue(),'employee');
  record(`${engineName} ${width} unrelated new person clears department`,await page.locator('#ud').inputValue(),'');
  await page.locator('#user-pending-create-select').selectOption(pendingOption);
  await run("window.__qaMode='success'");
  await page.locator('#user-retry-original').click();
  await page.waitForFunction(()=>document.querySelector('#m-add-user').style.display==='none');
  record(`${engineName} ${width} create retry uses identical receipt request`,await run('JSON.stringify(window.__qaCalls.at(-1))===JSON.stringify(window.__qaCalls.at(-2))'),true);
  await run("openEditU('staff-new');window.__qaMode='deferred'");
  await page.locator('#un').fill('關閉後晚回應');
  await page.locator('#user-modal-submit').click();
  const generationBeforeClose=await run('USER_EDIT_GENERATION');
  await run("closeModal('m-add-user')");
  record(`${engineName} ${width} close invalidates save generation`,await run('USER_EDIT_GENERATION'),generationBeforeClose+1);
  const alertsBeforeLate=await run('window.__qaAlerts.length');
  await run("window.__qaResolve({data:{ok:true,atomic:true,member:{...window.__qaRows.find(function(row){return row.id==='staff-new'}),name:'關閉後晚回應',member_revision:2}}})");
  await page.waitForTimeout(30);
  record(`${engineName} ${width} late closed response does not alter list`,await run("USERS.find(function(u){return u.id==='staff-new'}).n"),'虛構新員工');
  record(`${engineName} ${width} late closed response has no popup`,await run('window.__qaAlerts.length'),alertsBeforeLate);
  await run("S.user.role='employee';openAddUser()");
  record(`${engineName} ${width} employee cannot open editor`,await page.locator('#m-add-user').isVisible(),false);
  record(`${engineName} ${width} employee sees permission error`,await run('window.__qaAlerts.at(-1).includes(\'僅開放\')'),true);
  record(`${engineName} ${width} no browser errors`,errors,[]);
  await page.close();await browser.close();browser=null;
}
(async()=>{
  fs.mkdirSync(outputDir,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [name,launcher] of [['chrome',chromium],['webkit',webkit]]){
    for(const width of [1440,390])await exercise(name,launcher,width,origin);
  }
  record('source unchanged during browser checks',crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),sourceHash);
  fs.writeFileSync(path.join(outputDir,'README.md'),
    '# Personnel save browser QA\n\nChrome and WebKit render the actual local `index.html` personnel editor at 1440 px and 390 px. The tests use fictional personnel and a fake local RPC transport to exercise version checks, conflict and unknown-result handling, original-request retry, permissions, and modal lifecycle. They do not contact production, complete Google OAuth for a real person, or prove live Supabase deployment.\n\n');
  fs.writeFileSync(path.join(outputDir,'evidence.json'),JSON.stringify({scope:'Actual local index; mock RPC and fictional identities; no real Google OAuth or production write',sourceHash,checks,screenshots},null,2));
  console.log(`PASS ${checks.length} Chrome/WebKit personnel modal checks with fictional RPC; ${outputDir}`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
