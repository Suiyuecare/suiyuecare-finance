"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileBarChart,
  GitFork,
  Landmark,
  LockKeyhole,
  MapPin,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import {
  dayTypeLabels,
  defaultClockRuleSettings,
  normalizeClockRuleSettings,
  policyModeLabels,
  weekdayLabels,
  type ClockDayType,
  type ClockRuleSettings,
  type WeekdayKey,
} from "@/lib/attendance/clock-rule-settings";
import { hrRoles, rolePolicies, saveClientPermissionDrafts, type HrRole, type Permission } from "@/lib/auth/rbac";
import {
  dataScopeMeta,
  getPermissionMeta,
  permissionGroupDefinitions,
  type PermissionGroupKey,
} from "@/lib/auth/rbac-visualization";
import { csv, downloadTextFile } from "@/lib/client/download";
import {
  formatComplianceMessage,
  validateSettingPublication,
  type ComplianceIssue,
} from "@/lib/compliance/compliance-engine";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SettingCategory =
  | "公司基本資料"
  | "據點資料"
  | "部門資料"
  | "角色權限"
  | "打卡規則"
  | "班別規則"
  | "假別規則"
  | "加班規則"
  | "薪資規則"
  | "勞健保級距"
  | "簽核流程"
  | "通知設定"
  | "報表格式"
  | "系統參數";

type SettingStatus = "已啟用" | "待設定" | "需檢查";
type SettingTier = "上線必填" | "進階設定";

type SettingConfig = {
  category: SettingCategory;
  description: string;
  owner: string;
  status: SettingStatus;
  updatedAt: string;
  icon: LucideIcon;
  fields: string[];
};

const settingConfigs: SettingConfig[] = [
  { category: "公司基本資料", description: "公司名稱、統編、地址、聯絡資訊、時區與長照服務屬性。", owner: "行政部門主任", status: "已啟用", updatedAt: "2026-05-18", icon: Building2, fields: ["公司名稱", "統一編號", "負責人", "聯絡電話", "營業地址", "時區"] },
  { category: "據點資料", description: "總部、分店、辦公室與服務範圍設定。", owner: "人資", status: "已啟用", updatedAt: "2026-05-16", icon: MapPin, fields: ["據點代碼", "據點類型", "地址", "GPS 範圍", "IP 規則", "啟用狀態"] },
  { category: "部門資料", description: "部門層級、主管、所屬據點與成本中心。", owner: "人資", status: "已啟用", updatedAt: "2026-05-15", icon: BriefcaseBusiness, fields: ["部門代碼", "部門名稱", "上層部門", "部門主管", "成本中心"] },
  { category: "角色權限", description: "角色選單、資料範圍、敏感欄位與薪資權限控管。", owner: "執行長", status: "需檢查", updatedAt: "2026-05-12", icon: ShieldCheck, fields: ["角色", "功能權限", "資料範圍", "薪資權限", "個資欄位", "代理權限"] },
  { category: "打卡規則", description: "固定據點 GPS、Wi-Fi、IP、異常送審與補卡限制。", owner: "人資", status: "已啟用", updatedAt: "2026-05-17", icon: Clock3, fields: ["GPS 半徑", "Wi-Fi SSID", "允許 IP", "異常送審", "裝置限制"] },
  { category: "班別規則", description: "日班、晚班、夜班、跨日、休息時間與彈性打卡。", owner: "人資", status: "已啟用", updatedAt: "2026-05-14", icon: CalendarDays, fields: ["班別名稱", "上下班時間", "休息時間", "是否跨日", "寬限分鐘", "班別顏色"] },
  { category: "假別規則", description: "特休、病假、事假、生理假、家庭照顧假與附件要求。", owner: "人資", status: "需檢查", updatedAt: "2026-05-11", icon: CalendarClock, fields: ["假別", "支薪比例", "扣全勤", "最小單位", "年度額度", "附件要求"] },
  { category: "加班規則", description: "平日、休息日、例假日、國定假日與補休轉換。", owner: "人資", status: "已啟用", updatedAt: "2026-05-10", icon: SlidersHorizontal, fields: ["加班類型", "倍率", "上限提醒", "補休換算", "申請期限"] },
  { category: "薪資規則", description: "薪資型態、津貼、獎金、扣款、結算與鎖定規則。", owner: "行政部門主任", status: "待設定", updatedAt: "2026-05-09", icon: Landmark, fields: ["薪資月份", "結算流程", "津貼", "扣款", "鎖定規則", "調整紀錄"] },
  { category: "勞健保級距", description: "勞保、健保、勞退、二代健保費率與級距維護。", owner: "行政部門主任", status: "已啟用", updatedAt: "2026-05-08", icon: UsersRound, fields: ["勞保級距", "健保級距", "費率", "眷屬人數", "勞退比例", "補充保費"] },
  { category: "簽核流程", description: "單層、多層、串簽、會簽、條件式與代理簽核。", owner: "人資", status: "已啟用", updatedAt: "2026-05-13", icon: GitFork, fields: ["流程類型", "簽核人", "條件", "代理人", "退回補件", "通知"] },
  { category: "通知設定", description: "站內通知、Email 通知、提醒頻率與通知對象。", owner: "行政部門主任", status: "待設定", updatedAt: "2026-05-07", icon: Bell, fields: ["通知類型", "Email", "站內通知", "提醒頻率", "收件角色"] },
  { category: "報表格式", description: "Excel、CSV、欄位顯示、排序、篩選與公司版型。", owner: "人資", status: "已啟用", updatedAt: "2026-05-06", icon: FileBarChart, fields: ["報表類型", "預設欄位", "排序", "匯出格式", "頁首頁尾"] },
  { category: "系統參數", description: "語系、資料保留天數、稽核、備份、API 與模組開關。", owner: "執行長", status: "需檢查", updatedAt: "2026-05-05", icon: Settings2, fields: ["語系", "保留天數", "備份", "Audit Logs", "API Key", "模組開關"] },
];

