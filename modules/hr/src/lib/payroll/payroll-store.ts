import {
  CalendarDays,
  Clock3,
  FileClock,
  FileText,
  HandCoins,
  ReceiptText,
  ShieldAlert,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { emitNotificationEvent } from "@/lib/notifications/notification-events";
import { getCurrentAppUser, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

export type DraftStatus = "待產生" | "草稿" | "需檢查" | "已鎖定";
export type BatchStatus = "草稿" | "人資檢查" | "會計檢查" | "主管確認" | "已鎖定" | "已發布";

export type PayrollDraft = {
  id: string;
  company: string;
  employeeNo: string;
  employeeUserId: string;
  employeeName: string;
  department: string;
  branch: string;
  month: string;
  scheduledHours: number;
  actualPunchHours: number;
  leaveHours: number;
  overtimeHours: number;
  correctionHours: number;
  anomalyCount: number;
  baseSalary: number;
  allowanceAmount: number;
  overtimePay: number;
  bonus: number;
  leaveDeduction: number;
  lateDeduction: number;
  laborInsuranceDeduction: number;
  healthInsuranceDeduction: number;
  incomeTax: number;
  otherDeduction: number;
  employerContribution: number;
  grossPay: number;
  deductionTotal: number;
  netPay: number;
  bankCode: string;
  bankAccount: string;
  paymentDate: string;
  status: DraftStatus;
  warnings: string[];
};

export type SourceCheck = {
  name: string;
  description: string;
  records: number;
  ready: boolean;
  icon: LucideIcon;
};

export type PayrollBlockerStage = "attendance" | "punch_correction" | "payroll";

export type PayrollProcessBlocker = {
  id: string;
  stage: PayrollBlockerStage;
  title: string;
  description: string;
  count: number;
  severity: "blocking" | "warning";
  blocks: string;
  actionLabel: string;
  href: string;
};

export type PayrollBatch = {
  id: string;
  month: string;
  company: string;
  employees: number;
  grossPay: number;
  deductions: number;
  employerCost: number;
  netPay: number;
  needsReview: number;
  status: BatchStatus;
  locked: boolean;
  published: boolean;
  updatedAt: string;
};

export type PayrollRosterRow = {
  month: string;
  company: string;
  employeeNo: string;
  employeeUserId: string;
  name: string;
  department: string;
  branch: string;
  bankCode: string;
  bankAccount: string;
  baseSalary: number;
  allowances: number;
  overtimePay: number;
  bonus: number;
  grossPay: number;
  laborInsuranceDeduction: number;
  healthInsuranceDeduction: number;
  incomeTax: number;
  otherDeductions: number;
  employerContribution: number;
  netPay: number;
  paymentDate: string;
  status: DraftStatus;
};

export type PayrollAdjustmentRecord = {
  id: string;
  employee: string;
  item: string;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

type PayrollItemRow = {
  item_type: string | null;
  item_code: string | null;
  item_name: string | null;
  amount: number | string | null;
};

type PayrollJsonItem = {
  type?: string | null;
  code?: string | null;
  name?: string | null;
  item_type?: string | null;
  item_code?: string | null;
  item_name?: string | null;
  amount?: number | string | null;
};

type PayrollPayslipRow = {
  id: string;
  payroll_record_id: string;
  payroll_month: string;
  payment_date: string | null;
  bank_account_last_five: string | null;
  gross_pay_total: number | string | null;
  deduction_total: number | string | null;
  employer_cost_total: number | string | null;
  net_pay_total: number | string | null;
  items: PayrollJsonItem[] | null;
  status: string | null;
  remark: string | null;
  employees: {
    employee_no: string | null;
    full_name: string | null;
    primary_branch_id: string | null;
    primary_department_id: string | null;
    branches: { name: string | null } | null;
    departments: { name: string | null } | null;
  } | null;
  companies: { name: string | null } | null;
  payroll_items: PayrollItemRow[] | null;
};

type PayrollRecordRow = {
  id: string;
  payroll_month: string;
  status: string | null;
  blocking_status: string | null;
  gross_pay_total: number | string | null;
  deduction_total: number | string | null;
  employer_cost_total: number | string | null;
  net_pay_total: number | string | null;
  updated_at: string | null;
  branches: { name: string | null } | null;
};

type PayrollAdjustmentAuditRow = {
  id: string;
  action: string | null;
  after_data: {
    employee?: string;
    item?: string;
    amount?: number;
    reason?: string;
    payrollMonth?: string;
  } | null;
  created_at: string | null;
  users: { display_name: string | null } | null;
};

type EmployeePayrollSettingRow = {
  id: string;
  company_id: string;
  employee_id: string;
  salary_type: string;
  base_salary: number | string | null;
  meal_allowance: number | string | null;
  position_allowance: number | string | null;
  license_allowance: number | string | null;
  transportation_allowance: number | string | null;
  attendance_bonus: number | string | null;
  supervisor_allowance: number | string | null;
  labor_insurance_grade: number | string | null;
  health_insurance_grade: number | string | null;
  labor_pension_rate: number | string | null;
  tax_setting: string | null;
  supplementary_nhi_setting: string | null;
  bank_code: string | null;
  bank_account_last_five: string | null;
  employees: {
    id: string;
    company_id: string;
    primary_branch_id: string | null;
    primary_department_id: string | null;
    employee_no: string | null;
    full_name: string | null;
    employment_status: string | null;
    branches: { name: string | null } | null;
    departments: { name: string | null } | null;
  } | null;
};

type PayrollRecordForGeneration = {
  id: string;
  company_id: string;
  branch_id: string | null;
  payroll_month: string;
};

type PayrollSourceCountQuery = PromiseLike<{ count: number | null; error: Error | null }> & {
  eq: (column: string, value: unknown) => PayrollSourceCountQuery;
  gte: (column: string, value: unknown) => PayrollSourceCountQuery;
  lt: (column: string, value: unknown) => PayrollSourceCountQuery;
  in: (column: string, values: unknown[]) => PayrollSourceCountQuery;
  is: (column: string, value: unknown) => PayrollSourceCountQuery;
};

function nowText() {
  return new Date().toLocaleString("zh-TW", { hour12: false });
}

export function recalculatePayrollDraft(draft: PayrollDraft): PayrollDraft {
  const overtimePay = draft.overtimeHours * 520;
  const leaveDeduction = draft.leaveHours * 220;
  const lateDeduction = draft.anomalyCount * 150;
  const grossPay = draft.baseSalary + draft.allowanceAmount + overtimePay + draft.bonus;
  const deductionTotal =
    leaveDeduction +
    lateDeduction +
    draft.laborInsuranceDeduction +
    draft.healthInsuranceDeduction +
    draft.incomeTax +
    draft.otherDeduction;
  const warnings = draft.anomalyCount > 0 ? draft.warnings.length ? draft.warnings : ["出勤異常需人資確認"] : [];

  return {
    ...draft,
    overtimePay,
    leaveDeduction,
    lateDeduction,
    grossPay,
    deductionTotal,
    netPay: grossPay - deductionTotal,
    status: draft.anomalyCount > 0 ? "需檢查" : "草稿",
    warnings,
  };
}

export function derivePayrollBatch(month: string, drafts: PayrollDraft[], existing?: PayrollBatch): PayrollBatch {
  const monthDrafts = drafts.filter((draft) => draft.month === month);
  const needsReview = monthDrafts.filter((draft) => draft.status === "需檢查").length;
  return {
    id: `PB-${month.replace("-", "")}`,
    month,
    company: "歲悅長照股份有限公司",
    employees: monthDrafts.length,
    grossPay: monthDrafts.reduce((sum, draft) => sum + draft.grossPay, 0),
    deductions: monthDrafts.reduce((sum, draft) => sum + draft.deductionTotal, 0),
    employerCost: monthDrafts.reduce((sum, draft) => sum + draft.employerContribution, 0),
    netPay: monthDrafts.reduce((sum, draft) => sum + draft.netPay, 0),
    needsReview,
    status: existing?.status ?? (needsReview > 0 ? "人資檢查" : "草稿"),
    locked: existing?.locked ?? false,
    published: existing?.published ?? false,
    updatedAt: nowText(),
  };
}

export function toPayrollRosterRows(drafts: PayrollDraft[]): PayrollRosterRow[] {
  return drafts.map((draft) => ({
    month: draft.month,
    company: draft.company,
    employeeNo: draft.employeeNo,
    employeeUserId: draft.employeeUserId,
    name: draft.employeeName,
    department: draft.department,
    branch: draft.branch,
    bankCode: draft.bankCode,
    bankAccount: draft.bankAccount,
    baseSalary: draft.baseSalary,
    allowances: draft.allowanceAmount,
    overtimePay: draft.overtimePay,
    bonus: draft.bonus,
    grossPay: draft.grossPay,
    laborInsuranceDeduction: draft.laborInsuranceDeduction,
    healthInsuranceDeduction: draft.healthInsuranceDeduction,
    incomeTax: draft.incomeTax,
    otherDeductions: draft.leaveDeduction + draft.lateDeduction + draft.otherDeduction,
    employerContribution: draft.employerContribution,
    netPay: draft.netPay,
    paymentDate: draft.paymentDate,
    status: draft.status,
  }));
}

export function derivePayrollProcessBlockers(
  sourceChecks: SourceCheck[],
  drafts: PayrollDraft[] = [],
): PayrollProcessBlocker[] {
  const sourceByName = new Map(sourceChecks.map((source) => [source.name, source]));
  const blockers: PayrollProcessBlocker[] = [];
  const addSourceBlocker = (
    sourceName: string,
    blocker: Omit<PayrollProcessBlocker, "id" | "count"> & { count?: number },
  ) => {
    const source = sourceByName.get(sourceName);
    if (!source || source.ready) return;
    blockers.push({
      id: `source-${sourceName}`,
      count: blocker.count ?? source.records,
      ...blocker,
    });
  };

  addSourceBlocker("班表", {
    stage: "attendance",
    title: "班表尚未完整",
    description: "缺少月排班或服務時段，無法判斷應出勤、遲到早退與工時差異。",
    severity: "blocking",
    blocks: "阻擋出勤結算與薪資草稿",
    actionLabel: "檢查排班月曆",
    href: "/attendance/schedules",
  });
  addSourceBlocker("實際打卡", {
    stage: "attendance",
    title: "實際打卡尚未同步",
    description: "缺少上班、下班、外出或返回打卡紀錄，無法產生可結薪的實際工時。",
    severity: "blocking",
    blocks: "阻擋出勤轉薪資",
    actionLabel: "查看員工打卡",
    href: "/clock",
  });
  addSourceBlocker("補卡紀錄", {
    stage: "punch_correction",
    title: "補卡未核准或未回寫",
    description: "仍有補卡流程未完成，出勤異常不能被沖正，薪資扣款可能不正確。",
    severity: "blocking",
    blocks: "阻擋出勤確認與薪資鎖定",
    actionLabel: "處理補卡",
    href: "/punch-corrections",
  });
  addSourceBlocker("異常出勤", {
    stage: "attendance",
    title: "出勤異常未結案",
    description: "遲到、早退、未打卡、GPS/IP 異常或非排班日打卡尚未審核。",
    severity: "blocking",
    blocks: "阻擋薪資草稿確認",
    actionLabel: "審核出勤異常",
    href: "/attendance/anomalies",
  });
  addSourceBlocker("薪資單草稿", {
    stage: "payroll",
    title: "薪資草稿尚未建立",
    description: "還沒有 payroll_payslips 正式草稿，無法進入人資、會計與主管確認。",
    severity: "blocking",
    blocks: "阻擋薪資結算流程",
    actionLabel: "建立薪資草稿",
    href: "/payroll/closing",
  });
  addSourceBlocker("薪資項目", {
    stage: "payroll",
    title: "薪資項目未設定",
    description: "應發、應扣、公司負擔與員工自付項目不足，無法產生可信薪資明細。",
    severity: "blocking",
    blocks: "阻擋薪資草稿與清冊",
    actionLabel: "設定薪資項目",
    href: "/payroll/items",
  });
  addSourceBlocker("員工薪資主檔", {
    stage: "payroll",
    title: "員工薪資主檔未設定",
    description: "缺少員工本薪、津貼、投保級距、勞退比例、稅務與匯款帳號，無法產生可結薪資料。",
    severity: "blocking",
    blocks: "阻擋薪資草稿與扣繳資料",
    actionLabel: "設定員工薪資",
    href: "/payroll/employee-settings",
  });

  const reviewDrafts = drafts.filter((draft) => draft.status === "需檢查");
  if (reviewDrafts.length) {
    blockers.push({
      id: "draft-review",
      stage: "payroll",
      title: "薪資草稿需人資複核",
      description: "部分員工的薪資草稿包含異常、備註或審核狀態，需確認後才能鎖定。",
      count: reviewDrafts.length,
      severity: "blocking",
      blocks: "阻擋薪資鎖定與發布",
      actionLabel: "回出勤轉薪資",
      href: "/payroll/attendance-calculation",
    });
  }

  return blockers;
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function itemAmount(items: PayrollItemRow[], matcher: (item: PayrollItemRow) => boolean) {
  return items.filter(matcher).reduce((sum, item) => sum + toNumber(item.amount), 0);
}

function normalizePayslipItems(row: PayrollPayslipRow): PayrollItemRow[] {
  if (row.payroll_items?.length) return row.payroll_items;

  return (row.items ?? [])
    .map((item) => {
      const itemName = item.item_name ?? item.name ?? null;
      const itemCode = item.item_code ?? item.code ?? inferPayrollItemCode(itemName);
      return {
        item_type: item.item_type ?? item.type ?? inferPayrollItemType(itemCode, itemName),
        item_code: itemCode,
        item_name: itemName,
        amount: item.amount ?? 0,
      };
    })
    .filter((item) => item.item_name || item.item_code);
}

function inferPayrollItemCode(name: string | null) {
  if (name === "本薪") return "BASE";
  if (name === "加班費") return "OT";
  if (name === "勞保自付") return "LABOR_SELF";
  if (name === "健保自付") return "NHI_SELF";
  if (name === "所得稅") return "INCOME_TAX";
  if (name === "勞退公司提繳") return "PENSION_COMPANY";
  if (name?.includes("請假")) return "LEAVE_DEDUCT";
  if (name?.includes("遲到")) return "LATE_DEDUCT";
  return null;
}

function inferPayrollItemType(code: string | null, name: string | null) {
  if (code === "PENSION_COMPANY" || name === "勞退公司提繳") return "employer_cost";
  if (["LABOR_SELF", "NHI_SELF", "INCOME_TAX", "LEAVE_DEDUCT", "LATE_DEDUCT"].includes(code ?? "")) return "deduction";
  if (name?.includes("扣") || name?.includes("自付") || name === "所得稅") return "deduction";
  return "earning";
}

function statusToDraftStatus(status: string | null | undefined): DraftStatus {
  if (status === "reviewing") return "需檢查";
  if (status === "released") return "已鎖定";
  if (status === "void") return "需檢查";
  return "草稿";
}

function payrollStatusToBatchStatus(status: string | null | undefined): BatchStatus {
  if (status === "paid") return "已發布";
  if (status === "approved") return "已鎖定";
  if (status === "reviewing") return "人資檢查";
  if (status === "calculating") return "人資檢查";
  return "草稿";
}

function monthToPayrollDate(month: string) {
  return `${month}-01`;
}

function monthRange(month: string) {
  const monthStart = monthToPayrollDate(month);
  const nextMonth = new Date(`${monthStart}T00:00:00+08:00`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
  return { monthStart, nextMonthDate };
}

function previousMonthEnd(month: string) {
  const date = new Date(`${monthToPayrollDate(month)}T00:00:00+08:00`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function salaryTypeLabel(value: string | null | undefined) {
  if (value === "hourly") return "時薪";
  if (value === "daily") return "日薪";
  if (value === "piece_rate") return "件計";
  return "月薪";
}

function buildPayrollItems(input: {
  payrollRecordId: string;
  payslipId: string;
  employeeId: string;
  setting: EmployeePayrollSettingRow;
  baseSalary: number;
  mealAllowance: number;
  positionAllowance: number;
  licenseAllowance: number;
  transportationAllowance: number;
  attendanceBonus: number;
  supervisorAllowance: number;
  employerPension: number;
}) {
  const rows = [
    ["earning", "BASE", "本薪", input.baseSalary, true],
    ["earning", "MEAL_ALLOWANCE", "伙食津貼", input.mealAllowance, true],
    ["earning", "POSITION_ALLOWANCE", "職務津貼", input.positionAllowance, true],
    ["earning", "LICENSE_ALLOWANCE", "證照津貼", input.licenseAllowance, true],
    ["earning", "TRANSPORTATION_ALLOWANCE", "交通津貼", input.transportationAllowance, true],
    ["earning", "ATTENDANCE_BONUS", "全勤獎金", input.attendanceBonus, true],
    ["earning", "SUPERVISOR_ALLOWANCE", "主管加給", input.supervisorAllowance, true],
    ["employer_cost", "PENSION_COMPANY", "勞退公司提繳", input.employerPension, false],
  ] as const;

  return rows
    .filter(([, , , amount]) => amount > 0)
    .map(([itemType, itemCode, itemName, amount, taxable]) => ({
      payroll_record_id: input.payrollRecordId,
      payroll_payslip_id: input.payslipId,
      employee_id: input.employeeId,
      item_type: itemType,
      item_code: itemCode,
      item_name: itemName,
      quantity: 1,
      unit_amount: amount,
      amount,
      taxable,
      metadata: {
        source: "employee_payroll_settings",
        salary_type: salaryTypeLabel(input.setting.salary_type),
        generated_at: new Date().toISOString(),
      },
    }));
}

function mapPayslipToDraft(row: PayrollPayslipRow): PayrollDraft {
  const items = normalizePayslipItems(row);
  const grossPay = toNumber(row.gross_pay_total);
  const deductionTotal = toNumber(row.deduction_total);
  const laborInsuranceDeduction = Math.abs(itemAmount(items, (item) => ["LABOR_INS", "LABOR_SELF"].includes(item.item_code ?? "") || item.item_name === "勞保自付"));
  const healthInsuranceDeduction = Math.abs(itemAmount(items, (item) => ["HEALTH_INS", "NHI_SELF"].includes(item.item_code ?? "") || item.item_name === "健保自付"));
  const incomeTax = Math.abs(itemAmount(items, (item) => item.item_code === "INCOME_TAX" || item.item_name === "所得稅"));
  const leaveDeduction = Math.abs(itemAmount(items, (item) => ["LEAVE_DEDUCTION", "LEAVE_DEDUCT"].includes(item.item_code ?? "") || item.item_name?.includes("請假") === true));
  const lateDeduction = Math.abs(itemAmount(items, (item) => ["LATE_DEDUCTION", "LATE_DEDUCT"].includes(item.item_code ?? "") || item.item_name?.includes("遲到") === true));
  const knownDeductions = laborInsuranceDeduction + healthInsuranceDeduction + incomeTax + leaveDeduction + lateDeduction;
  const baseSalary = itemAmount(items, (item) => item.item_code === "BASE" || item.item_name === "本薪");
  const overtimePay = itemAmount(items, (item) => item.item_code === "OT" || item.item_name === "加班費");
  const bonus = itemAmount(items, (item) => item.item_name?.includes("獎金") === true || item.item_name === "全勤");
  const allowanceAmount = itemAmount(items, (item) => item.item_type === "earning") - baseSalary - overtimePay - bonus;
  const status = statusToDraftStatus(row.status);

  return {
    id: row.id,
    company: row.companies?.name ?? "未設定公司",
    employeeNo: row.employees?.employee_no ?? "未設定",
    employeeUserId: row.employees?.employee_no ?? row.id,
    employeeName: row.employees?.full_name ?? "未命名員工",
    department: row.employees?.departments?.name ?? "未設定部門",
    branch: row.employees?.branches?.name ?? "未設定據點",
    month: String(row.payroll_month).slice(0, 7),
    scheduledHours: 0,
    actualPunchHours: 0,
    leaveHours: 0,
    overtimeHours: 0,
    correctionHours: 0,
    anomalyCount: status === "需檢查" ? 1 : 0,
    baseSalary,
    allowanceAmount: Math.max(allowanceAmount, 0),
    overtimePay,
    bonus,
    leaveDeduction,
    lateDeduction,
    laborInsuranceDeduction,
    healthInsuranceDeduction,
    incomeTax,
    otherDeduction: Math.max(deductionTotal - knownDeductions, 0),
    employerContribution: toNumber(row.employer_cost_total),
    grossPay,
    deductionTotal,
    netPay: toNumber(row.net_pay_total),
    bankCode: "未設定",
    bankAccount: row.bank_account_last_five ? `*****${row.bank_account_last_five}` : "未設定",
    paymentDate: row.payment_date ?? "",
    status,
    warnings: status === "需檢查" ? [row.remark ?? "薪資單仍在覆核狀態，需人資確認。"] : [],
  };
}

export async function loadLivePayrollDrafts(month?: string) {
  const supabase = getLiveClient();
  let query = supabase
    .from("payroll_payslips")
    .select(`
      id,
      payroll_record_id,
      payroll_month,
      payment_date,
      bank_account_last_five,
      gross_pay_total,
      deduction_total,
      employer_cost_total,
      net_pay_total,
      items,
      status,
      remark,
      companies(name),
      employees(employee_no, full_name, primary_branch_id, primary_department_id, branches(name), departments(name)),
      payroll_items(item_type, item_code, item_name, amount)
    `)
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });

  if (month) query = query.eq("payroll_month", monthToPayrollDate(month));

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as PayrollPayslipRow[]).map(mapPayslipToDraft);
}

export async function loadLivePayrollBatches() {
  const supabase = getLiveClient();
  const { data, error } = await supabase
    .from("payroll_records")
    .select("id, payroll_month, status, blocking_status, gross_pay_total, deduction_total, employer_cost_total, net_pay_total, updated_at, branches(name)")
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as PayrollRecordRow[];
  const batches: Record<string, PayrollBatch> = {};
  rows.forEach((row) => {
    const month = String(row.payroll_month).slice(0, 7);
    const isBlocked = row.blocking_status === "blocked";
    const status = isBlocked ? "人資檢查" : payrollStatusToBatchStatus(row.status);
    batches[month] = {
      id: row.id,
      month,
      company: "歲悅長照股份有限公司",
      employees: batches[month]?.employees ?? 0,
      grossPay: (batches[month]?.grossPay ?? 0) + toNumber(row.gross_pay_total),
      deductions: (batches[month]?.deductions ?? 0) + toNumber(row.deduction_total),
      employerCost: (batches[month]?.employerCost ?? 0) + toNumber(row.employer_cost_total),
      netPay: (batches[month]?.netPay ?? 0) + toNumber(row.net_pay_total),
      needsReview: status === "人資檢查" ? (batches[month]?.needsReview ?? 0) + 1 : (batches[month]?.needsReview ?? 0),
      status,
      locked: !isBlocked && (status === "已鎖定" || status === "已發布"),
      published: status === "已發布",
      updatedAt: row.updated_at ? new Date(row.updated_at).toLocaleString("zh-TW", { hour12: false }) : nowText(),
    };
  });
  return batches;
}

export async function loadLivePayrollWorkspace(month: string) {
  const [drafts, batches, sourceChecks, adjustments] = await Promise.all([
    loadLivePayrollDrafts(month),
    loadLivePayrollBatches(),
    loadLivePayrollSourceChecks(month),
    loadLivePayrollAdjustments(month),
  ]);

  const liveBatch = batches[month] ?? derivePayrollBatch(month, drafts);
  return {
    drafts,
    sourceChecks,
    adjustments,
    batch: {
      ...liveBatch,
      employees: drafts.length || liveBatch.employees,
      needsReview: drafts.filter((draft) => draft.status === "需檢查").length || liveBatch.needsReview,
    },
  };
}

export async function loadLivePayrollSourceChecks(month: string): Promise<SourceCheck[]> {
  const supabase = getLiveClient();
  const { monthStart, nextMonthDate } = monthRange(month);

  async function count(table: string, configure?: (query: PayrollSourceCountQuery) => PayrollSourceCountQuery) {
    const base = supabase.from(table).select("id", { count: "exact", head: true }).is("deleted_at", null) as PayrollSourceCountQuery;
    const query = configure ? configure(base) : base;
    const { count: rowCount, error } = await query;
    if (error) throw error;
    return rowCount ?? 0;
  }

  const [schedules, punches, leaves, overtime, corrections, anomalies, payslips, itemSettings, employeePayrollSettings] = await Promise.all([
    count("schedules", (query) => query.gte("work_date", monthStart).lt("work_date", nextMonthDate)),
    count("attendance_punches", (query) => query.gte("punched_at", `${monthStart}T00:00:00+08:00`).lt("punched_at", `${nextMonthDate}T00:00:00+08:00`)),
    count("leave_requests", (query) => query.gte("starts_at", `${monthStart}T00:00:00+08:00`).lt("starts_at", `${nextMonthDate}T00:00:00+08:00`)),
    count("overtime_requests", (query) => query.gte("work_date", monthStart).lt("work_date", nextMonthDate)),
    count("punch_correction_requests", (query) => query.gte("work_date", monthStart).lt("work_date", nextMonthDate).eq("status", "approved")),
    count("attendance_punches", (query) => query.gte("punched_at", `${monthStart}T00:00:00+08:00`).lt("punched_at", `${nextMonthDate}T00:00:00+08:00`).eq("is_abnormal", true).in("review_status", ["none", "pending"])),
    count("payroll_payslips", (query) => query.eq("payroll_month", monthStart)),
    count("payroll_item_settings", (query) => query.eq("is_active", true)),
    count("employee_payroll_settings", (query) => query.eq("status", "active")),
  ]);

  return [
    { name: "班表", description: "讀取員工月排班與服務時段", records: schedules, ready: schedules > 0, icon: CalendarDays },
    { name: "實際打卡", description: "彙整上班、下班、外出、返回打卡", records: punches, ready: punches > 0, icon: Clock3 },
    { name: "請假紀錄", description: "套用假別、支薪比例與扣薪規則", records: leaves, ready: true, icon: FileText },
    { name: "加班紀錄", description: "核准後加班費或補休轉換", records: overtime, ready: true, icon: HandCoins },
    { name: "補卡紀錄", description: "核准補卡後回寫出勤時數", records: corrections, ready: anomalies === 0, icon: FileClock },
    { name: "異常出勤", description: "遲到、早退、未打卡、GPS 異常", records: anomalies, ready: anomalies === 0, icon: ShieldAlert },
    { name: "薪資單草稿", description: "讀取 payroll_payslips 正式草稿", records: payslips, ready: payslips > 0, icon: WalletCards },
    { name: "薪資項目", description: "讀取 payroll_item_settings 應發應扣設定主檔", records: itemSettings, ready: itemSettings > 0, icon: ReceiptText },
    { name: "員工薪資主檔", description: "讀取 employee_payroll_settings 本薪、津貼、稅務與銀行帳號", records: employeePayrollSettings, ready: employeePayrollSettings > 0, icon: HandCoins },
  ];
}

export async function moveLivePayrollBatchToReview(month: string) {
  const supabase = getLiveClient();
  const { monthStart } = monthRange(month);
  const { error } = await supabase
    .from("payroll_records")
    .update({ status: "reviewing", updated_at: new Date().toISOString() })
    .eq("payroll_month", monthStart)
    .is("deleted_at", null)
    .in("status", ["draft", "calculating", "reviewing"]);
  if (error) throw error;
  await writeAuditLog({
    action: "payroll.batch.reviewing",
    resourceType: "payroll_records",
    resourceId: month,
    afterData: { payrollMonth: month, status: "reviewing" },
  });
}

export async function generateLivePayrollDrafts(month: string) {
  const supabase = getLiveClient();
  const user = await getCurrentAppUser();
  if (!user.company_id) throw new Error("目前登入者沒有公司資料，無法產生薪資草稿。");

  const { monthStart } = monthRange(month);
  const periodEnd = previousMonthEnd(month);
  const paymentDate = `${month}-10`;

  const { data: settingsData, error: settingsError } = await supabase
    .from("employee_payroll_settings")
    .select(`
      id,
      company_id,
      employee_id,
      salary_type,
      base_salary,
      meal_allowance,
      position_allowance,
      license_allowance,
      transportation_allowance,
      attendance_bonus,
      supervisor_allowance,
      labor_insurance_grade,
      health_insurance_grade,
      labor_pension_rate,
      tax_setting,
      supplementary_nhi_setting,
      bank_code,
      bank_account_last_five,
      employees(
        id,
        company_id,
        primary_branch_id,
        primary_department_id,
        employee_no,
        full_name,
        employment_status,
        branches(name),
        departments(name)
      )
    `)
    .eq("company_id", user.company_id)
    .eq("status", "active")
    .is("deleted_at", null);
  if (settingsError) throw settingsError;

  const settings = ((settingsData ?? []) as EmployeePayrollSettingRow[])
    .filter((setting) => setting.employees?.employment_status === "active");
  if (!settings.length) {
    throw new Error("尚未建立啟用中的員工薪資主檔，無法產生薪資草稿。");
  }

  const missingBankSettings = settings.filter((setting) => !setting.bank_account_last_five);
  if (missingBankSettings.length) {
    const names = missingBankSettings
      .map((setting) => setting.employees?.full_name ?? setting.employees?.employee_no ?? "未命名員工")
      .slice(0, 5)
      .join("、");
    throw new Error(`有 ${missingBankSettings.length} 位員工缺少銀行帳號末五碼，請先完成員工薪資主檔：${names}`);
  }

  const recordInputs = Array.from(new Set(settings.map((setting) => setting.employees?.primary_branch_id ?? "NO_BRANCH")))
    .map((branchKey) => ({
      company_id: user.company_id,
      branch_id: branchKey === "NO_BRANCH" ? null : branchKey,
      payroll_month: monthStart,
      period_start: monthStart,
      period_end: periodEnd,
      status: "calculating",
      gross_pay_total: 0,
      deduction_total: 0,
      employer_cost_total: 0,
      net_pay_total: 0,
    }));

  const { error: recordUpsertError } = await supabase
    .from("payroll_records")
    .upsert(recordInputs, { onConflict: "company_id,branch_id,payroll_month" });
  if (recordUpsertError) throw recordUpsertError;

  const { data: recordsData, error: recordsError } = await supabase
    .from("payroll_records")
    .select("id, company_id, branch_id, payroll_month")
    .eq("company_id", user.company_id)
    .eq("payroll_month", monthStart)
    .is("deleted_at", null);
  if (recordsError) throw recordsError;

  const records = (recordsData ?? []) as PayrollRecordForGeneration[];
  const recordByBranch = new Map(records.map((record) => [record.branch_id ?? "NO_BRANCH", record]));

  const payslipInputs = settings.map((setting) => {
    const employee = setting.employees;
    const branchKey = employee?.primary_branch_id ?? "NO_BRANCH";
    const record = recordByBranch.get(branchKey);
    if (!record || !employee?.id) throw new Error(`找不到 ${employee?.full_name ?? "員工"} 的薪資批次。`);

    const baseSalary = toNumber(setting.base_salary);
    const mealAllowance = toNumber(setting.meal_allowance);
    const positionAllowance = toNumber(setting.position_allowance);
    const licenseAllowance = toNumber(setting.license_allowance);
    const transportationAllowance = toNumber(setting.transportation_allowance);
    const attendanceBonus = toNumber(setting.attendance_bonus);
    const supervisorAllowance = toNumber(setting.supervisor_allowance);
    const grossPay = baseSalary + mealAllowance + positionAllowance + licenseAllowance + transportationAllowance + attendanceBonus + supervisorAllowance;
    const employerPension = Math.round(baseSalary * toNumber(setting.labor_pension_rate) / 100);

    return {
      payroll_record_id: record.id,
      company_id: user.company_id,
      branch_id: employee.primary_branch_id,
      employee_id: employee.id,
      payroll_month: monthStart,
      payment_date: paymentDate,
      bank_account_last_five: setting.bank_account_last_five,
      gross_pay_total: grossPay,
      deduction_total: 0,
      employer_cost_total: employerPension,
      net_pay_total: grossPay,
      remark: "由員工薪資主檔產生草稿；請於出勤轉薪資補入加班、請假、扣款與法定保費。",
      status: "draft",
      released_at: null,
      released_by: null,
    };
  });

  const { error: payslipUpsertError } = await supabase
    .from("payroll_payslips")
    .upsert(payslipInputs, { onConflict: "employee_id,payroll_month" });
  if (payslipUpsertError) throw payslipUpsertError;

  const { data: payslipsData, error: payslipsError } = await supabase
    .from("payroll_payslips")
    .select("id, payroll_record_id, employee_id")
    .eq("payroll_month", monthStart)
    .eq("company_id", user.company_id)
    .is("deleted_at", null);
  if (payslipsError) throw payslipsError;

  const payslipRows = (payslipsData ?? []) as Array<{ id: string; payroll_record_id: string; employee_id: string }>;
  const payslipIds = payslipRows.map((row) => row.id);
  if (payslipIds.length) {
    const { error: deleteItemError } = await supabase
      .from("payroll_items")
      .delete()
      .in("payroll_payslip_id", payslipIds);
    if (deleteItemError) throw deleteItemError;
  }

  const settingByEmployee = new Map(settings.map((setting) => [setting.employee_id, setting]));
  const itemInputs = payslipRows.flatMap((payslip) => {
    const setting = settingByEmployee.get(payslip.employee_id);
    if (!setting) return [];
    const baseSalary = toNumber(setting.base_salary);
    const mealAllowance = toNumber(setting.meal_allowance);
    const positionAllowance = toNumber(setting.position_allowance);
    const licenseAllowance = toNumber(setting.license_allowance);
    const transportationAllowance = toNumber(setting.transportation_allowance);
    const attendanceBonus = toNumber(setting.attendance_bonus);
    const supervisorAllowance = toNumber(setting.supervisor_allowance);
    return buildPayrollItems({
      payrollRecordId: payslip.payroll_record_id,
      payslipId: payslip.id,
      employeeId: payslip.employee_id,
      setting,
      baseSalary,
      mealAllowance,
      positionAllowance,
      licenseAllowance,
      transportationAllowance,
      attendanceBonus,
      supervisorAllowance,
      employerPension: Math.round(baseSalary * toNumber(setting.labor_pension_rate) / 100),
    });
  });

  if (itemInputs.length) {
    const { error: insertItemsError } = await supabase.from("payroll_items").insert(itemInputs);
    if (insertItemsError) throw insertItemsError;
  }

  for (const record of records) {
    const related = payslipInputs.filter((payslip) => payslip.payroll_record_id === record.id);
    const { error: updateRecordError } = await supabase
      .from("payroll_records")
      .update({
        status: "draft",
        gross_pay_total: related.reduce((sum, payslip) => sum + payslip.gross_pay_total, 0),
        deduction_total: related.reduce((sum, payslip) => sum + payslip.deduction_total, 0),
        employer_cost_total: related.reduce((sum, payslip) => sum + payslip.employer_cost_total, 0),
        net_pay_total: related.reduce((sum, payslip) => sum + payslip.net_pay_total, 0),
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    if (updateRecordError) throw updateRecordError;
  }

  await writeAuditLog({
    action: "payroll.drafts.generate",
    resourceType: "payroll_records",
    resourceId: month,
    afterData: {
      payrollMonth: month,
      employees: settings.length,
      records: records.length,
      items: itemInputs.length,
      generatedBy: user.id,
    },
  });

  return { employees: settings.length, records: records.length, items: itemInputs.length };
}

export async function lockLivePayrollBatch(month: string) {
  const supabase = getLiveClient();
  const user = await getCurrentAppUser();
  const { monthStart } = monthRange(month);
  const { error } = await supabase
    .from("payroll_records")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("payroll_month", monthStart)
    .is("deleted_at", null)
    .in("status", ["draft", "calculating", "reviewing", "approved"]);
  if (error) throw error;
  await writeAuditLog({
    action: "payroll.batch.lock",
    resourceType: "payroll_records",
    resourceId: month,
    afterData: { payrollMonth: month, status: "approved", lockedBy: user.id },
  });
}

export async function releaseLivePayslips(month: string) {
  const supabase = getLiveClient();
  const user = await getCurrentAppUser();
  const { monthStart } = monthRange(month);

  const { error: recordError } = await supabase
    .from("payroll_records")
    .update({
      status: "paid",
      updated_at: new Date().toISOString(),
    })
    .eq("payroll_month", monthStart)
    .is("deleted_at", null)
    .in("status", ["approved", "paid"]);
  if (recordError) throw recordError;

  const { error: payslipError } = await supabase
    .from("payroll_payslips")
    .update({
      status: "released",
      released_by: user.id,
      released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("payroll_month", monthStart)
    .is("deleted_at", null)
    .in("status", ["draft", "reviewing", "released"]);
  if (payslipError) throw payslipError;

  const { data: releasedPayslips, error: releasedError } = await supabase
    .from("payroll_payslips")
    .select("employee_id")
    .eq("payroll_month", monthStart)
    .eq("company_id", user.company_id)
    .eq("status", "released")
    .is("deleted_at", null);
  if (releasedError) throw releasedError;

  const employeeIds = Array.from(new Set(((releasedPayslips ?? []) as Array<{ employee_id: string }>).map((row) => row.employee_id)));
  if (employeeIds.length) {
    const { data: recipientUsers, error: recipientError } = await supabase
      .from("users")
      .select("id")
      .in("employee_id", employeeIds)
      .eq("status", "active")
      .is("deleted_at", null);
    if (recipientError) throw recipientError;
    const recipientUserIds = ((recipientUsers ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (recipientUserIds.length) {
      await emitNotificationEvent({
        type: "薪資單發布",
        title: `${month} 薪資單已發布`,
        content: "請至薪資袋查看個人薪資單。薪資袋需輸入密碼，員工只能查看自己的薪資內容。",
        sourceModule: "薪資結算",
        sourceId: month,
        channels: ["站內通知", "Email"],
        recipientUserIds,
        metadata: { payrollMonth: month, employeeCount: employeeIds.length },
      });
    }
  }

  await writeAuditLog({
    action: "payroll.payslips.release",
    resourceType: "payroll_payslips",
    resourceId: month,
    afterData: { payrollMonth: month, status: "released", releasedBy: user.id },
  });
}

export async function updateLivePayslipStatus(id: string, status: "draft" | "reviewing" | "released" | "void") {
  const supabase = getLiveClient();
  const user = status === "released" ? await getCurrentAppUser() : null;
  const { error } = await supabase
    .from("payroll_payslips")
    .update({
      status,
      released_by: status === "released" ? user?.id : null,
      released_at: status === "released" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
  await writeAuditLog({
    action: `payroll.payslip.${status}`,
    resourceType: "payroll_payslips",
    resourceId: id,
    afterData: { id, status },
  });
}

export async function createLivePayrollAdjustment(input: {
  payrollMonth: string;
  employee: string;
  item: string;
  amount: number;
  reason: string;
}) {
  await writeAuditLog({
    action: "payroll.adjustment.create",
    resourceType: "payroll_adjustment",
    resourceId: input.payrollMonth,
    afterData: input,
  });
}

export async function loadLivePayrollAdjustments(month: string): Promise<PayrollAdjustmentRecord[]> {
  const supabase = getLiveClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, after_data, created_at, users(display_name)")
    .eq("resource_type", "payroll_adjustment")
    .eq("resource_id", month)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return ((data ?? []) as PayrollAdjustmentAuditRow[]).map((row) => ({
    id: row.id,
    employee: row.after_data?.employee ?? "未指定員工",
    item: row.after_data?.item ?? "鎖定後薪資調整",
    amount: Number(row.after_data?.amount ?? 0),
    reason: row.after_data?.reason ?? "",
    createdBy: row.users?.display_name ?? "系統",
    createdAt: row.created_at ? new Date(row.created_at).toLocaleString("zh-TW", { hour12: false }) : nowText(),
  }));
}
