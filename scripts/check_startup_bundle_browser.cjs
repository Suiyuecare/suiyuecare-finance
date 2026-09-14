'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../www');
const out = path.resolve(process.env.FINANCE_STARTUP_EVIDENCE_DIR || '/tmp/finance-startup-bundle-browser');
const measure = process.argv.includes('--measure');
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.includes('var FINANCE_BUILD_TARGET="local";'), 'Browser fixture requires an offline local build');
assert.match(html, /assets\/finance-startup-[a-f0-9]{16}\.js/);
html = html.replace('bootAuthGate();\n\n})();', 'window.__startupQA={run:function(code){return eval(code)}};\nbootAuthGate();\n\n})();');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const isHtml = file === root || file === path.join(root, 'index.html');
    const bytes = isHtml ? Buffer.from(html) : fs.readFileSync(file);
    res.writeHead(200, { 'content-type': isHtml ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/png', 'content-encoding': 'gzip', 'cache-control': 'no-store' });
    res.end(zlib.gzipSync(bytes));
  } catch (_) { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: process.env.FINANCE_BROWSER_CHANNEL || 'chrome' });
  const runs = [];
  try {
    for (let i = 0; i < (measure ? 3 : 1); i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [], denied = [], requested = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', route => {
        const r = route.request(), url = new URL(r.url()); requested.push(url.pathname);
        if (!['GET', 'HEAD'].includes(r.method()) || /\/(auth|rest)\/v1\//.test(url.pathname)) { denied.push(r.method() + ' ' + url.pathname); return route.abort(); }
        if (!measure && url.hostname !== '127.0.0.1') return route.abort();
        return route.continue();
      });
      await page.addInitScript(() => { const timer = setInterval(() => { if (document.querySelector('#login-screen')?.getClientRects().length && typeof window.googleLogin === 'function') { window.__readyMs = performance.now(); clearInterval(timer); } }, 20); });
      if (measure) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 1024 * 1024 / 8, connectionType: 'cellular4g' });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__readyMs > 0);
      const timing = await page.evaluate(() => ({ readyMs: window.__readyMs, firstPaintMs: performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime, blockingHeadScripts: Array.from(document.head.querySelectorAll('script[src]')).filter(s => !s.async && !s.defer).length }));
      assert.equal(timing.blockingHeadScripts, 1);
      assert.equal(requested.filter(p => /finance-startup-[a-f0-9]+\.js/.test(p)).length, 1);
      assert(!requested.some(p => /\/engines\/(reporting-workspace|approval-engine|permission-engine)\.js/.test(p)), 'Engines must not be fetched twice');
      const smoke = await page.evaluate(async () => window.__startupQA.run(`(async function(){
        USERS=[{id:'fixture-ceo',n:'Fixture CEO',role:'ceo',rL:'ceo',email:'ceo@example.invalid',dc:'D1',eid:'E1',active:true}];
        ENTS=[{id:'E1',s:'Fixture',full:'Fixture',active:true}];DEPTS=[{c:'D1',n:'Fixture',eid:'E1',active:true}];
        REQS=[];INVS=[];BILLS=[];LEDGER=[];VOUCHERS=[];DRAFTS=[];NOTIFS=[];ORG_CHART=[];
        S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[0]);
        var pages=['dashboard','approvals','newreq','reports','recv','orgchart','users','health','compliance','settings'];
        for(var i=0;i<pages.length;i++){await nav(pages[i],null);if(S.page!==pages[i])throw Error('Navigation denied '+pages[i]);}
        return {pages:pages.length,reporting:!!window.FinanceReportingWorkspace,approval:!!window.FinanceApprovalRuntime};
      })()`));
      assert.equal(smoke.pages, 10); assert(smoke.reporting && smoke.approval);
      assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      runs.push({ run: i + 1, ...timing, smoke, errors, denied });
      await page.screenshot({ path: path.join(out, 'built-mobile-' + (i + 1) + '.png'), fullPage: true });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ scope: measure ? 'Local built artifact, cold cache, 150ms RTT,4Mbps,CPU4x. Synthetic fixture; not real employee timing.' : 'Offline built artifact: actual startup and ten workspace navigations; all remote writes blocked.', runs }, null, 2));
    console.log(JSON.stringify({ passed: true, runs }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
