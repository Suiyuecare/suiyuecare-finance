#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const approvalSource = fs.readFileSync(path.join(root, 'assets/engines/approval-engine.js'), 'utf8');
const formSource = fs.readFileSync(path.join(root, 'assets/engines/form-engine.js'), 'utf8');
const organizationSource = fs.readFileSync(path.join(root, 'assets/engines/organization-engine.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const registered = {};
const window = {
  FinanceV4Engines: {
    register(name, engine) {
      registered[name] = engine;
    },
  },
};
window.window = window;
const sandbox = { window, console, Date, setTimeout, clearTimeout };
vm.runInNewContext(approvalSource, sandbox, { filename: 'approval-engine.js' });
vm.runInNewContext(organizationSource, sandbox, { filename: 'organization-engine.js' });

const approval = window.FinanceApprovalEngine;
const organization = window.FinanceOrganizationEngine;
if (!approval || !organization) throw new Error('Finance engines did not register.');

const users = {
  liuAdmin: { id: 'u5', n: '劉巧涵', email: 'admin@suiyuecare.com', role: 'admin_director', dc: 'A1100', active: true },
  liuAccountant: { id: 'u6', n: '劉巧涵', email: 'suiyue.acct@suiyuecare.com', role: 'accountant', dc: 'A1101', active: true },
  ceo: { id: 'u_entrepreneur', n: '執行長', email: 'entrepreneur@suiyuecare.com', role: 'ceo', dc: 'A1000', active: true },
  su: { id: 'u_su', n: '蘇之瑄', email: 'su@suiyuecare.com', role: 'employee', dc: 'A1201', active: true },
  suSupervisor: { id: 'u_su_supervisor', n: '蘇之瑄直屬主管', role: 'section_chief', dc: 'A1201', active: true },
  suManager: { id: 'u_su_manager', n: '蘇之瑄部門主任', role: 'dept_manager', dc: 'A1200', active: true },
  zhu: { id: 'u8', n: '朱夏欣', email: 'generalaffairs@suiyuecare.com', role: 'general_affairs', dc: 'A1103', active: true },
};
const allUsers = Object.values(users);

// Mirrors the canonical resolver results rehearsed against the formal DB route:
// u5 -> CEO/CEO, u6 -> u5/u5, CEO A1000 -> formal same-dept CEO fallback,
// while the ordinary employee and general-affairs personas retain real managers.
const directSupervisorByApplicant = {
  u5: users.ceo,
  u6: users.liuAdmin,
  u_su: users.suSupervisor,
  u8: users.liuAdmin,
};
const deptManagerByApplicant = {
  u5: users.ceo,
  u6: users.liuAdmin,
  u_su: users.suManager,
  u8: users.liuAdmin,
};

const templates = approval.defaultWorkflowTemplates();
const deps = {
  firstUserByRole(role) {
    if (role === 'admin_director') return users.liuAdmin;
    if (role === 'accountant') return users.liuAccountant;
    if (role === 'ceo') return users.ceo;
    if (role === 'general_affairs') return users.zhu;
    // The CEO keeps the CEO primary role and holds cashier as a formal
    // secondary approval role in employee_department_roles.
    if (role === 'cashier') return users.ceo;
    return allUsers.find((user) => user.role === role) || null;
  },
  cashierUser() { return users.ceo; },
  directSupervisorUser(applicant) { return directSupervisorByApplicant[applicant.id] || null; },
  approvalDeptManagerUser(applicant) { return deptManagerByApplicant[applicant.id] || null; },
  scopedApprovalRole(role) { return ['section_chief', 'dept_manager'].includes(role); },
  globalApprovalRole(role) { return ['admin_director', 'accountant', 'ceo', 'cashier', 'general_affairs'].includes(role); },
  scopedUserByRole(role) { return deps.firstUserByRole(role); },
  sameApprovalUser(left, right) { return !!left && !!right && left.id === right.id; },
  workflowTemplateForRequestType(requestType) {
    return templates.find((template) => template.enabled !== false && template.appliesTo.includes(requestType)) || null;
  },
  workflowAmountFromContext(context) { return Number(context && context.amount || 0); },
  workflowConditionBoolValue(value, fallback) { return value == null ? fallback : !!value; },
};

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed += 1;
  console.log(`PASS ${passed}: ${label}`);
}
function step(route, key) {
  return route.find((item) => (item.workflowStepKey || item.rk) === key || item.rk === key);
}
function exactAuditedSelfSkip(item, applicant) {
  return !!item
    && item.uid === applicant.id
    && item.a === 'approved'
    && item.autoSkip === true
    && item.autoSkipReason === 'canonical_actor_is_applicant'
    && item.n === '系統自動跳關'
    && item.c === '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。'
    && item.t === '';
}
function templateExpense(applicant) {
  return approval.buildWorkflowTemplateSteps(applicant, 'expense_reimbursement', { amount: 100000 }, deps);
}
function noRuntimeErrors(applicant, requestType, route) {
  return approval.approvalRuntimeStepErrors(applicant, requestType, route, deps, {}).length === 0;
}
function noPendingRequestFor(route, key) {
  return !organization.actorRequestsFromSteps(route).some((request) => request.role_key === key || request.step_key === key || request.key === key);
}
function topLevelMissingPayload(applicant, key, overrides = {}) {
  const departmentCode = overrides.departmentCode || applicant.dc;
  const chainKey = key === 'direct_supervisor'
    ? 'direct_supervisor_finance_user_id'
    : 'department_manager_finance_user_id';
  return {
    ok: false,
    missing_reason: overrides.missingReason || 'NO_MATCHING_ACTOR',
    department_code: departmentCode,
    candidates: [],
    applicant_context: {
      ok: true,
      finance_user: { id: applicant.id, name: applicant.n, email: applicant.email, role: applicant.role, department_code: departmentCode },
      primary_role: { role_key: overrides.contextRole || applicant.role, department_code: departmentCode, can_approve: overrides.canApprove !== false },
      department: { code: departmentCode },
      approval_chain: { [chainKey]: overrides.chainUserId || null },
    },
  };
}

const expectedExpenseKeys = [
  'direct_supervisor', 'dept_manager', 'admin_director', 'accountant',
  'ceo', 'cashier', 'applicant_confirm', 'accountant_final',
];

const adminRoute = templateExpense(users.liuAdmin);
check('劉巧涵行政主任：模板保留完整八關，不因本人角色刪關', JSON.stringify(adminRoute.map((item) => item.rk)) === JSON.stringify(expectedExpenseKeys));
check('劉巧涵行政主任：admin_director 是 exact audited auto-skip', exactAuditedSelfSkip(step(adminRoute, 'admin_director'), users.liuAdmin));
check('劉巧涵行政主任：auto-skip 不產生待簽 actor request', noPendingRequestFor(adminRoute, 'admin_director'));
check('劉巧涵行政主任：前端正式流程檢核通過', noRuntimeErrors(users.liuAdmin, 'expense_reimbursement', adminRoute));

const accountantRoute = templateExpense(users.liuAccountant);
check('劉巧涵會計：accountant 審核關保留並 audited auto-skip', exactAuditedSelfSkip(step(accountantRoute, 'accountant'), users.liuAccountant));
check('劉巧涵會計：accountant_final 作業關仍為本人 pending', step(accountantRoute, 'accountant_final').uid === users.liuAccountant.id && !step(accountantRoute, 'accountant_final').a && !step(accountantRoute, 'accountant_final').autoSkip);
check('劉巧涵會計：前端正式流程檢核通過', noRuntimeErrors(users.liuAccountant, 'expense_reimbursement', accountantRoute));

const ceoRoute = templateExpense(users.ceo);
check('執行長 A1000：direct_supervisor formal fallback 保留 audited auto-skip', exactAuditedSelfSkip(step(ceoRoute, 'direct_supervisor'), users.ceo));
check('執行長 A1000：dept_manager formal fallback 保留 audited auto-skip', exactAuditedSelfSkip(step(ceoRoute, 'dept_manager'), users.ceo));
check('執行長 A1000：ceo review 保留 audited auto-skip', exactAuditedSelfSkip(step(ceoRoute, 'ceo'), users.ceo));
check('執行長 A1000：兼任出納仍保留 operational pending', step(ceoRoute, 'cashier').uid === users.ceo.id && !step(ceoRoute, 'cashier').a && !step(ceoRoute, 'cashier').autoSkip);
check('執行長 A1000：前端正式流程檢核通過', noRuntimeErrors(users.ceo, 'expense_reimbursement', ceoRoute));
check('執行長 A1000：DB 回傳 NO_MATCHING_ACTOR 時，直屬主管解析為本人 audited fallback',
  approval.approvalRuntimeTopLevelSelfCandidate(topLevelMissingPayload(users.ceo, 'direct_supervisor'), 'direct_supervisor', 'direct_supervisor', users.ceo, 'A1000').finance_user_id === users.ceo.id);
check('執行長 A1000：DB 回傳 NO_MATCHING_ACTOR 時，部門主任解析為本人 audited fallback',
  approval.approvalRuntimeTopLevelSelfCandidate(topLevelMissingPayload(users.ceo, 'dept_manager'), 'dept_manager', 'dept_manager', users.ceo, 'A1000').finance_user_id === users.ceo.id);
check('最高層 fallback 不接受一般員工',
  approval.approvalRuntimeTopLevelSelfCandidate(topLevelMissingPayload(users.su, 'direct_supervisor'), 'direct_supervisor', 'direct_supervisor', users.su, users.su.dc) === null);
check('最高層 fallback 不接受跨部門或已有主管的資料',
  approval.approvalRuntimeTopLevelSelfCandidate(topLevelMissingPayload(users.ceo, 'direct_supervisor', { chainUserId: users.liuAdmin.id }), 'direct_supervisor', 'direct_supervisor', users.ceo, 'A1000') === null
    && approval.approvalRuntimeTopLevelSelfCandidate(topLevelMissingPayload(users.ceo, 'dept_manager'), 'dept_manager', 'dept_manager', users.ceo, 'OTHER') === null);

const suRoute = templateExpense(users.su);
check('蘇之瑄：主管與部門主任由不同正式人員承辦', step(suRoute, 'direct_supervisor').uid === users.suSupervisor.id && step(suRoute, 'dept_manager').uid === users.suManager.id);
check('蘇之瑄：一般員工流程沒有偽造的 canonical auto-skip', !suRoute.some((item) => item.autoSkipReason === 'canonical_actor_is_applicant'));
check('蘇之瑄：前端正式流程檢核通過', noRuntimeErrors(users.su, 'expense_reimbursement', suRoute));

const zhuExpenseRoute = templateExpense(users.zhu);
check('朱夏欣：cashier 指向正式出納李佳泰，不再由總務承辦', step(zhuExpenseRoute, 'cashier').uid === users.ceo.id && !step(zhuExpenseRoute, 'cashier').a && !step(zhuExpenseRoute, 'cashier').autoSkip);
check('朱夏欣：一般費用流程檢核通過', noRuntimeErrors(users.zhu, 'expense_reimbursement', zhuExpenseRoute));
const zhuPurchaseRoute = approval.buildWorkflowTemplateSteps(users.zhu, 'purchase_request', { amount: 100000, is_purchase: true, requires_general_affairs: true }, deps);
check('朱夏欣採購：procurement_payment 本人作業維持 pending', step(zhuPurchaseRoute, 'procurement_payment').uid === users.zhu.id && !step(zhuPurchaseRoute, 'procurement_payment').a);
check('朱夏欣採購：procurement_receipt 本人作業維持 pending', step(zhuPurchaseRoute, 'procurement_receipt').uid === users.zhu.id && !step(zhuPurchaseRoute, 'procurement_receipt').a);
check('朱夏欣採購：cashier 由正式出納李佳泰承辦', step(zhuPurchaseRoute, 'cashier').uid === users.ceo.id && !step(zhuPurchaseRoute, 'cashier').a);
check('朱夏欣採購：前端正式流程檢核通過', noRuntimeErrors(users.zhu, 'purchase_request', zhuPurchaseRoute));

// All builder families use the same self-review contract.
const adminDefault = approval.buildDefaultApprovalSteps(users.liuAdmin, 'expense_reimbursement', deps);
check('fallback expense builder 與模板採同一 audited self 規則', exactAuditedSelfSkip(step(adminDefault, 'admin_director'), users.liuAdmin));
const accountantInvoice = approval.buildDefaultInvoiceApprovalSteps(users.liuAccountant, users.liuAccountant.dc, deps);
check('invoice builder：accountant review audited auto-skip', exactAuditedSelfSkip(step(accountantInvoice, 'accountant'), users.liuAccountant));
check('invoice builder：accountant_invoice operational pending', step(accountantInvoice, 'accountant_invoice').uid === users.liuAccountant.id && !step(accountantInvoice, 'accountant_invoice').a);
const ceoBill = approval.buildDefaultBillApprovalSteps(users.ceo, deps);
check('bill builder：CEO direct supervisor fallback audited auto-skip', exactAuditedSelfSkip(step(ceoBill, 'direct_supervisor'), users.ceo));
check('bill builder：CEO dept manager fallback audited auto-skip', exactAuditedSelfSkip(step(ceoBill, 'dept_manager'), users.ceo));

// Negative/tamper cases must fail closed before the server performs its own
// authoritative route comparison.
const pendingSelf = JSON.parse(JSON.stringify(adminRoute));
Object.assign(step(pendingSelf, 'admin_director'), { a: '', n: '', c: '', autoSkip: false, autoSkipReason: undefined });
check('篡改負向：中間審核改成 pending self 會被阻擋', !noRuntimeErrors(users.liuAdmin, 'expense_reimbursement', pendingSelf));

const wrongUid = JSON.parse(JSON.stringify(adminRoute));
step(wrongUid, 'admin_director').uid = users.liuAccountant.id;
check('篡改負向：audited self marker 換成他人 uid 會被阻擋', !noRuntimeErrors(users.liuAdmin, 'expense_reimbursement', wrongUid));

const wrongCopy = JSON.parse(JSON.stringify(adminRoute));
step(wrongCopy, 'admin_director').c = '手動核准';
check('篡改負向：audited self 說明遭修改會被阻擋', !noRuntimeErrors(users.liuAdmin, 'expense_reimbursement', wrongCopy));

const forgedOperationalSkip = JSON.parse(JSON.stringify(accountantRoute));
Object.assign(step(forgedOperationalSkip, 'accountant_final'), {
  a: 'approved', n: '系統自動跳關', c: '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。',
  autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant',
});
check('篡改負向：operational self 偽裝 auto-skip 會被阻擋', !noRuntimeErrors(users.liuAccountant, 'expense_reimbursement', forgedOperationalSkip));

const forgedOperationalHistory = JSON.parse(JSON.stringify(accountantRoute));
Object.assign(step(forgedOperationalHistory, 'accountant_final'), {
  a: 'approved', n: '手動通過', c: '偽造歷史', autoSkip: true, autoSkipReason: 'same_direct_supervisor_and_dept_manager',
});
check('篡改負向：operational self 以其他理由預先通過也會被阻擋', !noRuntimeErrors(users.liuAccountant, 'expense_reimbursement', forgedOperationalHistory));

// Formal submission must rebuild from the canonical directory before runtime
// resolution and validation; this regression intentionally does not invoke any
// development-only route injection hook.
const prepareStart = indexSource.indexOf('async function prepareApprovalRouteForSubmit');
const prepareEnd = indexSource.indexOf('function approvalRuntimeSourceTableForRecord', prepareStart);
const prepareBody = indexSource.slice(prepareStart, prepareEnd);
const canonicalBranch = prepareBody.indexOf('if(hasSupabase()&&!S.demoLogin)');
const canonicalRebuild = prepareBody.indexOf('steps=rebuildApprovalRouteStepsFromCanonicalDirectory');
const runtimeResolve = prepareBody.indexOf('resolveApprovalStepsWithRuntime');
const runtimeValidate = prepareBody.indexOf('approvalRuntimeStepErrors');
check('正式送件先同步 canonical directory，再重建 exact route', canonicalBranch > -1 && canonicalRebuild > canonicalBranch);
check('正式送件 exact route 重建後才執行 DB actor resolver', runtimeResolve > canonicalRebuild);
check('正式送件 DB actor resolver 後才做 fail-closed route validation', runtimeValidate > runtimeResolve);
check('正式 routing policy 不會為避開申請人而偷偷改選另一帳號', /function approvalRoutingPolicyAssignee\([^)]*\)\{\s*return firstUserByRole\(role\)\|\|null;\s*\}/.test(indexSource));
const resolverStart = indexSource.indexOf('async function resolveApprovalStepsWithRuntime');
const resolverEnd = indexSource.indexOf('var SUBMISSION_ROUTE_SMOKE_OVERRIDE', resolverStart);
const resolverBody = indexSource.slice(resolverStart, resolverEnd);
check('正式 actor resolver 先套用最高層本人例外，再判斷 NO_MATCHING_ACTOR',
  resolverStart > -1
    && resolverBody.indexOf('approvalRuntimeTopLevelSelfCandidate') > -1
    && resolverBody.indexOf('approvalRuntimeTopLevelSelfCandidate') < resolverBody.indexOf('if(!payload.ok||!candidates.length)'));
