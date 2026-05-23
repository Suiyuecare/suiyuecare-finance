"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarX2,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type LeaveTypeName =
  | "特休"
  | "事假"
  | "病假"
  | "生理假"
  | "婚假"
  | "喪假"
  | "產假"
  | "產檢假"
  | "陪產檢及陪產假"
  | "公假"
  | "補休"
  | "家庭照顧假"
  | "防疫照顧假"
  | "育嬰留職停薪";

type PayMode = "全薪" | "半薪" | "不支薪" | "依規則";
type AttachmentRequirement = "不需附件" | "達門檻需附件" | "必須附件";

type LeaveTypeRule = {
  id: string;
  name: LeaveTypeName;
  isPaid: boolean;
  payMode: PayMode;
  deductAttendanceBonus: boolean;
  minimumUnitMinutes: number;
  minimumUnitHours: number;
  maxDailyHours: number;
  annualQuotaHours: number | null;
  attachmentRequirement: AttachmentRequirement;
  attachmentNote: string;
  enabled: boolean;
};

type LeaveTypeForm = {
  name: LeaveTypeName;
  isPaid: boolean;
  payMode: PayMode;
  deductAttendanceBonus: boolean;
  minimumUnitMinutes: string;
  maxDailyHours: string;
  annualQuotaHours: string;
  attachmentRequirement: AttachmentRequirement;
  attachmentNote: string;
};

type LeaveRulesSetting = {
  version: number;
  rules: LeaveTypeRule[];
  updatedAt: string;
};

const leaveTypeNames: LeaveTypeName[] = [
  "特休",
  "事假",
  "病假",
  "生理假",
  "婚假",
  "喪假",
  "產假",
  "產檢假",
  "陪產檢及陪產假",
  "公假",
  "補休",
  "家庭照顧假",
  "防疫照顧假",
  "育嬰留職停薪",
];

const initialLeaveTypes: LeaveTypeRule[] = [
  { id: "LT-001", name: "特休", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "不需附件", attachmentNote: "依到職年資自動計算額度", enabled: true },
  { id: "LT-002", name: "事假", isPaid: false, payMode: "不支薪", deductAttendanceBonus: true, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: 112, attachmentRequirement: "達門檻需附件", attachmentNote: "連續 3 日以上需說明或附件", enabled: true },
  { id: "LT-003", name: "病假", isPaid: true, payMode: "半薪", deductAttendanceBonus: true, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: 240, attachmentRequirement: "達門檻需附件", attachmentNote: "連續或特定時數以上需診斷證明", enabled: true },
  { id: "LT-004", name: "生理假", isPaid: true, payMode: "半薪", deductAttendanceBonus: false, minimumUnitMinutes: 480, minimumUnitHours: 8, maxDailyHours: 8, annualQuotaHours: 24, attachmentRequirement: "不需附件", attachmentNote: "每月以 1 日為常用門檻", enabled: true },
  { id: "LT-005", name: "婚假", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 480, minimumUnitHours: 8, maxDailyHours: 8, annualQuotaHours: 64, attachmentRequirement: "必須附件", attachmentNote: "需上傳結婚證明文件", enabled: true },
  { id: "LT-006", name: "喪假", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 480, minimumUnitHours: 8, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "必須附件", attachmentNote: "依親等設定可請額度", enabled: true },
  { id: "LT-007", name: "產假", isPaid: true, payMode: "依規則", deductAttendanceBonus: false, minimumUnitMinutes: 480, minimumUnitHours: 8, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "必須附件", attachmentNote: "需生產或醫療相關證明", enabled: true },
  { id: "LT-008", name: "產檢假", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 240, minimumUnitHours: 4, maxDailyHours: 8, annualQuotaHours: 56, attachmentRequirement: "達門檻需附件", attachmentNote: "七日且薪資照給，必要時上傳產檢證明", enabled: true },
  { id: "LT-009", name: "陪產檢及陪產假", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 240, minimumUnitHours: 4, maxDailyHours: 8, annualQuotaHours: 56, attachmentRequirement: "必須附件", attachmentNote: "七日且薪資照給，需出生、配偶生產或產檢證明", enabled: true },
  { id: "LT-010", name: "公假", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "必須附件", attachmentNote: "需公文、派訓或主管核准文件", enabled: true },
  { id: "LT-011", name: "補休", isPaid: true, payMode: "全薪", deductAttendanceBonus: false, minimumUnitMinutes: 30, minimumUnitHours: 0.5, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "不需附件", attachmentNote: "由加班轉補休額度控管", enabled: true },
  { id: "LT-012", name: "家庭照顧假", isPaid: false, payMode: "不支薪", deductAttendanceBonus: false, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: 56, attachmentRequirement: "達門檻需附件", attachmentNote: "全年七日併入事假計算，但不得影響全勤、考績或不利處分", enabled: true },
  { id: "LT-013", name: "防疫照顧假", isPaid: false, payMode: "依規則", deductAttendanceBonus: false, minimumUnitMinutes: 60, minimumUnitHours: 1, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "必須附件", attachmentNote: "需隔離、停課或主管機關文件", enabled: true },
  { id: "LT-014", name: "育嬰留職停薪", isPaid: false, payMode: "不支薪", deductAttendanceBonus: false, minimumUnitMinutes: 480, minimumUnitHours: 8, maxDailyHours: 8, annualQuotaHours: null, attachmentRequirement: "必須附件", attachmentNote: "任職滿六個月且子女未滿三歲，連動員工狀態與復職", enabled: true },
];

