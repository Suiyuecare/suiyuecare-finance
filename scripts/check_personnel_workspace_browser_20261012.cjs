'use strict';
// Actual personnel renderer and app styles; fictional directory and no backend.
// Proves UI dispatch, permission transitions and layout, not formal Google login.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.FINANCE_PERSONNEL_EVIDENCE || '/tmp/finance-personnel-workspace-20261012');
const { chromium, webkit } = require(path.join(root, 'node_modules/playwright'));
const source = fs.readFileSync(path.join(root, 'assets/engines/personnel-workspace.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'assets/styles/finance-core.css'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/styles/personnel-workspace.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { applyBuildEnvironment } = require('./finance_build_environment');
const appAnchor = 'bootAuthGate();\n\n})();';
assert(app.includes(appAnchor), 'actual app closure anchor exists');
assert(app.includes('FinancePersonnelWorkspace.render({'), 'actual app must integrate personnel workspace');
const actualHtml = applyBuildEnvironment(app, { target: 'local', supabaseUrl: '', supabaseAnonKey: '' }).replace(appAnchor, 'window.__personnelWorkspaceAppQA={run:async function(code){return await eval(code)}};\n' + appAnchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi, '');
const statusStart = app.indexOf('function financeGoogleLoginStatusPresentation(health){');
const statusEnd = app.indexOf('\nfunction financeGoogleLoginStatusHtml', statusStart);
assert(statusStart > -1 && statusEnd > statusStart, 'actual Google state formatter exists');
const formatter = app.slice(statusStart, statusEnd);
const data = Array.from({ length: 45 }, (_, i) => ({ id: 'qa-user-' + i, n: i === 31 ? '測試第三十二人' : '虛構人員' + (i + 1), init: '測', email: i === 0 ? 'very.long.login.identity.for.large.font.layout.testing@suiyuecare.com' : 'qa.person.' + i + '@suiyuecare.com', contactEmail: i === 0 ? 'different.contact@suiyuecare.com' : 'qa.person.' + i + '@suiyuecare.com', jobTitle: i === 0 ? '長職稱與兼任單位的版型驗證主管 / 兼任課程專案管理' : '虛構職務', role: i % 3 === 0 ? 'accountant' : i % 3 === 1 ? 'dept_manager' : 'employee', eid: i % 2 ? 'C2' : 'C1', dc: i % 2 ? 'D2' : 'D1', extension: String(10 + i), active: i < 42, orgStatus: i === 1 || i === 2 ? 'system_account' : 'active', orgSource: 'pptx-qa', googleLinkStatus: ({ 0: 'pending_rebind', 1: 'waiting_first_login', 2: 'conflict', 3: 'waiting_first_login', 4: 'failed', 5: 'unknown' })[i] || 'bound' }));
data[44].n = '<img src=x onerror="window.__injected=true">';
const setup = `
window.__users=${JSON.stringify(data)};window.__canManage=true;window.__identity='qa-tenant|qa-actor|ceo';window.__blocked=false;window.__calls=[];
${formatter}
window.__render=function(){FinancePersonnelWorkspace.render({host:'qa-directory',toolHost:'qa-tools',getUsers:()=>__users,getIdentity:()=>__identity,isBlocked:()=>__blocked,canManage:()=>__canManage,entity:u=>u.eid==='C1'?{id:'C1',s:'虛構公司一',full:'完整虛構法人名稱一'}:{id:'C2',s:'虛構公司二',full:'完整虛構法人名稱二'},department:code=>({n:code==='D1'?'虛構會計部門':'虛構教育部門'}),roleLabel:u=>({employee:'一般組員',accountant:'會計',dept_manager:'部門主管'})[u.role],scope:u=>u.role==='employee'?'self':'department',health:u=>({status:u.googleLinkStatus,email:u.email,oldEmail:'old.login@suiyuecare.com',message:u.googleLinkStatus==='conflict'?'帳號歸屬有衝突':''}),presentation:financeGoogleLoginStatusPresentation,validLoginEmail:email=>/@suiyuecare\\.com$/.test(email),supervisor:()=>({n:'虛構主管'}),onEdit:id=>__calls.push(['edit',id]),onCheckLogin:id=>__calls.push(['check',id]),onToggle:id=>__calls.push(['toggle',id]),onDelete:id=>__calls.push(['delete',id]),onAdd:()=>__calls.push(['add']),tools:[{id:'assurance',label:'檢查並修復全部帳號',run:()=>__calls.push(['assurance'])},{id:'permissions',label:'同步簽核權限',run:()=>__calls.push(['permissions'])},{id:'google',label:'檢查 Google 登入狀態',run:()=>__calls.push(['google'])}]});};__render();
`;
const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personnel QA</title><style>' + core + '\n' + css + '\nhtml{height:auto}body{display:block;min-height:100vh;background:var(--cream);padding:20px}#qa-layout{max-width:1320px;margin:auto}#qa-tools{margin-bottom:18px}</style><script>window.__engineHadBody=!!document.body;\n' + source + '</script></head><body><main id="qa-layout"><div id="qa-tools"></div><div id="qa-directory"></div></main><script>' + setup + '</script></body></html>';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Security-Policy', "connect-src 'self'; img-src 'self' data: blob:; form-action 'none'");
  if (pathname === '/' || pathname === '/_app') { res.setHeader('Content-Type', 'text/html'); return res.end(pathname === '/_app' ? actualHtml : html); }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(fs.readFileSync(file));
});
const results = [];
const actualSetup = `(async()=>{
  window.__appCalls=[];window.__appAlerts=[];window.__offboardingPreviews=0;window.__logoutTransport=[];
  window.alert=value=>__appAlerts.push(String(value));window.confirm=()=>false;
  var actor={id:'qa-actor',authUserId:'10000000-0000-4000-8000-000000000001',tenantId:'00000000-0000-0000-0000-000000000001',n:'虛構人資管理員',email:'qa.hr@suiyuecare.com',contactEmail:'qa.hr@suiyuecare.com',role:'hr',rL:'人資',eid:'C1',dc:'D1',active:true,init:'測'};
  USERS=${JSON.stringify(data)}.map((u,i)=>Object.assign({},u,{memberRevision:3,tenantId:actor.tenantId,authUserId:u.googleLinkStatus==='bound'?'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'):'',googleLoginVerifiedAt:u.googleLinkStatus==='bound'?'2026-10-01T00:00:00Z':''})).concat([actor]);USERS.find(u=>u.id==='qa-user-8').role='ceo';
  ENTS=[{id:'C1',s:'虛構公司一',full:'完整虛構法人名稱一',active:true},{id:'C2',s:'虛構公司二',full:'完整虛構法人名稱二',active:true}];
  DEPTS=[{c:'D1',n:'虛構會計部門',eid:'C1',entityCodes:['C1'],newFormEntityCodes:['C1'],isPostingUnit:true,lv:4,active:true},{c:'D2',n:'虛構教育部門',eid:'C2',entityCodes:['C2'],newFormEntityCodes:['C2'],isPostingUnit:true,lv:4,active:true}];
  REQS=[];INVS=[];BILLS=[];VOUCHERS=[];LEDGER=[];NOTIFS=[];DRAFTS=[];ORG_CHART=[{userId:'qa-user-42',supervisorId:'qa-actor',canApprove:false}];MEMBERSHIP_ORG_RUNTIME={available:false,graph:null};ORG_ADMIN_RUNTIME={available:false,employeeRoles:[]};
  CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:actor.authUserId,membershipUserId:'',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};S.user=actor;S.demoLogin=false;S.page='users';SYSTEM_SETTINGS.current_tenant_id=actor.tenantId;
  financeWorkspaceIdentityBlocked=false;financeAuthIdentityEpoch++;window.__appActor=actor;
  function canonical(u){return{id:u.id,tenant_id:actor.tenantId,name:u.n,email:u.email,org_contact_email:u.contactEmail,job_title:u.jobTitle,extension:u.extension,role:u.role,entity_id:u.eid,department_code:u.dc,active:u.active,member_revision:u.memberRevision||3,auth_user_id:u.authUserId||null,google_link_status:u.googleLinkStatus||'bound',created_at:'2026-10-01T00:00:00Z'};}
  window.__appRows=USERS.map(canonical);
  var authUser={id:actor.authUserId,email:actor.email,email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{email:actor.email,email_verified:true}}]};
  var session={access_token:'fictional-local-token',expires_at:Math.floor(Date.now()/1000)+3600,user:authUser};
  var client={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:authUser}}),signOut:async()=>{__logoutTransport.push('local-signout');return{error:null};}},
    from:function(table){var filters=[];var query={select:function(){return query},eq:function(k,v){filters.push([k,v]);return query},limit:function(){return query},order:function(){return query},in:function(){return query},is:function(){return query},neq:function(){return query},then:function(resolve,reject){var rows=table==='finance_users'?__appRows.filter(r=>filters.every(([k,v])=>String(r[k])===String(v))):[];return Promise.resolve({data:rows,error:null,count:rows.length}).then(resolve,reject)},update:function(){throw Error('QA forbids direct table update')},delete:function(){throw Error('QA forbids direct table deletion')},insert:function(){throw Error('QA forbids direct table insert')},upsert:function(){throw Error('QA forbids direct table upsert')}};return query},
    rpc:async function(name,args){__appCalls.push({name,args});
      if(name==='finance_admin_google_account_link_status_v2'){var u=USERS.find(u=>u.id===args.p_finance_user_id);return{data:{status:u.googleLinkStatus||'bound',current_login_email:u.email,finance_user_id:u.id,auth_user_id:u.authUserId||null}};}
      if(name==='finance_admin_upsert_member_reliable_v1'){var old=__appRows.find(r=>r.id===args.p_member.id);if(!old||old.member_revision!==args.p_expected_revision)return{error:{code:'PT409',status:409,message:'虛構版本衝突'}};var m=args.p_member;var row=Object.assign({},old,{name:m.name,email:m.login_email,org_contact_email:m.contact_email,job_title:m.job_title,extension:m.extension,role:m.role,entity_id:m.entity_id,department_code:m.department_code,active:m.active,member_revision:old.member_revision+1});__appRows=__appRows.map(r=>r.id===row.id?row:r);return{data:{ok:true,atomic:true,member:row,login:{status:row.google_link_status,login_email:row.email}}};}
      if(name==='finance_user_offboarding_preview'){__offboardingPreviews++;return{data:{ok:true,contract_version:1,revision:'qa-offboard-revision',counts:{documents:0,active_steps:0,future_steps:0,direct_reports:0,delegate_routes:0},documents:[],direct_reports:[],eligible_successors:[],blockers:[],warnings:[],requires_successor:false}};}
      if(/upsert|update|delete|post|action|submit|execute|repair/.test(name))throw Error('QA forbids unexpected mutation '+name);
      return{data:[],error:null};}
  };
  getSb=()=>client;isFinanceProductionBuild=()=>true;isProductionRuntime=()=>true;SUPABASE_URL=location.origin;SUPABASE_ANON_KEY='fictional-local-public-key';window.supabase={createClient:()=>client};
  window.fetch=async function(url,init){if(String(url)==='https://login.suiyuecare.com/api/portal-handoff?action=logout'&&init&&init.method==='POST'){__logoutTransport.push('virtual-portal-logout');return{ok:true,json:async()=>({ok:true,revokedModules:['hr','finance','portal']})};}throw Error('QA forbids actual external requests '+url);};
  el('main-wrap').style.display='flex';el('sidebar').style.display='flex';el('auth-loading').style.display='none';el('login-screen').style.display='none';
  document.querySelectorAll('.pg').forEach(n=>n.classList.remove('on'));el('pg-users').classList.add('on');renderUsers();enhanceLongSelects(el('pg-users'));
  return{canManage:canManageUsers(),tenant:currentTenantId(),visible:visiblePersonnelUsers().length};
})()`;
async function testActual(browser, name, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const run = code => page.evaluate(code => __personnelWorkspaceAppQA.run(code), code);
  const ok = (condition, label) => { assert(condition, name + '-actual-' + width + ': ' + label); checks.push(label); };
  const click = async (action, id) => page.locator('[data-fpw-action="' + action + '"]' + (id ? '[data-fpw-id="' + id + '"]' : '')).filter({ visible: true }).first().click();
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/_app');
    await page.waitForFunction(() => window.__personnelWorkspaceAppQA);
    const ready = await run(actualSetup); ok(ready.canManage && ready.visible === 46, 'actual permission and authorized directory helpers enable HR');
    ok(await page.locator('#user-wrap .fpw-table tbody tr').count() === 20, 'actual renderUsers invokes new renderer with page size twenty');
    ok(await page.locator('#pg-users .combo-select[data-for-select]').filter({ has: page.locator('[data-fpw-filter]') }).count() === 0 && await page.locator('select[data-fpw-filter]').evaluateAll(nodes => nodes.every(n => !n.classList.contains('combo-native-select'))), 'actual global combo enhancer preserves native filters');
    ok(await page.locator('#user-health summary').first().innerText().then(t => /需要處理/.test(t)), 'collapsed actual health summary still exposes issues');
    await page.locator('#fpw-search').fill('測試第三十二人');
    ok(await page.locator('#user-wrap .fpw-table tbody tr').count() === 1, 'actual directory searches beyond first page');
    await click('clear-search');
    await click('edit', 'qa-user-6');
    ok(await page.locator('#m-add-user').isVisible() && await page.locator('#un').inputValue() === '虛構人員7', 'real edit button opens existing editor with correct identity');
    await page.locator('#un').fill('虛構同一人資料更正');
    await page.locator('#user-modal-submit').click();
    await page.waitForFunction(() => window.__appCalls.some(c => c.name === 'finance_admin_upsert_member_reliable_v1'));
    await page.waitForFunction(() => document.querySelector('#m-add-user').style.display === 'none');
    ok(await run(`USERS.find(u=>u.id==='qa-user-6').n`) === '虛構同一人資料更正', 'actual reliable save applies canonical result to same stable employee');
    ok(await page.locator('#user-wrap').innerText().then(t => t.includes('虛構同一人資料更正')), 'real save refreshes new personnel list');
    ok(await page.evaluate(() => __appCalls.filter(c => c.name === 'finance_admin_upsert_member_reliable_v1').length) === 1, 'real save invokes one original atomic operation');
    await click('more', 'qa-user-6');
    await page.locator('.fpw-menu [data-fpw-action="check-login"]').click();
    await page.waitForFunction(() => __appCalls.some(c => c.name === 'finance_admin_google_account_link_status_v2'));
    ok(await page.evaluate(() => __appCalls.filter(c => c.name === 'finance_admin_google_account_link_status_v2').length) === 1, 'new menu reaches actual login check RPC through current actor');
    await click('more', 'qa-user-6');
    await page.locator('.fpw-menu [data-fpw-action="toggle"]').click();
    await page.waitForFunction(() => document.querySelector('#user-offboarding-form').style.display === 'block', {}, {timeout:5000});
    ok(await page.locator('#m-user-offboarding').isVisible() && await page.evaluate(() => __offboardingPreviews) === 1, 'new menu opens real offboarding impact preview');
    ok(await page.locator('#user-offboarding-submit').isDisabled(), 'existing offboarding cannot execute without reason and confirmation');
    await run('closeUserOffboarding();true');
    await click('more', 'qa-user-8');
    await page.locator('.fpw-menu [data-fpw-action="toggle"]').click();
    ok(await page.evaluate(() => __offboardingPreviews) === 1 && await page.evaluate(() => __appAlerts.some(t => t.includes('執行長不能'))), 'existing CEO offboarding guard remains authoritative');
    await click('tab', 'system');
    await click('more', 'qa-user-1');
    ok(await page.locator('.fpw-menu [data-fpw-action="toggle"]').isDisabled(), 'real system account has no ordinary offboarding action');
    await page.keyboard.press('Escape');
    await click('tab', 'inactive');
    await click('more', 'qa-user-42');
    await page.locator('.fpw-menu [data-fpw-action="delete"]').click();
    ok(await page.evaluate(() => __appAlerts.some(t => t.includes('保留歷史資料'))) && await run(`USERS.some(u=>u.id==='qa-user-42')`), 'real delete handler retains employee with organization history');
    await click('tab', 'all');
    await click('view', 'qa-user-0');
    const detail = await page.locator('.fpw-drawer').innerText();
    ok(detail.includes(data[0].email) && detail.includes(data[0].contactEmail), 'actual detail retains both login and contact emails');
    await page.screenshot({ path: path.join(out, name + '-actual-' + width + '-detail.png') });
    await run(`nav('orgchart',null);true`);
    ok(await page.locator('.fpw-dialog').count() === 0 && await page.locator('#user-wrap').innerText() === '', 'actual page navigation removes private personnel drawer');
    await run(`nav('users',null);true`);
    ok(await page.locator('#user-wrap .fpw-table tbody tr').count() === 20, 'returning to page renders fresh directory');
    const before = await page.evaluate(() => __appCalls.length);
    await run(`S.user=Object.assign({},S.user,{role:'employee'});CURRENT_PERMISSION_SNAPSHOT={loaded:true,primaryRoleCode:'employee',permissions:[{permission_code:'member.role.manage',effect:'deny'}]};true`);
    await click('edit', 'qa-user-6');
    ok(await page.evaluate(() => __appCalls.length) === before && await page.locator('.fpw-dialog').count() === 0, 'actual role revocation blocks old rendered action');
    await run(`renderUsers();true`);
    ok(await page.locator('#user-wrap [data-fpw-action="edit"],#user-add-wrap [data-fpw-action="tool"]').count() === 0, 'actual readonly permission snapshot removes mutation controls');
    await run(`S.user=__appActor;CURRENT_PERMISSION_SNAPSHOT={loaded:false,permissions:[]};renderUsers();true`);
    await click('view', 'qa-user-0');
    await run(`setFinanceWorkspaceIdentityBlocked(true);true`);
    ok(await page.locator('.fpw-dialog').count() === 0 && await page.locator('#user-wrap').innerText() === '', 'actual identity lock clears old details before global overlay capture');
    await run(`setFinanceWorkspaceIdentityBlocked(false);renderUsers();true`);
    ok(await page.locator('.fpw-dialog').count() === 0, 'unlock never restores prior personnel dialog');
    await click('view', 'qa-user-0');
    await run(`(async()=>{await financeLogout();return true})()`);
    ok(await page.locator('.fpw-dialog').count() === 0 && await page.locator('#finance-module-logout').innerText().then(t => t.includes('已登出')), 'actual coordinated logout clears personnel and completes virtual transport');
    ok(await page.evaluate(() => __logoutTransport.join(',')) === 'virtual-portal-logout,local-signout', 'logout uses original coordination and local revocation sequence');
    ok(errors.length === 0, 'actual app has no browser JavaScript errors');
    results.push({ browser: name, width, mode: 'actual-index-with-local-virtual-RPC', checks, errors });
  } catch (e) {
    const diagnostic=await run(`(async()=>({alerts:__appAlerts,calls:__appCalls,offboarding:USER_OFFBOARDING_STATE,canManage:canManageUsers(),blocked:financeWorkspaceIdentityBlocked,user:S.user,ready:await ensureSupabaseWriteReady('虛構驗收診斷')}))()`).catch(()=>null);
    fs.writeFileSync(path.join(out,name+'-actual-'+width+'-failure.json'),JSON.stringify({error:e.message,checks,errors,diagnostic},null,2));
    throw e;
  } finally { await context.close(); }
}
async function test(browser, name, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const ok = (condition, label) => { assert(condition, name + '-' + width + ': ' + label); checks.push(label); };
  const visible = selector => page.locator(selector).filter({ visible: true });
  const click = async (action, id) => visible('[data-fpw-action="' + action + '"]' + (id ? '[data-fpw-id="' + id + '"]' : '')).first().click();
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.FinancePersonnelWorkspace && document.querySelector('.fpw'));
    ok(await page.evaluate(() => !window.__engineHadBody), 'engine really loads in head before document body exists');
    ok(await page.locator('select[data-fpw-filter][data-no-search="1"]').count() === 2, 'native personnel filters opt out of existing combo owner');
    ok(await noOverflow(), 'initial page has no horizontal overflow');
    ok(await page.locator('.fpw-table thead th').count() === 5, 'five columns retained');
    ok(await page.locator('.fpw-table tbody tr').count() === 20, 'first page has exactly 20 accounts');
    ok(await page.locator('button.fpw-name').filter({visible:true}).evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44)), 'each clickable employee name has at least 44 pixel height');
    ok(await page.locator('.fpw-button').filter({visible:true}).evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44)), 'all visible personnel primary controls retain 44 pixel height');
    ok(await page.locator('.fpw-footer').innerText().then(t => t.includes('共 45 個帳號')), 'page count includes authorized full directory');
    await page.screenshot({ path: path.join(out, name + '-' + width + '-list.png'), fullPage: true });
    await page.locator('#fpw-search').fill('測試第三十二人');
    ok(await page.locator('.fpw-table tbody tr').count() === 1 && await page.locator('.fpw-table').innerText().then(t => t.includes('測試第三十二人')), 'search finds a person beyond first loaded page');
    await click('clear-search');
    await click('next');
    ok(await page.evaluate(() => FinancePersonnelWorkspace.snapshot().page) === 2, 'next page changes active page');
    await click('tab', 'attention');
    ok(await page.locator('.fpw-table tbody tr').count() === 6, 'attention includes pending, rebind, conflicts, failed and unknown');
    await click('tab', 'system');
    ok(await page.locator('.fpw-table tbody tr').count() === 2 && await visible('.fpw-mini').first().innerText() === '系統帳號', 'system accounts separated from employee count');
    await click('more', 'qa-user-1');
    ok(await page.locator('.fpw-menu [data-fpw-action="toggle"]').isDisabled(), 'system account cannot use ordinary offboarding');
    ok(await page.locator('.fpw-menu [data-fpw-action="delete"]').isDisabled(), 'active account deletion unavailable');
    await page.keyboard.press('Escape');
    ok(await page.locator('dialog').count() === 0, 'Escape closes menu');
    await click('tab', 'inactive');
    ok(await page.locator('.fpw-table tbody tr').count() === 3, 'inactive filter includes all three disabled accounts');
    ok(await page.evaluate(() => !window.__injected && !document.querySelector('img')), 'untrusted employee name is escaped');
    await click('more', 'qa-user-42');
    await page.locator('.fpw-menu [data-fpw-action="toggle"]').click();
    ok(await page.evaluate(() => __calls.filter(c => c[0] === 'toggle').length) === 1, 'enable dispatches exactly once through existing callback');
    await click('more', 'qa-user-42');
    await page.locator('.fpw-menu [data-fpw-action="delete"]').click();
    ok(await page.evaluate(() => __calls.filter(c => c[0] === 'delete').length) === 1, 'inactive delete reaches original guard callback exactly once');
    await click('tab', 'all');
    await click('more', 'qa-user-0');
    ok(await page.locator('.fpw-menu [data-fpw-action="view"]').evaluate(b => b === document.activeElement), 'more dialog initially focuses first safe action');
    await page.keyboard.press('Tab');
    ok(await page.locator('.fpw-menu [data-fpw-action="check-login"]').evaluate(b => b === document.activeElement), 'keyboard Tab reaches login check (' + await page.evaluate(() => document.activeElement.outerHTML.slice(0, 160)) + ')');
    await page.keyboard.press('Shift+Tab');
    ok(await page.locator('.fpw-menu [data-fpw-action="view"]').evaluate(b => b === document.activeElement), 'keyboard Shift Tab returns to first action');
    await page.keyboard.press('Escape');
    ok(await visible('[data-fpw-action="more"][data-fpw-id="qa-user-0"]').evaluate(b => b === document.activeElement), 'closing native menu restores triggering button focus');
    await page.locator('[data-fpw-filter="company"]').selectOption('C2');
    await page.locator('[data-fpw-filter="role"]').selectOption('dept_manager');
    ok(await page.locator('.fpw-table tbody tr').count() === 8, 'company and role filters combine across entire directory');
    await page.locator('#fpw-search').fill('not present');
    ok(await page.locator('.fpw-empty').isVisible(), 'empty results provide reset action');
    await click('reset');
    await page.locator('[data-fpw-filter="company"]').selectOption('C2');
    await page.evaluate(() => { __users = __users.filter(u => u.eid === 'C1'); __render(); });
    ok(await page.evaluate(() => FinancePersonnelWorkspace.snapshot().company) === '' && await page.locator('[data-fpw-filter="company"]').inputValue() === '', 'removed company cannot leave hidden stale filter');
    await page.evaluate(data => { __users = data; __render(); }, data);
    await click('view', 'qa-user-0');
    const body = await page.locator('.fpw-drawer').innerText();
    ok(body.includes(data[0].email) && body.includes(data[0].contactEmail) && body.includes('完整虛構法人名稱一'), 'detail preserves complete company and distinct emails');
    ok(body.includes('舊帳號仍可登入') && body.includes('虛構主管'), 'rebind semantics and supervisor retained');
    ok(await page.locator('.fpw-drawer').evaluate(d => d.scrollWidth <= d.clientWidth + 1), 'long email does not overflow drawer');
    await page.screenshot({ path: path.join(out, name + '-' + width + '-detail.png') });
    await page.locator('.fpw-drawer [data-fpw-action="edit"]').click();
    ok(await page.evaluate(() => __calls.filter(c => c[0] === 'edit').length) === 1 && await page.locator('dialog').count() === 0, 'edit closes own drawer before original edit handler');
    await click('more', 'qa-user-0');
    await page.locator('.fpw-menu [data-fpw-action="check-login"]').click();
    ok(await page.evaluate(() => __calls.filter(c => c[0] === 'check').length) === 1, 'login check uses existing handler exactly once');
    await page.locator('.fpw-tools summary').click();
    for (const id of ['assurance', 'permissions', 'google']) await click('tool', id);
    await click('add');
    ok(await page.evaluate(() => ['assurance', 'permissions', 'google', 'add'].every(id => __calls.filter(c => c[0] === id).length === 1)), 'all existing administrative tools and add action retained');
    const callsBefore = await page.evaluate(() => __calls.length);
    await page.evaluate(() => { __canManage = false; });
    await click('edit', 'qa-user-0');
    ok(await page.evaluate(() => __calls.length) === callsBefore, 'permission revoked after paint prevents stale button action');
    await page.evaluate(() => __render());
    ok(await page.locator('[data-fpw-action="edit"],[data-fpw-action="more"],[data-fpw-action="tool"],[data-fpw-action="add"]').count() === 0, 'readonly role has no edit or management actions');
    await click('view', 'qa-user-0');
    ok(await page.locator('.fpw-drawer').innerText().then(t => t.includes('唯讀')), 'readonly still has permitted details');
    await page.keyboard.press('Escape');
    await page.locator('#fpw-search').fill('very.long.login');
    ok(await page.locator('.fpw-table tbody tr').count() === 1, 'email search supports long login identity');
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    ok(await noOverflow(), '200 percent zoom avoids horizontal page overflow');
    await click('view', 'qa-user-0');
    ok(await page.locator('.fpw-drawer').evaluate(d => d.scrollWidth <= d.clientWidth + 1), '200 percent zoom drawer remains readable');
    await page.screenshot({ path: path.join(out, name + '-' + width + '-zoom-200.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.body.style.zoom = ''; __canManage = true; __render(); });
    await click('view', 'qa-user-0');
    await page.evaluate(() => { __identity = 'qa-other-actor'; document.body.setAttribute('data-finance-identity-blocked', 'true'); });
    await page.waitForTimeout(30);
    ok(await page.locator('dialog').count() === 0 && await page.locator('#qa-directory').innerText() === '', 'identity lock removes prior employee details and directory');
    await page.evaluate(() => { document.body.removeAttribute('data-finance-identity-blocked'); __users = []; __blocked = false; __render(); });
    ok(await page.locator('.fpw-empty').innerText().then(t => t.includes('目前沒有可查看')), 'truly empty directory differs from filtered no results');
    ok(errors.length === 0, 'no browser JavaScript errors');
    results.push({ browser: name, width, checks, errors });
  } finally { await context.close(); }
}
(async () => {
  fs.mkdirSync(out, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) { const browser = await engine.launch({ headless: true }); try { for (const width of [1440, 768, 390]) await test(browser, name, width); for (const width of [1440,390]) await testActual(browser,name,width); } finally { await browser.close(); } } }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(fs.readFileSync(path.join(root,'assets/engines/personnel-workspace.js'),'utf8'),source,'personnel engine unchanged throughout QA');
  assert.equal(fs.readFileSync(path.join(root,'assets/styles/personnel-workspace.css'),'utf8'),css,'personnel styles unchanged throughout QA');
  assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),app,'actual app source unchanged throughout QA');
  const evidence = { generatedAt: new Date().toISOString(), scope: 'actual personnel renderer/shared styles plus actual index permissions, save, login-check, offboarding, navigation and logout handlers using local virtual transport; no formal data, real OAuth or backend writes', sourceSha256: crypto.createHash('sha256').update(source + css).digest('hex'), appSourceSha256: crypto.createHash('sha256').update(app).digest('hex'), passed: true, cases: results.length, checks: results.reduce((n, r) => n + r.checks.length, 0), results };
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ passed: true, cases: evidence.cases, checks: evidence.checks, evidence: path.join(out, 'evidence.json') }));
})().catch(e => { console.error(e); process.exitCode = 1; });
