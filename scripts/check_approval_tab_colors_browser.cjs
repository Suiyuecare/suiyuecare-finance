'use strict';
// Real local page/CSS with fictional records. No production identity or RPC.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { applyBuildEnvironment } = require('./finance_build_environment');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const out = process.env.APPROVAL_COLORS_EVIDENCE || '/tmp/finance-approval-tab-colors-20260914';
const baseline = process.env.APPROVAL_COLORS_BASELINE === '1';
const prefix = baseline ? 'before' : 'after';
const session = 'approval-tab-colors-' + process.pid;
const anchor = 'bootAuthGate();\n\n})();';
let html = applyBuildEnvironment(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { target: 'local', supabaseUrl: '', supabaseAnonKey: '' });
assert(html.includes(anchor), 'Use actual application closure');
html = html.replace(anchor, 'window.__approvalColors={run:async function(code){return await eval(code)}};\n' + anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi, '')
  .replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const baselineCss = baseline ? execFileSync('git', ['show', 'HEAD:assets/styles/approval-navigation.css'], { cwd: root, encoding: 'utf8' }) : null;
const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const filename = path.resolve(root, '.' + urlPath);
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (filename === root || filename === path.join(root, 'index.html')) { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
  if (baseline && urlPath === '/assets/styles/approval-navigation.css') { res.setHeader('Content-Type', 'text/css'); return res.end(baselineCss); }
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
  res.end(fs.readFileSync(filename));
});
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 8e6 })).stdout;
async function scope(code) {
  const expression = '(async()=>JSON.stringify(await window.__approvalColors.run(' + JSON.stringify(code) + ')))()';
  const result = JSON.parse(await browser('eval', '--base64', Buffer.from(expression).toString('base64')));
  return typeof result === 'string' ? JSON.parse(result) : result;
}
const rgb = color => color.match(/[\d.]+/g).map(Number);
const luminance = color => rgb(color).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
function contrast(foreground, background) {
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (levels[0] + .05) / (levels[1] + .05);
}
function composite(foreground, background) {
  const top = rgb(foreground), bottom = rgb(background), alpha = top.length > 3 ? top[3] : 1;
  return 'rgb(' + top.slice(0, 3).map((v, i) => v * alpha + bottom[i] * (1 - alpha)).join(',') + ')';
}
async function tabStyles() {
  // Observe the settled real transition, rather than sampling an intermediate
  // color between the unselected and selected palettes after a genuine click.
  await scope(`(async function(){var b=document.querySelector('#pg-approvals .approval-tabs-scroll');getComputedStyle(b).color;await Promise.all(b.getAnimations({subtree:true}).map(function(a){return a.finished.catch(function(){});}));return true;})()`);
  return scope(`(function(){
    var button=document.querySelector('#pg-approvals [data-approval-tab].on'),s=getComputedStyle(button),r=button.getBoundingClientRect();
    return {tab:button.dataset.approvalTab,color:s.color,background:s.backgroundColor,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,
      height:r.height,children:Array.from(button.querySelectorAll('*')).map(function(node){var cs=getComputedStyle(node);return {tag:node.tagName,color:cs.color,background:cs.backgroundColor,text:node.textContent};}),
      activeCount:document.querySelectorAll('#pg-approvals [data-approval-tab].on').length,
      selected:button.getAttribute('aria-selected'),sidebarOrange:getComputedStyle(document.documentElement).getPropertyValue('--admin-orange').trim(),
      pageWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      targets:Array.from(document.querySelectorAll('#pg-approvals [data-approval-tab]')).map(function(t){var b=t.getBoundingClientRect();return {height:b.height,left:b.left,right:b.right};})};
  })()`);
}
function verifyColors(state) {
  assert.equal(state.activeCount, 1);
  assert.equal(state.selected, 'true');
  assert.equal(state.scrollWidth, state.pageWidth);
  assert(state.targets.every(t => t.height >= 44 && t.left >= 0 && t.right <= state.pageWidth + 1), 'All touch targets remain visible and at least 44px');
  assert.equal(state.sidebarOrange, '#ea880c', 'Do not alter sidebar theme');
  state.labelContrast = contrast(state.color, state.background);
  state.badgeContrast = contrast(state.children[0].color, composite(state.children[0].background, state.background));
  if (!baseline) {
    assert.equal(state.color, 'rgb(255, 255, 255)', 'Selected title must be white');
    assert(state.children.length > 0);
    assert(state.children.every(child => child.color === 'rgb(255, 255, 255)'), 'Every selected label/badge descendant must be white');
    assert(state.labelContrast >= 4.5, 'Selected title AA contrast');
    assert(state.badgeContrast >= 4.5, 'Selected badge AA contrast');
  }
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await browser('open', 'http://127.0.0.1:' + server.address().port);
  await scope(`(function(){
    USERS=[{id:'reviewer',n:'示範主管',email:'reviewer@example.invalid',authUserId:'fictional-auth',role:'ceo',rL:'執行長',eid:'E1',dc:'D1',active:true}];
    ENTS=[{id:'E1',s:'示範公司',full:'示範公司',active:true}];DEPTS=[{c:'D1',n:'示範部門',eid:'E1',lv:3,active:true}];
    REQS=[];INVS=[];BILLS=[];DRAFTS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');
    S.aT='p';S.apprQuery='';S.apprPage=1;nav('approvals',null);setApprovalTabVisual('p');buildApprovals();
    window.__colorsOriginal=JSON.stringify({REQS:REQS,INVS:INVS,BILLS:BILLS,DRAFTS:DRAFTS});return true;
  })()`);
  fs.writeFileSync(path.join(out, prefix + '-snapshot.txt'), await browser('snapshot', '-i'));
  const evidence = [];
  for (const width of [1440, 390]) {
    await browser('set', 'viewport', String(width), '1000');
    for (const tab of ['p', 'cashier', 'mine', 'drafts', 'h', 'rejected']) {
      await browser('click', '[data-approval-tab="' + tab + '"]');
      await scope(`(function(){document.querySelectorAll('#pg-approvals [data-approval-tab]>span').forEach(function(n,i){n.textContent=String([12,8,36,3,42,2][i]);});return true;})()`);
      const state = await tabStyles();verifyColors(state);assert.equal(state.tab, tab);evidence.push(state);
    }
    await browser('click', '[data-approval-tab="p"]');
    await browser('press', 'ArrowRight');
    const focused = await tabStyles();verifyColors(focused);assert.equal(focused.tab, 'cashier');assert.equal(focused.outlineStyle, 'solid');assert.equal(focused.outlineWidth, '3px');
    evidence.push({ ...focused, keyboardFocus: true });
    await browser('click', '[data-approval-tab="h"]');
    await scope(`(function(){document.querySelectorAll('#pg-approvals [data-approval-tab]>span').forEach(function(n,i){n.textContent=String([12,8,36,3,42,2][i]);});return true;})()`);
    verifyColors(await tabStyles());
    await browser('screenshot', path.join(out, prefix + '-' + width + '.png'));
  }
  if (!baseline) {
    await scope(`(function(){var badge=document.querySelector('#pg-approvals [data-approval-tab].on>span');badge.innerHTML='<span style="color:#634528">42</span>';return true;})()`);
    const nested = await tabStyles();verifyColors(nested);assert.equal(nested.children.length, 2);evidence.push({ ...nested, nestedBadge: true });
  }
  assert.equal(await scope('JSON.stringify({REQS:REQS,INVS:INVS,BILLS:BILLS,DRAFTS:DRAFTS})===window.__colorsOriginal'), true, 'Tab navigation leaves source records intact');
  assert.equal((await browser('errors')).trim(), '');
  fs.writeFileSync(path.join(out, prefix + '-computed.json'), JSON.stringify({ ok: true, baseline, checks: evidence.length, evidence, scope: 'Actual offline DOM and CSS, fictional identity, no production authentication or writes.' }, null, 2));
  console.log('PASS approval tab colors ' + prefix + ': ' + evidence.length + ' states; ' + out);
})().catch(error => { console.error(error);process.exitCode = 1; }).finally(async () => { await browser('close').catch(() => {});server.close(); });
