#!/usr/bin/env node
'use strict';
// Fictional local UI fixture. The existing table-layout harness serves the
// real application and assets; this check never invokes a business RPC.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const harness = spawn(process.execPath, [path.join(__dirname, 'check_invoice_table_layout_browser.cjs'), '--serve'], {
  cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
async function servedFixture() {
  return new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => reject(new Error('Invoice layout harness did not start: ' + errors)), 15000);
    harness.stderr.on('data', chunk => { errors += chunk; });
    harness.on('error', reject);
    harness.on('exit', code => reject(new Error('Invoice layout harness exited ' + code + ': ' + errors)));
    harness.stdout.on('data', chunk => {
      output += chunk;
      const end = output.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timeout);
      try { resolve(JSON.parse(output.slice(0, end))); } catch (error) { reject(error); }
    });
  });
}

const setupManualRows = `(() => {
  canActRequest = function() { return true; };
  canEditAccountingLineSubjects = function() { return true; };
  shouldShowRequestAccountingLines = function() { return true; };
  window.__manualRows = [
    { id:'fee', systemFee:true, item:'系統手續費', netAmount:10, taxAmount:0, grossAmount:10 },
    { id:'', item:'相同教材', no:'QA12345678', date:'2026-10-08', file:'虛構發票.pdf', netAmount:100, taxAmount:0, grossAmount:100 },
    { id:'', item:'相同教材', no:'QA12345678', date:'2026-10-08', file:'虛構發票.pdf', netAmount:100, taxAmount:0, grossAmount:100 }
  ];
  window.__manualLines = [1,2].map(function(i) { return {
    id:'manual-line-'+i, sourceItemId:'', description:'相同教材',
    netAmount:100, taxAmount:0, grossAmount:100,
    debitAccount:'6205', debitAccountName:'辦公用品',
    creditAccount:'1112', creditAccountName:'銀行存款'
  }; });
  __tableRequest.formPayload = { lazyRows:__manualRows, accountingLines:__manualLines };
  __tableRequest.amt = 200; __tableRequest.total = 200;
  __tableShow('expense');
  window.__manualActivation = 0;
  window.bindLegacyInvoiceAccountingItem = function() { window.__manualActivation++; return false; };
  return document.querySelectorAll('.invoice-accounting-bind').length;
})()`;

(async () => {
  const fixture = await servedFixture();
  browser = await chromium.launch({ headless: true,
    ...(process.env.FINANCE_BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL || process.env.FINANCE_BROWSER_CHANNEL || 'chrome' }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.url ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.url);
  await page.waitForFunction(() => window.__tableFixture);
  await page.evaluate(code => __tableFixture.run(code), fixture.setup);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const count = await page.evaluate(code => __tableFixture.run(code), setupManualRows);
    assert.equal(count, 2, `${width}px has two deliberate bind controls`);
    await page.evaluate(() => __tableFixture.run('enhanceLongSelects(document)'));
    const controls = page.locator('#detail-body .invoice-accounting-bind');
    assert.equal(await controls.count(), 2);
    assert.deepEqual(await controls.locator('button').evaluateAll(nodes => nodes.map(node => Number(node.dataset.sourceIndex))), [2, 3]);

    const first = controls.first(), summary = first.locator('summary'), select = first.locator('select'),
      combo = first.locator('.combo-input'), button = first.locator('button');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert(await first.evaluate(node => node.open), `${width}px Enter opens the bind details`);
    await page.keyboard.press('Tab');
    assert(await combo.evaluate(node => document.activeElement === node), `${width}px Tab reaches the candidate combobox`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await select.inputValue(), 'manual-line-1', `${width}px keyboard chooses the first candidate`);
    await page.keyboard.press('Tab');
    assert(await button.evaluate(node => document.activeElement === node), `${width}px Tab reaches the confirm button`);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.__manualActivation), 1, `${width}px Space activates the button`);

    const geometry = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#detail-body .invoice-accounting-bind summary,#detail-body .invoice-accounting-bind select,#detail-body .invoice-accounting-bind .combo-input,#detail-body .invoice-accounting-bind button')];
      const card = document.querySelector('#detail-body .invoice-accounting-review').getBoundingClientRect();
      return { viewport: innerWidth, document: document.documentElement.scrollWidth,
        card: { left: card.left, right: card.right },
        controls: nodes.filter(node => node.getClientRects().length && !node.classList.contains('combo-native-select')).map(node => {
          const rect = node.getBoundingClientRect();
          return { tag: node.tagName, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }) };
    });
    assert(geometry.document <= width + 1, `${width}px has no document overflow: ${JSON.stringify(geometry)}`);
    assert(geometry.controls.every(rect => rect.left >= geometry.card.left - 1 && rect.right <= geometry.card.right + 1),
      `${width}px bind controls stay inside the card: ${JSON.stringify(geometry)}`);
    assert(geometry.controls.every(rect => rect.height >= 43.9), `${width}px controls have 44px targets: ${JSON.stringify(geometry)}`);
    if (width === 375) assert(geometry.controls.filter(rect => rect.tag === 'INPUT' || rect.tag === 'SELECT').every(rect => rect.width >= 200),
      `${width}px candidate selects leave enough room for descriptive options: ${JSON.stringify(geometry)}`);
    assert.equal(errors.length, 0, `${width}px has no page errors: ${errors.join('; ')}`);
    console.log(`PASS manual invoice binding layout and keyboard at ${width}px`);
  }
  await context.close();
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); harness.kill('SIGTERM'); });
