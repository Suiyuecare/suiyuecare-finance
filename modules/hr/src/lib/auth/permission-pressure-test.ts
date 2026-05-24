import type { CurrentUser } from "@/lib/auth/current-user";
import { can, canAny, getRolePolicy, hrRoles, type HrRole, type Permission } from "@/lib/auth/rbac";
import { getRoutePermissions } from "@/lib/auth/route-permissions";
import {
  canViewEmployeeAddressData,
  canViewEmployeeNationalId,
  canViewEmployeeSalaryFields,
  canViewIndividualPayrollData,
  canViewPayrollAggregateData,
  canViewSensitiveEmployeeData,
} from "@/lib/auth/privacy";

type PermissionExpectation = {
  role: HrRole;
  permission: Permission;
  expected: boolean;
  reason: string;
};

type RouteExpectation = {
  role: HrRole;
  pathname: string;
  expected: boolean;
  reason: string;
};

type PrivacyExpectation = {
  role: HrRole;
  label: string;
  expected: boolean;
  reason: string;
  evaluate: (user: CurrentUser) => boolean;
};

export type PermissionPressureResult = {
  id: string;
  group: "功能權限" | "頁面路由" | "敏感資料" | "資料範圍";
  role: HrRole;
  roleLabel: string;
  target: string;
  expected: boolean;
  actual: boolean;
  passed: boolean;
  severity: "blocking" | "review";
  reason: string;
};

const roleLabels: Record<HrRole, string> = {
  employee: "一般組員",
  team_member: "一般組員",
  section_chief: "課長",
  dept_manager: "部門主管",
  supervisor: "部門主管",
  general_affairs: "總務",
  hr: "人資",
  accountant: "會計",
  admin_director: "行政部門主任",
  ceo: "執行長",
};

const permissionExpectations: PermissionExpectation[] = [
  { role: "team_member", permission: "employee:view", expected: false, reason: "組員不可進入員工主檔看他人資料。" },
  { role: "team_member", permission: "employee:sensitive:view", expected: false, reason: "組員不可看他人身分證、地址、生日與緊急聯絡人。" },
  { role: "team_member", permission: "payroll:individual:view", expected: false, reason: "組員不可看他人薪資明細。" },
  { role: "team_member", permission: "payroll:self:view", expected: true, reason: "組員只能查看自己的薪資袋。" },
  { role: "team_member", permission: "system:settings", expected: false, reason: "組員不可調整系統設定與角色權限。" },
  { role: "supervisor", permission: "employee:view", expected: true, reason: "主管可看部門員工管理必要資料。" },
  { role: "supervisor", permission: "employee:national_id:view", expected: false, reason: "主管不可看員工身分證字號。" },
  { role: "supervisor", permission: "employee:address:view", expected: false, reason: "主管不可看員工戶籍/通訊地址。" },
  { role: "supervisor", permission: "employee:salary:view", expected: false, reason: "主管不可看員工薪資欄位。" },
  { role: "supervisor", permission: "payroll:individual:view", expected: false, reason: "主管不可看個人薪資清冊。" },
  { role: "hr", permission: "employee:sensitive:view", expected: true, reason: "人資可看人員主檔與敏感資料。" },
  { role: "hr", permission: "employee:national_id:view", expected: true, reason: "人資需處理勞健保、扣繳與契約資料。" },
  { role: "hr", permission: "payroll:individual:view", expected: true, reason: "人資可處理個人薪資資料與薪資袋發布。" },
  { role: "admin_director", permission: "permission:settings:publish", expected: true, reason: "行政部門主任可發布功能權限調整。" },
  { role: "admin_director", permission: "payroll:individual:view", expected: true, reason: "行政部門主任具有薪資與人資最高管理權限。" },
  { role: "ceo", permission: "payroll:aggregate:view", expected: true, reason: "執行長可看薪資總額與經營儀表板。" },
  { role: "ceo", permission: "payroll:individual:view", expected: false, reason: "執行長預設看經營總額；個人薪資明細不預設開放，可由權限中心另行授權。" },
  { role: "ceo", permission: "permission:settings:publish", expected: true, reason: "執行長可發布高權限設定。" },
];

