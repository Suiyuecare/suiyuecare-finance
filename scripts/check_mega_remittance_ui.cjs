'use strict';
// Browser-only lifecycle tests. All identities and payments are fictional; the
// serializer is a spy. The separate engine suite verifies real XLSX roundtrips.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(process.env.FINANCE_MEGA_ROOT||path.resolve(__dirname,'..'));
const {chromium,webkit}=require(require.resolve('playwright',{paths:[root,__dirname]}));
const output=path.resolve(process.env.FINANCE_MEGA_UI_EVIDENCE||'/tmp/finance-mega-ui-evidence');
const files={
  '/engine.js':fs.readFileSync(path.join(root,'assets/engines/mega-remittance-engine.js')),
  '/ui.js':fs.readFileSync(path.join(root,'assets/engines/mega-remittance-ui.js')),
  '/core.css':fs.readFileSync(path.join(root,'assets/styles/finance-core.css'))
};
const html='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/core.css"><style>body{margin:0;padding:16px;background:var(--cream)}main{max-width:900px;margin:auto;min-width:0}*{box-sizing:border-box}</style></head><body><main><button id="outside">原簽核操作</button><div id="mount"></div></main><script src="/engine.js"></script><script src="/ui.js"></script></body></html>';
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(files[req.url]){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(files[req.url]);return;}res.writeHead(404);res.end();});
let checks=0;function ok(value,label){assert.ok(value,label);checks++;console.log('ok '+checks+' - '+label);}

