#!/usr/bin/env node
'use strict';

const assert = require('assert');
global.window = {
  FinanceV4Engines: { register() {} }
};
require('../assets/engines/approval-engine.js');
const engine = global.window.FinanceApprovalEngine;

const users = {
  cashier: { id: 'cashier', n: '李佳泰' },
  applicant: { id: 'applicant', n: '徐靖雯' },
  accountant: { id: 'accountant', n: '劉巧涵' }
};
const deps = {
  activeStep(flow) {
    return flow.steps.find((step) => !step.a) || null;
  },
  activeStepIndex(flow) {
    return flow.steps.findIndex((step) => !step.a);
  },
  autoSkippedStep(step) {
    return step.autoSkip === true;
  },
  normalizeFiles(files) {
    return Array.isArray(files) ? files : [];
  },
  stepAttachmentHtml() {
    return '';
  },
  stepFeedbackHtml() {
    return '';
  },
  stepPurpose(step) {
    return step.purpose || '';
  },
  stepTitle(step) {
    return step.r || '';
  },
  userById(id) {
    return users[id] || null;
  },
  escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

const pendingFlow = {
  steps: [
    { r: '出納放款', rk: 'cashier', uid: 'cashier', n: '', a: '', t: '' },
    { r: '申請人確認', rk: 'applicant_confirm', uid: 'applicant', n: '', a: '', t: '' },
    { r: '會計確認入帳', rk: 'accountant_final', uid: 'accountant', n: '', a: '', t: '' }
  ]
};
const pendingRows = engine.timelineRows(pendingFlow, {}, deps);
assert.deepStrictEqual(
  pendingRows.map((row) => row.assignedName),
  ['李佳泰', '徐靖雯', '劉巧涵'],
  '未完成關卡應保留指定處理人姓名'
);
const pendingHtml = engine.approvalTimelineHtml(pendingFlow, {}, deps);
assert.match(pendingHtml, /出納放款 — 待處理：李佳泰/);
assert.match(pendingHtml, /申請人確認 — 待處理：徐靖雯/);
assert.match(pendingHtml, /會計確認入帳 — 待處理：劉巧涵/);

const completedFlow = {
  steps: [
    { r: '出納放款', rk: 'cashier', uid: 'cashier', n: '代理驗收人', a: 'approved', t: '2026/09/02 15:30' }
  ]
};
const completedHtml = engine.approvalTimelineHtml(completedFlow, {}, deps);
assert.match(completedHtml, /出納放款 — 已由：代理驗收人/);
assert.doesNotMatch(completedHtml, /待處理：李佳泰/);

console.log('PASS 簽核時間軸分開顯示待處理人與實際簽核人');
