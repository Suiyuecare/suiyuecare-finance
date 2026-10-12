'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out='/tmp/finance-month-asset-browser-20261011';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const css=['assets/styles/finance-core.css','assets/styles/mobile-operations.css','assets/styles/finance-completion.css'].map(read).join('\n');
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-TW"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'body{display:block;overflow:auto;padding:16px;box-sizing:border-box}main{max-width:1200px;margin:auto;min-width:0}</style><main><div id="month"></div><div id="assets"></div></main></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.FINANCE_BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'})});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);
  await page.addScriptTag({content:read('assets/engines/month-close-workspace.js')});await page.addScriptTag({content:read('assets/engines/asset-amortization-workspace.js')});
  await page.evaluate(async()=>{
   const month={entityId:'A',period:'2026-08',environment:'test',sourceFingerprint:'testhash',ledgerSummary:{count:2,debit:200,credit:200,balanced:true},bank:{status:'no_import_record',importCount:0,unmatchedCount:0},payroll:{status:'not_applicable_test_environment'},assets:{status:'pending_amortization',scheduledCount:1,pendingCount:1},periodCloses:[],canPrepare:true,profileConfigured:false,archiveCount:0,verifiedArchiveCount:0};
   window.assetData={entityId:'A',period:'2026-08',environment:'test',canWrite:true,items:[]};window.assetCalls=[];window.failSave=true;
   const runtime={user:()=>({id:'fixture-accountant'}),tenant:()=> 'fixture',environment:()=> 'test',accounts:()=>[{c:'6224',n:'折舊費用'},{c:'1419',n:'累計折舊'}],rpc:async(name,args)=>{window.assetCalls.push({name,args});if(name==='finance_month_workspace_v1')return{data:month};if(name==='finance_asset_workspace_v1')return{data:window.assetData};if(name==='finance_asset_sources_v1')return{data:{total:1,offset:0,limit:50,items:[{id:'11111111-1111-1111-1111-111111111111',date:'2026-08-01',description:'測試用正式資產分錄：長名稱設備一套ABCDEFGHIJKLMN'.repeat(3),accountCode:'1411',referenceNo:'TEST-ONLY',availableCents:20000,departmentCode:'D1'}]}};if(name==='finance_asset_save_v1'){if(window.failSave)return{error:{message:'測試連線失敗，資料仍保留'}};window.assetData.items=[{id:args.p_id,revision:1,data:args.p_data,amountCents:6333,postedCents:0,schedule:[{period:'2026-08',amountCents:6333,remainingCents:13667},{period:'2026-09',amountCents:6333,remainingCents:7334},{period:'2026-10',amountCents:6334,remainingCents:1000}]}];return{data:{id:args.p_id,revision:1}};}throw new Error('Unexpected fixture RPC '+name);}};
   FinanceMonthCloseWorkspace.installRuntime(runtime);FinanceAssetAmortizationWorkspace.installRuntime(runtime);
   await FinanceMonthCloseWorkspace.mount(document.querySelector('#month'),{entityId:'A',period:'2026-08'}).ready;
   await FinanceAssetAmortizationWorkspace.mount(document.querySelector('#assets'),{entityId:'A',period:'2026-08'}).ready;
  });
  await page.getByRole('button',{name:'登錄資產／預付費用'}).click();await page.getByRole('button',{name:'搜尋來源'}).click();await page.getByRole('button',{name:'選取此分錄'}).click();
  await page.locator('[name=name]').fill('臺北測試設備及辦公作業器具（僅驗收，不是真實資產）');await page.locator('[name=residual]').fill('10');await page.locator('[name=months]').fill('3');await page.locator('[name=expenseAccount]').selectOption('6224');await page.locator('[name=offsetAccount]').selectOption('1419');await page.locator('[name=reason]').fill('虛構來源核對');
  for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width);await page.screenshot({path:path.join(out,'form-'+width+'.png'),fullPage:true});}
  await page.getByRole('button',{name:'儲存登錄'}).click();await page.getByText('測試連線失敗，資料仍保留').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'臺北測試設備及辦公作業器具（僅驗收，不是真實資產）');
  const firstId=await page.evaluate(()=>assetCalls.find(x=>x.name==='finance_asset_save_v1').args.p_id);await page.evaluate(()=>{window.failSave=false;});await page.getByRole('button',{name:'儲存登錄'}).click();await page.getByText('已儲存登錄；尚未產生費用，需提出每月方案並由另一人覆核。').waitFor();
  assert.equal(await page.evaluate(()=>assetCalls.filter(x=>x.name==='finance_asset_save_v1').at(-1).args.p_id),firstId,'retry retains register id to prevent duplicate asset');
  for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'list no horizontal overflow at '+width);}
  await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'large text no horizontal overflow');
  await page.screenshot({path:path.join(out,'registered-390.png'),fullPage:true});
  console.log('PASS browser: actual styles at 360/390/768/1440, source selection and saving, errors preserve fields and register id, large text. Artifacts: '+out);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
