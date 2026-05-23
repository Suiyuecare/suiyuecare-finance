"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  GitCompareArrows,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  UserCheck,
  UserRoundPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type ChangeType =
  | "department"
  | "position"
  | "salary"
  | "supervisor"
  | "branch"
  | "status"
  | "onboarding"
  | "leave_without_pay"
  | "reinstatement"
  | "termination";

type EmployeeStatus = "active" | "on_leave" | "suspended" | "terminated";

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
  hire_date: string | null;
  termination_date: string | null;
  employment_status: EmployeeStatus;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  position_id: string | null;
  manager_employee_id: string | null;
  metadata?: Record<string, unknown> | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
  positions?: { title: string | null } | null;
  managers?: { full_name: string | null; employee_no: string | null } | null;
};

type OptionRow = {
  id: string;
  name?: string;
  title?: string;
  employee_no?: string;
  full_name?: string;
};

type ChangeLogRow = {
  id: string;
  employee_id: string;
  change_type: ChangeType;
  before_value: string;
  after_value: string;
  reason: string;
  effective_date: string;
  status: "draft" | "pending" | "approved" | "applied" | "cancelled";
  applied_at: string | null;
  created_at: string;
  created_by: string | null;
  employees?: { employee_no: string | null; full_name: string | null } | null;
  users?: { display_name: string | null } | null;
};

type ChangeForm = {
  employeeId: string;
  type: ChangeType;
  targetId: string;
  afterValue: string;
  reason: string;
  effectiveDate: string;
};

type FormErrors = Partial<Record<keyof ChangeForm, string>>;

const changeTypeLabels: Record<ChangeType, string> = {
  department: "部門異動",
  position: "職稱異動",
  salary: "薪資異動",
  supervisor: "主管異動",
  branch: "據點異動",
  status: "員工狀態異動",
  onboarding: "到職",
  leave_without_pay: "留職停薪",
  reinstatement: "復職",
  termination: "離職",
};

const changeTypeIcons: Record<ChangeType, typeof BriefcaseBusiness> = {
  department: BriefcaseBusiness,
  position: UserCheck,
  salary: CircleDollarSign,
  supervisor: UserCheck,
  branch: MapPin,
  status: GitCompareArrows,
  onboarding: UserRoundPlus,
  leave_without_pay: CalendarClock,
  reinstatement: RefreshCw,
  termination: GitCompareArrows,
};

const statusLabels: Record<EmployeeStatus, string> = {
  active: "在職",
  on_leave: "留職停薪",
  suspended: "停職",
  terminated: "離職",
};

const allOption = "全部";

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫員工異動。");
  return supabase as unknown as SupabaseClient;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function getEmployeeLabel(employee?: EmployeeRow) {
  if (!employee) return "";
  return `${employee.employee_no} / ${employee.full_name}`;
}

function getCurrentValue(employee: EmployeeRow | undefined, type: ChangeType) {
  if (!employee) return "";
  if (type === "department") return employee.departments?.name ?? "未設定部門";
  if (type === "position") return employee.positions?.title ?? "未設定職稱";
  if (type === "salary") return String(employee.metadata?.salary_note ?? employee.metadata?.salary_last_change ?? "未設定薪資異動");
  if (type === "supervisor") return employee.managers?.full_name ? `${employee.managers.employee_no ?? ""} / ${employee.managers.full_name}` : "未設定主管";
  if (type === "branch") return employee.branches?.name ?? "未設定據點";
  if (type === "onboarding") return employee.hire_date ? `到職日 ${employee.hire_date}` : "尚未設定到職日";
  if (type === "termination") return employee.termination_date ? `離職日 ${employee.termination_date}` : statusLabels[employee.employment_status];
  if (type === "leave_without_pay" || type === "reinstatement" || type === "status") return statusLabels[employee.employment_status];
  return "";
}

