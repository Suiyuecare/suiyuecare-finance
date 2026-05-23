"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileClock,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { getRoleLabel } from "@/lib/auth/rbac";
import { runPermissionPressureTest, summarizePermissionPressureResults } from "@/lib/auth/permission-pressure-test";
import {
  securityControls,
  securityLaunchChecklist,
  securityStatusLabel,
  securityStatusStyle,
  sensitiveActionPolicies,
  backupRestorePolicies,
  getSecurityRoleSummary,
} from "@/lib/security/security-center";

type AuditRow = {
  id: string;
  action: string | null;
  resource_type: string | null;
  resource_id: string | null;
  actor_user_id: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

const riskTone = {
  敏感: "border-amber-200 bg-amber-50 text-amber-700",
  高敏感: "border-rose-200 bg-rose-50 text-rose-700",
};

function formatDateTime(value: string | null) {
  if (!value) return "未記錄";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

export default function SecurityCenterPage() {
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState("正在讀取資安與權限狀態...");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);

  const roleSummaries = useMemo(() => getSecurityRoleSummary(), []);
  const blockedControls = securityControls.filter((control) => control.status === "blocked").length;
  const reviewControls = securityControls.filter((control) => control.status === "review").length;
  const readyControls = securityControls.filter((control) => control.status === "ready").length;
  const highRiskActionCount = sensitiveActionPolicies.filter((policy) => policy.risk === "高敏感").length;
  const highRiskRoleCount = roleSummaries.filter((role) => role.highRiskCount > 0).length;
  const permissionPressureResults = useMemo(() => runPermissionPressureTest(), []);
  const permissionPressureSummary = useMemo(() => summarizePermissionPressureResults(permissionPressureResults), [permissionPressureResults]);
  const failedPermissionPressureResults = permissionPressureResults.filter((item) => !item.passed);

  useEffect(() => {
    void loadAuditRows();
  }, []);

  async function loadAuditRows() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/security/audit", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "讀取稽核紀錄失敗。");
      setAuditRows((payload.data ?? []) as AuditRow[]);
      setMessage("資安中心已同步 audit_logs；敏感操作需留存操作者、時間、資源與原因。");
      setLastSyncedAt(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "稽核紀錄尚無法讀取，請確認 Supabase RLS 與權限。");
      setLastSyncedAt(new Date());
    } finally {
      setIsLoading(false);
    }
  }

  async function runBackupWorker() {
    setIsRunningBackup(true);
    setMessage("正在執行正式備份自動化檢查...");
    try {
      const response = await fetch("/api/security/backup-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? payload.errors?.join("、") ?? "備份自動化檢查失敗。");

      setMessage(
        `備份自動化完成：公司 ${payload.companies ?? 0} 間，完成 ${payload.completed ?? 0} 筆，最近備份 ${
          payload.latestBackupAt ? formatDateTime(payload.latestBackupAt) : "未取得"
        }。`,
      );
      setLastSyncedAt(new Date());
      await loadAuditRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "備份自動化尚無法執行，請確認權限與環境變數。");
      setLastSyncedAt(new Date());
    } finally {
      setIsRunningBackup(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">SECURITY & ACCESS CONTROL</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">資安與權限中心</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              這裡集中檢查 HRIS 的登入、角色權限、資料範圍、個資遮罩、薪資分層、RLS、匯出稽核與上線部署安全。目標是讓一般員工不能看到他人個資與薪資，也讓管理權限調整可追溯。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void loadAuditRows()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-[#8a4b06] disabled:opacity-60"
            >
              <Activity className={`h-4 w-4 ${isLoading ? "animate-pulse" : ""}`} />
              重新同步
            </button>
            <Link href="/settings" className="inline-flex items-center gap-2 rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white hover:bg-[#92400e]">
              調整權限
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <OperationFeedback
        title="資安同步狀態"
        message={message}
        status={isLoading ? "loading" : blockedControls > 0 ? "blocked" : undefined}
        updatedAt={lastSyncedAt ?? undefined}
        details={["RLS", "RBAC", "Audit Logs", "Sensitive Data"]}
        actionLabel="查看系統設定"
        actionHref="/settings"
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "已具備控管", value: `${readyControls}`, detail: "可視為已落地", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" },
          { label: "需複核", value: `${reviewControls}`, detail: "上線前需實帳驗證", icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
          { label: "上線阻擋", value: `${blockedControls}`, detail: "部署前必須排除", icon: ShieldAlert, tone: "bg-rose-50 text-rose-700" },
          { label: "高敏感動作", value: `${highRiskActionCount}`, detail: "需理由、複核、稽核", icon: KeyRound, tone: "bg-violet-50 text-violet-700" },
          { label: "高風險角色", value: `${highRiskRoleCount}`, detail: "含敏感個資或薪資權限", icon: UserRoundCog, tone: "bg-sky-50 text-sky-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-black text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">PERMISSION PRESSURE TEST</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">五種角色權限壓力測試</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              以組員、主管、人資、行政部門主任、執行長逐一驗證功能權限、頁面路由、敏感資料與資料範圍。此測試會檢查：組員不能看他人資料、主管不能看身分證/地址/薪資、人資與行政主任可處理人事薪資、執行長預設看經營總額。
            </p>
          </div>
          <div className={`rounded-lg border px-4 py-3 text-sm font-black ${
            permissionPressureSummary.blockingFailed > 0
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {permissionPressureSummary.blockingFailed > 0 ? "未通過" : "通過"} · {permissionPressureSummary.passed}/{permissionPressureSummary.total}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            { label: "測試項目", value: permissionPressureSummary.total, detail: "功能、路由、敏感資料、資料範圍", tone: "bg-slate-50 text-slate-700" },
            { label: "已通過", value: permissionPressureSummary.passed, detail: "符合預期規則", tone: "bg-emerald-50 text-emerald-700" },
            { label: "阻擋失敗", value: permissionPressureSummary.blockingFailed, detail: "需上線前修正", tone: "bg-rose-50 text-rose-700" },
            { label: "複核失敗", value: permissionPressureSummary.reviewFailed, detail: "需確認資料範圍", tone: "bg-amber-50 text-amber-700" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4">
              <p className="text-sm font-bold text-slate-500">{item.label}</p>
              <p className={`mt-3 rounded-lg px-3 py-2 text-2xl font-black ${item.tone}`}>{item.value}</p>
              <p className="mt-2 text-xs text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>

        {failedPermissionPressureResults.length ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <h3 className="font-black text-rose-900">需要修正的權限缺口</h3>
            <div className="mt-3 grid gap-2">
              {failedPermissionPressureResults.map((item) => (
                <div key={item.id} className="rounded-lg bg-white px-3 py-2 text-sm text-rose-800">
                  <span className="font-black">{item.roleLabel}</span> · {item.group} · {item.target}：
                  預期 {item.expected ? "允許" : "阻擋"}，實際 {item.actual ? "允許" : "阻擋"}。{item.reason}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800">
            權限壓力測試目前全部通過：一般員工、主管、HR、行政主任與執行長的功能入口與敏感資料邊界符合目前上線規則。
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#fffaf4] text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">結果</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">類型</th>
                <th className="px-4 py-3">檢查項目</th>
                <th className="px-4 py-3">預期</th>
                <th className="px-4 py-3">實際</th>
                <th className="px-4 py-3">說明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ead8c2]">
              {permissionPressureResults.map((item) => (
                <tr key={item.id} className={item.passed ? "hover:bg-[#fffaf4]" : "bg-rose-50"}>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
                      item.passed ? "bg-emerald-50 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}>
                      {item.passed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-black text-slate-950">{item.roleLabel}</td>
                  <td className="px-4 py-3 text-slate-600">{item.group}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.target}</td>
                  <td className="px-4 py-3">{item.expected ? "允許" : "阻擋"}</td>
                  <td className="px-4 py-3">{item.actual ? "允許" : "阻擋"}</td>
                  <td className="px-4 py-3 text-slate-600">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">SECURITY CONTROLS</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">上線資安控管</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">把資安拆成可追蹤的控制點，每一項都有負責人、證據、狀態與下鑽入口。</p>
            </div>
            <Link href="/compliance" className="inline-flex items-center justify-center rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-[#8a4b06]">
              法規檢核
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {securityControls.map((control) => (
              <Link key={control.title} href={control.href} className={`rounded-lg border p-4 transition hover:shadow-md ${securityStatusStyle(control.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white/70 p-2">
                    <control.icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">{securityStatusLabel(control.status)}</span>
                </div>
                <h3 className="mt-4 font-black">{control.title}</h3>
                <p className="mt-2 text-xs leading-5 opacity-80">{control.description}</p>
                <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs leading-5">
                  <span className="font-black">證據：</span>{control.evidence}
                </div>
                <div className="mt-3 text-xs font-black">負責：{control.owner}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">上線前安全檢查</h2>
          </div>
          <div className="mt-4 space-y-3">
            {securityLaunchChecklist.map((item) => (
              <div key={item.title} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3">
                <div className="flex items-start gap-2">
                  {item.status === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.status === "blocked" ? "text-rose-600" : "text-amber-600"}`} />}
                  <div>
                    <div className="text-sm font-black text-slate-950">{item.title}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">BACKUP & RESTORE</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">備份與復原治理</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              備份不能只停在文件，正式上線前要有 RPO/RTO、保留週期、還原演練與重大異動前備份紀錄。這些設定已寫入 Supabase `system_settings.backup_restore_policy`，演練紀錄寫入 `backup_restore_runs`。
            </p>
          </div>
          <Link href="/settings" className="inline-flex items-center justify-center rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-[#8a4b06]">
            查看備份設定
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
          <button
            onClick={() => void runBackupWorker()}
            disabled={isRunningBackup}
            className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            <Activity className={`mr-1 h-4 w-4 ${isRunningBackup ? "animate-pulse" : ""}`} />
            執行備份檢查
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {backupRestorePolicies.map((policy) => (
            <div key={policy.title} className={`rounded-lg border p-4 ${securityStatusStyle(policy.status)}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-lg bg-white/70 p-2">
                  <Database className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">{securityStatusLabel(policy.status)}</span>
              </div>
              <h3 className="mt-4 font-black">{policy.title}</h3>
              <div className="mt-3 grid gap-2 text-xs leading-5">
                <div><span className="font-black">RPO：</span>{policy.rpo}</div>
                <div><span className="font-black">RTO：</span>{policy.rto}</div>
                <div><span className="font-black">保留：</span>{policy.retention}</div>
                <div><span className="font-black">負責：</span>{policy.owner}</div>
              </div>
              <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs leading-5">
                <span className="font-black">證據：</span>{policy.evidence}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">SENSITIVE ACTION GOVERNANCE</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">敏感操作控管</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              高敏感操作不能只靠按鈕權限，還要有理由、複核、影響範圍與 audit action。這些項目會成為接下來補 API 稽核與阻擋的依據。
            </p>
          </div>
          <Link href="/settings" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white">
            管理角色權限
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#fffaf4] text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">敏感操作</th>
                <th className="px-4 py-3">風險</th>
                <th className="px-4 py-3">必要權限</th>
                <th className="px-4 py-3">必要證據</th>
                <th className="px-4 py-3">複核規則</th>
                <th className="px-4 py-3">Audit Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ead8c2]">
              {sensitiveActionPolicies.map((policy) => (
                <tr key={policy.action} className="hover:bg-[#fffaf4]">
                  <td className="px-4 py-4">
                    <Link href={policy.href} className="font-black text-slate-950 hover:text-[#b45309]">{policy.action}</Link>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${riskTone[policy.risk]}`}>{policy.risk}</span>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-600">{policy.requiredPermission}</td>
                  <td className="px-4 py-4 text-slate-600">{policy.requiredEvidence}</td>
                  <td className="px-4 py-4 text-slate-600">{policy.approvalRule}</td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-500">{policy.auditAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">角色敏感權限總覽</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {roleSummaries.map((role) => (
              <Link key={role.role} href="/settings" className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 hover:border-[#d97706] hover:bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-slate-950">{getRoleLabel(role.role)}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{role.dataScopeMeta.label} · {role.totalPermissions} 權限</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${role.highRiskCount > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    高敏感 {role.highRiskCount}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {role.highRiskPermissions.slice(0, 4).map((permission) => (
                    <span key={permission.permission} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                      {permission.label}
                    </span>
                  ))}
                  {!role.highRiskPermissions.length ? <span className="text-xs font-semibold text-emerald-700">無高敏感權限</span> : null}
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">最近稽核紀錄</h2>
          </div>
          <div className="mt-4 space-y-3">
            {auditRows.slice(0, 8).map((row) => (
              <div key={row.id} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-950">{row.action ?? "未命名操作"}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.resource_type ?? "resource"} / {row.resource_id ?? "未指定"}</div>
                  </div>
                  <Clock3 className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 text-xs font-semibold text-slate-500">{formatDateTime(row.created_at)}</div>
              </div>
            ))}
            {!auditRows.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                尚未讀到 audit_logs。請確認目前帳號有 `system:settings` 權限，且 Supabase RLS 允許查看公司稽核紀錄。
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Download className="mt-0.5 h-5 w-5 text-[#b45309]" />
          <div>
            <h2 className="font-black text-slate-950">下一步要補的硬性阻擋</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              接下來應把薪資清冊匯出、評鑑匯出、員工敏感個資檢視、權限發布、薪資發布全部接到同一套 audit helper，並在 API 層使用 `requireApiPermission` 二次驗證，避免只有前端遮罩。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
