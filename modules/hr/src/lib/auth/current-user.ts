import type { HrRole } from "@/lib/auth/rbac";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: HrRole;
  roleLabel: string;
  companyId: string;
  primaryBranchId: string;
  departmentCode: string;
  departmentId?: string;
  teamId?: string;
  supportBranchIds?: string[];
};

export const defaultLoginEmail = "entrepreneur@suiyuecare.com";
export const quickLoginStorageKey = "suiyue-hris-quick-login-user";
export const quickLoginChangedEvent = "suiyue-hris-quick-login-changed";
export const quickLoginCookieKey = "suiyue_hris_quick_login_user";

export const supabaseAccountOptions: Array<{
  id: string;
  email: string;
  role: HrRole;
  roleLabel: string;
  name: string;
  companyId: string;
  primaryBranchId: string;
  departmentCode: string;
  departmentId?: string;
  teamId?: string;
  supportBranchIds?: string[];
}> = [
  { id: "finance-entrepreneur", email: "entrepreneur@suiyuecare.com", role: "ceo", roleLabel: "執行長", name: "李佳泰", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "EXEC" },
  { id: "finance-admin", email: "admin@suiyuecare.com", role: "admin_director", roleLabel: "行政部門主任", name: "劉巧涵", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "ADMIN" },
  { id: "finance-hr", email: "suiyue.hr@suiyuecare.com", role: "hr", roleLabel: "人資", name: "陳羽俊", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "HR" },
  { id: "finance-accounting", email: "suiyue.acct@suiyuecare.com", role: "accountant", roleLabel: "會計", name: "歲悅會計", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "A1101" },
  { id: "finance-general-affairs", email: "generalaffairs@suiyuecare.com", role: "general_affairs", roleLabel: "總務", name: "朱夏欣", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "ADMIN" },
  { id: "finance-project-chiang", email: "project_chiang@suiyuecare.com", role: "section_chief", roleLabel: "課長", name: "江守舜", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-project", email: "project@suiyuecare.com", role: "dept_manager", roleLabel: "部門主管", name: "陳怡霖", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-homecare-taipei", email: "homecare.taipei@suiyuecare.com", role: "dept_manager", roleLabel: "部門主管", name: "黃致皓", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "B1303" },
  { id: "finance-daycare-wanhua", email: "daycare.wanhua@suiyuecare.com", role: "dept_manager", roleLabel: "部門主管", name: "林方春", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "DAYCARE" },
  { id: "finance-edu-control", email: "edu.control@suiyuecare.com", role: "dept_manager", roleLabel: "部門主管", name: "陳蕙婷", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "EDU" },
  { id: "finance-project-hsu", email: "project_hsu@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "徐靖雯", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-project-pan", email: "project_pan@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "潘雨柔", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-project-yu", email: "project_yu@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "沈芊佑", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-daycare-datong", email: "daycare.datong@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "吳俊璋", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "DAYCARE" },
  { id: "finance-daycare-shilin", email: "daycare.shilin@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "王立行", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "DAYCARE" },
  { id: "finance-daycare-xinyi", email: "daycare.xinyi@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "信義失智", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "B1104" },
  { id: "finance-homecare-taipei-members", email: "homecare.taipei.members@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "臺北居家照顧服務課組員", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "B1303" },
  { id: "finance-projectmember", email: "projectmember@suiyuecare.com", role: "employee", roleLabel: "一般組員", name: "移工培訓部組員", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "PROJECT" },
  { id: "finance-admin-jiobar", email: "admin@jiobar.com", role: "section_chief", roleLabel: "課長", name: "移站式", companyId: "finance-shared", primaryBranchId: "group", departmentCode: "D1000" },
];

export const unauthenticatedUser: CurrentUser = {
  id: "",
  name: "未登入",
  email: "",
  role: "employee",
  roleLabel: "未登入",
  companyId: "",
  primaryBranchId: "",
  departmentCode: "",
};

function readQuickLoginCookie() {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${quickLoginCookieKey}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(quickLoginCookieKey.length + 1));
}

function writeQuickLoginCookie(value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${quickLoginCookieKey}=${encodeURIComponent(value)}; path=/; max-age=604800; SameSite=Lax`;
}

function clearQuickLoginCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${quickLoginCookieKey}=; path=/; max-age=0; SameSite=Lax`;
}

function readQuickLoginStorage() {
  try {
    return window.localStorage?.getItem(quickLoginStorageKey) ?? null;
  } catch {
    return null;
  }
}

function writeQuickLoginStorage(value: string) {
  try {
    window.localStorage?.setItem(quickLoginStorageKey, value);
  } catch {
    // Some embedded or mobile browsers restrict localStorage. Cookie fallback keeps card login usable.
  }
}

function clearQuickLoginStorage() {
  try {
    window.localStorage?.removeItem(quickLoginStorageKey);
  } catch {
    // Ignore storage restrictions; cookie fallback is cleared separately.
  }
}

export function getQuickLoginUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;

  const raw = readQuickLoginStorage() ?? readQuickLoginCookie();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CurrentUser;
    if (!parsed.id || !parsed.role) return null;
    return parsed;
  } catch {
    clearQuickLoginStorage();
    clearQuickLoginCookie();
    return null;
  }
}

export function setQuickLoginUser(user: CurrentUser) {
  if (typeof window === "undefined") return;
  const value = JSON.stringify(user);
  writeQuickLoginStorage(value);
  writeQuickLoginCookie(value);
  window.dispatchEvent(new CustomEvent(quickLoginChangedEvent, { detail: user }));
}

export function clearQuickLoginUser() {
  if (typeof window === "undefined") return;
  clearQuickLoginStorage();
  clearQuickLoginCookie();
  window.dispatchEvent(new CustomEvent(quickLoginChangedEvent, { detail: null }));
}