const routeExpectations: RouteExpectation[] = [
  { role: "team_member", pathname: "/employees", expected: false, reason: "組員不能進員工管理。" },
  { role: "supervisor", pathname: "/employees", expected: true, reason: "主管可進員工管理安全視圖。" },
  { role: "supervisor", pathname: "/employee-contracts", expected: false, reason: "主管不可看勞動契約與個資附件。" },
  { role: "hr", pathname: "/employee-contracts", expected: true, reason: "人資可管理員工名冊與勞動契約。" },
  { role: "team_member", pathname: "/payroll/roster", expected: false, reason: "組員不可看薪資清冊。" },
  { role: "supervisor", pathname: "/payroll/roster", expected: false, reason: "主管不可看薪資清冊。" },
  { role: "ceo", pathname: "/payroll/roster", expected: true, reason: "執行長可看薪資彙總清冊。" },
  { role: "ceo", pathname: "/payroll/employee-settings", expected: false, reason: "執行長不預設維護個人薪資主檔，避免非必要接觸。" },
  { role: "admin_director", pathname: "/payroll/employee-settings", expected: true, reason: "行政部門主任可維護薪資主檔。" },
  { role: "hr", pathname: "/settings", expected: true, reason: "人資可進權限設定，但高權限仍由硬阻擋保護。" },
  { role: "team_member", pathname: "/settings", expected: false, reason: "組員不可進系統設定。" },
  { role: "ceo", pathname: "/security", expected: true, reason: "執行長可看資安與稽核中心。" },
];

const privacyExpectations: PrivacyExpectation[] = [
  { role: "team_member", label: "敏感個資", expected: false, reason: "組員不可看他人敏感個資。", evaluate: canViewSensitiveEmployeeData },
  { role: "supervisor", label: "身分證字號", expected: false, reason: "主管不可看身分證。", evaluate: canViewEmployeeNationalId },
  { role: "supervisor", label: "地址", expected: false, reason: "主管不可看地址。", evaluate: canViewEmployeeAddressData },
  { role: "supervisor", label: "薪資欄位", expected: false, reason: "主管不可看薪資欄位。", evaluate: canViewEmployeeSalaryFields },
  { role: "hr", label: "敏感個資", expected: true, reason: "人資可看主檔敏感資料。", evaluate: canViewSensitiveEmployeeData },
  { role: "admin_director", label: "個人薪資", expected: true, reason: "行政部門主任可看與維護個人薪資。", evaluate: canViewIndividualPayrollData },
  { role: "ceo", label: "薪資總額", expected: true, reason: "執行長可看經營總額。", evaluate: canViewPayrollAggregateData },
  { role: "ceo", label: "個人薪資", expected: false, reason: "執行長不預設看個人薪資明細。", evaluate: canViewIndividualPayrollData },
];

function buildUser(role: HrRole): CurrentUser {
  return {
    id: `${role}-pressure-test`,
    name: roleLabels[role],
    email: `${role}@permission.test`,
    role,
    roleLabel: roleLabels[role],
    companyId: "pressure-company",
    primaryBranchId: "pressure-branch",
    departmentCode: role === "team_member" || role === "supervisor" ? "HOMECARE" : "ADMIN",
  };
}

function result(input: Omit<PermissionPressureResult, "passed" | "roleLabel">): PermissionPressureResult {
  return {
    ...input,
    roleLabel: roleLabels[input.role],
    passed: input.actual === input.expected,
  };
}

export function runPermissionPressureTest(): PermissionPressureResult[] {
  const permissionResults = permissionExpectations.map((item) =>
    result({
      id: `permission:${item.role}:${item.permission}`,
      group: "功能權限",
      role: item.role,
      target: item.permission,
      expected: item.expected,
      actual: can(item.role, item.permission),
      severity: "blocking",
      reason: item.reason,
    }),
  );

  const routeResults = routeExpectations.map((item) =>
    result({
      id: `route:${item.role}:${item.pathname}`,
      group: "頁面路由",
      role: item.role,
      target: item.pathname,
      expected: item.expected,
      actual: canAny(item.role, getRoutePermissions(item.pathname)),
      severity: "blocking",
      reason: item.reason,
    }),
  );

  const privacyResults = privacyExpectations.map((item) =>
    result({
      id: `privacy:${item.role}:${item.label}`,
      group: "敏感資料",
      role: item.role,
      target: item.label,
      expected: item.expected,
      actual: item.evaluate(buildUser(item.role)),
      severity: "blocking",
      reason: item.reason,
    }),
  );

  const dataScopeResults = hrRoles.map((role) => {
    const policy = getRolePolicy(role);
    const expectedScope = role === "employee"
      ? "self"
      : role === "section_chief" || role === "dept_manager" || role === "general_affairs"
        ? "department"
        : role === "ceo"
          ? "all_companies"
          : "company";
    return result({
      id: `scope:${role}`,
      group: "資料範圍",
      role,
      target: policy.dataScope,
      expected: true,
      actual: policy.dataScope === expectedScope,
      severity: "review",
      reason: `${roleLabels[role]} 預期資料範圍為 ${expectedScope}。`,
    });
  });

  return [...permissionResults, ...routeResults, ...privacyResults, ...dataScopeResults];
}

export function summarizePermissionPressureResults(results = runPermissionPressureTest()) {
  const failed = results.filter((item) => !item.passed);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    blockingFailed: failed.filter((item) => item.severity === "blocking").length,
    reviewFailed: failed.filter((item) => item.severity === "review").length,
  };
}