const launchRequiredCategories: SettingCategory[] = [
  "公司基本資料",
  "據點資料",
  "部門資料",
  "角色權限",
  "打卡規則",
  "班別規則",
  "假別規則",
  "加班規則",
  "薪資規則",
  "勞健保級距",
  "簽核流程",
  "通知設定",
];

const launchRequirementNotes: Partial<Record<SettingCategory, string>> = {
  公司基本資料: "沒有公司主檔，員工、薪資、報表與合約抬頭都不能正式使用。",
  據點資料: "據點會影響員工歸屬、GPS 打卡、報表篩選與長照評鑑匯出。",
  部門資料: "部門與主管是簽核流程、資料權限與主管端入口的基礎。",
  角色權限: "上線前必須確認組員、主管、人資、行政主任、執行長能看的資料範圍。",
  打卡規則: "打卡規則未定，出勤異常、補卡與薪資扣款都會失準。",
  班別規則: "班別是排班、遲到早退、工時與薪資計算的來源。",
  假別規則: "假別規則需符合法規底線，低於法規不得發布。",
  加班規則: "加班倍率與上限會影響勞基法合規與薪資結算。",
  薪資規則: "薪資流程、鎖定與調整紀錄未定，不可進入正式結薪。",
  勞健保級距: "級距與費率需可維護，避免勞健保與勞退計算錯誤。",
  簽核流程: "請假、加班、補卡、薪資調整都要有固定簽核路徑。",
  通知設定: "沒有通知，簽核、證照到期、薪資發布容易漏處理。",
};

const systemSettingKeyMap: Record<SettingCategory, string> = {
  公司基本資料: "company_profile",
  據點資料: "branch_profile",
  部門資料: "department_profile",
  角色權限: "role_permissions",
  打卡規則: "punch_rules",
  班別規則: "shift_rules",
  假別規則: "leave_rules",
  加班規則: "overtime_rules",
  薪資規則: "payroll_rules",
  勞健保級距: "insurance_grades",
  簽核流程: "approval_flows",
  通知設定: "notification_settings",
  報表格式: "report_formats",
  系統參數: "system_parameters",
};

const weekdayOptions = Object.entries(weekdayLabels) as Array<[WeekdayKey, string]>;
const dayTypeOptions = Object.entries(dayTypeLabels) as Array<[ClockDayType, string]>;

function getSettingTier(category: SettingCategory): SettingTier {
  return launchRequiredCategories.includes(category) ? "上線必填" : "進階設定";
}

const statusStyles: Record<SettingStatus, string> = {
  已啟用: "border-emerald-200 bg-emerald-50 text-emerald-700",
  待設定: "border-amber-200 bg-amber-50 text-amber-700",
  需檢查: "border-rose-200 bg-rose-50 text-rose-700",
};

const permissionMatrix: { label: string; permission: Permission }[] = [
  { label: "員工自助", permission: "request:create" },
  { label: "表單簽核", permission: "request:approve" },
  { label: "假勤表單", permission: "form:attendance:create" },
  { label: "異動表單", permission: "form:change:create" },
  { label: "文件表單", permission: "form:document:create" },
  { label: "業務表單", permission: "form:business:create" },
  { label: "總務表單", permission: "form:general_affairs:create" },
  { label: "人員主檔", permission: "employee:view" },
  { label: "員工聯絡", permission: "employee:contact:view" },
  { label: "身分證", permission: "employee:national_id:view" },
  { label: "人員維護", permission: "employee:manage" },
  { label: "出勤異常", permission: "attendance:abnormal:review" },
  { label: "薪資彙總", permission: "payroll:aggregate:view" },
  { label: "個人薪資", permission: "payroll:individual:view" },
  { label: "發布薪資袋", permission: "payroll:payslip:publish" },
  { label: "報表匯出", permission: "analytics:export" },
  { label: "權限發布", permission: "permission:settings:publish" },
];

const riskStyles = {
  一般: "border-slate-200 bg-slate-50 text-slate-600",
  敏感: "border-amber-200 bg-amber-50 text-amber-700",
  高敏感: "border-rose-200 bg-rose-50 text-rose-700",
};

const riskWeight = {
  一般: 1,
  敏感: 2,
  高敏感: 3,
};

const protectedRolePermissions: Record<HrRole, Permission[]> = {
  team_member: ["dashboard:view", "request:create", "request:own:view", "payroll:self:view", "attendance:self:punch"],
  supervisor: ["dashboard:view", "employee:view", "employee:contact:view", "attendance:view", "request:approve", "request:team:view"],
  hr: ["dashboard:view", "employee:view", "employee:manage", "employee:sensitive:view", "employee:national_id:view"],
  admin_director: ["dashboard:view", "system:settings", "permission:settings:view", "permission:settings:publish"],
  ceo: ["dashboard:view", "system:settings", "permission:settings:view", "permission:settings:publish"],
};

