"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  HeartHandshake,
  Loader2,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  UserCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type MilestoneKey = "under_7_days" | "under_30_days" | "under_90_days" | "under_180_days" | "leaving_soon" | "terminated";
type RiskLevelKey = "low" | "medium" | "high";
type CareStatusKey = "not_started" | "scheduled" | "completed" | "follow_up_required";
type BonusStatusKey = "eligible" | "observing" | "not_eligible";
type RetentionStatusKey = "active" | "watching" | "retained" | "leaving" | "terminated";

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
  hire_date: string | null;
  termination_date: string | null;
  employment_status: "active" | "on_leave" | "suspended" | "terminated";
  primary_branch_id: string | null;
  primary_department_id: string | null;
  manager_employee_id: string | null;
  metadata?: Record<string, unknown> | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
  positions?: { title: string | null } | null;
  managers?: { full_name: string | null } | null;
};

type RetentionRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  employee_id: string;
  milestone: MilestoneKey;
  risk_level: RiskLevelKey;
  risk_score: number;
  care_status: CareStatusKey;
  retention_bonus_status: BonusStatusKey;
  retention_bonus_rule: string | null;
  termination_reason: string | null;
  expected_termination_date: string | null;
  status: RetentionStatusKey;
  next_care_date: string | null;
  owner_user_id: string | null;
  note: string | null;
  employees?: {
    employee_no: string | null;
    full_name: string | null;
    hire_date: string | null;
    termination_date: string | null;
    employment_status: string | null;
    metadata?: Record<string, unknown> | null;
    branches?: { name: string | null } | null;
    departments?: { name: string | null } | null;
    positions?: { title: string | null } | null;
  } | null;
};

type CareLogRow = {
  id: string;
  retention_record_id: string | null;
  employee_id: string;
  care_date: string;
  summary: string;
  next_follow_up_date: string | null;
  created_at: string;
};

type RetentionRecord = {
  id: string;
  employeeId: string;
  companyId: string;
  branchId: string | null;
  departmentId: string | null;
  employeeNo: string;
  employeeName: string;
  role: string;
  branch: string;
  department: string;
  hireDate: string;
  tenureDays: number;
  milestone: MilestoneKey;
  riskLevel: RiskLevelKey;
  riskScore: number;
  supervisor: string;
  careStatus: CareStatusKey;
  lastCareRecord: string;
  nextCareDate: string;
  bonusStatus: BonusStatusKey;
  bonusRule: string;
  terminationDate?: string;
  terminationReason?: string;
  action: string;
  persisted: boolean;
};

type CareForm = {
  recordId: string;
  summary: string;
  nextCareDate: string;
};

const milestoneLabels: Record<MilestoneKey, string> = {
  under_7_days: "到職未滿 7 天",
  under_30_days: "到職未滿 30 天",
  under_90_days: "到職未滿 90 天",
  under_180_days: "到職未滿 180 天",
  leaving_soon: "即將離職",
  terminated: "已離職",
};

const riskLabels: Record<RiskLevelKey, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const careLabels: Record<CareStatusKey, string> = {
  not_started: "未關懷",
  scheduled: "已排程",
  completed: "已完成",
  follow_up_required: "需追蹤",
};

const bonusLabels: Record<BonusStatusKey, string> = {
  eligible: "符合資格",
  observing: "觀察中",
  not_eligible: "不符合",
};

const riskStyles: Record<RiskLevelKey, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-rose-200 bg-rose-50 text-rose-700",
};

const careStyles: Record<CareStatusKey, string> = {
  not_started: "text-rose-700",
  scheduled: "text-sky-700",
  completed: "text-emerald-700",
  follow_up_required: "text-amber-700",
};

const milestones: MilestoneKey[] = ["under_7_days", "under_30_days", "under_90_days", "under_180_days", "leaving_soon", "terminated"];

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫留任追蹤。");
  return supabase as unknown as SupabaseClient;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(start: string | null, end = todayKey()) {
  if (!start) return 0;
  return Math.max(Math.floor((new Date(`${end}T00:00:00+08:00`).getTime() - new Date(`${start}T00:00:00+08:00`).getTime()) / 86_400_000), 0);
}

