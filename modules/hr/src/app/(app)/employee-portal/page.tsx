"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarCheck2,
  CalendarClock,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileClock,
  LockKeyhole,
  Megaphone,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getLiveClient } from "@/lib/supabase/live-modules";

type PortalAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

type PortalTask = {
  title: string;
  description: string;
  href: string;
  tag: string;
  tone: string;
};

type PortalStats = {
  pendingRequests: number;
  unreadNotifications: number;
  todayPunches: number;
  releasedPayslips: number;
  expiringLicenses: number;
};

type SelfProfile = {
  employeeNo: string;
  fullName: string;
  phone: string;
  email: string;
  branchName: string;
  departmentName: string;
  positionName: string;
  supervisorName: string;
};

type TodayWorkStatus = {
  date: string;
  shiftName: string;
  shiftTime: string;
  branchName: string;
  clockIn: string;
  clockOut: string;
  status: "not_started" | "working" | "out" | "done" | "no_schedule" | "unknown";
  nextAction: string;
  nextHref: string;
  dataSource: string;
};

type PortalCountQuery = {
  eq: (column: string, value: unknown) => PortalCountQuery;
  in: (column: string, values: unknown[]) => PortalCountQuery;
  gte: (column: string, value: unknown) => PortalCountQuery;
  lt: (column: string, value: unknown) => PortalCountQuery;
  then: Promise<{ count: number | null; error: Error | null }>["then"];
};

type PortalUserRow = {
  email?: string | null;
  employees?: {
    employee_no?: string | null;
    full_name?: string | null;
    phone?: string | null;
    branches?: { name?: string | null } | null;
    departments?: { name?: string | null } | null;
    positions?: { name?: string | null } | null;
    supervisor?: { full_name?: string | null } | null;
  } | null;
};

type TodayPunchRow = {
  punch_type?: string | null;
  punched_at?: string | null;
};

type TodayScheduleRow = {
  work_date?: string | null;
  shift_name?: string | null;
  shift?: string | null;
  shift_time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  branch_name?: string | null;
  branches?: { name?: string | null } | null;
  shifts?: {
    name?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  } | null;
};

const quickActions: PortalAction[] = [
  {
    title: "查看個人資料",
    description: "基本資料、通訊地址、緊急聯絡人",
    href: "/employees/me",
    icon: UserRound,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    title: "查看班表",
    description: "今日班別、月曆、請假與加班標示",
    href: "/attendance",
    icon: CalendarCheck2,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    title: "上下班打卡",
    description: "GPS / Wi-Fi / IP 規則檢核",
    href: "/clock",
    icon: Clock3,
    tone: "bg-orange-50 text-orange-700",
  },
  {
    title: "申請請假",
    description: "假別餘額、附件、代理人檢核",
    href: "/requests/new/leave",
    icon: CalendarClock,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    title: "申請加班",
    description: "加班費或補休，送出後追蹤",
    href: "/overtime-requests",
    icon: WalletCards,
    tone: "bg-indigo-50 text-indigo-700",
  },
  {
    title: "申請補卡",
    description: "補上班卡、補下班卡或修正時間",
    href: "/punch-corrections",
    icon: FileClock,
    tone: "bg-cyan-50 text-cyan-700",
  },
  {
    title: "查看簽核進度",
    description: "簽核中、已核准、被退回",
    href: "/requests",
    icon: FileCheck2,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    title: "查看薪資單",
    description: "電子薪資單與匯款帳號末五碼",
    href: "/payslip",
    icon: LockKeyhole,
    tone: "bg-rose-50 text-rose-700",
  },
  {
    title: "查看公告",
    description: "公司公告、系統公告與已讀狀態",
    href: "/announcements",
    icon: Megaphone,
    tone: "bg-slate-100 text-slate-700",
  },
  {
    title: "性騷申訴管道",
    description: "防治措施、申訴窗口與知悉回條",
    href: "/harassment-policy",
    icon: ShieldCheck,
    tone: "bg-teal-50 text-teal-700",
  },
  {
    title: "上傳證照文件",
    description: "長照小卡、CPR、訓練證明附件",
    href: "/licenses",
    icon: UploadCloud,
    tone: "bg-lime-50 text-lime-700",
  },
];

