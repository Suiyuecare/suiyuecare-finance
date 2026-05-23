"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  CircleDollarSign,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCcw,
  Save,
  ShieldCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type PayrollItemCategory = "固定加項" | "變動加項" | "固定扣項" | "變動扣項" | "公司負擔項" | "員工自付項";
type CalculationBasis = "固定金額" | "出勤計算" | "加班計算" | "級距計算" | "比例計算" | "手動輸入";
type DbCategory = "fixed_earning" | "variable_earning" | "fixed_deduction" | "variable_deduction" | "employer_cost" | "employee_contribution";
type DbCalculationBasis = "fixed_amount" | "attendance" | "overtime" | "rate_table" | "percentage" | "manual";

type PayrollItemSettingRow = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  category: DbCategory;
  calculation_basis: DbCalculationBasis;
  default_amount: number | string | null;
  taxable: boolean;
  include_in_insurance_wage: boolean;
  is_active: boolean;
  legal_basis: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type PayrollItem = {
  id: string;
  code: string;
  name: string;
  category: PayrollItemCategory;
  calculationBasis: CalculationBasis;
  defaultAmount: number;
  taxable: boolean;
  includeInInsuranceWage: boolean;
  enabled: boolean;
  legalBasis: string;
  description: string;
  updatedAt: string;
};

type PayrollItemForm = Omit<PayrollItem, "id" | "updatedAt">;

const categories: PayrollItemCategory[] = ["固定加項", "變動加項", "固定扣項", "變動扣項", "公司負擔項", "員工自付項"];
const calculationBases: CalculationBasis[] = ["固定金額", "出勤計算", "加班計算", "級距計算", "比例計算", "手動輸入"];

const categoryToDb: Record<PayrollItemCategory, DbCategory> = {
  固定加項: "fixed_earning",
  變動加項: "variable_earning",
  固定扣項: "fixed_deduction",
  變動扣項: "variable_deduction",
  公司負擔項: "employer_cost",
  員工自付項: "employee_contribution",
};

const categoryFromDb: Record<DbCategory, PayrollItemCategory> = {
  fixed_earning: "固定加項",
  variable_earning: "變動加項",
  fixed_deduction: "固定扣項",
  variable_deduction: "變動扣項",
  employer_cost: "公司負擔項",
  employee_contribution: "員工自付項",
};

const calculationToDb: Record<CalculationBasis, DbCalculationBasis> = {
  固定金額: "fixed_amount",
  出勤計算: "attendance",
  加班計算: "overtime",
  級距計算: "rate_table",
  比例計算: "percentage",
  手動輸入: "manual",
};

const calculationFromDb: Record<DbCalculationBasis, CalculationBasis> = {
  fixed_amount: "固定金額",
  attendance: "出勤計算",
  overtime: "加班計算",
  rate_table: "級距計算",
  percentage: "比例計算",
  manual: "手動輸入",
};

const defaultForm: PayrollItemForm = {
  code: "",
  name: "",
  category: "固定加項",
  calculationBasis: "固定金額",
  defaultAmount: 0,
  taxable: true,
  includeInInsuranceWage: false,
  enabled: true,
  legalBasis: "",
  description: "",
};

