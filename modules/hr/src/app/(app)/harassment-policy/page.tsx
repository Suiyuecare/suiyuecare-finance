"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Megaphone,
  PhoneCall,
  RefreshCcw,
  Scale,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { can } from "@/lib/auth/rbac";

type PolicySettings = {
  version: string;
  effectiveFrom: string;
  complaintWindow: string;
  complaintEmail: string;
  complaintPhone: string;
  externalChannel: string;
  confidentiality: string;
  investigationTimeline: string;
};

type PolicyDocument = {
  id: string;
  title: string;
  storagePath: string;
  uploadedAt: string;
  status: string;
};

type PolicyAcknowledgement = {
  id: string;
  acknowledgedAt: string;
  policyVersion: string;
};

const defaultSettings: PolicySettings = {
  version: "1.0",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  complaintWindow: "人資部 / 行政部門主任",
  complaintEmail: "hr@suiyuecare.com",
  complaintPhone: "02-0000-0000",
  externalChannel: "地方主管機關或勞工局性騷擾申訴管道",
  confidentiality: "申訴人、被申訴人、證人與調查資料均依最小必要原則保密。",
  investigationTimeline: "受理後即啟動調查，依公司程序通知、訪談、紀錄與結案。",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫性騷擾防治公告。");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

export default function HarassmentPolicyPage() {
  const currentUser = useCurrentUser();
  const canManage = can(currentUser.role, "system:settings") || can(currentUser.role, "announcement:manage");
  const [settings, setSettings] = useState<PolicySettings>(defaultSettings);
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<PolicyAcknowledgement | null>(null);
  const [message, setMessage] = useState("此區用於公告性騷擾防治措施、申訴管道與附件版本。");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  async function getCurrentAccount() {
    if (!currentUser.id) throw new Error("尚未登入，無法寫入公告知悉回條。");
    const supabase = getClient();
    const { data, error } = await supabase
      .from("users")
      .select("id, company_id, employee_id")
      .eq("id", currentUser.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data?.employee_id) throw new Error("目前帳號沒有連結員工主檔，無法寫入公告知悉回條。");
    return data as { id: string; company_id: string | null; employee_id: string };
  }

  async function loadPolicy() {
    setLoading(true);
    try {
      const supabase = getClient();
      const { data: settingRows, error: settingError } = await supabase
        .from("system_settings")
        .select("settings")
        .eq("setting_key", "sexual_harassment_prevention_policy")
        .is("deleted_at", null)
        .maybeSingle();
      if (settingError) throw settingError;
      const nextSettings = { ...defaultSettings, ...(settingRows?.settings as Partial<PolicySettings> | undefined) };
      setSettings(nextSettings);

      if (currentUser.id) {
        const { data: acknowledgementRows, error: acknowledgementError } = await supabase
          .from("policy_acknowledgements")
          .select("id, acknowledged_at, policy_version")
          .eq("policy_key", "sexual_harassment_prevention_policy")
          .eq("policy_version", nextSettings.version)
          .eq("user_id", currentUser.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (acknowledgementError) throw acknowledgementError;
        setAcknowledgement(acknowledgementRows ? {
          id: acknowledgementRows.id,
          acknowledgedAt: formatDateTime(acknowledgementRows.acknowledged_at),
          policyVersion: acknowledgementRows.policy_version,
        } : null);
      }

      const { data: documentRows, error: documentError } = await supabase
        .from("documents")
        .select("id, title, storage_path, status, created_at")
        .eq("document_type", "other")
        .ilike("title", "%性騷擾防治%")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (documentError) throw documentError;
      setDocuments(((documentRows ?? []) as Array<{ id: string; title: string; storage_path: string; status: string; created_at: string | null }>).map((row) => ({
        id: row.id,
        title: row.title,
        storagePath: row.storage_path,
        status: row.status,
        uploadedAt: formatDateTime(row.created_at),
      })));
      setMessage("已同步 system_settings / documents。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "讀取性騷擾防治公告失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicy();
  }, []);

  const checklist = useMemo(() => [
    { label: "防治措施公告", ready: documents.length > 0, detail: documents.length ? "已上傳文件" : "尚未上傳正式公告文件" },
    { label: "申訴窗口", ready: Boolean(settings.complaintWindow && settings.complaintEmail), detail: `${settings.complaintWindow} / ${settings.complaintEmail}` },
    { label: "保密原則", ready: Boolean(settings.confidentiality), detail: settings.confidentiality },
    { label: "調查流程", ready: Boolean(settings.investigationTimeline), detail: settings.investigationTimeline },
    { label: "員工知悉回條", ready: Boolean(acknowledgement), detail: acknowledgement ? `${acknowledgement.acknowledgedAt} 已知悉 v${acknowledgement.policyVersion}` : "員工尚未回傳知悉回條" },
  ], [acknowledgement, documents.length, settings]);

  async function saveSettings() {
    if (!canManage) {
      setMessage("此角色沒有維護公告與申訴管道的權限。");
      return;
    }
    const supabase = getClient();
    const { data: company, error: companyError } = await supabase.from("companies").select("id").is("deleted_at", null).limit(1).maybeSingle();
    if (companyError) {
      setMessage(companyError.message);
      return;
    }
    const { error } = await supabase.from("system_settings").upsert({
      company_id: currentUser.companyId || company?.id,
      setting_key: "sexual_harassment_prevention_policy",
      category: "notification_settings",
      display_name: "性騷擾防治措施與申訴管道公告",
      description: "公開性騷擾防治措施、申訴窗口、保密原則、調查流程與文件版本。",
      settings,
      status: "active",
      effective_from: settings.effectiveFrom || null,
      updated_by: currentUser.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,setting_key" });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("性騷擾防治措施與申訴管道已發布到 system_settings。");
    await loadPolicy();
  }

  async function uploadPolicyDocument() {
    if (!canManage) {
      setMessage("此角色沒有上傳法規公告文件的權限。");
      return;
    }
    if (!file) {
      setMessage("請先選擇要上傳的公告文件。");
      return;
    }
    setUploading(true);
    try {
      const supabase = getClient();
      const { data: company, error: companyError } = await supabase.from("companies").select("id").is("deleted_at", null).limit(1).maybeSingle();
      if (companyError) throw companyError;
      const safeFileName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
      const storagePath = `policies/sexual-harassment/${Date.now()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: documentError } = await supabase.from("documents").insert({
        company_id: currentUser.companyId || company?.id,
        uploaded_by: currentUser.id || null,
        document_type: "other",
        title: `性騷擾防治措施與申訴管道公告-v${settings.version}`,
        storage_bucket: "hr-documents",
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        issued_at: settings.effectiveFrom || null,
        status: "active",
      });
      if (documentError) throw documentError;
      setFile(null);
      setMessage("已上傳公告文件並寫入 documents。");
      await loadPolicy();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上傳公告文件失敗。");
    } finally {
      setUploading(false);
    }
  }

  async function acknowledgePolicy() {
    setAcknowledging(true);
    try {
      const supabase = getClient();
      const account = await getCurrentAccount();
      const now = new Date().toISOString();
      const payload = {
        company_id: currentUser.companyId || account.company_id,
        user_id: account.id,
        employee_id: account.employee_id,
        policy_key: "sexual_harassment_prevention_policy",
        policy_title: "性騷擾防治措施與申訴管道公告",
        policy_version: settings.version,
        acknowledgement_text: "我已閱讀並知悉公司性騷擾防治措施與申訴管道",
        acknowledgement_snapshot: {
          version: settings.version,
          effectiveFrom: settings.effectiveFrom,
          complaintWindow: settings.complaintWindow,
          complaintEmail: settings.complaintEmail,
          complaintPhone: settings.complaintPhone,
          externalChannel: settings.externalChannel,
          acknowledgedAt: now,
        },
        acknowledged_at: now,
      };
      const { data, error } = await supabase
        .from("policy_acknowledgements")
        .upsert(payload, { onConflict: "policy_key,policy_version,user_id" })
        .select("id, acknowledged_at, policy_version")
        .single();
      if (error) throw error;
      setAcknowledgement({
        id: data.id,
        acknowledgedAt: formatDateTime(data.acknowledged_at),
        policyVersion: data.policy_version,
      });
      setMessage("已回傳性騷擾防治公告知悉回條，系統已留存版本與申訴管道快照。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回傳知悉回條失敗。");
    } finally {
      setAcknowledging(false);
    }
  }

  async function openDocument(document: PolicyDocument) {
    try {
      const supabase = getClient();
      const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(document.storagePath, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "產生文件連結失敗。");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">WORKPLACE SAFETY</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">性騷擾防治措施與申訴管道公告</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            集中公告防治措施、申訴窗口、保密原則、調查流程與正式附件，供員工查閱，也供勞檢或內部稽核確認。
          </p>
          <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
        </div>
        <Button variant="outline" onClick={() => void loadPolicy()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          重新整理
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {checklist.map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-500">{item.label}</div>
              <span className={`rounded-lg p-2 ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {item.ready ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </span>
            </div>
            <div className="mt-3 text-lg font-black text-slate-950">{item.ready ? "已完成" : "需補齊"}</div>
            <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{item.detail}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">公告內容與申訴管道</h2>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-slate-700">
                版本
                <Input value={settings.version} onChange={(event) => setSettings((current) => ({ ...current, version: event.target.value }))} disabled={!canManage} />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                生效日
                <Input type="date" value={settings.effectiveFrom} onChange={(event) => setSettings((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!canManage} />
              </label>
            </div>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              申訴受理窗口
              <Input value={settings.complaintWindow} onChange={(event) => setSettings((current) => ({ ...current, complaintWindow: event.target.value }))} disabled={!canManage} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-bold text-slate-700">
                申訴 Email
                <Input value={settings.complaintEmail} onChange={(event) => setSettings((current) => ({ ...current, complaintEmail: event.target.value }))} disabled={!canManage} />
              </label>
              <label className="space-y-1 text-sm font-bold text-slate-700">
                申訴電話
                <Input value={settings.complaintPhone} onChange={(event) => setSettings((current) => ({ ...current, complaintPhone: event.target.value }))} disabled={!canManage} />
              </label>
            </div>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              外部申訴管道
              <Input value={settings.externalChannel} onChange={(event) => setSettings((current) => ({ ...current, externalChannel: event.target.value }))} disabled={!canManage} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              保密原則
              <textarea value={settings.confidentiality} onChange={(event) => setSettings((current) => ({ ...current, confidentiality: event.target.value }))} disabled={!canManage} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-muted/60" />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              調查與處理流程
              <textarea value={settings.investigationTimeline} onChange={(event) => setSettings((current) => ({ ...current, investigationTimeline: event.target.value }))} disabled={!canManage} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-muted/60" />
            </label>
            {canManage ? (
              <Button onClick={() => void saveSettings()}>
                <ShieldCheck className="h-4 w-4" />
                發布申訴管道設定
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <UploadCloud className="h-5 w-5 text-[#b45309]" />
              <h2 className="font-black text-slate-950">上傳正式公告文件</h2>
            </div>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={!canManage} className="w-full rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] px-3 py-3 text-sm" />
            <Button className="mt-3" onClick={() => void uploadPolicyDocument()} disabled={!canManage || uploading}>
              <UploadCloud className="h-4 w-4" />
              {uploading ? "上傳中" : "上傳並歸檔"}
            </Button>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-emerald-700" />
              <h2 className="font-black text-emerald-950">員工可見申訴資訊</h2>
            </div>
            <div className="space-y-2 text-sm font-semibold text-emerald-900">
              <div>Email：{settings.complaintEmail}</div>
              <div>電話：{settings.complaintPhone}</div>
              <div>窗口：{settings.complaintWindow}</div>
              <div>外部管道：{settings.externalChannel}</div>
            </div>
            <Button className="mt-4 w-full bg-emerald-700 hover:bg-emerald-800" onClick={() => void acknowledgePolicy()} disabled={acknowledging}>
              {acknowledgement ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {acknowledgement ? `已知悉 v${acknowledgement.policyVersion}` : acknowledging ? "回傳中" : "我已閱讀並知悉申訴管道"}
            </Button>
            {acknowledgement ? (
              <p className="mt-2 text-xs font-semibold text-emerald-800">回條時間：{acknowledgement.acknowledgedAt}</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Scale className="h-5 w-5 text-amber-700" />
              <h2 className="font-black text-amber-950">法遵提醒</h2>
            </div>
            <p className="text-sm leading-6 text-amber-900">
              此區應定期確認版本、生效日、申訴窗口與附件公告是否仍有效；若公司人數或法規要求變更，需更新公告與教育訓練紀錄。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="border-b border-[#ead8c2] p-5">
          <h2 className="font-black text-slate-950">公告文件版本</h2>
          <p className="mt-1 text-sm text-slate-500">資料來源：documents / Supabase Storage。</p>
        </div>
        <div className="divide-y divide-slate-100">
          {documents.map((document) => (
            <div key={document.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-black text-slate-950">{document.title}</div>
                <div className="mt-1 text-sm text-slate-500">上傳時間：{document.uploadedAt} · 狀態：{document.status}</div>
              </div>
              <Button variant="outline" onClick={() => void openDocument(document)}>
                <Download className="h-4 w-4" />
                查看文件
              </Button>
            </div>
          ))}
          {!documents.length ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              尚未上傳性騷擾防治措施與申訴管道公告文件。
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-sky-700" />
          <div>
            <h2 className="font-black text-sky-950">建議公告內容</h2>
            <p className="mt-1 text-sm leading-6 text-sky-900">
              公告文件建議包含：禁止性騷擾聲明、申訴方式、受理窗口、調查程序、保密與不利處分禁止、外部申訴管道、教育訓練與版本生效日。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