const leaveBalances = [
  { type: "特休", used: 32, total: 112, unit: "小時", detail: "依到職日與年資自動計算" },
  { type: "補休", used: 6, total: 18, unit: "小時", detail: "由已核准加班轉入" },
  { type: "家庭照顧假", used: 8, total: 56, unit: "小時", detail: "年度上限提醒" },
  { type: "病假", used: 16, total: 240, unit: "小時", detail: "扣薪比例依假別規則" },
];

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function formatTime(value?: string | null) {
  if (!value) return "";
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 5);
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function defaultTodayWorkStatus(): TodayWorkStatus {
  return {
    date: todayIso(),
    shiftName: "尚未同步班表",
    shiftTime: "請查看出勤日曆",
    branchName: "尚未設定",
    clockIn: "未打卡",
    clockOut: "未打卡",
    status: "unknown",
    nextAction: "查看今日班表",
    nextHref: "/attendance",
    dataSource: "等待 Supabase 班表與打卡資料",
  };
}

function deriveTodayWorkStatus(
  schedule: TodayScheduleRow | null,
  punches: TodayPunchRow[],
  fallbackBranchName: string,
): TodayWorkStatus {
  const clockInPunch = punches.find((punch) => punch.punch_type === "clock_in");
  const clockOutPunch = punches.find((punch) => punch.punch_type === "clock_out");
  const outPunch = punches.find((punch) => punch.punch_type === "out");
  const returnPunch = punches.find((punch) => punch.punch_type === "return");
  const shiftName = schedule?.shift_name ?? schedule?.shift ?? schedule?.shifts?.name ?? "今日未排班";
  const startTime = formatTime(schedule?.start_time ?? schedule?.starts_at ?? schedule?.shifts?.start_time);
  const endTime = formatTime(schedule?.end_time ?? schedule?.ends_at ?? schedule?.shifts?.end_time);
  const shiftTime = schedule?.shift_time ?? (startTime || endTime ? `${startTime || "--:--"}-${endTime || "--:--"}` : "未設定時間");
  const branchName = schedule?.branch_name ?? schedule?.branches?.name ?? fallbackBranchName;

  if (!schedule) {
    return {
      ...defaultTodayWorkStatus(),
      shiftName: "今日未排班",
      shiftTime: "沒有班表資料",
      branchName,
      clockIn: clockInPunch?.punched_at ? formatTime(clockInPunch.punched_at) : "未打卡",
      clockOut: clockOutPunch?.punched_at ? formatTime(clockOutPunch.punched_at) : "未打卡",
      status: "no_schedule",
      nextAction: punches.length ? "查看今日打卡" : "查看班表",
      nextHref: punches.length ? "/clock" : "/attendance",
      dataSource: "尚未讀到今日班表",
    };
  }

  if (clockOutPunch) {
    return {
      date: todayIso(),
      shiftName,
      shiftTime,
      branchName,
      clockIn: clockInPunch?.punched_at ? formatTime(clockInPunch.punched_at) : "未打卡",
      clockOut: formatTime(clockOutPunch.punched_at),
      status: "done",
      nextAction: "查看今日紀錄",
      nextHref: "/clock",
      dataSource: "今日班表與打卡已同步",
    };
  }

  if (outPunch && !returnPunch) {
    return {
      date: todayIso(),
      shiftName,
      shiftTime,
      branchName,
      clockIn: clockInPunch?.punched_at ? formatTime(clockInPunch.punched_at) : "未打卡",
      clockOut: "未打卡",
      status: "out",
      nextAction: "返回打卡",
      nextHref: "/clock",
      dataSource: "外出狀態依今日打卡判斷",
    };
  }

  if (clockInPunch || returnPunch) {
    return {
      date: todayIso(),
      shiftName,
      shiftTime,
      branchName,
      clockIn: clockInPunch?.punched_at ? formatTime(clockInPunch.punched_at) : "未打卡",
      clockOut: "未打卡",
      status: "working",
      nextAction: "下班打卡",
      nextHref: "/clock",
      dataSource: "上班狀態依今日打卡判斷",
    };
  }

  return {
    date: todayIso(),
    shiftName,
    shiftTime,
    branchName,
    clockIn: "未打卡",
    clockOut: "未打卡",
    status: "not_started",
    nextAction: "上班打卡",
    nextHref: "/clock",
    dataSource: "今日班表已同步",
  };
}

