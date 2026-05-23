export const hrRoles = [
  "team_member",
  "supervisor",
  "hr",
  "admin_director",
  "ceo",
] as const;

export type HrRole = (typeof hrRoles)[number];

export type LegacyHrRole =
  | "super_admin"
  | "company_admin"
  | "hr_manager"
  | "hr_staff"
  | "accountant"
  | "department_manager"
  | "employee"
  | "homecare_supervisor"
  | "homecare_worker"
  | "daycare_staff";

export type DataScope =
  | "all_companies"
  | "company"
  | "department"
  | "team"
  | "supervised_clients"
  | "self";

export type Permission =
  | "dashboard:view"
  | "module:admin"
  | "announcement:view"
  | "announcement:manage"
  | "notification:view"
  | "notification:send"
  | "notification:rules:manage"
  | "organization:view"
  | "employee:view"
  | "employee:manage"
  | "employee:sensitive:view"
  | "employee:contact:view"
  | "employee:address:view"
  | "employee:national_id:view"
  | "employee:salary:view"
  | "employee:onboarding:manage"
  | "attendance:view"
  | "attendance:self:punch"
  | "attendance:manage"
  | "attendance:approve"
  | "attendance:abnormal:review"
  | "leave:view"
  | "leave:request"
  | "leave:approve"
  | "request:create"
  | "request:view"
  | "request:own:view"
  | "request:team:view"
  | "request:approve"
  | "request:admin"
  | "form:attendance:create"
  | "form:change:create"
  | "form:document:create"
  | "form:business:create"
  | "form:general_affairs:create"
  | "worklog:view"
  | "worklog:manage"
  | "payroll:self:view"
  | "payroll:all:view"
  | "payroll:aggregate:view"
  | "payroll:individual:view"
  | "payroll:manage"
  | "payroll:draft:generate"
  | "payroll:lock"
  | "payroll:payslip:publish"
  | "payroll:bank_export"
  | "payroll:roster_export"
  | "payroll:adjust"
  | "insurance:view"
  | "insurance:manage"
  | "compliance:view"
  | "compliance:manage"
  | "analytics:view"
  | "analytics:export"
  | "finance_handoff:view"
  | "finance_handoff:manage"
  | "care_schedule:view"
  | "care_schedule:manage"
  | "training:view"
  | "training:manage"
  | "system:settings"
  | "system:audit:view"
  | "permission:settings:view"
  | "permission:settings:publish";

export type RolePolicy = {
  label: string;
  description: string;
  dataScope: DataScope;
  permissions: Permission[];
};

export const rolePermissionDraftStorageKey = "suiyue-hris-role-permission-drafts";
export const rolePermissionDraftChangedEvent = "suiyue-hris-role-permission-drafts-changed";

const employeeBasePermissions: Permission[] = [
  "dashboard:view",
  "announcement:view",
  "notification:view",
  "organization:view",
  "leave:view",
  "leave:request",
  "request:create",
  "request:view",
  "request:own:view",
  "form:attendance:create",
  "form:document:create",
  "form:business:create",
  "form:general_affairs:create",
  "worklog:view",
  "payroll:self:view",
  "attendance:self:punch",
  "training:view",
];

const managerBasePermissions: Permission[] = [
  ...employeeBasePermissions,
  "employee:view",
  "employee:contact:view",
  "attendance:view",
  "attendance:approve",
  "attendance:abnormal:review",
  "leave:approve",
  "request:team:view",
  "request:approve",
  "form:change:create",
  "worklog:manage",
];

const hrBasePermissions: Permission[] = [
  ...managerBasePermissions,
  "announcement:manage",
  "employee:manage",
  "employee:sensitive:view",
  "employee:contact:view",
  "employee:address:view",
  "employee:national_id:view",
  "employee:salary:view",
  "employee:onboarding:manage",
  "attendance:manage",
  "request:admin",
  "insurance:view",
  "insurance:manage",
  "compliance:view",
  "analytics:view",
  "analytics:export",
  "notification:send",
  "notification:rules:manage",
  "training:manage",
];

