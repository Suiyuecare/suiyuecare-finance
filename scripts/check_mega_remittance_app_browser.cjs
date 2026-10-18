'use strict';
// Actual application routes/renderers + local fictional RPC fixtures. No Google
// account is used and no production request, approval or payment is executed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FINANCE_MEGA_ROOT||path.resolve(__dirname,'..'));
const output=path.resolve(process.env.FINANCE_MEGA_APP_EVIDENCE||'/tmp/finance-mega-app-evidence');
const {applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const playwright=require(require.resolve('playwright',{paths:[root,__dirname]}));
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const XLSX_SHA='c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
const XLSX_URL='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const anchor='bootAuthGate();\n\n})();';
assert.ok(original.includes(anchor),'local QA hook anchor exists');
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__megaAppQA={run:async function(code){return await eval(code);}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'').replace('</head>','<script src="/__qa/xlsx.js"></script></head>');
let xlsxBytes,XLSX,server,checks=0;const results=[];
function ok(value,label){assert.ok(value,label);checks++;console.log('ok '+checks+' - '+label);}
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;console.log('ok '+checks+' - '+label);}
async function xlsxDependency(){
  const filename=process.env.FINANCE_MEGA_XLSX_PATH||path.join(os.tmpdir(),'finance-mega-xlsx-0.18.5.cjs');
  if(!fs.existsSync(filename)){
    if(process.env.FINANCE_MEGA_XLSX_PATH)throw Error('FINANCE_MEGA_XLSX_PATH does not exist');
    const response=await fetch(XLSX_URL,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Pinned XLSX test dependency download failed');
    const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),XLSX_SHA,'downloaded XLSX matches fixed dependency hash');fs.writeFileSync(filename,bytes,{mode:0o600});
  }
  xlsxBytes=fs.readFileSync(filename);assert.equal(sha(xlsxBytes),XLSX_SHA,'XLSX test dependency matches fixed hash');XLSX=require(filename);
}
function rawRequest(kind='bulk'){
  const request={id:'qa-mega-'+kind,no:'QA-MEGA-'+kind.toUpperCase(),type:'payment_request',entity_id:'QA-F1',department_code:'QA-D1',applicant:'虛構申請人',applicant_id:'qa-employee',applicant_email:'qa.employee@example.invalid',amount:1200,estimated_amount:1200,description:'虛構兆豐匯款整合驗收',status:'pending_cashier',step:3,ver:1,request_date:'2026-10-18',expected_pay_date:'2026-10-20',bank_type:'mega',bank_name:'017 兆豐銀行',bank_no:'000000001234',bank_fee_amount:0,fee_bearer:'己方支出',payee:'虛構收款戶名甲',debit_account:'6299',debit_account_name:'其他費用',credit_account:'1112',credit_account_name:'銀行存款',files:[],actual_files:[],form_payload:{paymentType:'bank'},steps:[{rk:'applicant_submit',uid:'qa-employee',n:'虛構申請人',a:'approved',t:'2026-10-18T00:00:00Z'},{rk:'ceo',uid:'qa-ceo',n:'虛構主管',a:'approved',t:'2026-10-18T00:01:00Z'},{rk:'cashier',uid:'qa-cashier',n:'虛構出納',a:''}],data_environment:'test'};
  if(kind==='payroll'){
    request.type='hr_expense_request';request.amount=request.estimated_amount=3500;request.form_payload.hrItem='salary_50';
    request.form_payload.hrInfo={item:{id:'salary_50'},paymentTotal:3500,total:3500,rows:[{name:'虛構薪轉甲',identityNo:'A000000000',bankCode:'017',account:'000000001234',amount:1200},{name:'虛構薪轉乙',identityNo:'B000000000',bankCode:'0040001',account:'000000005678',amount:2300}]};
  }
  if(kind==='refund'){
    request.type='refund_request';request.amount=request.estimated_amount=1800;request.form_payload.refundInfo={rows:[{accountName:'虛構退費甲',accountNo:'000000001234',bankCode:'0170000',refundAmount:1200,method:'銀行轉帳'},{accountName:'虛構現金乙',refundAmount:600,method:'現金'}]};
  }
  return request;
}
const fixtureSetup=`(async function(){
  window.__qaReads=[];window.__qaWrites=[];window.__qaNetwork=[];window.__qaSupplements=[];window.__qaSnapshot=null;window.__qaDenied=false;window.__qaRpcCode='';
  window.fetch=function(input){window.__qaNetwork.push(String(input));return Promise.reject(new Error('Fixture does not access production'));};
  USERS=[
    {id:'qa-employee',authUserId:'qa-auth-employee',init:'虛',n:'虛構申請人',email:'qa.employee@example.invalid',role:'employee',rL:'一般組員',eid:'QA-F1',dc:'QA-D1',active:true},
    {id:'qa-ceo',authUserId:'qa-auth-ceo',init:'虛',n:'虛構主管',email:'qa.ceo@example.invalid',role:'ceo',rL:'執行長',eid:'QA-F1',dc:'QA-D1',active:true},
    {id:'qa-cashier',authUserId:'qa-auth-cashier',init:'虛',n:'虛構出納',email:'qa.cashier@example.invalid',role:'cashier',rL:'出納',eid:'QA-F1',dc:'QA-D1',active:true}
  ];
  ENTS=[{id:'QA-F1',n:'虛構付款公司',s:'虛構付款公司',active:true}];DEPTS=[{c:'QA-D1',n:'虛構部門',eid:'QA-F1',lv:4,active:true}];
  ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];BANK_TRANSFER_FEES={'QA-F1':15};
  quickLogin('cashier');await new Promise(resolve=>setTimeout(resolve,60));
  S.demoLogin=false;CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:'qa-auth-cashier',membershipUserId:'qa-cashier',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};
  financeUsersDirectoryAuthUserId='qa-auth-cashier';financeUsersDirectoryReadyAt='2026-10-18T00:00:00Z';
  setFinanceWorkspaceIdentityBlocked(false);hasSupabase=function(){return true;};
  var mock={rpc:async function(name,args){
    if(name==='finance_mega_remittance_snapshot_v1'){
      window.__qaReads.push({name:name,id:args.p_request_id,environment:args.p_data_environment});
      if(window.__qaDenied)return {data:null,error:{code:'42501'}};
      if(window.__qaRpcCode)return {data:null,error:{code:window.__qaRpcCode}};
      return {data:{ok:true,request:structuredClone(window.__qaSnapshot),sourceVersion:window.__qaSnapshot.ver,sourceDigest:'opaque-qa-digest-'+window.__qaSnapshot.ver,supplements:structuredClone(window.__qaSupplements),canSupplement:true},error:null};
    }
    if(name==='finance_mega_remittance_supplement_save_v1'){
      window.__qaWrites.push({name:name,rows:structuredClone(args.p_rows),digest:args.p_expected_digest});
      if(args.p_expected_digest!=='opaque-qa-digest-'+window.__qaSnapshot.ver)return {data:null,error:{code:'40001'}};
      window.__qaSupplements=structuredClone(args.p_rows);window.__qaSnapshot.ver++;return {data:{ok:true},error:null};
    }
    if(/act_|approve|submit|confirm|finaliz|insert|update|delete|upsert|post_|pay_|disburs|withdraw|save_/i.test(name)){window.__qaWrites.push({name:name});throw Error('Unexpected financial mutation');}
    return {data:[],error:null};
  },from:function(table){
    var query={then:function(resolve,reject){return Promise.resolve({data:[],error:null,count:0}).then(resolve,reject);}};
    ['select','eq','neq','is','in','or','order','limit','range','maybeSingle','single','gte','lte','lt','gt','contains','not','match'].forEach(function(method){query[method]=function(){return query;};});
    ['insert','update','upsert','delete'].forEach(function(method){query[method]=function(){window.__qaWrites.push({table:table,method:method});throw Error('Unexpected database mutation');};});return query;
  }};
  getSb=function(){return mock;};
})()`;