function inferMilestone(employee: EmployeeRow | RetentionRow["employees"]): MilestoneKey {
  const hireDate = employee?.hire_date ?? null;
  const terminationDate = employee?.termination_date ?? null;
  const status = employee?.employment_status;
  if (status === "terminated") return "terminated";
  if (terminationDate && terminationDate >= todayKey()) return "leaving_soon";
  const tenure = daysBetween(hireDate);
  if (tenure < 7) return "under_7_days";
  if (tenure < 30) return "under_30_days";
  if (tenure < 90) return "under_90_days";
  return "under_180_days";
}

function inferRisk(employee: EmployeeRow, milestone: MilestoneKey) {
  const metadataRisk = Number(employee.metadata?.retention_risk_score ?? 0);
  const base =
    milestone === "terminated" ? 100 :
    milestone === "leaving_soon" ? 90 :
    milestone === "under_7_days" ? 62 :
    milestone === "under_30_days" ? 45 :
    milestone === "under_90_days" ? 55 :
    25;
  const score = Math.min(Math.max(metadataRisk || base, 0), 100);
  const level: RiskLevelKey = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  return { score, level };
}

function inferBonusStatus(milestone: MilestoneKey, riskLevel: RiskLevelKey): BonusStatusKey {
  if (milestone === "terminated" || milestone === "leaving_soon") return "not_eligible";
  if (riskLevel === "low" && milestone === "under_180_days") return "eligible";
  return "observing";
}

function inferBonusRule(milestone: MilestoneKey) {
  if (milestone === "under_7_days") return "滿 30 天且無重大客訴可進入第一階段留任獎金。";
  if (milestone === "under_30_days") return "滿 30 天後檢查出勤、主管評核與服務適應。";
  if (milestone === "under_90_days") return "滿 90 天且出勤正常可發放第二階段留任獎金。";
  if (milestone === "under_180_days") return "滿 180 天且績效達標可發放第三階段留任獎金。";
  if (milestone === "leaving_soon") return "離職預告期間不發放留任獎金，需先完成挽留評估。";
  return "已離職，不列入留任獎金。";
}

function inferAction(record: Pick<RetentionRecord, "milestone" | "riskLevel" | "role">) {
  if (record.milestone === "leaving_soon") return "主管與人資共同面談，評估調整班段、據點或工作內容。";
  if (record.milestone === "terminated") return "完成離職原因分類，納入回聘人才庫與交接追蹤。";
  if (record.riskLevel === "high") return "3 日內完成二次關懷，必要時調整排班或服務路線。";
  if (record.milestone === "under_7_days") return "安排資深人員陪同，確認首週工作與交通適應。";
  return "依 30/90/180 天節點安排留任面談與主管回饋。";
}

function mapRecordFromEmployee(employee: EmployeeRow, careLogs: CareLogRow[]): RetentionRecord {
  const milestone = inferMilestone(employee);
  const risk = inferRisk(employee, milestone);
  const bonusStatus = inferBonusStatus(milestone, risk.level);
  const latestCare = careLogs.find((log) => log.employee_id === employee.id);
  const record: RetentionRecord = {
    id: `draft-${employee.id}`,
    employeeId: employee.id,
    companyId: employee.company_id,
    branchId: employee.primary_branch_id,
    departmentId: employee.primary_department_id,
    employeeNo: employee.employee_no,
    employeeName: employee.full_name,
    role: employee.positions?.title ?? "未設定職務",
    branch: employee.branches?.name ?? "未設定據點",
    department: employee.departments?.name ?? "未設定部門",
    hireDate: employee.hire_date ?? "-",
    tenureDays: daysBetween(employee.hire_date),
    milestone,
    riskLevel: risk.level,
    riskScore: risk.score,
    supervisor: employee.managers?.full_name ?? "未設定主管",
    careStatus: latestCare ? "completed" : risk.level === "high" ? "follow_up_required" : "not_started",
    lastCareRecord: latestCare?.summary ?? "尚未建立主管關懷紀錄。",
    nextCareDate: latestCare?.next_follow_up_date ?? addDays(todayKey(), risk.level === "high" ? 3 : 7),
    bonusStatus,
    bonusRule: inferBonusRule(milestone),
    terminationDate: employee.termination_date ?? undefined,
    terminationReason: String(employee.metadata?.termination_reason ?? ""),
    action: "",
    persisted: false,
  };
  return { ...record, action: inferAction(record) };
}

