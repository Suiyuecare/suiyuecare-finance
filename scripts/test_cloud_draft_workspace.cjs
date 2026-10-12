'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/engines/cloud-draft-workspace.js'),'utf8');
let checks=0;
function ok(v,message){assert.ok(v,message);checks++;}
function error(code){return Object.assign(new Error(code),{code});}
function clone(v){return JSON.parse(JSON.stringify(v));}
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),dump:()=>Array.from(values.values()).join('')};}
function fixture(shared){
  shared=shared||{};const session=shared.session||storage(),state=shared.state||{data:null,calls:[],saveMode:'ok',readMode:'ok',reopenMode:'ok'};
  let identity='actor|tenant|production|epoch1',owner='actor|tenant|production',ui={title:'Sensitive applicant title',items:[],ui:{fields:{reason:'private explanation'},rows:[{payer:'SENSITIVE PAYER'}]}};
  let saved=0,restored=0,reopened=[],dirty=false,guardCalls=0,saveWait=null,reopenWait=null,unsavedFiles=0;
  const sandbox={crypto:webcrypto,TextEncoder,Uint8Array,Blob,module:{exports:{}},sessionStorage:session};vm.runInNewContext(source,sandbox);const api=sandbox.module.exports;
  const client={
    async save(d){state.calls.push(['save',clone(d)]);if(state.saveMode==='wait')await saveWait;
      if(state.saveMode==='offline')throw error('NETWORK');
      if(state.data&&state.data.state!=='draft')throw error('55000');
      if(state.data&&state.data.revision!==d.revision){if(JSON.stringify(state.data.payload)!==JSON.stringify(d.payload))throw error('PT409');return clone(state.data);}
      state.data={ok:true,id:d.id,documentType:d.kind,dataEnvironment:d.environment,revision:d.revision+1,state:'draft',operationKey:'cloud_'+d.kind+'_'+d.id,payload:clone(d.payload),files:clone(d.files),title:d.payload.title};
      if(state.saveMode==='lost')throw error('NETWORK');return clone(state.data);},
    async read(id){state.calls.push(['read',id]);if(state.readMode==='offline')throw error('NETWORK');if(!state.data||state.data.id!==id)throw error('42501');return clone(state.data);},
    async reconcileSave(d){state.calls.push(['reconcile',clone(d)]);let s=await this.read(d.id);if(JSON.stringify(s.payload)!==JSON.stringify(d.payload))throw error('PT409');return s;},
    async list(){return {rows:state.data?[clone(state.data)]:[],nextCursor:null};},
    async reopen(d){state.calls.push(['reopen',clone(d)]);if(state.reopenMode==='wait')await reopenWait;if(d.revision!==state.data.revision)throw error('PT409');state.data.state='draft';state.data.revision++;state.data.operationKey='cloud_'+d.documentType+'_'+d.id+'_'+state.data.revision;if(state.reopenMode==='lost')throw error('NETWORK');return clone(state.data);}
  };
  api.install({identity:()=>identity,ownerKey:()=>owner,environment:()=> 'production',storage:session,client,paint(){},capture:()=>({payload:clone(ui),files:[],unsavedFiles:unsavedFiles}),saved(){saved++;},beforeRestore(){guardCalls++;if(dirty)throw error('DIRTY_FORM');},beforeReopen(k,_ui,draft){guardCalls++;if(dirty&&(!api.active(k)||api.active(k).id!==draft.id))throw error('DIRTY_FORM');},restore(_k,_ui,draft){if(dirty)throw error('DIRTY_FORM');assert.equal(draft.state,'draft');restored++;ui=clone(draft.payload);},reopened(k,previous,draft){reopened.push({k,previous:clone(previous),draft:clone(draft)});},resume:()=>({displayPending:true}),showResult:()=>({displayPending:true})});
  return {api,client,state,session,get ui(){return ui;},set ui(v){ui=v;},set identity(v){identity=v;},set owner(v){owner=v;},set dirty(v){dirty=v;},get saved(){return saved;},get restored(){return restored;},get reopened(){return reopened;},get guardCalls(){return guardCalls;},setSaveWait(p){saveWait=p;},setReopenWait(p){reopenWait=p;},set unsavedFiles(v){unsavedFiles=v;}};
}
(async()=>{
  const f=fixture();f.state.saveMode='lost';f.state.readMode='offline';
  await assert.rejects(f.api.save('invoice'),{code:'NETWORK'});checks++;
  const original=f.state.calls.find(c=>c[0]==='save')[1];
  ok(f.session.dump().includes(original.id),'minimal receipt persists original UUID before dispatch');
  ok(!/Sensitive|private explanation|SENSITIVE PAYER|payload|fields/.test(f.session.dump()),'receipt does not persist form content or file paths');
  ok(f.api.view('invoice').includes('確認上次草稿'),'unknown outcome presents original-result confirmation');
  f.ui={title:'changed while offline',items:[],ui:{fields:{reason:'new input'}}};f.state.saveMode='ok';f.state.readMode='ok';
  const recovered=await f.api.save('invoice');
  ok(recovered.id===original.id&&recovered.revision===1,'memory recovery uses original UUID and full frozen request');
  ok(f.state.calls.filter(c=>c[0]==='save').length===1,'server-confirmed save does not dispatch another save');
  ok(f.saved===0,'changed current UI is not marked clean by recovery of prior snapshot');
  ok(f.api.view('invoice').includes('目前表單另有變更'),'current changes stay explicitly unsaved');
  await f.api.save('invoice');
  ok(f.state.data.id===original.id&&f.state.data.revision===2&&f.saved===1,'next deliberate save updates same UUID with latest revision');

  const reloadBase=fixture();reloadBase.state.saveMode='lost';reloadBase.state.readMode='offline';await assert.rejects(reloadBase.api.save('bill'));const oldId=reloadBase.state.data.id;
  reloadBase.state.readMode='ok';reloadBase.state.saveMode='ok';const reload=fixture(reloadBase);reload.identity='actor|tenant|production|epoch99';await reload.api.save('bill');
  ok(reload.api.active('bill').id===oldId,'session receipt remains stable across auth epoch / page reload');
  ok(reload.state.calls.filter(c=>c[0]==='save').length===1,'receipt restores authority snapshot without reconstructing request');

  const absent=fixture();absent.state.saveMode='offline';absent.state.readMode='offline';await assert.rejects(absent.api.save('invoice'));
  const absentId=absent.state.calls[0][1].id,again=fixture(absent);again.ui={title:'different',items:[],ui:{fields:{reason:'edited'}}};again.state.readMode='ok';again.state.saveMode='ok';
  await assert.rejects(again.api.save('invoice'),{code:'PENDING_DRAFT_DIFFERENT'});checks++;
  ok(again.state.calls.filter(c=>c[0]==='save').length===1,'lost memory and changed UI cannot create replacement draft');
  again.ui=clone(absent.ui);await again.api.save('invoice');ok(again.state.data.id===absentId,'matching complete content safely retries the original UUID');

  const denied=fixture(absent);denied.owner='other|tenant|production';denied.identity='other|tenant|production|epoch1';
  ok(!denied.api.view('invoice').includes('確認上次草稿'),'different account does not load former actor receipt');

  const parallel=fixture();parallel.state.saveMode='wait';let resolve;parallel.setSaveWait(new Promise(r=>resolve=r));const p1=parallel.api.save('invoice'),p2=parallel.api.save('invoice');ok(p1===p2,'double-click API calls share one save');resolve();await p1;ok(parallel.state.calls.filter(c=>c[0]==='save').length===1,'double-click makes one server mutation');

  const switched=fixture();switched.state.saveMode='wait';let finish;switched.setSaveWait(new Promise(r=>finish=r));const late=switched.api.save('invoice');await new Promise(r=>setTimeout(r,10));switched.identity='other|tenant|production|epoch2';switched.owner='other|tenant|production';finish();await assert.rejects(late,{code:'CLIENT_IDENTITY_CHANGED'});checks++;ok(!switched.api.active('invoice')&&switched.saved===0,'late saved response does not cross identity');

  const fix=fixture();await fix.api.save('invoice');fix.state.data.state='ready';await fix.api.list(false);ok(fix.api.view('invoice').includes('回到草稿修正'),'ready row exposes explicit repair action');
  const previous=clone(fix.state.data);const revised=await fix.api.reopen(previous.id,'invoice');
  ok(revised.id===previous.id&&revised.revision===previous.revision+1,'reopen retains UUID and advances CAS revision');
  ok(fix.reopened[0].previous.operationKey===previous.operationKey&&fix.reopened[0].draft.operationKey===revised.operationKey,'callback passes exact old and new operation keys for marker cleanup');
  ok(fix.restored===1&&fix.api.active('invoice').operationKey===revised.operationKey,'reopened complete snapshot reaches restore and next submission');

  const dirtyCurrent=fixture();await dirtyCurrent.api.save('invoice');dirtyCurrent.state.data.state='ready';const dirtyId=dirtyCurrent.state.data.id;
  dirtyCurrent.dirty=true;dirtyCurrent.unsavedFiles=1;dirtyCurrent.ui={title:'Corrected before reopening',items:[],ui:{fields:{reason:'Corrected locally'},uploads:[{name:'new-local-proof.pdf'}]}};
  const dirtyUi=clone(dirtyCurrent.ui);await dirtyCurrent.api.reopen(dirtyId,'invoice');
  ok(dirtyCurrent.restored===0&&JSON.stringify(dirtyCurrent.ui)===JSON.stringify(dirtyUi),'same-UUID initial reopen preserves existing dirty fields and local file selection');
  ok(dirtyCurrent.api.active('invoice').id===dirtyId&&dirtyCurrent.api.active('invoice').revision===2&&dirtyCurrent.api.view('invoice').includes('已保留目前修改'),'confirmed current reopen updates authority while explaining preserved edits');
  await dirtyCurrent.api.save('invoice');ok(dirtyCurrent.state.data.id===dirtyId&&dirtyCurrent.state.data.revision===3&&dirtyCurrent.saved===1,'preserved dirty form saves under reopened UUID and CAS; local file is not marked saved');

  const different=fixture();await different.api.save('invoice');const otherActiveId=different.state.data.id;
  different.state.data={...clone(different.state.data),id:'other-server-draft',state:'ready'};different.dirty=true;
  await assert.rejects(different.api.reopen(different.state.data.id,'invoice'),{code:'DIRTY_FORM'});checks++;
  ok(!different.state.calls.some(c=>c[0]==='reopen')&&different.api.active('invoice').id===otherActiveId,'another draft cannot steal the current dirty save target');
  different.state.data.state='draft';await different.api.open(different.state.data.id,'invoice');
  ok(different.restored===0&&different.api.active('invoice').id===otherActiveId,'another draft restore still cannot replace dirty form contents');

  const typing=fixture();await typing.api.save('invoice');typing.state.data.state='ready';typing.state.reopenMode='wait';let releaseReopen;typing.setReopenWait(new Promise(r=>releaseReopen=r));
  const typingId=typing.state.data.id,typingReopen=typing.api.reopen(typingId,'invoice');
  while(!typing.state.calls.some(c=>c[0]==='reopen'))await new Promise(r=>setTimeout(r,1));
  typing.dirty=true;typing.ui={title:'Typed while reopen waited',items:[],ui:{fields:{reason:'new local text'}}};releaseReopen();
  await typingReopen;
  ok(typing.restored===0&&typing.ui.title==='Typed while reopen waited','confirmed reopen preserves edits typed during response');
  ok(typing.api.active('invoice').revision===2&&!typing.api.view('invoice').includes('確認上次草稿'),'confirmed reopen retires pending receipt even when local restore is declined');
  typing.state.reopenMode='ok';await typing.api.save('invoice');
  ok(typing.state.data.id===typingId&&typing.state.data.revision===3&&typing.state.data.payload.title==='Typed while reopen waited','next save uses authoritative reopened revision without replacement UUID');

  const identityReopen=fixture();await identityReopen.api.save('bill');identityReopen.state.data.state='ready';identityReopen.state.reopenMode='wait';let releaseIdentityReopen;identityReopen.setReopenWait(new Promise(r=>releaseIdentityReopen=r));
  const identityTask=identityReopen.api.reopen(identityReopen.state.data.id,'bill');while(!identityReopen.state.calls.some(c=>c[0]==='reopen'))await new Promise(r=>setTimeout(r,1));identityReopen.identity='other|tenant|production|epoch2';identityReopen.owner='other|tenant|production';releaseIdentityReopen();
  await assert.rejects(identityTask,{code:'CLIENT_IDENTITY_CHANGED'});checks++;ok(identityReopen.restored===0&&identityReopen.reopened.length===0&&!identityReopen.api.active('bill'),'late confirmed reopen cannot retire another owner receipt or restore their form');

  const unuploaded=fixture();unuploaded.unsavedFiles=1;await unuploaded.api.save('bill');
  ok(unuploaded.saved===0&&unuploaded.api.view('bill').includes('本機選檔尚未上傳'),'text receipt never marks selected file bytes saved or form clean');

  const lostReopen=fixture();await lostReopen.api.save('bill');lostReopen.state.data.state='staging';lostReopen.state.reopenMode='lost';const old=clone(lostReopen.state.data);await assert.rejects(lostReopen.api.reopen(old.id,'bill'),{code:'NETWORK'});checks++;
  ok(lostReopen.session.dump().includes(old.operationKey),'lost reopen reply retains old receipt for precise cleanup');
  const reopenReload=fixture(lostReopen);await reopenReload.api.save('bill');
  ok(reopenReload.restored===1&&reopenReload.reopened[0].previous.operationKey===old.operationKey,'reloaded session reconciles original reopen and restores payload');
  ok(reopenReload.state.calls.filter(c=>c[0]==='reopen').length===1,'reopen recovery does not increment revision twice');

  const committed=fixture();await committed.api.save('invoice');committed.state.data.state='committed';await committed.api.open(committed.state.data.id,'invoice');ok(committed.api.view('invoice').includes('列表暫未更新'),'committed but display failed remains a success with refresh guidance');
  ok(!committed.api.active('invoice'),'confirmed committed row releases old active draft');

  const stale=fixture();stale.state.saveMode='lost';await assert.rejects(stale.api.save('invoice'));stale.state.saveMode='ok';stale.state.data.revision++;stale.state.data.payload={title:'edited on another device',items:[],ui:{fields:{}}};
  await assert.rejects(stale.api.save('invoice'),{code:'PT409'});checks++;
  ok(stale.state.data.payload.title==='edited on another device','CAS conflict preserves other-device content');

  const blockedStorage={getItem:()=>null,setItem:()=>{throw error('QUOTA');}},noStorage=fixture({session:blockedStorage});
  await assert.rejects(noStorage.api.save('invoice'),{code:'QUOTA'});checks++;
  await assert.rejects(noStorage.api.save('invoice'),{code:'QUOTA'});checks++;
  ok(noStorage.state.calls.length===0,'missing receipt storage blocks first and retry mutations');

  const malicious=fixture();malicious.ui={title:'<script>alert(1)</script>',items:[],ui:{fields:{}}};await malicious.api.save('invoice');
  ok(!malicious.api.view('invoice').includes('<script>')&&malicious.api.view('invoice').includes('&lt;script&gt;'),'cloud title is escaped in markup');
  const wrongReopen=fixture();await wrongReopen.api.save('invoice');wrongReopen.state.data.state='committed';await wrongReopen.api.reopen(wrongReopen.state.data.id,'invoice');ok(wrongReopen.api.view('invoice').includes('原筆已正式送出，無法回到草稿'),'commit winning reopen race shows original success instead of retry trap');
  ok(!wrongReopen.state.calls.some(c=>c[0]==='reopen'),'committed documents cannot be reopened as editable draft');
  console.log('PASS cloud draft workspace '+checks+' checks');
  if(process.env.FINANCE_CLOUD_WORKSPACE_BROWSER==='1')await browserCoverage();
})().catch(e=>{console.error(e);process.exitCode=1;});

