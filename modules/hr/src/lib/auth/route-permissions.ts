import { navigationGroups } from "@/lib/config/navigation";
import type { Permission } from "@/lib/auth/rbac";

type RoutePermission = {
  href: string;
  permissions: Permission[];
};

const extraRoutePermissions: RoutePermission[] = [
  { href: "/employee-portal", permissions: ["dashboard:view"] },
  { href: "/employees", permissions: ["employee:view"] },
  { href: "/employee-contracts", permissions: ["employee:manage", "employee:sensitive:view"] },
  { href: "/employee-changes", permissions: ["employee:manage"] },
  { href: "/retention", permissions: ["employee:manage"] },
  { href: "/licenses", permissions: ["training:view"] },
  { href: "/training-records", permissions: ["training:view"] },
  { href: "/attendance/reports", permissions: ["attendance:manage"] },
  { href: "/attendance/shifts", permissions: ["attendance:manage"] },
  { href: "/payroll/roster", permissions: ["payroll:aggregate:view", "payroll:individual:view"] },
  { href: "/payroll/closing", permissions: ["payroll:manage"] },
  { href: "/payroll/employee-settings", permissions: ["payroll:manage"] },
  { href: "/payroll/items", permissions: ["payroll:manage"] },
  { href: "/payroll/attendance-calculation", permissions: ["payroll:manage"] },
  { href: "/payroll/overtime-calculator", permissions: ["payroll:manage"] },
  { href: "/payroll/leave-deduction", permissions: ["payroll:manage"] },
  { href: "/payroll/insurance-calculator", permissions: ["payroll:manage"] },
  { href: "/payroll", permissions: ["payroll:aggregate:view", "payroll:manage"] },
  { href: "/leave-reports", permissions: ["attendance:manage"] },
  { href: "/overtime-reports", permissions: ["attendance:manage", "payroll:manage"] },
  { href: "/requests", permissions: ["request:view"] },
  { href: "/approval-flows", permissions: ["request:admin"] },
  { href: "/excel-imports", permissions: ["employee:manage"] },
  { href: "/labor-compliance-kit", permissions: ["compliance:view", "analytics:view"] },
  { href: "/policy-documents", permissions: ["compliance:view", "announcement:view"] },
  { href: "/compliance", permissions: ["compliance:view"] },
  { href: "/harassment-policy", permissions: ["announcement:view", "compliance:view"] },
  { href: "/notifications", permissions: ["notification:view"] },
  { href: "/security", permissions: ["system:audit:view", "system:settings"] },
  { href: "/operations", permissions: ["system:settings"] },
  { href: "/finance-handoff", permissions: ["finance_handoff:view"] },
];

export const protectedRoutePermissions: RoutePermission[] = [
  ...navigationGroups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      permissions: item.permissions,
    })),
  ),
  ...extraRoutePermissions,
].sort((a, b) => b.href.length - a.href.length);

export function getRoutePermissions(pathname: string): Permission[] {
  const matchedRoute = protectedRoutePermissions.find(
    (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
  );

  return matchedRoute?.permissions ?? ["dashboard:view"];
}
