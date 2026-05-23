import {
  Archive,
  BarChart3,
  Bell,
  CalendarDays,
  Clock3,
  ClipboardCheck,
  ClipboardList,
  FilePenLine,
  FileArchive,
  FileCheck2,
  Home,
  KanbanSquare,
  Landmark,
  LockKeyhole,
  NotebookText,
  ServerCog,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserCheck,
  UserRoundCog,
  Users,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Permission } from "@/lib/auth/rbac";

export type NavigationItem = {
  title: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  permissions: Permission[];
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "今日工作",
    items: [
      { title: "儀表板", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
      { title: "我要打卡", href: "/clock", icon: Clock3, permissions: ["attendance:view"] },
      { title: "表單申請", href: "/requests/new", icon: ClipboardList, permissions: ["request:create"] },
      { title: "表單追蹤", href: "/requests", icon: NotebookText, permissions: ["request:view"] },
      { title: "表單簽核", href: "/approvals", icon: FileCheck2, permissions: ["request:approve"] },
      { title: "出勤日曆", href: "/attendance", icon: CalendarDays, permissions: ["attendance:view"] },
      { title: "薪資袋", href: "/payslip", icon: LockKeyhole, permissions: ["payroll:self:view"] },
      { title: "公告中心", href: "/announcements", icon: Bell, permissions: ["announcement:view"] },
      { title: "工具列", href: "/toolbox", icon: Wrench, permissions: ["dashboard:view"] },
    ],
  },
  {
    label: "管理工作",
    items: [
      { title: "主管入口", href: "/manager-portal", icon: UserCheck, permissions: ["request:approve"] },
      { title: "人資後台", href: "/hr-admin", icon: UserRoundCog, permissions: ["employee:manage"] },
      { title: "人員主檔", href: "/employees", icon: UserRoundCog, permissions: ["employee:view"] },
      { title: "組織圖", href: "/organization", icon: Users, permissions: ["organization:view"] },
      { title: "電子公文", href: "/official-documents", icon: FilePenLine, permissions: ["dashboard:view"] },
      { title: "敏捷專案", href: "/agile-projects", icon: KanbanSquare, permissions: ["dashboard:view"] },
      { title: "出勤異常", href: "/attendance/anomalies", icon: ShieldAlert, permissions: ["attendance:approve", "attendance:manage"] },
      { title: "假別管理", href: "/attendance/leave-types", icon: CalendarDays, permissions: ["attendance:manage"] },
      { title: "薪資結算", href: "/payroll/closing", icon: ClipboardCheck, permissions: ["payroll:manage"] },
      { title: "薪資清冊", href: "/payroll/roster", icon: Landmark, permissions: ["payroll:manage"] },
      { title: "薪資設定", href: "/payroll/employee-settings", icon: Settings2, permissions: ["payroll:manage"] },
    ],
  },
  {
    label: "報表法遵",
    items: [
      { title: "報表中心", href: "/analytics", icon: BarChart3, permissions: ["analytics:view"] },
      { title: "勞檢資料包", href: "/labor-compliance-kit", icon: FileArchive, permissions: ["compliance:view", "analytics:view"] },
      { title: "評鑑資料包", href: "/assessment-exports", icon: Archive, permissions: ["analytics:view"] },
      { title: "文件制度", href: "/policy-documents", icon: FileCheck2, permissions: ["compliance:view", "announcement:view"] },
      { title: "法規規則", href: "/compliance", icon: ShieldCheck, permissions: ["compliance:view"] },
      { title: "異常告警", href: "/alerts", icon: Siren, permissions: ["compliance:view"] },
    ],
  },
  {
    label: "設定",
    items: [
      { title: "系統設定", href: "/settings", icon: Settings2, permissions: ["system:settings"] },
      { title: "上線營運中心", href: "/operations", icon: ServerCog, permissions: ["system:settings"] },
      { title: "資安與權限", href: "/security", icon: ShieldAlert, permissions: ["system:settings"] },
    ],
  },
];
