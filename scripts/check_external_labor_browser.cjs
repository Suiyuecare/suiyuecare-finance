#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const endpoint = 'https://fixture.supabase.co/functions/v1/finance-labor-external';
const token = 'A'.repeat(43);
const sid = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const target = pathname === '/external-remuneration.html'
    ? 'external-remuneration.html' : pathname.replace(/^\//, '');
  if (!['external-remuneration.html', 'assets/styles/external-remuneration.css', 'assets/engines/external-remuneration.js', 'assets/suiyue-logo-transparent.png'].includes(target)) { response.writeHead(404); response.end(); return; }
  const file = path.join(root, target);
  let content = fs.readFileSync(file);
  if (target === 'external-remuneration.html') content = Buffer.from(content.toString().replace('__FINANCE_EXTERNAL_API_URL__', endpoint).replaceAll('__FINANCE_ASSET_VERSION__', 'fixture'));
  response.writeHead(200, { 'content-type': target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.css') ? 'text/css' : target.endsWith('.js') ? 'text/javascript' : 'image/png', 'cache-control': 'no-store' });
  response.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.FINANCE_BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const pageErrors = [], requests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route(`${endpoint}/**`, async route => {
      const request = route.request();
      const action = new URL(request.url()).pathname.split('/').slice(-2).join('/');
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
      requests.push({ action, body: request.postData(), bytes: request.postDataBuffer() });
      let result = {};
      if (action === 'guest/lookup') result = { statementId: sid, version: 1, status: 'invited', entityId: 'E5', entityName: '歲悅股份有限公司', serviceLines: [{ id: sid, courseType: '講座', description: '照護訓練', courseRef: 'C100', serviceDate: '2026-09-27', grossCents: 1234500 }, { id: sid, courseType: '實作', description: '案例研討', courseRef: 'C101', serviceDate: '2026-09-28', grossCents: 500000 }], totalGrossCents: 1734500, expiresAt: '2026-10-10', consentVersion: 'labor-v1' };
      else if (action === 'guest/upload') result = { uploadId: '22222222-2222-4222-8222-222222222222', path: 'private/path', sha256: 'a'.repeat(64), committed: true };
      else if (action === 'guest/submit') result = { statementId: sid, status: 'signed', snapshotHash: 'b'.repeat(64) };
      else throw new Error(action);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(result) });
    });
    await page.goto(`${origin}/external-remuneration.html#t=${token}`);
    await page.getByRole('heading', { name: '服務與報酬' }).waitFor();
    assert.equal(await page.evaluate(() => location.hash), '', 'bearer token must leave URL history');
    assert.equal(await page.locator('#entity-name').textContent(), '歲悅股份有限公司');
    assert.match(await page.locator('#total-gross').textContent(), /17,345/);
    assert.equal(await page.locator('input[name="idNumber"]').inputValue(), '', 'lookup must not prefill private profile');
    const fit = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.equal(fit, true, 'mobile page must not overflow');
    await page.screenshot({ path: '/tmp/finance-labor-public-mobile.png', fullPage: true });
    for (const [name, value] of Object.entries({ fullName: '王講師', idNumber: 'A123456789', phone: '0912345678', address: '臺北市', bankCode: '012', bankName: '銀行', branchName: '本行', accountNumber: '123456789', accountHolder: '王講師' })) await page.locator(`input[name="${name}"]`).fill(value);
    for (const kind of ['identity_front', 'identity_back', 'bank_proof']) await page.locator(`input[data-kind="${kind}"]`).setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer: png });
    await page.locator('#signature-file').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'signature-file', 'keyboard users need an accessible file fallback');
    assert.match(await page.locator('#signature-help').textContent(), /鍵盤/);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'signature.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: '清除重簽' }).click();
    assert.equal(await page.locator('#signature-file').evaluate(input => input.files.length), 0, 'clear must remove the upload fallback too');
    const canvas = page.locator('#signature-pad');
    const blank = await canvas.evaluate(element => element.toDataURL());
    const box = await canvas.boundingBox();
    await page.touchscreen.tap(box.x + box.width * .45, box.y + box.height * .5);
    assert.notEqual(await canvas.evaluate(element => element.toDataURL()), blank, 'finger touch must leave ink');
    await page.locator('#consent').check();
    await page.getByRole('button', { name: '確認並送出簽署' }).click();
    await page.getByRole('heading', { name: '簽署資料已送出' }).waitFor();
    assert.equal(requests.filter(x => x.action === 'guest/upload').length, 4);
    const signatureUpload = requests.filter(x => x.action === 'guest/upload').at(-1);
    assert(signatureUpload.bytes.includes(Buffer.from('signature.png')), 'drawn signature must upload as PNG');
    assert(signatureUpload.bytes.includes(Buffer.from([137,80,78,71,13,10,26,10])), 'drawn signature must contain PNG bytes');
    const sent = requests.find(x => x.action === 'guest/submit');
    assert(sent, 'must submit after uploads');
    assert.deepEqual(Object.keys(JSON.parse(sent.body).uploads).sort(), ['bankProof', 'identityBack', 'identityFront', 'signature']);
    assert(!sent.body.includes('signedDocument'), 'guest cannot provide an authoritative PDF');
    assert.deepEqual(pageErrors, []);
    await context.close();

    const recovery = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recoveredPage = await recovery.newPage();
    await recoveredPage.route(`${endpoint}/guest/lookup`, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify({ statementId: sid, version: 3, status: 'signed' }) }));
    await recoveredPage.goto(`${origin}/external-remuneration.html#t=${token}`);
    await recoveredPage.getByRole('heading', { name: '簽署資料已送出' }).waitFor();
    assert.equal(await recoveredPage.locator('input[name="idNumber"]').isVisible(), false);
    await recovery.close();
    console.log('external labor browser: mobile layout, hash-only token, no PII prefill, 4 uploads, signed state/recovery passed');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