async function browserCase(engine,width,origin){
  const browser=await playwright[engine].launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width,height:width<600?844:1000},acceptDownloads:true});
    await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.protocol==='blob:'||url.protocol==='data:'?route.continue():route.abort();});
    const page=await context.newPage(),errors=[],dialogs=[];page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin);await page.waitForFunction(()=>window.__megaAppQA&&window.XLSX);
    const scope=code=>page.evaluate(value=>window.__megaAppQA.run(value),code);
    await scope(fixtureSetup);
    for(const kind of ['bulk','payroll','refund'])for(const view of ['detail','approval']){
      const label=engine+'/'+width+'/'+kind+'/'+view,data=rawRequest(kind);
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaDenied=false;window.__qaSupplements=[];window.__qaSnapshot=${JSON.stringify(data)};window.__qaSnapshot.tenant_id=currentTenantId();REQS=[mapReq(structuredClone(window.__qaSnapshot))];})()`);
      const before=await scope('JSON.stringify(REQS[0])');
      await scope(view==='detail'?'openDetail(REQS[0].id);':'showApprD(REQS[0]);');
      const host=view==='detail'?'#detail-body':'#appr-inner',panel=page.locator(host+' .finance-mega-remittance');
      await panel.locator('[data-mega-action="download"]').waitFor();
      ok(await panel.isVisible(),label+' real renderer automatically mounts a ready bank file');
      const state=await scope('FINANCE_MEGA_REMITTANCE_VIEWS['+JSON.stringify(view)+'].getState()');
      equal(state.totalAmount,kind==='payroll'?3500:1200,label+' amount uses resolved bank principal');
      equal(state.paymentCount,kind==='payroll'?2:1,label+' row count preserves approved source items');
      equal(await scope('S.demoLogin'),false,label+' runs the production-style identity path, not demo export');
      await panel.scrollIntoViewIfNeeded();
      const geometry=await panel.evaluate(element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,scroll:element.scrollWidth,client:element.clientWidth,viewport:innerWidth};});
      ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1,label+' panel fits viewport without clipping');
      const readBefore=await scope('window.__qaReads.length');
      const downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'下載 Excel',exact:true}).click();const download=await downloadEvent;
      const downloadPath=await download.path();const book=XLSX.read(fs.readFileSync(downloadPath),{type:'buffer',cellText:false});
      equal(await scope('window.__qaReads.length'),readBefore+1,label+' actual download performs a fresh authorized RPC');
      equal(book.SheetNames,['工作表1'],label+' XLSX has exactly the required worksheet');
      const sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});
      if(kind==='payroll'){
        equal(rows[0],['HEADER','收款人姓名','存款人身份證號','轉入銀行代號','轉入帳號','付款金額'],label+' salary header matches provided format');
        equal(rows[3].slice(0,5),['TRAILER','PAYMENT總筆數',2,'PAYMENT總金額',3500],label+' salary trailer matches count and principal');
        equal(sheet.E2.v,'000000001234',label+' salary leading-zero account is preserved');equal(sheet.E2.t,'s',label+' salary account remains an Excel text cell');
      }else{
        equal(rows[0],['戶名','金額','銀行代號','帳號'],label+' bulk header matches provided format');
        equal(rows.length,2,label+' cash rows and metadata do not become extra bank payment rows');
        equal(sheet.D2.v,'000000001234',label+' bulk leading-zero account is preserved');equal(sheet.D2.t,'s',label+' bulk account remains an Excel text cell');
      }
      equal(await scope('JSON.stringify(REQS[0])'),before,label+' preparation and download do not mutate approved request');
      equal(await scope('window.__qaWrites.length'),0,label+' no approval, payment or database mutation occurs');
      if(kind==='payroll')await page.screenshot({path:path.join(output,[engine,width,kind,view].join('-')+'.png')});
      if(view==='approval'){await scope('closeAppr();');equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.approval'),false,label+' closing approval modal clears private file');}
      else{await scope("nav('dashboard',null);");equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.detail'),false,label+' leaving detail clears private file');}
      results.push({engine,width,kind,view,geometry,filename:download.suggestedFilename()});
    }
    const missing=rawRequest('payroll');missing.form_payload.hrInfo.rows[0].name='';missing.form_payload.hrInfo.rows[0].identityNo='';missing.form_payload.hrInfo.rows[0].bankCode='';
    await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaSnapshot=${JSON.stringify(missing)};window.__qaSnapshot.tenant_id=currentTenantId();window.__qaSupplements=[];REQS=[mapReq(structuredClone(window.__qaSnapshot))];showApprD(REQS[0]);})()`);
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="missing"]'));
    const missingPanel=page.locator('#appr-inner .finance-mega-remittance'),principalBefore=await scope('JSON.stringify({amount:window.__qaSnapshot.amount,rows:window.__qaSnapshot.form_payload.hrInfo.rows})');
    equal(await missingPanel.locator('input').count(),2,engine+'/'+width+' actual approval editor exposes only required name and branch-code supplements');
    await missingPanel.getByLabel('收款戶名',{exact:true}).fill('虛構薪轉補充戶名');await missingPanel.getByLabel('銀行代號',{exact:true}).fill('0170000');
    await missingPanel.getByRole('button',{name:'儲存並重新產製',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="ready"]'));
    equal(await scope('window.__qaWrites.map(function(x){return x.name;})'),['finance_mega_remittance_supplement_save_v1'],engine+'/'+width+' supplement uses only the dedicated CAS metadata RPC');
    equal(await scope('JSON.stringify({amount:window.__qaSnapshot.amount,rows:window.__qaSnapshot.form_payload.hrInfo.rows})'),principalBefore,engine+'/'+width+' supplement does not change approved source accounts, amounts or rows');
    equal(await scope('Object.keys(window.__qaWrites[0].rows[0]).sort()'),['bankCode','name','rowKey'],engine+'/'+width+' submitted supplement contains no editable payment account or amount');
    const supplementEvent=page.waitForEvent('download');await missingPanel.getByRole('button',{name:'下載 Excel',exact:true}).click();const supplementDownload=await supplementEvent;
    const supplementBook=XLSX.read(fs.readFileSync(await supplementDownload.path()),{type:'buffer'}),supplementSheet=supplementBook.Sheets['工作表1'];
    equal(supplementSheet.B2.v,'虛構薪轉補充戶名',engine+'/'+width+' real downloaded workbook applies the authorized payee supplement');
    equal(supplementSheet.D2.v,'0170000',engine+'/'+width+' real downloaded workbook applies the authorized full bank code');
    equal(supplementSheet.E2.v,'000000001234',engine+'/'+width+' supplemented workbook preserves approved account unchanged');
    equal(supplementSheet.F2.v,1200,engine+'/'+width+' supplemented workbook preserves approved amount unchanged');
    await scope('closeAppr();');
    for(const scenario of ['before-cashier','employee','demo','missing-auth']){
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();S.user=USERS.find(function(u){return u.role==='cashier';});S.demoLogin=false;var raw=${JSON.stringify(rawRequest())};if(${JSON.stringify(scenario)}==='before-cashier'){raw.status='pending';raw.steps[1].a='';raw.steps[1].t='';}if(${JSON.stringify(scenario)}==='employee')S.user=USERS[0];if(${JSON.stringify(scenario)}==='demo')S.demoLogin=true;if(${JSON.stringify(scenario)}==='missing-auth')S.user=Object.assign({},S.user,{authUserId:''});window.__qaSnapshot=raw;REQS=[mapReq(raw)];openDetail(REQS[0].id);})()`);
      equal(await page.locator('#detail-body .finance-mega-remittance').count(),0,engine+'/'+width+'/'+scenario+' has no bank file entry');
    }
    await scope(`(function(){S.user=USERS.find(function(u){return u.role==='cashier';});S.demoLogin=false;window.__qaSnapshot=${JSON.stringify(rawRequest())};REQS=[mapReq(window.__qaSnapshot)];window.__qaDenied=true;showApprD(REQS[0]);})()`);
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="denied"]'));
    equal(await page.locator('#appr-inner [data-mega-action="download"]').count(),0,engine+'/'+width+' RPC 403 denies all download actions');
    await scope('closeAppr();window.__qaDenied=false;window.__qaRpcCode="55000";showApprD(REQS[0]);');
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="ineligible"]'));
    equal(await page.locator('#appr-inner [data-mega-action="download"]').count(),0,engine+'/'+width+' concurrent stage change removes download without presenting a generic network failure');
    await scope('window.__qaRpcCode="";');
    await scope('setFinanceWorkspaceIdentityBlocked(true);');equal(await scope('Object.keys(FINANCE_MEGA_REMITTANCE_VIEWS).length'),0,engine+'/'+width+' identity lock clears all private contexts');
    equal(await scope('window.__qaNetwork'),[],engine+'/'+width+' no real API network request');equal(errors,[],engine+'/'+width+' no uncaught app errors');equal(dialogs,[],engine+'/'+width+' no unexpected browser dialogs');
    await context.close();
  }finally{await browser.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});await xlsxDependency();
  server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/__qa/xlsx.js'){res.setHeader('Content-Type','text/javascript');res.end(xlsxBytes);return;}if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  for(const engine of ['chromium','webkit'])for(const width of [1440,390])await browserCase(engine,width,origin);
  equal(sha(fs.readFileSync(path.join(root,'index.html'))),sha(original),'integration test does not alter index.html');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({status:'pass',checks,cases:results.length,sourceSha256:sha(original),xlsxSha256:XLSX_SHA,scope:'Actual local app renderers and downloads with fictional RPC snapshots only; no production authentication, writes or payments.',results},null,2));
  console.log(JSON.stringify({status:'pass',checks,cases:results.length,output}));
})().catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,stack:error.stack,checks,results},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(server&&server.listening)await new Promise(resolve=>server.close(resolve));});
