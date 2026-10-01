'use strict';
// Check the shipped list with fictional local records. No production login or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { applyBuildEnvironment } = require('./finance_build_environment');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.resolve(process.env.FINANCE_EXPENSE_CARD_EVIDENCE || '/tmp/finance-expense-cards-20261002');
const closureAnchor = 'bootAuthGate();\n\n})();';
let html = applyBuildEnvironment(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  target: 'local', supabaseUrl: '', supabaseAnonKey: ''
});
assert(html.includes(closureAnchor), 'actual Finance application closure must be available');
html = html.replace(closureAnchor, 'window.__expenseCardQA={run:function(code){return eval(code)}};\n' + closureAnchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi, '')
  .replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; form-action \'none\'">');

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  if (file === root || file === path.join(root, 'index.html')) {
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader('content-type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

const rows = [
  { id:'ux-expense-1', no:'TEST-0001', type:'expense_reimbursement', eid:'E1', dc:'D1', app:'虛構員工', amt:1250,
    date:'2026/10/02', expectedPayDate:'2026/10/08', desc:'虛構交通費與跨部門會議用品採購申請，需核對收據與匯款資訊', status:'pending_section_chief', steps:[] },
  { id:'ux-expense-2', no:'TEST-0002', type:'payment_request', eid:'E1', dc:'D1', app:'虛構員工', amt:9876543,
    date:'2026/10/01', expectedPayDate:'2026/10/10', desc:'虛構長金額測試', status:'pending_accountant', steps:[] }
];
const expectedLabels = ['表單類型', '部門', '申請人', '目的', '金額', '申請日期', '預計匯款日'];
const report = { scope:'Actual local Finance HTML, CSS, mobile engine and fictional records; external requests blocked.', viewports:[] };
let browser;

(async () => {
  fs.mkdirSync(evidenceDir, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  for (const width of [375, 390, 1440]) {
    const context = await browser.newContext({ viewport:{ width, height:900 } });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.goto(origin);
    await page.waitForFunction(() => !!window.__expenseCardQA);
    await page.evaluate(fixtureRows => window.__expenseCardQA.run(
      'quickLogin("employee");nav("expenses",null);window.__financeInjectExpenseSearchSmokeRows(' + JSON.stringify(fixtureRows) + ');true'
    ), rows);
    // The table class is installed at startup, before these fixture rows exist.
    // Row labels and keyboard handling arrive on the next mobile-engine frame.
    await page.waitForFunction(labels => {
      const table = document.querySelector('#pg-expenses .expense-list-table');
      const rows = Array.from(table?.tBodies[0]?.rows || []);
      return table?.classList.contains('mobile-native-card-table') && rows.length === 2 &&
        rows.every(row => row.hasAttribute('data-mobile-record-card') && row.getAttribute('role') === 'button' &&
          Array.from(row.cells).every((cell, index) => cell.dataset.mobileCardLabel === labels[index]));
    }, expectedLabels);
    const metrics = await page.evaluate(() => {
      const table = document.querySelector('#pg-expenses .expense-list-table');
      const wrap = table.parentElement;
      const row = table.tBodies[0].rows[0];
      const last = table.tBodies[0].rows[1];
      const labels = Array.from(row.cells, cell => ({
        dataset:cell.dataset.mobileCardLabel,
        before:getComputedStyle(cell, '::before').content.replace(/^"|"$/g, ''),
        display:getComputedStyle(cell).display
      }));
      const wrapRight = wrap.getBoundingClientRect().right;
      const overflowNodes = Array.from(wrap.querySelectorAll('*')).filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width && getComputedStyle(node).display !== 'none' && rect.right > wrapRight + 1;
      }).slice(0, 12).map(node => ({
        tag:node.tagName.toLowerCase(),
        className:typeof node.className === 'string' ? node.className : '',
        text:(node.textContent || '').trim().slice(0, 64),
        right:Math.round(node.getBoundingClientRect().right),
        width:Math.round(node.getBoundingClientRect().width),
        scrollWidth:node.scrollWidth,
        clientWidth:node.clientWidth
      }));
      return {
        viewport:innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        wrapWidth:wrap.clientWidth,
        wrapScrollWidth:wrap.scrollWidth,
        tableWidth:table.getBoundingClientRect().width,
        tableDisplay:getComputedStyle(table).display,
        tableMinWidth:getComputedStyle(table).minWidth,
        headDisplay:getComputedStyle(table.tHead).display,
        bodyDisplay:getComputedStyle(table.tBodies[0]).display,
        rowDisplay:getComputedStyle(row).display,
        rowWidth:row.getBoundingClientRect().width,
        rowRight:row.getBoundingClientRect().right,
        wrapRight:wrap.getBoundingClientRect().right,
        overflowNodes,
        labels,
        rows:table.tBodies[0].rows.length,
        amountText:last.cells[4].innerText.trim(),
        purposeText:row.cells[3].innerText.trim()
      };
    });
    assert.equal(metrics.rows, 2, width + 'px retains both fictional records');
    assert(metrics.documentWidth <= width + 1, width + 'px page has no horizontal overflow');
    assert(metrics.amountText.includes('9,876,543'), width + 'px keeps long amount readable');
    assert(metrics.purposeText.includes('虛構交通費'), width + 'px keeps purpose readable');
    if (width < 760) {
      assert.equal(metrics.tableDisplay, 'block', width + 'px uses cards');
      assert.equal(metrics.headDisplay, 'none', width + 'px hides the desktop header');
      assert.equal(metrics.bodyDisplay, 'grid', width + 'px stacks cards');
      assert.equal(metrics.rowDisplay, 'block', width + 'px stacks fields in each card');
      assert(metrics.tableWidth <= metrics.wrapWidth + 1, width + 'px table fits its container');
      assert(metrics.wrapScrollWidth <= metrics.wrapWidth + 1, width + 'px list has no hidden horizontal content: ' + JSON.stringify(metrics));
      assert(metrics.rowRight <= metrics.wrapRight + 1, width + 'px card is not clipped');
      assert.deepEqual(metrics.labels.map(label => label.dataset), expectedLabels, width + 'px receives every data label');
      assert.deepEqual(metrics.labels.map(label => label.before), expectedLabels, width + 'px shows every data label');
      assert(metrics.labels.every(label => label.display === 'grid'), width + 'px fields use the card grid');
    } else {
      assert.equal(metrics.tableDisplay, 'table', 'desktop keeps its table');
      assert.equal(metrics.headDisplay, 'table-header-group', 'desktop keeps column headers');
      assert.equal(metrics.bodyDisplay, 'table-row-group', 'desktop keeps table rows');
      assert.equal(metrics.rowDisplay, 'table-row', 'desktop keeps native table layout');
      assert.equal(metrics.tableMinWidth, '980px', 'desktop preserves minimum comparison width');
    }
    await page.locator('#exp-tbody tr').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path:path.join(evidenceDir, 'expense-list-' + width + '.png') });
    const firstRow = page.locator('#exp-tbody tr').first();
    if (width === 390) { await firstRow.focus(); await firstRow.press('Enter'); }
    else await firstRow.click();
    assert(await page.locator('#m-appr').isVisible(), width + 'px opens the expense detail from the list');
    assert.deepEqual(errors, [], width + 'px has no page exceptions');
    report.viewports.push(metrics);
    await context.close();
    console.log('PASS expense list ' + width + 'px card/table layout and detail interaction');
  }
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS Finance expense mobile card browser regression: ' + evidenceDir);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
