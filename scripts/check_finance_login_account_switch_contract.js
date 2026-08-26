const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'index.html');
const cssPath = path.join(root, 'assets', 'styles', 'finance-core.css');
const builtPath = path.join(root, 'www', 'index.html');
const builtCssPath = path.join(root, 'www', 'assets', 'styles', 'finance-core.css');
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
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

const preferredFns = [
  functionSource('authUserHasVerifiedGoogleIdentity'),
  functionSource('supabaseAuthUserPreferredEmail')
].join('\n');
const preferredContext = { result: '' };
vm.runInNewContext(`${preferredFns}
result=supabaseAuthUserPreferredEmail({
  email:'project_you@suiyuecare.com',
  email_confirmed_at:'2026-08-01T00:00:00Z',
  app_metadata:{provider:'google',providers:['google']},
  user_metadata:{email:'wrong.person@suiyuecare.com',email_verified:true},
  identities:[{provider:'google',identity_data:{email:'project_you@suiyuecare.com',email_verified:true}}]
});`, preferredContext);

check(
  'Google identity email wins over editable user metadata',
  preferredContext.result === 'project_you@suiyuecare.com',
  String(preferredContext.result)
);
check(
  'verified Google identity no longer trusts user_metadata as authority',
  !functionSource('authUserHasVerifiedGoogleIdentity').includes('metadataVerified') &&
    !functionSource('supabaseAuthUserPreferredEmail').includes('meta.email')
);
const legacySessionContext = { result: '' };
vm.runInNewContext(`${preferredFns}
result=supabaseAuthUserPreferredEmail({
  email:'project_you@suiyuecare.com',
  email_confirmed_at:'2026-08-01T00:00:00Z',
  app_metadata:{provider:'google',providers:['google']},
  user_metadata:{email:'wrong.person@suiyuecare.com',email_verified:true},
  identities:[]
});`, legacySessionContext);
check(
  'older confirmed Google sessions without expanded identity rows still use the server email',
  legacySessionContext.result === 'project_you@suiyuecare.com',
  String(legacySessionContext.result)
);

const storage = {
  'suiyuecare.finance.portalEmail': 'project_you@suiyuecare.com',
  'suiyuecare.finance.portalEmailAt': String(1_000_000)
};
const removed = [];
const expectedContext = {
  Date: { now: () => 1_000_500 },
  FINANCE_PORTAL_EMAIL_KEY: 'suiyuecare.finance.portalEmail',
  FINANCE_PORTAL_EMAIL_AT_KEY: 'suiyuecare.finance.portalEmailAt',
  FINANCE_PORTAL_OAUTH_PENDING_KEY: 'suiyuecare.finance.portalOauthPending',
  FINANCE_PORTAL_EMAIL_TTL_MS: 30 * 60 * 1000,
  safeGetItem: (key) => storage[key] || null,
  safeRemoveItem: (key) => { removed.push(key); delete storage[key]; },
  result: ''
};
vm.runInNewContext(`${functionSource('isCompanyGoogleLoginEmail')}
${functionSource('financeExpectedLoginEmail')}
result=financeExpectedLoginEmail();`, expectedContext);
check('fresh portal handoff keeps the exact company login hint', expectedContext.result === 'project_you@suiyuecare.com');

storage['suiyuecare.finance.portalEmail'] = 'old.person@suiyuecare.com';
storage['suiyuecare.finance.portalEmailAt'] = '1';
expectedContext.Date.now = () => 30 * 60 * 1000 + 10;
vm.runInNewContext('result=financeExpectedLoginEmail();', expectedContext);
check(
  'expired shared-browser account hint is cleared instead of trapping the next user',
  expectedContext.result === '' && removed.includes('suiyuecare.finance.portalEmail') && removed.includes('suiyuecare.finance.portalEmailAt')
);

