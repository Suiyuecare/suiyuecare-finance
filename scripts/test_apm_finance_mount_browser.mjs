// Actual current Finance shell and navigation; synthetic identity/RPC only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium,webkit} from 'playwright';
const root=path.resolve(new URL('..',import.meta.url).pathname),require=createRequire(import.meta.url);
const {applyBuildEnvironment}=require('./finance_build_environment.js');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__apmQA={run:async function(code){return await eval(code)}};\n})();').replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const output=process.env.APM_FINANCE_MOUNT_OUTPUT||'/Users/seniorlifepr/.codex/tmp/apm-finance-mount-browser-20261020';fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403);return res.end();}if(p===root||p===path.join(root,'index.html')){res.setHeader('content-type','text/html;charset=utf-8');return res.end(html);}if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));});
let checks=0;const ok=(value,label)=>{assert.ok(value,label);checks++;};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 for(const [engine,type]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   for(const width of[320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());await page.goto(base);await page.waitForFunction(()=>window.__apmQA);
    await page.evaluate(()=>window.__apmQA.run(`
     S.user={id:'synthetic-accountant',authUserId:'10000000-0000-0000-0000-000000000001',role:'accountant',n:'合成會計',email:'synthetic@example.invalid',active:true};S.demoLogin=false;S.page='dashboard';
     financeWorkspaceIdentityBlocked=false;financeLogoutInProgress=false;financeGoogleAccountSwitchInProgress=false;
     CURRENT_PERMISSION_SNAPSHOT={loaded:true,primaryRoleCode:'accountant',permissions:[{permission_code:'finance.page.reports.view',effect:'allow'}]};
     activeDataEnvironment=function(){return 'production';};currentFinanceAuthUserId=function(){return S.user&&S.user.authUserId||'';};currentTenantId=function(){return '10000000-0000-4000-8000-000000000002';};hasSupabase=function(){return true;};
     window.apmCalls=[];getSb=function(){return {rpc:async function(name,args){window.apmCalls.push({name,args});return {data:{actor:{id:S.user.id,name:'合成會計',role:S.user.role},entityId:args.entity_id,entities:[{id:'E1',name:'合成測試公司'}],departments:[],accounts:[],mappings:[],periods:[],previews:[],snapshots:[],obligations:[],corrections:[]}};}};};
     applyRolePermissions();`));
    // Match openFinanceWorkspace's visibility transition without starting its
    // unrelated remote bootstrap; retain the real responsive sidebar layout.
    await page.evaluate(()=>{document.getElementById('sidebar').style.display='flex';document.getElementById('main-wrap').style.display='flex';document.getElementById('login-screen').style.display='none';document.getElementById('auth-loading').style.display='none';});
    ok(await page.evaluate(()=>__apmQA.run("canAccessPage('apmbonus')")),'accountant can enter authorized reporting scope '+engine+width);
    await page.evaluate(()=>nav('apmbonus',document.getElementById('nav-apmbonus')));await page.locator('#pg-apmbonus').getByLabel('公司',{exact:true}).waitFor();
    await page.locator('#pg-apmbonus').getByLabel('公司',{exact:true}).selectOption('E1');
    ok(await page.locator('#pg-apmbonus').getByLabel('公司',{exact:true}).evaluate(n=>n.getBoundingClientRect().height>=44),'company selector retains 44px touch target in real shell '+engine+width);
    ok(await page.evaluate(()=>apmCalls.length===2&&apmCalls.every(x=>x.name==='finance_apm_workbench')),'shell mounts exactly scoped workbench RPC '+engine+width);
    await page.screenshot({path:path.join(output,engine+'-'+width+'.png'),fullPage:true});
    ok(await page.locator('#pg-apmbonus').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'actual shell mount no overflow '+engine+width);
    await page.locator('#pg-apmbonus').getByRole('button',{name:'公司部門對照'}).click();await page.getByText('新增公司部門對照',{exact:true}).click();await page.getByLabel('APM 公司部門識別摘要').fill('未送出測試內容');
    const leaving=page.evaluate(()=>nav('notif',document.getElementById('nav-notif')));await page.getByRole('dialog',{name:'離開季度獎金核對？'}).waitFor();await page.getByRole('button',{name:'留在此頁'}).click();await leaving;
    ok(await page.evaluate(()=>__apmQA.run("S.page==='apmbonus'")),'actual navigation cancel keeps draft '+engine+width);
    const staleLeaving=page.evaluate(()=>nav('notif',document.getElementById('nav-notif')));await page.getByRole('dialog',{name:'離開季度獎金核對？'}).waitFor();
    await page.evaluate(()=>__apmQA.run('setFinanceWorkspaceIdentityBlocked(true)'));await staleLeaving;
    ok(await page.locator('#pg-apmbonus').textContent()==='','identity lock synchronously disposes private UI '+engine+width);
    ok(await page.getByRole('dialog').count()===0,'identity lock closes and settles pending navigation dialog '+engine+width);
    await page.evaluate(()=>__apmQA.run("financeWorkspaceIdentityBlocked=false;S.user.role='employee';CURRENT_PERMISSION_SNAPSHOT.primaryRoleCode='employee';applyRolePermissions();"));
    ok(!await page.evaluate(()=>__apmQA.run("canAccessPage('apmbonus')")),'employee cannot access module '+engine+width);
    ok(await page.locator('#nav-apmbonus').evaluate(n=>n.style.display==='none'),'employee entry hidden '+engine+width);
    const callsBeforeDenied=await page.evaluate(()=>apmCalls.length);
    await page.evaluate(()=>__apmQA.run("S.page='dashboard';buildDash=function(){};"));
    await page.evaluate(()=>nav('apmbonus',null));
    ok(await page.evaluate(()=>__apmQA.run("S.page==='dashboard'")),'direct navigation denies employee '+engine+width);
    ok(await page.evaluate(()=>apmCalls.length)===callsBeforeDenied,'denied direct navigation makes no workbench RPC '+engine+width);
    await page.evaluate(()=>__apmQA.run("S.user.role='ceo';CURRENT_PERMISSION_SNAPSHOT.primaryRoleCode='ceo';CURRENT_PERMISSION_SNAPSHOT.permissions=[{permission_code:'finance.page.reports.view',effect:'deny'}];applyRolePermissions();"));
    ok(!await page.evaluate(()=>__apmQA.run("canAccessPage('apmbonus')")),'CEO denied reporting scope cannot bypass '+engine+width);
    await page.evaluate(()=>__apmQA.run("CURRENT_PERMISSION_SNAPSHOT.permissions=[{permission_code:'finance.page.reports.view',effect:'allow'},{permission_code:'finance.page.apmbonus.view',effect:'deny'}];"));
    ok(!await page.evaluate(()=>__apmQA.run("canAccessPage('apmbonus')")),'explicit module deny cannot bypass '+engine+width);
    await page.evaluate(()=>__apmQA.run("CURRENT_PERMISSION_SNAPSHOT.permissions=[{permission_code:'finance.page.reports.view',effect:'allow'}];activeDataEnvironment=function(){return 'test';};"));
    ok(!await page.evaluate(()=>__apmQA.run("canAccessPage('apmbonus')")),'test environment cannot call production workbench '+engine+width);
    ok(errors.length===0,'actual mount no JS errors '+engine+width);await page.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({checks,failed:0,engines:['chromium','webkit'],viewports:[320,390,768,1440],scope:'Actual 1c4 Finance shell with additive mount; synthetic identity/RPC, no production login or writes'},null,2));console.log(JSON.stringify({checks,failed:0,output}));
}finally{server.close();}
