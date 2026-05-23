import type { CurrentUser } from "@/lib/auth/current-user";
import { getRolePolicy } from "@/lib/auth/rbac";

export type DataScopeFilter = {
  companyId?: string;
  branchId?: string;
  supportBranchIds?: string[];
  departmentCode?: string;
  departmentId?: string;
  teamId?: string;
  employeeId?: string;
};

export function getDataScopeFilter(user: CurrentUser): DataScopeFilter {
  const policy = getRolePolicy(user.role);

  switch (policy.dataScope) {
    case "all_companies":
      return {};
    case "company":
      return { companyId: user.companyId };
    case "department":
      return {
        companyId: user.companyId,
        branchId: user.primaryBranchId,
        departmentCode: user.departmentCode,
        departmentId: user.departmentId,
        supportBranchIds: user.supportBranchIds,
      };
    case "team":
      return {
        companyId: user.companyId,
        branchId: user.primaryBranchId,
        teamId: user.teamId,
        supportBranchIds: user.supportBranchIds,
      };
    case "supervised_clients":
      return {
        companyId: user.companyId,
        branchId: user.primaryBranchId,
        teamId: user.teamId,
        supportBranchIds: user.supportBranchIds,
      };
    case "self":
      return {
        companyId: user.companyId,
        branchId: user.primaryBranchId,
        employeeId: user.id,
        supportBranchIds: user.supportBranchIds,
      };
    default:
      return { employeeId: user.id };
  }
}
