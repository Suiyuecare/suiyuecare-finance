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

export const defaultLoginEmail = "3@suiyuecare.com";
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
  {
    id: "4adb8779-65c1-4e30-9339-60c6f5c0c6df",
    email: "1@suiyuecare.com",
    role: "team_member",
    roleLabel: "組員",
    name: "潘雨柔",
    companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
    primaryBranchId: "754fba73-1902-437e-9fd9-8e114871c175",
    departmentCode: "HOMECARE",
    departmentId: "7d45f8b7-0a92-41e5-b64f-021255be1a64",
  },
  {
    id: "52f47456-bef6-4d6b-bd2d-a637cb0948d7",
    email: "2@suiyuecare.com",
    role: "supervisor",
    roleLabel: "主管",
    name: "陳怡霖",
    companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
    primaryBranchId: "754fba73-1902-437e-9fd9-8e114871c175",
    departmentCode: "HOMECARE",
    departmentId: "7d45f8b7-0a92-41e5-b64f-021255be1a64",
  },
  {
    id: "d9bf99ad-842c-40a9-83b1-a8828495a3a8",
    email: "3@suiyuecare.com",
    role: "hr",
    roleLabel: "人資",
    name: "陳羽俊",
    companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
    primaryBranchId: "f5902e69-e686-4b22-96b5-2e8942759016",
    departmentCode: "HR",
    departmentId: "1009854c-8862-40a1-b62d-c969f2adc46c",
  },
  {
    id: "d9646f71-e453-48d8-9e16-a4743ea19cfa",
    email: "4@suiyuecare.com",
    role: "admin_director",
    roleLabel: "行政部門主任",
    name: "劉巧涵",
    companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
    primaryBranchId: "f5902e69-e686-4b22-96b5-2e8942759016",
    departmentCode: "ADMIN",
    departmentId: "9da1d8db-b418-4e86-a6dd-b48431d6f238",
  },
  {
    id: "bae25445-d57e-4d16-a93a-e88be70ceea7",
    email: "5@suiyuecare.com",
    role: "ceo",
    roleLabel: "執行長",
    name: "李佳泰",
    companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
    primaryBranchId: "f5902e69-e686-4b22-96b5-2e8942759016",
    departmentCode: "ADMIN",
    departmentId: "9da1d8db-b418-4e86-a6dd-b48431d6f238",
  },
];

export const unauthenticatedUser: CurrentUser = {
  id: "",
  name: "未登入",
  email: "",
  role: "team_member",
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
