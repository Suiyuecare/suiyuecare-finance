"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  FileClock,
  FileText,
  Mail,
  Megaphone,
  RefreshCw,
  Send,
  ShieldAlert,
  WalletCards,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { can, type HrRole } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { emitNotificationEvent } from "@/lib/notifications/notification-events";
import { getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type NotificationType =
  | "請假送出"
  | "加班送出"
  | "補卡送出"
  | "簽核通過"
  | "簽核駁回"
  | "班表異動"
  | "證照到期"
  | "薪資單發布"
  | "出勤異常"
  | "系統公告";

type Channel = "站內通知" | "Email";
type NotificationStatus = "未讀" | "已讀" | "已送達" | "寄送失敗";

type NotificationRule = {
  type: NotificationType;
  icon: LucideIcon;
  description: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  recipients: string;
  triggerTiming: string;
};

type NotificationRuleSetting = Omit<NotificationRule, "icon">;

type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  recipient: string;
  channels: Channel[];
  status: NotificationStatus;
  createdAt: string;
  sourceModule: string;
  eventId: string | null;
  emailStatus: string;
  metadata: Record<string, unknown>;
};

type NotificationEventItem = {
  id: string;
  type: NotificationType;
  sourceModule: string;
  title: string;
  recipients: number;
  status: string;
  createdAt: string;
};

type EmailDeliveryItem = {
  id: string;
  notificationId: string;
  eventId: string | null;
  recipientEmail: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped" | "config_missing";
  attempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string;
  errorMessage: string;
  providerMessageId: string;
  createdAt: string;
};

type NotificationForm = {
  type: NotificationType;
  title: string;
  content: string;
  recipient: string;
  inApp: boolean;
  email: boolean;
};

const notificationTypes: NotificationType[] = [
  "請假送出",
  "加班送出",
  "補卡送出",
  "簽核通過",
  "簽核駁回",
  "班表異動",
  "證照到期",
  "薪資單發布",
  "出勤異常",
  "系統公告",
];

const typeIcons: Record<NotificationType, LucideIcon> = {
  請假送出: CalendarClock,
  加班送出: FileText,
  補卡送出: FileClock,
  簽核通過: CheckCircle2,
  簽核駁回: ShieldAlert,
  班表異動: RefreshCw,
  證照到期: AlertTriangle,
  薪資單發布: WalletCards,
  出勤異常: ShieldAlert,
  系統公告: Megaphone,
};

const initialRules: NotificationRule[] = [
  { type: "請假送出", icon: CalendarClock, description: "員工送出請假申請後通知主管與人資。", inAppEnabled: true, emailEnabled: true, recipients: "直屬主管、人資", triggerTiming: "送出後即時" },
  { type: "加班送出", icon: FileText, description: "員工送出加班申請後通知主管。", inAppEnabled: true, emailEnabled: true, recipients: "直屬主管、人資", triggerTiming: "送出後即時" },
  { type: "補卡送出", icon: FileClock, description: "員工送出補打卡申請後通知主管與人資。", inAppEnabled: true, emailEnabled: true, recipients: "直屬主管、人資", triggerTiming: "送出後即時" },
  { type: "簽核通過", icon: CheckCircle2, description: "申請核准後通知申請人與相關處理者。", inAppEnabled: true, emailEnabled: true, recipients: "申請人、下一關處理者", triggerTiming: "簽核完成後" },
  { type: "簽核駁回", icon: ShieldAlert, description: "申請駁回後通知申請人並保留駁回原因。", inAppEnabled: true, emailEnabled: true, recipients: "申請人", triggerTiming: "駁回後即時" },
  { type: "班表異動", icon: RefreshCw, description: "排班、換班、代班或日照配置調整後通知相關人員。", inAppEnabled: true, emailEnabled: false, recipients: "受影響員工、主管", triggerTiming: "班表更新後" },
  { type: "證照到期", icon: AlertTriangle, description: "長照人員證照即將到期前通知本人與人資。", inAppEnabled: true, emailEnabled: true, recipients: "員工本人、人資", triggerTiming: "到期前 30/14/7 日" },
  { type: "薪資單發布", icon: WalletCards, description: "電子薪資單發布後通知員工。", inAppEnabled: true, emailEnabled: true, recipients: "員工本人", triggerTiming: "薪資單發布時" },
  { type: "出勤異常", icon: ShieldAlert, description: "遲到、早退、未打卡、GPS 異常等事件通知主管與人資。", inAppEnabled: true, emailEnabled: false, recipients: "員工本人、主管、人資", triggerTiming: "異常判斷後" },
  { type: "系統公告", icon: Megaphone, description: "公司公告、系統公告或維護通知發送給指定對象。", inAppEnabled: true, emailEnabled: true, recipients: "指定公司、據點、部門、角色", triggerTiming: "公告發布時" },
];

