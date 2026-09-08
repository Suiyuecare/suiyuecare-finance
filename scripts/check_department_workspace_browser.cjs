'use strict';
// Local-only Playwright UI check. External requests are aborted; no real login,
// access tokens or production records. Browser hooks exist only in this response.
// NODE_PATH=<Playwright package directory> node scripts/check_department_workspace_browser.cjs
// --root <snapshot> --label before|after --output <directory> [--serve]
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(option('--root',path.join(__dirname,'..'))),label=option('--label','after');
const output=path.resolve(option('--output',path.join('/tmp','finance-department-workspace-'+label+'-'+Date.now())));
const fixtureFor=require('./fixtures/department_workspace.cjs');
const {applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const setup=`(function(f){
  window.__departmentRpc=window.__departmentRpc||[];window.__departmentWrites=window.__departmentWrites||[];
  getSb=function(){return {rpc:async function(name,args){window.__departmentRpc.push({name:name,args:args});throw new Error('Unexpected RPC in browsing-only fixture: '+name);}};};
  USERS=f.users;ENTS=f.entities.map(function(e){return {id:e.code,n:e.legal_name,s:e.short_name};});
  DEPTS=f.units.filter(function(u){return u.is_posting_unit;}).map(function(u){return {c:u.code,n:u.name,eid:'F1',entityCodes:['F1','F2'],newFormEntityCodes:['F1','F2'],lv:u.unit_type==='department'?3:u.unit_type==='section'?4:5,active:true,parentCode:(f.units.find(function(p){return p.id===u.parent_org_unit_id;})||{}).code||'',isPostingUnit:true};});
  ORG_CHART=[];DEPARTMENT_HISTORY_ALIASES=[];REQS=[];INVS=[];BILLS=[];NOTIFS=[];
  S.demoLogin=true;S.user=USERS[0];S.user.authUserId='00000000-0000-4000-a000-000000000001';
  CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:'',membershipUserId:'',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};
  doEnter(S.user);MEMBERSHIP_ORG_RUNTIME=f.runtime;MEMBERSHIP_ORG_DRAFT=f.draft;
  window.__financeInjectMembershipOrgAdminSmokeState(f.runtime,f.draft);
  nav('settings',null);settingsTab('departments');renderSettingDepts();
  window.__departmentReady=true;
})`;
const hook=`window.__departmentTest={run:function(code){return eval(code);}};window.__setDepartmentFixture=function(mode){return (${setup})(structuredClone(window.__departmentFixtures[mode||'draft']));};`;
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert.ok(html.includes('bootAuthGate();\n\n})();'),'known closure injection point');
html=html.replace('bootAuthGate();\n\n})();',hook+'\nbootAuthGate();\n\n})();');
html=html.replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const fixtures=Object.fromEntries(['draft','readonly','hidden','review'].map(mode=>[mode,fixtureFor(mode)]));
html=html.replace(/<\/body>\s*<\/html>\s*$/,`<script>window.__departmentFixtures=${JSON.stringify(fixtures).replace(/</g,'\\u003c')};window.addEventListener('load',function(){setTimeout(function(){window.__setDepartmentFixture('draft');},0);});</script></body></html>`);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/__department-fixture.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(fixtures));return;}
 const file=path.resolve(root,'.'+pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');res.end(html);return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));
});
async function metrics(page){return page.evaluate(()=>{
 const box=document.querySelector('#settings-membership-org-admin');const visible=e=>{if(e.matches('.combo-native-select')||!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;const closed=e.closest('details:not([open])');return !closed||(e.tagName==='SUMMARY'&&e.parentElement===closed);};
 const scroller=document.querySelector('.content')||document.scrollingElement;const nav=box.querySelector('.org-workspace-nav');const navRect=nav&&nav.getBoundingClientRect();
 return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,contentHeight:scroller.scrollHeight,panelHeight:Math.round(box.getBoundingClientRect().height),visibleInputs:[...box.querySelectorAll('input,select,textarea')].filter(visible).length,visibleButtons:[...box.querySelectorAll('button')].filter(visible).length,nav:nav&&visible(nav)?{width:nav.clientWidth,scrollWidth:nav.scrollWidth,clippedRows:[...nav.querySelectorAll('.org-tree-row')].filter(visible).filter(e=>e.getBoundingClientRect().right>navRect.right+1||e.getBoundingClientRect().left<navRect.left-1).map(e=>e.textContent.slice(0,70))}:null,memberRows:box.querySelectorAll('.org-member-row').length,editors:[...box.querySelectorAll('.org-member-editor[open]')].filter(visible).length,smallControls:[...box.querySelectorAll('button,summary,input:not([type=checkbox]),select')].filter(visible).filter(e=>e.getBoundingClientRect().height<43.9).map(e=>({text:e.textContent.slice(0,45)||e.getAttribute('aria-label'),height:e.getBoundingClientRect().height})).slice(0,20),rpc:window.__departmentRpc.slice()};
 });}
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
 if(args.includes('--serve')){console.log(JSON.stringify({url,root,label,fixtureSha256:sha(JSON.stringify(fixtures))}));return;}
 fs.mkdirSync(output,{recursive:true});
 const {chromium}=require('playwright');browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const blocked=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(url).origin||u.protocol==='data:'||u.protocol==='blob:')return route.continue();blocked.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];
 page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message);});page.on('dialog',d=>d.dismiss());
 await page.goto(url);await page.waitForFunction(()=>window.__departmentReady===true);
 await page.locator('#settings-tabs button').filter({hasText:'部門資訊'}).click();
 assert.deepEqual(errors,[],'actual shipped page initializes');
 if(label!=='before'){await page.locator('#org-workspace-search').fill('日間照顧');await page.locator('.org-tree-select[data-org-unit-id=daycare]').click();await page.locator('#org-workspace-search').fill('');}
 const widths=label==='before'?[1440,390]:[375,390,430,760,900,1440],results=[];
 for(const width of widths){
  await page.setViewportSize({width,height:width<600?844:1000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator(label==='before'?'.membership-org-node[data-org-unit-id=daycare]':'.org-workspace-detail').evaluate(node=>{const c=document.querySelector('.content');c.scrollTop+=node.getBoundingClientRect().top-(innerWidth<=900?155:100);});
  await page.screenshot({path:path.join(output,label+'-'+width+'.png'),fullPage:false});
  const m=await metrics(page);results.push(m);fs.writeFileSync(path.join(output,'metrics-'+width+'.json'),JSON.stringify(m,null,2));
  if(label!=='before'){if(width<=900){assert.equal(await page.locator('#mobile-settings-section').inputValue(),'departments','mobile settings picker matches active department tab');assert.notEqual(await page.locator('.org-breadcrumb').evaluate(e=>getComputedStyle(e).position),'fixed','breadcrumb never replaces fixed bottom navigation');}assert.ok(m.documentWidth<=width,'no document overflow at '+width);if(m.nav){assert.ok(m.nav.scrollWidth<=m.nav.width+1,'no nav overflow at '+width);assert.deepEqual(m.nav.clippedRows,[],'no clipped tree rows at '+width);}assert.deepEqual(m.smallControls,[],'44px controls at '+width);assert.equal(m.editors,0,'member editor starts closed at '+width);}
 }
 if(label!=='before')await checkWorkspace(page);
 assert.deepEqual(errors,[],'all UI actions finish without page errors');
 assert.deepEqual(await page.evaluate(()=>window.__departmentRpc),[],'browsing UI never calls RPC');
 const report={label,root,sourceSha256:sha(original),sourceAfterSha256:sha(fs.readFileSync(path.join(root,'index.html'))),fixtureSha256:sha(JSON.stringify(fixtures)),results,errors,blockedExternalRequests:blocked,output};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(!args.includes('--serve'))await new Promise(resolve=>server.close(resolve));});
