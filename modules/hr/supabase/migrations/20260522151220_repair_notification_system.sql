-- Repair notification persistence, rules and RLS for the HRIS notification hub.

alter table public.notifications
  alter column read_at drop default;

alter table public.notifications
  alter column read_at drop not null;

update public.notifications
set read_at = null
where status = 'unread';

create index if not exists idx_notifications_recipient_status_created
on public.notifications(recipient_user_id, status, created_at desc)
where deleted_at is null;

create index if not exists idx_notification_events_recipient_user_ids
on public.notification_events using gin(recipient_user_ids)
where deleted_at is null;

drop policy if exists "notification managers can view company events" on public.notification_events;
create policy "notification managers and involved users can view events"
on public.notification_events for select
to authenticated
using (
  deleted_at is null
  and (
    private.is_hr_admin()
    or actor_user_id in (
      select users.id
      from public.users
      where users.auth_user_id = auth.uid()
        and users.deleted_at is null
    )
    or exists (
      select 1
      from public.users
      where users.auth_user_id = auth.uid()
        and users.deleted_at is null
        and users.id = any(public.notification_events.recipient_user_ids)
    )
  )
);

drop policy if exists "event actors insert event notifications" on public.notifications;
create policy "event actors insert event notifications"
on public.notifications for insert
to authenticated
with check (
  exists (
    select 1
    from public.notification_events events
    join public.users actor on actor.id = events.actor_user_id
    where events.id = notifications.event_id
      and events.company_id = notifications.company_id
      and actor.auth_user_id = auth.uid()
      and actor.deleted_at is null
      and notifications.recipient_user_id = any(events.recipient_user_ids)
      and events.deleted_at is null
  )
);

with default_notification_rules as (
  select jsonb_build_object(
    'rules',
    '[
      {"type":"請假送出","description":"員工送出請假申請後通知主管與人資。","inAppEnabled":true,"emailEnabled":true,"recipients":"直屬主管、人資","triggerTiming":"送出後即時"},
      {"type":"加班送出","description":"員工送出加班申請後通知主管。","inAppEnabled":true,"emailEnabled":true,"recipients":"直屬主管、人資","triggerTiming":"送出後即時"},
      {"type":"補卡送出","description":"員工送出補打卡申請後通知主管與人資。","inAppEnabled":true,"emailEnabled":true,"recipients":"直屬主管、人資","triggerTiming":"送出後即時"},
      {"type":"簽核通過","description":"申請核准後通知申請人與相關處理者。","inAppEnabled":true,"emailEnabled":true,"recipients":"申請人、下一關處理者","triggerTiming":"簽核完成後"},
      {"type":"簽核駁回","description":"申請駁回後通知申請人並保留駁回原因。","inAppEnabled":true,"emailEnabled":true,"recipients":"申請人","triggerTiming":"駁回後即時"},
      {"type":"班表異動","description":"排班、換班、代班或日照配置調整後通知相關人員。","inAppEnabled":true,"emailEnabled":false,"recipients":"受影響員工、主管","triggerTiming":"班表更新後"},
      {"type":"證照到期","description":"長照人員證照即將到期前通知本人與人資。","inAppEnabled":true,"emailEnabled":true,"recipients":"員工本人、人資","triggerTiming":"到期前 30/14/7 日"},
      {"type":"薪資單發布","description":"電子薪資單發布後通知員工。","inAppEnabled":true,"emailEnabled":true,"recipients":"員工本人","triggerTiming":"薪資單發布時"},
      {"type":"出勤異常","description":"遲到、早退、未打卡、GPS 異常等事件通知主管與人資。","inAppEnabled":true,"emailEnabled":false,"recipients":"員工本人、主管、人資","triggerTiming":"異常判斷後"},
      {"type":"系統公告","description":"公司公告、系統公告或維護通知發送給指定對象。","inAppEnabled":true,"emailEnabled":true,"recipients":"指定公司、據點、部門、角色","triggerTiming":"公告發布時"}
    ]'::jsonb,
    'required_event_types',
    '["請假送出","加班送出","補卡送出","簽核通過","簽核駁回","班表異動","證照到期","薪資單發布","出勤異常","系統公告"]'::jsonb,
    'email_provider_status',
    'queued_only',
    'updated_at',
    now()
  ) as settings
)
insert into public.system_settings (
  company_id,
  setting_key,
  category,
  display_name,
  description,
  settings,
  status,
  effective_from
)
select
  companies.id,
  'notification_rules',
  'notification_settings',
  '通知規則設定',
  '站內通知、Email 通知、收件人與事件類型設定。',
  default_notification_rules.settings,
  'active',
  current_date
from public.companies
cross join default_notification_rules
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'notification_rules'
      and existing.deleted_at is null
  );