const initialNotifications = [
  {
    id: "NT-20260518-001",
    type: "請假送出",
    title: "林佳穎送出家庭照顧假申請",
    content: "請假日期 2026-05-20，等待直屬主管簽核。",
    recipient: "陳主任",
    channels: ["站內通知", "Email"],
    status: "未讀",
    createdAt: "2026-05-18 09:12",
    sourceModule: "請假申請",
  },
  {
    id: "NT-20260518-002",
    type: "加班送出",
    title: "黃冠宇送出加班申請",
    content: "加班日期 2026-05-18 18:30-21:30，補償方式為加班費。",
    recipient: "日照主任",
    channels: ["站內通知", "Email"],
    status: "已送達",
    createdAt: "2026-05-18 10:25",
    sourceModule: "加班申請",
  },
  {
    id: "NT-20260518-003",
    type: "補卡送出",
    title: "王淑芬送出補卡申請",
    content: "補 2026-05-17 下班卡，等待主管審核。",
    recipient: "居服督導",
    channels: ["站內通知"],
    status: "未讀",
    createdAt: "2026-05-18 08:42",
    sourceModule: "補打卡",
  },
  {
    id: "NT-20260518-004",
    type: "簽核通過",
    title: "換班申請已核准",
    content: "李雅婷與周孟潔換班申請已完成，人資已更新班表。",
    recipient: "李雅婷、周孟潔",
    channels: ["站內通知", "Email"],
    status: "已讀",
    createdAt: "2026-05-18 11:05",
    sourceModule: "待簽核中心",
  },
  {
    id: "NT-20260518-005",
    type: "簽核駁回",
    title: "薪資調整申請已駁回",
    content: "會計檢查未通過，請補充調整依據。",
    recipient: "張雅雯",
    channels: ["站內通知", "Email"],
    status: "已送達",
    createdAt: "2026-05-18 11:40",
    sourceModule: "薪資調整",
  },
  {
    id: "NT-20260518-006",
    type: "班表異動",
    title: "日照中心晚班人力調整",
    content: "陳柏宏臨時代班晚班，已同步每日人力配置表。",
    recipient: "日照中心人員",
    channels: ["站內通知"],
    status: "未讀",
    createdAt: "2026-05-18 12:10",
    sourceModule: "日照排班",
  },
  {
    id: "NT-20260518-007",
    type: "證照到期",
    title: "蔡志豪護理師證書即將到期",
    content: "證照將於 2026-06-10 到期，請上傳更新文件。",
    recipient: "蔡志豪、人資",
    channels: ["站內通知", "Email"],
    status: "寄送失敗",
    createdAt: "2026-05-18 08:00",
    sourceModule: "證照管理",
  },
  {
    id: "NT-20260518-008",
    type: "薪資單發布",
    title: "2026 年 5 月薪資單已發布",
    content: "請至薪資袋查看個人薪資單。",
    recipient: "全體員工",
    channels: ["站內通知", "Email"],
    status: "已送達",
    createdAt: "2026-05-18 13:00",
    sourceModule: "薪資袋",
  },
  {
    id: "NT-20260518-009",
    type: "出勤異常",
    title: " GPS 打卡地點異常",
    content: "林佳穎 09:00 打卡位置超出服務地點半徑。",
    recipient: "林佳穎、居服督導、人資",
    channels: ["站內通知"],
    status: "未讀",
    createdAt: "2026-05-18 09:02",
    sourceModule: "出勤異常",
  },
  {
    id: "NT-20260518-010",
    type: "系統公告",
    title: "系統維護公告",
    content: "2026-05-20 22:00-23:00 將進行系統維護。",
    recipient: "全體使用者",
    channels: ["站內通知", "Email"],
    status: "已送達",
    createdAt: "2026-05-18 14:00",
    sourceModule: "公告中心",
  },
];
void initialNotifications;

const defaultForm: NotificationForm = {
  type: "系統公告",
  title: "",
  content: "",
  recipient: "全體使用者",
  inApp: true,
  email: true,
};

function serializeRules(rules: NotificationRule[]): NotificationRuleSetting[] {
  return rules.map((rule) => ({
    type: rule.type,
    description: rule.description,
    inAppEnabled: rule.inAppEnabled,
    emailEnabled: rule.emailEnabled,
    recipients: rule.recipients,
    triggerTiming: rule.triggerTiming,
  }));
}

