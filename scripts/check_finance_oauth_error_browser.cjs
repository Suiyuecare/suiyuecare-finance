const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/styles/finance-core.css'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert(start >= 0, `missing ${name}`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const loginStart = source.indexOf('<!-- LOGIN -->');
const loginEnd = source.indexOf('</div><!-- app -->', loginStart);
assert(loginStart >= 0 && loginEnd > loginStart, 'login markup must exist');
const loginMarkup = source.slice(loginStart, loginEnd);
const runtime = [
  'safeOAuthErrorCode',
  'safeOAuthDiagnosticText',
  'oauthProviderErrorInfo',
  'financeOAuthErrorDisplayText',
  'showFinanceLoginAccountGuidance',
  'showFinanceOAuthFailure',
  'completeOAuthFromUrl'
].map(functionSource).join('\n');

async function run() {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || process.env.FINANCE_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const width of [390, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="zh-TW"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="app" id="root">${loginMarkup}</div></body></html>`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: `${runtime}\nwindow.el=id=>document.getElementById(id);window.financeAuthIncidentId=()=>"OAUTH-TEST";window.reportFinanceOAuthDiagnostic=()=>({ok:false,skipped:true});window.financeExpectedLoginEmail=()=>"";window.scrubOAuthUrl=()=>{window.__oauthScrubbed=true};window.isFinanceProductionBuild=()=>true;window.getSb=()=>({});window.safeRemoveItem=()=>{};window.FINANCE_PORTAL_OAUTH_PENDING_KEY="pending";window.FINANCE_PORTAL_OAUTH_MODE_KEY="mode";` });

      for (const scenario of [
        {
          name: 'verified-email lifecycle guard',
          description: 'Google 主信箱尚未由人員管理核准換綁，已取消這次身分變更。 access_token=never-show-this',
          expected: '未核准的 Google 主信箱變更'
        },
        {
          name: 'generic Auth callback failure',
          description: 'Database error updating user refresh_token=never-show-this',
          expected: 'Finance 無法完成這次 Google 帳號驗證'
        }
      ]) {
        const result = await page.evaluate(async description => {
          const callback = new URL('https://finance.suiyuecare.com/');
          callback.searchParams.set('error', 'server_error');
          callback.searchParams.set('error_description', description);
          callback.searchParams.set('access_token', 'never-show-this');
          const handled = await completeOAuthFromUrl(callback.href, true);
          const error = document.getElementById('login-err');
          const guide = document.getElementById('login-account-guide');
          const bounds = error.getBoundingClientRect();
          const style = getComputedStyle(error);
          return {
            text: error.innerText,
            display: style.display,
            fontSize: parseFloat(style.fontSize),
            bounds: { left: bounds.left, right: bounds.right, height: bounds.height },
            contentWidth: error.scrollWidth,
            clientWidth: error.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            guideVisible: getComputedStyle(guide).display !== 'none',
            switchVisible: getComputedStyle(document.getElementById('login-switch-account')).display !== 'none',
            handled,
            scrubbed: window.__oauthScrubbed === true
          };
        }, scenario.description);
        assert(result.text.includes(scenario.expected), `${width}px ${scenario.name}: specific message missing`);
        assert(result.text.includes('oauth_provider_return / server_error'), `${width}px ${scenario.name}: safe diagnostic missing`);
        assert(result.text.includes('OAUTH-TEST'), `${width}px ${scenario.name}: incident ID missing`);
        assert(!result.text.includes('never-show-this') && !result.text.includes('Database error'), `${width}px ${scenario.name}: raw Auth detail leaked`);
        assert(result.display === 'block' && result.fontSize >= 12 && result.bounds.height > 0, `${width}px ${scenario.name}: error not readable`);
        assert(result.bounds.left >= 0 && result.bounds.right <= width, `${width}px ${scenario.name}: error outside viewport`);
        assert(result.contentWidth <= result.clientWidth + 1 && result.documentWidth <= width, `${width}px ${scenario.name}: horizontal overflow`);
        assert(result.guideVisible && result.switchVisible, `${width}px ${scenario.name}: account-selection recovery missing`);
        assert(result.handled && result.scrubbed, `${width}px ${scenario.name}: OAuth callback was not handled and scrubbed`);
        console.log(`PASS ${width}px ${scenario.name}: readable, safe, no horizontal overflow`);
      }
      await page.close();
      assert.deepEqual(errors, [], `${width}px browser errors`);
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
