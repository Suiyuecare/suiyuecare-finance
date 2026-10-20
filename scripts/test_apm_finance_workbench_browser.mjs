import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {chromium,webkit} from 'playwright';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const output=path.resolve(process.env.APM_FINANCE_BROWSER_OUTPUT||path.join(os.tmpdir(),'apm-finance-workbench-browser-20261020'));
const files={
 '/workbench.js':await fs.readFile(path.join(root,'assets/engines/apm-bonus-workbench.js')),
 '/workbench.css':await fs.readFile(path.join(root,'assets/styles/apm-bonus-workbench.css')),
 '/core.css':await fs.readFile(path.join(root,'assets/styles/finance-core.css'))
};
const html='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/workbench.css"><style>html,body{min-height:100%;height:auto}body{display:block;margin:0;padding:0;background:var(--cream)}header{padding:16px 20px;border-bottom:1px solid #eedfc8;background:var(--brxxl);font-weight:700}main{padding:20px;min-width:0;max-width:1160px;margin:auto}@media(max-width:600px){main{padding:12px}header{padding:16px}}</style></head><body><header>歲悅長照集團 / 會計系統</header><main><div id="mount"></div></main><script src="/workbench.js"></script></body></html>';
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);}else if(files[req.url]){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(files[req.url]);}else{res.writeHead(404);res.end();}});
let checks=0;const results=[];const ok=(value,label)=>{assert.ok(value,label);checks++;results.push(label);};
async function setup(page,options={}){
 await page.evaluate(opt=>{
  if(window.FinanceApmBonusWorkbench)FinanceApmBonusWorkbench.dispose();
  window.identity='identity-one';window.rpcCalls=[];window.mode=opt.mode||'ok';window.deferred=[];window.testRole=opt.role||'accountant';window.testUser=opt.user||'acc';
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  window.ids={mapping:id(1),company:id(2),department:id(3),preview:id(4),paid:id(5),unpaid:id(6),correction:id(7),originalBatch:id(8),correctionBatch:id(9)};
  window.fixture={actor:{id:window.testUser,name:window.testUser==='acc'?'測試會計':'測試執行長',role:window.testRole},entityId:null,entities:[{id:'E1',name:'歲悅示範股份有限公司（虛構測試資料）'}],departments:[{code:'D1',name:'新北居家服務督導課（測試）'}],accounts:[{code:'4110',name:'居家照顧服務收入'},{code:'4120',name:'其他照顧收入'}],periods:[{year:2026,quarter:3}],mappings:[{id:id(1),department_code:'D1',apm_company_id:id(2),apm_department_id:id(3),account_codes:['4110'],created_by:'acc',proposerName:'測試會計',active:true,reference:'測試公司與部門正式核對依據',decisions:[{decision:'verified',actorName:'測試執行長',reference:'測試執行長確認部門對照'}]}],previews:[{id:id(4),actorId:opt.previewActor||'acc',actorName:opt.previewActor==='ceo'?'測試執行長':'測試會計',previewHash:'a'.repeat(64),evidence:{mappingId:id(1),year:2026,quarter:3,value:1234567.8912,ledgerCount:28,accountCodes:['4110']}}],snapshots:[],obligations:[{id:id(5),flowId:id(50),period:'2026-Q3',payDate:'2026-10-25',status:'closed',paid:true,totalNetCents:100000,originalVoucherNumber:'V2610-001',reversals:[{id:'reversal-test',number:'V2610-003',total:1000}]},{id:id(6),period:'2026-Q3',payDate:'2026-10-25',status:'pending_bank_upload',paid:false,totalNetCents:200000,reversals:[]}],corrections:[{id:id(7),obligationId:id(5),period:'2026-Q3',proposerId:'acc',proposerName:'測試會計',reference:'測試更正回執提案核對紀錄',refund:{amountCents:100000,reference:'測試銀行退款已入帳紀錄',sha256:'b'.repeat(64)},originalBatchId:id(8),correctionBatchId:id(9),correctionSourceHash:'c'.repeat(64),reversalVoucherNumber:'V2610-003',receipt:null}]};
  window.client={rpc:async(name,args)=>{
   window.rpcCalls.push({name,args:structuredClone(args)});
   if(window.testRole==='employee'||window.mode==='denied')return {error:{code:'42501',message:'FINANCE_APM_FORBIDDEN'}};
   if(window.mode==='deferred')return new Promise(resolve=>window.deferred.push(resolve));
   if(name==='finance_apm_workbench'){
    if(window.mode==='read-error')throw Error('PRIVATE DO NOT DISPLAY');
    const data=structuredClone(window.fixture);data.entityId=args.entity_id;if(!args.entity_id)for(const k of ['departments','accounts','periods','mappings','previews','snapshots','obligations','corrections'])data[k]=[];
    return {data};
   }
   if(window.mode==='unknown'){window.mode='ok';throw Error('network uncertainty');}
   if(window.mode==='malformed')return {data:{}};
   if(window.mode==='conflict')return {error:{code:'40001',message:'FINANCE_APM_SOURCE_CHANGED'}};
   const cmd=args.command,p=args.payload;let data;
   if(cmd==='snapshot.preview')data={previewHash:'a'.repeat(64),evidence:window.fixture.previews[0].evidence};
   else if(cmd==='snapshot.approve'){window.fixture.previews=[];data={status:'approved',snapshot:{value:1234567.8912}};}
   else if(cmd==='mapping.propose')data={status:'pending_verification',mappingId:id(10)};
   else if(cmd==='mapping.verify')data={status:'verified'};
   else if(cmd==='mapping.revoke')data={status:'revoked'};
   else if(cmd==='propose')data={status:'pending_independent_verification',proposalId:id(11)};
   else if(cmd==='verify'){window.fixture.corrections[0].receipt={receiptId:id(12),originalNetCents:100000};window.fixture.corrections[0].verifierName='測試執行長';data={status:'verified',receipt:window.fixture.corrections[0].receipt};}
   return {data};
  }};
  FinanceApmBonusWorkbench.mount(document.getElementById('mount'),{client:window.client,isCurrent:()=>window.identity==='identity-one',timeoutMs:opt.timeoutMs||1000});
 },options);
 if(options.role==='employee'||options.mode==='deferred')return;
 await page.getByLabel('公司',{exact:true}).selectOption('E1');
 await page.waitForFunction(()=>document.querySelector('[data-apm-content]')?.textContent.includes('季度營收'));
}
async function settled(page){await page.waitForFunction(()=>document.querySelector('[data-apm-status]')?.textContent.includes('操作已保存'));}
async function tab(page,name){await page.getByRole('button',{name,exact:true}).click();}
async function noOverflow(page,label){ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),label+' no horizontal overflow');}
try{
 await fs.mkdir(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 for(const [engine,type]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   for(const width of[320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port);
    await setup(page);await noOverflow(page,engine+' '+width+' revenue');
    ok(await page.locator('.apm-bonus-tabs button[aria-pressed=true]').evaluate(n=>getComputedStyle(n).color==='rgb(255, 255, 255)'&&getComputedStyle(n).backgroundColor!==getComputedStyle(n.nextElementSibling).backgroundColor),'selected tab uses distinct orange with white text '+engine+width);
    ok(await page.getByRole('button',{name:'核定並提供 APM'}).count()===0,'preparer cannot approve own revenue '+engine+width);
    ok((await page.locator('#mount').innerText()).includes('1,234,567.8912'),'revenue keeps four-decimal accounting precision '+engine+width);
    await page.screenshot({path:path.join(output,engine+'-'+width+'-revenue.png'),fullPage:true});
    await tab(page,'公司部門對照');await page.getByText('新增公司部門對照',{exact:true}).click();await noOverflow(page,engine+' '+width+' mapping');
    await page.getByRole('button',{name:'送交對照覆核'}).click();ok(await page.locator('[aria-invalid=true]').count()===1,'mapping invalid source focuses field '+engine+width);
    await page.getByLabel('APM 公司部門識別摘要').fill(await page.evaluate(()=>JSON.stringify({schemaVersion:1,apmCompanyId:ids.company,apmDepartmentId:ids.department})));
    await page.getByLabel('Finance 入帳部門').selectOption('D1');await page.getByRole('checkbox',{name:'4110 居家照顧服務收入'}).check();await page.locator('form[data-apm-form=mapping]').getByLabel('核對依據').fill('已核對 APM 公司及 Finance 部門來源');
    await page.screenshot({path:path.join(output,engine+'-'+width+'-mapping.png'),fullPage:true});
    await tab(page,'更正回執');await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'留在此頁'}).click();ok(await page.getByLabel('APM 公司部門識別摘要').inputValue()!=='','dirty mapping remains after cancel navigation '+engine+width);
    await page.getByRole('button',{name:'送交對照覆核'}).click();await settled(page);
    ok(await page.evaluate(()=>rpcCalls.some(x=>x.args.command==='mapping.propose'&&x.args.payload.departmentCode==='D1'&&x.args.payload.accountCodes[0]==='4110')),'mapping sends chosen verified candidates '+engine+width);
    await tab(page,'更正回執');await page.getByLabel('原獎金付款來源').selectOption(await page.evaluate(()=>ids.unpaid));
    ok((await page.locator('#mount').innerText()).includes('目前此入口無法處理未付款取消'),'unpaid source explicitly blocked '+engine+width);
    ok(!await page.getByRole('button',{name:'送交更正回執覆核'}).isVisible(),'unpaid source has no misleading action '+engine+width);
    await page.getByLabel('原獎金付款來源').selectOption(await page.evaluate(()=>ids.paid));
    await page.getByLabel('APM 更正案件識別摘要').fill(await page.evaluate(()=>JSON.stringify({schemaVersion:1,correctionBatchId:ids.correctionBatch,originalBatchId:ids.originalBatch,correctionSourceHash:'c'.repeat(64)})));
    await page.getByLabel('已入帳的完整沖銷傳票').selectOption('reversal-test');await page.getByLabel('退款銀行交易或對帳紀錄').fill('測試銀行全額退款核對紀錄');
    await page.getByLabel('全額退款佐證（最多 10 MB）').setInputFiles({name:'synthetic-refund.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic refund evidence only')});
    await page.getByRole('checkbox',{name:'已核對全額退款入帳，且所選沖銷傳票與原款一致'}).check();await page.locator('form[data-apm-form=correction]').getByLabel('核對依據').fill('測試原款與沖銷傳票已全額核對完成');
    await noOverflow(page,engine+' '+width+' correction');await page.screenshot({path:path.join(output,engine+'-'+width+'-correction.png'),fullPage:true});
    await page.getByRole('button',{name:'送交更正回執覆核'}).click();await settled(page);
    ok(await page.evaluate(()=>rpcCalls.some(x=>x.args.command==='propose'&&x.args.payload.refund.amountCents===100000&&/^[a-f0-9]{64}$/.test(x.args.payload.refund.sha256)&&x.args.payload.reversalVoucherId==='reversal-test')),'refund selected original amount and local evidence digest '+engine+width);
    await setup(page,{role:'ceo',user:'ceo'});await page.getByRole('checkbox',{name:'我已核對部門、季度、科目與營收金額'}).check();await page.getByRole('button',{name:'核定並提供 APM'}).click();await settled(page);
    ok(await page.evaluate(()=>rpcCalls.some(x=>x.args.command==='snapshot.approve'&&x.args.payload.previewHash==='a'.repeat(64))),'independent reviewer uses exact saved preview '+engine+width);
    await tab(page,'更正回執');await page.locator('form[data-apm-form="correction.verify"]').getByLabel('核對依據').fill('測試另一人完成原款退款沖銷核對');await page.getByRole('button',{name:'確認核對並建立回執'}).click();await settled(page);
    ok((await page.locator('#mount').innerText()).includes('已由：測試執行長 核定'),'completed record names actual reviewer '+engine+width);
    await setup(page,{role:'employee'});await page.getByRole('alert').waitFor();ok(!(await page.locator('#mount').innerText()).includes('1,234'),'employee denial clears private data '+engine+width);
    ok(errors.length===0,'no JS errors '+engine+width);await page.close();
   }
   const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port);
   await setup(page,{user:'ceo',role:'ceo'});await page.evaluate(()=>mode='unknown');await page.getByRole('checkbox',{name:'我已核對部門、季度、科目與營收金額'}).check();await page.getByRole('button',{name:'核定並提供 APM'}).click();await page.getByRole('button',{name:'以相同內容重試'}).waitFor();
   await page.getByRole('button',{name:'以相同內容重試'}).click();await settled(page);ok(await page.evaluate(()=>{var calls=rpcCalls.filter(x=>x.args.command==='snapshot.approve');return calls.length===2&&JSON.stringify(calls[0])===JSON.stringify(calls[1]);}),'unknown response retry preserves body and key '+engine);
   await setup(page,{user:'ceo',role:'ceo'});await page.evaluate(()=>mode='malformed');await page.getByRole('checkbox',{name:'我已核對部門、季度、科目與營收金額'}).check();await page.getByRole('button',{name:'核定並提供 APM'}).click();await page.getByRole('button',{name:'以相同內容重試'}).waitFor();ok(!(await page.locator('#mount').innerText()).includes('操作已保存'),'malformed success does not claim saved '+engine);
   await setup(page,{user:'ceo',role:'ceo'});await page.evaluate(()=>mode='conflict');await page.getByRole('checkbox',{name:'我已核對部門、季度、科目與營收金額'}).check();await page.getByRole('button',{name:'核定並提供 APM'}).click();await page.waitForFunction(()=>document.querySelector('[data-apm-status]').textContent.includes('來源資料已更新'));ok(await page.getByRole('checkbox').isChecked(),'version conflict preserves input '+engine);
   await setup(page);await page.evaluate(()=>mode='denied');await page.getByRole('button',{name:'重新讀取'}).click();await page.getByRole('alert').waitFor();ok(!await page.getByLabel('公司',{exact:true}).count(),'revocation clears company and sources '+engine);
   await setup(page);await page.evaluate(()=>mode='read-error');await page.getByRole('button',{name:'重新讀取'}).click();await page.waitForFunction(()=>document.querySelector('[data-apm-status]').textContent.includes('資料讀取失敗'));
   ok(!await page.getByRole('button',{name:'公司部門對照',exact:true}).count()&&!(await page.locator('#mount').innerText()).includes('1,234'),'failed refresh cannot resurrect old private sources through tabs '+engine);
   await page.evaluate(()=>mode='ok');await page.getByRole('button',{name:'重新讀取'}).click();await page.getByLabel('公司',{exact:true}).waitFor();ok(await page.getByLabel('公司',{exact:true}).inputValue()==='E1','failed read retry keeps exact requested company scope '+engine);
   await setup(page);await page.evaluate(()=>identity='identity-two');await page.waitForFunction(()=>document.getElementById('mount').textContent==='');ok(true,'identity switch clears idle private UI '+engine);
   await setup(page,{mode:'deferred'});await page.waitForFunction(()=>deferred.length===1);await page.evaluate(()=>{identity='identity-two';deferred[0]({data:fixture});});await page.waitForFunction(()=>document.getElementById('mount').textContent==='');ok(true,'late response cannot restore former identity '+engine);
   await page.close();
  }finally{await browser.close();}
 }
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,failed:0,engines:['chromium','webkit'],viewports:[320,390,768,1440],scope:'actual standalone Finance UI, synthetic authorized RPC transport; database authorization separately verified; no production writes',results},null,2));
 console.log(JSON.stringify({checks,failed:0,output}));
}finally{server.close();}
