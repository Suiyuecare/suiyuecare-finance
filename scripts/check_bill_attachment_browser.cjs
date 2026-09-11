'use strict';
// Manual browser regression: agent-browser must be available on PATH.
// --before removes only the event bridge from the served response to reproduce
// the original defect. Test hooks never enter a source or production artifact.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {applyBuildEnvironment}=require('./finance_build_environment');
const run=promisify(execFile),root=path.resolve(__dirname,'..');
const before=process.argv.includes('--before');
assert.ok(process.argv.slice(2).every(arg=>arg==='--before'),'Only --before is supported');
const session='finance-bill-attachment-'+process.pid;
const output=process.env.FINANCE_BILL_ATTACHMENT_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'finance-bill-attachment-'));
fs.mkdirSync(output,{recursive:true});
const fixtures=[
  {name:'bill-fixture-proof.csv',body:'payer,amount\nAnonymous,1250\n'},
  {name:'第二份繳費單.csv',body:'payer,amount\nAnonymous,250\n'}
];
fixtures.forEach(file=>fs.writeFileSync(path.join(output,file.name),file.body));
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert.ok(html.includes(anchor),'The closure hook must attach at the actual bootstrap');
html=html.replace(anchor,'window.__billAttachmentTest={run:async function(code){return await eval(code);}};\n'+anchor);
if(before){
  const bridge='window.updateApprovalFileLabel=updateApprovalFileLabel;';
  assert.equal(html.split(bridge).length,2,'Before mode must remove exactly the repaired bridge');
  html=html.replace(bridge,'');
}
// No Auth, export CDN or remote backend is needed for this fictional UI test.
html=html.replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');res.end(html);return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(fs.readFileSync(file));
});
async function browser(...args){return (await run('agent-browser',['--session',session,...args],{maxBuffer:8*1024*1024})).stdout;}
async function scoped(code){
  const expression='(async()=>JSON.stringify(await window.__billAttachmentTest.run('+JSON.stringify(code)+')))()';
  const raw=await browser('eval','--base64',Buffer.from(expression).toString('base64'));
  let value=JSON.parse(raw);if(typeof value==='string')value=JSON.parse(value);return value;
}
async function selection(){
  return scoped(`(async function(){
    var p=await approvalActionPayload('bill-appr-c','bill-appr-files','bill-appr-add-user');
    return {inputFiles:el('bill-appr-files').files.length,label:el('bill-appr-files-name').textContent,
      payloadFiles:p.files.map(function(f){return {name:f.n,size:f.size,url:f.url};}),active:activeStep(BILLS[0]).rk};
  })()`);
}
function checkSelection(actual,expected,label){
  assert.equal(actual.inputFiles,expected.length);
  assert.equal(actual.label,before?'未選擇任何檔案':label);
  assert.equal(actual.active,'accountant','Selecting files must not advance approval');
  assert.deepEqual(actual.payloadFiles.map(file=>file.name),expected.map(file=>file.name));
  actual.payloadFiles.forEach((file,i)=>{
    assert.equal(file.size,Buffer.byteLength(expected[i].body));
    assert.match(file.url,/^data:[^,]*;base64,/);
    assert.equal(Buffer.from(file.url.split(',')[1],'base64').toString('utf8'),expected[i].body,'Actual payload retains exact selected file contents');
  });
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await browser('open','http://127.0.0.1:'+server.address().port+'/');
  await browser('wait','--load','networkidle');
  assert.equal((await browser('errors')).trim(),'','The actual app must initialize without errors');
  await scoped(`(function(){
    window.__fixtureErrors=[];
    window.addEventListener('error',function(e){window.__fixtureErrors.push(e.message);});
    window.addEventListener('unhandledrejection',function(e){window.__fixtureErrors.push(String(e.reason&&e.reason.message||e.reason));});
    window.__fixtureNetwork=[];
    window.fetch=function(input){window.__fixtureNetwork.push(String(input));return Promise.reject(new Error('Unexpected remote request'));};
    USERS=[{id:'test-accountant',n:'匿名會計',email:'accountant@example.invalid',role:'accountant',rL:'會計',eid:'E1',dc:'TEST',active:true},{id:'test-applicant',n:'匿名申請人',email:'applicant@example.invalid',role:'staff',rL:'員工',eid:'E1',dc:'TEST',active:true}];
    ENTS=[{id:'E1',n:'匿名公司',full:'匿名公司',s:'匿名公司',active:true}];
    DEPTS=[{c:'TEST',n:'匿名部門',eid:'E1',lv:3,active:true}];
    ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];quickLogin('accountant');
    BILLS=[mapBill({id:'test-bill-upload',no:'BILL-TEST-001',entity_id:'E1',department_code:'TEST',item:'匿名服務費',payer:'匿名繳費人',amount:1250,service_period:'2026-09',status:'unpaid',approval_status:'pending_accountant',row_version:1,applicant:'匿名申請人',applicant_id:'test-applicant',steps:[{rk:'applicant_submit',uid:'test-applicant',n:'匿名申請人',a:'approved'},{rk:'accountant',r:'會計',uid:'test-accountant',n:'',a:'',status:'pending_accountant'},{rk:'applicant_confirm',uid:'test-applicant',n:'',a:'',status:'pending_applicant_confirm'}],data_environment:'test',tenant_id:currentTenantId()})];
    window.__billBefore=JSON.stringify(BILLS);
  })()`);
  const evidence=[];
  for(const width of [1440,390]){
    await browser('set','viewport',String(width),'1000');
    await scoped('showBillApprD(BILLS[0])');await browser('wait','100');
    const initial=await scoped(`(function(){var input=el('bill-appr-files'),label=input&&input.closest('label');return {
      canAct:canActBill(BILLS[0]),versionReady:!!approvalModalExpectedSteps('bill',BILLS),
      inputExists:!!input,labelVisible:!!(label&&label.getClientRects().length),
      labelText:el('bill-appr-files-name')&&el('bill-appr-files-name').textContent,
      globalHandler:typeof window.updateApprovalFileLabel,localHandler:typeof updateApprovalFileLabel,
      overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.deepEqual(initial,{canAct:true,versionReady:true,inputExists:true,labelVisible:true,labelText:'未選擇任何檔案',globalHandler:before?'undefined':'function',localHandler:'function',overflow:false});
    await browser('upload','#bill-appr-files',path.join(output,fixtures[0].name));
    checkSelection(await selection(),fixtures.slice(0,1),fixtures[0].name);
    await browser('upload','#bill-appr-files',...fixtures.map(file=>path.join(output,file.name)));
    checkSelection(await selection(),fixtures,'已選擇 2 個檔案');
    await browser('eval',"document.querySelector('.approval-file-field').scrollIntoView({block:'center'})");
    await browser('screenshot',path.join(output,(before?'before-':'after-')+width+'.png'));
    // A real DOM change event verifies the empty FileList path too.
    await browser('eval',"var input=document.querySelector('#bill-appr-files');input.files=new DataTransfer().files;input.dispatchEvent(new Event('change',{bubbles:true}));");
    checkSelection(await selection(),[],'未選擇任何檔案');
    evidence.push({width,single:true,multiple:true,clear:true,exactPayload:true,visible:true,noOverflow:true});
  }
  assert.equal(await scoped('JSON.stringify(BILLS)===window.__billBefore'),true,'Read/select actions must preserve all original bill data');
  await scoped('closeAppr();BILLS[0].rowVersion=0;showBillApprD(BILLS[0])');
  assert.deepEqual(await scoped("({file:!!el('bill-appr-files'),warning:el('appr-inner').textContent.includes('單據內容版本尚未完成載入')})"),{file:false,warning:true},'Missing CAS version must still block the action with an explanation');
  await scoped('closeAppr();BILLS[0].rowVersion=1;S.user=USERS[1];showBillApprD(BILLS[0])');
  assert.deepEqual(await scoped("({canAct:canActBill(BILLS[0]),file:!!el('bill-appr-files')})"),{canAct:false,file:false},'An unrelated current actor must not gain an upload action');
  const errors=await scoped('window.__fixtureErrors');
  if(before){
    assert.equal(errors.length,6,'Each original single/multiple/clear onchange must reproduce the defect');
    assert.ok(errors.every(error=>error==='Uncaught ReferenceError: updateApprovalFileLabel is not defined'));
  }else{
    assert.deepEqual(errors,[],'Actual change handlers and file reads must complete without errors');
    assert.equal((await browser('errors')).trim(),'');
  }
  assert.deepEqual(await scoped('window.__fixtureNetwork'),[],'The offline test must not request any backend or storage upload');
  const result={ok:true,mode:before?'reproduced-original-defect':'verified-fix',evidence,casGuard:true,actorGuard:true,networkRequests:0,errors,
    limits:'Fictional local bills and files only. No approval, Storage upload, database write, or real employee login is performed.'};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ ...result,output }));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await browser('close').catch(()=>{});
  if(server.listening)await new Promise(resolve=>server.close(resolve));
});
