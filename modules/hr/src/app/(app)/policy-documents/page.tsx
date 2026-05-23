"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  Loader2,
  RefreshCcw,
  Save,
  ShieldCheck,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { csv, downloadTextFile } from "@/lib/client/download";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type PolicyCategory = "work_rules" | "hr_policy" | "sexual_harassment" | "labor_contract_template" | "payroll_policy" | "attendance_policy" | "other";
type PolicyStatus = "draft" | "active" | "expired" | "revoked";

type PolicyDocumentRow = {
  id: string;
  document_id: string | null;
  policy_key: string;
  title: string;
  category: PolicyCategory;
  version: string;
  effective_from: string;
  expires_at: string | null;
  target_scope: Record<string, unknown> | null;
  requires_acknowledgement: boolean;
  owner_department: string | null;
  status: PolicyStatus;
  note: string | null;
  created_at: string | null;
  documents: {
    title: string | null;
    storage_bucket: string | null;
    storage_path: string | null;
    file_size: number | null;
    mime_type: string | null;
  } | null;
};

type PolicyDocumentView = {
  id: string;
  documentId: string;
  policyKey: string;
  title: string;
  category: PolicyCategory;
  version: string;
  effectiveFrom: string;
  expiresAt: string;
  targetScope: string;
  requiresAcknowledgement: boolean;
  ownerDepartment: string;
  status: PolicyStatus;
  note: string;
  fileTitle: string;
  storageBucket: string;
  storagePath: string;
  fileSize: number;
  createdAt: string;
  acknowledgementCount: number;
};

type PolicyForm = {
  title: string;
  category: PolicyCategory;
  version: string;
  effectiveFrom: string;
  expiresAt: string;
  targetScope: string;
  requiresAcknowledgement: boolean;
  ownerDepartment: string;
  status: PolicyStatus;
  note: string;
};

const categoryLabels: Record<PolicyCategory, string> = {
  work_rules: "工作規則",
  hr_policy: "人事規章",
  sexual_harassment: "性騷擾防治",
  labor_contract_template: "勞動契約範本",
  payroll_policy: "薪資制度",
  attendance_policy: "出勤假勤制度",
  other: "其他制度文件",
};

const statusLabels: Record<PolicyStatus, string> = {
  draft: "草稿",
  active: "生效中",
  expired: "已失效",
  revoked: "已廢止",
};

const statusStyles: Record<PolicyStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-amber-200 bg-amber-50 text-amber-700",
  revoked: "border-rose-200 bg-rose-50 text-rose-700",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

const defaultForm: PolicyForm = {
  title: "工作規則",
  category: "work_rules",
  version: "1.0",
  effectiveFrom: today(),
  expiresAt: "",
  targetScope: "全體員工",
  requiresAcknowledgement: true,
  ownerDepartment: "人資部",
  status: "active",
  note: "",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫制度文件。");
  return supabase as any;
}

function toPolicyKey(title: string, category: PolicyCategory) {
  const safeTitle = title.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  return `${category}_${safeTitle || Date.now()}`;
}

