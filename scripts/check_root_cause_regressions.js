#!/usr/bin/env node
'use strict';

/**
 * Source-level regressions for the recurring login/submission incident.
 * Runs before build so a known-bad source can never become a Vercel artifact.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const membershipMigration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql'),
  'utf8'
);
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failed += 1;
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function section(startMarker, endMarker) {
  const start = index.indexOf(startMarker);
  const end = index.indexOf(endMarker, start + startMarker.length);
  return start > -1 && end > start ? index.slice(start, end) : '';
}

const healthTables = section('var SYSTEM_HEALTH_TABLE_CHECKS=[', 'var SYSTEM_HEALTH_RPC_CHECKS=[');
const submissionTables = section('function p1TableChecksForSubmit', 'function p1AdvisoryRpcKey');
const actorSeverity = section('function stepActorProblemSeverity', 'function approvalHealthRecords');
const preflight = section('async function p1SubmissionPreflight', 'function reportHealthIntroHtml');
const operational = section('function p1OperationalDiagnosticRow', 'var SUBMISSION_PREFLIGHT_TIMEOUT_MS');
const guardedSubmit = section('async function insertMembershipOrgSubmittedRecord', 'async function insertMembershipOrgSubmittedBatch');
const expenseSubmit = section('window.submitNR=async function(){', '// ══ 放款申請 ══');
const expenseSubmitRecovery = section('async function submitExpenseRequestWithAmbiguousRecovery', 'async function callExpenseApplicantRevisionRpcOnce');

check('Finance user bootstrap reads auth_user_id from the database',
  /FINANCE_USER_SAFE_COLUMNS='[^']*auth_user_id/.test(index));
check('notification health has a legacy-column fallback during the migration window',
  /table:'notifications'[^\n]+fallbackSelect:'id,type,title,read,request_id'/.test(healthTables));
check('notification schema mismatch is a deterministic write blocker',
  /table:'notifications'[^\n]+submissionContractRequired:true/.test(healthTables)
    && /var forced=\{required:true\}/.test(submissionTables)
    && !/label===['"]通知資料表['"]&&\/data_environment\|schema\|grant\|column\//.test(operational)
    && /item&&item\.submissionContractRequired[\s\S]*?submissionAdvisory:false/.test(preflight));
check('attachment health uses storage_path and never the nonexistent path column',
  /table:'file_attachments'[^\n]+select:'[^']*storage_path/.test(healthTables)
    && !/table:'file_attachments'[^\n]+select:'[^']*(?:^|,)path(?:,|')/.test(healthTables));
check('attachment metadata diagnostics are advisory rather than a false send blocker',
  /k===['"]file_attachments['"]\?\{required:false/.test(submissionTables)
    && /附件歸檔 metadata/.test(operational));
check('a stale embedded Auth field is a warning, not a false route failure',
  /簽核人未綁 Auth[^\n]+return['"]warn['"]/.test(actorSeverity));
check('submission still requires a live authenticated session',
  preflight.includes('await ensureSupabaseWriteReady(label)')
    && preflight.includes("label:'正式登入檢查',status:'fail'"));
check('transient read-only health probes degrade to an advisory',
  preflight.includes('p1SubmissionAdvisoryItem')
    && preflight.includes('p1BlockingRows(rows)'));
check('expense submission uses the guarded database transaction',
  guardedSubmit.includes("expense:'finance_submit_expense_request'")
    && guardedSubmit.includes('p_actor_requests:engine.actorRequestsFromSteps(record.steps)')
    && !/dbInsert\(table,row\)/.test(guardedSubmit.slice(guardedSubmit.indexOf("var fn={expense:"))));
check('guarded transaction derives the authenticated Finance identity',
  /v_actor := public\.current_finance_user\(\)/.test(membershipMigration)
    && /finance_user_is_approval_identity_ready\(v_tenant_id, v_actor\.id\)/.test(membershipMigration));
check('guarded transaction rejects a genuinely unbound approval actor',
  /jsonb_array_elements\(v_request\.steps\)[\s\S]*?assignee\.id = workflow_step ->> 'uid'[\s\S]*?finance_user_is_approval_identity_ready\(v_tenant_id, assignee\.id\)/.test(membershipMigration)
    && /簽核流程仍有未綁定或無效的正式簽核人/.test(membershipMigration));
check('guarded transaction inserts the request exactly once',
  (membershipMigration.match(/insert into public\.expense_requests/g) || []).length === 1);
const routePreflightIndex = expenseSubmit.indexOf('prepareApprovalRouteForSubmit(');
const attachmentUploadIndex = expenseSubmit.indexOf('uploadPreparedAttachmentSet(no)');
const guardedInsertIndex = expenseSubmit.indexOf('submitExpenseRequestWithAmbiguousRecovery(newReq');
const committedIndex = expenseSubmit.indexOf('formalRequestCommitted=true');
const notificationIndex = expenseSubmit.indexOf('ensureExpensePostCommitOutbox(committedRecord,newNotif)');
check('費用送件固定為權威路由預檢、附件上傳、正式建單、最後發通知',
  routePreflightIndex > -1
    && attachmentUploadIndex > routePreflightIndex
    && guardedInsertIndex > attachmentUploadIndex
    && committedIndex > guardedInsertIndex
    && notificationIndex > committedIndex);
check('正式建單未確認或失敗的分支不會發通知',
  expenseSubmit.includes('if(submitOutcome.unknown)')
    && expenseSubmit.includes('if(!submitOutcome.ok)')
    && !expenseSubmit.slice(guardedInsertIndex, committedIndex).includes('ensureExpensePostCommitOutbox('));
check('逾時送件使用相同識別碼回讀與重試，仍不明時不清附件且鎖住重送',
  expenseSubmitRecovery.includes('readExpenseSubmissionCommitWithDelays(record')
    && expenseSubmitRecovery.includes("code='EXPENSE_SUBMISSION_RESULT_UNKNOWN'")
    && expenseSubmit.includes('var durablePending=saveExpenseSubmissionPending(newReq,null)')
    && !expenseSubmit.slice(expenseSubmit.indexOf('if(submitOutcome.unknown)'), expenseSubmit.indexOf('if(!submitOutcome.ok)')).includes('cleanupUploadedSupabaseAttachments'));
check('送件待確認狀態可跨重新整理復原並先回讀再解鎖',
  index.includes("EXPENSE_SUBMISSION_PENDING_KEY_BASE='finance_expense_submission_pending_v1'")
    && index.includes('safeJsonSet(key,pending)')
    && index.includes('sessionSetItem(key,JSON.stringify(pending))')
    && expenseSubmit.includes('await reconcilePendingExpenseSubmission({notify:true,allowRetry:true})')
    && index.includes("if(readback.state==='absent')")
    && index.includes("if(options.allowRetry!==true)return{state:'unknown'")
    && index.includes("submitExpenseRequestWithAmbiguousRecovery(pending.retryRecord")
    && index.includes("label||'申請單保存'")
    && index.includes("return{state:'deterministic_failure',error:retryOutcome.error}"));
check('正式 RPC 前必須同時持久化完整可重試 record',
  index.includes('expected:retryRecord,retryRecord:retryRecord')
    && index.includes('if(localSaved&&sessionSaved)S.nrSubmissionConfirmationPending=pending')
    && expenseSubmit.includes('var durablePending=saveExpenseSubmissionPending(newReq,null)')
    && expenseSubmit.includes('if(!durablePending.ok)')
    && expenseSubmit.indexOf('if(!durablePending.ok)')<expenseSubmit.indexOf("submissionPhase='rpc_started'"));
check('附件上傳後以 phase 區分建單前失敗與結果不明',
  expenseSubmit.includes("submissionPhase='uploaded_pre_rpc'")
    && expenseSubmit.includes("submissionPhase='rpc_started'")
    && expenseSubmit.includes("submissionPhase='rpc_unknown'")
    && expenseSubmit.includes("if(submissionPhase==='uploaded_pre_rpc')await cleanupStagedUploadsBestEffort")
    && expenseSubmit.includes("submissionPhase==='rpc_started'||submissionPhase==='rpc_unknown'")
    && expenseSubmit.includes('S.nrSubmissionConfirmationPending=durablePending.pending'));
check('代理簽核人不會沿用原簽核人的本機顯示資料',
  index.includes('(!effectiveId&&originalId&&userById(originalId))')
    && !section('function approvalRuntimeCandidateUser', 'function approvalRuntimeStepLabel').includes('(originalId&&userById(originalId))'));
check('正式建單後的必要附加同步進入可持久化冪等 outbox',
  index.includes("EXPENSE_POST_COMMIT_OUTBOX_KEY_BASE='finance_expense_post_commit_outbox_v1'")
    && expenseSubmit.includes('ensureExpensePostCommitOutbox(committedRecord,newNotif)')
    && expenseSubmit.includes("runExpensePostCommitOutbox({reason:'new_submission'})")
    && index.includes("dbUpsert('notifications',notifDbRow(entry.notification))")
    && index.includes("dbInsertOnce('notification_delivery_events',row)")
    && index.includes("persistAccountingLinesRemote(entry.record,{insertOnly:true})"));
check('正式建單後直到 outbox 與成功畫面完成才解除重送鎖定',
  expenseSubmit.indexOf('ensureExpensePostCommitOutbox(committedRecord,newNotif)')<expenseSubmit.lastIndexOf('clearExpenseSubmissionPending()')
    && expenseSubmit.indexOf("openApprovalTab('mine')")<expenseSubmit.lastIndexOf('clearExpenseSubmissionPending()')
    && index.includes('finalizeRecoveredExpenseSubmission(pending,readback.record,options)'));
check('申請人部門主管必須恰好一位且在附件上傳前 fail closed',
  index.includes("if((key==='dept_manager'||actorKind==='dept_manager')&&candidates.length!==1)")
    && expenseSubmit.indexOf('prepareApprovalRouteForSubmit(')<expenseSubmit.indexOf('uploadPreparedAttachmentSet(no)'));
check('正式送件在附件上傳前檢查 production release contract',
  expenseSubmit.includes('await verifyProductionReleaseContractForSubmission()')
    && expenseSubmit.indexOf('await verifyProductionReleaseContractForSubmission()')<expenseSubmit.indexOf('prepareApprovalRouteForSubmit(')
    && index.includes("manifest.contract!=='finance-release-artifact-v2'"));
check('收款帳戶失敗明列人工確認且不宣稱自動補齊',
  expenseSubmit.includes('收款帳戶沒有保存到常用清單，請日後手動確認或建立')
    && !index.includes('沒有則送出後自動建立'));
check('撞號重試會依新單號重新產生內嵌單號附件',
  expenseSubmit.includes('prepareRequestAttachmentsForNo=async function(targetNo)')
    && expenseSubmit.includes('var preparedRequestAttachments=await prepareRequestAttachmentsForNo(targetNo)'));
check('Google login can explicitly switch away from a stale browser account',
  index.includes('window.switchFinanceGoogleAccount=async function()')
    && index.includes("signOut({scope:'local'})")
    && index.includes("prompt:'select_account'"));
check('company login authority is taken from verified Google identity, not editable metadata',
  index.includes('function authUserHasVerifiedGoogleIdentity')
    && index.includes('function supabaseAuthUserPreferredEmail')
    && !section('function authUserHasVerifiedGoogleIdentity', 'function supabaseAuthUserPreferredEmail').includes('metadataVerified'));

function browserContext(extra = {}) {
  return vm.createContext(Object.assign({
    console,
    Date,
    Math,
    JSON,
    Promise,
    setTimeout,
    clearTimeout
  }, extra));
}

async function runBehaviorRegressions() {
  const cardinalityContext = browserContext();
  vm.runInContext(section('function approvalRuntimeCandidateCardinalityError', 'function approvalRuntimeStepLabel'), cardinalityContext);
  check('behavior: two canonical department managers are rejected',
    /恰好一位/.test(cardinalityContext.approvalRuntimeCandidateCardinalityError('dept_manager', 'dept_manager', [{id:'a'}, {id:'b'}]))
      && cardinalityContext.approvalRuntimeCandidateCardinalityError('dept_manager', 'dept_manager', [{id:'a'}]) === '');

  let resolverCandidates=[];
  const resolverContext=browserContext({
    S:{demoLogin:false},
    cloneApprovalStepsForRecord:(steps)=>JSON.parse(JSON.stringify(steps)),
    getSb:()=>({rpc:async()=>({error:null,data:{ok:true,actor_kind:'dept_manager',role_key:'dept_manager',candidates:resolverCandidates}})}),
    requireRemotePersistence:()=>true,
    normalizeCanonicalApplicantSelfSteps:(steps)=>steps,
    approvalRuntimeShouldResolveStep:()=>true,
    stepWorkflowKey:(step)=>step.workflowStepKey,
    approvalRuntimeActorKindForStep:()=> 'dept_manager',
    approvalRuntimeRoleKeyForStep:()=> 'dept_manager',
    approvalRuntimeTopLevelSelfCandidate:()=>null,
    approvalRuntimeCandidateId:(candidate)=>candidate.effective_finance_user_id,
    approvalRuntimeCandidateUser:(candidate)=>({id:candidate.effective_finance_user_id,n:candidate.name}),
    approvalRuntimeStepLabel:(step,key,user)=>'部門主管：'+user.n,
    approvalRuntimeOriginalCandidateId:(candidate)=>candidate.original_finance_user_id||candidate.effective_finance_user_id,
    clearCanonicalApplicantSelfAutoSkip:()=>{},
    isApprovalRuntimeUnavailableError:()=>false,
    markApprovalRuntimeUnavailable:()=>{},
    withOperationTimeout:(promise)=>Promise.resolve(promise),
    reconcileResolvedDeptManagerAutoSkip:(steps)=>steps
  });
  vm.runInContext(section('function approvalRuntimeCandidateCardinalityError', 'function approvalRuntimeStepLabel'), resolverContext);
  vm.runInContext(section('async function resolveApprovalStepsWithRuntime', 'var SUBMISSION_ROUTE_SMOKE_OVERRIDE'), resolverContext);
  const managerStep=[{workflowStepKey:'dept_manager',rk:'dept_manager',r:'申請人部門主管'}];
  resolverCandidates=[{effective_finance_user_id:'manager-a',name:'A'},{effective_finance_user_id:'manager-b',name:'B'}];
  let duplicateManagerRejected=false;
  try{await resolverContext.resolveApprovalStepsWithRuntime({id:'applicant-1'},'expense_reimbursement','D100',{},managerStep);}
  catch(error){duplicateManagerRejected=/恰好一位/.test(error.message);}
  resolverCandidates=[{effective_finance_user_id:'manager-a',name:'A'}];
  const uniqueManagerRoute=await resolverContext.resolveApprovalStepsWithRuntime({id:'applicant-1'},'expense_reimbursement','D100',{},managerStep);
  check('behavior: the actual runtime resolver fails closed on multiple managers and accepts exactly one',
    duplicateManagerRejected&&uniqueManagerRoute.length===1&&uniqueManagerRoute[0].uid==='manager-a');

  const local = new Map();
  const session = new Map();
  const deliveryRows = new Map();
  let accountingCalls = 0;
  const upsertCalls = {notifications:0};
  const insertCalls = {notification_delivery_events:0};
  const outboxContext = browserContext({
    DEFAULT_TENANT_ID:'tenant-default',
    S:{user:{id:'applicant-1',n:'申請人',email:'applicant@example.com'},demoLogin:false},
    NOTIFS:[],
    currentTenantId:()=>'tenant-1',
    activeDataEnvironment:()=>'production',
    safeJsonGet:(key,fallback)=>local.has(key)?JSON.parse(local.get(key)):fallback,
    safeJsonSet:(key,value)=>{local.set(key,JSON.stringify(value));return true;},
    safeRemoveItem:(key)=>{local.delete(key);return true;},
    sessionGetItem:(key)=>session.get(key)||null,
    sessionSetItem:(key,value)=>{session.set(key,String(value));return true;},
    sessionRemoveItem:(key)=>session.delete(key),
    num:(value)=>Number(value)||0,
    requestTypeLabel:()=> '費用申請',
    fmt:(value)=>String(value),
    notificationPayload:(n)=>({eventType:'approval',title:n.title,body:n.body,requestId:n.reqId,env:'production',tenantId:'tenant-1',actor:{email:'applicant@example.com'}}),
    withTenantColumn:(row,tenantId)=>Object.assign({},row,{tenant_id:tenantId}),
    hasSupabase:()=>true,
    withOperationTimeout:(promise)=>Promise.resolve(promise),
    persistAccountingLinesRemote:async()=>{accountingCalls+=1;if(accountingCalls===1)throw new Error('temporary accounting failure');return{ok:true};},
    dbUpsert:async(table)=>{upsertCalls[table]=(upsertCalls[table]||0)+1;return{ok:true};},
    dbInsert:async(table,row)=>{
      insertCalls[table]=(insertCalls[table]||0)+1;
      if(deliveryRows.has(row.id))return{ok:false,error:{code:'23505',message:'duplicate key value violates unique constraint'}};
      deliveryRows.set(row.id,JSON.parse(JSON.stringify(row)));
      return{ok:true};
    },
    notifDbRow:(row)=>row,
    formatStorageUploadError:(error)=>error.message,
    recordOpsEvent:()=>({})
  });
  vm.runInContext(section('function isPostgresUniqueConflict', 'function accountingLineDbRow'), outboxContext);
  vm.runInContext(section("var EXPENSE_POST_COMMIT_OUTBOX_KEY_BASE", 'async function finalizeRecoveredExpenseSubmission'), outboxContext);
  const record={id:'r-1',no:'20260827001',app:'申請人',applicantId:'applicant-1',type:'expense_reimbursement',tL:'費用申請',amt:100,files:[{name:'receipt.png',contents:'sensitive'}],passbookFiles:[{name:'bank.png'}],steps:[{r:'主管',a:''}],dataEnv:'production',formPayload:{submissionAttemptId:'attempt-1',accountingLines:[{id:'line_1',grossAmount:100}],bankAccount:'secret'}};
  check('behavior: committed request creates a durable post-commit outbox', outboxContext.ensureExpensePostCommitOutbox(record, null).ok && local.size===1 && session.size===1);
  outboxContext.ensureExpensePostCommitOutbox({id:record.id,no:record.no,applicantId:record.applicantId,dataEnv:'production',formPayload:{submissionAttemptId:'attempt-1'}}, null);
  const storedRecord=outboxContext.loadExpensePostCommitOutbox()[0].record;
  check('behavior: durable outbox excludes sensitive form data and preserves retry lines across a thin readback',
    !Object.prototype.hasOwnProperty.call(storedRecord,'files')
      && !Object.prototype.hasOwnProperty.call(storedRecord,'passbookFiles')
      && !Object.prototype.hasOwnProperty.call(storedRecord.formPayload,'bankAccount')
      && storedRecord.formPayload.accountingLines.length===1);
  const firstRun=await outboxContext.runExpensePostCommitOutbox({reason:'test-first'});
  const afterFirst=outboxContext.loadExpensePostCommitOutbox()[0];
  check('behavior: a failed accounting side effect remains pending while successful tasks stay done',
    firstRun.ok===false && afterFirst.tasks.accounting.status==='pending'
      && afterFirst.tasks.internalNotification.status==='done'
      && afterFirst.tasks.externalNotification.status==='done');
  const deliveryEventId='nde_expense_submit_r-1';
  deliveryRows.get(deliveryEventId).status='delivered';
  afterFirst.tasks.externalNotification.status='pending';
  afterFirst.tasks.externalNotification.updatedAt=new Date().toISOString();
  outboxContext.saveExpensePostCommitOutboxEntry(afterFirst);
  outboxContext.EXPENSE_POST_COMMIT_OUTBOX_RUNNING=false;
  const secondRun=await outboxContext.runExpensePostCommitOutbox({reason:'test-reload'});
  const afterReload=outboxContext.loadExpensePostCommitOutbox()[0];
  check('behavior: reload retries only unfinished outbox work idempotently',
    secondRun.ok===true && afterReload.tasks.accounting.status==='done'
      && accountingCalls===2 && upsertCalls.notifications===1);
  check('behavior: external notification replay preserves a worker-owned delivered status',
    afterReload.tasks.externalNotification.status==='done'
      && insertCalls.notification_delivery_events===2
      && deliveryRows.get(deliveryEventId).status==='delivered');

  const accountingRows=new Map();
  let accountingInsertCalls=0,accountingUpsertCalls=0;
  const accountingContext=browserContext({
    S:{demoLogin:false},
    hasSupabase:()=>true,
    activeDataEnvironment:()=>'production',
    num:(value)=>Number(value)||0,
    principalAccountingLines:(lines)=>lines,
    buildAccountingLines:(row)=>row.formPayload.accountingLines,
    dbInsert:async(table,row)=>{
      accountingInsertCalls+=1;
      if(accountingRows.has(row.id))return{ok:false,error:{code:'23505',message:'duplicate key value violates unique constraint "application_accounting_lines_pkey"'}};
      accountingRows.set(row.id,JSON.parse(JSON.stringify(row)));
      return{ok:true};
    },
    dbUpsert:async(table,row)=>{
      accountingUpsertCalls+=1;
      accountingRows.set(row.id,JSON.parse(JSON.stringify(row)));
      return{ok:true};
    }
  });
  vm.runInContext(section('function isPostgresUniqueConflict', 'function hasVisibleAccountingInputs'), accountingContext);
  const accountingRecord={id:'r-seed',no:'20260827002',eid:'E1',dc:'D100',dataEnv:'production',formPayload:{accountingLines:[{description:'seed',grossAmount:100,netAmount:100,taxAmount:0,debitAccount:'6221',debitAccountName:'勞務費',creditAccount:'1112',creditAccountName:'銀行存款'}]}};
  const firstSeed=await accountingContext.persistAccountingLinesRemote(accountingRecord,{insertOnly:true});
  const reviewedLine=accountingRows.get('r-seed_1');
  reviewedLine.debit_account='6229';
  reviewedLine.reviewed_by='會計覆核';
  reviewedLine.reviewed_at='2026-08-27T09:00:00.000Z';
  const replayedSeed=await accountingContext.persistAccountingLinesRemote(accountingRecord,{insertOnly:true});
  check('behavior: accounting seed replay never overwrites a later manual review',
    firstSeed.ok===true && replayedSeed.ok===true
      && accountingInsertCalls===2 && accountingUpsertCalls===0
      && accountingRows.get('r-seed_1').debit_account==='6229'
      && accountingRows.get('r-seed_1').reviewed_by==='會計覆核');
  accountingRecord.formPayload.accountingLines[0].debitAccount='6230';
  accountingRecord.formPayload.accountingLines[0].reviewedBy='會計正式更新';
  await accountingContext.persistAccountingLinesRemote(accountingRecord);
  check('behavior: explicit accounting review paths still update existing lines',
    accountingUpsertCalls===1
      && accountingRows.get('r-seed_1').debit_account==='6230'
      && accountingRows.get('r-seed_1').reviewed_by==='會計正式更新');

  const pendingLocal=new Map(),pendingSession=new Map(),finalizeOrder=[];
  const recoveryContext=browserContext({
    DEFAULT_TENANT_ID:'tenant-default',
    S:{user:{id:'applicant-1'},nrSubmissionConfirmationPending:null},
    currentTenantId:()=> 'tenant-1',
    activeDataEnvironment:()=> 'production',
    safeJsonGet:(key,fallback)=>pendingLocal.has(key)?JSON.parse(pendingLocal.get(key)):fallback,
    safeJsonSet:(key,value)=>{pendingLocal.set(key,JSON.stringify(value));return true;},
    safeRemoveItem:(key)=>{finalizeOrder.push('clear-local');pendingLocal.delete(key);return true;},
    sessionGetItem:(key)=>pendingSession.get(key)||null,
    sessionSetItem:(key,value)=>{pendingSession.set(key,String(value));return true;},
    sessionRemoveItem:(key)=>{finalizeOrder.push('clear-session');pendingSession.delete(key);return true;},
    ensureExpensePostCommitOutbox:()=>{finalizeOrder.push('outbox');return{ok:true};},
    runExpensePostCommitOutbox:async()=>{finalizeOrder.push('tasks');return{ok:true,failed:[]};},
    buildAll:()=>finalizeOrder.push('ui'),
    renderNotifs:()=>finalizeOrder.push('notifs'),
    pruneCompletedExpensePostCommitOutbox:()=>finalizeOrder.push('prune'),
    alert:()=>{}
  });
  vm.runInContext(section("var EXPENSE_SUBMISSION_PENDING_KEY_BASE", 'var EXPENSE_POST_COMMIT_OUTBOX_KEY_BASE'), recoveryContext);
  vm.runInContext(section('async function finalizeRecoveredExpenseSubmission', 'async function reconcilePendingExpenseSubmission'), recoveryContext);
  const pendingSaved=recoveryContext.saveExpenseSubmissionPending(record,null);
  recoveryContext.S.nrSubmissionConfirmationPending=null;
  const pendingAfterReload=recoveryContext.loadExpenseSubmissionPending();
  check('behavior: pre-commit pending is durable and restores the duplicate lock after reload',
    pendingSaved.ok&&pendingLocal.size===1&&pendingSession.size===1&&pendingAfterReload.requestId===record.id&&recoveryContext.S.nrSubmissionConfirmationPending.requestId===record.id);
  finalizeOrder.length=0;
  const recovered=await recoveryContext.finalizeRecoveredExpenseSubmission(pendingAfterReload,record,{notify:false});
  const firstClear=Math.min(finalizeOrder.indexOf('clear-local'),finalizeOrder.indexOf('clear-session'));
  check('behavior: DB success readback after reload renders success before clearing the duplicate lock',
    recovered.state==='committed'
      && finalizeOrder.slice(0,4).join(',')==='outbox,tasks,ui,notifs'
      && firstClear>finalizeOrder.indexOf('notifs')
      && pendingLocal.size===0&&pendingSession.size===0
      && finalizeOrder[finalizeOrder.length-1]==='prune');

  const releaseContext=browserContext({
    document:{querySelector:()=>({getAttribute:()=> 'old-contract'})},
    formalOnlineMode:()=>true,
    PRODUCTION_APP_URL:'https://finance.example/',
    withOperationTimeout:(promise)=>Promise.resolve(promise),
    fetch:async(url)=>url.includes('index.html')
      ?{ok:true,text:async()=>'<meta name="finance-release-contract" content="new-contract">'}
      :{ok:true,json:async()=>({contract:'finance-release-artifact-v2',build_target:'production',source_commit:'a'.repeat(40)})}
  });
  vm.runInContext(section('function currentFinanceReleaseContract', 'function setDemoLoginVisibility'), releaseContext);
  const stale=await releaseContext.verifyProductionReleaseContractForSubmission();
  check('behavior: a stale open production page is stopped with a refresh instruction', stale.ok===false && stale.stale===true && /重新整理/.test(stale.message));
}

runBehaviorRegressions().then(() => {
  process.stdout.write(`\nRoot-cause regressions: ${passed}/${passed + failed} passed.\n`);
  if (failed) process.exit(1);
}).catch((error) => {
  process.stderr.write(`FAIL behavior regression harness: ${error.stack || error.message}\n`);
  process.exit(1);
});
