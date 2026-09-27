'use strict';
// Real local UI + fictional permitted records; remote requests are blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');let browser,page;const errors=[];
const output=process.env.APPROVAL_SELECTION_EVIDENCE||'/tmp/finance-approval-search-selection-20260927';
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert(html.includes(anchor));
html=html.replace(anchor,'window.__selectionTest={run:async function(code){return await eval(code);}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
// Use the project's locked Playwright runtime so the same real-DOM test runs
// locally and in CI without a global browser CLI installation.
async function b(command,...args){
 if(command==='open'){await page.goto(args[0]);return;}
 if(command==='snapshot')return;
 if(command==='set'){await page.setViewportSize({width:Number(args[1]),height:Number(args[2])});return;}
 if(command==='check'){await page.locator(args[0]).check();return;}
 if(command==='click'){await page.locator(args[0]).first().click();return;}
 if(command==='fill'){await page.locator(args[0]).fill(args[1]);return;}
 if(command==='screenshot'){await page.screenshot({path:args[0],fullPage:true});return;}
 if(command==='errors')return errors.join('\n');
}
async function scope(code){return page.evaluate(code=>window.__selectionTest.run(code),code);}
(async()=>{
  fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const chrome=process.env.CHROME_PATH||(fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':null);
  browser=await chromium.launch({headless:true,...(process.env.FINANCE_BROWSER_CHANNEL==='chromium'?{}:chrome?{executablePath:chrome}:{})});page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await b('open','http://127.0.0.1:'+server.address().port);await b('snapshot','-i');
  await scope([
    "USERS=[{id:'fixture-ceo',n:'匿名測試主管',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'E1',dc:'D1',active:true}];",
    "ENTS=[{id:'E1',s:'測試公司',full:'測試公司',active:true}];DEPTS=[{c:'D1',n:'測試部門',eid:'E1',lv:3,active:true}];",
    "REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');",
    "REQS=Array.from({length:51},function(_,index){return mapReq({id:'fixture-'+(index+1),no:'REQ-'+String(index+1).padStart(3,'0'),entity_id:'E1',department_code:'D1',type:'payment_request',amount:100+index,applicant_id:'fixture-ceo',applicant:'匿名測試主管',description:index===0?'A&B <原件> \"報支\"':'測試支出 '+(index+1),request_date:'2026-09-27',status:'pending_ceo',step:1,steps:[{r:'執行長',rk:'ceo',uid:'fixture-ceo',a:'',status:'pending_ceo'}],data_environment:activeDataEnvironment(),tenant_id:currentTenantId()});});",
    "INVS=[{id:'batch-one',no:'INV-001',buyer:'客戶甲',desc:'代表單摘要',total:700},{id:'batch-two',no:'INV-002',buyer:'客戶乙',desc:'後續單獨有描述 A&B',total:550},{id:'batch-hidden',no:'INV-HIDDEN',buyer:'不屬於此清單客戶',desc:'禁止搜尋的兄弟單',total:99999}].map(function(row){return Object.assign(row,{eid:'E1',dc:'D1',batchId:'fixture-batch',applicant:'匿名測試主管',applicantId:'fixture-ceo',date:'2026/09/27',approvalStatus:'pending_ceo',approvalStep:1,steps:[{r:'執行長',rk:'ceo',uid:'fixture-ceo',a:''}],rowVersion:1,dataEnv:activeDataEnvironment(),tenantId:currentTenantId()});});",
    "window.__fixtureItems=REQS.map(function(raw){return{kind:'req',raw:raw};});",
    "approvalAllItems=function(){return window.__fixtureItems;};approvalPendingCandidateItems=function(items){return items;};approvalActionableItems=function(items){return items;};approvalItemActionRows=function(item){return item.rows||[item.raw];};",
    "S.apprSortByTab={p:{field:'formNo',dir:'asc'},cashier:{field:'formNo',dir:'asc'}};",
    "nav('approvals');S.aT='p';S.apprQuery='';S.apprPage=1;buildApprovals();true"
  ].join('\n'));
  const evidence=[];
  for(const width of [1440,390]){
    await b('set','viewport',String(width),'1000');
    await scope("S.aT='p';S.apprQuery='';S.apprPage=1;resetApprovalPageSelection();window.__fixtureItems=REQS.map(function(raw){return {kind:'req',raw:raw};});buildApprovals();true");
    await b('snapshot','-i');
    await b('check','[data-appr-key="req:fixture-1"] .appr-pick');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 1 筆');
    await b('click','#appr-list button[onclick="apprPage(2)"]');await b('snapshot','-i');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 0 筆');
    await b('check','[data-appr-key="req:fixture-51"] .appr-pick');
    assert.deepEqual(await scope("selectedApprovalItems().map(function(item){return item.raw.id;})"),['fixture-51']);
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 1 筆');
    await b('fill','#appr-q','A&B');await b('snapshot','-i');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 0 筆');
    assert.deepEqual(await scope("Array.from(document.querySelectorAll('#appr-list tbody tr')).map(function(row){return row.dataset.apprKey;})"),['req:fixture-1']);
    assert.equal(await scope("document.querySelector('#appr-list .summary-cell').querySelector('img')===null"),true);
    await b('screenshot',path.join(output,'raw-search-'+width+'.png'));
    await scope("window.__fixtureItems=[{kind:'inv',raw:INVS[0],rows:INVS.slice(0,2)}];S.aT='mine';S.apprQuery='';S.apprPage=1;buildApprovals();true");
    for(const query of ['後續單獨有描述','客戶乙','INV-002','A&B','550.00']){
      await b('fill','#appr-q',query);
      assert.equal(await scope("document.querySelectorAll('#appr-list tbody tr').length"),1,query);
    }
    await b('fill','#appr-q','不屬於此清單客戶');
    assert.equal(await scope("document.querySelectorAll('#appr-list tbody tr').length"),0,'Only the explicit permitted members are indexed');
    const size=await scope('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert(size.scrollWidth<=width,JSON.stringify(size));
    evidence.push({width,pageSelection:true,searchClearsSelection:true,rawCharacters:true,escapedDisplay:true,laterBatchFields:true,hiddenSiblingExcluded:true,noOverflow:true});
  }
  assert.equal((await b('errors')).trim(),'');
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify({ok:true,evidence,scope:'Actual local DOM with fictional permitted rows. External requests blocked; no real OAuth or production mutations.'},null,2));
  console.log(JSON.stringify({ok:true,evidence,output}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