function formatDate(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function formatFileSize(value: number) {
  if (!value) return "未記錄";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function mapPolicy(row: PolicyDocumentRow, acknowledgementCounts: Map<string, number>): PolicyDocumentView {
  return {
    id: row.id,
    documentId: row.document_id ?? "",
    policyKey: row.policy_key,
    title: row.title,
    category: row.category,
    version: row.version,
    effectiveFrom: formatDate(row.effective_from),
    expiresAt: formatDate(row.expires_at),
    targetScope: String(row.target_scope?.label ?? row.target_scope?.scope ?? "全體員工"),
    requiresAcknowledgement: row.requires_acknowledgement,
    ownerDepartment: row.owner_department ?? "未指定",
    status: row.status,
    note: row.note ?? "",
    fileTitle: row.documents?.title ?? "未連結文件",
    storageBucket: row.documents?.storage_bucket ?? "hr-documents",
    storagePath: row.documents?.storage_path ?? "",
    fileSize: row.documents?.file_size ?? 0,
    createdAt: formatDateTime(row.created_at),
    acknowledgementCount: acknowledgementCounts.get(`${row.policy_key}:${row.version}`) ?? 0,
  };
}

export default function PolicyDocumentsPage() {
  const currentUser = useCurrentUser();
  const canManage = can(currentUser.role, "system:settings") || can(currentUser.role, "announcement:manage") || can(currentUser.role, "employee:manage");
  const [policies, setPolicies] = useState<PolicyDocumentView[]>([]);
  const [form, setForm] = useState<PolicyForm>(defaultForm);
  const [file, setFile] = useState<File | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | PolicyCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PolicyStatus>("all");
  const [message, setMessage] = useState("制度文件會寫入 policy_documents，實體檔案寫入 documents / Supabase Storage。");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredPolicies = useMemo(() => policies.filter((policy) => {
    const categoryMatched = categoryFilter === "all" || policy.category === categoryFilter;
    const statusMatched = statusFilter === "all" || policy.status === statusFilter;
    return categoryMatched && statusMatched;
  }), [categoryFilter, policies, statusFilter]);

  const stats = useMemo(() => ({
    total: policies.length,
    active: policies.filter((policy) => policy.status === "active").length,
    requireAck: policies.filter((policy) => policy.requiresAcknowledgement).length,
    missingAck: policies.filter((policy) => policy.requiresAcknowledgement && policy.acknowledgementCount === 0).length,
  }), [policies]);

  async function loadPolicies() {
    const supabase = getClient();
    if (!currentUser.companyId) {
      setMessage("目前帳號沒有公司資訊，無法同步制度文件。");
      return;
    }
    setLoading(true);
    try {
      const { data: policyRows, error: policyError } = await supabase
        .from("policy_documents")
        .select(`
          id,
          document_id,
          policy_key,
          title,
          category,
          version,
          effective_from,
          expires_at,
          target_scope,
          requires_acknowledgement,
          owner_department,
          status,
          note,
          created_at,
          documents(title, storage_bucket, storage_path, file_size, mime_type)
        `)
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null)
        .order("effective_from", { ascending: false });
      if (policyError) throw policyError;

      const { data: acknowledgementRows, error: acknowledgementError } = await supabase
        .from("policy_acknowledgements")
        .select("policy_key, policy_version")
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null);
      if (acknowledgementError) throw acknowledgementError;

      const acknowledgementCounts = new Map<string, number>();
      ((acknowledgementRows ?? []) as Array<{ policy_key: string; policy_version: string }>).forEach((row) => {
        const key = `${row.policy_key}:${row.policy_version}`;
        acknowledgementCounts.set(key, (acknowledgementCounts.get(key) ?? 0) + 1);
      });

      setPolicies(((policyRows ?? []) as PolicyDocumentRow[]).map((row) => mapPolicy(row, acknowledgementCounts)));
      setMessage(`已同步 ${policyRows?.length ?? 0} 份制度文件。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步制度文件失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicies();
  }, [currentUser.companyId]);

  function updateForm<K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function savePolicy() {
    if (!canManage) {
      setMessage("此角色沒有維護制度文件的權限。");
      return;
    }
    if (!currentUser.companyId) {
      setMessage("目前帳號沒有公司資訊，無法儲存制度文件。");
      return;
    }
    if (!form.title.trim() || !form.version.trim()) {
      setMessage("請填寫文件名稱與版本。");
      return;
    }
    if (!file) {
      setMessage("請選擇制度文件檔案。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const safeFileName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
      const policyKey = toPolicyKey(form.title, form.category);
      const storagePath = `policies/governance/${policyKey}/${Date.now()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: documentRow, error: documentError } = await supabase.from("documents").insert({
        company_id: currentUser.companyId,
        uploaded_by: currentUser.id || null,
        document_type: "other",
        title: `${form.title}-v${form.version}`,
        storage_bucket: "hr-documents",
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        issued_at: form.effectiveFrom || null,
        expires_at: form.expiresAt || null,
        status: form.status === "active" ? "active" : form.status === "expired" ? "expired" : "active",
      }).select("id").single();
      if (documentError) throw documentError;

      const { error: policyError } = await supabase.from("policy_documents").upsert({
        company_id: currentUser.companyId,
        document_id: documentRow.id,
        policy_key: policyKey,
        title: form.title.trim(),
        category: form.category,
        version: form.version.trim(),
        effective_from: form.effectiveFrom || today(),
        expires_at: form.expiresAt || null,
        target_scope: { label: form.targetScope.trim() || "全體員工" },
        requires_acknowledgement: form.requiresAcknowledgement,
        owner_department: form.ownerDepartment.trim() || null,
        status: form.status,
        note: form.note.trim() || null,
        created_by: currentUser.id || null,
        updated_by: currentUser.id || null,
      }, { onConflict: "company_id,policy_key,version" });
      if (policyError) throw policyError;

      setFile(null);
      setMessage(`已上傳並建立 ${form.title} v${form.version}。`);
      await loadPolicies();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存制度文件失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(policy: PolicyDocumentView, status: PolicyStatus) {
    if (!canManage) {
      setMessage("此角色沒有異動制度文件狀態的權限。");
      return;
    }
    const supabase = getClient();
    const { error } = await supabase
      .from("policy_documents")
      .update({ status, updated_by: currentUser.id || null })
      .eq("id", policy.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(`${policy.title} v${policy.version} 已更新為 ${statusLabels[status]}。`);
    await loadPolicies();
  }

  async function acknowledgePolicy(policy: PolicyDocumentView) {
    const supabase = getClient();
    if (!currentUser.id) {
      setMessage("尚未登入，無法簽收制度文件。");
      return;
    }
    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("id, company_id, employee_id")
      .eq("id", currentUser.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (userError) {
      setMessage(userError.message);
      return;
    }
    if (!userRow?.employee_id) {
      setMessage("目前帳號沒有連結員工主檔，無法簽收。");
      return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("policy_acknowledgements").upsert({
      company_id: currentUser.companyId || userRow.company_id,
      user_id: userRow.id,
      employee_id: userRow.employee_id,
      policy_key: policy.policyKey,
      policy_title: policy.title,
      policy_version: policy.version,
      acknowledgement_text: `我已閱讀並知悉 ${policy.title} v${policy.version}`,
      acknowledgement_snapshot: {
        title: policy.title,
        version: policy.version,
        category: categoryLabels[policy.category],
        effectiveFrom: policy.effectiveFrom,
        targetScope: policy.targetScope,
        acknowledgedAt: now,
      },
      acknowledged_at: now,
    }, { onConflict: "policy_key,policy_version,user_id" });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(`已簽收 ${policy.title} v${policy.version}。`);
    await loadPolicies();
  }

  async function openFile(policy: PolicyDocumentView) {
    if (!policy.storagePath) {
      setMessage("此文件尚未連結檔案。");
      return;
    }
    try {
      const supabase = getClient();
      const { data, error } = await supabase.storage.from(policy.storageBucket || "hr-documents").createSignedUrl(policy.storagePath, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "產生文件連結失敗。");
    }
  }

  function exportPolicies() {
    downloadTextFile(
      `policy-documents-${today()}.csv`,
      csv([
        ["文件名稱", "分類", "版本", "狀態", "生效日", "失效日", "適用對象", "需簽收", "已簽收數", "負責單位", "檔名", "備註"],
        ...filteredPolicies.map((policy) => [
          policy.title,
          categoryLabels[policy.category],
          policy.version,
          statusLabels[policy.status],
          policy.effectiveFrom,
          policy.expiresAt,
          policy.targetScope,
          policy.requiresAcknowledgement ? "是" : "否",
          policy.acknowledgementCount,
          policy.ownerDepartment,
          policy.fileTitle,
          policy.note,
        ]),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">DOCUMENT GOVERNANCE</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">文件制度中心</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            集中管理工作規則、人事規章、薪資制度、出勤假勤制度、性騷擾防治與契約範本，保留版本、生效日、適用對象、文件附件與員工簽收紀錄。
          </p>
          <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadPolicies()} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新同步
          </Button>
          <Button onClick={exportPolicies} disabled={!filteredPolicies.length}>
            <Download className="h-4 w-4" />
            匯出清冊
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "制度文件", value: stats.total, detail: "policy_documents", icon: FileArchive, tone: "bg-sky-50 text-sky-700" },
          { label: "生效中", value: stats.active, detail: "目前適用版本", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "需簽收", value: stats.requireAck, detail: "要求員工知悉", icon: UsersRound, tone: "bg-violet-50 text-violet-700" },
          { label: "尚無簽收", value: stats.missingAck, detail: "需公告追蹤", icon: AlertTriangle, tone: stats.missingAck ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-500">{item.label}</div>
              <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-950">{item.value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">{item.detail}</div>
          </div>
        ))}
      </section>

      {canManage ? (
        <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">新增制度文件版本</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              文件名稱
              <Input value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              分類
              <select value={form.category} onChange={(event) => updateForm("category", event.target.value as PolicyCategory)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              版本
              <Input value={form.version} onChange={(event) => updateForm("version", event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              生效日
              <Input type="date" value={form.effectiveFrom} onChange={(event) => updateForm("effectiveFrom", event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              失效日
              <Input type="date" value={form.expiresAt} onChange={(event) => updateForm("expiresAt", event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              狀態
              <select value={form.status} onChange={(event) => updateForm("status", event.target.value as PolicyStatus)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              適用對象
              <Input value={form.targetScope} onChange={(event) => updateForm("targetScope", event.target.value)} placeholder="例：全體員工 / 居服部 / 管理職" />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              負責單位
              <Input value={form.ownerDepartment} onChange={(event) => updateForm("ownerDepartment", event.target.value)} />
            </label>
            <label className="flex items-end gap-2 rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={form.requiresAcknowledgement} onChange={(event) => updateForm("requiresAcknowledgement", event.target.checked)} />
              需要員工簽收回條
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700 lg:col-span-2">
              制度文件檔案
              <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="w-full rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] px-3 py-3 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              備註
              <Input value={form.note} onChange={(event) => updateForm("note", event.target.value)} />
            </label>
          </div>
          <Button className="mt-4" onClick={() => void savePolicy()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            上傳並建立版本
          </Button>
        </section>
      ) : null}

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm font-bold text-slate-700">
            分類
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | PolicyCategory)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">全部分類</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-bold text-slate-700">
            狀態
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | PolicyStatus)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">全部狀態</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="border-b border-[#ead8c2] p-5">
          <h2 className="font-black text-slate-950">制度文件版本清冊</h2>
          <p className="mt-1 text-sm text-slate-500">資料來源：policy_documents / documents / policy_acknowledgements。</p>
        </div>
        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#b45309]" />
              正在同步制度文件
            </div>
          ) : filteredPolicies.length ? filteredPolicies.map((policy) => (
            <article key={policy.id} className="p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusStyles[policy.status]}`}>{statusLabels[policy.status]}</span>
                    <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-black text-[#9a5a16]">{categoryLabels[policy.category]}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">v{policy.version}</span>
                    {policy.requiresAcknowledgement ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">需簽收</span> : null}
                  </div>
                  <h3 className="mt-3 text-lg font-black text-slate-950">{policy.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">適用：{policy.targetScope} · 負責：{policy.ownerDepartment}</p>
                  <p className="mt-1 text-sm text-slate-500">生效：{policy.effectiveFrom || "未設定"} · 失效：{policy.expiresAt || "未設定"} · 建立：{policy.createdAt}</p>
                  {policy.note ? <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{policy.note}</p> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[460px]">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="font-black text-slate-950">{policy.fileTitle}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatFileSize(policy.fileSize)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="font-black text-slate-950">簽收 {policy.acknowledgementCount} 筆</div>
                    <div className="mt-1 text-xs text-slate-500">{policy.requiresAcknowledgement ? "員工知悉回條" : "此版本不要求簽收"}</div>
                  </div>
                  <Button variant="outline" onClick={() => void openFile(policy)}>
                    <FileText className="h-4 w-4" />
                    查看文件
                  </Button>
                  <Button variant={policy.acknowledgementCount ? "outline" : "default"} onClick={() => void acknowledgePolicy(policy)} disabled={!policy.requiresAcknowledgement}>
                    <ShieldCheck className="h-4 w-4" />
                    我已閱讀簽收
                  </Button>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button size="sm" variant="outline" onClick={() => void updateStatus(policy, policy.status === "active" ? "expired" : "active")}>
                        {policy.status === "active" ? "設為失效" : "設為生效"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void updateStatus(policy, "revoked")}>
                        廢止
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          )) : (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              尚無制度文件。請先新增工作規則、人事規章或其他制度文件版本。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
