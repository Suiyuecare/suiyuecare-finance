import {
  Archive,
  FileWarning,
  GraduationCap,
  IdCard,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type CareWorkstreamKey =
  | "license_readiness"
  | "training_hours"
  | "assessment_package"
  | "service_geo";

export type CareWorkstream = {
  key: CareWorkstreamKey;
  title: string;
  description: string;
  href: string;
  owner: string;
  icon: LucideIcon;
  tone: string;
  checks: string[];
};

export type CareScenario = {
  title: string;
  trigger: string;
  systemAction: string;
  href: string;
};

export const careWorkstreams: CareWorkstream[] = [
  {
    key: "license_readiness",
    title: "長照資格牆",
    description: "長照小卡、照服員證明、CPR、失智症訓練、身障支持服務與專業證照。",
    href: "/licenses",
    owner: "人資",
    icon: IdCard,
    tone: "bg-violet-50 text-violet-700",
    checks: ["到期前提醒", "附件缺漏不可列入評鑑包", "到期或缺件需通知人資補件"],
  },
  {
    key: "training_hours",
    title: "年度訓練時數",
    description: "依員工、據點、課程類型統計年度訓練時數，直接支援長照評鑑清冊。",
    href: "/training-records",
    owner: "人資",
    icon: GraduationCap,
    tone: "bg-amber-50 text-amber-700",
    checks: ["新人訓練需完成", "必修課程需補齊", "證明文件需可匯出"],
  },
  {
    key: "assessment_package",
    title: "評鑑資料包",
    description: "員工名冊、證照、教育訓練、出勤、在職與到離職資料一次匯出。",
    href: "/assessment-exports",
    owner: "行政部門主任",
    icon: Archive,
    tone: "bg-orange-50 text-orange-700",
    checks: ["依日期區間與據點切分", "保留匯出批次紀錄", "缺附件列入補件清單"],
  },
  {
    key: "service_geo",
    title: "公司定點打卡",
    description: "以公司據點 GPS、Wi-Fi、IP 為主要依據，支援固定上班時段與異常送審。",
    href: "/clock",
    owner: "員工 / 主管",
    icon: MapPinned,
    tone: "bg-cyan-50 text-cyan-700",
    checks: ["超出範圍可送審但標異常", "保留地址、裝置與 IP", "補卡需附原因與佐證"],
  },
];

export const careScenarios: CareScenario[] = [
  {
    title: "評鑑補件",
    trigger: "證照附件缺漏、教育訓練時數不足、督導紀錄未完成",
    systemAction: "產生補件清單，串接證照、訓練、評鑑匯出與通知中心。",
    href: "/assessment-exports",
  },
];

export const careComplianceChecks = [
  { label: "證照資格", detail: "證照過期、缺訓或附件缺漏者需進入補件與提醒流程。", icon: ShieldCheck },
  { label: "定點打卡", detail: "公司據點 GPS、Wi-Fi/IP 與異常送審需留下稽核軌跡。", icon: MapPinned },
  { label: "評鑑留痕", detail: "清冊、附件、匯出批次與補件狀態需能追溯。", icon: FileWarning },
];
