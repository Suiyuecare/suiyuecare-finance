"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Bus,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserCog,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type DaycareRole = "照服員" | "護理師" | "社工" | "行政人員" | "司機" | "廚工";
type ShiftKey = "早班" | "日班" | "晚班";
type ScheduleType = "regular" | "support" | "temporary" | "training" | "leave" | "holiday";

type BranchRow = {
  id: string;
  company_id: string;
  name: string;
  settings?: { census?: number; daycare_census?: number } | null;
};

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  primary_team_id: string | null;
  metadata?: { employee_group?: string; daycare_role?: string } | null;
  positions?: { title: string | null } | null;
  branches?: { name: string | null } | null;
};

type ShiftRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
};

type ScheduleRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  team_id: string | null;
  employee_id: string;
  shift_id: string | null;
  work_date: string;
  planned_start: string | null;
  planned_end: string | null;
  schedule_type: ScheduleType;
  note: string | null;
  employees?: {
    employee_no: string | null;
    full_name: string | null;
    metadata?: { employee_group?: string; daycare_role?: string } | null;
    positions?: { title: string | null } | null;
    branches?: { name: string | null } | null;
  } | null;
  shifts?: {
    code: string | null;
    name: string | null;
    start_time: string | null;
    end_time: string | null;
  } | null;
};

type StaffMember = {
  id: string;
  scheduleId: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  role: DaycareRole;
  shift: ShiftKey;
  shiftName: string;
  isOnLeave: boolean;
  leaveReason?: string;
  homeBranch: string;
};

type StaffForm = {
  employeeId: string;
  role: DaycareRole;
  shift: ShiftKey;
  isOnLeave: boolean;
};

const roleRequirements: Record<DaycareRole, number> = {
  照服員: 6,
  護理師: 1,
  社工: 1,
  行政人員: 1,
  司機: 2,
  廚工: 1,
};

const roleIcons: Record<DaycareRole, LucideIcon> = {
  照服員: HeartPulse,
  護理師: Stethoscope,
  社工: ClipboardCheck,
  行政人員: UserCog,
  司機: Bus,
  廚工: ChefHat,
};

const roleOrder = Object.keys(roleRequirements) as DaycareRole[];
const shiftOrder: ShiftKey[] = ["早班", "日班", "晚班"];