const defaultForm: LeaveTypeForm = {
  name: "特休",
  isPaid: true,
  payMode: "全薪",
  deductAttendanceBonus: false,
  minimumUnitMinutes: "60",
  maxDailyHours: "8",
  annualQuotaHours: "",
  attachmentRequirement: "不需附件",
  attachmentNote: "",
};

const payModeStyles: Record<PayMode, string> = {
  全薪: "bg-emerald-50 text-emerald-700",
  半薪: "bg-sky-50 text-sky-700",
  不支薪: "bg-rose-50 text-rose-700",
  依規則: "bg-violet-50 text-violet-700",
};

const attachmentStyles: Record<AttachmentRequirement, string> = {
  不需附件: "bg-slate-100 text-slate-600",
  達門檻需附件: "bg-amber-50 text-amber-700",
  必須附件: "bg-rose-50 text-rose-700",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫假別規則。");
  return supabase as unknown as SupabaseClient;
}

function toForm(rule: LeaveTypeRule): LeaveTypeForm {
  return {
    name: rule.name,
    isPaid: rule.isPaid,
    payMode: rule.payMode,
    deductAttendanceBonus: rule.deductAttendanceBonus,
    minimumUnitMinutes: String(rule.minimumUnitMinutes ?? Math.round(rule.minimumUnitHours * 60)),
    maxDailyHours: String(rule.maxDailyHours ?? 8),
    annualQuotaHours: rule.annualQuotaHours === null ? "" : String(rule.annualQuotaHours),
    attachmentRequirement: rule.attachmentRequirement,
    attachmentNote: rule.attachmentNote,
  };
}

function normalizeLeaveRule(rule: LeaveTypeRule): LeaveTypeRule {
  const minimumUnitMinutes = Number.isFinite(rule.minimumUnitMinutes)
    ? rule.minimumUnitMinutes
    : Math.round((Number(rule.minimumUnitHours) || 1) * 60);
  const maxDailyHours = Number.isFinite(rule.maxDailyHours) ? rule.maxDailyHours : 8;

  return {
    ...rule,
    minimumUnitMinutes,
    minimumUnitHours: minimumUnitMinutes / 60,
    maxDailyHours,
  };
}

