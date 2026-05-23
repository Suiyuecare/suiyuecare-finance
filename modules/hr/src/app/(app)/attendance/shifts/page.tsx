"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Loader2, Moon, Palette, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
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

type ShiftType = "day" | "evening" | "night" | "rest" | "national_holiday" | "annual_leave";

type ShiftSettings = {
  type?: ShiftType;
  countsAsWork?: boolean;
  allowFlexiblePunch?: boolean;
  lateGraceMinutes?: number;
  earlyLeaveGraceMinutes?: number;
  color?: string;
};

type ShiftRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
  is_active: boolean;
  settings?: ShiftSettings | null;
  branches?: { name: string | null } | null;
};

type CompanyRow = {
  id: string;
  name: string;
};

type BranchRow = {
  id: string;
  company_id: string;
  name: string;
};

type Shift = {
  id: string;
  companyId: string;
  branchId: string;
  branchName: string;
  code: string;
  name: string;
  type: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  countsAsWork: boolean;
  allowFlexiblePunch: boolean;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  color: string;
  isActive: boolean;
};

type ShiftForm = Omit<Shift, "id" | "branchName">;
type FormErrors = Partial<Record<keyof ShiftForm, string>>;

const shiftTypeLabels: Record<ShiftType, string> = {
  day: "日班",
  evening: "晚班",
  night: "夜班",
  rest: "休假",
  national_holiday: "國定假日",
  annual_leave: "特休",
};

const defaultColors: Record<ShiftType, string> = {
  day: "#16a34a",
  evening: "#f59e0b",
  night: "#6366f1",
  rest: "#64748b",
  national_holiday: "#0ea5e9",
  annual_leave: "#14b8a6",
};

const blankForm: ShiftForm = {
  companyId: "",
  branchId: "",
  code: "",
  name: "",
  type: "day",
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  crossesMidnight: false,
  countsAsWork: true,
  allowFlexiblePunch: true,
  lateGraceMinutes: 5,
  earlyLeaveGraceMinutes: 5,
  color: "#16a34a",
  isActive: true,
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫班別資料。");
  return supabase as unknown as SupabaseClient;
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 5);
}

function toDbTime(value: string, countsAsWork: boolean) {
  if (!countsAsWork && !value) return "00:00";
  return value || "00:00";
}

function inferShiftType(row: ShiftRow): ShiftType {
  if (row.settings?.type) return row.settings.type;
  const keyword = `${row.code} ${row.name}`.toLowerCase();
  if (keyword.includes("night") || keyword.includes("夜")) return "night";
  if (keyword.includes("evening") || keyword.includes("晚")) return "evening";
  if (keyword.includes("holiday") || keyword.includes("國定")) return "national_holiday";
  if (keyword.includes("leave") || keyword.includes("特休")) return "annual_leave";
  if (keyword.includes("rest") || keyword.includes("休")) return "rest";
  return "day";
}

function mapShift(row: ShiftRow): Shift {
  const type = inferShiftType(row);
  const countsAsWork = row.settings?.countsAsWork ?? !["rest", "national_holiday", "annual_leave"].includes(type);

  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id ?? "",
    branchName: row.branches?.name ?? "全公司",
    code: row.code,
    name: row.name,
    type,
    startTime: countsAsWork ? normalizeTime(row.start_time) : "",
    endTime: countsAsWork ? normalizeTime(row.end_time) : "",
    breakMinutes: row.break_minutes,
    crossesMidnight: row.crosses_midnight,
    countsAsWork,
    allowFlexiblePunch: row.settings?.allowFlexiblePunch ?? false,
    lateGraceMinutes: row.settings?.lateGraceMinutes ?? 0,
    earlyLeaveGraceMinutes: row.settings?.earlyLeaveGraceMinutes ?? 0,
    color: row.settings?.color ?? defaultColors[type],
    isActive: row.is_active,
  };
}