const defaultForm: StaffForm = {
  employeeId: "",
  role: "照服員",
  shift: "日班",
  isOnLeave: false,
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫日照排班。");
  return supabase as unknown as SupabaseClient;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTime(dateKey: string, time: string | null | undefined, crossesMidnight = false) {
  const normalized = (time || "00:00").slice(0, 5);
  const base = new Date(`${dateKey}T${normalized}:00+08:00`);
  if (crossesMidnight) base.setDate(base.getDate() + 1);
  return base.toISOString();
}

function formatTimeRange(shift?: ShiftRow | null) {
  if (!shift) return "-";
  return `${shift.start_time.slice(0, 5)}-${shift.end_time.slice(0, 5)}`;
}

function normalizeRole(value?: string | null): DaycareRole | null {
  if (!value) return null;
  if (value.includes("護理")) return "護理師";
  if (value.includes("社工")) return "社工";
  if (value.includes("行政")) return "行政人員";
  if (value.includes("司機") || value.includes("駕駛")) return "司機";
  if (value.includes("廚")) return "廚工";
  if (value.includes("照服") || value.includes("照顧") || value.includes("日照")) return "照服員";
  return null;
}

function roleFromEmployee(employee: Pick<EmployeeRow, "metadata" | "positions">): DaycareRole {
  return (
    normalizeRole(employee.metadata?.daycare_role) ??
    normalizeRole(employee.positions?.title) ??
    "照服員"
  );
}

function roleFromSchedule(schedule: ScheduleRow): DaycareRole {
  const noteRole = schedule.note?.match(/日照職務：([^；\n]+)/)?.[1];
  return (
    normalizeRole(noteRole) ??
    normalizeRole(schedule.employees?.metadata?.daycare_role) ??
    normalizeRole(schedule.employees?.positions?.title) ??
    "照服員"
  );
}

function shiftKeyFromName(name?: string | null): ShiftKey {
  if (!name) return "日班";
  if (name.includes("早")) return "早班";
  if (name.includes("晚") || name.includes("夜")) return "晚班";
  return "日班";
}

function countAvailableStaff(staff: StaffMember[], role: DaycareRole) {
  return staff.filter((member) => member.role === role && !member.isOnLeave).length;
}

export default function DaycareSchedulesPage() {
  const currentUser = useCurrentUser();
  const [date, setDate] = useState(formatDateKey(new Date()));
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [form, setForm] = useState<StaffForm>(defaultForm);
  const [message, setMessage] = useState("新增人員或切換休假狀態後，系統會重新計算人力缺口與休假衝突，並寫入 Supabase schedules。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  const census = selectedBranch?.settings?.daycare_census ?? selectedBranch?.settings?.census ?? 42;

  const shiftByKey = useMemo(() => {
    const findShift = (key: ShiftKey) => {
      if (key === "早班") return shifts.find((shift) => shift.name.includes("早")) ?? shifts.find((shift) => shift.code === "D") ?? shifts[0];
      if (key === "晚班") return shifts.find((shift) => shift.name.includes("晚")) ?? shifts.find((shift) => shift.code === "E") ?? shifts[0];
      return shifts.find((shift) => shift.name.includes("日")) ?? shifts.find((shift) => shift.code === "D") ?? shifts[0];
    };
    return {
      早班: findShift("早班"),
      日班: findShift("日班"),
      晚班: findShift("晚班"),
    } as Record<ShiftKey, ShiftRow | undefined>;
  }, [shifts]);

  const shiftTimes = useMemo(
    () => ({
      早班: formatTimeRange(shiftByKey.早班),
      日班: formatTimeRange(shiftByKey.日班),
      晚班: formatTimeRange(shiftByKey.晚班),
    }),
    [shiftByKey],
  );

  const availableEmployees = useMemo(
    () => employees.filter((employee) => !staff.some((member) => member.employeeId === employee.id)),
    [employees, staff],
  );

  const roleCoverage = useMemo(
    () =>
      roleOrder.map((role) => {
        const assigned = staff.filter((member) => member.role === role).length;
        const available = countAvailableStaff(staff, role);
        const required = roleRequirements[role];
        return {
          role,
          assigned,
          available,
          required,
          shortage: Math.max(required - available, 0),
          conflicts: staff.filter((member) => member.role === role && member.isOnLeave),
        };
      }),
    [staff],
  );

  const shiftCoverage = useMemo(
    () =>
      shiftOrder.map((shift) => ({
        shift,
        time: shiftTimes[shift],
        staff: staff.filter((member) => member.shift === shift),
        available: staff.filter((member) => member.shift === shift && !member.isOnLeave).length,
      })),
    [staff, shiftTimes],
  );

  const shortageCount = roleCoverage.reduce((sum, item) => sum + item.shortage, 0);
  const leaveConflictCount = staff.filter((member) => member.isOnLeave).length;
  const availableStaffCount = staff.filter((member) => !member.isOnLeave).length;
  const staffingGapRows = useMemo(
    () =>
      roleCoverage
        .filter((item) => item.shortage > 0)
        .map((item) => ({
          role: item.role,
          required: item.required,
          available: item.available,
          shortage: item.shortage,
          shift: item.role === "司機" ? "早班/晚班接送" : "日間照顧時段",
          impact:
            item.role === "照服員"
              ? "低於照顧服務最低配置，阻擋每日人力配置表發布。"
              : item.role === "司機"
                ? "接送路線可能無法完整覆蓋，需調整路線或補司機。"
                : `${item.role} 人力不足，需補足後才能發布日照班表。`,
          action: item.role === "照服員" ? "優先找跨據點照服員或調整休假衝突。" : `補 1 名${item.role}或調整當日配置。`,
        })),
    [roleCoverage],
  );

  async function loadData() {
    setLoading(true);
    try {
      const supabase = getClient();
      let branchQuery = supabase
        .from("branches")
        .select("id, company_id, name, settings")
        .eq("branch_type", "daycare_center")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("name");

      if (currentUser.companyId && currentUser.role !== "ceo") {
        branchQuery = branchQuery.eq("company_id", currentUser.companyId);
      }

      const { data: branchData, error: branchError } = await branchQuery;
      if (branchError) throw branchError;

      const branchRows = (branchData ?? []) as unknown as BranchRow[];
      const nextBranchId =
        selectedBranchId && branchRows.some((branch) => branch.id === selectedBranchId)
          ? selectedBranchId
          : currentUser.primaryBranchId && branchRows.some((branch) => branch.id === currentUser.primaryBranchId)
            ? currentUser.primaryBranchId
            : branchRows[0]?.id ?? "";

      setBranches(branchRows);
      setSelectedBranchId(nextBranchId);

      let employeeQuery = supabase
        .from("employees")
        .select("id, company_id, employee_no, full_name, primary_branch_id, primary_department_id, primary_team_id, metadata, positions(title), branches(name)")
        .eq("employment_status", "active")
        .is("deleted_at", null)
        .order("employee_no");
      let shiftQuery = supabase
        .from("shifts")
        .select("id, company_id, branch_id, code, name, start_time, end_time, crosses_midnight")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("code");
      let scheduleQuery = supabase
        .from("schedules")
        .select(`
          id,
          company_id,
          branch_id,
          department_id,
          team_id,
          employee_id,
          shift_id,
          work_date,
          planned_start,
          planned_end,
          schedule_type,
          note,
          employees(employee_no, full_name, metadata, positions(title), branches(name)),
          shifts(code, name, start_time, end_time)
        `)
        .eq("work_date", date)
        .in("source_module", ["daycare", "batch_schedule", "copy_previous_week", "seed"])
        .is("deleted_at", null)
        .order("planned_start");

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        shiftQuery = shiftQuery.eq("company_id", currentUser.companyId);
        scheduleQuery = scheduleQuery.eq("company_id", currentUser.companyId);
      }
      if (nextBranchId) {
        scheduleQuery = scheduleQuery.eq("branch_id", nextBranchId);
      }

      const [employeeResult, shiftResult, scheduleResult] = await Promise.all([employeeQuery, shiftQuery, scheduleQuery]);
      if (employeeResult.error) throw employeeResult.error;
      if (shiftResult.error) throw shiftResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      const employeeRows = ((employeeResult.data ?? []) as unknown as EmployeeRow[])
        .filter((employee) => {
          const group = employee.metadata?.employee_group;
          const role = roleFromEmployee(employee);
          return (
            group === "daycare_staff" ||
            employee.primary_branch_id === nextBranchId ||
            ["照服員", "護理師", "社工", "行政人員", "司機", "廚工"].includes(role)
          );
        });
      const shiftRows = ((shiftResult.data ?? []) as unknown as ShiftRow[])
        .filter((shift) => !nextBranchId || !shift.branch_id || shift.branch_id === nextBranchId);
      const staffRows = ((scheduleResult.data ?? []) as unknown as ScheduleRow[]).map((schedule) => {
        const shiftName = schedule.shifts?.name ?? "日班";
        return {
          id: schedule.id,
          scheduleId: schedule.id,
          employeeId: schedule.employee_id,
          employeeNo: schedule.employees?.employee_no ?? "",
          name: schedule.employees?.full_name ?? "未設定員工",
          role: roleFromSchedule(schedule),
          shift: shiftKeyFromName(shiftName),
          shiftName,
          isOnLeave: schedule.schedule_type === "leave" || schedule.schedule_type === "holiday",
          leaveReason: schedule.schedule_type === "leave" ? "臨時請假" : schedule.schedule_type === "holiday" ? "休假" : undefined,
          homeBranch: schedule.employees?.branches?.name ?? "未設定據點",
        } satisfies StaffMember;
      });

      setEmployees(employeeRows);
      setShifts(shiftRows);
      setStaff(staffRows);
      setForm((current) => ({
        ...current,
        employeeId: current.employeeId && employeeRows.some((employee) => employee.id === current.employeeId) ? current.employeeId : employeeRows[0]?.id ?? "",
      }));
      setMessage("日照排班已從 Supabase schedules 載入。");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "日照排班載入失敗。");
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role, currentUser.primaryBranchId, date, selectedBranchId]);

  function buildPayload(employee: EmployeeRow, shift: ShiftRow, nextRole: DaycareRole, isOnLeave: boolean) {
    return {
      company_id: employee.company_id,
      branch_id: selectedBranchId || employee.primary_branch_id,
      department_id: employee.primary_department_id,
      team_id: employee.primary_team_id,
      employee_id: employee.id,
      shift_id: shift.id,
      work_date: date,
      planned_start: toDateTime(date, shift.start_time, false),
      planned_end: toDateTime(date, shift.end_time, shift.crosses_midnight),
      schedule_type: isOnLeave ? "leave" : "regular",
      source_module: "daycare",
      note: `日照職務：${nextRole}；日照排班${isOnLeave ? "；狀態：休假衝突" : ""}`,
      updated_at: new Date().toISOString(),
    };
  }

  async function addStaff() {
    setError("");
    if (!selectedBranchId) {
      setError("請先選擇日照中心。");
      return;
    }
    const employee = employees.find((item) => item.id === form.employeeId);
    const shift = shiftByKey[form.shift];
    if (!employee) {
      setError("請選擇要加入每日配置的人員。");
      return;
    }
    if (!shift) {
      setError("尚未建立可用班別，請先到班別管理建立日班或晚班。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const { error: upsertError } = await supabase
        .from("schedules")
        .upsert(buildPayload(employee, shift, form.role, form.isOnLeave), { onConflict: "employee_id,work_date" });
      if (upsertError) throw upsertError;
      setMessage(`已加入 ${employee.full_name} 至 ${form.shift}，並寫入 Supabase schedules。`);
      setForm({ ...defaultForm, employeeId: availableEmployees.find((item) => item.id !== employee.id)?.id ?? "" });
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "新增日照排班人員失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLeave(member: StaffMember) {
    setSaving(true);
    setError("");
    try {
      const supabase = getClient();
      const nextIsOnLeave = !member.isOnLeave;
      const { error: updateError } = await supabase
        .from("schedules")
        .update({
          schedule_type: nextIsOnLeave ? "leave" : "regular",
          note: `日照職務：${member.role}；日照排班${nextIsOnLeave ? "；狀態：臨時請假" : ""}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.scheduleId);
      if (updateError) throw updateError;
      setMessage(`${member.name} 已切換為${nextIsOnLeave ? "臨時請假" : "可出勤"}，並更新 Supabase schedules。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "切換休假狀態失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-700">日照中心排班</p>
          <h1 className="text-2xl font-semibold text-slate-950">每日人力配置表</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            新增人員、切換休假與缺口統計都連動 Supabase schedules，用於日照最低人力、休假衝突與評鑑人力配置表。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-teal-700">{selectedBranch?.name ?? "尚未選擇日照中心"}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">{date}</span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">收托 {census} 人</span>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            日照中心
            <select
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            日期
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={() => void loadData()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 md:self-end"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "今日排班人數", value: `${staff.length} 人`, icon: UsersRound, tone: "bg-teal-50 text-teal-700" },
          { label: "可出勤人數", value: `${availableStaffCount} 人`, icon: BadgeCheck, tone: "bg-emerald-50 text-emerald-700" },
          { label: "人力缺口", value: `${shortageCount} 人`, icon: ShieldAlert, tone: "bg-rose-50 text-rose-700" },
          { label: "休假衝突", value: `${leaveConflictCount} 筆`, icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{loading ? "..." : item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-rose-950">今日排班缺口明細</h2>
            <p className="mt-1 text-sm text-rose-800">
              系統依可出勤人數計算缺口，休假人員不列入最低人力。
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700">
            缺口 {shortageCount} 人
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {staffingGapRows.length ? staffingGapRows.map((gap) => (
            <div key={gap.role} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-950">{gap.role}</div>
                  <div className="mt-1 text-xs text-slate-500">{gap.shift}</div>
                </div>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                  缺 {gap.shortage}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-slate-50 p-2">
                  <div className="font-black text-slate-950">{gap.required}</div>
                  <div className="text-slate-500">最低</div>
                </div>
                <div className="rounded bg-slate-50 p-2">
                  <div className="font-black text-slate-950">{gap.available}</div>
                  <div className="text-slate-500">可出勤</div>
                </div>
                <div className="rounded bg-rose-50 p-2">
                  <div className="font-black text-rose-700">{gap.shortage}</div>
                  <div className="text-rose-600">缺口</div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">{gap.impact}</p>
              <p className="mt-2 text-xs font-bold text-rose-700">{gap.action}</p>
            </div>
          )) : (
            <div className="rounded-lg bg-white p-4 text-sm font-semibold text-emerald-700">
              今日各職務最低人力都已滿足，可以進入發布前檢核。
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">新增排班人員</h2>
              <p className="text-sm text-slate-500">從員工主檔選取人員，加入後會寫入正式排班資料。</p>
            </div>
            <Plus className="h-5 w-5 text-teal-600" />
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {loading ? "正在讀取 Supabase..." : saving ? "正在寫入 Supabase schedules..." : error || message}
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              人員
              <select
                value={form.employeeId}
                onChange={(event) => {
                  const employee = employees.find((item) => item.id === event.target.value);
                  setForm((current) => ({ ...current, employeeId: event.target.value, role: employee ? roleFromEmployee(employee) : current.role }));
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {availableEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employee_no} / {employee.full_name} / {employee.branches?.name ?? "未設定據點"}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                職務
                <select
                  value={form.role}
                  onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as DaycareRole }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {roleOrder.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                班別
                <select
                  value={form.shift}
                  onChange={(event) => setForm((current) => ({ ...current, shift: event.target.value as ShiftKey }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {shiftOrder.map((shift) => (
                    <option key={shift} value={shift}>
                      {shift} / {shiftTimes[shift]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.isOnLeave}
                onChange={(event) => setForm((current) => ({ ...current, isOnLeave: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              此人員今日已請假，新增後列入休假衝突提醒
            </label>
          </div>

          <button
            onClick={() => void addStaff()}
            disabled={loading || saving || !availableEmployees.length}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            加入每日配置
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">不同職務最低人力需求</h2>
              <p className="text-sm text-slate-500">系統依可出勤人數計算缺口，請假人員不計入當日可用人力。</p>
            </div>
            <ClipboardList className="h-5 w-5 text-sky-600" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {roleCoverage.map((item) => {
              const Icon = roleIcons[item.role];
              const percent = Math.min((item.available / item.required) * 100, 100);
              return (
                <div key={item.role} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg bg-teal-50 p-2 text-teal-700">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold text-slate-950">{item.role}</p>
                        <p className="text-xs text-slate-500">最低需求 {item.required} 人</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.shortage ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {item.shortage ? `缺 ${item.shortage}` : "足額"}
                    </span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${item.shortage ? "bg-rose-500" : "bg-emerald-500"}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    已排 {item.assigned} 人，可出勤 {item.available} 人
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">每日人力配置表</h2>
                <p className="text-sm text-slate-500">點擊人員可切換休假狀態，並直接更新該筆 schedules。</p>
              </div>
              <CalendarDays className="h-5 w-5 text-teal-600" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">班別</th>
                  <th className="px-4 py-3">時間</th>
                  <th className="px-4 py-3">照服員</th>
                  <th className="px-4 py-3">護理師</th>
                  <th className="px-4 py-3">社工</th>
                  <th className="px-4 py-3">行政人員</th>
                  <th className="px-4 py-3">司機</th>
                  <th className="px-4 py-3">廚工</th>
                  <th className="px-4 py-3">可出勤</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                      正在載入日照排班...
                    </td>
                  </tr>
                ) : shiftCoverage.map((shift) => (
                  <tr key={shift.shift} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-950">{shift.shift}</td>
                    <td className="px-4 py-4 text-slate-600">{shift.time}</td>
                    {roleOrder.map((role) => {
                      const members = shift.staff.filter((member) => member.role === role);
                      return (
                        <td key={`${shift.shift}-${role}`} className="px-4 py-4">
                          <div className="space-y-1">
                            {members.length ? (
                              members.map((member) => (
                                <button
                                  key={member.id}
                                  onClick={() => void toggleLeave(member)}
                                  disabled={saving}
                                  className={`block rounded-lg px-2 py-1 text-left text-xs font-medium ${
                                    member.isOnLeave
                                      ? "border border-amber-200 bg-amber-50 text-amber-700"
                                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                  } disabled:opacity-60`}
                                  title="點擊切換休假狀態，會更新 Supabase schedules"
                                >
                                  {member.employeeNo} {member.name}
                                  {member.isOnLeave ? ` · ${member.leaveReason}` : ""}
                                </button>
                              ))
                            ) : (
                              <span className="text-xs text-slate-300">未排</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {shift.available} 人
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && !staff.length ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                      今日尚無日照排班，請從左側新增人員。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-700" />
              <h2 className="font-semibold text-rose-900">缺口提醒</h2>
            </div>
            <div className="space-y-2">
              {roleCoverage.filter((item) => item.shortage > 0).length ? (
                roleCoverage
                  .filter((item) => item.shortage > 0)
                  .map((item) => (
                    <div key={item.role} className="rounded-lg bg-white/80 px-3 py-2 text-sm text-rose-800">
                      {item.role}最低需 {item.required} 人，目前可出勤 {item.available} 人，缺 {item.shortage} 人。
                    </div>
                  ))
              ) : (
                <p className="text-sm text-rose-800">今日各職務最低人力皆已滿足。</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">人員休假衝突提醒</h2>
            </div>
            <div className="space-y-2">
              {staff.filter((member) => member.isOnLeave).length ? (
                staff
                  .filter((member) => member.isOnLeave)
                  .map((member) => (
                    <div key={member.id} className="rounded-lg bg-white/80 px-3 py-2 text-sm text-amber-800">
                      {member.name}（{member.role}）已排 {member.shift}，但狀態為{member.leaveReason}。
                    </div>
                  ))
              ) : (
                <p className="text-sm text-amber-800">今日沒有休假衝突。</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-teal-700" />
              <h2 className="font-semibold text-slate-950">中心配置摘要</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">中心</span>
                <span className="font-medium text-slate-800">{selectedBranch?.name ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">收托人數</span>
                <span className="font-medium text-slate-800">{census} 人</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">總排班</span>
                <span className="font-medium text-slate-800">{staff.length} 人</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">可出勤</span>
                <span className="font-medium text-slate-800">{availableStaffCount} 人</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
