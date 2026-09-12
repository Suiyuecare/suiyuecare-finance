// Executable regression tests of the shipped inline functions; no network,
// browser credentials, real employees, or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, `missing source function ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/^(?:(?:async )?function |window\.|var )/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function install(ctx, names) { if(!ctx.window)ctx.window={}; vm.createContext(ctx); names.forEach(name => vm.runInContext(fn(name), ctx)); return ctx; }
const user = (id = 'auth-a', email = 'new@suiyuecare.com') => ({
  id, email: 'old@suiyuecare.com', email_confirmed_at: '2026-08-01',
  app_metadata: { provider: 'google' },
  identities: [{ provider: 'google', identity_data: { email, email_verified: true } }]
});
const profile = () => ({ id: 'employee-a', authUserId: 'auth-a', tenantId: 'tenant-a', email: 'new@suiyuecare.com', active: true });
const googleFns = ['authUserHasVerifiedGoogleIdentity', 'supabaseAuthUserPreferredEmail', 'isCompanyGoogleLoginEmail'];
const plain = value => JSON.parse(JSON.stringify(value));

(async () => {
  let sessionUser = user();
  const auth = install({
    S: { user: profile(), demoLogin: false }, financeWorkspaceIdentityBlocked: false,
    currentTenantId: () => 'tenant-a', hasSupabase: () => true,
    inspectCurrentSupabaseSession: async () => ({ ok: true, session: { user: sessionUser, access_token: 'fixture' } })
  }, [...googleFns, 'currentFinanceAuthUserId', 'ensureSupabaseWriteReady', 'financeSessionMatchesWorkspace']);
  assert.equal((await auth.ensureSupabaseWriteReady()).ok, true, 'verified Google rename must write with same UUID');
  sessionUser = user('auth-b');
  assert.equal((await auth.ensureSupabaseWriteReady()).reason, 'auth_identity_mismatch', 'same email cannot replace UUID');
  sessionUser = user(); auth.S.user.active = false;
  assert.equal((await auth.ensureSupabaseWriteReady()).ok, false, 'disabled Finance identity is denied');
  auth.S.user = profile(); auth.S.user.tenantId = 'tenant-b';
  assert.equal((await auth.ensureSupabaseWriteReady()).ok, false, 'cross-tenant workspace is denied');
  auth.S.user = profile(); sessionUser.identities[0].identity_data.email_verified = false;
  assert.equal((await auth.ensureSupabaseWriteReady()).ok, false, 'unverified Google email denied');
  sessionUser = user('auth-a', 'new@outside.example');
  assert.equal((await auth.ensureSupabaseWriteReady()).ok, false, 'non-company identity denied');
  console.log('PASS A01: verified rename + UUID, active, tenant, provider/email guards');

  let listener, saves = 0, stops = 0, fetches = 0;
  const timers = [];
  const nodes = Object.fromEntries(['main-wrap', 'sidebar', 'mobile-bottom-nav'].map(id => [id, { style:{},setAttribute() {}, removeAttribute() {} }]));
  const tabs = install({
    S: { user: profile(), demoLogin: false }, financeWorkspaceIdentityBlocked: false,
    supabaseAuthSubscription: null, financeAuthIdentityEpoch: 0, supabaseAuthCheckPromise: null,
    financeLogoutInProgress: false, AUTH_RUNTIME_STATE: {}, AUTH_REQUEST_TIMEOUT_MS: 8000,
    setTimeout: callback => timers.push(callback), currentTenantId: () => 'tenant-a',
    supabaseAuthSessionExpiresAt: () => null, saveFinanceAuthRecoveryDraft: () => saves++,
    el: id => nodes[id], resetFinanceUsersDirectoryReadiness() {}, clearApprovalFastBootstrapState() {},
    stopRealtime: async () => stops++, setTopSyncStatus() {}, showFinanceAuthRecovery() {},
    hideFinanceAuthRecovery() { throw new Error('must not hide a cross-tab lock'); }, syncStatusText: () => '',
    window: { fetch: async () => fetches++ }, Headers, atob, console,
    getSb(){throw new Error('must not restart realtime after identity lock');}
  }, [...googleFns, 'currentFinanceAuthUserId', 'financeSessionMatchesWorkspace', 'setFinanceWorkspaceIdentityBlocked', 'captureFinanceWorkspaceRecoveryBeforeLock', 'lockFinanceWorkspaceIdentity', 'bindSupabaseAuthState', 'financeSupabaseFetch', 'startRealtime']);
  tabs.bindSupabaseAuthState({ auth: { onAuthStateChange(callback) { listener = callback; return { data: { subscription: {} } }; } } });
  listener('SIGNED_IN', { user: user('auth-b'), access_token: 'other-tab' });
  assert.equal(tabs.financeWorkspaceIdentityBlocked, true, 'lock synchronous before deferred callback');
  assert.equal(saves, 1); assert.equal(nodes['main-wrap'].inert, true); assert.equal(nodes['main-wrap'].style.visibility,'hidden','old documents hidden from replacement account');
  timers.splice(0).forEach(callback => callback());
  assert.ok(stops > 0);
  await assert.rejects(tabs.financeSupabaseFetch('https://fixture.example/rest/v1/expense_requests', {}), /FINANCE_AUTH_IDENTITY_CHANGED/);
  assert.equal(fetches, 0, 'no network request from stale identity');
  listener('TOKEN_REFRESHED', { user: user(), access_token: 'same-again' });
  timers.splice(0).forEach(callback => callback());
  assert.equal(tabs.financeWorkspaceIdentityBlocked, true, 'a token event alone does not restore stale workspace');
  tabs.financeWorkspaceIdentityBlocked = false;
  const token = 'x.' + Buffer.from(JSON.stringify({ sub: 'auth-b' })).toString('base64url') + '.x';
  await assert.rejects(tabs.financeSupabaseFetch('https://fixture.example/rest/v1/expense_requests', { headers: { Authorization: 'Bearer ' + token } }), /FINANCE_AUTH_IDENTITY_CHANGED/);
  assert.equal(fetches, 0, 'fetch boundary also rejects before auth event delivery');
  tabs.financeWorkspaceIdentityBlocked=false;
  tabs.captureVisibleAccountingReviewDrafts=()=>{throw new Error('fixture optional recovery failure');};
  tabs.console={warn(){}};
  assert.doesNotThrow(()=>tabs.lockFinanceWorkspaceIdentity('auth_identity_mismatch'));
  assert.equal(tabs.financeWorkspaceIdentityBlocked,true,'snapshot errors must not prevent identity lock');
  assert.doesNotThrow(()=>tabs.startRealtime(),'late bootstrap cannot restart realtime while identity is blocked');
  console.log('PASS A04: immediate multi-tab lock, realtime stop, no stale-token writes, no token-only unlock');

  const workspaceFrames=[],workspaceTargets=[];
  const workspace=install({
    S:{page:'dashboard'},financeWorkspaceNavigationRevision:0,APPROVAL_WAIT_TIMER_ID:null,PT:{newreq:'新增申請'},
    el:()=>({style:{},classList:{add(){}}}),document:{querySelectorAll:()=>[]},
    requestAnimationFrame:callback=>workspaceFrames.push(callback),restoreFinanceRefreshTarget:target=>workspaceTargets.push(target),
    applyRolePermissions(){},setRuntimeDefaults(){},initFilters(){},consumeFinanceRefreshReturnPage:()=>null,
    pendingApprovalDeepLink:()=>null,isExpenseApplicantRevisionMode:()=>false,shouldPromptUnsavedNewReq:()=>false,
    shouldPromptUnsavedIncomeDoc:()=>false,canAccessPage:()=>true,buildNR(){},syncMobileNavSelect(){},
    enhanceLongSelects(){},startSearchableSelectObserver(){},enhanceMobileTables(){},startMobileEnhancer(){}
  },['openFinanceWorkspace','guardedNav']);
  workspace.openFinanceWorkspace();
  await workspace.guardedNav('newreq',null);
  workspaceFrames.shift()();
  assert.deepEqual(workspaceTargets,[],'initial dashboard frame cannot navigate away from recovered form');
  assert.equal(workspace.S.page,'newreq');
  workspace.openFinanceWorkspace();workspaceFrames.shift()();
  assert.deepEqual(workspaceTargets,['dashboard'],'initial target still opens when no later navigation supersedes it');
  console.log('PASS A02: queued initial navigation cannot reopen a leave dialog over restored content');

  for (const nrType of ['expense_reimbursement', 'payment_request', 'welfare_request', 'petty_cash_request', 'hr_expense_request', 'purchase_request', 'travel_request', 'refund_request', 'advance_request']) {
    let draft, removed = 0; const notices = [];
    const fields = [{ id: 'nr-desc', type: 'textarea', tagName: 'TEXTAREA', value: '人工用途' }, { id: 'nr-amt', type: 'number', value: '4611' }];
    const root = { contains: n => fields.includes(n), querySelector: () => null, querySelectorAll: sel => sel.includes('[id]') ? fields : [] };
    const edited = { item: '人工明細', netAmount: 4500, taxAmount: 111, grossAmount: 4611, debitCode: '6221', creditCode: '1112', manualAccounting: true };
    const ctx = install({
      S: { page: 'newreq', user: profile(), nrStep: 3, nrType, nrRec: 'receipt', nrPay: 'bank', lazyMode: nrType === 'expense_reimbursement',
        nrPettyGeneralRows:[edited],nrPettyGeneralReceiptType:'invoice',lazyRows: [edited], hrRows: [{ ...edited, employee: 'fixture' }], purchaseRows: [{ ...edited, qty: 2 }],
        refundRows: [{ ...edited }], travelRows: [{ ...edited, amount: 4611, amountEdited: true }], travelPeople: ['employee-a'],
        hrItem: 'insurance', hrPeriod: '2026-09', hrLaborPeriod: '2026-07/08', hrPrivacyMode: true,
        nrFiles: [new Blob(['private attachment'])], travelFiles: { train: [new Blob(['ticket'])] }, nrDraftId: 'draft-a' },
      el: id => id === 'pg-newreq' ? root : fields.find(n => n.id === id), document: { activeElement: null }, Blob, Event,
      currentTenantId: () => 'tenant-a', activeDataEnvironment: () => 'production', draftInputIds: () => fields.map(n => n.id),
      normalizeHrMonthStrict: value => value, financeAuthRecoveryDraft: () => draft, canAccessPage: () => true,
      FINANCE_AUTH_RECOVERY_DRAFT_KEY: 'fixture', financeAuthRecoveryRestorePendingKey:'', financeWorkspaceIdentityBlocked:false, sessionRemoveItem: () => removed++, console,
      guardedNav: async () => { ctx.buildNR(); ctx.S.page = 'newreq'; }, clearExpenseApplicantRevisionMode() {},
      renderNR() { ctx.S.lazyRows = []; fields.forEach(n => { n.value = ''; }); }, markNRClean() {},
      applicantSelectChanged() {}, renderLazySheet() {}, renderRefundSheet() {}, renderPurchaseSheet() {}, renderHrExpenseSheet() {},
      renderTravelPeople() {}, renderTravelSheet() {}, updateBankTypeUI() {}, renderNRFList() {}, updNRAcct() {},
      isExpenseApplicantRevisionMode: () => false, setTimeout() {},
      calcTravelDays() { throw new Error('must not recalculate recovered manual amounts'); },
      syncTravelRows() { throw new Error('must not recalculate recovered manual amounts'); },
      completeActionFeedback: (...args) => notices.push(args), showFinanceAuthRecovery: (...args) => notices.push(args)
    }, ['currentFinanceAuthUserId', 'financeRecoverySerializable', 'financeAuthRecoveryNewRequestKeys', 'financeAuthRecoveryNewRequestSnapshot', 'financeAuthRecoveryDraftSnapshot',
      'collectNRFormState', 'applyNRFormState', 'applyFinanceAuthRecoveryFields', 'financeAuthRecoveryStorageKey', 'financeAuthRecoveryContentMatches', 'financeAuthRecoveryFailed', 'stableSnapshotValue', 'restoreFinanceAuthRecoveryDraft', 'buildNR']);
    let focusedCommits = 0;
    fields[0].onchange = () => focusedCommits++;
    fields[0].dispatchEvent = () => fields[0].onchange();
    ctx.document.activeElement = fields[0];
    draft = plain(ctx.financeAuthRecoveryDraftSnapshot());
    assert.equal(focusedCommits, 1, 'focused onchange edit is captured before recovery');
    assert.equal(draft.version, 2); assert.equal(draft.newRequest.nrType, nrType);
    assert.deepEqual(draft.newRequest.nrFiles, []); assert.deepEqual(draft.newRequest.form.travelFiles.train, []);
    assert.equal(draft.hadFiles, true, 'File bytes are not falsely claimed to be persisted');
    const rowArrays = plain(draft.newRequest.form);
    draft.newRequest.user = { authUserId: 'auth-b' };
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(), true);
    assert.equal(ctx.S.nrType, nrType); assert.equal(ctx.S.nrStep, 3); assert.equal(ctx.S.nrDraftId, 'draft-a');
    assert.deepEqual(plain(ctx.S.nrPettyGeneralRows),[edited],'petty mode draft survives reauthentication');assert.equal(ctx.S.nrPettyGeneralReceiptType,'invoice');
    assert.equal(ctx.S.user.authUserId, 'auth-a', 'recovery cannot replace identity via arbitrary saved state keys');
    for (const key of ['lazyRows', 'hrRows', 'purchaseRows', 'travelRows', 'refundRows', 'travelPeople']) assert.deepEqual(plain(ctx.S[key]), rowArrays[key], `${nrType} ${key} preserved`);
    assert.equal(fields[0].value, '人工用途'); assert.equal(fields[1].value, '4611');
    assert.equal(removed, 1); assert.match(notices[0][1], /附件請重新選取/);
    ctx.financeWorkspaceIdentityBlocked=true;removed=0;
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'late bootstrap cannot consume backup before original identity revalidation');
    ctx.financeWorkspaceIdentityBlocked=false;
    ctx.S.user.authUserId = 'auth-b'; removed = 0;
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(), false); assert.equal(removed, 0, 'never discard another identity draft');
    ctx.S.user=profile();draft.tenantId='tenant-b';
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'cross-tenant backup preserved');
    draft.tenantId='tenant-a';draft.dataEnvironment='test';
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'cross-environment backup preserved');
    draft.dataEnvironment='production';draft.version=1;
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'legacy email-only identity is insufficient');
    draft.version=2;ctx.S.user.active=false;
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'inactive identity cannot restore');
    ctx.S.user=profile();
    fields.pop();
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'missing DOM field never produces false success or deletes backup');
    assert.ok(ctx.financeAuthRecoveryRestorePendingKey);
    ctx.renderNR=()=>{throw new Error('fixture rendering failed');};
    ctx.console={warn(){}};
    assert.equal(await ctx.restoreFinanceAuthRecoveryDraft(),false);assert.equal(removed,0,'render failure preserves original backup');

  }
  console.log('PASS A02: nine request types, full rows/manual accounting, context, focused fields, file-loss disclosure and owner isolation');
  const storage=new Map();
  const owner=install({
    S:{user:profile()},FINANCE_AUTH_RECOVERY_DRAFT_KEY:'recovery',financeAuthRecoveryRestorePendingKey:'',
    currentTenantId:()=> 'tenant-a',activeDataEnvironment:()=> 'production',
    sessionSetItem:(key,value)=>{storage.set(key,value);return true;},sessionGetItem:key=>storage.get(key)||null,
    sessionRemoveItem:key=>storage.delete(key),console,
    financeAuthRecoveryDraftSnapshot:()=>({version:2,savedAt:Date.now(),expectedAuthUserId:owner.S.user.authUserId,tenantId:'tenant-a',dataEnvironment:'production',marker:owner.S.user.authUserId})
  },['currentFinanceAuthUserId','financeAuthRecoveryStorageKey','saveFinanceAuthRecoveryDraft','financeAuthRecoveryDraft']);
  assert.equal(owner.saveFinanceAuthRecoveryDraft(),true);const aKey=owner.financeAuthRecoveryStorageKey(),aSaved=storage.get(aKey);
  owner.S.user.authUserId='auth-b';assert.equal(owner.saveFinanceAuthRecoveryDraft(),true);
  assert.notEqual(owner.financeAuthRecoveryStorageKey(),aKey);assert.equal(storage.get(aKey),aSaved,'different UUID with same email cannot overwrite original backup');
  assert.equal(owner.financeAuthRecoveryDraft().marker,'auth-b');
  owner.S.user.authUserId='auth-a';owner.financeAuthRecoveryRestorePendingKey=aKey;
  owner.financeAuthRecoveryDraftSnapshot=()=>{throw new Error('do not replace pending complete backup');};
  assert.equal(owner.saveFinanceAuthRecoveryDraft(),true);assert.equal(storage.get(aKey),aSaved);
  storage.set(aKey,'malformed original backup');assert.equal(owner.financeAuthRecoveryDraft(),null);assert.equal(storage.get(aKey),'malformed original backup','unreadable backup retained');
  console.log('PASS A02: distinct UUID storage, legacy/tenant/environment/disabled denials, missing/render-failed restore retains backup and retries cannot overwrite it');

  const hintStorage={email:'old@suiyuecare.com',at:String(Date.now()),role:'ceo',scope:'old-scope'};
  let oauthOptions,enteredEmail;
  const switchCtx={window:{},financeGoogleAccountSwitchInProgress:false,console,URL,URLSearchParams,
    FINANCE_PORTAL_EMAIL_KEY:'email',FINANCE_PORTAL_EMAIL_AT_KEY:'at',FINANCE_PORTAL_ROLE_KEY:'role',FINANCE_PORTAL_SCOPE_KEY:'scope',FINANCE_PORTAL_OAUTH_PENDING_KEY:'pending',FINANCE_PORTAL_OAUTH_MODE_KEY:'mode',FINANCE_PORTAL_EMAIL_TTL_MS:1800000,
    safeGetItem:key=>hintStorage[key]||null,safeSetItem:(key,value)=>hintStorage[key]=value,safeRemoveItem:key=>delete hintStorage[key],
    el:()=>null,currentSupabaseSession:async()=>null,showFinanceLoginAccountGuidance(){},isFinanceProductionBuild:()=>true,
    ensureOfficialHostBeforeOAuth:()=>true,preserveApprovalDeepLinkForOAuth:()=>true,isOAuthBlockedUserAgent:()=>false,
    oauthRedirectUrl:()=> 'https://fixture.example/',scrubOAuthUrl(){},
    showFinanceOAuthFailure:async()=>{throw new Error('fresh account switch must not inherit stale email mismatch');},
    enterByEmail:async email=>{enteredEmail=email;},
    getSb:()=>({auth:{signOut:async()=>({error:null}),signInWithOAuth:async options=>{oauthOptions=options;return {error:null};},exchangeCodeForSession:async()=>({error:null}),getSession:async()=>({data:{session:{user:user('auth-b','new-person@suiyuecare.com')}}})}})
  };
  vm.createContext(switchCtx);[...googleFns,'financeExpectedLoginEmail','completeOAuthFromUrl'].forEach(name=>vm.runInContext(fn(name),switchCtx));
  const switchStart=source.indexOf('window.switchFinanceGoogleAccount=async function()');
  vm.runInContext(source.slice(switchStart,source.indexOf('async function completeOAuthFromUrl',switchStart)),switchCtx);
  assert.equal(await switchCtx.window.switchFinanceGoogleAccount(),true);
  assert.equal(oauthOptions.options.queryParams.prompt,'select_account');
  assert.equal(oauthOptions.options.queryParams.login_hint,undefined);assert.equal(hintStorage.email,undefined);
  assert.equal(hintStorage.role,undefined);assert.equal(hintStorage.scope,undefined);
  await switchCtx.completeOAuthFromUrl('https://fixture.example/?code=fixture',true);
  assert.equal(enteredEmail,'new-person@suiyuecare.com','switch accepts independently authorized new company identity without stale Portal hint');
  console.log('PASS A05: explicit account switch clears old email/role/scope and completes with newly selected Google identity');


  let endpoint, args;
  const runtime = install({
    ensureSupabaseWriteReady: async () => ({ ok: true }),
    getSb: () => ({ rpc: async (name, values) => { endpoint = name; args = values; return { data: { ok: true } }; } }),
    normalizeSettingValue: value => value
  }, ['repairCurrentFinanceIdentityRuntime']);
  assert.equal((await runtime.repairCurrentFinanceIdentityRuntime()).ok, true);
  assert.equal(endpoint, 'finance_repair_current_identity_runtime_v1'); assert.deepEqual(plain(args), {});
  let called = 0;
  const assurance = install({
    S: { user: profile(), demoLogin: false }, hasSupabase: () => true, ACCOUNT_RUNTIME_ASSURANCE_STATE: {},
    ORG_ADMIN_RUNTIME: { available: true }, getSb: () => ({}), financeUserRuntimeReadiness: () => ({ ok: false, warnings: [] }),
    repairCurrentFinanceIdentityRuntime: async () => { called++; return { ok: true }; },
    syncFrontOfficePermissionRuntime() { throw new Error('employee must not invoke management RPC'); },
    refreshApprovalOrgAdminRuntime: async () => {}, uniqueRemoteStrings: values => [...new Set(values)], remoteReadIssueText: e => e.message
  }, ['runCurrentUserRuntimeAssurance']);
  assert.equal((await assurance.runCurrentUserRuntimeAssurance()).ok, true); assert.equal(called, 1);
  console.log('PASS A03: actual runtime assurance uses zero-target self RPC, never management RPC');

})().catch(error => { console.error(error); process.exitCode = 1; });