function mapRecordFromRetention(row: RetentionRow, careLogs: CareLogRow[]): RetentionRecord {
  const latestCare = careLogs.find((log) => log.retention_record_id === row.id || log.employee_id === row.employee_id);
  const employee = row.employees;
  const record: RetentionRecord = {
    id: row.id,
    employeeId: row.employee_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    departmentId: row.department_id,
    employeeNo: employee?.employee_no ?? "",
    employeeName: employee?.full_name ?? "未設定員工",
    role: employee?.positions?.title ?? "未設定職務",
    branch: employee?.branches?.name ?? "未設定據點",
    department: employee?.departments?.name ?? "未設定部門",
    hireDate: employee?.hire_date ?? "-",
    tenureDays: daysBetween(employee?.hire_date ?? null),
    milestone: row.milestone,
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    supervisor: "依員工主檔主管",
    careStatus: row.care_status,
    lastCareRecord: latestCare?.summary ?? row.note ?? "尚未建立主管關懷紀錄。",
    nextCareDate: row.next_care_date ?? latestCare?.next_follow_up_date ?? "-",
    bonusStatus: row.retention_bonus_status,
    bonusRule: row.retention_bonus_rule ?? inferBonusRule(row.milestone),
    terminationDate: row.expected_termination_date ?? employee?.termination_date ?? undefined,
    terminationReason: row.termination_reason ?? String(employee?.metadata?.termination_reason ?? ""),
    action: "",
    persisted: true,
  };
  return { ...record, action: inferAction(record) };
}