function hydrateRules(value: unknown): NotificationRule[] {
  const incomingRules = Array.isArray(value)
    ? value
    : Array.isArray((value as { rules?: unknown[] } | null)?.rules)
      ? (value as { rules: unknown[] }).rules
      : [];
  if (!incomingRules.length) return initialRules;

  return initialRules.map((rule) => {
    const saved = incomingRules.find((item) => (item as Partial<NotificationRuleSetting>).type === rule.type) as Partial<NotificationRuleSetting> | undefined;
    return saved
      ? {
          ...rule,
          description: saved.description ?? rule.description,
          inAppEnabled: Boolean(saved.inAppEnabled),
          emailEnabled: Boolean(saved.emailEnabled),
          recipients: saved.recipients ?? rule.recipients,
          triggerTiming: saved.triggerTiming ?? rule.triggerTiming,
        }
      : rule;
  });
}

function resolveRecipientRoles(recipientText: string): HrRole[] {
  const roles: HrRole[] = [];
  if (recipientText.includes("人資")) roles.push("hr");
  if (recipientText.includes("主管")) roles.push("supervisor");
  if (recipientText.includes("行政") || recipientText.includes("主任")) roles.push("admin_director");
  if (recipientText.includes("執行長") || recipientText.includes("老闆")) roles.push("ceo");
  if (recipientText.includes("員工") || recipientText.includes("組員")) roles.push("team_member");
  return Array.from(new Set(roles));
}

const statusStyles: Record<NotificationStatus, string> = {
  未讀: "border-amber-200 bg-amber-50 text-amber-700",
  已讀: "border-slate-200 bg-slate-50 text-slate-600",
  已送達: "border-emerald-200 bg-emerald-50 text-emerald-700",
  寄送失敗: "border-rose-200 bg-rose-50 text-rose-700",
};

const deliveryStatusLabels: Record<EmailDeliveryItem["status"], string> = {
  queued: "排隊中",
  sending: "寄送中",
  sent: "已寄出",
  failed: "寄送失敗",
  skipped: "已略過",
  config_missing: "設定缺漏",
};

const deliveryStatusStyles: Record<EmailDeliveryItem["status"], string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  sending: "border-sky-200 bg-sky-50 text-sky-700",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  skipped: "border-slate-200 bg-slate-50 text-slate-600",
  config_missing: "border-orange-200 bg-orange-50 text-orange-700",
};

const typeStyles: Record<NotificationType, string> = {
  請假送出: "bg-sky-50 text-sky-700",
  加班送出: "bg-indigo-50 text-indigo-700",
  補卡送出: "bg-cyan-50 text-cyan-700",
  簽核通過: "bg-emerald-50 text-emerald-700",
  簽核駁回: "bg-rose-50 text-rose-700",
  班表異動: "bg-violet-50 text-violet-700",
  證照到期: "bg-amber-50 text-amber-700",
  薪資單發布: "bg-lime-50 text-lime-700",
  出勤異常: "bg-orange-50 text-orange-700",
  系統公告: "bg-slate-100 text-slate-700",
};

