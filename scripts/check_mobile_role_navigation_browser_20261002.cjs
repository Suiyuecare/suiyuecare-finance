'use strict';
// Offline browser acceptance for the shipped Finance page and mobile engine.
// The four identities and all records are fictional; no production login or writes.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {applyBuildEnvironment}=require('./finance_build_environment');

const exec=promisify(execFile);
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.env.FINANCE_MOBILE_ROLE_EVIDENCE||'/tmp/finance-mobile-role-navigation-20261002');
const session='finance-mobile-role-navigation-'+process.pid;
const closureAnchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{
  target:'local',supabaseUrl:'',supabaseAnonKey:''
});
assert(html.includes(closureAnchor),'use the actual application closure');
html=html.replace(closureAnchor,'window.__mobileRoleQA={run:async function(code){return await eval(code)}};\n'+closureAnchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');

const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  if(file===root||file===path.join(root,'index.html')){
    response.setHeader('content-type','text/html; charset=utf-8');response.end(html);return;
  }
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){
    response.writeHead(404);response.end();return;
  }
  response.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
  response.end(fs.readFileSync(file));
});
const browser=async(...args)=>(await exec('agent-browser',['--session',session,...args],{timeout:60000,maxBuffer:8e6})).stdout;
async function scope(code){
  const expression='(async()=>JSON.stringify(await window.__mobileRoleQA.run('+JSON.stringify(code)+')))()';
  const result=JSON.parse(await browser('eval','--base64',Buffer.from(expression).toString('base64')));
  return typeof result==='string'?JSON.parse(result):result;
}
async function settled(){await browser('wait','200');}
const roles={
  ceo:{label:'執行長',expected:['dashboard','approvals','reports','recv'],denied:[]},
  // The baseline cashier role handles payment in approvals. Receivables and bill
  // entry have separate permissions and must not leak into its quick actions.
  cashier:{label:'出納',expected:['approvals','dashboard','expenses','notif'],denied:['recv','bills','reports','vouchers']},
  employee:{label:'一般組員',expected:['newreq','approvals','expenses','dashboard'],denied:['reports','vouchers','ledger','settings']},
  accountant:{label:'會計',expected:['dashboard','approvals','vouchers','reports'],denied:['users']}
};
const navState=`(function(){
  var nav=document.querySelector('[data-mobile-bottom-nav="role-primary"]');
  var menu=document.getElementById('mobile-more-backdrop');
  var visibleButtons=Array.from(document.querySelectorAll('#sidebar nav .ni')).filter(function(button){
    return !button.hidden&&button.style.display!=='none'&&!button.disabled;
  });
  var allowed=visibleButtons.map(function(button){var match=String(button.getAttribute('onclick')||'').match(/nav\\(['"]([^'"]+)/);return match&&match[1];}).filter(Boolean);
  var primary=Array.from(nav.querySelectorAll('[data-mobile-primary-action]')).filter(function(button){return !button.hidden;}).map(function(button){
    var box=button.getBoundingClientRect();
    return {page:button.dataset.mobilePrimaryAction,label:button.textContent.trim(),ariaLabel:button.getAttribute('aria-label'),active:button.getAttribute('aria-current'),width:box.width,height:box.height,left:box.left,right:box.right};
  });
  return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,role:window.financeCurrentRoleKey(),page:S.page,
    allowed:allowed,primary:primary,primaryVisible:getComputedStyle(nav).display!=='none'&&!nav.hidden,
    sidebarVisible:getComputedStyle(document.getElementById('sidebar')).display!=='none',
    menuButtonVisible:getComputedStyle(document.getElementById('mobile-menu-button')).display!=='none',
    menuOpen:!menu.hidden,menuAriaHidden:menu.getAttribute('aria-hidden'),menuExpanded:document.getElementById('mobile-menu-button').getAttribute('aria-expanded'),
    menuPages:Array.from(document.querySelectorAll('#mobile-more-grid [data-mobile-more-page]')).map(function(button){return button.dataset.mobileMorePage;}),
    focusInMenu:menu.contains(document.activeElement)};
})()`;
const report={scope:'Actual local Finance index, styles, and mobile engine; fictional identities only; external scripts removed and external connects blocked.',roles:[],screens:[]};

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [role,fixture] of Object.entries(roles)){
    await browser('open',origin);
    await scope(`(function(){
      USERS=[{id:'fictional-${role}',n:'測試${fixture.label}',email:'${role}@example.invalid',authUserId:'fictional-${role}',role:'${role}',rL:'${fixture.label}',init:'測',eid:'E1',dc:'D1',active:true}];
      ENTS=[{id:'E1',s:'虛構公司',full:'虛構公司',active:true}];
      DEPTS=[{c:'D1',n:'虛構部門',eid:'E1',lv:3,active:true}];
      REQS=[];INVS=[];BILLS=[];DRAFTS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];LEDGER=[];
      CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:'',membershipUserId:'',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};
      quickLogin('${role}');return true;
    })()`);
    await browser('set','viewport','390','844');
    await settled();
    let state=await scope(navState);
    assert.equal(state.role,role,role+' identity');
    assert.equal(state.width,390,role+' mobile viewport');
    assert.equal(state.documentWidth,390,role+' has no document overflow on phone');
    assert(state.primaryVisible,role+' bottom nav is visible on phone');
    assert(state.menuButtonVisible,role+' more menu is reachable on phone');
    const expected=fixture.expected;
    assert.deepEqual(state.primary.map(button=>button.page),expected,role+' task-specific primary routes');
    assert(state.primary.every(button=>state.allowed.includes(button.page)),role+' primary nav never exposes unauthorized routes');
    assert(fixture.denied.every(page=>!state.allowed.includes(page)&&!state.primary.some(button=>button.page===page)),role+' denied routes stay hidden');
    const mobileAllowed=state.allowed.slice();
    assert(state.primary.every(button=>button.ariaLabel===button.label&&button.width>=44&&button.height>=44&&button.left>=0&&button.right<=390),role+' primary labels and touch targets');
    const mobileScreen=path.join(output,role+'-390.png');
    await browser('screenshot',mobileScreen);report.screens.push(mobileScreen);

    await browser('click','#mobile-menu-button');
    state=await scope(navState);
    assert(state.menuOpen&&state.menuAriaHidden==='false'&&state.menuExpanded==='true'&&state.focusInMenu,role+' more menu opens with focus inside');
    assert.deepEqual(state.menuPages,state.allowed,role+' more menu exactly matches authorized sidebar pages');
    assert.equal(state.documentWidth,390,role+' open menu has no document overflow');
    const menuPage=state.allowed.find(page=>!expected.includes(page))||state.allowed[0];
    assert(menuPage,role+' has a reachable menu route');
    await browser('click','[data-mobile-more-page="'+menuPage+'"]');
    await settled();
    state=await scope(navState);
    assert.equal(state.page,menuPage,role+' more menu navigation works');
    assert.equal(state.menuOpen,false,role+' more menu closes after navigation');
    assert.equal(state.documentWidth,390,role+' selected menu page has no document overflow');
    await browser('click','[data-mobile-primary-action="'+expected[0]+'"]');
    await settled();
    state=await scope(navState);
    assert.equal(state.page,expected[0],role+' primary navigation works');
    assert.equal(state.primary.find(button=>button.page===expected[0]).active,'page',role+' active route announced');
    assert.equal(state.documentWidth,390,role+' selected primary page has no document overflow');
    await browser('click','#mobile-menu-button');
    await browser('press','Escape');
    assert.equal((await scope(navState)).menuOpen,false,role+' Escape closes more menu');

    await browser('set','viewport','1440','900');
    await settled();
    state=await scope(navState);
    assert.equal(state.documentWidth,1440,role+' desktop has no document overflow');
    assert.equal(state.primaryVisible,false,role+' bottom nav hidden on desktop');
    assert.equal(state.menuButtonVisible,false,role+' phone more button hidden on desktop');
    assert(state.sidebarVisible,role+' authorized desktop sidebar remains available');
    assert.deepEqual(state.allowed,mobileAllowed,role+' desktop permissions stable');
    const desktopScreen=path.join(output,role+'-1440.png');
    await browser('screenshot',desktopScreen);report.screens.push(desktopScreen);
    assert.equal((await browser('errors')).trim(),'','page exception for '+role);
    report.roles.push({role,allowed:state.allowed,primary:expected,menuPage,phone:mobileScreen,desktop:desktopScreen});
    console.log('PASS '+role+' mobile and desktop authorized navigation');
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('PASS Finance role-aware mobile navigation: '+output);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await browser('close').catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
});