async function setup(page,overrides={}){
  await page.evaluate(config=>{
    if(window.ui)window.ui.clear();
    window.identity='qa-user|qa-tenant|test|permission-1';window.spies={reads:0,libraries:0,writes:0,saves:[],supplements:[]};window.pending=[];window.readMode=config.readMode||'normal';window.saveMode='normal';
    window.source={ok:true,authorized:true,eligible:true,stage:'pending_cashier',exportPurpose:'payment',requestId:'qa-request',requestNo:'QA-ONLY-001',sourceVersion:1,sourceDigest:'opaque-digest-1',mode:'bulk',rows:[{name:'虛構收款戶名甲',account:'000000001234',bankCode:'0170000',amount:1200}],expectedTotal:1200,issues:[],canSupplement:false,supplementRows:[],entityLabel:'虛構付款公司',paymentDate:'2026-10-20',feeBearer:'己方支出',companyFee:0};
    Object.assign(window.source,config.snapshot||{});
    const serializer={write(book){window.spies.writes++;window.lastBook=book;return new Uint8Array([80,75,3,4,1,2,3,4]);}};
    window.ui=FinanceMegaRemittanceUI.create({
      identityKey:()=>window.identity,
      timeoutMs:config.timeoutMs||2000,
      readSnapshot:async id=>{window.spies.reads++;if(window.readMode==='hang')return new Promise(()=>{});if(window.readMode==='reject')throw Error('private-error-source-value');if(window.readMode==='deferred')return new Promise(resolve=>window.pending.push({id,resolve}));return structuredClone(window.source);},
      ensureXlsx:async()=>{window.spies.libraries++;return serializer;},
      buildXlsx:(input,library)=>FinanceMegaRemittance.buildXlsx(input,library),
      saveBytes:(bytes,metadata)=>{window.spies.saves.push({bytes:Array.from(bytes),filename:metadata.filename});},
      saveSupplement:async(id,digest,rows)=>{window.spies.supplements.push({id,digest,rows});if(window.saveMode==='reject')throw Error('private-supplement-error');for(const row of rows){if(row.name)window.source.rows[0].name=row.name;if(row.bankCode)window.source.rows[0].bankCode=row.bankCode;}window.source.sourceVersion++;window.source.sourceDigest='opaque-digest-'+window.source.sourceVersion;window.source.issues=[];window.source.supplementRows=[];return {ok:true};}
    });
    window.mounted=window.ui.mount(document.getElementById('mount'),'qa-request');
  },overrides);
}
async function state(page,status){await page.waitForFunction(wanted=>window.ui.getState().status===wanted&&!window.ui.getState().busy,status);}
async function readSpies(page){return page.evaluate(()=>({reads:spies.reads,libraries:spies.libraries,writes:spies.writes,saves:spies.saves.length,supplements:spies.supplements.length}));}
async function clickDownload(page){await page.getByRole('button',{name:'下載 Excel',exact:true}).click();await page.waitForFunction(()=>!ui.getState().busy);}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);
    await setup(page);await state(page,'ready');
    ok(JSON.stringify(await readSpies(page))===JSON.stringify({reads:1,libraries:1,writes:1,saves:0,supplements:0}),'cashier detail automatically prepares exactly once without downloading or mutating');
    const rendered=await page.locator('#mount').innerText();
    ok(rendered.includes('兆豐匯款檔')&&rendered.includes('整批匯款 · 1 筆 · NT$1,200'),'ready panel displays format, count and principal total');
    ok(!rendered.includes('虛構收款戶名甲')&&!rendered.includes('000000001234')&&!rendered.includes('opaque-digest'),'recipient cells and source digest stay out of rendered HTML');
    ok(rendered.includes('虛構付款公司')&&rendered.includes('2026-10-20')&&rendered.includes('己方支出')&&rendered.includes('公司手續費 NT$0'),'separate entity, payment date and fee summary preserves explicit zero without changing bank file columns');
    ok(await page.getByRole('button',{name:'原簽核操作'}).isEnabled(),'preparation does not block existing approval actions');
    await page.screenshot({path:path.join(output,'desktop-ready.png'),fullPage:true});
    await clickDownload(page);
    ok((await readSpies(page)).reads===2&&(await readSpies(page)).saves===1,'download re-reads current authorization/source and generates fresh bytes');
    ok(await page.evaluate(()=>spies.saves[0].filename==='兆豐_整批匯款_QA-ONLY-001.xlsx'),'download uses a safe deterministic bank-format filename');

    await setup(page);await state(page,'ready');
    await page.evaluate(()=>{source.sourceDigest='changed';source.sourceVersion=2;source.rows[0].amount=1800;source.expectedTotal=1800;});
    await clickDownload(page);
    ok((await readSpies(page)).saves===0&&(await page.locator('#mount').innerText()).includes('資料已更新'),'changed bank source is refreshed and needs a second explicit download');
    await clickDownload(page);ok((await readSpies(page)).saves===1,'second download succeeds only after the new version is reconfirmed');

    await setup(page);await state(page,'ready');await page.evaluate(()=>{source.authorized=false;source.ok=false;});await clickDownload(page);
    ok((await page.evaluate(()=>ui.getState())).status==='denied'&&(await readSpies(page)).saves===0&&!await page.getByRole('button',{name:'下載 Excel',exact:true}).count(),'permission revocation discards file and disables download');
    ok(!(await page.locator('#mount').innerText()).includes('NT$'),'revocation clears the former private summary');
    await setup(page,{snapshot:{authorized:undefined}});await state(page,'denied');ok((await readSpies(page)).writes===0,'unknown authorization fails closed');
    await setup(page);await state(page,'ready');await page.evaluate(()=>{source.ok=false;source.issues=[{field:'payDate',code:'payment_date_missing'}];source.sourceDigest='missing-date';});await clickDownload(page);
    ok((await page.evaluate(()=>ui.getState())).status==='missing'&&await page.evaluate(()=>ui.getState().totalAmount===null&&!ui.getState().hasFile)&&(await readSpies(page)).saves===0,'new invalid source discards the old ready amount and file');
    ok((await page.locator('#mount').innerText()).includes('預計匯款日期：請確認有效'),'resolver failure displays actionable missing field rather than a permission error');

    for(const stage of ['pending_ceo','completed','unknown']){
      await setup(page,{snapshot:{stage}});await state(page,'unavailable');
      ok((await readSpies(page)).writes===0,'unsupported stage '+stage+' produces no file');
    }
    await setup(page,{snapshot:{expectedTotal:1500}});await state(page,'missing');
    ok(!(await page.evaluate(()=>ui.getState().hasFile))&&(await page.locator('#mount').innerText()).includes('明細合計與已核定的匯款本金不一致'),'principal mismatch never exposes a partial or wrong-total file');
    await setup(page,{snapshot:{expectedTotal:null}});await state(page,'missing');ok((await readSpies(page)).writes===0,'unknown approved principal never falls back to the requested amount');

    const historical={exportPurpose:'historical',stage:'completed',submittedAt:'2026-10-02T01:00:00Z',submissionSource:'server_created_at',historyCutoff:'2026-09-30T16:00:00Z',paidAt:'2026-10-03T01:00:00Z',sourceBasis:'current_saved_reconstruction'};
    await setup(page,{snapshot:historical});await state(page,'ready');
    ok((await page.locator('#mount').innerText()).includes('已付款歷史補檔，勿重複匯款')&&!(await page.locator('#mount').innerText()).includes('銀行系統檢核及執行匯款'),'historical mode shows reconstruction warning without inviting another bank payment');
    ok(await page.getByRole('button',{name:'下載歷史 Excel',exact:true}).isDisabled(),'historical download requires explicit acknowledgement');
    await page.evaluate(()=>ui.download());ok((await readSpies(page)).saves===0&&(await readSpies(page)).reads===1,'direct download invocation cannot bypass history acknowledgement');
    await page.getByRole('checkbox',{name:'已知為已付款歷史檔，不會再次送銀行匯款'}).check();
    await page.getByRole('button',{name:'下載歷史 Excel',exact:true}).click();await state(page,'ready');
    ok((await readSpies(page)).saves===1&&await page.evaluate(()=>spies.saves[0].filename==='已付款_歷史補檔_勿重複匯款_兆豐_整批匯款_QA-ONLY-001.xlsx'),'acknowledged history freshly checks and downloads unmistakably marked filename');
    await page.evaluate(()=>{source.sourceDigest='history-new-version';source.sourceVersion++;});
    await page.getByRole('button',{name:'下載歷史 Excel',exact:true}).click();await state(page,'ready');
    ok((await readSpies(page)).saves===1&&!(await page.getByRole('checkbox').isChecked())&&await page.getByRole('button',{name:'下載歷史 Excel',exact:true}).isDisabled(),'changed historical version requires a new acknowledgement before any download');
    await page.getByRole('checkbox').check();await page.evaluate(()=>{source.authorized=false;});await page.getByRole('button',{name:'下載歷史 Excel',exact:true}).click();await state(page,'denied');
    ok(!await page.getByRole('checkbox').count()&&!(await page.locator('#mount').innerText()).includes('NT$')&&(await readSpies(page)).saves===1,'history revocation removes consent, private amount and file');
    for(const invalid of [{sourceBasis:''},{paidAt:''},{submittedAt:'2026-09-30T15:59:59Z'},{submissionSource:'request_date'},{historyCutoff:'2026-01-01T00:00:00Z'}]){
      await setup(page,{snapshot:{...historical,...invalid}});await state(page,'unavailable');ok((await readSpies(page)).writes===0,'incomplete or out-of-range historical authority fails closed: '+Object.keys(invalid)[0]);
    }
    await setup(page,{snapshot:{eligible:false,exportPurpose:'waiting',stage:'pending_ceo',reasonCode:'waiting_approval'}});await state(page,'waiting');
    ok((await readSpies(page)).writes===0&&await page.getByRole('button',{name:'重新確認',exact:true}).count()===1,'waiting request explains approval prerequisite without generating bytes');
    await setup(page,{snapshot:{eligible:false,exportPurpose:'unavailable',stage:'cancelled',reasonCode:'cancelled_or_rejected'}});await state(page,'unavailable');
    ok((await page.locator('#mount').innerText()).includes('已取消或駁回')&&(await readSpies(page)).writes===0,'cancelled or rejected request has no usable bank export');
    await setup(page,{snapshot:{...historical,ok:false,issues:[{field:'expectedTotal',code:'principal_mismatch'}]}});await state(page,'missing');
    ok(!await page.getByRole('checkbox').count()&&(await readSpies(page)).writes===0,'historical principal mismatch cannot be acknowledged or downloaded');

    await setup(page,{readMode:'deferred'});await page.waitForFunction(()=>pending.length===1);
    await page.evaluate(()=>{identity='different-user';pending[0].resolve(structuredClone(source));});
    await page.waitForFunction(()=>ui.getState().status==='idle');
    ok(await page.locator('#mount').innerText()===''&&(await readSpies(page)).writes===0,'late read for previous identity clears context without rendering or generating');

    await setup(page,{readMode:'deferred'});await page.waitForFunction(()=>pending.length===1);
    await page.evaluate(()=>{ui.mount(document.getElementById('mount'),'qa-new');});await page.waitForFunction(()=>pending.length===2);
    await page.evaluate(()=>{const second=structuredClone(source);second.requestId='qa-new';second.expectedTotal=2300;second.rows[0].amount=2300;pending[1].resolve(second);pending[0].resolve(structuredClone(source));});await state(page,'ready');
    ok(await page.evaluate(()=>ui.getState().totalAmount===2300)&&(await readSpies(page)).writes===1,'rapid record navigation ignores the older delayed response');

    await setup(page,{readMode:'hang',timeoutMs:60});await state(page,'error');
    ok((await page.locator('#mount').innerText()).includes('逾時')&&(await readSpies(page)).writes===0,'bounded timeout settles into recoverable error state');
    await page.evaluate(()=>{readMode='normal';});await page.getByRole('button',{name:'重試',exact:true}).click();await state(page,'ready');ok((await readSpies(page)).writes===1,'retry recovers after network timeout');
    await setup(page,{readMode:'reject'});await state(page,'error');ok(!(await page.locator('#mount').innerText()).includes('private-error'),'raw exception and source text are never rendered');

    await setup(page,{snapshot:{issues:[{row:1,field:'bankCode',code:'unknown-server-code',message:'<img src=x onerror=alert(1)>private-data'}]}});await state(page,'missing');
    ok((await readSpies(page)).writes===0&&!await page.locator('#mount img').count()&&!(await page.locator('#mount').innerText()).includes('private-data'),'unknown source errors render only safe field labels without PII or HTML');
    await setup(page);await state(page,'ready');await page.evaluate(()=>{readMode='deferred';ui.download();ui.download();});await page.waitForFunction(()=>pending.length===1);await page.evaluate(()=>pending[0].resolve(structuredClone(source)));await state(page,'ready');
    ok((await readSpies(page)).reads===2&&(await readSpies(page)).saves===1,'double click produces one fresh check and one download');

    const missing={rows:[{name:'',account:'000000001234',bankCode:'',amount:1200}],canSupplement:true,supplementRows:[{rowKey:'payment:1',row:1,fields:['name','bankCode','account','amount']}]};
    await setup(page,{snapshot:missing});await state(page,'missing');
    ok(await page.locator('#mount input').count()===2,'authorized supplement editor exposes only name and bank code');
    await page.getByRole('button',{name:'儲存並重新產製',exact:true}).click();
    ok(await page.locator('#mount input[aria-invalid="true"]').count()===2&&await page.evaluate(()=>document.activeElement.dataset.field==='name')&&(await readSpies(page)).supplements===0,'empty supplement uses inline errors, first-invalid focus and no native validation bubble');
    ok(await page.locator('#mount form').getAttribute('novalidate')!==null,'supplement form delegates validation to accessible inline help');
    await page.getByLabel('收款戶名',{exact:true}).fill('虛構補件戶名');await page.getByLabel('銀行代號',{exact:true}).fill('0170000');
    await page.getByRole('button',{name:'儲存並重新產製',exact:true}).click();await state(page,'ready');
    ok(await page.evaluate(()=>spies.supplements.length===1&&spies.supplements[0].digest==='opaque-digest-1'&&Object.keys(spies.supplements[0].rows[0]).sort().join(',')==='bankCode,name,rowKey'),'supplement save uses expected digest and cannot edit approved account or amount');
    ok((await readSpies(page)).reads===3&&(await readSpies(page)).saves===0,'supplement save re-reads server state and regenerates without automatic download');

    await setup(page,{snapshot:missing});await state(page,'missing');await page.getByLabel('收款戶名',{exact:true}).fill('虛構補件戶名');await page.getByLabel('銀行代號',{exact:true}).fill('0170000');
    await page.evaluate(()=>{source.sourceDigest='other-edit';source.sourceVersion=2;source.rows=[{name:'虛構已補資料',account:'000000001234',bankCode:'0170000',amount:1200}];source.supplementRows=[];});
    await page.getByRole('button',{name:'儲存並重新產製',exact:true}).click();await state(page,'ready');
    ok((await readSpies(page)).supplements===0&&(await page.locator('#mount').innerText()).includes('資料已更新'),'concurrent supplement change is reloaded without overwriting another editor');

    await setup(page,{snapshot:missing});await state(page,'missing');await page.getByLabel('收款戶名',{exact:true}).fill('虛構暫存戶名');await page.getByLabel('銀行代號',{exact:true}).fill('0170000');await page.evaluate(()=>{saveMode='reject';});
    await page.getByRole('button',{name:'儲存並重新產製',exact:true}).click();await state(page,'error');await page.getByRole('button',{name:'重試',exact:true}).click();await state(page,'missing');
    ok(await page.getByLabel('收款戶名',{exact:true}).inputValue()==='虛構暫存戶名','failed supplement retains typed values only for the same source digest');
    await page.evaluate(()=>{source.sourceDigest='different-approved-rows';source.sourceVersion++;});await page.getByRole('button',{name:'重試',exact:true}).click();await state(page,'missing');
    ok(await page.getByLabel('收款戶名',{exact:true}).inputValue()==='','changed approved version discards old supplement drafts rather than applying them to a different payee');

    await setup(page,{snapshot:{...missing,canSupplement:false}});await state(page,'missing');ok(await page.locator('#mount input').count()===0,'read-only viewers receive no supplement fields');
    await setup(page,{snapshot:{mode:'payroll',rows:[{name:'虛構薪轉收款人',identityNo:'A000000000',account:'000000001234',bankCode:'017',amount:1200}],excludedCount:2}});await state(page,'ready');
    ok((await page.locator('#mount').innerText()).includes('薪轉 · 1 筆')&&(await page.locator('#mount').innerText()).includes('2 筆現金項目'),'payroll format and explicit excluded cash count are visible');
    ok(!(await page.locator('#mount').innerText()).includes('A000000000'),'payroll identity is never rendered');

    await page.setViewportSize({width:375,height:812});await page.screenshot({path:path.join(output,'mobile-ready.png'),fullPage:true});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'375px panel has no horizontal overflow');
    ok(await page.locator('#mount button').evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height>=44)),'every panel action retains a 44px touch target');
    await page.getByRole('button',{name:'下載 Excel',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!ui.getState().busy);
    ok((await readSpies(page)).saves===1,'keyboard Enter activates the native download button');
    await setup(page,{snapshot:missing});await state(page,'missing');await page.screenshot({path:path.join(output,'mobile-missing-fields.png'),fullPage:true});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'missing-data editor fits a narrow viewport');
    await page.evaluate(()=>ui.clear());ok(await page.locator('#mount').innerText()===''&&await page.evaluate(()=>!ui.getState().hasFile&&ui.getState().totalAmount===null),'clear releases prepared files and private summaries');
    ok(errors.length===0,'Chromium emits no uncaught browser errors');
  }finally{await browser.close();}
  const safari=await webkit.launch({headless:true}),safariPage=await safari.newPage({viewport:{width:375,height:812}});
  try{await safariPage.goto('http://127.0.0.1:'+server.address().port);await setup(safariPage);await state(safariPage,'ready');await clickDownload(safariPage);ok((await readSpies(safariPage)).saves===1,'WebKit completes automatic preparation and fresh-check download');ok(await safariPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'WebKit narrow layout does not overflow');}finally{await safari.close();}
  console.log('Passed '+checks+' Mega remittance UI checks. Evidence: '+output);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