const forbiddenRolePermissions: Partial<Record<HrRole, Permission[]>> = {
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

const roleGuardrails: Record<HrRole, string[]> = {
  team_member: ["只能看本人資料、本人表單、本人薪資袋。", "不得開通查看他人員工主檔、敏感個資或薪資清冊。"],
  supervisor: ["可看部門管理必要資料。", "不得查看員工身分證、地址、銀行帳號與個人薪資。"],
  hr: ["可查看人員主檔與敏感個資。", "薪資與個資操作需保留稽核紀錄。"],
  admin_director: ["公司範圍內最高行政權限。", "可看全部功能與敏感資料，調整權限需複核。"],
  ceo: ["全集團最高決策權限。", "預設可看薪資總額與經營報表；若要看個人薪資明細，需另行開通高敏感權限並留稽核。"],
};

function uniquePermissions(permissions: Permission[]) {
  return Array.from(new Set(permissions));
}

function buildInitialPermissionDrafts(): Record<HrRole, Permission[]> {
  return Object.fromEntries(
    hrRoles.map((role) => [role, uniquePermissions(rolePolicies[role].permissions)]),
  ) as Record<HrRole, Permission[]>;
}

function isProtectedPermission(role: HrRole, permission: Permission) {
  return protectedRolePermissions[role].includes(permission);
}

function isForbiddenPermission(role: HrRole, permission: Permission) {
  return forbiddenRolePermissions[role]?.includes(permission) ?? false;
}

function buildRolePermissionGroups(role: HrRole, permissions: Permission[]) {
  const grantedSet = new Set(permissions);

  return permissionGroupDefinitions.map((group) => {
    const groupPermissions = group.permissions.map(getPermissionMeta);
    const granted = groupPermissions.filter((permission) => grantedSet.has(permission.permission));

    return {
      ...group,
      permissions: groupPermissions,
      granted,
      denied: groupPermissions.filter((permission) => !grantedSet.has(permission.permission)),
      grantedCount: granted.length,
      totalCount: groupPermissions.length,
    };
  });
}

function buildRolePermissionSummary(role: HrRole, permissions: Permission[]) {
  const metas = uniquePermissions(permissions).map(getPermissionMeta);
  const highRiskCount = metas.filter((permission) => permission.risk === "高敏感").length;
  const sensitiveCount = metas.filter((permission) => riskWeight[permission.risk] >= riskWeight["敏感"]).length;
  const policy = rolePolicies[role];

  return {
    role,
    label: policy.label,
    description: policy.description,
    dataScope: policy.dataScope,
    dataScopeMeta: dataScopeMeta[policy.dataScope],
    totalPermissions: metas.length,
    sensitiveCount,
    highRiskCount,
    permissions: metas,
  };
}

export default function SettingsPage() {
  const [activeCategory, setActiveCategory] = useState<SettingCategory>("公司基本資料");
  const [activeTier, setActiveTier] = useState<SettingTier>("上線必填");
  const [selectedRole, setSelectedRole] = useState<HrRole>("team_member");
  const [selectedPermissionGroup, setSelectedPermissionGroup] = useState<PermissionGroupKey>("requests");
  const [permissionDrafts, setPermissionDrafts] = useState<Record<HrRole, Permission[]>>(() => buildInitialPermissionDrafts());
  const [permissionDraftMessage, setPermissionDraftMessage] = useState("權限尚未調整；目前顯示系統預設角色權限。");
  const [permissionChangeReason, setPermissionChangeReason] = useState("");
  const [permissionSecondApprover, setPermissionSecondApprover] = useState("行政部門主任");
  const [permissionRiskConfirmed, setPermissionRiskConfirmed] = useState(false);
  const [message, setMessage] = useState("請選擇設定分類，確認欄位後儲存設定。");
  const [lastOperationAt, setLastOperationAt] = useState<Date | null>(null);
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([]);
  const [punchSettings, setPunchSettings] = useState<ClockRuleSettings>(defaultClockRuleSettings);
  const [punchSettingsMessage, setPunchSettingsMessage] = useState("打卡規則會寫入 Supabase system_settings.punch_rules，員工打卡頁會即時讀取。");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let isMounted = true;

    async function loadPunchSettings() {
      const { data, error } = await (supabase as any)
        .from("system_settings")
        .select("settings,status,updated_at")
        .eq("setting_key", "punch_rules")
        .is("deleted_at", null)
        .maybeSingle();

      if (!isMounted) return;
      if (error) {
        setPunchSettingsMessage(`打卡規則載入失敗：${error.message}；目前顯示系統預設。`);
        return;
      }
      if (data?.settings) {
        setPunchSettings(normalizeClockRuleSettings(data.settings));
        setPunchSettingsMessage(`已從 Supabase 載入打卡規則，狀態：${data.status ?? "未知"}。`);
      }
    }

    void loadPunchSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  const activeConfig = useMemo(
    () => settingConfigs.find((config) => config.category === activeCategory) ?? settingConfigs[0],
    [activeCategory],
  );
  const readyCount = settingConfigs.filter((config) => config.status === "已啟用").length;
  const attentionCount = settingConfigs.length - readyCount;
  const launchRequiredConfigs = settingConfigs.filter((config) => getSettingTier(config.category) === "上線必填");
  const advancedConfigs = settingConfigs.filter((config) => getSettingTier(config.category) === "進階設定");
  const visibleSettingConfigs = activeTier === "上線必填" ? launchRequiredConfigs : advancedConfigs;
  const launchReadyCount = launchRequiredConfigs.filter((config) => config.status === "已啟用").length;
  const launchBlockingCount = launchRequiredConfigs.length - launchReadyCount;
  const advancedReadyCount = advancedConfigs.filter((config) => config.status === "已啟用").length;
  const roleSummaries = useMemo(
    () => hrRoles.map((role) => buildRolePermissionSummary(role, permissionDrafts[role])),
    [permissionDrafts],
  );
  const selectedRoleSummary =
    roleSummaries.find((summary) => summary.role === selectedRole) ??
    buildRolePermissionSummary(selectedRole, permissionDrafts[selectedRole]);
  const selectedRoleGroups = useMemo(
    () => buildRolePermissionGroups(selectedRole, permissionDrafts[selectedRole]),
    [permissionDrafts, selectedRole],
  );
  const selectedGroup =
    selectedRoleGroups.find((group) => group.key === selectedPermissionGroup) ?? selectedRoleGroups[0];
  const selectedHighRiskPermissions = selectedRoleSummary.permissions.filter((permission) => permission.risk === "高敏感");
  const selectedSensitivePermissions = selectedRoleSummary.permissions.filter((permission) => permission.risk !== "一般");
  const isPermissionSettingActive = activeCategory === "角色權限";
  const isPunchRuleSettingActive = activeCategory === "打卡規則";

  function updatePunchSetting<K extends keyof ClockRuleSettings>(key: K, value: ClockRuleSettings[K]) {
    setPunchSettings((current) => ({ ...current, [key]: value }));
    setPunchSettingsMessage("打卡規則已調整；請按儲存草稿或發布套用寫入 Supabase。");
  }

  function togglePunchWeekday(type: "regularHolidayWeekdays" | "restDayWeekdays", weekday: WeekdayKey) {
    setPunchSettings((current) => {
      const currentSet = new Set(current[type]);
      if (currentSet.has(weekday)) currentSet.delete(weekday);
      else currentSet.add(weekday);
      return { ...current, [type]: Array.from(currentSet) };
    });
    setPunchSettingsMessage("例假日/休息日設定已調整；四週變形工時請確認每二週至少 2 日例假、四週例休至少 8 日。");
  }

  function updateDayRule(dayType: ClockDayType, key: keyof ClockRuleSettings["dayRules"][ClockDayType], value: string | number | boolean) {
    setPunchSettings((current) => ({
      ...current,
      dayRules: {
        ...current.dayRules,
        [dayType]: {
          ...current.dayRules[dayType],
          [key]: value,
        },
      },
    }));
    setPunchSettingsMessage(`${dayTypeLabels[dayType]} 打卡規則已調整。`);
  }

  function updateEmployeePolicy(index: number, key: keyof ClockRuleSettings["employeePolicies"][number], value: string | number | boolean | null) {
    setPunchSettings((current) => ({
      ...current,
      employeePolicies: current.employeePolicies.map((policy, policyIndex) =>
        policyIndex === index ? { ...policy, [key]: value } : policy,
      ),
    }));
    setPunchSettingsMessage("員工個別打卡政策已調整。");
  }

  function switchTier(nextTier: SettingTier) {
    setActiveTier(nextTier);
    const firstConfig = settingConfigs.find((config) => getSettingTier(config.category) === nextTier);
    if (firstConfig && getSettingTier(activeCategory) !== nextTier) {
      setActiveCategory(firstConfig.category);
    }
  }

  function togglePermission(role: HrRole, permission: Permission) {
    if (isProtectedPermission(role, permission)) {
      setPermissionDraftMessage(`${rolePolicies[role].label} 的「${getPermissionMeta(permission).label}」是角色基本權限，不能在畫面上直接關閉。`);
      return;
    }

    if (isForbiddenPermission(role, permission)) {
      setPermissionDraftMessage(`${rolePolicies[role].label} 不能開通「${getPermissionMeta(permission).label}」，這會違反目前設定的角色資料權限底線。`);
      return;
    }

    const permissionMeta = getPermissionMeta(permission);
    setPermissionDrafts((current) => {
      const nextPermissions = new Set(current[role]);
      if (nextPermissions.has(permission)) {
        nextPermissions.delete(permission);
      } else {
        nextPermissions.add(permission);
      }

      return {
        ...current,
        [role]: uniquePermissions(Array.from(nextPermissions)),
      };
    });
    setActiveCategory("角色權限");
    setPermissionDraftMessage(`${rolePolicies[role].label} 的「${permissionMeta.label}」已調整；發布套用前需填寫理由、指定複核人並確認敏感資料影響。`);
  }

  function resetRolePermissions(role: HrRole) {
    setPermissionDrafts((current) => ({
      ...current,
      [role]: uniquePermissions(rolePolicies[role].permissions),
    }));
    setPermissionDraftMessage(`${rolePolicies[role].label} 已還原為系統預設權限。`);
  }

  function checkActiveConfig(publish = false) {
    if (publish && isPunchRuleSettingActive) {
      const regularHolidayCount = punchSettings.regularHolidayWeekdays.length;
      const totalRestCount = new Set([...punchSettings.regularHolidayWeekdays, ...punchSettings.restDayWeekdays]).size;
      if (punchSettings.mode === "four_week_flexible" && (regularHolidayCount < 1 || totalRestCount < 2)) {
        setComplianceIssues([]);
        setMessage("四週變形工時的例假/休息日設定不足：每二週至少 2 日例假、每四週例假加休息日至少 8 日。請至少設定週期內的例假與休息日基準，低於法規不得發布。");
        setLastOperationAt(new Date());
        return false;
      }
      if (punchSettings.dayRules.regular_holiday.allowAbnormalReview) {
        setComplianceIssues([]);
        setMessage("例假日規則不可任意放寬為一般異常送審；例假日出勤須有法定例外原因，請關閉例假日任意送審後再發布。");
        setLastOperationAt(new Date());
        return false;
      }
    }

    if (publish && isPermissionSettingActive) {
      const reasonReady = permissionChangeReason.trim().length >= 12;
      const approverReady = Boolean(permissionSecondApprover.trim());
      if (!reasonReady || !approverReady || !permissionRiskConfirmed) {
        setComplianceIssues([]);
        setMessage("角色權限屬高風險設定；發布前需填寫 12 字以上調整理由、指定複核人，並勾選已確認敏感資料與薪資影響。");
        setLastOperationAt(new Date());
        return false;
      }
    }

    const compliance = validateSettingPublication(activeConfig);
    setComplianceIssues(compliance.issues);

    if (compliance.blocked) {
      setMessage(formatComplianceMessage(compliance));
      setLastOperationAt(new Date());
      return false;
    }

    setMessage(publish ? `${activeConfig.category} 已通過法規檢核，可以發布套用並寫入稽核紀錄。` : `${activeConfig.category} 法規檢核通過。`);
    setLastOperationAt(new Date());
    return true;
  }

  async function saveSetting(status: "draft" | "active") {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Supabase 尚未設定，系統設定不可儲存。");
      setLastOperationAt(new Date());
      return;
    }

    const { data: company } = await (supabase as any)
      .from("companies")
      .select("id")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!company?.id) {
      setMessage("找不到公司主檔，系統設定不可儲存。");
      setLastOperationAt(new Date());
      return;
    }

    const settingKey = systemSettingKeyMap[activeConfig.category];
    const settingsPayload = isPunchRuleSettingActive
      ? {
          ...punchSettings,
          legalBasis: {
            source: "勞動部：勞基法第36條例假與休息日、四週彈性工時底線",
            notes: punchSettings.legalNotes,
          },
        }
      : {
          category: activeConfig.category,
          fields: activeConfig.fields,
          status,
          permissionGovernance: isPermissionSettingActive
            ? {
                model: "role-based-access-control",
                editableByRoles: ["hr", "admin_director", "ceo"],
                selectedRole,
                selectedRoleLabel: rolePolicies[selectedRole].label,
                selectedPermissionGroup,
                reason: permissionChangeReason.trim(),
                secondApprover: permissionSecondApprover.trim(),
                riskConfirmed: permissionRiskConfirmed,
                draftPermissions: permissionDrafts,
                roleLayers: hrRoles.map((role) => ({
                  role,
                  label: rolePolicies[role].label,
                  dataScope: rolePolicies[role].dataScope,
                  permissions: permissionDrafts[role],
                })),
                highRiskPermissions: selectedHighRiskPermissions.map((permission) => permission.permission),
              }
            : undefined,
        };

    const { error } = await (supabase as any)
      .from("system_settings")
      .upsert({
        company_id: company.id,
        setting_key: settingKey,
        category: settingKey,
        display_name: activeConfig.category,
        settings: settingsPayload,
        status,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,setting_key" });

    if (!error && status === "active" && isPermissionSettingActive) {
      saveClientPermissionDrafts(permissionDrafts);
    }

    setMessage(error ? error.message : `${activeConfig.category} 已${status === "active" ? "發布" : "儲存草稿"}到 Supabase。${!error && status === "active" && isPermissionSettingActive ? " 權限已同步套用到此裝置選單與表單入口。" : ""}`);
    setLastOperationAt(new Date());
  }

  function publishActiveConfig() {
    if (!checkActiveConfig(true)) return;
    void saveSetting("active");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-cyan-700">System Settings Center</p>
          <h1 className="text-2xl font-semibold text-slate-950">系統設定中心</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            設定已拆成「上線必填」與「進階設定」。上線必填未完成時，不建議開放正式打卡、表單、排班與薪資結算；進階設定可在產品運作後逐步優化。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              void saveSetting("draft");
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <Save className="h-4 w-4" />
            儲存草稿
          </button>
          <button
            onClick={publishActiveConfig}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <ShieldCheck className="h-4 w-4" />
            發布套用
          </button>
          <button
            onClick={() =>
              downloadTextFile(
                "system-settings.csv",
                csv([
                  ["設定分類", "描述", "負責人", "狀態", "更新日期", "欄位"],
                  ...settingConfigs.map((config) => [
                    config.category,
                    config.description,
                    config.owner,
                    config.status,
                    config.updatedAt,
                    config.fields.join("、"),
                  ]),
                ]),
              )
            }
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
          >
            <FileBarChart className="h-4 w-4" />
            匯出設定
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "上線必填", value: `${launchReadyCount}/${launchRequiredConfigs.length}`, detail: launchBlockingCount ? `${launchBlockingCount} 項需完成才可安心上線` : "上線前置已完成", icon: ClipboardCheck, tone: "bg-rose-50 text-rose-700" },
          { label: "進階設定", value: `${advancedReadyCount}/${advancedConfigs.length}`, detail: "可於上線後分階段優化", icon: Settings2, tone: "bg-cyan-50 text-cyan-700" },
          { label: "已啟用", value: readyCount, detail: "全部設定中可直接套用", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "待處理", value: attentionCount, detail: "待設定或需檢查", icon: ShieldCheck, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-rose-950">上線必填設定</h2>
              <p className="mt-1 text-sm text-rose-800">
                這些設定會直接影響登入權限、打卡、排班、請假加班、補卡、薪資與通知。未完成時，正式營運容易產生資料斷點。
              </p>
            </div>
            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700">
              {launchBlockingCount ? `待處理 ${launchBlockingCount}` : "可上線"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {launchRequiredConfigs.map((config) => (
              <button
                key={config.category}
                type="button"
                onClick={() => {
                  setActiveTier("上線必填");
                  setActiveCategory(config.category);
                }}
                className="rounded-lg bg-white p-4 text-left shadow-sm transition hover:bg-rose-100"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-slate-950">{config.category}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyles[config.status]}`}>
                    {config.status}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {launchRequirementNotes[config.category] ?? config.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">進階設定</h2>
              <p className="mt-1 text-sm text-slate-500">
                報表格式、系統參數等項目不應擋住第一天上線，但要納入第二階段產品化與稽核治理。
              </p>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
              {advancedConfigs.length} 項
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {advancedConfigs.map((config) => (
              <button
                key={config.category}
                type="button"
                onClick={() => {
                  setActiveTier("進階設定");
                  setActiveCategory(config.category);
                }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-cyan-200 hover:bg-cyan-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-slate-950">{config.category}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyles[config.status]}`}>
                    {config.status}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{config.description}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-cyan-700">Permission Experience</p>
              <h2 className="text-lg font-semibold text-slate-950">角色權限視覺化</h2>
            </div>
            <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
              <LockKeyhole className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            管理者可直接比較每個角色的資料範圍、敏感權限與功能覆蓋，不需要看代碼才知道誰能做什麼。
          </p>

          <div className="mt-4 space-y-2">
            {roleSummaries.map((summary) => (
              <button
                key={summary.role}
                onClick={() => setSelectedRole(summary.role)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedRole === summary.role
                    ? "border-cyan-300 bg-cyan-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-cyan-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-950">{summary.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{summary.dataScopeMeta.label}</div>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                    {summary.totalPermissions} 權限
                  </span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-cyan-500"
                    style={{ width: `${(summary.dataScopeMeta.level / 6) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>資料範圍</span>
                  <span>{summary.dataScopeMeta.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-cyan-700">Selected Role</p>
              <h2 className="text-xl font-semibold text-slate-950">{selectedRoleSummary.label}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{selectedRoleSummary.description}</p>
            </div>
            <div className="grid min-w-[260px] grid-cols-3 gap-2 text-center">
              {[
                { label: "總權限", value: selectedRoleSummary.totalPermissions, tone: "bg-slate-50 text-slate-700" },
                { label: "敏感", value: selectedRoleSummary.sensitiveCount, tone: "bg-amber-50 text-amber-700" },
                { label: "高敏感", value: selectedRoleSummary.highRiskCount, tone: "bg-rose-50 text-rose-700" },
              ].map((item) => (
                <div key={item.label} className={`rounded-lg px-3 py-2 ${item.tone}`}>
                  <div className="text-lg font-bold">{item.value}</div>
                  <div className="text-xs font-semibold">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {hrRoles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className={`rounded-lg border p-3 text-left transition ${
                  selectedRole === role
                    ? "border-cyan-300 bg-cyan-50"
                    : "border-slate-200 bg-white hover:border-cyan-200"
                }`}
              >
                <div className="text-sm font-black text-slate-950">{rolePolicies[role].label}</div>
                <div className="mt-2 space-y-1">
                  {roleGuardrails[role].map((guardrail) => (
                    <p key={guardrail} className="text-xs leading-5 text-slate-500">
                      {guardrail}
                    </p>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-white p-2 text-rose-700 shadow-sm">
                  <ShieldAlert className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-black text-rose-950">權限調整需要二次治理</h3>
                  <p className="mt-1 text-sm leading-6 text-rose-800">
                    角色權限會影響員工個資、薪資、表單簽核、系統設定與報表可見範圍。發布前必須留下調整理由、複核人與敏感權限確認，後續要寫入稽核紀錄。
                  </p>
                </div>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700">
                {selectedHighRiskPermissions.length} 個高敏感權限
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { label: "高敏感權限", value: `${selectedHighRiskPermissions.length}`, detail: "個資、薪資、系統設定、法遵發布" },
                { label: "敏感以上權限", value: `${selectedSensitivePermissions.length}`, detail: "需確認資料範圍與職務必要性" },
                { label: "資料範圍", value: selectedRoleSummary.dataScopeMeta.label, detail: selectedRoleSummary.dataScopeMeta.description },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-white p-3 shadow-sm">
                  <div className="text-xs font-semibold text-rose-700">{item.label}</div>
                  <div className="mt-1 text-lg font-black text-slate-950">{item.value}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_260px]">
              <label className="space-y-1 text-sm font-semibold text-rose-950">
                權限調整理由
                <textarea
                  value={permissionChangeReason}
                  onChange={(event) => setPermissionChangeReason(event.target.value)}
                  placeholder="請說明為什麼要調整此角色權限，例如職務變更、稽核要求、薪資流程重整。至少 12 字。"
                  className="min-h-24 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none focus:border-rose-400"
                />
              </label>
              <label className="space-y-1 text-sm font-semibold text-rose-950">
                複核人
                <select
                  value={permissionSecondApprover}
                  onChange={(event) => setPermissionSecondApprover(event.target.value)}
                  className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                >
                  <option>行政部門主任</option>
                  <option>執行長</option>
                  <option>人資主管</option>
                </select>
                <div className="mt-3 rounded-lg bg-white p-3 text-xs leading-5 text-slate-600">
                  高敏感權限建議至少由非申請人複核；涉及薪資或個資時，需保留調整前後紀錄。
                </div>
              </label>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={permissionRiskConfirmed}
                onChange={(event) => setPermissionRiskConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-rose-300"
              />
              我已確認此角色若取得敏感或高敏感權限，可能看到個資、薪資、簽核、報表或系統設定；本次調整符合職務必要性，且需要留存稽核紀錄。
            </label>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {selectedHighRiskPermissions.slice(0, 6).map((permission) => (
                <div key={permission.permission} className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <div className="font-bold text-slate-950">{permission.label}</div>
                    <div className="mt-0.5 text-xs leading-5 text-slate-500">{permission.description}</div>
                  </div>
                </div>
              ))}
              {!selectedHighRiskPermissions.length ? (
                <div className="rounded-lg bg-white p-3 text-sm font-semibold text-emerald-700">
                  此角色目前沒有高敏感權限，但仍需確認資料範圍。
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">資料可見範圍：{selectedRoleSummary.dataScopeMeta.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{selectedRoleSummary.dataScopeMeta.description}</p>
              </div>
              <div className="flex min-w-[260px] items-center gap-1">
                {(["self", "team", "department", "company", "all_companies"] as const).map((scope) => {
                  const active = dataScopeMeta[scope].level <= selectedRoleSummary.dataScopeMeta.level;

                  return (
                    <span
                      key={scope}
                      className={`h-2 flex-1 rounded-full ${active ? "bg-cyan-500" : "bg-slate-200"}`}
                      title={dataScopeMeta[scope].label}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {permissionGroupDefinitions.map((group) => {
              const roleGroup = selectedRoleGroups.find((item) => item.key === group.key);

              return (
                <button
                  key={group.key}
                  onClick={() => setSelectedPermissionGroup(group.key)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    selectedPermissionGroup === group.key
                      ? "border-cyan-300 bg-cyan-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200"
                  }`}
                >
                  {group.label}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    selectedPermissionGroup === group.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}>
                    {roleGroup?.grantedCount ?? 0}/{roleGroup?.totalCount ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-950">{selectedGroup.label}</h3>
                  <p className="text-sm leading-6 text-slate-500">{selectedGroup.description}</p>
                </div>
                <p className="text-xs font-semibold text-slate-500">
                  已開通 {selectedGroup.grantedCount} / {selectedGroup.totalCount}
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {selectedGroup.permissions.map((permission) => {
                  const allowed = selectedGroup.granted.some((granted) => granted.permission === permission.permission);
                  const protectedPermission = isProtectedPermission(selectedRole, permission.permission);
                  const forbiddenPermission = isForbiddenPermission(selectedRole, permission.permission);

                  return (
                    <label
                      key={permission.permission}
                      className={`rounded-lg border p-3 ${allowed ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={allowed}
                            disabled={protectedPermission || forbiddenPermission}
                            onChange={() => togglePermission(selectedRole, permission.permission)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 disabled:opacity-50"
                          />
                          <div>
                          <div className={`font-semibold ${allowed ? "text-emerald-900" : "text-slate-500"}`}>{permission.label}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{permission.description}</div>
                          {protectedPermission ? (
                            <div className="mt-2 w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-cyan-700">
                              角色基本權限
                            </div>
                          ) : null}
                          {forbiddenPermission ? (
                            <div className="mt-2 w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-rose-700">
                              角色資安限制
                            </div>
                          ) : null}
                          </div>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${riskStyles[permission.risk]}`}>
                          {permission.risk}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                        <span className="font-mono text-slate-400">{permission.permission}</span>
                        <span className={allowed ? "text-emerald-700" : "text-slate-400"}>{allowed ? "已開通" : "未開通"}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-700">Role Permission Matrix</p>
            <h2 className="text-lg font-semibold text-slate-950">五層帳號權限分配</h2>
            <p className="mt-1 text-sm text-slate-500">
              比照會計系統，HRIS 帳號分為組員、主管、人資、行政部門主任、執行長；權限需同步寫入 roles / role_permissions，並由 Supabase RLS 強制執行。
            </p>
          </div>
          <div className="text-xs font-semibold text-rose-600">禁止共用預設密碼，正式帳號需由 Supabase Auth 建立。</div>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-cyan-200 bg-cyan-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-black text-cyan-950">功能權限可用勾選管理</div>
            <p className="mt-1 text-sm leading-6 text-cyan-800">
              {permissionDraftMessage} 勾選結果會隨「儲存草稿 / 發布套用」寫入 Supabase system_settings，後續可接 roles / role_permissions 與 RLS 強制執行。
            </p>
          </div>
          <button
            type="button"
            onClick={() => resetRolePermissions(selectedRole)}
            className="w-fit rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm font-black text-cyan-700 shadow-sm"
          >
            還原目前角色
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <th className="px-3 py-3">角色</th>
                <th className="px-3 py-3">資料範圍</th>
                {permissionMatrix.map((item) => (
                  <th key={item.permission} className="px-3 py-3 text-center">
                    <div>{item.label}</div>
                    <span className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${riskStyles[getPermissionMeta(item.permission).risk]}`}>
                      {getPermissionMeta(item.permission).risk}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hrRoles.map((role) => {
                const policy = rolePolicies[role];

                return (
                  <tr key={role}>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{policy.label}</div>
                      <div className="mt-1 max-w-[260px] text-xs leading-5 text-slate-500">{policy.description}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        {dataScopeMeta[policy.dataScope].label}
                      </span>
                    </td>
                    {permissionMatrix.map((item) => {
                      const allowed = permissionDrafts[role].includes(item.permission);
                      const protectedPermission = isProtectedPermission(role, item.permission);
                      const forbiddenPermission = isForbiddenPermission(role, item.permission);
                      const permissionLabel = getPermissionMeta(item.permission).label;

                      return (
                        <td key={item.permission} className="px-3 py-3 text-center">
                          <label className="inline-flex flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              aria-label={`${policy.label} ${permissionLabel}`}
                              checked={allowed}
                              disabled={protectedPermission || forbiddenPermission}
                              onChange={() => togglePermission(role, item.permission)}
                              className="h-4 w-4 rounded border-slate-300 text-cyan-600 disabled:opacity-50"
                            />
                            <span className={`text-[10px] font-bold ${allowed ? "text-emerald-700" : "text-slate-300"}`}>
                              {protectedPermission ? "基本" : forbiddenPermission ? "限制" : allowed ? "開" : "關"}
                            </span>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">設定分類</h2>
            <p className="text-sm text-slate-500">先完成上線必填，再進入進階設定。</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["上線必填", "進階設定"] as SettingTier[]).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => switchTier(tier)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    activeTier === tier
                      ? "border-cyan-300 bg-cyan-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200"
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {visibleSettingConfigs.map((config) => (
              <button
                key={config.category}
                onClick={() => setActiveCategory(config.category)}
                className={`w-full p-4 text-left transition ${activeCategory === config.category ? "bg-cyan-50" : "bg-white hover:bg-slate-50"}`}
              >
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-white p-2 text-slate-700 shadow-sm">
                    <config.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-950">{config.category}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyles[config.status]}`}>{config.status}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{config.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-cyan-50 p-3 text-cyan-700">
                  <activeConfig.icon className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{activeConfig.category}</h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-500">{activeConfig.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={getSettingTier(activeConfig.category) === "上線必填" ? "rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700" : "rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700"}>
                      {getSettingTier(activeConfig.category)}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[activeConfig.status]}`}>{activeConfig.status}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">負責：{activeConfig.owner}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">更新：{activeConfig.updatedAt}</span>
                  </div>
                  {getSettingTier(activeConfig.category) === "上線必填" ? (
                    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-800">
                      上線必填原因：{launchRequirementNotes[activeConfig.category] ?? "此設定會影響正式營運資料流。"}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold leading-5 text-cyan-800">
                      進階設定：不阻擋第一天上線，可排入第二階段做報表、稽核、備份與系統參數精修。
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => checkActiveConfig(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                <ClipboardCheck className="h-4 w-4" />
                檢查設定
              </button>
            </div>

            {isPunchRuleSettingActive ? (
              <div className="mt-5 space-y-5">
                <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4">
                  <div className="text-sm font-black text-cyan-950">後台打卡規則會直接控制員工打卡頁</div>
                  <p className="mt-1 text-sm leading-6 text-cyan-800">{punchSettingsMessage}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="space-y-1 text-sm font-semibold text-slate-700">
                    工時制度
                    <select
                      value={punchSettings.mode}
                      onChange={(event) => updatePunchSetting("mode", event.target.value as ClockRuleSettings["mode"])}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    >
                      <option value="four_week_flexible">四週變形工時</option>
                      <option value="regular_week">一般週期</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm font-semibold text-slate-700">
                    四週週期起算日
                    <input
                      type="date"
                      value={punchSettings.fourWeekCycleStartDate}
                      onChange={(event) => updatePunchSetting("fourWeekCycleStartDate", event.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-sm font-semibold text-slate-700">
                    預設 GPS 半徑（公尺）
                    <input
                      type="number"
                      min={30}
                      value={punchSettings.defaultRadiusMeters}
                      onChange={(event) => updatePunchSetting("defaultRadiusMeters", Number(event.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    />
                  </label>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="font-black text-slate-950">例假日設定</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">四週變形工時仍需符合每二週至少 2 日例假；例假日打卡預設高風險。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {weekdayOptions.map(([weekday, label]) => (
                        <button
                          key={weekday}
                          type="button"
                          onClick={() => togglePunchWeekday("regularHolidayWeekdays", weekday)}
                          className={`rounded-full border px-3 py-1 text-xs font-black ${
                            punchSettings.regularHolidayWeekdays.includes(weekday)
                              ? "border-rose-200 bg-rose-600 text-white"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="font-black text-slate-950">休息日設定</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">四週變形工時每四週例假加休息日總數至少 8 日；低於底線不可發布。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {weekdayOptions.map(([weekday, label]) => (
                        <button
                          key={weekday}
                          type="button"
                          onClick={() => togglePunchWeekday("restDayWeekdays", weekday)}
                          className={`rounded-full border px-3 py-1 text-xs font-black ${
                            punchSettings.restDayWeekdays.includes(weekday)
                              ? "border-amber-200 bg-amber-500 text-white"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="font-black text-slate-950">平日 / 休息日 / 例假日 / 國定假日打卡規則</div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-4">
                    {dayTypeOptions.map(([dayType, label]) => {
                      const rule = punchSettings.dayRules[dayType];

                      return (
                        <div key={dayType} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="font-black text-slate-950">{label}</div>
                          <label className="mt-3 block text-xs font-semibold text-slate-600">
                            GPS 半徑
                            <input
                              type="number"
                              min={30}
                              value={rule.radiusMeters}
                              onChange={(event) => updateDayRule(dayType, "radiusMeters", Number(event.target.value))}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <div className="mt-3 space-y-2 text-xs font-semibold text-slate-700">
                            {[
                              ["requireGps", "必須 GPS"],
                              ["requireNetwork", "必須 Wi-Fi/IP"],
                              ["blockIfOutside", "超出範圍直接阻擋"],
                              ["allowAbnormalReview", "允許異常送審"],
                            ].map(([key, text]) => (
                              <label key={key} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rule[key as keyof typeof rule])}
                                  onChange={(event) => updateDayRule(dayType, key as keyof typeof rule, event.target.checked)}
                                />
                                {text}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="font-black text-slate-950">員工個別打卡政策</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">目前上線版本只針對定點上班人員，可為不同員工指定主要據點與 GPS 半徑覆寫。</p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-[680px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">員工</th>
                          <th className="px-3 py-2">政策</th>
                          <th className="px-3 py-2">主要地點</th>
                          <th className="px-3 py-2">半徑覆寫</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {punchSettings.employeePolicies.map((policy, index) => (
                          <tr key={`${policy.employeeNo}-${index}`}>
                            <td className="px-3 py-3">
                              <div className="font-semibold text-slate-950">{policy.employeeName}</div>
                              <div className="text-xs text-slate-500">{policy.employeeNo}</div>
                            </td>
                            <td className="px-3 py-3">
                              <select
                                value={policy.policyMode}
                                onChange={() => updateEmployeePolicy(index, "policyMode", "fixed_site")}
                                className="rounded-lg border border-slate-200 px-2 py-1"
                              >
                                <option value="fixed_site">{policyModeLabels.fixed_site}</option>
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <select
                                value={policy.primaryLocationRuleId}
                                onChange={(event) => updateEmployeePolicy(index, "primaryLocationRuleId", event.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-1"
                              >
                                {punchSettings.locationRules.map((rule) => (
                                  <option key={rule.id} value={rule.id}>{rule.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="number"
                                min={30}
                                value={policy.radiusOverrideMeters ?? ""}
                                placeholder="使用日別"
                                onChange={(event) => updateEmployeePolicy(index, "radiusOverrideMeters", event.target.value ? Number(event.target.value) : null)}
                                className="w-28 rounded-lg border border-slate-200 px-2 py-1"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="font-black text-amber-950">法規底線提醒</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-900">
                    {punchSettings.legalNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {activeConfig.fields.map((field) => (
                  <label key={field} className="space-y-1 text-sm font-medium text-slate-700">
                    {field}
                    <input
                      defaultValue={field.includes("狀態") || field.includes("開關") ? "啟用" : `${activeConfig.category} - ${field}`}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-700"
                    />
                  </label>
                ))}
              </div>
            )}

            <OperationFeedback
              className="mt-4"
              title="設定操作回饋"
              message={message}
              status={complianceIssues.some((issue) => issue.severity === "blocking") ? "blocked" : undefined}
              updatedAt={lastOperationAt ?? undefined}
              details={[activeConfig.category, activeConfig.owner, activeConfig.status]}
            />
            {complianceIssues.length ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-black text-amber-950">設定發布法規合規檢核</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {complianceIssues.map((issue) => (
                    <div key={issue.code} className="rounded-lg bg-white p-3 text-sm">
                      <div className={issue.severity === "blocking" ? "font-bold text-rose-700" : "font-bold text-amber-800"}>
                        {issue.severity === "blocking" ? "阻擋" : "提醒"} · {issue.title}
                      </div>
                      <p className="mt-1 text-slate-700">{issue.message}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{issue.law} · {issue.article}</p>
                      <p className="mt-1 text-xs text-slate-500">{issue.remediation}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">設定套用流程</h2>
              <div className="mt-4 space-y-3">
                {["填寫設定", "欄位與權限檢查", "高敏感權限需理由與複核", "儲存草稿", "發布套用", "寫入稽核紀錄"].map((step, index) => (
                  <div key={step} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700">{index + 1}</span>
                    <span className="text-sm font-medium text-slate-700">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">跨模組影響</h2>
              <p className="mt-1 text-sm text-slate-500">設定發布後會影響前端選單、申請表單、出勤判斷、薪資計算與報表輸出。</p>
              <div className="mt-4 grid gap-2">
                {["帳號與權限", "敏感個資可見範圍", "人員主檔", "假勤排班", "薪資總額與個人薪資", "通知與報表"].map((item) => (
                  <div key={item} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{item}</span>
                    <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">同步</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
