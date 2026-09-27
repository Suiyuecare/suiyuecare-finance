'use strict';
// Local application with fictional records. No employee login or remote writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {applyBuildEnvironment}=require('./finance_build_environment');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.ACCOUNTING_CONTROLS_EVIDENCE||'/tmp/finance-accounting-controls-20260927';
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert(html.includes(anchor));html=html.replace(anchor,'window.__accountingControls={run:async function(code){return await eval(code);}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));});
let browser;
(async()=>{fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.FINANCE_BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'})});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin||/^(blob|data):/.test(route.request().url())?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());await page.goto(origin);await page.waitForFunction(()=>window.__accountingControls);
  const run=code=>page.evaluate(code=>window.__accountingControls.run(code),code);
  await run(`(async()=>{
    USERS=[{id:'fictional-ceo',n:'虛構會計測試人',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'ADMIN',active:true}];
    ENTS=[{id:'F1',n:'虛構測試法人',full:'虛構測試法人',s:'虛構測試',active:true}];DEPTS=[{c:'ADMIN',n:'虛構行政部門',eid:'F1',active:true}];ORG_CHART=[];
    REQS=[];INVS=[];BILLS=[];NOTIFS=[];PERIOD_CLOSES=[];ARCHIVES=[];ANNUAL_REVIEWS=[];AUDIT_LOGS=[];
    quickLogin('ceo');todayIso=function(){return'2026-09-27';};todaySlash=function(){return'2026/09/27';};todayMonth=function(){return'2026-09';};
    VOUCHERS=[{id:'fixture-voucher',no:'V-fixture',eid:'F1',date:'2026/09/01',total:0.30,desc:'小額傳票',posted:true,entries:[{t:'dr',ac:'6200',an:'費用',amt:0.30},{t:'cr',ac:'1112',an:'銀行',amt:0.30}]}];
    LEDGER=[{id:'dr',eid:'F1',date:'2026/09/01',ac:'6200',dr:0.30,cr:0,dataEnv:'test'},{id:'cr',eid:'F1',date:'2026/09/01',ac:'1112',dr:0,cr:0.30,dataEnv:'test'}];
    auditLog=async function(){return{ok:true};};nextVoucherNo=async function(){return'RV-fictional';};recordBackupEvent=async function(action,status){window.__backupEvents=(window.__backupEvents||[]).concat([{action:action,status:status}]);};
    await nav('compliance');el('comp-ent').value='F1';el('comp-period').value='2026-09';buildCompliance();
  })()`);
  await page.locator('#adj-amount').fill('0.30');assert.equal(await page.locator('#adj-amount').getAttribute('step'),'0.01');assert.equal(await page.locator('#adj-amount').evaluate(input=>input.validity.stepMismatch),false);
  await page.locator('#adj-reason').fill('虛構測試：沖銷小額');await page.getByRole('button',{name:'建立調整',exact:true}).click();
  const precision=await run(`({amount:VOUCHERS[0].total,entries:VOUCHERS[0].entries.map(function(e){return e.amt;}),display:fmt(VOUCHERS[0].total)})`);assert.deepEqual(precision,{amount:0.30,entries:[0.30,0.30],display:'NT$0.30'});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下載備份包',exact:true}).click();const downloaded=await downloadPromise;const file=path.join(out,'fictional-backup.json');await downloaded.saveAs(file);const pkg=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(pkg.version,2);assert.match(pkg.fileHash,/^[a-f0-9]{64}$/);
  const original=await run('JSON.stringify(VOUCHERS)');await run(`(async()=>{S.demoLogin=false;S.restorePackage=${JSON.stringify(pkg)};await restoreBackupPackage();})()`);assert.equal(await run('JSON.stringify(VOUCHERS)'),original);assert.deepEqual(await run('window.__backupEvents.slice(-1)'),[{action:'validation',status:'verified'}]);
  assert(await page.getByRole('button',{name:'封存本期原件',exact:true}).count());assert(await page.getByRole('button',{name:'驗證封存原件',exact:true}).count());
  for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.locator('#pg-compliance').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'viewport overflow '+width);await page.screenshot({path:path.join(out,'controls-'+width+'.png'),fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS accounting controls real browser: decimal input/voucher/display, verified backup download, formal validation-only import, archive actions, desktop/mobile layout');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
