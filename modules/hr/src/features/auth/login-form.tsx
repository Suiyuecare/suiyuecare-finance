"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpenCheck, Building2, CheckCircle2, Download, FileText, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clearQuickLoginUser,
  setQuickLoginUser,
  supabaseAccountOptions,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { toCanonicalRole, type HrRole } from "@/lib/auth/rbac";

const roleIcons = {
  employee: UsersRound,
  team_member: UsersRound,
  section_chief: UserCheck,
  dept_manager: UserCheck,
  supervisor: UserCheck,
  general_affairs: Building2,
  hr: ShieldCheck,
  accountant: FileText,
  admin_director: Building2,
  ceo: CheckCircle2,
} as const;

const roleDescriptions = {
  employee: "員工入口、打卡、表單申請、表單追蹤、薪資袋",
  team_member: "員工入口、打卡、表單申請、表單追蹤、薪資袋",
  section_chief: "課長待辦、簽核、部門出勤異常、排班缺口",
  dept_manager: "部門主管待辦、簽核、部門出勤異常、排班缺口",
  supervisor: "部門主管待辦、簽核、部門出勤異常、排班缺口",
  general_affairs: "總務待辦、行政流程、簽核與跨部門支援",
  hr: "人資工作台、員工主檔、假勤、證照訓練、薪資前置",
  accountant: "薪資彙總、財務拋轉、會計檢核",
  admin_director: "行政總控、權限設定、薪資結算、法規檢核",
  ceo: "經營儀表板、全集團報表、重大權限與總額檢視",
} as const;

type LoginOption = {
  id: string;
  email: string;
  role: HrRole;
  roleLabel: string;
  name: string;
  companyId: string;
  primaryBranchId: string;
  departmentCode: string;
  departmentId?: string;
  teamId?: string;
  supportBranchIds?: string[];
  source?: "supabase" | "fallback";
};

type SupabaseLoginRow = {
  id: string;
  email: string;
  display_name: string;
  company_id: string | null;
  status: string | null;
  roles: { key: string | null; name: string | null } | null;
  employees: {
    primary_branch_id: string | null;
    primary_department_id: string | null;
    primary_team_id: string | null;
    departments: { code: string | null } | null;
  } | null;
};

type LoginQueryClient = {
  from: (table: "users") => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: unknown) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

function toCurrentUser(user: LoginOption): CurrentUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleLabel: user.roleLabel,
    companyId: user.companyId,
    primaryBranchId: user.primaryBranchId,
    departmentCode: user.departmentCode,
    departmentId: user.departmentId,
    teamId: user.teamId,
    supportBranchIds: user.supportBranchIds ?? [],
  };
}

function fallbackLoginOptions(): LoginOption[] {
  return supabaseAccountOptions.map((user) => ({ ...user, source: "fallback" }));
}

function mapSupabaseLoginRow(row: SupabaseLoginRow): LoginOption {
  const role = toCanonicalRole(row.roles?.key);
  return {
    id: row.id,
    email: row.email,
    role,
    roleLabel: row.roles?.name ?? "員工",
    name: row.display_name,
    companyId: row.company_id ?? "",
    primaryBranchId: row.employees?.primary_branch_id ?? "",
    departmentCode: row.employees?.departments?.code ?? "",
    departmentId: row.employees?.primary_department_id ?? undefined,
    teamId: row.employees?.primary_team_id ?? undefined,
    supportBranchIds: [],
    source: "supabase",
  };
}