const elements = {
  'login-account-guide': { style: {}, dataset: {} },
  'login-account-guide-title': { textContent: '' },
  'login-account-guide-detail': { textContent: '' },
  'login-switch-account': { style: {}, textContent: '', disabled: false }
};
const guideContext = {
  el: (id) => elements[id],
  financeExpectedLoginEmail: () => '',
  result: false
};
vm.runInNewContext(`${functionSource('showFinanceLoginAccountGuidance')}
result=showFinanceLoginAccountGuidance({expectedEmail:'project_you@suiyuecare.com',actualEmail:'other@suiyuecare.com',state:'mismatch'});`, guideContext);
check(
  'wrong-account notice shows both the expected and actually selected account',
  guideContext.result === true &&
    elements['login-account-guide-title'].textContent.includes('不正確') &&
    elements['login-account-guide-detail'].textContent.includes('project_you@suiyuecare.com') &&
    elements['login-account-guide-detail'].textContent.includes('other@suiyuecare.com')
);
check(
  'wrong-account notice always exposes an explicit account-switch action',
  elements['login-switch-account'].style.display === 'block' &&
    elements['login-switch-account'].textContent.includes('重新選擇')
);

const loginSection = section('window.googleLogin=async function()', 'async function completeOAuthFromUrl');
const switchSection = section('window.switchFinanceGoogleAccount=async function()', 'window.googleLogin=async function()');
const callbackSection = section('async function completeOAuthFromUrl', 'async function handleOAuthReturn');
const enterSection = section('async function enterByEmail', 'function consumePortalFinanceHandoff');

check(
  'standalone login always opens Google account selection and applies a trusted login hint',
  loginSection.includes("prompt:'select_account'") &&
    loginSection.includes('queryParams.login_hint=expectedEmail') &&
    loginSection.includes("safeSetItem(FINANCE_PORTAL_OAUTH_PENDING_KEY,'1')")
);
check(
  'account switch clears only the local browser session before starting a fresh OAuth flow',
  switchSection.includes("signOut({scope:'local'})") &&
    switchSection.indexOf("signOut({scope:'local'})") < switchSection.indexOf('window.googleLogin()')
);
check(
  'OAuth mismatch reports expected and actual email then clears the local wrong session',
  callbackSection.includes("stage:'oauth_email_match'") ||
    (callbackSection.includes("'oauth_email_match'") && callbackSection.includes('actualEmail:email')),
  'callback must retain mismatch diagnostics'
);
check(
  'non-company Google accounts are rejected before any Finance claim or bind operation',
  enterSection.indexOf('if(!isCompanyGoogleLoginEmail(loginEmail))') > -1 &&
    enterSection.indexOf('if(!isCompanyGoogleLoginEmail(loginEmail))') < enterSection.indexOf('completeCurrentGoogleAccountLinkV2()') &&
    enterSection.includes("signOut({scope:'local'})")
);
check(
  'portal handoff accepts only an exact company-domain address and receives a short expiry',
  functionSource('consumePortalFinanceHandoff').includes('isCompanyGoogleLoginEmail(email)') &&
    functionSource('consumePortalFinanceHandoff').includes('FINANCE_PORTAL_EMAIL_AT_KEY')
);
check(
  'login UI includes an accessible account guidance panel and switch button',
  source.includes('id="login-account-guide"') &&
    source.includes('aria-live="polite"') &&
    source.includes('id="login-switch-account"') &&
    css.includes('.login-account-guide[data-state="mismatch"]')
);
check(
  'frontend contains no service-role credential or direct Auth table write',
  !/(SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|role["']?\s*:\s*["']service_role)/i.test(source) &&
    !/from\(['"]auth\.users['"]\).*\.(insert|update|upsert|delete)/s.test(source)
);
check(
  'package exposes the login account-switch release contract',
  pkg.scripts && pkg.scripts['test:finance-login-account-switch'] === 'node scripts/check_finance_login_account_switch_contract.js'
);

if (fs.existsSync(builtPath) && fs.existsSync(builtCssPath)) {
  const built = fs.readFileSync(builtPath, 'utf8');
  const builtCss = fs.readFileSync(builtCssPath, 'utf8');
  check(
    'production artifact contains the same login safeguards',
    built.includes('id="login-account-guide"') &&
      built.includes('window.switchFinanceGoogleAccount=async function()') &&
      built.includes('queryParams.login_hint=expectedEmail') &&
      builtCss.includes('.login-account-guide[data-state="mismatch"]')
  );
} else {
  check('production artifact contains the same login safeguards', false, 'run pnpm build first');
}

console.log(`\n${passed}/${passed + failed} login account-switch checks passed.`);
if (failed) process.exit(1);