const cashierResolverStart = indexSource.indexOf('function cashierUser()');
const cashierResolverEnd = indexSource.indexOf('function activeUniqueUsers', cashierResolverStart);
const cashierResolverBody = indexSource.slice(cashierResolverStart, cashierResolverEnd);
check('出納只能使用正式主角色或 employee_department_roles 副角色，不再回退總務',
  cashierResolverBody.includes("firstUserByRole('cashier')||firstUserByRuntimeRole('cashier')")
    && !cashierResolverBody.includes("firstUserByRole('general_affairs')")
    && !cashierResolverBody.includes("firstUserByRole('ceo')"));
const runtimeResolverStart = indexSource.indexOf('async function resolveApprovalStepsWithRuntime');
const runtimeResolverEnd = indexSource.indexOf('async function prepareApprovalRouteForSubmit', runtimeResolverStart);
const runtimeResolverBody = indexSource.slice(runtimeResolverStart, runtimeResolverEnd);
check('正式送件不可被健康狀態旗標跳過 DB actor resolver',
  runtimeResolverBody.includes("client.rpc('finance_org_resolve_actor'")
    && !runtimeResolverBody.includes('approvalRuntimeLikelyAvailable()')
    && !runtimeResolverBody.includes('membershipOrgRuntimeGraph()'));
