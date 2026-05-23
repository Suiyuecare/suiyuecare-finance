import { derivePayrollProcessBlockers, type PayrollBatch, type PayrollDraft, type SourceCheck } from "@/lib/payroll/payroll-store";

export type PayrollRiskAction =
  | "generate_draft"
  | "lock_payroll"
  | "publish_payslips"
  | "export_bank_file"
  | "export_roster"
  | "create_adjustment";

export type PayrollRiskSeverity = "blocking" | "warning";

export type PayrollRiskControl = {
  id: string;
  action: PayrollRiskAction;
  title: string;
  description: string;
  severity: PayrollRiskSeverity;
  passed: boolean;
  evidence: string;
  remediation: string;
};

export type PayrollRiskPermissions = {
  canGenerateDraft: boolean;
  canLockPayroll: boolean;
  canPublishPayslips: boolean;
  canExportBankFile: boolean;
  canExportPayrollRoster: boolean;
  canCreateAdjustment: boolean;
};

export type PayrollRiskInput = {
  sourceChecks: SourceCheck[];
  drafts: PayrollDraft[];
  batch: PayrollBatch;
  permissions: PayrollRiskPermissions;
  adjustmentReason?: string;
};

const actionLabels: Record<PayrollRiskAction, string> = {
  generate_draft: "產生薪資草稿",
  lock_payroll: "鎖定薪資",
  publish_payslips: "發布薪資袋",
  export_bank_file: "匯出銀行轉帳檔",
  export_roster: "匯出薪資清冊",
  create_adjustment: "建立調整紀錄",
};

const actionPermissionKey: Record<PayrollRiskAction, keyof PayrollRiskPermissions> = {
  generate_draft: "canGenerateDraft",
  lock_payroll: "canLockPayroll",
  publish_payslips: "canPublishPayslips",
  export_bank_file: "canExportBankFile",
  export_roster: "canExportPayrollRoster",
  create_adjustment: "canCreateAdjustment",
};

function control(input: Omit<PayrollRiskControl, "severity"> & { severity?: PayrollRiskSeverity }): PayrollRiskControl {
  return {
    severity: "blocking",
    ...input,
  };
}

function moneyMismatch(drafts: PayrollDraft[]) {
  return drafts.filter((draft) => {
    const expectedGross = draft.baseSalary + draft.allowanceAmount + draft.overtimePay + draft.bonus;
    const expectedDeduction =
      draft.leaveDeduction +
      draft.lateDeduction +
      draft.laborInsuranceDeduction +
      draft.healthInsuranceDeduction +
      draft.incomeTax +
      draft.otherDeduction;
    const expectedNet = expectedGross - expectedDeduction;
    return draft.grossPay !== expectedGross || draft.deductionTotal !== expectedDeduction || draft.netPay !== expectedNet;
  });
}