export default function LeaveTypesPage() {
  const currentUser = useCurrentUser();
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRule[]>(initialLeaveTypes);
  const [form, setForm] = useState<LeaveTypeForm>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("假別規則會從 Supabase system_settings 載入，並連動請假申請、出勤與薪資扣薪計算。");
  const [error, setError] = useState("");

  const stats = useMemo(
    () => ({
      total: leaveTypes.length,
      paid: leaveTypes.filter((item) => item.isPaid).length,
      deductBonus: leaveTypes.filter((item) => item.deductAttendanceBonus).length,
      requireAttachment: leaveTypes.filter((item) => item.attachmentRequirement !== "不需附件").length,
    }),
    [leaveTypes],
  );

  async function resolveCompanyId(supabase: SupabaseClient) {
    if (currentUser.companyId) return currentUser.companyId;
    if (companyId) return companyId;
    const { data, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (companyError) throw companyError;
    const resolved = (data as { id: string } | null)?.id ?? "";
    if (!resolved) throw new Error("找不到公司主檔，無法儲存假別規則。");
    return resolved;
  }

  async function persistLeaveTypes(nextRules: LeaveTypeRule[], status: "draft" | "active" = "active") {
    const payload: LeaveRulesSetting = {
      version: 1,
      rules: nextRules,
      updatedAt: new Date().toISOString(),
    };
    const response = await fetch("/api/settings/leave-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: payload, status }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "假別規則後端寫入失敗。");
    if (currentUser.companyId) setCompanyId(currentUser.companyId);
  }

  async function loadLeaveTypes() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/leave-rules");
      if (response.ok) {
        const result = await response.json() as { settings: LeaveRulesSetting | null };
        const rules = (Array.isArray(result.settings?.rules) && result.settings.rules.length ? result.settings.rules : initialLeaveTypes).map(normalizeLeaveRule);
        setCompanyId(currentUser.companyId);
        setLeaveTypes(rules);
        setMessage(result.settings ? "假別規則已透過後端 API 從 Supabase system_settings 載入。" : "目前尚未建立假別設定，先載入系統預設規則；儲存後會寫入 Supabase。");
        return;
      }

      const supabase = getClient();
      const resolvedCompanyId = await resolveCompanyId(supabase);
      const { data, error: loadError } = await supabase
        .from("system_settings")
        .select("settings")
        .eq("company_id", resolvedCompanyId)
        .eq("setting_key", "leave_type_rules")
        .is("deleted_at", null)
        .maybeSingle();
      if (loadError) throw loadError;

      const settings = (data as { settings: LeaveRulesSetting | null } | null)?.settings;
      const rules = (Array.isArray(settings?.rules) && settings.rules.length ? settings.rules : initialLeaveTypes).map(normalizeLeaveRule);
      setCompanyId(resolvedCompanyId);
      setLeaveTypes(rules);
      setMessage(data ? "假別規則已從 Supabase system_settings 載入。" : "目前尚未建立假別設定，先載入系統預設規則；儲存後會寫入 Supabase。");
    } catch (loadError) {
      setMessage(loadError instanceof Error ? loadError.message : "假別規則載入失敗。");
      setLeaveTypes(initialLeaveTypes);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLeaveTypes();
  }, [currentUser.companyId]);

  const saveRule = async () => {
    const minimumUnitMinutes = Number(form.minimumUnitMinutes);
    const maxDailyHours = Number(form.maxDailyHours || "8");
    const annualQuota = form.annualQuotaHours.trim() ? Number(form.annualQuotaHours) : null;

    if (!Number.isFinite(minimumUnitMinutes) || minimumUnitMinutes <= 0) {
      setError("單日最少申請分鐘需大於 0。");
      setMessage("假別規則尚未儲存。");
      return;
    }

    if (!Number.isInteger(minimumUnitMinutes)) {
      setError("單日最少申請分鐘需為整數。");
      setMessage("假別規則尚未儲存。");
      return;
    }

    if (!Number.isFinite(maxDailyHours) || maxDailyHours <= 0 || maxDailyHours > 24) {
      setError("單日最多申請時數需大於 0 且不可超過 24 小時。");
      setMessage("假別規則尚未儲存。");
      return;
    }

    if (minimumUnitMinutes > maxDailyHours * 60) {
      setError("單日最少申請分鐘不可大於單日最多申請時數。");
      setMessage("假別規則尚未儲存。");
      return;
    }

    if (annualQuota !== null && (!Number.isFinite(annualQuota) || annualQuota < 0)) {
      setError("年度額度不可小於 0。");
      setMessage("假別規則尚未儲存。");
      return;
    }

    const nextRule: LeaveTypeRule = {
      id: editingId ?? `LT-${String(leaveTypes.length + 1).padStart(3, "0")}`,
      name: form.name,
      isPaid: form.isPaid,
      payMode: form.payMode,
      deductAttendanceBonus: form.deductAttendanceBonus,
      minimumUnitMinutes,
      minimumUnitHours: minimumUnitMinutes / 60,
      maxDailyHours,
      annualQuotaHours: annualQuota,
      attachmentRequirement: form.attachmentRequirement,
      attachmentNote: form.attachmentNote.trim() || "依公司規則與主管審核判斷",
      enabled: true,
    };

    setSaving(true);
    try {
      const nextRules = editingId
        ? leaveTypes.map((item) => (item.id === editingId ? nextRule : item))
        : [nextRule, ...leaveTypes];
      await persistLeaveTypes(nextRules);
      setLeaveTypes(nextRules);
      setMessage(editingId ? `已儲存 ${nextRule.name} 假別規則，並寫入 Supabase。` : `已新增 ${nextRule.name} 假別規則，並寫入 Supabase。`);
      setError("");
      setEditingId(null);
      setForm(defaultForm);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "假別規則儲存失敗。");
      setMessage("假別規則尚未儲存。");
    } finally {
      setSaving(false);
    }
  };

  const editRule = (rule: LeaveTypeRule) => {
    setEditingId(rule.id);
    setForm(toForm(rule));
    setMessage(`正在編輯 ${rule.name} 假別規則。`);
    setError("");
  };

  const toggleEnabled = async (id: string) => {
    const target = leaveTypes.find((item) => item.id === id);
    if (!target) return;
    setSaving(true);
    try {
      const nextRules = leaveTypes.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item));
      await persistLeaveTypes(nextRules);
      setLeaveTypes(nextRules);
      setMessage(`${target.name} 已${target.enabled ? "停用" : "啟用"}，並回寫 Supabase。`);
      setError("");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "假別狀態切換失敗。");
      setMessage("假別規則尚未儲存。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">假勤規則設定</p>
          <h1 className="text-2xl font-semibold text-slate-950">假別管理</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            維護特休、事假、病假、生理假、婚假、喪假、產假、產檢假、陪產檢及陪產假、公假、補休、家庭照顧假、防疫照顧假與育嬰留職停薪規則；規則會寫入 Supabase。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => void loadLeaveTypes()}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新整理
          </button>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">薪資計算連動</span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">請假額度控管</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">附件門檻檢查</span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "假別總數", value: `${stats.total} 種`, icon: CalendarX2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "支薪假別", value: `${stats.paid} 種`, icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
          { label: "扣全勤", value: `${stats.deductBonus} 種`, icon: XCircle, tone: "bg-rose-50 text-rose-700" },
          { label: "需附件", value: `${stats.requireAttachment} 種`, icon: FileText, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{editingId ? "編輯假別規則" : "新增假別規則"}</h2>
              <p className="text-sm text-slate-500">設定是否支薪、是否扣全勤、單日最少申請分鐘、單日最多申請時數、年度額度與附件要求。</p>
            </div>
            <Plus className="h-5 w-5 text-emerald-600" />
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {loading ? "正在從 Supabase 載入假別規則..." : saving ? "正在寫入 Supabase system_settings..." : error || message}
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              假別
              <select
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value as LeaveTypeName }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {leaveTypeNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isPaid}
                  onChange={(event) => setForm((current) => ({ ...current, isPaid: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                是否支薪
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.deductAttendanceBonus}
                  onChange={(event) => setForm((current) => ({ ...current, deductAttendanceBonus: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                是否扣全勤
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              支薪規則
              <select
                value={form.payMode}
                onChange={(event) => setForm((current) => ({ ...current, payMode: event.target.value as PayMode }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {(["全薪", "半薪", "不支薪", "依規則"] as PayMode[]).map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                單日最少申請（分鐘）
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.minimumUnitMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, minimumUnitMinutes: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                單日最多申請（小時）
                <input
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  value={form.maxDailyHours}
                  onChange={(event) => setForm((current) => ({ ...current, maxDailyHours: event.target.value }))}
                  placeholder="預設 8"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                年度額度（小時）
                <input
                  type="number"
                  min="0"
                  value={form.annualQuotaHours}
                  onChange={(event) => setForm((current) => ({ ...current, annualQuotaHours: event.target.value }))}
                  placeholder="空白代表依規則"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              附件要求
              <select
                value={form.attachmentRequirement}
                onChange={(event) => setForm((current) => ({ ...current, attachmentRequirement: event.target.value as AttachmentRequirement }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {(["不需附件", "達門檻需附件", "必須附件"] as AttachmentRequirement[]).map((requirement) => (
                  <option key={requirement}>{requirement}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              附件說明
              <textarea
                value={form.attachmentNote}
                onChange={(event) => setForm((current) => ({ ...current, attachmentNote: event.target.value }))}
                rows={3}
                placeholder="例：連續 3 日以上需上傳證明"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            onClick={() => void saveRule()}
            disabled={loading || saving}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingId ? "儲存修改" : "新增假別"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">假別規則清單</h2>
            <p className="text-sm text-slate-500">每種假別需設定是否支薪、是否扣全勤、單日最少與最多可請數量、年度額度、附件要求。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">假別</th>
                  <th className="px-4 py-3">是否支薪</th>
                  <th className="px-4 py-3">是否扣全勤</th>
                  <th className="px-4 py-3">單日最少</th>
                  <th className="px-4 py-3">單日最多</th>
                  <th className="px-4 py-3">年度額度</th>
                  <th className="px-4 py-3">附件要求</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaveTypes.map((rule) => (
                  <tr key={rule.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-950">{rule.name}</p>
                      <p className="mt-1 max-w-xs text-xs text-slate-500">{rule.attachmentNote}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${payModeStyles[rule.payMode]}`}>{rule.payMode}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${rule.deductAttendanceBonus ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {rule.deductAttendanceBonus ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {rule.deductAttendanceBonus ? "扣全勤" : "不扣全勤"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{rule.minimumUnitMinutes} 分鐘</td>
                    <td className="px-4 py-4 text-slate-700">{rule.maxDailyHours ?? 8} 小時</td>
                    <td className="px-4 py-4 text-slate-700">{rule.annualQuotaHours === null ? "依規則" : `${rule.annualQuotaHours} 小時`}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${attachmentStyles[rule.attachmentRequirement]}`}>
                        {rule.attachmentRequirement}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => void toggleEnabled(rule.id)}
                        disabled={saving || loading}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${rule.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {rule.enabled ? "啟用" : "停用"}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => editRule(rule)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        編輯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">薪資扣薪連動</h2>
          </div>
          <p className="text-sm text-emerald-800">假別的支薪規則會提供給請假扣薪計算模組，支援全薪、半薪、不支薪與依規則。</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-sky-700" />
            <h2 className="font-semibold text-sky-900">額度與單位控管</h2>
          </div>
          <p className="text-sm text-sky-800">單日最少申請分鐘、單日最多申請時數與年度額度會在員工送出請假申請前檢查，避免超額或單位不符。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-amber-700" />
            <h2 className="font-semibold text-amber-900">附件要求</h2>
          </div>
          <p className="text-sm text-amber-800">附件要求可設定為不需附件、達門檻需附件或必須附件，後續請假表單會依此顯示必填提示。</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">法規與公司規則維護提醒</h2>
            <p className="mt-1 text-sm text-slate-500">
              此頁先提供可維護的假別規則結構；實際額度、支薪比例與附件門檻建議由人資依最新法規、勞動契約與公司制度在後台維護，避免將規則寫死在程式碼。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