export default function NotificationsPage() {
  const currentUser = useCurrentUser();
  const canSendNotifications = can(currentUser.role, "notification:send");
  const canManageNotificationRules = can(currentUser.role, "notification:rules:manage");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>(initialRules);
  const [events, setEvents] = useState<NotificationEventItem[]>([]);
  const [emailDeliveries, setEmailDeliveries] = useState<EmailDeliveryItem[]>([]);
  const [activeType, setActiveType] = useState<NotificationType | "全部">("全部");
  const [form, setForm] = useState<NotificationForm>(defaultForm);
  const [message, setMessage] = useState("");

  async function loadNotifications() {
    const supabase = getLiveClient();
    let notificationQuery = supabase
      .from("notifications")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!canSendNotifications) {
      notificationQuery = notificationQuery.eq("recipient_user_id", currentUser.id);
    } else if (currentUser.companyId) {
      notificationQuery = notificationQuery.eq("company_id", currentUser.companyId);
    }

    let eventQuery = supabase
        .from("notification_events")
        .select("id, event_type, source_module, title, recipient_user_ids, status, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
    if (currentUser.companyId) {
      eventQuery = eventQuery.eq("company_id", currentUser.companyId);
    }

    let deliveryQuery = supabase
      .from("notification_email_deliveries")
      .select("id, notification_id, event_id, recipient_email, subject, status, attempts, next_attempt_at, last_attempt_at, error_message, provider_message_id, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60);
    if (currentUser.companyId) {
      deliveryQuery = deliveryQuery.eq("company_id", currentUser.companyId);
    }

    let ruleQuery = supabase
      .from("system_settings")
      .select("id, settings")
      .eq("setting_key", "notification_rules")
      .is("deleted_at", null)
      .limit(1);
    if (currentUser.companyId) {
      ruleQuery = ruleQuery.eq("company_id", currentUser.companyId);
    }

    const [{ data, error }, eventResult, deliveryResult, ruleResult] = await Promise.all([
      notificationQuery,
      canSendNotifications ? eventQuery : Promise.resolve({ data: [], error: null }),
      canSendNotifications ? deliveryQuery : Promise.resolve({ data: [], error: null }),
      ruleQuery.maybeSingle(),
    ]);
    if (error) throw error;
    if (eventResult.error) {
      setMessage(`通知已讀取，但事件表尚未可用：${eventResult.error.message}`);
    } else {
      setEvents(((eventResult.data ?? []) as any[]).map((row) => ({
        id: row.id,
        type: row.event_type as NotificationType,
        sourceModule: row.source_module ?? "通知事件",
        title: row.title,
        recipients: Array.isArray(row.recipient_user_ids) ? row.recipient_user_ids.length : 0,
        status: row.status ?? "processed",
        createdAt: new Date(row.created_at).toLocaleString("zh-TW", { hour12: false }),
      })));
    }
    if (deliveryResult.error) {
      setMessage(`通知已讀取，但 Email 佇列表尚未可用：${deliveryResult.error.message}`);
    } else {
      setEmailDeliveries(((deliveryResult.data ?? []) as any[]).map((row) => ({
        id: row.id,
        notificationId: row.notification_id,
        eventId: row.event_id ?? null,
        recipientEmail: row.recipient_email ?? "未設定 Email",
        subject: row.subject ?? "未命名通知",
        status: (row.status ?? "queued") as EmailDeliveryItem["status"],
        attempts: Number(row.attempts ?? 0),
        nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toLocaleString("zh-TW", { hour12: false }) : "-",
        lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toLocaleString("zh-TW", { hour12: false }) : "-",
        errorMessage: row.error_message ?? "",
        providerMessageId: row.provider_message_id ?? "",
        createdAt: row.created_at ? new Date(row.created_at).toLocaleString("zh-TW", { hour12: false }) : "-",
      })));
    }
    if (!ruleResult.error && ruleResult.data?.settings) {
      setRules(hydrateRules(ruleResult.data.settings));
    }
    setNotifications(((data ?? []) as any[]).map((row) => ({
      id: row.id,
      type: row.notification_type as NotificationType,
      title: row.title,
      content: row.content,
      recipient: row.metadata?.recipient ?? "指定使用者",
      channels: Array.isArray(row.channels) ? row.channels : [],
      status: row.status === "read" ? "已讀" : row.status === "delivered" ? "已送達" : row.status === "failed" ? "寄送失敗" : "未讀",
      createdAt: new Date(row.created_at).toLocaleString("zh-TW", { hour12: false }),
      sourceModule: row.source_module ?? "通知中心",
      eventId: row.event_id ?? row.metadata?.event_id ?? null,
      emailStatus: row.metadata?.email_status ?? "not_required",
      metadata: row.metadata ?? {},
    })));
  }

  useEffect(() => {
    loadNotifications().catch((error) => setMessage(error instanceof Error ? error.message : "讀取 Supabase 通知失敗。"));
  }, [canSendNotifications, currentUser.companyId, currentUser.id]);

  const filteredNotifications = useMemo(
    () => notifications.filter((item) => activeType === "全部" || item.type === activeType),
    [activeType, notifications],
  );

  const stats = useMemo(
    () => ({
      total: notifications.length,
      unread: notifications.filter((item) => item.status === "未讀").length,
      email: notifications.filter((item) => item.channels.includes("Email")).length,
      failed: notifications.filter((item) => item.status === "寄送失敗").length,
      eventDriven: notifications.filter((item) => item.eventId).length,
    }),
    [notifications],
  );

  const deliveryStats = useMemo(
    () => ({
      queued: emailDeliveries.filter((item) => item.status === "queued" || item.status === "sending").length,
      sent: emailDeliveries.filter((item) => item.status === "sent").length,
      failed: emailDeliveries.filter((item) => item.status === "failed" || item.status === "config_missing").length,
      skipped: emailDeliveries.filter((item) => item.status === "skipped").length,
      nextFailure: emailDeliveries.find((item) => item.status === "failed" || item.status === "config_missing"),
    }),
    [emailDeliveries],
  );

  const sendNotification = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setMessage("請填寫通知標題與內容。");
      return;
    }

    const channels: Channel[] = [
      ...(form.inApp ? (["站內通知"] as Channel[]) : []),
      ...(form.email ? (["Email"] as Channel[]) : []),
    ];
    if (!channels.length) {
      setMessage("請至少選擇一種通知管道。");
      return;
    }
    const recipientRoles = resolveRecipientRoles(form.recipient);

    const result = await emitNotificationEvent({
      type: form.type,
      title: form.title.trim(),
      content: form.content.trim(),
      channels,
      sourceModule: "通知中心",
      broadcast: form.recipient.includes("全體"),
      recipientRoles: recipientRoles.length && !form.recipient.includes("全體") ? recipientRoles : undefined,
      metadata: { recipient: form.recipient.trim() || "未指定", manual: true },
    });
    await writeAuditLog({ action: "notification.send", resourceType: "notifications", afterData: form });
    await loadNotifications();
    setForm(defaultForm);
    setMessage(`通知事件已建立並產生 ${result.notificationCount} 則收件通知。Email 已排入 worker 佇列。`);
  };

  const markAsRead = async (id: string) => {
    const supabase = getLiveClient();
    let query = supabase.from("notifications").update({ status: "read", read_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    if (!canSendNotifications) {
      query = query.eq("recipient_user_id", currentUser.id);
    }
    const { error } = await query;
    if (error) {
      setMessage(error.message);
      return;
    }
    await writeAuditLog({ action: "notification.mark_read", resourceType: "notifications", resourceId: id });
    await loadNotifications();
  };

  const retryEmail = async (id: string) => {
    if (!canSendNotifications) {
      setMessage("你沒有重送 Email 的權限。");
      return;
    }
    const supabase = getLiveClient();
    const item = notifications.find((notification) => notification.id === id);
    const metadata = item?.metadata ?? {};
    const emailAttempts = Number(metadata.email_attempts ?? 0) + 1;
    const { error } = await supabase
      .from("notifications")
      .update({
        status: "unread",
        metadata: {
          ...metadata,
          email_status: "queued",
          email_attempts: emailAttempts,
          email_retry_requested_at: new Date().toISOString(),
          email_retry_requested_by: currentUser.id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      setMessage(error.message);
      return;
    }
    const { error: deliveryError } = await supabase
      .from("notification_email_deliveries")
      .update({
        status: "queued",
        next_attempt_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
        metadata: {
          retry_requested_at: new Date().toISOString(),
          retry_requested_by: currentUser.id,
          retry_source: "notification_center",
        },
      })
      .eq("notification_id", id)
      .in("status", ["failed", "config_missing", "skipped", "queued"]);
    if (deliveryError) {
      setMessage(deliveryError.message);
      return;
    }
    await writeAuditLog({ action: "notification.retry_email", resourceType: "notifications", resourceId: id });
    await loadNotifications();
    setMessage("已重新排入 Email 佇列，等待 Email provider worker 寄送。");
  };

  const runEmailWorker = async () => {
    const response = await fetch("/api/notifications/email-worker", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error ?? payload.errors?.join("、") ?? "Email worker 執行失敗，請確認 Supabase Auth、CRON_SECRET 與 RESEND_API_KEY。");
      return;
    }
    await loadNotifications();
    setMessage(`Email worker 已執行：處理 ${payload.processed ?? 0} 筆，成功 ${payload.sent ?? 0} 筆，失敗 ${payload.failed ?? 0} 筆，略過 ${payload.skipped ?? 0} 筆。`);
  };

  const persistRules = async (nextRules: NotificationRule[]) => {
    if (!currentUser.companyId) throw new Error("目前登入者沒有公司資料，無法儲存通知規則。");
    const supabase = getLiveClient();
    const payload = {
      rules: serializeRules(nextRules),
      required_event_types: notificationTypes,
      email_provider_status: "queued_only",
      updated_by: currentUser.id,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: existingError } = await supabase
      .from("system_settings")
      .select("id")
      .eq("company_id", currentUser.companyId)
      .eq("setting_key", "notification_rules")
      .is("deleted_at", null)
      .maybeSingle();
    if (existingError) throw existingError;
    const mutation = existing?.id
      ? supabase.from("system_settings").update({ settings: payload, status: "active", updated_by: currentUser.id, updated_at: new Date().toISOString() }).eq("id", existing.id)
      : supabase.from("system_settings").insert({
          company_id: currentUser.companyId,
          setting_key: "notification_rules",
          category: "notification_settings",
          display_name: "通知規則設定",
          description: "站內通知、Email 通知、收件人與事件類型設定。",
          settings: payload,
          status: "active",
          updated_by: currentUser.id,
        });
    const { error } = await mutation;
    if (error) throw error;
    await writeAuditLog({ action: "notification.rules.update", resourceType: "system_settings", afterData: payload });
  };

  const toggleRuleChannel = async (type: NotificationType, channel: Channel) => {
    if (!canManageNotificationRules) {
      setMessage("你沒有調整通知規則的權限。");
      return;
    }
    const nextRules = rules.map((rule) =>
        rule.type === type
          ? {
              ...rule,
              inAppEnabled: channel === "站內通知" ? !rule.inAppEnabled : rule.inAppEnabled,
              emailEnabled: channel === "Email" ? !rule.emailEnabled : rule.emailEnabled,
            }
          : rule,
    );
    setRules(nextRules);
    try {
      await persistRules(nextRules);
      setMessage("通知規則已儲存至 Supabase。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通知規則儲存失敗。");
      await loadNotifications();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-sky-700">Notification Hub</p>
          <h1 className="text-2xl font-semibold text-slate-950">通知系統</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            集中管理請假送出、加班送出、補卡送出、簽核通過、簽核駁回、班表異動、證照到期、薪資單發布、出勤異常與系統公告，支援站內通知與 Email 通知。
          </p>
        </div>
	        <div className="flex flex-wrap gap-2 text-xs font-medium">
	          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">站內通知</span>
	          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Email 通知</span>
	          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">事件驅動</span>
	          <button
	            type="button"
	            onClick={() => Promise.all(notifications.filter((item) => item.status === "未讀").map((item) => markAsRead(item.id))).catch((error) => setMessage(error instanceof Error ? error.message : "全部已讀失敗。"))}
	            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700"
	          >
	            全部已讀
	          </button>
	          {canSendNotifications ? (
              <>
	            <button
	              type="button"
	              onClick={() => Promise.all(notifications.filter((item) => item.status === "寄送失敗" || ["failed", "config_missing"].includes(item.emailStatus)).map((item) => retryEmail(item.id))).catch((error) => setMessage(error instanceof Error ? error.message : "重送失敗 Email 失敗。"))}
	              className="rounded-full border border-rose-200 bg-white px-3 py-1 text-rose-700"
	            >
	              重送失敗
	            </button>
              <button
                type="button"
                onClick={() => runEmailWorker().catch((error) => setMessage(error instanceof Error ? error.message : "Email worker 執行失敗。"))}
                className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-emerald-700"
              >
                處理 Email 佇列
              </button>
              </>
	          ) : null}
	        </div>
      </div>
      {message ? <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{message}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "通知總數", value: `${stats.total} 則`, icon: Bell, tone: "bg-sky-50 text-sky-700" },
          { label: "未讀通知", value: `${stats.unread} 則`, icon: BellRing, tone: "bg-amber-50 text-amber-700" },
          { label: "Email 通知", value: `${stats.email} 則`, icon: Mail, tone: "bg-emerald-50 text-emerald-700" },
          { label: "事件產生", value: `${stats.eventDriven} 則`, icon: Zap, tone: "bg-rose-50 text-rose-700" },
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

      {canSendNotifications ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Delivery Operations</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">正式通知營運狀態</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                每則通知都要能追到事件來源、站內狀態、Email 佇列、重試次數與失敗原因。上線後人資可以直接判斷是收件人 Email 缺漏、Email provider 未設定，或是等待 worker 處理。
              </p>
            </div>
            <button
              type="button"
              onClick={() => runEmailWorker().catch((error) => setMessage(error instanceof Error ? error.message : "Email worker 執行失敗。"))}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100"
            >
              <RefreshCw className="h-4 w-4" />
              立即處理佇列
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[
              { label: "待寄 / 寄送中", value: `${deliveryStats.queued} 筆`, tone: "border-amber-200 bg-amber-50 text-amber-800" },
              { label: "已寄出", value: `${deliveryStats.sent} 筆`, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
              { label: "失敗 / 設定缺漏", value: `${deliveryStats.failed} 筆`, tone: "border-rose-200 bg-rose-50 text-rose-800" },
              { label: "略過", value: `${deliveryStats.skipped} 筆`, tone: "border-slate-200 bg-slate-50 text-slate-700" },
            ].map((item) => (
              <div key={item.label} className={`rounded-lg border p-4 ${item.tone}`}>
                <p className="text-xs font-black">{item.label}</p>
                <p className="mt-2 text-2xl font-black">{item.value}</p>
              </div>
            ))}
          </div>
          {deliveryStats.nextFailure ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-black">目前最需要處理：{deliveryStats.nextFailure.subject}</p>
              <p className="mt-1">
                收件人 {deliveryStats.nextFailure.recipientEmail}，狀態 {deliveryStatusLabels[deliveryStats.nextFailure.status]}，
                失敗原因：{deliveryStats.nextFailure.errorMessage || "尚未回寫失敗原因"}。
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-700" />
              <h2 className="text-lg font-black text-amber-950">事件驅動通知流程</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              模組先寫入 `notification_events`，系統再依收件人策略產生 `notifications`。薪資發布、簽核決策、手動公告都會留下事件、收件通知與 audit log。
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700">
            {events.length} 個近期事件
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {events.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${typeStyles[event.type]}`}>{event.type}</span>
                <span className="text-xs font-bold text-slate-500">{event.recipients} 人</span>
              </div>
              <p className="mt-3 text-sm font-black text-slate-950">{event.title}</p>
              <p className="mt-2 text-xs text-slate-500">{event.sourceModule} · {event.createdAt}</p>
            </div>
          ))}
          {!events.length ? (
            <div className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-500">
              尚無通知事件。套用 migration 後，手動發送或薪資/簽核事件會出現在這裡。
            </div>
          ) : null}
        </div>
      </section>

      {canSendNotifications ? (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">Email 佇列與失敗追蹤</h2>
              <p className="text-sm text-slate-500">正式系統必須能追蹤每一封 Email 的狀態、嘗試次數、下一次重試時間與 provider 回傳 ID。</p>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
              最近 {emailDeliveries.length} 筆
            </span>
          </div>
          <div className="mobile-card-list p-3">
            {emailDeliveries.slice(0, 12).map((item) => (
              <article key={item.id} className="mobile-record-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-slate-950">{item.subject}</h3>
                    <p className="mt-1 text-xs text-slate-500">{item.recipientEmail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${deliveryStatusStyles[item.status]}`}>
                    {deliveryStatusLabels[item.status]}
                  </span>
                </div>
                <div className="grid gap-2">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">嘗試</span>
                    <span className="mobile-card-value">{item.attempts} 次</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">下次重試</span>
                    <span className="mobile-card-value">{item.nextAttemptAt}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">錯誤</span>
                    <span className="mobile-card-value">{item.errorMessage || "-"}</span>
                  </div>
                </div>
              </article>
            ))}
            {!emailDeliveries.length ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm font-semibold text-slate-500">
                目前沒有 Email 佇列資料。發送含 Email 管道的通知後會自動建立佇列。
              </div>
            ) : null}
          </div>
          <div className="desktop-data-table overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">主旨</th>
                  <th className="px-4 py-3">收件 Email</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">嘗試/下次重試</th>
                  <th className="px-4 py-3">失敗原因 / Provider ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emailDeliveries.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-950">{item.subject}</p>
                      <p className="mt-1 text-xs text-slate-400">{item.notificationId}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{item.recipientEmail}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${deliveryStatusStyles[item.status]}`}>
                        {deliveryStatusLabels[item.status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      <p className="font-semibold text-slate-700">{item.attempts} 次</p>
                      <p className="mt-1">下次：{item.nextAttemptAt}</p>
                      <p className="mt-1">上次：{item.lastAttemptAt}</p>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      <p className={item.errorMessage ? "font-semibold text-rose-700" : ""}>{item.errorMessage || "-"}</p>
                      <p className="mt-1 break-all text-slate-400">{item.providerMessageId || "尚無 provider id"}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        {canSendNotifications ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">手動發送通知</h2>
              <p className="text-sm text-slate-500">支援站內通知與 Email 通知，可用於系統公告或補發通知。</p>
            </div>
            <Send className="h-5 w-5 text-sky-600" />
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              通知類型
              <select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as NotificationType }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {notificationTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              收件人
              <input
                value={form.recipient}
                onChange={(event) => setForm((current) => ({ ...current, recipient: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              標題
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="輸入通知標題"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              內容
              <textarea
                value={form.content}
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                rows={4}
                placeholder="輸入通知內容"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.inApp}
                  onChange={(event) => setForm((current) => ({ ...current, inApp: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                站內通知
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Email 通知
              </label>
            </div>
          </div>

          <button
            onClick={() => sendNotification().catch((error) => setMessage(error instanceof Error ? error.message : "發送通知失敗。"))}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            <Send className="h-4 w-4" />
            發送通知
          </button>
        </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">我的通知</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              一般員工可查看與標記自己的通知；手動發送、重送 Email 與通知規則設定僅開放人資與系統管理角色。
            </p>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">通知紀錄</h2>
              <p className="text-sm text-slate-500">可依通知類型篩選，追蹤站內通知與 Email 寄送狀態。</p>
            </div>
            <select
              value={activeType}
              onChange={(event) => setActiveType(event.target.value as NotificationType | "全部")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option>全部</option>
              {notificationTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="mobile-card-list p-3">
            {filteredNotifications.map((item) => {
              const Icon = typeIcons[item.type];
              return (
                <article key={item.id} className="mobile-record-card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${typeStyles[item.type]}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {item.type}
                      </span>
                      <h3 className="mt-2 text-base font-black text-slate-950">{item.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{item.content}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>{item.status}</span>
                  </div>

                  <div className="grid gap-2">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">收件人</span>
                      <span className="mobile-card-value">{item.recipient}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">來源</span>
                      <span className="mobile-card-value">{item.sourceModule}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">時間</span>
                      <span className="mobile-card-value">{item.createdAt}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {item.channels.map((channel) => (
                      <span key={`${item.id}-${channel}`} className={`rounded-full px-2 py-1 text-xs font-semibold ${channel === "Email" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                        {channel}
                      </span>
                    ))}
                    {item.emailStatus !== "not_required" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        Email {item.emailStatus}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => markAsRead(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "標記已讀失敗。"))}
                      disabled={item.status !== "未讀"}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      標記已讀
                    </button>
                    {canSendNotifications ? (
                      <button
                        onClick={() => retryEmail(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "重寄 Email 失敗。"))}
                        disabled={item.status !== "寄送失敗" && !["failed", "config_missing"].includes(item.emailStatus)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Mail className="h-4 w-4" />
                        重寄 Email
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="desktop-data-table overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">通知內容</th>
                  <th className="px-4 py-3">收件人</th>
                  <th className="px-4 py-3">管道</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredNotifications.map((item) => {
                  const Icon = typeIcons[item.type];
                  return (
                    <tr key={item.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${typeStyles[item.type]}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {item.type}
                        </span>
                        <p className="mt-2 text-xs text-slate-500">{item.sourceModule}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-950">{item.title}</p>
                        <p className="mt-1 max-w-md text-xs text-slate-500">{item.content}</p>
                        <p className="mt-2 text-xs text-slate-400">{item.id} · {item.createdAt}</p>
                        {item.eventId ? <p className="mt-1 text-xs font-semibold text-amber-700">事件：{item.eventId}</p> : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{item.recipient}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {item.channels.map((channel) => (
                            <span key={`${item.id}-${channel}`} className={`rounded-full px-2 py-1 text-xs font-semibold ${channel === "Email" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                              {channel}
                            </span>
                          ))}
                          {item.emailStatus !== "not_required" ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                              Email {item.emailStatus}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>{item.status}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => markAsRead(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "標記已讀失敗。"))}
                            disabled={item.status !== "未讀"}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            標記已讀
                          </button>
                          {canSendNotifications ? (
                            <button
                              onClick={() => retryEmail(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "重寄 Email 失敗。"))}
                              disabled={item.status !== "寄送失敗" && !["failed", "config_missing"].includes(item.emailStatus)}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              重寄 Email
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {canManageNotificationRules ? (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">通知規則設定</h2>
            <p className="text-sm text-slate-500">每種通知類型可獨立啟用站內通知與 Email 通知。</p>
          </div>
          <BellRing className="h-5 w-5 text-sky-600" />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {rules.map((rule) => {
            const Icon = rule.icon;
            return (
              <div key={rule.type} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-sky-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${typeStyles[rule.type]}`}>{rule.type}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">{rule.description}</p>
                <p className="mt-2 text-xs text-slate-500">收件人：{rule.recipients}</p>
                <p className="mt-1 text-xs text-slate-500">時機：{rule.triggerTiming}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => toggleRuleChannel(rule.type, "站內通知").catch((error) => setMessage(error instanceof Error ? error.message : "通知規則儲存失敗。"))}
                    className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${rule.inAppEnabled ? "bg-sky-100 text-sky-700" : "bg-white text-slate-400"}`}
                  >
                    站內通知
                  </button>
                  <button
                    onClick={() => toggleRuleChannel(rule.type, "Email").catch((error) => setMessage(error instanceof Error ? error.message : "通知規則儲存失敗。"))}
                    className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${rule.emailEnabled ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-400"}`}
                  >
                    Email
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      ) : null}

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-5 w-5 text-sky-700" />
            <h2 className="font-semibold text-sky-900">站內通知</h2>
          </div>
          <p className="text-sm text-sky-800">提供系統內即時提醒、未讀狀態、通知紀錄與模組來源，可放入 Header 通知鈴鐺。</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">Email 通知</h2>
          </div>
          <p className="text-sm text-emerald-800">支援 Email 發送狀態、寄送失敗重試與不同通知類型的收件人規則。</p>
        </div>
      </section>
    </div>
  );
}