export const rolePolicies: Record<HrRole, RolePolicy> = {
  team_member: {
    label: "組員",
    description: "員工自助帳號，可查看本人公告、班表、打卡、表單進度、薪資袋與教育訓練。",
    dataScope: "self",
    permissions: [
      ...employeeBasePermissions,
      "attendance:view",
      "care_schedule:view",
    ],
  },
  supervisor: {
    label: "主管",
    description: "部門或據點主管，可查看管轄員工、班表、出勤異常、待簽核與部門統計。",
    dataScope: "department",
    permissions: [
      ...managerBasePermissions,
      "care_schedule:view",
      "training:view",
    ],
  },
  hr: {
    label: "人資",
    description: "人資帳號，可管理人員主檔、假勤出勤、排班、簽核流程、證照訓練與薪資前置資料。",
    dataScope: "company",
    permissions: [
      ...hrBasePermissions,
      "payroll:all:view",
      "payroll:aggregate:view",
      "payroll:individual:view",
      "payroll:manage",
      "payroll:draft:generate",
      "payroll:lock",
      "payroll:payslip:publish",
      "payroll:bank_export",
      "payroll:roster_export",
      "payroll:adjust",
      "compliance:manage",
      "finance_handoff:view",
      "care_schedule:view",
      "care_schedule:manage",
      "system:settings",
      "system:audit:view",
      "permission:settings:view",
      "permission:settings:publish",
    ],
  },
  admin_director: {
    label: "行政部門主任",
    description: "行政部門主任帳號，可統籌行政、人資、薪資、法遵、報表與跨模組串接設定。",
    dataScope: "company",
    permissions: [
      ...hrBasePermissions,
      "module:admin",
      "payroll:all:view",
      "payroll:aggregate:view",
      "payroll:individual:view",
      "payroll:manage",
      "payroll:draft:generate",
      "payroll:lock",
      "payroll:payslip:publish",
      "payroll:bank_export",
      "payroll:roster_export",
      "payroll:adjust",
      "compliance:manage",
      "finance_handoff:view",
      "finance_handoff:manage",
      "care_schedule:view",
      "care_schedule:manage",
      "system:settings",
      "system:audit:view",
      "permission:settings:view",
      "permission:settings:publish",
    ],
  },
  ceo: {
    label: "執行長",
    description: "最高決策帳號，可查看全集團資料、核准重大流程、調整權限與檢視所有報表。",
    dataScope: "all_companies",
    permissions: [
      ...hrBasePermissions,
      "module:admin",
      "payroll:aggregate:view",
      "compliance:manage",
      "finance_handoff:view",
      "finance_handoff:manage",
      "care_schedule:view",
      "care_schedule:manage",
      "training:view",
      "system:settings",
      "system:audit:view",
      "permission:settings:view",
      "permission:settings:publish",
    ],
  },
};

const legacyRoleMap: Record<LegacyHrRole, HrRole> = {
  super_admin: "ceo",
  company_admin: "admin_director",
  hr_manager: "hr",
  hr_staff: "hr",
  accountant: "admin_director",
  department_manager: "supervisor",
  employee: "team_member",
  homecare_supervisor: "supervisor",
  homecare_worker: "team_member",
  daycare_staff: "team_member",
};

export function toCanonicalRole(role: string | null | undefined): HrRole {
  if (role && hrRoles.includes(role as HrRole)) {
    return role as HrRole;
  }

  if (role && role in legacyRoleMap) {
    return legacyRoleMap[role as LegacyHrRole];
  }

  return "team_member";
}

export function getRolePolicy(role: HrRole) {
  return rolePolicies[toCanonicalRole(role)];
}

export function getRoleLabel(role: HrRole) {
  return rolePolicies[role].label;
}

function readClientPermissionDrafts(): Partial<Record<HrRole, Permission[]>> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(rolePermissionDraftStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<HrRole, Permission[]>>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function getEffectiveRolePermissions(role: HrRole) {
  const canonicalRole = toCanonicalRole(role);
  const clientDrafts = readClientPermissionDrafts();
  return clientDrafts?.[canonicalRole] ?? rolePolicies[canonicalRole].permissions;
}

export function saveClientPermissionDrafts(drafts: Record<HrRole, Permission[]>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(rolePermissionDraftStorageKey, JSON.stringify(drafts));
  window.dispatchEvent(new CustomEvent(rolePermissionDraftChangedEvent, { detail: drafts }));
}

const hardDeniedPermissions: Partial<Record<HrRole, Permission[]>> = {
  team_member: [
    "employee:view",
    "employee:manage",
    "employee:sensitive:view",
    "employee:contact:view",
    "employee:address:view",
    "employee:national_id:view",
    "employee:salary:view",
    "payroll:all:view",
    "payroll:aggregate:view",
    "payroll:individual:view",
    "payroll:manage",
    "payroll:draft:generate",
    "payroll:lock",
    "payroll:payslip:publish",
    "payroll:bank_export",
    "payroll:roster_export",
    "payroll:adjust",
    "insurance:view",
    "insurance:manage",
    "finance_handoff:view",
    "finance_handoff:manage",
    "system:settings",
    "system:audit:view",
    "permission:settings:view",
    "permission:settings:publish",
  ],
  supervisor: [
    "employee:sensitive:view",
    "employee:address:view",
    "employee:national_id:view",
    "employee:salary:view",
    "payroll:all:view",
    "payroll:individual:view",
    "payroll:manage",
    "payroll:draft:generate",
    "payroll:lock",
    "payroll:payslip:publish",
    "payroll:bank_export",
    "payroll:roster_export",
    "payroll:adjust",
    "insurance:view",
    "insurance:manage",
    "finance_handoff:view",
    "finance_handoff:manage",
    "permission:settings:publish",
  ],
};

export function can(role: HrRole, permission: Permission) {
  if (hardDeniedPermissions[role]?.includes(permission)) return false;
  return getEffectiveRolePermissions(role).includes(permission);
}

export function canAny(role: HrRole, permissions: Permission[] = []) {
  return permissions.length === 0 || permissions.some((permission) => can(role, permission));
}
