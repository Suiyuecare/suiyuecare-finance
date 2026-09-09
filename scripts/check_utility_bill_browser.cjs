'use strict';
// Real local UI + fictional records. No OAuth, real accounts, API requests or
// production mutations. Test hooks exist only in the localhost HTML response.
// NODE_PATH=<directory containing playwright> PLAYWRIGHT_CHANNEL=chrome \
//   node scripts/check_utility_bill_browser.cjs [--output /tmp/evidence]
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const output=path.resolve(args.includes('--output')?args[args.indexOf('--output')+1]:path.join('/tmp','finance-utility-bill-browser-'+Date.now()));
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const anchor='bootAuthGate();\n\n})();';
assert.ok(original.includes(anchor),'known local-only closure injection point');
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
html=html.replace(anchor,'window.__utilityTest={run:async function(code){return await eval(code);}};\n'+anchor);
html=html.replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');res.end(html);return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));
});
const rows=[
 {no:'AA00000001',date:'2026-09-09',item:'水費11508',qty:1,unitName:'期',unitPrice:136,netAmount:130,taxAmount:6,grossAmount:136,total:136,taxMode:'gross_inclusive'},
 {no:'AA00000002',date:'2026-09-09',item:'電費',qty:1,unitName:'期',unitPrice:1050,netAmount:1000,taxAmount:50,grossAmount:1050,total:1050,taxMode:'gross_inclusive'},
 {no:'AA00000003',date:'2026-09-09',item:'一般文具',qty:1,unitName:'批',unitPrice:1050,netAmount:1000,taxAmount:50,grossAmount:1050,total:1050,taxMode:'gross_inclusive'}
];
const expected=[{net:136,tax:0,gross:136},{net:1050,tax:0,gross:1050},{net:1000,tax:50,gross:1050}];
// Saved human-reviewed lines exercise explicit correction auditing, while the
// new-request fixture above exercises unreviewed imported/recognized bills.
const reviewedLines=rows.map((r,i)=>({id:'line_'+(i+1),description:r.item,source:'detail',netAmount:r.netAmount,taxAmount:r.taxAmount,grossAmount:r.grossAmount,debitAccount:i<2?'6202':'6201',debitAccountName:i<2?'水電費':'文具用品',creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'DAYCARE',manualOverride:true,valueAuthority:'human',manualFields:['netAmount','taxAmount','grossAmount'],reviewedBy:'虛構原覆核人'}));
const priorAudit={operationId:'fixture-prior-review',at:'2026-09-08T00:00:00Z',source:'approval_detail_review',actor:{id:'fixture-prior-reviewer',name:'虛構原覆核人',email:'prior@example.invalid',role:'accountant'},changes:{netAmount:{before:136,after:130},taxAmount:{before:0,after:6}},beforeValues:{netAmount:136,taxAmount:0,grossAmount:136},afterValues:{netAmount:130,taxAmount:6,grossAmount:136}};
reviewedLines[0].manualOverrideHistory=[priorAudit];
let browser;
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/';
 const {chromium}=require('playwright');
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),blocked=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(url).origin||u.protocol==='data:'||u.protocol==='blob:')return route.continue();blocked.push(route.request().url());return route.abort();});
 const page=await context.newPage(),errors=[],dialogs=[];page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 await page.goto(url);await page.waitForFunction(()=>window.__utilityTest);
 const scope=code=>page.evaluate(code=>window.__utilityTest.run(code),code);
 await scope(`(async()=>{
   window.__utilityNetwork=[];window.__utilityWrites=[];
   window.fetch=function(input){window.__utilityNetwork.push(String(input));return Promise.reject(new Error('Unexpected network in offline utility fixture'));};
   getSb=function(){throw new Error('No database client is allowed in this offline UI fixture');};
   USERS=[{id:'fixture-employee',n:'林星河',email:'employee@example.invalid',role:'employee',rL:'一般組員',eid:'F1',dc:'DAYCARE',active:true},{id:'fixture-ceo',n:'許晴川',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'DAYCARE',active:true},{id:'fixture-cashier',n:'葉青禾',email:'cashier@example.invalid',role:'cashier',rL:'出納',eid:'F1',dc:'DAYCARE',active:true}];
   ENTS=[{id:'F1',n:'星河照護股份有限公司',s:'星河照護'}];DEPTS=[{c:'DAYCARE',n:'日間照顧課',eid:'F1',lv:4,active:true}];
   ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];
   quickLogin('employee');await nav('newreq');nrT('expense_reimbursement');
   S.lazyRows=${JSON.stringify(rows)};renderLazySheet();applyLazySummary();
   el('nr-desc-purpose').value='虛構水電與文具費用';markNRClean();
 })()`);
 // A local mode chooser is incidental to creating this fixture; close only it.
 await scope(`document.querySelectorAll('.modal-overlay').forEach(function(m){if(m.textContent.includes('懶惰還是認真'))m.style.display='none';});`);
 async function amounts(prefix){return page.evaluate(prefix=>[0,1,2].map(i=>Object.fromEntries(['net','tax','gross'].map(k=>[k,Number(document.getElementById(prefix+'-'+k+'-'+i).value)]))),prefix);}
 assert.deepEqual(await amounts('lazy'),expected,'initial utility bills retain gross with no input tax; ordinary stationery retains tax');
 for(const i of [0,1]){
   assert.equal(await page.locator('#lazy-tax-'+i).getAttribute('readonly'),'');
   assert.equal(await page.locator('#lazy-mode-'+i).isDisabled(),true);
   assert.equal(await page.locator('#lazy-utility-note-'+i).innerText(),'水電帳單全額列費用，不拆進項稅');
 }
 assert.equal(await page.locator('#lazy-tax-2').isEditable(),true,'ordinary invoice tax remains editable');
 const metrics=[];
 async function capture(name,width,selector){
   await page.setViewportSize({width,height:width<600?844:1000});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.locator(selector).evaluate(e=>e.scrollIntoView({block:'center'}));
   const m=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
   assert.ok(m.documentWidth<=width,'no document overflow: '+name+' '+width);metrics.push({name,...m});
   await page.screenshot({path:path.join(output,name+'-'+width+'.png')});
 }
 for(const width of [1440,390])await capture('new-request',width,'#lazy-utility-note-0');
 await capture('new-request-amounts',390,'#lazy-tax-0');
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#lazy-gross-0').fill('200');await page.locator('#lazy-gross-0').dispatchEvent('change');
 assert.deepEqual((await amounts('lazy'))[0],{net:200,tax:0,gross:200},'editing gross synchronizes utility expense with zero tax');
 await page.locator('#lazy-net-0').fill('136');await page.locator('#lazy-net-0').dispatchEvent('change');
 assert.deepEqual((await amounts('lazy'))[0],expected[0],'editing utility expense synchronizes gross');
 const itemSelector='#lazy-sheet input[onchange*="\\\'item\\\'"]';
 const itemInputs=page.locator(itemSelector);
 assert.equal(await itemInputs.count(),3,'actual row item controls are located');
 await itemInputs.nth(2).fill('電費');await itemInputs.nth(2).dispatchEvent('change');
 assert.equal(await page.locator('#lazy-tax-2').isEditable(),false,'switching ordinary item to utility immediately locks tax');
 assert.deepEqual((await amounts('lazy'))[2],{net:1050,tax:0,gross:1050},'item switch does not add a second tax amount');
 await itemInputs.nth(2).fill('一般文具');await itemInputs.nth(2).dispatchEvent('change');
 assert.equal(await page.locator('#lazy-tax-2').isEditable(),true,'switching back to ordinary item restores editable tax');
 assert.equal(await page.locator('#lazy-mode-2').isDisabled(),false,'switching back restores tax mode control');
 assert.equal(await page.locator('#lazy-utility-note-2').isVisible(),false,'utility-only hint hides on ordinary item');
 // Restore the independently documented invoice amounts through actual inputs.
 await page.locator('#lazy-net-2').fill('1000');await page.locator('#lazy-net-2').dispatchEvent('change');
 await page.locator('#lazy-tax-2').fill('50');await page.locator('#lazy-tax-2').dispatchEvent('change');
 assert.deepEqual(await amounts('lazy'),expected,JSON.stringify(await scope('S.lazyRows[2]')));
 assert.equal(await scope('lazySum()'),2236,'mixed principal remains 2236');
 await scope(`(async()=>{
   markNRClean();quickLogin('ceo');
   var r=mapReq({id:'utility-ceo-fixture',no:'LOCAL-UTILITY-001',type:'expense_reimbursement',entity_id:'F1',department_code:'DAYCARE',applicant:'林星河',applicant_id:'fixture-employee',amount:2236,description:'虛構水電與文具費用',status:'pending',step:2,ver:1,bank_fee_amount:15,bank_fee_payer:'company',debit_account:'6202',credit_account:'1112',credit_account_name:'銀行存款',form_payload:{lazyRows:${JSON.stringify(rows)},accountingLines:${JSON.stringify(reviewedLines)}},steps:[{rk:'applicant_submit',uid:'fixture-employee',n:'林星河',a:'approved'},{rk:'ceo',uid:'fixture-ceo',n:'許晴川',a:''},{rk:'cashier',uid:'fixture-cashier',n:'葉青禾',a:''}],tenant_id:currentTenantId(),data_environment:'test'});
   REQS=[r];window.__utilityBeforeBank=r.amt+requestBankFeeAmount(r);openDetail(r.id);
   // Capture the commit-boundary input; calculations, collection, permissions,
   // work-copy preparation and the visible approval handler remain real.
   expenseActiveStepTransaction=async function(rows,action,comment,files,addUid,patches){window.__utilityWrites.push({action:action,patches:cloneSettingValue(patches)});return {available:true,ok:true};};
 })()`);
 assert.equal(await scope('canActRequest(REQS[0])'),true,'fictional CEO is the assigned active reviewer');
 assert.deepEqual(await amounts('detail-acct-line'),expected,'CEO review uses utility gross as expense');
 assert.equal(await page.locator('#detail-acct-line-tax-0').isEditable(),false,'CEO utility tax is readonly');
 assert.equal(await page.locator('#detail-acct-line-tax-2').isEditable(),true,'CEO ordinary tax remains editable');
 for(const width of [1440,390])await capture('ceo-review',width,'#detail-acct-line-tax-0');
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#detail-acct-line-net-0').fill('150');await page.locator('#detail-acct-line-net-0').dispatchEvent('change');
 assert.deepEqual((await amounts('detail-acct-line'))[0],{net:150,tax:0,gross:150});
 await page.locator('#detail-acct-line-gross-0').fill('136');await page.locator('#detail-acct-line-gross-0').dispatchEvent('change');
 assert.deepEqual((await amounts('detail-acct-line'))[0],expected[0]);
 await page.locator('#detail-act button').filter({hasText:'核准此申請'}).click();
 await page.waitForFunction(()=>window.__utilityWrites.length===1);
 const saved=await scope(`(function(){var patch=window.__utilityWrites[0].patches['utility-ceo-fixture'];if(!patch)return null;var work=cloneSettingValue(REQS[0]);work.amt=patch.amount;work.formPayload=Object.assign({},work.formPayload,{accountingLines:patch.accounting_lines});var entries=entriesFromAccountingLines(work,patch.amount,requestBankFeeAmount(work));return {action:window.__utilityWrites[0].action,amount:patch.amount,lines:patch.accounting_lines.map(function(x){return {net:x.netAmount,tax:x.taxAmount,gross:x.grossAmount};}),bankBefore:window.__utilityBeforeBank,bankAfter:entries.filter(function(x){return x.t==='cr'&&x.ac==='1112';}).reduce(function(s,x){return s+x.amt;},0),inputTax:entries.filter(function(x){return x.t==='dr'&&x.ac==='1144';}).reduce(function(s,x){return s+x.amt;},0),waterAudit:patch.accounting_lines[0].manualOverrideHistory||[],policy:patch.accounting_line_policy};})()`);
 assert.ok(saved,'real approval handler supplies accounting transaction patch');
 assert.deepEqual(saved.lines,expected);assert.equal(saved.amount,2236);assert.equal(saved.bankAfter,saved.bankBefore,'utility normalization does not increase bank payout');assert.equal(saved.inputTax,50,'only stationery produces input tax');
 assert.ok(saved.waterAudit.some(x=>x.actor.id==='fixture-ceo'&&x.changes.taxAmount&&x.changes.taxAmount.before===6&&x.changes.taxAmount.after===0),'CEO correction records the previous human tax and the new zero tax');
 assert.deepEqual(saved.waterAudit.find(x=>x.operationId===priorAudit.operationId),priorAudit,'previous human audit entry remains unchanged');
 assert.deepEqual(errors,[],'no page errors');assert.deepEqual(dialogs,[],'no unexpected error/confirmation dialogs');assert.deepEqual(await scope('window.__utilityNetwork'),[],'no API requests');
 const sourceAfter=sha(fs.readFileSync(path.join(root,'index.html')));
 const report={root,sourceSha256:sha(original),sourceAfterSha256:sourceAfter,scope:'localhost source UI, fictional employee/CEO, mocked transaction boundary; no real OAuth, DB or posting',fixture:rows,metrics,saved,errors,dialogs,blockedExternalRequests:blocked,output};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
