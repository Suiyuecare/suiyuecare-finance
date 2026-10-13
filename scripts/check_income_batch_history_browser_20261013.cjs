'use strict';
// Actual app controller/validators/mapping/list/modal in Chromium and WebKit.
// Only RPC transport and identities are fictional; all formal networking is denied.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture,identity,clone}=require('./check_income_batch_history_frontend_20261013.cjs');
const root=path.resolve(process.env.FINANCE_BATCH_SOURCE_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.FINANCE_BATCH_BROWSER_OUTPUT||'/tmp/finance-income-batch-history-browser-20261013');
assert(out!==root&&!out.startsWith(root+path.sep));
const pw=require(path.join(root,'node_modules/playwright')),{applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__incomeBatchQA={run:async function(code){return await eval(code)},read:function(code){return eval(code)}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const data=fixture();
const evidence={stylesSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/styles/finance-core.css'))).digest('hex'),sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),scope:'Actual local app UI with fictional RPC transport. No employee login, formal reads/writes or production-performance claim.',fixture:{applicationGroups:data.groups.length,largeBillMembers:320,largeInvoiceMembers:312,billAmounts:[2204,4206,6934,1729],billTotal:15073,hiddenSources:data.hidden.length},cases:[]};
const server=http.createServer((req,res)=>{
  const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'; img-src 'self' data: blob:; font-src 'self' data:");
  if(filename===root||filename===path.join(root,'index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(filename));
});
const setup=`(async()=>{
 USERS=[{id:${JSON.stringify(identity.finance_user_id)},n:'虛構申請人',email:'batch@example.invalid',authUserId:${JSON.stringify(identity.auth_user_id)},role:'accountant',rL:'會計',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',s:'虛構公司',full:'虛構公司股份有限公司',active:true}];DEPTS=[{c:'D1',n:'虛構部門',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];
 S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[0]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));S.demoLogin=false;S.user.authUserId=${JSON.stringify(identity.auth_user_id)};S.user.tenantId=currentTenantId();financeWorkspaceIdentityBlocked=false;
 approvalFastShouldHoldSkeleton=function(){return false;};window.__batchCalls=[];window.__batchFault='';
 getSb=function(){return{rpc:function(name,args){window.__batchCalls.push({name,args});if(name==='finance_personal_document_summary_v1'||name==='finance_personal_document_detail_v1')return window.__batchFixtureRpc(name,args);if(/act_active_step|submit|withdraw|cancel|persist|update|delete/.test(name))throw Error('Forbidden fictional mutation '+name);return Promise.resolve({data:[],error:null});}};};
 S.page='approvals';S.aT='mine';S.apprQuery='';S.apprPage=1;document.querySelectorAll('.pg').forEach(function(n){n.classList.toggle('on',n.id==='pg-approvals');});buildApprovals();await APPROVAL_HISTORY_RUNTIME.promise;return true;
})()`;
let browser,currentPage;
async function main(){
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const engines=String(process.env.FINANCE_BATCH_BROWSER_ENGINES||'chromium,webkit').split(',');
 for(const engine of engines)for(const width of [1440,390]){
  browser=await pw[engine].launch({headless:true});const page=await browser.newPage({viewport:{width,height:900}}),errors=[],dialogs=[],result={engine,width,checks:[]};evidence.cases.push(result);currentPage=page;
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  const run=code=>page.evaluate(code=>window.__incomeBatchQA.run(code),code),check=(label,value)=>{assert(value,engine+' '+width+' '+label);result.checks.push(label);console.log('PASS '+engine+' '+width+' '+label);};
  await page.exposeFunction('__batchFixtureRpc',async(name,args)=>{
   if(name==='finance_personal_document_summary_v1')return{data:data.page(args)};
   const payload=data.detail(args.p_history_key),fault=await page.evaluate(()=>window.__batchFault);
   if(payload.item&&fault==='missing-row')payload.item.source_rows.pop();
   if(payload.item&&fault==='foreign-row')payload.item.source_rows[0].tenant_id='foreign-tenant';
   if(payload.item&&fault==='different-batch')payload.item.source_rows[0].batch_id='foreign-batch';
   return{data:payload};
  });
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});await run(setup);
  async function ready(){await page.waitForFunction(()=>window.__incomeBatchQA.read('APPROVAL_HISTORY_RUNTIME.status')==='ready',null,{timeout:12000});}
  async function search(text){await page.locator('#appr-q').fill(text);await page.locator('#appr-q').press('Enter');await page.waitForFunction(q=>window.__incomeBatchQA.read('APPROVAL_HISTORY_RUNTIME.status')==='ready'&&window.__incomeBatchQA.read('APPROVAL_HISTORY_RUNTIME.query')===q,text,{timeout:12000});}
  async function open(group){await page.locator('[data-history-open="'+group.item.history_key+'"]').click();await page.locator('#m-appr').waitFor({state:'visible'});}
  async function close(){await run('window.closeAppr();true;');}
  await ready();check('first page contains 50 complete application groups',await page.locator('[data-history-key]').count()===50&&await run('APPROVAL_HISTORY_RUNTIME.total')===data.groups.length);
  await page.locator('.appr-pager').getByRole('button',{name:'下一頁',exact:true}).click();await page.waitForFunction(()=>window.__incomeBatchQA.read('APPROVAL_HISTORY_RUNTIME.page')===2&&window.__incomeBatchQA.read('APPROVAL_HISTORY_RUNTIME.status')==='ready');
  check('server group pagination never expands 320/312 source rows into list entries',await page.locator('[data-history-key]').count()===data.groups.length-50&&(await page.locator('[data-history-key="'+data.largeBill.item.history_key+'"]').innerText()).includes('320 張')&&(await page.locator('[data-history-key="'+data.largeInvoice.item.history_key+'"]').innerText()).includes('312 張'));
  for(const group of [data.largeBill,data.largeInvoice]){
   await search(group.members.at(-1).no);const text=await page.locator('[data-history-key]').innerText();
   check('searching final source returns one full group '+group.item.batch_id,await page.locator('[data-history-key]').count()===1&&text.includes(group.members.length+' 張')&&text.includes('NT$'+group.item.summary.amount.toLocaleString('zh-TW')));
   await open(group);const modal=await page.locator('#appr-inner').innerText();
   check('real detail contains final source and every exact ID '+group.item.batch_id,modal.includes(group.members.at(-1).no)&&await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size')===group.members.length);
   check('large detail is read-only and page remains usable '+group.item.batch_id,await page.locator('#appr-inner button[onclick*="apprApprove"],#appr-inner button[onclick*="apprReject"],#appr-inner button[onclick*="apprReturnPrevious"]').count()===0&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await close();
  }
  await search('REASON-');check('same reason and applicant on distinct batch IDs remain two applications',await page.locator('[data-history-key]').count()===2&&(await page.locator('#appr-list').innerText()).includes('2 張')&&(await page.locator('#appr-list').innerText()).includes('3 張'));
  await search('FICT-BILL-FOUR');const fourText=await page.locator('[data-history-key]').innerText();
  check('four bills display one application with exact gross total',await page.locator('[data-history-key]').count()===1&&fourText.includes('整批申請繳費單')&&fourText.includes('4 張')&&fourText.includes('NT$15,073'));
  await open(data.fourBill);check('real bill detail exposes all numbers and amounts',(await page.locator('#appr-inner').innerText()).includes('NT$15,073')&&await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size')===4);
  for(const member of data.fourBill.members)check('detail includes exact bill '+member.id,(await page.locator('#appr-inner').innerText()).includes(member.no));
  const before=await run('window.__batchCalls.length');await run(`(async()=>{await window.apprApproveBill(${JSON.stringify(data.fourBill.item.record_id)});await window.apprReturnPreviousBill(${JSON.stringify(data.fourBill.item.record_id)});await window.apprRejectBill(${JSON.stringify(data.fourBill.item.record_id)});await window.withdrawBill(${JSON.stringify(data.fourBill.item.record_id)});return true;})()`);
  check('direct history action handlers cannot dispatch writes or refresh into a partial action',await run('window.__batchCalls.length')===before&&dialogs.some(message=>message.includes('過往單據')));await close();
  for(const fault of ['missing-row','foreign-row','different-batch']){
   await run('window.__batchFault='+JSON.stringify(fault)+';true;');const snapshot=await run('JSON.stringify(BILLS)');
   await page.locator('[data-history-open="'+data.fourBill.item.history_key+'"]').click();await page.waitForFunction(()=>window.__incomeBatchQA.read('APPROVAL_HISTORY_DETAIL_RUNTIME.status')==='error');
   check('bad detail fails before modal/cache mutation '+fault,await page.locator('#m-appr').isHidden()&&await run('JSON.stringify(BILLS)')===snapshot&&(await page.locator('[data-history-detail-message]').innerText()).includes('明細未開啟'));
  }
  await run('window.__batchFault="";true;');await open(data.fourBill);check('retry opens the complete fresh batch',await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size')===4);await close();
  await search('FICT-PARTIAL');await run('BILLS.push(mapBill('+JSON.stringify(data.hidden[0])+'));true;');await open(data.partial);
  const partialText=await page.locator('#appr-inner').innerText();check('exact authorized IDs exclude even a pre-cached same-batch hidden sibling',await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size')===3&&partialText.includes('NT$606')&&!partialText.includes(data.hidden[0].no)&&!partialText.includes('99,999'));await close();
  await search(data.hidden[0].no);check('hidden sibling search cannot broaden the transport-authorized group',await page.locator('[data-history-key]').count()===0&&await run('APPROVAL_HISTORY_RUNTIME.total')===0);
  await search('FICT-MIXED');const mixedText=await page.locator('[data-history-key]').innerText();check('mixed-status group does not label the entire batch completed',mixedText.includes('4 張')&&mixedText.includes('1 張')&&mixedText.includes('已核准')&&mixedText.includes('待'));
  await open(data.mixed);check('mixed-status bill detail lists individual flow states',(await page.locator('#appr-inner').innerText()).includes('流程狀態')&&await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size')===4);await close();
  await search(data.singleInvoice.members[0].no);const singleText=await page.locator('[data-history-key]').innerText();check('unbatched invoice remains a single application without batch badge',await page.locator('[data-history-key]').count()===1&&!singleText.includes('整批'));
  await run('openApprovalTab("h");true;');await ready();await search('FICT-BILL-FOUR');check('past-document tab uses the same complete grouped contract',await page.locator('[data-history-key]').count()===1&&(await page.locator('[data-history-key]').innerText()).includes('NT$15,073'));
  check('no unauthorized business RPC was invoked',await run('!window.__batchCalls.some(c=>/act_active_step|submit|withdraw|cancel|persist|update|delete/.test(c.name))'));
  check('no page overflow or unhandled browser exception',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&errors.length===0);
  await page.screenshot({path:path.join(out,engine+'-'+width+'-group.png'),fullPage:false});result.rpcCalls=await run('window.__batchCalls');result.errors=errors;await browser.close();browser=null;
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Income batch history browser PASS: '+out);
}
main().catch(async error=>{fs.mkdirSync(out,{recursive:true});let dom=null;if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:path.join(out,'failure.png'),fullPage:false});dom=await currentPage.evaluate(()=>Array.from(document.querySelectorAll('[data-history-open],.approval-form-badges')).map(node=>({tag:node.tagName,classes:node.className,text:node.textContent,rect:JSON.stringify(node.getBoundingClientRect())})));}fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,dom,evidence},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