function todayStatusLabel(status: TodayWorkStatus["status"]) {
  if (status === "not_started") return "尚未上班";
  if (status === "working") return "上班中";
  if (status === "out") return "外出中";
  if (status === "done") return "已下班";
  if (status === "no_schedule") return "今日未排班";
  return "待同步";
}

function todayStatusTone(status: TodayWorkStatus["status"]) {
  if (status === "working") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "out") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "done") return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === "not_started") return "border-orange-200 bg-orange-50 text-orange-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function buildEmployeeHref(profile: SelfProfile | null) {
  return profile?.employeeNo ? `/employees/${profile.employeeNo}` : "/employees";
}

export default function EmployeePortalPage() {
  const currentUser = useCurrentUser();
  const [stats, setStats] = useState<PortalStats>({
    pendingRequests: 0,
    unreadNotifications: 0,
    todayPunches: 0,
    releasedPayslips: 0,
    expiringLicenses: 0,
  });
  const [profile, setProfile] = useState<SelfProfile | null>(null);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [loadMessage, setLoadMessage] = useState("正在同步你的個人任務...");
  const [todayWorkStatus, setTodayWorkStatus] = useState<TodayWorkStatus>(() => defaultTodayWorkStatus());

  useEffect(() => {
    if (!currentUser.id) return;
    void loadPortalData();
  }, [currentUser.id]);

  async function countRows(table: string, configure: (query: PortalCountQuery) => PortalCountQuery) {
    const supabase = getLiveClient();
    const query = configure(supabase.from(table).select("id", { count: "exact", head: true }).is("deleted_at", null) as PortalCountQuery);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async function loadPortalData() {
    try {
      const supabase = getLiveClient();
      const { data: userRow, error: userError } = await supabase
        .from("users")
        .select("email, employees(employee_no, full_name, phone, primary_branch_id, primary_department_id, position_id, branches(name), departments(name), positions(name), supervisor:employees!employees_supervisor_id_fkey(full_name))")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (userError) throw userError;

      const typedUserRow = userRow as PortalUserRow | null;
      const employee = typedUserRow?.employees;
      const employeeId = currentUser.id ? (await supabase.from("users").select("employee_id").eq("id", currentUser.id).maybeSingle()).data?.employee_id : null;
      const fallbackBranchName = employee?.branches?.name ?? "尚未設定";
      setProfile(employee ? {
        employeeNo: employee.employee_no ?? "",
        fullName: employee.full_name ?? currentUser.name,
        phone: employee.phone ?? "尚未填寫",
        email: typedUserRow?.email ?? currentUser.email,
        branchName: employee.branches?.name ?? "尚未設定",
        departmentName: employee.departments?.name ?? "尚未設定",
        positionName: employee.positions?.name ?? "尚未設定",
        supervisorName: employee.supervisor?.full_name ?? "尚未設定",
      } : null);

      const today = todayIso();
      const [pendingRequests, unreadNotifications, todayPunches, releasedPayslips, expiringLicenses, todayPunchRows, todaySchedule] = await Promise.all([
        countRows("hr_requests", (query) => query.eq("applicant_id", currentUser.id).in("status", ["pending", "in_progress", "returned"])),
        countRows("notifications", (query) => query.eq("recipient_user_id", currentUser.id).eq("status", "unread")),
        countRows("attendance_punches", (query) => query.eq("user_id", currentUser.id).gte("punched_at", `${today}T00:00:00+08:00`).lt("punched_at", `${today}T23:59:59+08:00`)),
        employeeId ? countRows("payroll_payslips", (query) => query.eq("employee_id", employeeId).eq("status", "released")) : Promise.resolve(0),
        employeeId ? countRows("licenses", (query) => query.eq("employee_id", employeeId).in("status", ["expiring", "expired", "missing_attachment", "pending_review"])) : Promise.resolve(0),
        loadTodayPunches(currentUser.id, today),
        employeeId ? loadTodaySchedule(employeeId, today) : Promise.resolve(null),
      ]);

      const nextStats = { pendingRequests, unreadNotifications, todayPunches, releasedPayslips, expiringLicenses };
      setStats(nextStats);
      setTasks(buildTasks(nextStats));
      setTodayWorkStatus(deriveTodayWorkStatus(todaySchedule, todayPunchRows, fallbackBranchName));
      setLoadMessage("已同步 Supabase 個人資料、表單、打卡、薪資與證照提醒。");
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "員工入口資料同步失敗。");
      setTasks(buildTasks(stats));
    }
  }

  async function loadTodayPunches(userId: string, today: string) {
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("attendance_punches")
      .select("punch_type, punched_at")
      .eq("user_id", userId)
      .gte("punched_at", `${today}T00:00:00+08:00`)
      .lt("punched_at", `${today}T23:59:59+08:00`)
      .order("punched_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as TodayPunchRow[];
  }

  async function loadTodaySchedule(employeeId: string, today: string) {
    const supabase = getLiveClient();
    // The live schema may expose shift data either directly on schedules or through shifts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("schedules")
      .select("work_date, shift_name, shift, shift_time, start_time, end_time, starts_at, ends_at, branch_name, branches(name), shifts(name,start_time,end_time)")
      .eq("employee_id", employeeId)
      .eq("work_date", today)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return null;
    return (data ?? null) as TodayScheduleRow | null;
  }

  function buildTasks(nextStats: PortalStats): PortalTask[] {
    const baseTasks: PortalTask[] = [
      {
        title: nextStats.todayPunches > 0 ? "查看今日打卡紀錄" : "今天尚未打卡",
        description: nextStats.todayPunches > 0 ? `今日已有 ${nextStats.todayPunches} 筆打卡紀錄。` : "請確認今日班表後完成上班打卡。",
        href: "/clock",
        tag: "打卡",
        tone: nextStats.todayPunches > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900",
      },
      {
        title: nextStats.pendingRequests > 0 ? "追蹤簽核中的表單" : "新增請假或補卡申請",
        description: nextStats.pendingRequests > 0 ? `你有 ${nextStats.pendingRequests} 張表單仍在流程中。` : "所有表單會進入獨立頁面填寫並回到追蹤中心。",
        href: nextStats.pendingRequests > 0 ? "/requests" : "/requests/new",
        tag: "表單",
        tone: "border-sky-200 bg-sky-50 text-sky-800",
      },
      {
        title: nextStats.unreadNotifications > 0 ? "查看未讀通知" : "查看公司公告",
        description: nextStats.unreadNotifications > 0 ? `目前有 ${nextStats.unreadNotifications} 則未讀通知。` : "公告、薪資單發布與證照提醒都會集中到通知中心。",
        href: nextStats.unreadNotifications > 0 ? "/notifications" : "/announcements",
        tag: "通知",
        tone: "border-violet-200 bg-violet-50 text-violet-800",
      },
    ];

    if (nextStats.expiringLicenses > 0) {
      baseTasks.unshift({
        title: "補齊或更新證照文件",
        description: `${nextStats.expiringLicenses} 筆證照需要更新、補件或審核。`,
        href: "/licenses",
        tag: "證照",
        tone: "border-rose-200 bg-rose-50 text-rose-800",
      });
    }

    return baseTasks;
  }

  const profileHref = useMemo(() => buildEmployeeHref(profile), [profile]);
  const personalizedActions = useMemo(
    () => quickActions.map((action) => action.title === "查看個人資料" ? { ...action, href: profileHref } : action),
    [profileHref],
  );
  const primaryActions = personalizedActions.filter((action) =>
    ["上下班打卡", "查看班表", "申請請假", "申請補卡"].includes(action.title),
  );
  const serviceActions = personalizedActions.filter((action) =>
    !["上下班打卡", "查看班表", "申請請假", "申請補卡"].includes(action.title),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-8">
      <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">員工首頁</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">{currentUser.name || "夥伴"}，今天先做這幾件事</h1>
            <p className="mt-2 text-sm text-slate-500">{loadMessage}</p>
          </div>
          <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
            <Sparkles className="h-5 w-5" />
          </span>
        </div>

        <div className={`mt-4 rounded-lg border p-4 ${todayStatusTone(todayWorkStatus.status)}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black tracking-[0.12em]">今日狀態</div>
              <div className="mt-1 text-2xl font-black">{todayStatusLabel(todayWorkStatus.status)}</div>
              <div className="mt-1 text-sm opacity-80">
                {todayWorkStatus.shiftName} · {todayWorkStatus.shiftTime} · {todayWorkStatus.branchName}
              </div>
            </div>
            <Link
              href={todayWorkStatus.nextHref}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-sm hover:bg-[#fffaf4]"
            >
              {todayWorkStatus.nextAction}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              ["上班", todayWorkStatus.clockIn],
              ["下班", todayWorkStatus.clockOut],
              ["來源", todayWorkStatus.dataSource],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-white/70 px-3 py-2">
                <div className="text-xs font-bold opacity-70">{label}</div>
                <div className="mt-1 text-sm font-black">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {primaryActions.map((action) => (
            <Link key={action.title} href={action.href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3 text-center transition hover:border-[#d97706]">
              <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg ${action.tone}`}>
                <action.icon className="h-5 w-5" />
              </span>
              <div className="mt-2 text-sm font-black text-slate-950">{action.title.replace("申請", "")}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black text-slate-950">待處理</h2>
            <Bell className="h-5 w-5 text-[#b45309]" />
          </div>
          <div className="grid gap-2">
            {tasks.slice(0, 4).map((task) => (
              <Link key={`${task.tag}-${task.title}`} href={task.href} className={`rounded-lg border px-3 py-3 ${task.tone}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black">{task.tag}</div>
                    <div className="mt-0.5 truncate font-black">{task.title}</div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black text-slate-950">我的狀態</h2>
            <UserRound className="h-5 w-5 text-[#b45309]" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            {[
              ["打卡", `${stats.todayPunches}`],
              ["表單", `${stats.pendingRequests}`],
              ["通知", `${stats.unreadNotifications}`],
              ["證照", `${stats.expiringLicenses}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-[#fffaf4] px-3 py-3">
                <div className="text-xl font-black text-slate-950">{value}</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div className="font-bold text-slate-950">{profile?.fullName || currentUser.name}</div>
            <div className="mt-1 text-xs text-slate-500">{profile?.branchName || "尚未設定據點"} · {profile?.departmentName || "尚未設定部門"}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-black text-slate-950">常用功能</h2>
          <span className="text-xs font-bold text-slate-400">少一點，快一點</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {serviceActions.map((action) => (
            <Link key={action.title} href={action.href} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 transition hover:border-[#d97706] hover:bg-[#fffaf4]">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${action.tone}`}>
                  <action.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-950">{action.title}</div>
                  <div className="truncate text-xs text-slate-500">{action.description}</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link href="/requests/new/leave" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 font-black text-emerald-950">
            <CalendarCheck2 className="h-5 w-5" />
            假勤餘額
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {leaveBalances.slice(0, 4).map((leave) => (
              <div key={leave.type} className="rounded-lg bg-white/70 px-3 py-2">
                <div className="font-bold text-slate-950">{leave.type}</div>
                <div className="mt-1 text-xs text-slate-500">剩 {leave.total - leave.used} {leave.unit}</div>
              </div>
            ))}
          </div>
        </Link>

        <div className="grid gap-3">
          <Link href="/payslip" className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div>
              <div className="font-black text-rose-950">薪資袋</div>
              <div className="mt-1 text-sm text-rose-800">{stats.releasedPayslips > 0 ? `${stats.releasedPayslips} 份可查看` : "尚無已發布薪資單"}</div>
            </div>
            <LockKeyhole className="h-5 w-5 text-rose-700" />
          </Link>
          <Link href="/notifications" className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 p-4">
            <div>
              <div className="font-black text-violet-950">通知與公告</div>
              <div className="mt-1 text-sm text-violet-800">{stats.unreadNotifications} 則未讀通知</div>
            </div>
            <Megaphone className="h-5 w-5 text-violet-700" />
          </Link>
        </div>
      </section>
    </div>
  );
}