export function evaluatePayrollRiskControls(input: PayrollRiskInput): PayrollRiskControl[] {
  const sourceBlockers = input.sourceChecks.filter((source) => !source.ready);
  const processBlockers = derivePayrollProcessBlockers(input.sourceChecks, input.drafts);
  const reviewDrafts = input.drafts.filter((draft) => draft.status === "需檢查" || draft.warnings.length > 0);
  const missingBankDrafts = input.drafts.filter((draft) => !draft.bankCode || !draft.bankAccount);
  const negativeNetDrafts = input.drafts.filter((draft) => draft.netPay < 0);
  const mismatchDrafts = moneyMismatch(input.drafts);

  const controls: PayrollRiskControl[] = [];

  (Object.keys(actionLabels) as PayrollRiskAction[]).forEach((action) => {
    const permissionKey = actionPermissionKey[action];
    controls.push(control({
      id: `${action}:permission`,
      action,
      title: `${actionLabels[action]}權限`,
      description: "薪資高敏感操作必須先確認角色權限，不能只靠按鈕顯示。",
      passed: input.permissions[permissionKey],
      evidence: input.permissions[permissionKey] ? "目前角色具備必要權限。" : "目前角色缺少必要權限。",
      remediation: "請由人資、行政部門主任或執行長至系統設定調整角色權限。",
    }));
  });

  (["generate_draft", "lock_payroll", "publish_payslips", "export_bank_file", "export_roster"] as PayrollRiskAction[]).forEach((action) => {
    const actionSourceBlockers = action === "generate_draft"
      ? sourceBlockers.filter((source) => source.name !== "薪資單草稿")
      : sourceBlockers;
    controls.push(control({
      id: `${action}:source-ready`,
      action,
      title: "薪資來源資料已清空阻擋",
      description: "班表、打卡、補卡、異常出勤、薪資項目與員工薪資主檔必須都能作為正式來源。",
      passed: actionSourceBlockers.length === 0,
      evidence: actionSourceBlockers.length ? actionSourceBlockers.map((source) => `${source.name}:${source.records}`).join("、") : "所有薪資來源已通過。",
      remediation: "先回出勤轉薪資、補卡、出勤異常或薪資設定頁補齊資料。",
    }));
    controls.push(control({
      id: `${action}:process-blockers`,
      action,
      title: "出勤、補卡、薪資阻擋關係已排除",
      description: "補卡未核准、出勤異常未結案、薪資草稿缺漏都會造成薪資錯誤。",
      passed: processBlockers.length === 0 || (action === "generate_draft" && processBlockers.every((blocker) => blocker.id === "source-薪資單草稿")),
      evidence: processBlockers.length ? processBlockers.map((blocker) => blocker.title).join("、") : "沒有流程阻擋。",
      remediation: "依阻擋卡片逐一處理，完成後重新同步薪資結算資料。",
    }));
  });

  (["lock_payroll", "publish_payslips", "export_bank_file", "export_roster"] as PayrollRiskAction[]).forEach((action) => {
    controls.push(control({
      id: `${action}:draft-exists`,
      action,
      title: "薪資草稿已產生",
      description: "沒有正式薪資草稿時，不得鎖定、發布或匯出。",
      passed: input.drafts.length > 0,
      evidence: `${input.drafts.length} 筆薪資草稿。`,
      remediation: "先由薪資主檔與出勤資料產生薪資草稿。",
    }));
    controls.push(control({
      id: `${action}:draft-review`,
      action,
      title: "薪資草稿無待檢查項",
      description: "所有需檢查與警示薪資草稿必須在人資/會計/主管確認後才可進入下一步。",
      passed: reviewDrafts.length === 0,
      evidence: reviewDrafts.length ? `${reviewDrafts.length} 筆需檢查。` : "沒有需檢查薪資草稿。",
      remediation: "請先完成草稿覆核、異常扣款與調整紀錄。",
    }));
    controls.push(control({
      id: `${action}:amount-integrity`,
      action,
      title: "薪資金額公式完整",
      description: "應發、扣款與實發金額必須可由明細回推，避免清冊與薪資袋不一致。",
      passed: mismatchDrafts.length === 0 && negativeNetDrafts.length === 0,
      evidence: mismatchDrafts.length || negativeNetDrafts.length ? `公式不一致 ${mismatchDrafts.length} 筆、實發負數 ${negativeNetDrafts.length} 筆。` : "薪資公式可回推且實發不為負。",
      remediation: "重新產生薪資草稿或檢查薪資項目設定。",
    }));
  });

  (["publish_payslips", "export_bank_file", "export_roster"] as PayrollRiskAction[]).forEach((action) => {
    controls.push(control({
      id: `${action}:locked`,
      action,
      title: "薪資已鎖定",
      description: "發布薪資袋與匯出正式檔案前，薪資批次必須鎖定。",
      passed: input.batch.locked,
      evidence: input.batch.locked ? `批次狀態：${input.batch.status}` : `批次狀態：${input.batch.status}，尚未鎖定。`,
      remediation: "完成人資、會計、主管確認後鎖定薪資。",
    }));
  });

  controls.push(control({
    id: "export_bank_file:bank-data",
    action: "export_bank_file",
    title: "銀行資料完整",
    description: "銀行轉帳檔不得在銀行代碼或帳號缺漏時產出。",
    passed: missingBankDrafts.length === 0 && input.drafts.length > 0,
    evidence: missingBankDrafts.length ? `${missingBankDrafts.length} 筆缺銀行資料。` : "銀行資料完整。",
    remediation: "回員工薪資設定補齊銀行代碼與銀行帳號。",
  }));

  controls.push(control({
    id: "publish_payslips:not-published",
    action: "publish_payslips",
    title: "避免重複發布",
    description: "薪資袋發布應避免重複通知與重複改狀態。",
    passed: !input.batch.published,
    evidence: input.batch.published ? "此批次已發布。" : "此批次尚未發布。",
    remediation: "若需更正已發布薪資，請建立調整紀錄，不要覆蓋原薪資。",
  }));

  controls.push(control({
    id: "create_adjustment:locked",
    action: "create_adjustment",
    title: "鎖定後才可建立調整",
    description: "薪資未鎖定前應直接回草稿修正；鎖定後才能用調整紀錄保留稽核軌跡。",
    passed: input.batch.locked,
    evidence: input.batch.locked ? "薪資已鎖定，可建立調整紀錄。" : "薪資尚未鎖定。",
    remediation: "未鎖定前請回薪資草稿修正，鎖定後才建立調整。",
  }));

  controls.push(control({
    id: "create_adjustment:reason",
    action: "create_adjustment",
    title: "調整原因完整",
    description: "調整紀錄必須有原因，且可追溯到補卡、加班、扣款或人工覆核依據。",
    passed: Boolean(input.adjustmentReason?.trim()) || !input.batch.locked,
    evidence: input.adjustmentReason?.trim() ? "已填調整原因。" : "尚未填調整原因。",
    remediation: "請填寫調整原因與依據，不得空白建立。",
  }));

  return controls;
}

export function summarizePayrollRiskControls(controls: PayrollRiskControl[]) {
  const failed = controls.filter((control) => !control.passed);
  return {
    total: controls.length,
    passed: controls.length - failed.length,
    failed: failed.length,
    blockingFailed: failed.filter((control) => control.severity === "blocking").length,
    warningFailed: failed.filter((control) => control.severity === "warning").length,
  };
}

export function canRunPayrollRiskAction(action: PayrollRiskAction, controls: PayrollRiskControl[]) {
  return controls.every((control) => control.action !== action || control.passed || control.severity !== "blocking");
}
