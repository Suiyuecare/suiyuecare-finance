import {
  AlertTriangle,
  Database,
  FileClock,
  KeyRound,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import type { HrRole, Permission } from "@/lib/auth/rbac";
import { getAllRolePermissionSummaries, getPermissionMeta } from "@/lib/auth/rbac-visualization";

export type SecurityControlStatus = "ready" | "review" | "blocked";

export type SecurityControl = {
  title: string;
  description: string;
  owner: string;
  status: SecurityControlStatus;
  evidence: string;
  href: string;
  icon: LucideIcon;
};

export type SensitiveActionPolicy = {
  action: string;
  risk: "敏感" | "高敏感";
  requiredPermission: Permission;
  requiredEvidence: string;
  approvalRule: string;
  auditAction: string;
  href: string;
};

export type BackupRestorePolicy = {
  title: string;
  status: SecurityControlStatus;
  owner: string;
  rpo: string;
  rto: string;
  retention: string;
  evidence: string;
};

export const securityControls: SecurityControl[] = [
  {
    title: "Supabase RLS 與資料範圍",
    description: "所有公開 schema 資料表需開啟 RLS，並依本人、部門、公司、全集團資料範圍限制可讀寫資料。",
    owner: "系統管理",
    status: "review",
    evidence: "supabase/hris_schema_live.sql 已有 enable row level security 與 policies，仍需上線前跑 advisors。",
    href: "/settings",
    icon: Database,
  },
  {
    title: "個資欄位保護",
    description: "身分證、生日、地址、聯絡方式、緊急聯絡人與文件附件依角色遮罩；主管只看管理必要資料。",
    owner: "人資",
    status: "ready",
    evidence: "員工列表與員工詳細頁已依角色隱藏敏感個資。",
    href: "/employees",
    icon: LockKeyhole,
  },
  {
    title: "薪資資料分層",
    description: "員工只看本人薪資袋；老闆看薪資總額與趨勢，不看個人薪資；人資/行政薪資權限才能看個人清冊。",
    owner: "行政部門主任",
    status: "ready",
    evidence: "薪資後台、薪資清冊、員工詳細頁已拆分彙總與個人明細權限。",
    href: "/payroll",
    icon: KeyRound,
  },
  {
    title: "高敏感權限二次治理",
    description: "調整角色權限前需填寫理由、指定複核人、確認敏感資料影響，並寫入設定紀錄。",
    owner: "執行長",
    status: "ready",
    evidence: "系統設定中心已加入權限調整二次治理。",
    href: "/settings",
    icon: UserRoundCog,
  },
  {
    title: "稽核與登入紀錄",
    description: "薪資、設定、權限、匯出、登入、錯誤與敏感查詢都需留下 audit logs / login logs / error logs。",
    owner: "系統管理",
    status: "review",
    evidence: "已有 /api/security/audit 與 audit helper；需擴大到所有匯出與敏感檢視。",
    href: "/security",
    icon: FileClock,
  },
  {
    title: "部署與環境變數",
    description: "Vercel 需僅公開 publishable key，禁止 service_role 出現在前端；上線前需檢查 .env 與備份策略。",
    owner: "行政部門主任",
    status: "review",
    evidence: "已建立備份復原治理資料表與 system_settings 策略；仍需在 Supabase Dashboard 確認 Production backup/PITR 狀態。",
    href: "/settings",
    icon: ServerCog,
  },
];

export const backupRestorePolicies: BackupRestorePolicy[] = [
  {
    title: "Production database backup",
    status: "review",
    owner: "行政部門主任 / 系統管理",
    rpo: "24 小時內",
    rto: "4 小時內",
    retention: "至少 30 天",
    evidence: "system_settings.backup_restore_policy 已落庫；需到 Supabase Dashboard 核對 daily backup / PITR。",
  },
  {
    title: "薪資與稽核保存",
    status: "ready",
    owner: "人資 / 會計 / 行政部門主任",
    rpo: "每次薪資結算前",
    rto: "1 個工作天",
    retention: "薪資與 audit snapshots 7 年",
    evidence: "薪資清冊、薪資袋、payroll_items、audit_logs 已納入備份政策保存範圍。",
  },
  {
    title: "還原演練",
    status: "blocked",
    owner: "系統管理",
    rpo: "每季演練",
    rto: "演練 4 小時內完成驗證",
    retention: "演練紀錄永久留存或至少 7 年",
    evidence: "backup_restore_runs 已建立 planned restore_drill；上線前需完成一次非正式環境還原。",
  },
  {
    title: "重大操作前手動備份",
    status: "review",
    owner: "系統管理 / 資料異動負責人",
    rpo: "操作前立即建立",
    rto: "依操作影響範圍復原",
    retention: "至少 30 天；薪資與法遵異動 7 年",
    evidence: "schema migration、payroll close、bulk import、權限發布、法規規則發布前皆需建立備份紀錄。",
  },
];

export const sensitiveActionPolicies: SensitiveActionPolicy[] = [
  {
    action: "角色權限發布",
    risk: "高敏感",
    requiredPermission: "system:settings",
    requiredEvidence: "調整理由、複核人、敏感權限確認",
    approvalRule: "行政部門主任或執行長複核",
    auditAction: "security.role_permissions.publish",
    href: "/settings",
  },
  {
    action: "個人薪資清冊匯出",
    risk: "高敏感",
    requiredPermission: "payroll:all:view",
    requiredEvidence: "月份、部門、匯出用途、操作者",
    approvalRule: "人資或行政薪資權限；CEO 僅可匯出彙總",
    auditAction: "payroll.roster.export",
    href: "/payroll/roster",
  },
  {
    action: "薪資鎖定與發布",
    risk: "高敏感",
    requiredPermission: "payroll:manage",
    requiredEvidence: "出勤阻擋清空、草稿覆核、調整紀錄",
    approvalRule: "人資檢查 → 會計檢查 → 主管確認 → 鎖定",
    auditAction: "payroll.batch.lock_or_release",
    href: "/payroll/closing",
  },
  {
    action: "員工敏感個資檢視",
    risk: "高敏感",
    requiredPermission: "employee:sensitive:view",
    requiredEvidence: "檢視原因、員工範圍、操作者",
    approvalRule: "限人資與行政必要職務；主管不看身分與地址",
    auditAction: "employee.sensitive.view",
    href: "/employees",
  },
  {
    action: "法規規則發布",
    risk: "高敏感",
    requiredPermission: "compliance:manage",
    requiredEvidence: "規則版本、法源、影響流程",
    approvalRule: "低於法規不得發布，需保留版本紀錄",
    auditAction: "compliance.rule.publish",
    href: "/compliance",
  },
  {
    action: "評鑑資料包匯出",
    risk: "敏感",
    requiredPermission: "analytics:view",
    requiredEvidence: "日期區間、據點、資料包類型",
    approvalRule: "限評鑑需求與授權管理角色",
    auditAction: "assessment.export",
    href: "/assessment-exports",
  },
];

export function getSecurityRoleSummary() {
  return getAllRolePermissionSummaries().map((summary) => {
    const highRiskPermissions = summary.permissions.filter((permission) => permission.risk === "高敏感");
    const payrollPermissions = summary.permissions.filter((permission) => permission.group === "payroll");
    const peoplePermissions = summary.permissions.filter((permission) => permission.group === "people");

    return {
      ...summary,
      highRiskPermissions,
      payrollPermissions,
      peoplePermissions,
    };
  });
}

export function getSensitivePermissionLabels(role: HrRole) {
  const roleSummary = getSecurityRoleSummary().find((summary) => summary.role === role);
  return (roleSummary?.highRiskPermissions ?? []).map((permission) => getPermissionMeta(permission.permission).label);
}

export function securityStatusLabel(status: SecurityControlStatus) {
  if (status === "ready") return "已具備";
  if (status === "review") return "需複核";
  return "上線阻擋";
}

export function securityStatusStyle(status: SecurityControlStatus) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "review") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export const securityLaunchChecklist = [
  { title: "確認前端沒有 service_role 或 secret key", status: "blocked", detail: "只允許 NEXT_PUBLIC_SUPABASE_URL 與 publishable key 出現在瀏覽器。" },
  { title: "執行 Supabase Security Advisor", status: "review", detail: "檢查 RLS、函式、view、extension 與 exposed schema 風險。" },
  { title: "驗證員工帳號只能讀本人資料", status: "review", detail: "用組員帳號測 /employees、/payroll、/payslip、/requests。" },
  { title: "驗證主管看不到部屬敏感個資與薪資", status: "ready", detail: "主管頁與員工詳細頁已改成安全視圖，仍需實帳測試。" },
  { title: "確認薪資匯出有稽核紀錄", status: "review", detail: "CSV / Excel 匯出需記錄操作者、月份、範圍、檔案類型。" },
  { title: "確認備份與復原策略", status: "review", detail: "已建立 system_settings.backup_restore_policy 與 backup_restore_runs；上線前仍需完成 Supabase Dashboard 備份確認與一次還原演練。" },
  { title: "確認登入紀錄與錯誤紀錄可查", status: "review", detail: "login_logs / error_logs 需在資安中心可追蹤。" },
  { title: "確認權限調整需要二次治理", status: "ready", detail: "角色權限發布已要求理由、複核人與風險確認。" },
] as const;

export function securityRiskIcon(status: SecurityControlStatus) {
  if (status === "ready") return ShieldCheck;
  return AlertTriangle;
}
