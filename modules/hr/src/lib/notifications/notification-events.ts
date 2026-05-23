import { getCurrentAppUser, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";
import { toCanonicalRole, type HrRole } from "@/lib/auth/rbac";

export type NotificationEventType =
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

export type NotificationChannel = "站內通知" | "Email";

export type EmitNotificationEventInput = {
  type: NotificationEventType;
  title: string;
  content: string;
  sourceModule: string;
  sourceId?: string;
  channels?: NotificationChannel[];
  recipientUserIds?: string[];
  recipientRoles?: HrRole[];
  broadcast?: boolean;
  metadata?: Record<string, unknown>;
};

type UserRecipientRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  roles: { key: string | null } | null;
};

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueChannels(channels: NotificationChannel[] | undefined) {
  const nextChannels = unique(channels ?? []) as NotificationChannel[];
  return nextChannels.length ? nextChannels : (["站內通知"] as NotificationChannel[]);
}

function toRecipientStrategy(input: EmitNotificationEventInput) {
  if (input.broadcast) return "broadcast";
  if (input.recipientRoles?.length) return "role";
  if (input.recipientUserIds?.length) return "explicit";
  return "self";
}

async function resolveRecipients(input: EmitNotificationEventInput, companyId: string, actorUserId: string) {
  const supabase = getLiveClient();
  const explicitUserIds = input.recipientUserIds ?? [];

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, email, roles(key)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw error;

  const rows = (data ?? []) as UserRecipientRow[];
  const companyUserIds = new Set(rows.map((row) => row.id));
  const explicitCompanyUserIds = explicitUserIds.filter((id) => companyUserIds.has(id));
  const roleUserIds = input.broadcast
    ? rows.map((row) => row.id)
    : rows
        .filter((row) => input.recipientRoles?.includes(toCanonicalRole(row.roles?.key)))
        .map((row) => row.id);

  const recipients = unique([...explicitCompanyUserIds, ...roleUserIds]);
  return recipients.length ? recipients : [actorUserId];
}

export async function emitNotificationEvent(input: EmitNotificationEventInput) {
  const supabase = getLiveClient();
  const user = await getCurrentAppUser();
  if (!user.company_id) throw new Error("目前登入者沒有公司資料，無法建立通知事件。");

  const channels = uniqueChannels(input.channels);
  const recipientUserIds = await resolveRecipients(input, user.company_id, user.id);
  const recipientStrategy = toRecipientStrategy(input);

  const { data: event, error: eventError } = await supabase
    .from("notification_events")
    .insert({
      company_id: user.company_id,
      event_type: input.type,
      source_module: input.sourceModule,
      source_id: input.sourceId ?? null,
      title: input.title,
      content: input.content,
      channels,
      actor_user_id: user.id,
      recipient_strategy: recipientStrategy,
      recipient_user_ids: recipientUserIds,
      payload: { ...(input.metadata ?? {}), recipient_count: recipientUserIds.length },
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  const notificationInputs = recipientUserIds.map((recipientUserId) => ({
    company_id: user.company_id,
    event_id: event.id,
    recipient_user_id: recipientUserId,
    notification_type: input.type,
    title: input.title,
    content: input.content,
    channels,
    status: "unread",
    source_module: input.sourceModule,
    metadata: {
      ...(input.metadata ?? {}),
      event_id: event.id,
      email_status: channels.includes("Email") ? "queued" : "not_required",
      recipient_strategy: recipientStrategy,
    },
  }));

  const { error: notificationError } = await supabase.from("notifications").insert(notificationInputs);
  if (notificationError) {
    await supabase
      .from("notification_events")
      .update({
        status: "failed",
        error_message: notificationError.message,
        payload: {
          ...(input.metadata ?? {}),
          recipient_count: recipientUserIds.length,
          failure_stage: "notifications_insert",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    throw notificationError;
  }

  await writeAuditLog({
    action: "notification.event.processed",
    resourceType: "notification_events",
    resourceId: event.id,
    afterData: {
      eventType: input.type,
      sourceModule: input.sourceModule,
      sourceId: input.sourceId,
      recipients: recipientUserIds.length,
      channels,
    },
  });

  return { eventId: event.id as string, notificationCount: notificationInputs.length };
}