async function checkWorkspace(page){
 const scope=code=>page.evaluate(code=>window.__departmentTest.run(code),code);
 const selected=()=>page.locator('.org-workspace-detail').getAttribute('data-org-selected-unit-id');
 const search=page.locator('#org-workspace-search');
 assert.equal(await page.locator('.org-workspace').count(),1,'workspace is mounted');
 assert.equal(await selected(),'daycare','same five-member unit used in before/after');
 assert.equal(await page.locator('.org-member-row').count(),5,'only selected unit members are rendered');
 const runtimeBefore=await scope('JSON.stringify(MEMBERSHIP_ORG_RUNTIME.graph)');
 const draftBefore=await scope('JSON.stringify(MEMBERSHIP_ORG_DRAFT.snapshot)');
 await page.locator('[data-org-focus="toggle:care"]').click();
 assert.equal(await page.locator('.org-tree-select[data-org-unit-id=daycare]').isVisible(),false,'collapse hides child units');
 await page.locator('[data-org-focus="toggle:care"]').click();
 assert.equal(await page.locator('.org-tree-select[data-org-unit-id=daycare]').isVisible(),true,'expand restores child units');
 await search.fill('完全不存在的單位');
 assert.equal(await page.locator('.org-search-empty').count(),1,'empty search state is visible');
 assert.equal(await search.evaluate(e=>document.activeElement===e),true,'search retains focus across rerender');
 await search.fill('east');
 await page.locator('.org-tree-select[data-org-unit-id=east]').click();
 assert.equal(await selected(),'east','case-insensitive code search selects the exact unit');
 await search.fill('');
 await page.locator('[data-org-focus="breadcrumb:daycare"]').click();
 assert.equal(await selected(),'daycare','breadcrumb navigates to parent unit');
 assert.equal(await scope('JSON.stringify(MEMBERSHIP_ORG_DRAFT.snapshot)'),draftBefore,'search, collapse and unit selection never mutate the draft');
 const member=page.locator('.org-member-row[data-assignment-id="assignment-2"]');
 assert.equal(await member.locator('select:visible').count(),0,'member fields hidden until explicit edit');
 await member.locator('summary').click();
 assert.equal(await member.locator('details').getAttribute('open'),'','explicit edit opens only that member');
 const kind=member.locator('select[aria-label="主兼任"]');
 await kind.focus();
 await kind.selectOption('secondary');
 assert.equal(await selected(),'daycare','assignment patch keeps selected unit');
 assert.equal(await kind.inputValue(),'secondary','actual assignment handler applies local patch');
 assert.equal(await kind.evaluate(e=>document.activeElement===e),true,'focus survives assignment patch rerender');
 assert.equal(await member.locator('details').getAttribute('open'),'','member editor stays open after patch');
 assert.equal(await scope('MEMBERSHIP_ORG_DRAFT.dirty'),true,'patch marks the draft dirty');
 assert.equal(await scope('JSON.stringify(MEMBERSHIP_ORG_RUNTIME.graph)'),runtimeBefore,'editing draft never mutates published runtime');
 await page.setViewportSize({width:390,height:844});
 await member.locator('details').evaluate(node=>node.scrollIntoView({block:'center'}));
 await page.screenshot({path:path.join(output,'after-member-editor-390.png')});
 let m=await metrics(page);assert.ok(m.documentWidth<=390,'open member editor fits 390px');assert.deepEqual(m.smallControls,[],'open editor controls are 44px');
 await member.locator('summary').click();
 await page.setViewportSize({width:1440,height:1000});
 const advanced=page.locator('.org-workspace-advanced');await advanced.locator(':scope > summary').click();
 await advanced.locator('[data-org-focus="batch:east"]').check();
 const batch=advanced.locator('.combo-select[data-for-select="membership-org-batch-parent"]');
 await batch.locator('input').fill('行政管理');await batch.locator('.combo-option[data-value="admin"]').click();
 await advanced.locator('[data-org-focus="batch:west"]').check();
 assert.equal(await page.locator('#membership-org-batch-parent').inputValue(),'admin','batch target retained after selecting another unit');
 assert.ok((await batch.locator('input').inputValue()).includes('行政管理'),'visible batch selector remains in sync');
 assert.equal(await selected(),'daycare','batch checkboxes retain selected detail unit');
 await advanced.locator(':scope > summary').click();
 await page.setViewportSize({width:390,height:844});
 await page.locator('#org-workspace-mobile-toggle').click();
 m=await metrics(page);assert.ok(m.nav&&m.nav.scrollWidth<=m.nav.width+1,'opened mobile tree has no internal overflow');assert.deepEqual(m.nav.clippedRows,[],'opened mobile tree is not clipped');
 assert.equal(await search.evaluate(e=>document.activeElement===e),true,'mobile navigation opens focused search');
 await search.fill('東區');await page.locator('.org-tree-select[data-org-unit-id=east]').click();
 assert.equal(await selected(),'east','mobile search selection changes unit');
 assert.equal(await page.locator('#org-workspace-mobile-toggle').getAttribute('aria-expanded'),'false','mobile selection closes navigation');
 assert.equal(await page.locator('#org-workspace-detail-title').evaluate(e=>document.activeElement===e),true,'mobile selection focuses detail title');
 await page.locator('#org-workspace-mobile-toggle').click();await search.press('Escape');
 assert.equal(await page.locator('#org-workspace-mobile-toggle').evaluate(e=>document.activeElement===e),true,'Escape returns focus to mobile selector');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.__setDepartmentFixture('readonly'));
 await search.fill('日間照顧');await page.locator('.org-tree-select[data-org-unit-id=daycare]').click();await search.fill('');
 assert.equal(await page.locator('.org-member-row').count(),5,'read-only view retains authorized member list');
 assert.equal(await page.locator('.org-member-editor,.org-detail-actions,.org-unit-advanced,.org-workspace-advanced').count(),0,'read-only view has no editing controls');
 assert.ok((await page.locator('.org-workspace-detail').innerText()).includes('測試組員02'),'authorized names visible');
 await page.screenshot({path:path.join(output,'after-readonly-1440.png')});
 await page.evaluate(()=>window.__setDepartmentFixture('hidden'));
 assert.equal(await page.locator('.org-member-row').count(),0,'people permission loss hides cached member rows');
 assert.ok(!(await page.locator('.org-workspace').innerText()).includes('測試組員'),'cached names hidden without can_view_people');
 await page.evaluate(()=>window.__setDepartmentFixture('review'));
 assert.equal(await page.locator('.org-member-editor,.org-detail-actions').count(),0,'pending review draft is not editable');
 assert.equal(await page.locator('#membership-org-draft-toolbar button').filter({hasText:'核准並發布'}).count(),1,'authorized reviewer sees publish action');
 assert.equal(await page.locator('#membership-org-draft-toolbar button').filter({hasText:'儲存草稿'}).count(),0,'pending-review view cannot save as editable draft');
 assert.deepEqual(await page.evaluate(()=>window.__departmentRpc),[],'all browsing, permissions and local edits avoid RPC');
}