export function LoginForm() {
  const router = useRouter();
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [loginOptions, setLoginOptions] = useState<LoginOption[]>(() => fallbackLoginOptions());
  const [sourceLabel, setSourceLabel] = useState("使用本機測試帳號，等待正式人員主檔同步。");

  useEffect(() => {
    let isMounted = true;

    async function loadLoginOptions() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      try {
        const queryClient = supabase as unknown as LoginQueryClient;
        const { data, error } = await queryClient
          .from("users")
          .select(`
            id,
            email,
            display_name,
            company_id,
            status,
            roles(key, name),
            employees(
              primary_branch_id,
              primary_department_id,
              primary_team_id,
              departments(code)
            )
          `)
          .eq("status", "active")
          .is("deleted_at", null)
          .order("display_name", { ascending: true });

        if (error || !Array.isArray(data) || data.length === 0) return;

        const mapped = (data as SupabaseLoginRow[])
          .map(mapSupabaseLoginRow)
          .filter((user) => user.email && user.name);

        if (!isMounted || mapped.length === 0) return;
        setLoginOptions(mapped);
        setSourceLabel("已連接 Supabase 正式人員主檔，登入後會套用同一套公司、部門與角色權限。");
      } catch {
        // Fallback cards stay available while the shared Finance/HR core schema is being applied.
      }
    }

    void loadLoginOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  const groupedOptions = useMemo(() => {
    const seen = new Set<string>();
    return loginOptions.filter((user) => {
      const key = `${user.email}-${user.role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [loginOptions]);

  async function loginByCard(user: LoginOption) {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    setQuickLoginUser(toCurrentUser(user));
    router.push("/modules");
    router.refresh();
  }

  async function clearSession() {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    clearQuickLoginUser();
    setActiveRole(null);
  }

  return (
    <Card className="w-full max-w-[520px] rounded-[14px] border-[#ead8c2] shadow-[0_18px_48px_rgba(52,36,18,0.08)]">
      <CardHeader className="pb-3">
        <div className="mb-2 inline-flex w-fit rounded-full border border-[#f0c987] bg-[#fff7ed] px-3 py-1 text-xs font-bold tracking-[0.12em] text-[#8a4b06]">
          SUIYUE HRIS
        </div>
        <CardTitle className="text-xl font-black text-[#172033]">選擇身分即可登入</CardTitle>
        <CardDescription className="text-slate-500">
          人資系統會優先讀取 Supabase 正式人員資料；尚未同步時保留測試帳號備援。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          {groupedOptions.map((user) => {
            const Icon = roleIcons[user.role];
            const isLoading = activeRole === `${user.id}-${user.role}`;

            return (
              <button
                key={`${user.id}-${user.email}-${user.role}`}
                type="button"
                className="group flex min-h-[72px] items-center gap-3 rounded-lg border border-[#ead8c2] bg-white px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#d97706] hover:bg-[#fff7ed] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97706]"
                onClick={() => {
                  setActiveRole(`${user.id}-${user.role}`);
                  void loginByCard(user);
                }}
                disabled={isLoading}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#fff3de] text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900">{user.roleLabel}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {user.name}
                    </span>
                    {user.source === "supabase" ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                        LIVE
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {roleDescriptions[user.role]}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-[#b45309]">
                  {isLoading ? "登入中" : "進入"}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-[12px] border border-[#ead8c2] bg-[#fffaf4] p-3 text-xs leading-5 text-slate-600">
          {sourceLabel}
        </div>

        <div className="rounded-[12px] border border-[#ead8c2] bg-white p-3">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
              <BookOpenCheck className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-black text-slate-950">操作教學下載</div>
              <div className="text-xs text-slate-500">手冊與簡報集中放在登入頁，系統內頁不顯示教學卡片。</div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              href="/manuals/hris-user-manual.html"
              download
              className="flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-black text-[#7c3f00] hover:border-[#d97706] hover:bg-[#fff3de]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">下載使用手冊</span>
              </span>
              <Download className="h-4 w-4 shrink-0" />
            </a>
            <a
              href="/manuals/hris-training-slides.pptx"
              download
              className="flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-black text-[#7c3f00] hover:border-[#d97706] hover:bg-[#fff3de]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">下載教學 PPT</span>
              </span>
              <Download className="h-4 w-4 shrink-0" />
            </a>
          </div>
        </div>

        <Button type="button" variant="outline" className="w-full bg-white" onClick={() => void clearSession()}>
          清除目前登入狀態
        </Button>
      </CardContent>
    </Card>
  );
}