async function browserCoverage(){
  const {chromium,webkit}=require('playwright'),path=require('node:path');let browserChecks=0;
  const css=['finance-core.css','finance-completion.css'].map(name=>fs.readFileSync(path.join(__dirname,'../assets/styles',name),'utf8')).join('\n');
  for(const [name,launcher] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await launcher.launch({headless:true});
    try{const page=await browser.newPage({viewport:{width:1280,height:900}});
      await page.route('**/*',route=>route.request().url()==='https://cloud-fixture.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><main id="fixture"></main></body></html>'}):route.abort());
      await page.goto('https://cloud-fixture.test/');await page.addStyleTag({content:css});await page.addScriptTag({path:path.join(__dirname,'../assets/engines/cloud-draft-workspace.js')});
      await page.evaluate(()=>{
        const clone=x=>JSON.parse(JSON.stringify(x));window.fixtureData={ok:true,id:'00000000-0000-4000-8000-000000000001',documentType:'invoice',dataEnvironment:'production',revision:1,state:'ready',operationKey:'cloud_invoice_00000000-0000-4000-8000-000000000001',payload:{title:'九月課程完整申請',items:[],ui:{fields:{reason:'九月課程'}}},files:[],title:'九月課程完整申請',updatedAt:'2026-10-11 20:00',expectedCount:501,stagedCount:501};
        window.fixtureUi=clone(fixtureData.payload);window.fixtureDirty=false;window.fixtureSaved=0;window.fixtureRestored=0;window.fixtureMutations=0;window.fixtureLost=false;
        FinanceCloudDraftWorkspace.install({identity:()=> 'actor|tenant|epoch1',ownerKey:()=> 'actor|tenant',environment:()=> 'production',paint:()=>document.getElementById('fixture').innerHTML=FinanceCloudDraftWorkspace.view('invoice'),capture:()=>({payload:clone(fixtureUi),files:[]}),saved:()=>fixtureSaved++,beforeReopen:(_k,_ui,draft)=>{const active=FinanceCloudDraftWorkspace.active('invoice');if(fixtureDirty&&(!active||active.id!==draft.id))throw Object.assign(new Error('目前表單有未保存變更'),{code:'DIRTY_FORM'});},beforeRestore:()=>{if(fixtureDirty)throw Object.assign(new Error('目前表單有未保存變更'),{code:'DIRTY_FORM'});},restore:()=>fixtureRestored++,reopened:(_k,prev,next)=>window.fixtureKeys=[prev.operationKey,next.operationKey],showResult:()=>({displayPending:true}),resume:()=>({displayPending:true}),client:{list:async()=>({rows:[clone(fixtureData)],nextCursor:null}),read:async()=>clone(fixtureData),reopen:async d=>{fixtureMutations++;fixtureData.state='draft';fixtureData.revision++;fixtureData.operationKey='cloud_invoice_'+fixtureData.id+'_'+fixtureData.revision;return clone(fixtureData);},save:async d=>{fixtureMutations++;fixtureData=Object.assign({},fixtureData,{id:d.id,revision:d.revision+1,state:'draft',payload:clone(d.payload),files:clone(d.files),operationKey:'cloud_invoice_'+d.id});if(fixtureLost)throw new Error('雲端回應逾時');return clone(fixtureData);},reconcileSave:async d=>clone(fixtureData)}});
        document.getElementById('fixture').innerHTML=FinanceCloudDraftWorkspace.view('invoice');
      });
      await page.getByRole('button',{name:'讀取雲端記錄'}).click();await page.getByRole('button',{name:'回到草稿修正'}).waitFor();browserChecks++;
      await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,name+' narrow page does not overflow');browserChecks++;
      const target=page.getByRole('button',{name:'回到草稿修正'});assert.ok((await target.boundingBox()).height>=44,JSON.stringify(await target.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),min:getComputedStyle(e).minHeight,height:getComputedStyle(e).height,font:getComputedStyle(e).fontSize}))));browserChecks++;
      await page.evaluate(()=>window.fixtureDirty=true);await target.click();await page.getByRole('status').filter({hasText:'目前表單有未保存變更'}).waitFor();assert.equal(await page.evaluate(()=>fixtureMutations),0);browserChecks++;
      await page.evaluate(()=>window.fixtureDirty=false);await page.getByRole('button',{name:'回到草稿修正'}).focus();await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'已還原第 2 版'}).waitFor();assert.equal(await page.evaluate(()=>fixtureRestored),1);browserChecks++;
      await page.evaluate(()=>{fixtureLost=true;fixtureUi.ui.fields.reason='未確認草稿';});await page.getByRole('button',{name:'保存目前草稿'}).click();await page.getByRole('button',{name:'確認上次草稿'}).waitFor();browserChecks++;
      const receipt=await page.evaluate(()=>Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.getItem(sessionStorage.key(i))).join(''));assert.ok(!receipt.includes('未確認草稿'));browserChecks++;
      await page.evaluate(()=>{fixtureLost=false;fixtureUi.ui.fields.reason='再編輯';});const before=await page.evaluate(()=>fixtureMutations);await page.getByRole('button',{name:'確認上次草稿'}).click();await page.getByRole('status').filter({hasText:'目前表單另有變更'}).waitFor();assert.equal(await page.evaluate(()=>fixtureMutations),before);assert.equal(await page.evaluate(()=>fixtureSaved),0);browserChecks++;
      await page.screenshot({path:'/tmp/finance-cloud-workspace-'+name+'-375-20261011.png',fullPage:true});
      await page.setViewportSize({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);browserChecks++;
    }finally{await browser.close();}
  }
  console.log('PASS cloud draft workspace browser '+browserChecks+' checks (Chromium + WebKit, keyboard, 375px + desktop)');
}