check('已標示自動跳關的部門主任仍必須重新走正式 DB resolver',
  !approvalSource.slice(approvalSource.indexOf('function approvalRuntimeShouldResolveStep'), approvalSource.indexOf('function numValue')).includes('approvalStepAutoClosed')
    && runtimeResolverBody.includes('reconcileResolvedDeptManagerAutoSkip'));
check('角色型關卡不把前端 UID 當成權威來源',
  /p_actor_ref:actorKind==='fixed_user'\?\(step\.uid\|\|null\):null/.test(runtimeResolverBody));
check('正式 resolver 的 effective UID 不會被本機舊人員資料覆寫',
  runtimeResolverBody.includes('var uid=approvalRuntimeCandidateId(picked)')
    && indexSource.includes("if(u)return Object.assign({},u,{id:effectiveId||originalId||u.id});"));
check('解析器若沒有 actor kind 或有候選資料卻沒有身分，不得沿用舊 UID',
  runtimeResolverBody.includes('缺少正式簽核人解析類型')
    && runtimeResolverBody.includes("if(!uid)throw new Error('正式組織回傳的簽核人無有效身分')"));
check('解析失敗必須 fail closed，並明確保證不上傳附件、不建單',
  runtimeResolverBody.includes("throw new Error('正式簽核人解析未完成：'")
    && /runtimeResolutionFailed:true/.test(prepareBody)
    && prepareBody.includes('系統尚未上傳附件，也沒有建立申請單'));
const expenseSubmitStart = indexSource.indexOf('window.submitNR=async function(){');
const expenseSubmitEnd = indexSource.indexOf('function expenseStatusKey', expenseSubmitStart);
const expenseSubmitBody = indexSource.slice(expenseSubmitStart, expenseSubmitEnd);
check('新送件狀態與關卡取自 canonical route 的第一個實際待簽位置',
  expenseSubmitStart > -1
    && expenseSubmitBody.includes("var nextStepIndex=steps.findIndex(function(s){return !s.a;});")
    && expenseSubmitBody.includes("step:nextStepIndex>-1?nextStepIndex+1:requestWorkflowStepCount(steps)")
    && !expenseSubmitBody.includes('step:nextStep?2:'));
check('前台文案不再把出納說成執行長代行',
  !indexSource.includes('目前由執行長代行')
    && !approvalSource.includes('目前由執行長代行')
    && !formSource.includes('目前由執行長代行'));

console.log(`\nSubmission persona route regression: ${passed} checks passed.`);