function validateForm(form: ShiftForm): FormErrors {
  const errors: FormErrors = {};

  if (!form.companyId) errors.companyId = "請選擇公司";
  if (!form.code.trim()) errors.code = "請輸入班別代碼";
  if (!form.name.trim()) errors.name = "請輸入班別名稱";
  if (form.countsAsWork && !form.startTime) errors.startTime = "計入工時需填寫上班時間";
  if (form.countsAsWork && !form.endTime) errors.endTime = "計入工時需填寫下班時間";
  if (form.breakMinutes < 0) errors.breakMinutes = "休息時間不可小於 0";
  if (form.lateGraceMinutes < 0) errors.lateGraceMinutes = "遲到寬限不可小於 0";
  if (form.earlyLeaveGraceMinutes < 0) errors.earlyLeaveGraceMinutes = "早退寬限不可小於 0";
  if (!/^#[0-9A-Fa-f]{6}$/.test(form.color)) errors.color = "班別顏色需為 HEX 色碼";

  return errors;
}

export default function ShiftManagementPage() {
  const currentUser = useCurrentUser();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [form, setForm] = useState<ShiftForm>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState("班別資料會從 Supabase shifts 載入，新增與編輯會回寫資料庫。");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supportsSettings, setSupportsSettings] = useState(true);

  const visibleBranches = useMemo(
    () => branches.filter((branch) => branch.company_id === form.companyId),
    [branches, form.companyId],
  );

  function updateForm<K extends keyof ShiftForm>(field: K, value: ShiftForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage("");
  }

  function updateType(type: ShiftType) {
    setForm((current) => ({
      ...current,
      type,
      color: defaultColors[type],
      countsAsWork: !["rest", "national_holiday", "annual_leave"].includes(type),
      startTime: ["rest", "national_holiday", "annual_leave"].includes(type) ? "" : current.startTime || "09:00",
      endTime: ["rest", "national_holiday", "annual_leave"].includes(type) ? "" : current.endTime || "18:00",
      breakMinutes: ["rest", "national_holiday", "annual_leave"].includes(type) ? 0 : current.breakMinutes,
    }));
    setErrors({});
    setMessage("");
  }

  function resetForm(companyId = form.companyId) {
    setEditingId(null);
    setForm({
      ...blankForm,
      companyId: companyId || companies[0]?.id || currentUser.companyId || "",
    });
    setErrors({});
  }

  async function loadShifts() {
    setLoading(true);
    try {
      const supabase = getClient();
      const [companiesResult, branchesResult] = await Promise.all([
        supabase.from("companies").select("id, name").is("deleted_at", null).order("name"),
        supabase.from("branches").select("id, company_id, name").is("deleted_at", null).order("name"),
      ]);
      if (companiesResult.error) throw companiesResult.error;
      if (branchesResult.error) throw branchesResult.error;

      const companyRows = (companiesResult.data ?? []) as CompanyRow[];
      const branchRows = (branchesResult.data ?? []) as BranchRow[];
      const companyId = currentUser.companyId || companyRows[0]?.id || "";

      let shiftResult = await supabase
        .from("shifts")
        .select("id, company_id, branch_id, code, name, start_time, end_time, break_minutes, crosses_midnight, is_active, settings, branches(name)")
        .is("deleted_at", null)
        .order("code");

      if (shiftResult.error && String(shiftResult.error.message).includes("settings")) {
        setSupportsSettings(false);
        shiftResult = await supabase
          .from("shifts")
          .select("id, company_id, branch_id, code, name, start_time, end_time, break_minutes, crosses_midnight, is_active, branches(name)")
          .is("deleted_at", null)
          .order("code");
      }
      if (shiftResult.error) throw shiftResult.error;

      const rows = ((shiftResult.data ?? []) as unknown as ShiftRow[])
        .filter((row) => currentUser.role === "ceo" || !currentUser.companyId || row.company_id === currentUser.companyId)
        .map(mapShift);

      setCompanies(companyRows);
      setBranches(branchRows);
      setShifts(rows);
      setForm((current) => ({ ...current, companyId: current.companyId || companyId }));
      setMessage(supportsSettings ? "班別資料已從 Supabase shifts 載入。" : "班別核心資料已載入；請套用 shifts.settings migration 以保存顏色、類型與寬限設定。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "班別資料載入失敗。");
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadShifts();
  }, [currentUser.companyId, currentUser.role]);

  function editShift(shift: Shift) {
    setEditingId(shift.id);
    setForm({
      companyId: shift.companyId,
      branchId: shift.branchId,
      code: shift.code,
      name: shift.name,
      type: shift.type,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      crossesMidnight: shift.crossesMidnight,
      countsAsWork: shift.countsAsWork,
      allowFlexiblePunch: shift.allowFlexiblePunch,
      lateGraceMinutes: shift.lateGraceMinutes,
      earlyLeaveGraceMinutes: shift.earlyLeaveGraceMinutes,
      color: shift.color,
      isActive: shift.isActive,
    });
    setMessage("");
    setErrors({});
  }

  async function saveShift() {
    const nextErrors = validateForm(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setMessage("請先修正紅色提示欄位。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const settings: ShiftSettings = {
        type: form.type,
        countsAsWork: form.countsAsWork,
        allowFlexiblePunch: form.allowFlexiblePunch,
        lateGraceMinutes: form.lateGraceMinutes,
        earlyLeaveGraceMinutes: form.earlyLeaveGraceMinutes,
        color: form.color,
      };
      const basePayload = {
        company_id: form.companyId,
        branch_id: form.branchId || null,
        code: form.code.trim(),
        name: form.name.trim(),
        start_time: toDbTime(form.startTime, form.countsAsWork),
        end_time: toDbTime(form.endTime, form.countsAsWork),
        break_minutes: form.breakMinutes,
        crosses_midnight: form.crossesMidnight,
        is_active: form.isActive,
        updated_at: new Date().toISOString(),
      };
      const payload = supportsSettings ? { ...basePayload, settings } : basePayload;

      const result = editingId
        ? await supabase.from("shifts").update(payload).eq("id", editingId)
        : await supabase.from("shifts").insert(payload);

      if (result.error && supportsSettings && String(result.error.message).includes("settings")) {
        setSupportsSettings(false);
        const fallback = editingId
          ? await supabase.from("shifts").update(basePayload).eq("id", editingId)
          : await supabase.from("shifts").insert(basePayload);
        if (fallback.error) throw fallback.error;
      } else if (result.error) {
        throw result.error;
      }

      setMessage(`${editingId ? "已更新" : "已新增"}班別，並寫入 Supabase shifts。`);
      resetForm(form.companyId);
      await loadShifts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "班別儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(shift: Shift) {
    setSaving(true);
    try {
      const supabase = getClient();
      const { error } = await supabase
        .from("shifts")
        .update({ is_active: !shift.isActive, updated_at: new Date().toISOString() })
        .eq("id", shift.id);
      if (error) throw error;
      setMessage(`${shift.name} 已${shift.isActive ? "停用" : "啟用"}，並回寫 shifts.is_active。`);
      await loadShifts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "班別狀態切換失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function softDelete(shift: Shift) {
    if (!window.confirm(`確定要刪除「${shift.name}」？系統會以 deleted_at 軟刪除保留稽核。`)) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const { error } = await supabase
        .from("shifts")
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", shift.id);
      if (error) throw error;
      setMessage(`${shift.name} 已刪除，並從班別清單移除。`);
      await loadShifts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "班別刪除失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">SHIFT MANAGEMENT</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">班別管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            管理日班、晚班、夜班、休假、國定假日與特休；新增、編輯、啟停會直接寫入 Supabase shifts。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{loading ? "載入中" : `${shifts.length} 個班別`}</Badge>
          <Button variant="outline" onClick={() => void loadShifts()} disabled={loading || saving}>
            <RefreshCw className="h-4 w-4" />
            重新整理
          </Button>
        </div>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            {editingId ? "編輯班別" : "新增班別"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`rounded-lg p-3 text-sm font-semibold ${
              Object.keys(errors).length ? "bg-rose-50 text-rose-700" : "bg-cyan-50 text-cyan-800"
            }`}
          >
            {loading ? "正在從 Supabase 載入班別..." : saving ? "正在寫入 Supabase shifts..." : message}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1.5 text-sm font-semibold">
              公司
              <select
                value={form.companyId}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateForm("companyId", event.target.value)}
                disabled={Boolean(currentUser.companyId) && currentUser.role !== "ceo"}
              >
                <option value="">請選擇公司</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              {errors.companyId ? <span className="text-xs text-rose-600">{errors.companyId}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              據點
              <select
                value={form.branchId}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateForm("branchId", event.target.value)}
              >
                <option value="">全公司</option>
                {visibleBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              班別代碼
              <Input value={form.code} onChange={(event) => updateForm("code", event.target.value)} />
              {errors.code ? <span className="text-xs text-rose-600">{errors.code}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              班別名稱
              <Input value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
              {errors.name ? <span className="text-xs text-rose-600">{errors.name}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              班別類型
              <select
                value={form.type}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => updateType(event.target.value as ShiftType)}
              >
                {Object.entries(shiftTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              上班時間
              <Input type="time" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} />
              {errors.startTime ? <span className="text-xs text-rose-600">{errors.startTime}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              下班時間
              <Input type="time" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} />
              {errors.endTime ? <span className="text-xs text-rose-600">{errors.endTime}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              休息時間
              <Input
                type="number"
                value={form.breakMinutes}
                onChange={(event) => updateForm("breakMinutes", Number(event.target.value))}
              />
              {errors.breakMinutes ? <span className="text-xs text-rose-600">{errors.breakMinutes}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              遲到寬限分鐘
              <Input
                type="number"
                value={form.lateGraceMinutes}
                onChange={(event) => updateForm("lateGraceMinutes", Number(event.target.value))}
              />
              {errors.lateGraceMinutes ? <span className="text-xs text-rose-600">{errors.lateGraceMinutes}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              早退寬限分鐘
              <Input
                type="number"
                value={form.earlyLeaveGraceMinutes}
                onChange={(event) => updateForm("earlyLeaveGraceMinutes", Number(event.target.value))}
              />
              {errors.earlyLeaveGraceMinutes ? <span className="text-xs text-rose-600">{errors.earlyLeaveGraceMinutes}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              班別顏色
              <div className="flex gap-2">
                <Input value={form.color} onChange={(event) => updateForm("color", event.target.value)} />
                <input
                  type="color"
                  value={form.color}
                  className="h-10 w-12 rounded-md border"
                  onChange={(event) => updateForm("color", event.target.value)}
                />
              </div>
              {errors.color ? <span className="text-xs text-rose-600">{errors.color}</span> : null}
            </label>
            <div className="grid gap-2 rounded-lg border p-3 text-sm md:col-span-2 xl:col-span-2">
              {[
                ["crossesMidnight", "是否跨日"],
                ["countsAsWork", "是否計入工時"],
                ["allowFlexiblePunch", "是否允許彈性打卡"],
                ["isActive", "啟用班別"],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form[field as keyof ShiftForm])}
                    onChange={(event) => updateForm(field as keyof ShiftForm, event.target.checked as never)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {editingId ? (
              <Button variant="outline" onClick={() => resetForm()} disabled={saving}>
                取消
              </Button>
            ) : null}
            <Button onClick={() => void saveShift()} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "儲存班別" : "新增班別"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="h-5 w-5 text-primary" />
            班別清單
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">班別</th>
                    <th className="px-4 py-3 font-bold">據點</th>
                    <th className="px-4 py-3 font-bold">類型</th>
                    <th className="px-4 py-3 font-bold">上班時間</th>
                    <th className="px-4 py-3 font-bold">下班時間</th>
                    <th className="px-4 py-3 font-bold">休息時間</th>
                    <th className="px-4 py-3 font-bold">跨日</th>
                    <th className="px-4 py-3 font-bold">計入工時</th>
                    <th className="px-4 py-3 font-bold">彈性打卡</th>
                    <th className="px-4 py-3 font-bold">寬限</th>
                    <th className="px-4 py-3 font-bold">狀態</th>
                    <th className="px-4 py-3 font-bold">班別顏色</th>
                    <th className="px-4 py-3 text-right font-bold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shifts.map((shift) => (
                    <tr key={shift.id} className="bg-card hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="font-bold">{shift.name}</div>
                        <div className="text-xs text-muted-foreground">{shift.code}</div>
                      </td>
                      <td className="px-4 py-3">{shift.branchName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{shiftTypeLabels[shift.type]}</Badge>
                      </td>
                      <td className="px-4 py-3">{shift.startTime || "-"}</td>
                      <td className="px-4 py-3">{shift.endTime || "-"}</td>
                      <td className="px-4 py-3">{shift.breakMinutes} 分</td>
                      <td className="px-4 py-3">{shift.crossesMidnight ? "是" : "否"}</td>
                      <td className="px-4 py-3">{shift.countsAsWork ? "是" : "否"}</td>
                      <td className="px-4 py-3">{shift.allowFlexiblePunch ? "是" : "否"}</td>
                      <td className="px-4 py-3">
                        遲到 {shift.lateGraceMinutes} / 早退 {shift.earlyLeaveGraceMinutes} 分
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={shift.isActive ? "bg-emerald-600" : "bg-slate-500"}>
                          {shift.isActive ? "啟用" : "停用"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full border" style={{ backgroundColor: shift.color }} />
                          <span>{shift.color}</span>
                          <Palette className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => editShift(shift)}>
                            <Pencil className="h-4 w-4" />
                            編輯
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void toggleActive(shift)} disabled={saving}>
                            <RefreshCw className="h-4 w-4" />
                            {shift.isActive ? "停用" : "啟用"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void softDelete(shift)} disabled={saving}>
                            <Trash2 className="h-4 w-4" />
                            刪除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!shifts.length ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
                        {loading ? "正在載入班別..." : "尚未建立班別，請新增第一個班別。"}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {shifts.slice(0, 6).map((shift) => (
              <div key={`${shift.id}-preview`} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black">{shift.name}</div>
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: shift.color }} />
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                  {shift.startTime || "-"} - {shift.endTime || "-"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
