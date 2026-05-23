"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Building2,
  FilePlus2,
  Megaphone,
  Paperclip,
  Pin,
  Search,
  Send,
  ShieldCheck,
  Tag,
  UsersRound,
} from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getCurrentAppUser, getDefaultCompanyId, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type AnnouncementCategory = "公司公告" | "系統公告" | "人資公告" | "排班公告" | "薪資公告" | "教育訓練";
type AnnouncementStatus = "草稿" | "已發布" | "已過期";
type ReadStatus = "已讀" | "未讀";
type AcknowledgementStatus = "已同意" | "待回條";

type Announcement = {
  id: string;
  title: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
  readStatus: ReadStatus;
  acknowledgementStatus: AcknowledgementStatus;
  readCount: number;
  acknowledgementCount: number;
  pinned: boolean;
  company: string;
  branches: string[];
  departments: string[];
  roles: string[];
  publishAt: string;
  expiresAt: string;
  author: string;
  attachments: string[];
  summary: string;
  content: string;
};

type AnnouncementForm = {
  title: string;
  category: "company" | "system" | "hr" | "schedule" | "payroll" | "training";
  summary: string;
  content: string;
  expiresAt: string;
  attachments: string;
  isPinned: boolean;
};

const categories: Array<"全部" | AnnouncementCategory> = ["全部", "公司公告", "系統公告", "人資公告", "排班公告", "薪資公告", "教育訓練"];

const defaultAnnouncementForm: AnnouncementForm = {
  title: "",
  category: "company",
  summary: "",
  content: "",
  expiresAt: "2026-06-30",
  attachments: "",
  isPinned: false,
};

const categoryLabels: Record<AnnouncementForm["category"], AnnouncementCategory> = {
  company: "公司公告",
  system: "系統公告",
  hr: "人資公告",
  schedule: "排班公告",
  payroll: "薪資公告",
  training: "教育訓練",
};

const initialAnnouncements: Announcement[] = [
  {
    id: "ANN-001",
    title: "端午連假排班與服務異動確認",
    category: "排班公告",
    status: "已發布",
    readStatus: "未讀",
    acknowledgementStatus: "待回條",
    readCount: 0,
    acknowledgementCount: 0,
    pinned: true,
    company: "歲月長照股份有限公司",
    branches: ["台北居服站", "新北日照中心"],
    departments: ["居家服務部", "日照中心"],
    roles: ["居服員", "居服督導", "日照中心人員"],
    publishAt: "2026-05-18 09:00",
    expiresAt: "2026-06-10",
    author: "營運主管",
    attachments: ["端午排班調整表.xlsx", "服務異動通知.pdf"],
    summary: "請各據點主管於本週五前確認端午連假排班、人力缺口與個案服務異動。",
    content: "端午連假期間服務時段若有異動，請主管完成班表確認並通知員工與個案家屬。",
  },
  {
    id: "ANN-002",
    title: "五月薪資單已發布",
    category: "薪資公告",
    status: "已發布",
    readStatus: "已讀",
    acknowledgementStatus: "已同意",
    readCount: 1,
    acknowledgementCount: 1,
    pinned: false,
    company: "歲月長照股份有限公司",
    branches: ["全部據點"],
    departments: ["全公司"],
    roles: ["一般員工", "居服員", "日照中心人員", "部門主管"],
    publishAt: "2026-05-17 18:00",
    expiresAt: "2026-06-17",
    author: "會計人員",
    attachments: [],
    summary: "五月薪資單已發布，請至薪資袋查看個人薪資明細。",
    content: "員工只能查看自己的薪資單，如有疑問請於發薪後 5 個工作日內洽人資或會計。",
  },
  {
    id: "ANN-003",
    title: "CPR 與感染管制複訓報名",
    category: "教育訓練",
    status: "已發布",
    readStatus: "未讀",
    acknowledgementStatus: "待回條",
    readCount: 0,
    acknowledgementCount: 0,
    pinned: true,
    company: "歲月長照股份有限公司",
    branches: ["台北日照中心", "新北日照中心"],
    departments: ["日照中心", "護理組"],
    roles: ["照服員", "護理師", "司機"],
    publishAt: "2026-05-15 13:30",
    expiresAt: "2026-05-31",
    author: "人資人員",
    attachments: ["訓練課程表.pdf"],
    summary: "請證照即將到期人員完成複訓報名，課程時數會同步教育訓練紀錄。",
    content: "課程完成後請上傳證明文件，系統將同步更新證照附件與年度訓練時數。",
  },
  {
    id: "ANN-004",
    title: "系統維護公告",
    category: "系統公告",
    status: "已發布",
    readStatus: "已讀",
    acknowledgementStatus: "已同意",
    readCount: 1,
    acknowledgementCount: 1,
    pinned: false,
    company: "歲月長照股份有限公司",
    branches: ["全部據點"],
    departments: ["全公司"],
    roles: ["全體員工"],
    publishAt: "2026-05-12 12:00",
    expiresAt: "2026-05-20",
    author: "系統管理員",
    attachments: [],
    summary: "本週日凌晨 01:00-03:00 進行系統維護，期間可能短暫無法登入。",
    content: "維護期間請避免送出表單或進行薪資結算作業。",
  },
];
void initialAnnouncements;