const defaultCatalog: PayrollItemForm[] = [
  { code: "BASE", name: "本薪", category: "固定加項", calculationBasis: "固定金額", defaultAmount: 0, taxable: true, includeInInsuranceWage: true, enabled: true, legalBasis: "勞動契約、工資清冊", description: "員工主要薪資基礎，依薪資型態與員工薪資設定帶入。" },
  { code: "OT", name: "加班費", category: "變動加項", calculationBasis: "加班計算", defaultAmount: 0, taxable: true, includeInInsuranceWage: false, enabled: true, legalBasis: "勞動基準法第24條、第39條", description: "依平日、休息日、例假日、國定假日加班規則計算。" },
  { code: "ALLOWANCE", name: "津貼", category: "固定加項", calculationBasis: "固定金額", defaultAmount: 0, taxable: true, includeInInsuranceWage: true, enabled: true, legalBasis: "勞動契約、公司薪資規則", description: "伙食津貼、職務津貼、證照津貼、交通津貼等可彙總或拆項。" },
  { code: "BONUS", name: "獎金", category: "變動加項", calculationBasis: "手動輸入", defaultAmount: 0, taxable: true, includeInInsuranceWage: false, enabled: true, legalBasis: "公司獎金辦法或核准紀錄", description: "績效獎金、留任獎金或專案獎金。" },
  { code: "ATTENDANCE", name: "全勤", category: "固定加項", calculationBasis: "出勤計算", defaultAmount: 2000, taxable: true, includeInInsuranceWage: true, enabled: true, legalBasis: "公司全勤獎金規則", description: "依出勤異常、請假扣全勤規則判斷。" },
  { code: "LEAVE_DEDUCT", name: "請假扣薪", category: "變動扣項", calculationBasis: "出勤計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "勞動基準法、性別平等工作法、公司假別規則", description: "依假別支薪比例與請假時數計算扣薪。" },
  { code: "LATE_DEDUCT", name: "遲到扣款", category: "變動扣項", calculationBasis: "出勤計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "公司出勤規則、工資扣款同意紀錄", description: "依遲到早退與公司扣款規則計算。" },
  { code: "LABOR_SELF", name: "勞保自付", category: "員工自付項", calculationBasis: "級距計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "勞工保險條例與級距表", description: "依勞保級距與員工負擔比例計算。" },
  { code: "NHI_SELF", name: "健保自付", category: "員工自付項", calculationBasis: "級距計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "全民健康保險法與級距表", description: "依健保級距、眷屬人數與員工負擔比例計算。" },
  { code: "PENSION_COMPANY", name: "勞退公司提繳", category: "公司負擔項", calculationBasis: "比例計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "勞工退休金條例", description: "依勞退提繳工資與公司提繳比例計算。" },
  { code: "SUPPLEMENT_NHI", name: "補充保費", category: "員工自付項", calculationBasis: "級距計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "全民健康保險法補充保險費規定", description: "依二代健保補充保費規則計算。" },
  { code: "INCOME_TAX", name: "所得稅", category: "固定扣項", calculationBasis: "比例計算", defaultAmount: 0, taxable: false, includeInInsuranceWage: false, enabled: true, legalBasis: "所得稅法與扣繳辦法", description: "依員工所得稅設定與扣繳規則計算。" },
];

const categoryStyles: Record<PayrollItemCategory, string> = {
  固定加項: "bg-emerald-50 text-emerald-700",
  變動加項: "bg-sky-50 text-sky-700",
  固定扣項: "bg-rose-50 text-rose-700",
  變動扣項: "bg-orange-50 text-orange-700",
  公司負擔項: "bg-violet-50 text-violet-700",
  員工自付項: "bg-amber-50 text-amber-700",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "_").toUpperCase();
}

function mapRow(row: PayrollItemSettingRow): PayrollItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: categoryFromDb[row.category],
    calculationBasis: calculationFromDb[row.calculation_basis],
    defaultAmount: Number(row.default_amount ?? 0),
    taxable: row.taxable,
    includeInInsuranceWage: row.include_in_insurance_wage,
    enabled: row.is_active,
    legalBasis: row.legal_basis ?? "",
    description: row.description ?? "",
    updatedAt: row.updated_at,
  };
}

function buildPayload(form: PayrollItemForm, companyId: string, userId: string) {
  return {
    company_id: companyId,
    code: normalizeCode(form.code),
    name: form.name.trim(),
    category: categoryToDb[form.category],
    calculation_basis: calculationToDb[form.calculationBasis],
    default_amount: Number.isFinite(form.defaultAmount) ? form.defaultAmount : 0,
    taxable: form.taxable,
    include_in_insurance_wage: form.includeInInsuranceWage,
    is_active: form.enabled,
    legal_basis: form.legalBasis.trim() || null,
    description: form.description.trim() || "依薪資結算規則計算。",
    updated_by: userId,
  };
}

function canManagePayroll(role: string) {
  return ["hr", "admin_director", "ceo"].includes(role);
}

export default function PayrollItemsPage() {
  const currentUser = useCurrentUser();
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<PayrollItemCategory | "全部">("全部");
  const [form, setForm] = useState<PayrollItemForm>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("薪資項目會直接寫入 Supabase，並影響後續出勤轉薪資與結薪檢查。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const allowManage = canManagePayroll(currentUser.role);

  const filteredItems = useMemo(
    () => items.filter((item) => activeCategory === "全部" || item.category === activeCategory),
    [activeCategory, items],
  );

  const stats = useMemo(
    () => ({
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      addition: items.filter((item) => item.category.includes("加項")).length,
      deduction: items.filter((item) => item.category.includes("扣項")).length,
      company: items.filter((item) => item.category === "公司負擔項").length,
      self: items.filter((item) => item.category === "員工自付項").length,
    }),
    [items],
  );

  const writeAudit = async (action: string, resourceId: string | null, beforeData: unknown, afterData: unknown) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId || !currentUser.id) return;

    await (supabase as any).from("audit_logs").insert({
      company_id: currentUser.companyId,
      actor_user_id: currentUser.id,
      action,
      resource_type: "payroll_item_settings",
      resource_id: resourceId,
      before_data: beforeData,
      after_data: afterData,
      metadata: { page: "payroll/items" },
    });
  };

  const loadItems = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      setError("尚未設定 Supabase 連線，無法讀取薪資項目。");
      return;
    }
    if (!currentUser.companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: queryError } = await (supabase as any)
      .from("payroll_item_settings")
      .select("*")
      .eq("company_id", currentUser.companyId)
      .is("deleted_at", null)
      .order("is_active", { ascending: false })
      .order("category", { ascending: true })
      .order("code", { ascending: true });

    if (queryError) {
      setError(queryError.message);
      setMessage("薪資項目讀取失敗，請確認 migration 與 RLS 已套用。");
      setItems([]);
    } else {
      setItems(((data ?? []) as PayrollItemSettingRow[]).map(mapRow));
      setMessage(`已同步 Supabase 薪資項目設定，共 ${data?.length ?? 0} 筆。`);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadItems();
  }, [currentUser.companyId]);

  const updateForm = <K extends keyof PayrollItemForm>(key: K, value: PayrollItemForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(defaultForm);
    setError("");
  };

  const saveItem = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId) {
      setError("尚未登入公司帳號，無法儲存薪資項目。");
      return;
    }
    if (!allowManage) {
      setError("你沒有薪資項目管理權限。");
      return;
    }
    if (!normalizeCode(form.code) || !form.name.trim()) {
      setError("請填寫薪資項目代碼與項目名稱。");
      setMessage("薪資項目尚未儲存。");
      return;
    }

    setSaving(true);
    const previous = editingId ? items.find((item) => item.id === editingId) ?? null : null;
    const payload = buildPayload(form, currentUser.companyId, currentUser.id);
    const action = editingId
      ? (supabase as any).from("payroll_item_settings").update(payload).eq("id", editingId).select("*").single()
      : (supabase as any).from("payroll_item_settings").insert({ ...payload, created_by: currentUser.id }).select("*").single();

    const { data, error: mutationError } = await action;
    if (mutationError) {
      setError(mutationError.message);
      setMessage("薪資項目尚未寫入 Supabase。");
      setSaving(false);
      return;
    }

    await writeAudit(editingId ? "payroll_item_setting.update" : "payroll_item_setting.create", data.id, previous, data);
    await loadItems();
    setMessage(editingId ? `已儲存薪資項目：${data.name}` : `已新增薪資項目：${data.name}`);
    resetForm();
    setSaving(false);
  };

  const editItem = (item: PayrollItem) => {
    setEditingId(item.id);
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      calculationBasis: item.calculationBasis,
      defaultAmount: item.defaultAmount,
      taxable: item.taxable,
      includeInInsuranceWage: item.includeInInsuranceWage,
      enabled: item.enabled,
      legalBasis: item.legalBasis,
      description: item.description,
    });
    setMessage(`正在編輯薪資項目：${item.name}`);
    setError("");
  };

  const toggleEnabled = async (item: PayrollItem) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !allowManage) {
      setError("你沒有薪資項目管理權限。");
      return;
    }
    setSaving(true);
    const { data, error: mutationError } = await (supabase as any)
      .from("payroll_item_settings")
      .update({ is_active: !item.enabled, updated_by: currentUser.id })
      .eq("id", item.id)
      .select("*")
      .single();

    if (mutationError) {
      setError(mutationError.message);
      setSaving(false);
      return;
    }

    await writeAudit(item.enabled ? "payroll_item_setting.disable" : "payroll_item_setting.enable", item.id, item, data);
    await loadItems();
    setMessage(`${item.name} 已${item.enabled ? "停用" : "啟用"}，並寫入 Supabase。`);
    setSaving(false);
  };

  const createDefaultCatalog = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId || !allowManage) {
      setError("你沒有建立預設薪資項目的權限。");
      return;
    }
    setSaving(true);
    const payload = defaultCatalog.map((item) => ({
      ...buildPayload(item, currentUser.companyId, currentUser.id),
      created_by: currentUser.id,
    }));

    const { error: upsertError } = await (supabase as any)
      .from("payroll_item_settings")
      .upsert(payload, { onConflict: "company_id,code" });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    await writeAudit("payroll_item_setting.seed_defaults", null, null, { count: payload.length });
    await loadItems();
    setMessage("已將預設薪資項目寫入 Supabase，可再依公司薪資規則微調。");
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Payroll Item Catalog</p>
          <h1 className="text-2xl font-semibold text-slate-950">薪資項目管理</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            建立薪資計算項目字典，支援固定加項、變動加項、固定扣項、變動扣項、公司負擔項與員工自付項；新增、編輯、停用都會回寫 Supabase。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void loadItems()} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新同步
          </button>
          <button onClick={() => void createDefaultCatalog()} disabled={!allowManage || loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            建立預設項目
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "薪資項目", value: `${stats.total} 項`, icon: ReceiptText, tone: "bg-emerald-50 text-emerald-700" },
          { label: "啟用中", value: `${stats.enabled} 項`, icon: CheckCircle2, tone: "bg-teal-50 text-teal-700" },
          { label: "加項", value: `${stats.addition} 項`, icon: CircleDollarSign, tone: "bg-sky-50 text-sky-700" },
          { label: "扣項", value: `${stats.deduction} 項`, icon: XCircle, tone: "bg-rose-50 text-rose-700" },
          { label: "法定/自付", value: `${stats.company + stats.self} 項`, icon: WalletCards, tone: "bg-amber-50 text-amber-700" },
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

      <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{editingId ? "編輯薪資項目" : "新增薪資項目"}</h2>
              <p className="text-sm text-slate-500">設定類別、計算方式、預設金額、稅務、投保與法規依據。</p>
            </div>
            {saving ? <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> : <Plus className="h-5 w-5 text-emerald-600" />}
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error || message}
          </div>

          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                項目代碼
                <input value={form.code} onChange={(event) => updateForm("code", event.target.value)} placeholder="例：BASE" disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                項目名稱
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="例：本薪" disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                分類
                <select value={form.category} onChange={(event) => updateForm("category", event.target.value as PayrollItemCategory)} disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                計算方式
                <select value={form.calculationBasis} onChange={(event) => updateForm("calculationBasis", event.target.value as CalculationBasis)} disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {calculationBases.map((basis) => <option key={basis}>{basis}</option>)}
                </select>
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              預設金額
              <input type="number" min="0" value={form.defaultAmount} onChange={(event) => updateForm("defaultAmount", Number(event.target.value))} disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={form.taxable} onChange={(event) => updateForm("taxable", event.target.checked)} disabled={!allowManage || saving} className="h-4 w-4 rounded border-slate-300" />
                應稅
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={form.includeInInsuranceWage} onChange={(event) => updateForm("includeInInsuranceWage", event.target.checked)} disabled={!allowManage || saving} className="h-4 w-4 rounded border-slate-300" />
                納入投保薪資
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm("enabled", event.target.checked)} disabled={!allowManage || saving} className="h-4 w-4 rounded border-slate-300" />
                啟用
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              法規 / 依據
              <input value={form.legalBasis} onChange={(event) => updateForm("legalBasis", event.target.value)} placeholder="例：勞動基準法第24條、公司薪資規則" disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              項目說明
              <textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} rows={4} placeholder="說明此薪資項目的計算來源與用途" disabled={!allowManage || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void saveItem()} disabled={!allowManage || saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "儲存修改" : "新增項目"}
            </button>
            {editingId && (
              <button onClick={resetForm} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
                取消編輯
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">薪資項目清單</h2>
              <p className="text-sm text-slate-500">這裡是薪資項目設定主檔，不是薪資單明細；結薪後才會產生 payroll_items 明細。</p>
            </div>
            <select value={activeCategory} onChange={(event) => setActiveCategory(event.target.value as PayrollItemCategory | "全部")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option>全部</option>
              {categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">薪資項目</th>
                  <th className="px-4 py-3">分類</th>
                  <th className="px-4 py-3">計算方式</th>
                  <th className="px-4 py-3">預設金額</th>
                  <th className="px-4 py-3">稅務 / 投保</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-emerald-600" />
                      正在同步 Supabase 薪資項目
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">尚無薪資項目，請新增或建立預設項目。</td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-950">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.code}</p>
                        <p className="mt-2 max-w-sm text-xs text-slate-500">{item.description}</p>
                        {item.legalBasis && <p className="mt-1 max-w-sm text-xs font-medium text-amber-700">依據：{item.legalBasis}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${categoryStyles[item.category]}`}>{item.category}</span>
                      </td>
                      <td className="px-4 py-4 text-slate-700">{item.calculationBasis}</td>
                      <td className="px-4 py-4 font-semibold text-slate-800">{currency(item.defaultAmount)}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${item.taxable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                            {item.taxable ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {item.taxable ? "應稅" : "免稅/非課稅"}
                          </span>
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${item.includeInInsuranceWage ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                            {item.includeInInsuranceWage ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {item.includeInInsuranceWage ? "納入投保薪資" : "不納入投保"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <button onClick={() => void toggleEnabled(item)} disabled={!allowManage || saving} className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${item.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.enabled ? "啟用" : "停用"}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <button onClick={() => editItem(item)} disabled={!allowManage || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          <Pencil className="h-3.5 w-3.5" />
                          編輯
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <BadgeDollarSign className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">加項管理</h2>
          </div>
          <p className="text-sm text-emerald-800">固定加項與變動加項會列入應發總額，可由員工薪資設定、出勤、加班或人工輸入帶入。</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-rose-700" />
            <h2 className="font-semibold text-rose-900">扣項管理</h2>
          </div>
          <p className="text-sm text-rose-800">固定扣項與變動扣項會列入應扣總額，包含請假扣薪、遲到扣款、所得稅等。</p>
        </div>
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-violet-700" />
            <h2 className="font-semibold text-violet-900">法定負擔與自付</h2>
          </div>
          <p className="text-sm text-violet-800">公司負擔項與員工自付項可連動勞保、健保、勞退、補充保費級距與費率表。</p>
        </div>
      </section>
    </div>
  );
}