export default function RetentionPage() {
  const currentUser = useCurrentUser();
  const [records, setRecords] = useState<RetentionRecord[]>([]);
  const [query, setQuery] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState<"全部" | MilestoneKey>("全部");
  const [riskFilter, setRiskFilter] = useState<"全部" | RiskLevelKey>("全部");
  const [careForm, setCareForm] = useState<CareForm>({ recordId: "", summary: "", nextCareDate: addDays(todayKey(), 7) });
  const [message, setMessage] = useState("留任追蹤會從 Supabase employees / employee_retention_records / employee_care_logs 載入。");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const matchesQuery = [record.employeeNo, record.employeeName, record.branch, record.department, record.terminationReason ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesMilestone = milestoneFilter === "全部" || record.milestone === milestoneFilter;
      const matchesRisk = riskFilter === "全部" || record.riskLevel === riskFilter;
      return matchesQuery && matchesMilestone && matchesRisk;
    });
  }, [milestoneFilter, query, records, riskFilter]);

  const selectedRecord = records.find((record) => record.id === careForm.recordId) ?? filteredRecords[0];

  const summary = useMemo(() => ({
    newUnder180: records.filter((record) => record.tenureDays < 180 && record.milestone !== "terminated").length,
    highRisk: records.filter((record) => record.riskLevel === "high").length,
    pendingCare: records.filter((record) => record.careStatus === "follow_up_required" || record.careStatus === "not_started").length,
    bonusEligible: records.filter((record) => record.bonusStatus === "eligible").length,
  }), [records]);

  async function loadData() {
    setLoading(true);
    try {
      const supabase = getClient();
      let employeeQuery = supabase
        .from("employees")
        .select(`
          id,
          company_id,
          employee_no,
          full_name,
          hire_date,
          termination_date,
          employment_status,
          primary_branch_id,
          primary_department_id,
          manager_employee_id,
          metadata,
          branches(name),
          departments(name),
          positions(title),
          managers:employees!employees_manager_employee_id_fkey(full_name)
        `)
        .is("deleted_at", null)
        .order("hire_date", { ascending: false });
      let retentionQuery = supabase
        .from("employee_retention_records")
        .select(`
          id,
          company_id,
          branch_id,
          department_id,
          employee_id,
          milestone,
          risk_level,
          risk_score,
          care_status,
          retention_bonus_status,
          retention_bonus_rule,
          termination_reason,
          expected_termination_date,
          status,
          next_care_date,
          owner_user_id,
          note,
          employees(employee_no, full_name, hire_date, termination_date, employment_status, metadata, branches(name), departments(name), positions(title))
        `)
        .is("deleted_at", null)
        .order("risk_score", { ascending: false });
      let careQuery = supabase
        .from("employee_care_logs")
        .select("id, retention_record_id, employee_id, care_date, summary, next_follow_up_date, created_at")
        .is("deleted_at", null)
        .order("care_date", { ascending: false });

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        retentionQuery = retentionQuery.eq("company_id", currentUser.companyId);
        careQuery = careQuery.eq("company_id", currentUser.companyId);
      }

      const [employeeResult, retentionResult, careResult] = await Promise.all([employeeQuery, retentionQuery, careQuery]);
      if (employeeResult.error) throw employeeResult.error;
      if (retentionResult.error) throw retentionResult.error;
      if (careResult.error) throw careResult.error;

      const employees = (employeeResult.data ?? []) as unknown as EmployeeRow[];
      const retentions = (retentionResult.data ?? []) as unknown as RetentionRow[];
      const careLogs = (careResult.data ?? []) as unknown as CareLogRow[];
      const retainedEmployeeIds = new Set(retentions.map((item) => item.employee_id));
      const fromDb = retentions.map((row) => mapRecordFromRetention(row, careLogs));
      const inferred = employees
        .filter((employee) => !retainedEmployeeIds.has(employee.id))
        .filter((employee) => {
          const milestone = inferMilestone(employee);
          return employee.employment_status === "terminated" || employee.termination_date || daysBetween(employee.hire_date) < 180 || milestone === "leaving_soon";
        })
        .map((employee) => mapRecordFromEmployee(employee, careLogs));
      const nextRecords = [...fromDb, ...inferred].sort((a, b) => b.riskScore - a.riskScore);
      setRecords(nextRecords);
      setCareForm((current) => ({ ...current, recordId: current.recordId && nextRecords.some((record) => record.id === current.recordId) ? current.recordId : nextRecords[0]?.id ?? "" }));
      setMessage(`已從 Supabase 載入 ${fromDb.length} 筆正式留任紀錄，並推算 ${inferred.length} 筆待同步追蹤對象。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "留任追蹤資料載入失敗。");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role]);

  async function syncRetentionRecords() {
    const drafts = records.filter((record) => !record.persisted);
    if (!drafts.length) {
      setMessage("目前沒有需要同步建立的留任紀錄。");
      return;
    }
    setSaving(true);
    try {
      const supabase = getClient();
      const payloads = drafts.map((record) => ({
        company_id: record.companyId,
        branch_id: record.branchId,
        department_id: record.departmentId,
        employee_id: record.employeeId,
        milestone: record.milestone,
        risk_level: record.riskLevel,
        risk_score: record.riskScore,
        care_status: record.careStatus,
        retention_bonus_status: record.bonusStatus,
        retention_bonus_rule: record.bonusRule,
        termination_reason: record.terminationReason || null,
        expected_termination_date: record.terminationDate || null,
        status: record.milestone === "terminated" ? "terminated" : record.milestone === "leaving_soon" ? "leaving" : record.riskLevel === "high" ? "watching" : "active",
        next_care_date: record.nextCareDate === "-" ? null : record.nextCareDate,
        owner_user_id: currentUser.id || null,
        note: record.action,
      }));
      const { error } = await supabase.from("employee_retention_records").insert(payloads);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        company_id: currentUser.companyId || drafts[0]?.companyId,
        actor_user_id: currentUser.id || null,
        action: "retention.sync_records",
        resource_type: "employee_retention_records",
        before_data: { draft_count: drafts.length },
        after_data: { inserted: payloads.length },
        metadata: { module: "retention" },
      });
      setMessage(`已同步建立 ${payloads.length} 筆 employee_retention_records。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步留任追蹤失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function addCareLog() {
    const target = records.find((record) => record.id === careForm.recordId) ?? selectedRecord;
    if (!target) {
      setMessage("請先選擇要建立關懷紀錄的員工。");
      return;
    }
    if (!target.persisted) {
      setMessage("此員工尚未同步成正式留任紀錄，請先按「同步追蹤名單」。");
      return;
    }
    if (!careForm.summary.trim()) {
      setMessage("請先輸入主管關懷內容。");
      return;
    }
    setSaving(true);
    try {
      const supabase = getClient();
      const { error: careError } = await supabase.from("employee_care_logs").insert({
        company_id: target.companyId,
        retention_record_id: target.id,
        employee_id: target.employeeId,
        care_type: target.riskLevel === "high" ? "retention_interview" : "supervisor_check_in",
        care_date: todayKey(),
        care_by: currentUser.id || null,
        summary: careForm.summary.trim(),
        action_items: [target.action],
        next_follow_up_date: careForm.nextCareDate || null,
      });
      if (careError) throw careError;
      const { error: retentionError } = await supabase
        .from("employee_retention_records")
        .update({
          care_status: careForm.nextCareDate ? "follow_up_required" : "completed",
          next_care_date: careForm.nextCareDate || null,
          note: careForm.summary.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);
      if (retentionError) throw retentionError;
      await supabase.from("audit_logs").insert({
        company_id: target.companyId,
        actor_user_id: currentUser.id || null,
        action: "retention.care_log.create",
        resource_type: "employee_care_logs",
        resource_id: target.id,
        after_data: { summary: careForm.summary, next_care_date: careForm.nextCareDate },
        metadata: { module: "retention", employee_id: target.employeeId },
      });
      setCareForm({ recordId: target.id, summary: "", nextCareDate: addDays(todayKey(), 7) });
      setMessage(`已為 ${target.employeeName} 建立主管關懷紀錄，並更新追蹤狀態。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立關懷紀錄失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Retention Tracking</p>
          <h1 className="text-2xl font-semibold text-slate-950">員工留任追蹤與離職風險儀表板</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            追蹤到職 7/30/90/180 天、即將離職、已離職、主管關懷紀錄與留任獎金資格；資料寫入 Supabase。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncRetentionRecords()}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            同步追蹤名單
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </div>

      <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${message.includes("失敗") || message.includes("請先") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        {loading ? "正在從 Supabase 載入留任追蹤..." : saving ? "正在寫入 Supabase..." : message}
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "新進未滿 180 天", value: `${summary.newUnder180}`, detail: "需完成節點關懷", icon: UserPlus, tone: "bg-sky-50 text-sky-700" },
          { label: "高離職風險", value: `${summary.highRisk}`, detail: "需主管與人資介入", icon: ShieldAlert, tone: "bg-rose-50 text-rose-700" },
          { label: "待關懷追蹤", value: `${summary.pendingCare}`, detail: "未完成或需二次關懷", icon: HeartHandshake, tone: "bg-amber-50 text-amber-700" },
          { label: "留任獎金資格", value: `${summary.bonusEligible}`, detail: "符合發放或待審核", icon: Award, tone: "bg-emerald-50 text-emerald-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{loading ? "..." : item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-emerald-700" />
          <h2 className="text-lg font-semibold text-slate-950">新增主管關懷紀錄</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr_180px_auto]">
          <select
            value={careForm.recordId}
            onChange={(event) => setCareForm((current) => ({ ...current, recordId: event.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {records.filter((record) => record.persisted).map((record) => (
              <option key={record.id} value={record.id}>
                {record.employeeNo} / {record.employeeName}
              </option>
            ))}
          </select>
          <input
            value={careForm.summary}
            onChange={(event) => setCareForm((current) => ({ ...current, summary: event.target.value }))}
            placeholder="輸入關懷重點、離職風險原因或改善承諾"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={careForm.nextCareDate}
            onChange={(event) => setCareForm((current) => ({ ...current, nextCareDate: event.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void addCareLog()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <MessageSquareText className="h-4 w-4" />
            建立關懷
          </button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">留任狀態報表</h2>
                <p className="text-sm text-slate-500">正式紀錄與推算名單會一起顯示；未同步者會標記為待同步。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜尋員工 / 據點 / 原因"
                    className="w-56 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <select value={milestoneFilter} onChange={(event) => setMilestoneFilter(event.target.value as "全部" | MilestoneKey)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="全部">全部節點</option>
                  {milestones.map((milestone) => <option key={milestone} value={milestone}>{milestoneLabels[milestone]}</option>)}
                </select>
                <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as "全部" | RiskLevelKey)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="全部">全部風險</option>
                  <option value="low">低風險</option>
                  <option value="medium">中風險</option>
                  <option value="high">高風險</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">員工</th>
                  <th className="px-4 py-3">留任節點</th>
                  <th className="px-4 py-3">風險</th>
                  <th className="px-4 py-3">主管關懷紀錄</th>
                  <th className="px-4 py-3">留任獎金資格</th>
                  <th className="px-4 py-3">離職原因</th>
                  <th className="px-4 py-3">建議行動</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">正在載入留任追蹤...</td>
                  </tr>
                ) : filteredRecords.map((record) => (
                  <tr key={record.id} className="align-top">
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-950">{record.employeeName}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.employeeNo} · {record.role}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.branch} / {record.department}</div>
                      {!record.persisted ? <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">待同步</span> : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{milestoneLabels[record.milestone]}</div>
                      <div className="mt-1 text-xs text-slate-500">到職日 {record.hireDate} · {record.tenureDays} 天</div>
                      {record.terminationDate ? <div className="mt-1 text-xs text-rose-600">離職日 {record.terminationDate}</div> : null}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${riskStyles[record.riskLevel]}`}>
                        {riskLabels[record.riskLevel]}風險
                      </span>
                      <div className="mt-2 h-2 w-28 rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-rose-500" style={{ width: `${record.riskScore}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{record.riskScore} 分</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className={`font-medium ${careStyles[record.careStatus]}`}>{careLabels[record.careStatus]}</div>
                      <div className="mt-1 max-w-xs text-xs text-slate-500">{record.lastCareRecord}</div>
                      <div className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        下次：{record.nextCareDate}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{bonusLabels[record.bonusStatus]}</div>
                      <div className="mt-1 max-w-xs text-xs text-slate-500">{record.bonusRule}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{record.terminationReason || "未填寫"}</td>
                    <td className="px-4 py-4">
                      <div className="max-w-xs text-slate-700">{record.action}</div>
                    </td>
                  </tr>
                ))}
                {!loading && !filteredRecords.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">沒有符合條件的留任追蹤資料。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-950">節點分布</h2>
            </div>
            <div className="space-y-3">
              {milestones.map((milestone) => {
                const count = records.filter((record) => record.milestone === milestone).length;
                return (
                  <div key={milestone} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{milestoneLabels[milestone]}</span>
                      <span className="font-semibold text-slate-950">{count}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(count * 20, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-rose-700" />
              <h2 className="text-lg font-semibold text-rose-950">離職風險儀表板</h2>
            </div>
            <div className="space-y-3 text-sm text-rose-900">
              {records.filter((record) => record.riskLevel === "high").map((record) => (
                <div key={record.id} className="rounded-lg bg-white/70 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{record.employeeName}</span>
                    <span>{record.riskScore} 分</span>
                  </div>
                  <p className="mt-1 text-xs">{record.action}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-emerald-950">主管關懷流程</h2>
            </div>
            <div className="space-y-3 text-sm text-emerald-900">
              {["到職第 3 天：確認工作與交通適應", "到職第 14 天：主管關懷與排班檢查", "到職第 30/90/180 天：留任面談與獎金資格", "即將離職：離職原因、挽留方案與交接追蹤"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-700">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-slate-700" />
            <h2 className="font-semibold text-slate-950">主管關懷紀錄</h2>
          </div>
          <p className="text-sm text-slate-500">建立後寫入 `employee_care_logs`，並更新留任紀錄下一次追蹤日。</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <UserMinus className="h-5 w-5 text-slate-700" />
            <h2 className="font-semibold text-slate-950">離職原因</h2>
          </div>
          <p className="text-sm text-slate-500">離職原因來自 `employee_retention_records` 與員工 metadata，供報表中心彙整。</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileBarChart className="h-5 w-5 text-slate-700" />
            <h2 className="font-semibold text-slate-950">留任狀態報表</h2>
          </div>
          <p className="text-sm text-slate-500">正式資料來源為 `employee_retention_records`，推算名單需同步後才可被稽核。</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <UserCheck className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">資料結構與權限</h2>
            <p className="mt-1 text-sm text-slate-500">
              留任追蹤資料對應 Supabase `employee_retention_records` 與 `employee_care_logs`。員工本人不會看到他人的風險資料，主管與人資依公司、部門與據點權限查看。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