const statusStyles: Record<AnnouncementStatus, string> = {
  草稿: "border-slate-200 bg-slate-50 text-slate-600",
  已發布: "border-emerald-200 bg-emerald-50 text-emerald-700",
  已過期: "border-rose-200 bg-rose-50 text-rose-700",
};

const readStyles: Record<ReadStatus, string> = {
  已讀: "border-slate-200 bg-slate-50 text-slate-600",
  未讀: "border-amber-200 bg-amber-50 text-amber-700",
};

const acknowledgementStyles: Record<AcknowledgementStatus, string> = {
  已同意: "border-emerald-200 bg-emerald-50 text-emerald-700",
  待回條: "border-orange-200 bg-orange-50 text-orange-700",
};

function splitAttachments(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export default function AnnouncementsPage() {
  const currentUser = useCurrentUser();
  const canManageAnnouncements = can(currentUser.role, "announcement:manage");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementForm, setAnnouncementForm] = useState<AnnouncementForm>(defaultAnnouncementForm);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"全部" | AnnouncementCategory>("全部");
  const [readStatus, setReadStatus] = useState<"全部" | ReadStatus>("全部");
  const [actionMessage, setActionMessage] = useState("");

  async function getCurrentEmployeeId() {
    if (!currentUser.id) throw new Error("尚未登入，無法寫入公告回條。");
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("users")
      .select("employee_id")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.employee_id) throw new Error("目前帳號沒有連結 employee_id，無法寫入公告回條。");
    return data.employee_id as string;
  }

  async function loadAnnouncements() {
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, category, status, summary, content, is_pinned, published_at, expires_at, attachment_document_ids, created_at, announcement_reads(read_at, acknowledged_at, user_id)")
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    setAnnouncements(((data ?? []) as any[]).map((row) => ({
      id: row.id,
      title: row.title,
      category: (categoryLabels[row.category as AnnouncementForm["category"]] ?? "公司公告") as AnnouncementCategory,
      status: row.status === "published" ? "已發布" : row.status === "expired" ? "已過期" : "草稿",
      readStatus: row.announcement_reads?.some((read: { read_at: string | null; user_id: string | null }) => read.user_id === currentUser.id && read.read_at) ? "已讀" : "未讀",
      acknowledgementStatus: row.announcement_reads?.some((read: { acknowledged_at: string | null; user_id: string | null }) => read.user_id === currentUser.id && read.acknowledged_at) ? "已同意" : "待回條",
      readCount: row.announcement_reads?.filter((read: { read_at: string | null }) => read.read_at).length ?? 0,
      acknowledgementCount: row.announcement_reads?.filter((read: { acknowledged_at: string | null }) => read.acknowledged_at).length ?? 0,
      pinned: Boolean(row.is_pinned),
      company: "Supabase 公司主檔",
      branches: ["依公告對象"],
      departments: ["依公告對象"],
      roles: ["依公告對象"],
      publishAt: row.published_at ? new Date(row.published_at).toLocaleString("zh-TW", { hour12: false }) : "待發布",
      expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : "",
      author: "Supabase",
      attachments: Array.isArray(row.attachment_document_ids) ? row.attachment_document_ids : [],
      summary: row.summary ?? "",
      content: row.content ?? "",
    })));
  }

  useEffect(() => {
    loadAnnouncements().catch((error) => setActionMessage(error instanceof Error ? error.message : "讀取 Supabase 公告失敗。"));
  }, []);

  async function publishAnnouncement() {
    if (!announcementForm.title.trim() || !announcementForm.content.trim()) {
      setActionMessage("請先填寫公告標題與公告內容。");
      return;
    }
    const supabase = getLiveClient();
    const [companyId, user] = await Promise.all([getDefaultCompanyId(), getCurrentAppUser()]);
    const { error } = await supabase.from("announcements").insert({
      company_id: companyId,
      title: announcementForm.title.trim(),
      category: announcementForm.category,
      content: announcementForm.content.trim(),
      summary: announcementForm.summary.trim(),
      is_pinned: announcementForm.isPinned,
      status: "published",
      published_at: new Date().toISOString(),
      expires_at: `${announcementForm.expiresAt}T23:59:59+08:00`,
      attachment_document_ids: splitAttachments(announcementForm.attachments),
      created_by: user.id,
    });
    if (error) throw error;
    await writeAuditLog({ action: "announcement.publish", resourceType: "announcements", afterData: announcementForm });
    setAnnouncementForm(defaultAnnouncementForm);
    await loadAnnouncements();
    setActionMessage("公告已發布，員工可在公告區閱讀並回傳同意回條。");
  }

  async function updateAnnouncement(item: Announcement, patch: Partial<Announcement>) {
    const supabase = getLiveClient();
    const nextStatus = patch.status === "已發布" ? "published" : patch.status === "已過期" ? "expired" : patch.status === "草稿" ? "draft" : undefined;
    const { error } = await supabase
      .from("announcements")
      .update({
        is_pinned: patch.pinned,
        status: nextStatus,
        published_at: patch.status === "已發布" ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (error) throw error;
    await writeAuditLog({ action: "announcement.update", resourceType: "announcements", resourceId: item.id, afterData: patch });
    await loadAnnouncements();
  }

  async function markRead(item: Announcement) {
    const supabase = getLiveClient();
    const employeeId = await getCurrentEmployeeId();
    const payload = {
      announcement_id: item.id,
      employee_id: employeeId,
      user_id: currentUser.id,
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("announcement_reads").upsert(payload, { onConflict: "announcement_id,employee_id" });
    if (error) throw error;
    await writeAuditLog({ action: "announcement.mark_read", resourceType: "announcements", resourceId: item.id, afterData: payload });
    await loadAnnouncements();
    setActionMessage(`${item.title} 已標記為已讀。`);
  }

  async function acknowledgeAnnouncement(item: Announcement) {
    const supabase = getLiveClient();
    const employeeId = await getCurrentEmployeeId();
    const now = new Date().toISOString();
    const payload = {
      announcement_id: item.id,
      employee_id: employeeId,
      user_id: currentUser.id,
      read_at: now,
      acknowledged_at: now,
      acknowledgement_text: "我已閱讀並同意此公告內容",
      acknowledgement_snapshot: {
        title: item.title,
        category: item.category,
        userName: currentUser.name,
        role: currentUser.role,
      },
      updated_at: now,
    };
    const { error } = await supabase.from("announcement_reads").upsert(payload, { onConflict: "announcement_id,employee_id" });
    if (error) throw error;
    await writeAuditLog({ action: "announcement.acknowledge", resourceType: "announcements", resourceId: item.id, afterData: payload });
    await loadAnnouncements();
    setActionMessage(`${item.title} 已回傳回條：我已閱讀並同意。`);
  }

  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((item) => {
      const matchesQuery = [item.title, item.summary, item.company, item.branches.join(" "), item.departments.join(" "), item.roles.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesCategory = category === "全部" || item.category === category;
      const matchesRead = readStatus === "全部" || item.readStatus === readStatus;
      return matchesQuery && matchesCategory && matchesRead;
    });
  }, [announcements, category, query, readStatus]);

  const stats = {
    total: announcements.length,
    unread: announcements.filter((item) => item.readStatus === "未讀").length,
    pinned: announcements.filter((item) => item.pinned).length,
    withAttachments: announcements.filter((item) => item.attachments.length > 0).length,
    acknowledged: announcements.filter((item) => item.acknowledgementStatus === "已同意").length,
  };

  async function exportAnnouncements() {
    downloadTextFile(
      "announcements.csv",
      csv([
        ["公告編號", "標題", "分類", "狀態", "已讀狀態", "回條狀態", "已讀數", "同意數", "指定據點", "指定部門", "指定角色", "發布時間", "有效期限"],
        ...filteredAnnouncements.map((item) => [
          item.id,
          item.title,
          item.category,
          item.status,
          item.readStatus,
          item.acknowledgementStatus,
          item.readCount,
          item.acknowledgementCount,
          item.branches.join("、"),
          item.departments.join("、"),
          item.roles.join("、"),
          item.publishAt,
          item.expiresAt,
        ]),
      ]),
    );
    await writeAuditLog({
      action: "announcement.export",
      resourceType: "announcements",
      afterData: { rowCount: filteredAnnouncements.length, category, readStatus, query },
    });
    setActionMessage(`已匯出公告 ${filteredAnnouncements.length} 筆，並寫入 audit logs。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Company Announcements</p>
          <h1 className="text-2xl font-semibold text-slate-950">公司公告系統</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            支援發布公告、指定公司、指定據點、指定部門、指定角色、附件上傳、置頂公告、已讀未讀、公告分類與公告有效期限，員工端可查看公告。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {canManageAnnouncements ? (
          <>
            <button
              type="button"
              onClick={() => exportAnnouncements().catch((error) => setActionMessage(error instanceof Error ? error.message : "匯出公告失敗。"))}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <FilePlus2 className="h-4 w-4" />
              匯出公告
            </button>
          </>
        ) : null}
        </div>
      </div>
      {actionMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      {canManageAnnouncements ? (
        <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FilePlus2 className="h-5 w-5 text-[#b45309]" />
            <div>
              <h2 className="text-lg font-semibold text-slate-950">發布公司公告</h2>
              <p className="text-sm text-slate-500">發布後員工可閱讀公告，並回傳「我已閱讀並同意」回條。</p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              公告標題
              <input value={announcementForm.title} onChange={(event) => setAnnouncementForm((current) => ({ ...current, title: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="例如：端午連假出勤與服務注意事項" />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                分類
                <select value={announcementForm.category} onChange={(event) => setAnnouncementForm((current) => ({ ...current, category: event.target.value as AnnouncementForm["category"] }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                  {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                有效期限
                <input type="date" value={announcementForm.expiresAt} onChange={(event) => setAnnouncementForm((current) => ({ ...current, expiresAt: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
              </label>
              <label className="flex items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={announcementForm.isPinned} onChange={(event) => setAnnouncementForm((current) => ({ ...current, isPinned: event.target.checked }))} />
                置頂公告
              </label>
            </div>
            <label className="grid gap-1 text-sm font-semibold text-slate-700 lg:col-span-2">
              摘要
              <input value={announcementForm.summary} onChange={(event) => setAnnouncementForm((current) => ({ ...current, summary: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="公告列表會先顯示這段摘要" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700 lg:col-span-2">
              公告內容
              <textarea value={announcementForm.content} onChange={(event) => setAnnouncementForm((current) => ({ ...current, content: event.target.value }))} rows={4} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="請輸入公告完整內容" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700 lg:col-span-2">
              附件 ID / 檔名
              <input value={announcementForm.attachments} onChange={(event) => setAnnouncementForm((current) => ({ ...current, attachments: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="多個附件請用逗號或換行分隔" />
            </label>
          </div>
          <button type="button" onClick={() => publishAnnouncement().catch((error) => setActionMessage(error instanceof Error ? error.message : "發布公告失敗。"))} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#b45309] px-4 py-2 text-sm font-semibold text-white">
            <Send className="h-4 w-4" />
            發布並開放回條
          </button>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "公告總數", value: `${stats.total}`, detail: "含公司公告與系統公告", icon: Megaphone, tone: "bg-sky-50 text-sky-700" },
          { label: "未讀公告", value: `${stats.unread}`, detail: "員工端未讀狀態", icon: BellRing, tone: "bg-amber-50 text-amber-700" },
          { label: "置頂公告", value: `${stats.pinned}`, detail: "優先顯示於員工端", icon: Pin, tone: "bg-rose-50 text-rose-700" },
          { label: "含附件", value: `${stats.withAttachments}`, detail: "附件上傳與下載", icon: Paperclip, tone: "bg-violet-50 text-violet-700" },
          { label: "已回條", value: `${stats.acknowledged}`, detail: "本人已閱讀並同意", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" },
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

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋標題、公司、據點、部門、角色"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value as "全部" | AnnouncementCategory)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={readStatus} onChange={(event) => setReadStatus(event.target.value as "全部" | ReadStatus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {["全部", "未讀", "已讀"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">公告列表</h2>
                <p className="text-sm text-slate-500">員工端依公司、據點、部門與角色顯示可讀公告。</p>
              </div>
              <Send className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredAnnouncements.map((item) => (
              <article key={item.id} className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.pinned ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                          <Pin className="h-3.5 w-3.5" />
                          置頂公告
                        </span>
                      ) : null}
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>{item.status}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${readStyles[item.readStatus]}`}>{item.readStatus}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${acknowledgementStyles[item.acknowledgementStatus]}`}>{item.acknowledgementStatus}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.category}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-2 text-sm text-slate-600">{item.summary}</p>
                    <p className="mt-2 text-sm text-slate-500">{item.content}</p>
                  </div>
                  <div className="min-w-48 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    <div>發布：{item.publishAt}</div>
                    <div className="mt-1">有效期限：{item.expiresAt}</div>
                    <div className="mt-1">發布人：{item.author}</div>
                    <div className="mt-1">已讀：{item.readCount} / 回條：{item.acknowledgementCount}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-xs text-slate-500 lg:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="font-semibold text-slate-700">指定公司</div>
                    <div className="mt-1">{item.company}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="font-semibold text-slate-700">指定據點 / 部門</div>
                    <div className="mt-1">{item.branches.join("、")} / {item.departments.join("、")}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="font-semibold text-slate-700">指定角色</div>
                    <div className="mt-1">{item.roles.join("、")}</div>
                  </div>
                </div>

	                {item.attachments.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.attachments.map((attachment) => (
                      <span key={attachment} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                        <Paperclip className="h-3.5 w-3.5" />
                        {attachment}
                      </span>
                    ))}
                  </div>
	                ) : null}
	                <div className="mt-4 flex flex-wrap gap-2">
	                  <button
	                    type="button"
	                    onClick={() => markRead(item).catch((error) => setActionMessage(error instanceof Error ? error.message : "標記已讀失敗。"))}
	                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
	                  >
	                    標記已讀
	                  </button>
                    <button
                      type="button"
                      onClick={() => acknowledgeAnnouncement(item).catch((error) => setActionMessage(error instanceof Error ? error.message : "回傳回條失敗。"))}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                    >
                      我已閱讀並同意
                    </button>
	                  {canManageAnnouncements ? (
	                    <button
	                      type="button"
	                      onClick={() => updateAnnouncement(item, { pinned: !item.pinned }).then(() => setActionMessage(`${item.title} 置頂狀態已寫入 Supabase。`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "更新公告失敗。"))}
	                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"
	                    >
	                      {item.pinned ? "取消置頂" : "設為置頂"}
	                    </button>
	                  ) : null}
	                  {canManageAnnouncements && item.status === "草稿" ? (
	                    <button
	                      type="button"
	                      onClick={() => updateAnnouncement(item, { status: "已發布" }).then(() => setActionMessage(`${item.title} 已發布到 Supabase。`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "發布公告失敗。"))}
	                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
	                    >
	                      發布
	                    </button>
	                  ) : null}
	                </div>
	              </article>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Tag className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-950">公告分類</h2>
            </div>
            <div className="space-y-2 text-sm">
              {categories.filter((item) => item !== "全部").map((item) => {
                const count = announcements.filter((announcement) => announcement.category === item).length;
                return (
                  <div key={item} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-700">{item}</span>
                    <span className="font-semibold text-slate-950">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-emerald-950">發布流程</h2>
            </div>
            <div className="space-y-3 text-sm text-emerald-900">
              {["選擇公告分類與有效期限", "指定公司、據點、部門、角色", "上傳附件並設定是否置頂", "發布後追蹤已讀未讀"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-700">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-sky-700" />
              <h2 className="text-lg font-semibold text-sky-950">員工端可見規則</h2>
            </div>
            <p className="text-sm text-sky-900">
              員工端只會看到符合本人公司、據點、部門或角色的已發布公告；過期公告預設不顯示，仍保留後台紀錄與讀取統計。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">資料結構與權限</h2>
            <p className="mt-1 text-sm text-slate-500">
              公告資料對應 Supabase `announcements`、`announcement_targets`、`announcement_reads`。員工依公司、據點、部門與角色讀取公告，人資與公司管理員可發布與管理公告。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