function optionLabel(type: ChangeType, targetId: string, sources: {
  branches: OptionRow[];
  departments: OptionRow[];
  positions: OptionRow[];
  employees: EmployeeRow[];
}) {
  if (type === "department") return sources.departments.find((item) => item.id === targetId)?.name ?? "";
  if (type === "position") return sources.positions.find((item) => item.id === targetId)?.title ?? "";
  if (type === "supervisor") {
    const manager = sources.employees.find((item) => item.id === targetId);
    return manager ? getEmployeeLabel(manager) : "";
  }
  if (type === "branch") return sources.branches.find((item) => item.id === targetId)?.name ?? "";
  if (type === "status") return statusLabels[targetId as EmployeeStatus] ?? "";
  return "";
}

function getAfterValue(form: ChangeForm, employee: EmployeeRow | undefined, sources: {
  branches: OptionRow[];
  departments: OptionRow[];
  positions: OptionRow[];
  employees: EmployeeRow[];
}) {
  if (form.type === "salary") return form.afterValue.trim();
  if (form.type === "onboarding") return `在職 / 到職日 ${form.effectiveDate}`;
  if (form.type === "leave_without_pay") return "留職停薪";
  if (form.type === "reinstatement") return "在職 / 復職";
  if (form.type === "termination") return `離職 / 離職日 ${form.effectiveDate}`;
  return optionLabel(form.type, form.targetId, sources) || getCurrentValue(employee, form.type);
}

function validateForm(form: ChangeForm, beforeValue: string, afterValue: string): FormErrors {
  const errors: FormErrors = {};
  if (!form.employeeId) errors.employeeId = "請選擇員工";
  if (!form.effectiveDate) errors.effectiveDate = "請選擇生效日期";
  if (!form.reason.trim()) errors.reason = "請輸入異動原因";
  if (form.type === "salary" && !form.afterValue.trim()) errors.afterValue = "請輸入薪資異動後內容";
  if (["department", "position", "supervisor", "branch", "status"].includes(form.type) && !form.targetId) {
    errors.targetId = "請選擇異動後項目";
  }
  if (beforeValue && afterValue && beforeValue === afterValue) errors.afterValue = "異動後不可與異動前相同";
  return errors;
}

