export const branchTypes = [
  "headquarters",
  "branch",
  "site",
  "homecare_station",
  "daycare_center",
] as const;

export type BranchType = (typeof branchTypes)[number];

export const branchTypeLabels: Record<BranchType, string> = {
  headquarters: "總部",
  branch: "分店",
  site: "據點",
  homecare_station: "居服站",
  daycare_center: "日照中心",
};

export const departmentTypes = [
  "administration",
  "hr",
  "finance",
  "homecare",
  "daycare",
  "operations",
  "support",
] as const;

export type DepartmentType = (typeof departmentTypes)[number];

export const departmentTypeLabels: Record<DepartmentType, string> = {
  administration: "行政管理",
  hr: "人資",
  finance: "會計財務",
  homecare: "居家服務",
  daycare: "日照服務",
  operations: "營運",
  support: "支援",
};

export const teamTypes = [
  "general",
  "homecare_supervision",
  "homecare_worker",
  "daycare_shift",
  "admin",
] as const;

export type TeamType = (typeof teamTypes)[number];

export const teamTypeLabels: Record<TeamType, string> = {
  general: "一般團隊",
  homecare_supervision: "居服督導組",
  homecare_worker: "居服員組",
  daycare_shift: "日照班別",
  admin: "行政組",
};

export const assignmentTypes = ["primary", "support", "temporary", "training"] as const;

export type AssignmentType = (typeof assignmentTypes)[number];

export const assignmentTypeLabels: Record<AssignmentType, string> = {
  primary: "主要歸屬",
  support: "跨據點支援",
  temporary: "臨時派任",
  training: "訓練派任",
};
