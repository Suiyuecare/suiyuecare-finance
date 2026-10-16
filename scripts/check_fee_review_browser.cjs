'use strict';
// Local application UI with fictional records. This never authenticates as an
// employee, contacts production APIs, or approves/submits a financial record.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const args=process.argv.slice(2);
function option(key,fallback){const i=args.indexOf(key);return i<0?fallback:args[i+1];}
const root=path.resolve(option('--root',path.basename(__dirname)==='scripts'?path.join(__dirname,'..'):process.cwd()));
const output=path.resolve(option('--output',path.join('/tmp','finance-fee-review-browser-'+Date.now())));
const {applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const playwright=require(require.resolve('playwright',{paths:[root,process.cwd()]}));
const sourcePath=path.join(root,'index.html');
const original=fs.readFileSync(sourcePath,'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const anchor='bootAuthGate();\n\n})();';
assert.ok(original.includes(anchor),'local-only test hook injection anchor exists');
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
html=html.replace(anchor,'window.__feeReviewTest={run:async function(code){return await eval(code);}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  if(file===root||file===sourcePath){response.setHeader('content-type','text/html');response.end(html);return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  response.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
  response.end(fs.readFileSync(file));
});
const feeCases=[
  {id:'company-positive',bearer:'己方支出',amount:15,bankType:'other',bankName:'非兆豐銀行',snapshot:15},
  {id:'counterparty-zero',bearer:'對方支出',amount:0,bankType:'other',bankName:'非兆豐銀行',snapshot:0},
  {id:'mega-zero',bearer:'己方支出',amount:0,bankType:'mega',bankName:'017 兆豐銀行',snapshot:0},
  {id:'unknown-payer',bearer:'',amount:15,bankType:'other',bankName:'匿名其他銀行',snapshot:15},
  {id:'hr-snapshot-mismatch',bearer:'己方支出',amount:0,bankType:'other',bankName:'非兆豐銀行',snapshot:15}
];
const roleCases=[{role:'ceo',active:'ceo',editable:true},{role:'accountant',active:'accountant',editable:true},{role:'employee',active:'ceo',editable:false}];
const results=[];
let checkCount=0;
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);checkCount++;}
function ok(value,message){assert.ok(value,message);checkCount++;}
function fixture(layout,fee,roleCase){
  const line={id:'fictional-line-1',source:layout==='invoice'?'expense_detail':'hr_detail',description:'匿名講師 9B 勞務報酬單',netAmount:3600,taxAmount:0,grossAmount:3600,debitAccount:'6221',debitAccountName:'勞務費',creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'DAYCARE',manualFields:['netAmount','taxAmount','grossAmount'],manualOverride:true,valueAuthority:'human'};
  const formPayload={accountingLines:[line],requestPurpose:'匿名手續費覆核驗收'};
  if(layout==='invoice'){
    line.sourceItemId='fictional-item-1';line.id='line_fictional-item-1';
    formPayload.lazyRows=[{id:'fictional-item-1',no:'AA00000001',date:'2026-10-16',item:line.description,qty:1,unitName:'筆',unitPrice:3600,netAmount:3600,taxAmount:0,grossAmount:3600,total:3600,source:'expense_detail'}];
  }else{
    formPayload.hrInfo={rows:[{'姓名':'匿名講師','類別':'9B','金額':3600}],paymentTotal:3600,total:3600,transferFeeTotal:fee.snapshot,transferFeeRows:fee.snapshot?1:0,transferFeePerRow:15,transferFeeBearer:fee.bearer};
  }
  return {id:'fictional-fee-'+layout+'-'+fee.id,no:'LOCAL-FEE-ONLY',type:layout==='invoice'?'expense_reimbursement':'hr_expense_request',entity_id:'F1',department_code:'DAYCARE',applicant:'林星河',applicant_id:'fixture-employee',applicant_email:'employee@example.invalid',amount:3600,estimated_amount:3600,description:'匿名手續費覆核驗收',status:'pending',step:2,ver:1,request_date:'2026-10-16',bank_type:fee.bankType,bank_name:fee.bankName,bank_account:'匿名測試匯款摘要',bank_fee_amount:fee.amount,fee_bearer:fee.bearer,payee:'匿名收款人',debit_account:'6221',debit_account_name:'勞務費',credit_account:'1112',credit_account_name:'銀行存款',files:[],actual_files:[],form_payload:formPayload,steps:[{rk:'applicant_submit',uid:'fixture-employee',n:'林星河',a:'approved',t:'2026-10-16T00:00:00Z'},{rk:roleCase.active,uid:'fixture-'+roleCase.active,n:roleCase.active==='ceo'?'許晴川':'陳星妤',a:''},{rk:'cashier',uid:'fixture-cashier',n:'葉青禾',a:''}],data_environment:'test'};
}
async function browserCase(engineName,width,origin){
  const launch={headless:true};if(engineName==='chromium'&&process.env.PLAYWRIGHT_CHANNEL)launch.channel=process.env.PLAYWRIGHT_CHANNEL;
  const browser=await playwright[engineName].launch(launch);
  try{
    const context=await browser.newContext({viewport:{width,height:width<600?844:1000}});
    const blocked=[],errors=[],dialogs=[];
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin);await page.waitForFunction(()=>window.__feeReviewTest);
    const scope=code=>page.evaluate(code=>window.__feeReviewTest.run(code),code);
    await scope(`(function(){
      window.__feeNetwork=[];window.__feeDatabaseAccess=[];
      window.fetch=function(input){window.__feeNetwork.push(String(input));return Promise.reject(new Error('No network allowed in fictional fee review'));};
      getSb=function(){window.__feeDatabaseAccess.push('getSb');throw new Error('No database allowed in fictional fee review');};
      USERS=[
        {id:'fixture-employee',n:'林星河',email:'employee@example.invalid',role:'employee',rL:'一般組員',eid:'F1',dc:'DAYCARE',active:true},
        {id:'fixture-ceo',n:'許晴川',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'DAYCARE',active:true},
        {id:'fixture-accountant',n:'陳星妤',email:'accountant@example.invalid',role:'accountant',rL:'會計',eid:'F1',dc:'DAYCARE',active:true},
        {id:'fixture-cashier',n:'葉青禾',email:'cashier@example.invalid',role:'cashier',rL:'出納',eid:'F1',dc:'DAYCARE',active:true}
      ];
      ENTS=[{id:'F1',n:'星河照護股份有限公司',s:'星河照護'}];DEPTS=[{c:'DAYCARE',n:'日間照顧課',eid:'F1',lv:4,active:true}];
      ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];
      BANK_TRANSFER_FEES={F1:99};
    })()`);
    // Full responsive/engine/entry coverage for the two real rendering paths;
    // value edge cases and additional roles run once per desktop engine.
    const scenarios=[];
    for(const layout of ['hr','invoice'])for(const view of ['detail','approval'])
      scenarios.push({roleCase:roleCases[0],layout,fee:feeCases[layout==='hr'?1:0],view});
    if(width===1440){
      for(const fee of [feeCases[2],feeCases[3],feeCases[4],feeCases[0]])
        scenarios.push({roleCase:roleCases[0],layout:'hr',fee,view:'detail'});
      scenarios.push({roleCase:roleCases[1],layout:'hr',fee:feeCases[0],view:'approval'});
      scenarios.push({roleCase:roleCases[2],layout:'invoice',fee:feeCases[0],view:'detail'});
    }
    for(const scenario of scenarios){
        const {roleCase,layout,fee,view}=scenario;
        await scope(`markNRClean();quickLogin(${JSON.stringify(roleCase.role)});`);
        const data=fixture(layout,fee,roleCase);
        await scope(`(function(){closeAppr();var raw=${JSON.stringify(data)};raw.tenant_id=currentTenantId();REQS=[mapReq(raw)];})()`);
        const before=await scope(`(function(){var r=REQS[0];return JSON.stringify({actor:S.user.id,id:r.id,amount:r.amt,fee:r.bankFeeAmount,bearer:r.feeBearer,steps:r.steps,formPayload:r.formPayload});})()`);
        {
          const label=[engineName,width,roleCase.role,layout,fee.id,view].join('/');
          await scope(view==='detail'?'closeAppr();openDetail(REQS[0].id);':'showApprD(REQS[0]);');
          const host=view==='detail'?'#detail-body':'#appr-inner';
          const summary=page.locator(host+' .accounting-bank-fee-review');
          equal(await summary.count(),1,label+' has one dedicated fee review');
          await summary.scrollIntoViewIfNeeded();
          ok(await summary.isVisible(),label+' fee review visible');
          const bearer=await summary.locator('[data-fee-bearer]').innerText();
          const feeText=await summary.locator('[data-fee-amount]').innerText();
          if(fee.bearer)ok(bearer.includes(fee.bearer),label+' displays persisted fee bearer');
          else ok(/未填|待確認/.test(bearer),label+' does not invent a missing fee bearer');
          const amountMatch=feeText.replace(/,/g,'').match(/(?:NT\$|\$)?\s*(\d+(?:\.\d+)?)/);
          ok(amountMatch,label+' fee amount is readable');
          equal(Number(amountMatch[1]),fee.amount,label+' displays saved fee, not current fee setting 99');
          const text=await summary.innerText();
          ok(text.includes('手續費負擔')&&text.includes('公司手續費'),label+' labels explain the two values');
          if(layout==='hr'&&fee.id==='hr-snapshot-mismatch')ok(/不一致|待確認|核對/.test(text),label+' HR fee snapshot discrepancy is visible');
          equal(await summary.locator('input,select,textarea').count(),0,label+' summary does not expose unsaved fee controls');
          const prefix=view==='detail'?'detail-acct-line':'appr-acct-line';
          const gross=page.locator('#'+prefix+'-gross-0');
          if(roleCase.editable){
            equal(await gross.count(),1,label+' principal field remains editable');
            equal(await gross.inputValue(),'3600',label+' fee is not mixed into principal');
          }else equal(await gross.count(),0,label+' applicant does not gain accounting edit controls');
          const geometry=await summary.evaluate(element=>{const b=element.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,scroll:element.scrollWidth,client:element.clientWidth,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth};});
          ok(geometry.left>=-1&&geometry.right<=width+1,label+' fee review stays within viewport');
          ok(geometry.scroll<=geometry.client+1,label+' fee summary text does not overflow');
          ok(geometry.documentWidth<=width+1,label+' document has no horizontal overflow');
          const after=await scope(`(function(){var r=REQS[0];return JSON.stringify({actor:S.user.id,id:r.id,amount:r.amt,fee:r.bankFeeAmount,bearer:r.feeBearer,steps:r.steps,formPayload:r.formPayload});})()`);
          equal(after,before,label+' review does not mutate identity, fees, accounting lines or approval history');
          if(roleCase.role==='ceo'&&((view==='approval'&&['company-positive','counterparty-zero'].includes(fee.id))||(view==='detail'&&fee.id==='hr-snapshot-mismatch'))){
            await page.screenshot({path:path.join(output,[engineName,width,layout,fee.id].join('-')+'.png')});
          }
          results.push({engine:engineName,width,role:roleCase.role,layout,feeCase:fee.id,view,bearer,feeText,geometry});
        }
    }
    equal(errors,[],engineName+'/'+width+' no page errors');
    equal(dialogs,[],engineName+'/'+width+' no unexpected dialogs');
    equal(await scope('window.__feeNetwork'),[],engineName+'/'+width+' no API fetch');
    equal(await scope('window.__feeDatabaseAccess'),[],engineName+'/'+width+' no database access');
    await context.close();
  }finally{await browser.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const engineName of ['chromium','webkit'])for(const width of [1440,390])await browserCase(engineName,width,origin);
  equal(sha(fs.readFileSync(sourcePath)),sha(original),'browser acceptance does not change application source');
  const report={status:'pass',root,sourceSha256:sha(original),scope:'Local real UI with fictional account roles and records; no production request, Google sign-in, database writes or financial actions.',cases:results.length,checks:checkCount,results,output};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,cases:report.cases,checks:report.checks,output}));
})().catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,stack:error.stack,checks:checkCount,results},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));});