export default function EmployeeChangesPage() {
  const currentUser = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [branches, setBranches] = useState<OptionRow[]>([]);
  const [departments, setDepartments] = useState<OptionRow[]>([]);
  const [positions, setPositions] = useState<OptionRow[]>([]);
  const [changes, setChanges] = useState<ChangeLogRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<ChangeType | typeof allOption>(allOption);
  const [employeeFilter, setEmployeeFilter] = useState(allOption);
  const [form, setForm] = useState<ChangeForm>({
    employeeId: "",
    type: "department",
    targetId: "",
    afterValue: "",
    reason: "",
    effectiveDate: today(),
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState("員工異動會寫入 employee_change_logs，並同步更新 employees 主檔。");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId);
  const beforeValue = getCurrentValue(selectedEmployee, form.type);
  const afterValue = getAfterValue(form, selectedEmployee, { branches, departments, positions, employees });

  const filteredChanges = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return changes.filter((change) => {
      const matchesKeyword =
        !normalizedKeyword ||
        [
          change.employees?.employee_no,
          change.employees?.full_name,
          change.before_value,
          change.after_value,
          change.reason,
          change.users?.display_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedKeyword);

      return (
        matchesKeyword &&
        (typeFilter === allOption || change.change_type === typeFilter) &&
        (employeeFilter === allOption || change.employee_id === employeeFilter)
      );
    });
  }, [changes, employeeFilter, keyword, typeFilter]);

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
          position_id,
          manager_employee_id,
          metadata,
          branches(name),
          departments(name),
          positions(title),
          managers:employees!employees_manager_employee_id_fkey(employee_no, full_name)
        `)
        .is("deleted_at", null)
        .order("employee_no");
      let branchQuery = supabase.from("branches").select("id, name").is("deleted_at", null).order("name");
      let departmentQuery = supabase.from("departments").select("id, name").is("deleted_at", null).order("name");
      let positionQuery = supabase.from("positions").select("id, title").is("deleted_at", null).order("title");
      let changeQuery = supabase
        .from("employee_change_logs")
        .select("id, employee_id, change_type, before_value, after_value, reason, effective_date, status, applied_at, created_at, created_by, employees(employee_no, full_name), users(display_name)")
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })
        .limit(200);

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        branchQuery = branchQuery.eq("company_id", currentUser.companyId);
        departmentQuery = departmentQuery.eq("company_id", currentUser.companyId);
        positionQuery = positionQuery.eq("company_id", currentUser.companyId);
        changeQuery = changeQuery.eq("company_id", currentUser.companyId);
      }

      const [employeeResult, branchResult, departmentResult, positionResult, changeResult] = await Promise.all([
        employeeQuery,
        branchQuery,
        departmentQuery,
        positionQuery,
        changeQuery,
      ]);
      if (employeeResult.error) throw employeeResult.error;
      if (branchResult.error) throw branchResult.error;
      if (departmentResult.error) throw departmentResult.error;
      if (positionResult.error) throw positionResult.error;
      if (changeResult.error) throw changeResult.error;

      const employeeRows = (employeeResult.data ?? []) as unknown as EmployeeRow[];
      setEmployees(employeeRows);
      setBranches((branchResult.data ?? []) as unknown as OptionRow[]);
      setDepartments((departmentResult.data ?? []) as unknown as OptionRow[]);
      setPositions((positionResult.data ?? []) as unknown as OptionRow[]);
      setChanges((changeResult.data ?? []) as unknown as ChangeLogRow[]);
      setForm((current) => ({
        ...current,
        employeeId: current.employeeId && employeeRows.some((employee) => employee.id === current.employeeId) ? current.employeeId : employeeRows[0]?.id ?? "",
      }));
      setMessage("已從 Supabase 載入員工主檔與 employee_change_logs。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "員工異動資料載入失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role]);

  function updateForm<K extends keyof ChangeForm>(field: K, value: ChangeForm[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "type") {
        next.targetId = "";
        next.afterValue = "";
      }
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function buildEmployeeUpdate(employee: EmployeeRow) {
    const metadata = employee.metadata ?? {};
    if (form.type === "department") return { primary_department_id: form.targetId };
    if (form.type === "position") return { position_id: form.targetId };
    if (form.type === "supervisor") return { manager_employee_id: form.targetId || null };
    if (form.type === "branch") return { primary_branch_id: form.targetId };
    if (form.type === "salary") {
      return {
        metadata: {
          ...metadata,
          salary_note: form.afterValue.trim(),
          salary_last_change_at: new Date().toISOString(),
        },
      };
    }
    if (form.type === "onboarding") return { employment_status: "active", hire_date: employee.hire_date ?? form.effectiveDate };
    if (form.type === "leave_without_pay") return { employment_status: "on_leave" };
    if (form.type === "reinstatement") return { employment_status: "active" };
    if (form.type === "termination") return { employment_status: "terminated", termination_date: form.effectiveDate };
    if (form.type === "status") return { employment_status: form.targetId };
    return {};
  }

  async function handleSubmit() {
    const nextErrors = validateForm(form, beforeValue, afterValue);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !selectedEmployee) {
      setMessage("請先修正紅色提示欄位，再建立異動紀錄。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const employeeUpdate = buildEmployeeUpdate(selectedEmployee);
      const { error: employeeError } = await supabase
        .from("employees")
        .update({ ...employeeUpdate, updated_at: new Date().toISOString() })
        .eq("id", selectedEmployee.id);
      if (employeeError) throw employeeError;

      const beforeData = {
        employee_id: selectedEmployee.id,
        employee_no: selectedEmployee.employee_no,
        change_type: form.type,
        before_value: beforeValue,
        employee_snapshot: selectedEmployee,
      };
      const afterData = {
        change_type: form.type,
        after_value: afterValue,
        target_id: form.targetId || null,
        employee_update: employeeUpdate,
      };

      const { data: insertedChange, error: changeError } = await supabase
        .from("employee_change_logs")
        .insert({
          company_id: selectedEmployee.company_id,
          employee_id: selectedEmployee.id,
          change_type: form.type,
          before_value: beforeValue,
          after_value: afterValue,
          before_data: beforeData,
          after_data: afterData,
          reason: form.reason.trim(),
          effective_date: form.effectiveDate,
          status: "applied",
          applied_at: new Date().toISOString(),
          created_by: currentUser.id || null,
        })
        .select("id")
        .maybeSingle();
      if (changeError) throw changeError;

      const { error: auditError } = await supabase.from("audit_logs").insert({
        company_id: selectedEmployee.company_id,
        actor_user_id: currentUser.id || null,
        action: "employee_change.apply",
        resource_type: "employee_change_logs",
        resource_id: insertedChange?.id ?? selectedEmployee.id,
        before_data: beforeData,
        after_data: afterData,
        metadata: { module: "employee_changes", employee_id: selectedEmployee.id },
      });
      if (auditError) throw auditError;

      setForm({
        employeeId: selectedEmployee.id,
        type: form.type,
        targetId: "",
        afterValue: "",
        reason: "",
        effectiveDate: today(),
      });
      setMessage(`已建立 ${selectedEmployee.full_name} 的${changeTypeLabels[form.type]}，並同步更新 employees 主檔。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立員工異動失敗。");
    } finally {
      setSaving(false);
    }
  }

  function renderAfterControl() {
    if (["onboarding", "leave_without_pay", "reinstatement", "termination"].includes(form.type)) {
      return (
        <Input value={afterValue} readOnly className="bg-muted/60" />
      );
    }
    if (form.type === "salary") {
      return (
        <Input
          value={form.afterValue}
          placeholder="例：本薪 43,000 / 主管加給 3,000"
          onChange={(event) => updateForm("afterValue", event.target.value)}
        />
      );
    }
    const options =
      form.type === "department" ? departments :
      form.type === "position" ? positions :
      form.type === "branch" ? branches :
      form.type === "supervisor" ? employees :
      Object.entries(statusLabels).map(([id, name]) => ({ id, name }));

    return (
      <select
        value={form.targetId}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        onChange={(event) => updateForm("targetId", event.target.value)}
      >
        <option value="">請選擇異動後項目</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {(() => {
              if (form.type === "position") return (option as OptionRow).title;
              if (form.type === "supervisor") {
                const manager = option as EmployeeRow;
                return `${manager.employee_no} / ${manager.full_name}`;
              }
              return (option as OptionRow).name;
            })()}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">EMPLOYEE CHANGES</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">員工異動紀錄</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            記錄到職、任職、薪資、留停復職與離職，並同步更新員工主檔與稽核紀錄。
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{loading ? "載入中" : `${changes.length} 筆異動`}</Badge>
          <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading || saving}>
            <RefreshCw className="h-4 w-4" />
            重新整理
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["本月異動", changes.length],
          ["薪資異動", changes.filter((item) => item.change_type === "salary").length],
          ["主管/部門異動", changes.filter((item) => ["supervisor", "department"].includes(item.change_type)).length],
          ["留停復職", changes.filter((item) => ["leave_without_pay", "reinstatement"].includes(item.change_type)).length],
          ["離職", changes.filter((item) => item.change_type === "termination").length],
        ].map(([label, value]) => (
          <Card key={String(label)} className="rounded-lg">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{String(label)}</div>
              <div className="mt-2 text-2xl font-black">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>新增異動紀錄</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`rounded-lg p-3 text-sm font-semibold ${
              Object.keys(errors).length > 0 || message.includes("失敗") || message.includes("修正")
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {loading ? "正在從 Supabase 載入..." : saving ? "正在寫入 employee_change_logs / employees / audit_logs..." : message}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              員工
              <select
                value={form.employeeId}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateForm("employeeId", event.target.value)}
              >
                <option value="">請選擇員工</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {getEmployeeLabel(employee)}
                  </option>
                ))}
              </select>
              {errors.employeeId ? <span className="text-xs text-rose-600">{errors.employeeId}</span> : null}
            </label>

            <label className="grid gap-1.5 text-sm font-semibold">
              異動類型
              <select
                value={form.type}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateForm("type", event.target.value as ChangeType)}
              >
                {Object.entries(changeTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-semibold">
              生效日期
              <Input type="date" value={form.effectiveDate} onChange={(event) => updateForm("effectiveDate", event.target.value)} />
              {errors.effectiveDate ? <span className="text-xs text-rose-600">{errors.effectiveDate}</span> : null}
            </label>

            <label className="grid gap-1.5 text-sm font-semibold">
              建立人
              <Input value={currentUser.name || currentUser.email || "目前使用者"} readOnly className="bg-muted/60" />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold xl:col-span-2">
              異動前
              <Input value={beforeValue} readOnly className="bg-muted/60" />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold xl:col-span-2">
              異動後
              {renderAfterControl()}
              {errors.afterValue || errors.targetId ? <span className="text-xs text-rose-600">{errors.afterValue || errors.targetId}</span> : null}
            </label>

            <label className="grid gap-1.5 text-sm font-semibold xl:col-span-4">
              異動原因
              <Input value={form.reason} placeholder="請輸入異動原因，會寫入稽核紀錄" onChange={(event) => updateForm("reason", event.target.value)} />
              {errors.reason ? <span className="text-xs text-rose-600">{errors.reason}</span> : null}
            </label>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void handleSubmit()} disabled={loading || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              建立並套用異動
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>查詢異動紀錄</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input value={keyword} className="pl-9" placeholder="搜尋員工、異動前後、原因、建立人" onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <select value={typeFilter} className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setTypeFilter(event.target.value as ChangeType | typeof allOption)}>
              <option>{allOption}</option>
              {Object.entries(changeTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={employeeFilter} className="h-10 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option>{allOption}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{getEmployeeLabel(employee)}</option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">員工</th>
                    <th className="px-4 py-3 font-bold">異動類型</th>
                    <th className="px-4 py-3 font-bold">異動前</th>
                    <th className="px-4 py-3 font-bold">異動後</th>
                    <th className="px-4 py-3 font-bold">異動原因</th>
                    <th className="px-4 py-3 font-bold">生效日期</th>
                    <th className="px-4 py-3 font-bold">建立人</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">正在載入異動紀錄...</td>
                    </tr>
                  ) : filteredChanges.map((change) => {
                    const Icon = changeTypeIcons[change.change_type];
                    return (
                      <tr key={change.id} className="bg-card hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="font-bold">{change.employees?.full_name ?? "未設定員工"}</div>
                          <div className="text-xs text-muted-foreground">{change.employees?.employee_no}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">
                            <Icon className="mr-1 h-3 w-3" />
                            {changeTypeLabels[change.change_type]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{change.before_value}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-semibold">
                            <ArrowRight className="h-4 w-4 text-primary" />
                            {change.after_value}
                          </div>
                        </td>
                        <td className="px-4 py-3">{change.reason}</td>
                        <td className="px-4 py-3">{change.effective_date}</td>
                        <td className="px-4 py-3">
                          <div>{change.users?.display_name ?? "系統"}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(change.applied_at ?? change.created_at)}</div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && !filteredChanges.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">尚無符合條件的異動紀錄。</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
