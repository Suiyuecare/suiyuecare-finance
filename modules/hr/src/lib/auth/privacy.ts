import type { CurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/rbac";

export function canManageEmployeeMasterData(user: CurrentUser) {
  return can(user.role, "employee:manage");
}

export function canViewSensitiveEmployeeData(user: CurrentUser) {
  return can(user.role, "employee:sensitive:view");
}

export function canViewEmployeeContactData(user: CurrentUser) {
  return can(user.role, "employee:contact:view") || can(user.role, "employee:sensitive:view");
}

export function canViewEmployeeAddressData(user: CurrentUser) {
  return can(user.role, "employee:address:view") || can(user.role, "employee:sensitive:view");
}

export function canViewEmployeeNationalId(user: CurrentUser) {
  return can(user.role, "employee:national_id:view") || can(user.role, "employee:sensitive:view");
}

export function canViewEmployeeSalaryFields(user: CurrentUser) {
  return can(user.role, "employee:salary:view") || can(user.role, "payroll:individual:view");
}

export function canViewCompanyPayrollData(user: CurrentUser) {
  return canViewIndividualPayrollData(user);
}

export function canViewPayrollAggregateData(user: CurrentUser) {
  return can(user.role, "payroll:aggregate:view") || can(user.role, "payroll:all:view") || can(user.role, "payroll:manage");
}

export function canViewIndividualPayrollData(user: CurrentUser) {
  return can(user.role, "payroll:individual:view") || can(user.role, "payroll:all:view");
}

export function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return value ? "已遮罩" : "未設定";
  return `${digits.slice(0, 4)}-***-${digits.slice(-3)}`;
}

export function maskEmail(value: string) {
  if (!value.includes("@")) return value ? "已遮罩" : "未設定";
  const [name, domain] = value.split("@");
  const safeName = name.length <= 2 ? `${name.slice(0, 1)}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
}

export function maskNationalId(value: string) {
  if (value.length < 4) return value ? "已遮罩" : "未設定";
  return `${value.slice(0, 1)}********${value.slice(-1)}`;
}

export function maskText(value: string, visiblePrefix = 0) {
  if (!value) return "未設定";
  return visiblePrefix > 0 ? `${value.slice(0, visiblePrefix)}***` : "已遮罩";
}

export function restrictedValue(canView: boolean, value: string, maskedValue = "已遮罩") {
  if (!value) return "未設定";
  return canView ? value : maskedValue;
}
