"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  Hourglass,
  Package,
  PackageCheck,
  RotateCcw,
  Route,
  Search,
  Truck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  loadWorkflowRequests,
  saveWorkflowRequests,
  type DemoWorkflowRequest,
} from "@/lib/requests/workflow-store";
import { requestFormDefinitions } from "@/lib/requests/form-catalog";

const tabs = ["全部", "草稿", "簽核中", "被退回", "已核准", "已駁回", "已取消"] as const;
const scopes = ["我的表單", "公司表單"] as const;

function statusStyle(status: DemoWorkflowRequest["status"]) {
  if (status === "已核准") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "被退回") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "已駁回" || status === "已取消") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "草稿") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-[#f0c987] bg-[#fff3de] text-[#8a4b06]";
}

function getProgress(request: DemoWorkflowRequest) {
  if (request.status === "草稿") return 0;
  if (request.status === "已核准") return 100;
  if (request.status === "已駁回" || request.status === "已取消") return 100;
  const total = Math.max(1, request.timeline.length);
  const done = request.timeline.filter((step) => step.state === "done").length;
  const current = request.timeline.some((step) => step.state === "current") ? 0.5 : 0;
  return Math.min(99, Math.round(((done + current) / total) * 100));
}

function getNextActionText(request: DemoWorkflowRequest, isMine: boolean) {
  if (request.status === "草稿") return isMine ? "續填草稿後送出" : "等待申請人送出";
  if (request.status === "被退回") return isMine ? "請補件後重新送出" : "等待申請人補件";
  if (request.status === "已核准") return "流程完成，可保留紀錄";
  if (request.status === "已駁回") return "流程已駁回，請查看原因";
  if (request.status === "已取消") return "申請人已取消";
  if (request.currentOwnerRole === "applicant") return isMine ? "等待你確認或補件" : "等待申請人處理";
  return `等待${request.currentStep}處理`;
}

function getCurrentOwnerText(request: DemoWorkflowRequest, isMine: boolean) {
  if (request.status === "草稿") return isMine ? "你" : request.applicant;
  if (request.currentOwnerRole === "done") return "無";
  if (request.currentOwnerRole === "applicant") return isMine ? "你" : request.applicant;
  return request.currentStep;
}

function getTrackingHeadline(request: DemoWorkflowRequest, isMine: boolean) {
  if (request.status === "草稿") return "表單尚未寄出";
  if (request.status === "被退回") return isMine ? "表單退回到你手上" : "表單退回申請人補件";
  if (request.status === "已核准") return "表單已送達完成";
  if (request.status === "已駁回") return "表單已停止配送";
  if (request.status === "已取消") return "表單已取消配送";
  return `表單正在前往「${request.currentStep}」`;
}

function getTrackingSubtext(request: DemoWorkflowRequest, isMine: boolean) {
  if (request.status === "草稿") return "完成內容後送出，系統才會開始簽核路線。";
  if (request.status === "被退回") return isMine ? "請依退回原因補件，重送後會回到主管關卡。" : "目前等待申請人補件重送。";
  if (request.status === "已核准") return "所有關卡都已完成，這張表單可作為正式紀錄。";
  if (request.status === "已駁回") return "流程已結束，如需重新申請請建立新表單。";
  if (request.status === "已取消") return "申請人已取消，流程不會再往下一站移動。";
  return `目前停在「${getCurrentOwnerText(request, isMine)}」，完成後會自動送往下一關。`;
}

function getRemainingStops(request: DemoWorkflowRequest) {
  if (["草稿", "已核准", "已駁回", "已取消"].includes(request.status)) return 0;
  return request.timeline.filter((step) => step.state === "pending").length;
}

function getNextStop(request: DemoWorkflowRequest) {
  if (request.status === "草稿") return "送出表單";
  if (request.status === "已核准") return "已完成";
  if (request.status === "已駁回" || request.status === "已取消") return "無下一站";
  const currentIndex = request.timeline.findIndex((step) => step.state === "current" || step.step === request.currentStep);
  const next = request.timeline.slice(Math.max(0, currentIndex + 1)).find((step) => step.state === "pending");
  return next?.step ?? (request.status === "被退回" ? "補件重送" : "申請人確認");
}

function getTrackingEta(request: DemoWorkflowRequest) {
  const remaining = getRemainingStops(request);
  if (request.status === "草稿") return "尚未開始";
  if (request.status === "已核准") return "已完成";
  if (request.status === "已駁回" || request.status === "已取消") return "已結束";
  if (request.status === "被退回") return "補件後重新計算";
  if (remaining <= 1) return "最後一站";
  return `剩 ${remaining} 站`;
}

function getAttachmentLabel(status?: DemoWorkflowRequest["attachmentStatus"]) {
  if (status === "verified") return "附件已驗證";
  if (status === "uploaded") return "附件已上傳";
  if (status === "missing") return "附件待補";
  return "無必填附件";
}

function getIntegrationLabel(status?: DemoWorkflowRequest["integrationStatus"]) {
  if (status === "synced") return "已回寫模組";
  if (status === "linked") return "已建立連動";
  if (status === "blocked") return "連動阻擋";
  if (status === "not_required") return "無需連動";
  return "等待連動";
}

function getMilestoneMeta(state: DemoWorkflowRequest["timeline"][number]["state"]) {
  if (state === "done") {
    return {
      icon: CheckCircle2,
      label: "已通過",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dotClassName: "bg-emerald-600 text-white",
    };
  }
  if (state === "current") {
    return {
      icon: Truck,
      label: "配送中",
      className: "border-[#f0c987] bg-[#fff3de] text-[#8a4b06]",
      dotClassName: "bg-[#d97706] text-white",
    };
  }
  if (state === "returned") {
    return {
      icon: RotateCcw,
      label: "退回",
      className: "border-violet-200 bg-violet-50 text-violet-700",
      dotClassName: "bg-violet-600 text-white",
    };
  }
  if (state === "rejected") {
    return {
      icon: XCircle,
      label: "停止",
      className: "border-rose-200 bg-rose-50 text-rose-700",
      dotClassName: "bg-rose-600 text-white",
    };
  }
  return {
    icon: Circle,
    label: "等待",
    className: "border-slate-200 bg-slate-50 text-slate-500",
    dotClassName: "bg-slate-200 text-slate-500",
  };
}

export default function RequestTrackingPage() {
  const currentUser = useCurrentUser();
  const [requests, setRequests] = useState<DemoWorkflowRequest[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("全部");
  const [activeScope, setActiveScope] = useState<(typeof scopes)[number]>("我的表單");
  const [query, setQuery] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const canViewCompanyForms = ["hr", "admin_director", "ceo"].includes(currentUser.role);

  useEffect(() => {
    let isMounted = true;

    async function refresh() {
      try {
        const rows = await loadWorkflowRequests();
        if (isMounted) setRequests(rows);
      } catch (error) {
        if (isMounted) setDataMessage(error instanceof Error ? error.message : "讀取 Supabase 表單資料失敗。");
      }
    }

    void refresh();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!canViewCompanyForms && activeScope === "公司表單") {
      setActiveScope("我的表單");
    }
  }, [activeScope, canViewCompanyForms]);

  async function updateRequest(id: string, patch: Partial<DemoWorkflowRequest>) {
    const nextRequests = requests.map((request) =>
      request.id === id
        ? { ...request, ...patch, auditLogs: [...request.auditLogs, `${new Date().toLocaleString("zh-TW", { hour12: false })} ${currentUser.name}更新狀態為${patch.status}`] }
        : request,
    );
    setRequests(nextRequests);
    try {
      await saveWorkflowRequests(nextRequests);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "寫入 Supabase 表單資料失敗。");
    }
  }

  function formHref(request: DemoWorkflowRequest) {
    const form = requestFormDefinitions.find((definition) => definition.type === request.type);
    return form ? `/requests/new/${form.id}` : "/requests/new";
  }

  async function copyRequestId(id: string) {
    await navigator.clipboard.writeText(id);
    setDataMessage(`已複製表單編號：${id}`);
  }

  const scopedRequests = useMemo(() => {
    return requests.filter((request) => {
      if (activeScope === "公司表單" && canViewCompanyForms) {
        return true;
      }

      return request.applicantId === currentUser.id;
    });
  }, [activeScope, canViewCompanyForms, currentUser.id, requests]);

  const tabCounts = useMemo(() => {
    return tabs.reduce<Record<(typeof tabs)[number], number>>((acc, tab) => {
      acc[tab] = scopedRequests.filter((request) => (
        tab === "全部" || request.status === tab || (tab === "簽核中" && request.status === "待我簽核")
      )).length;
      return acc;
    }, {} as Record<(typeof tabs)[number], number>);
  }, [scopedRequests]);

  const visibleRequests = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return scopedRequests.filter((request) => {
      const matchesTab = activeTab === "全部" || request.status === activeTab || (activeTab === "簽核中" && request.status === "待我簽核");
      const matchesQuery =
        !keyword ||
        [request.id, request.requestNo, request.formTitle, request.applicant, request.type, request.date, request.reason, request.currentStep]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      return matchesTab && matchesQuery;
    });
  }, [activeTab, query, scopedRequests]);

  const summary = useMemo(() => {
    const mine = scopedRequests.filter((request) => request.applicantId === currentUser.id);
    return {
      active: mine.filter((request) => ["待我簽核", "簽核中"].includes(request.status)).length,
      returned: mine.filter((request) => request.status === "被退回").length,
      approved: mine.filter((request) => request.status === "已核准").length,
      drafts: mine.filter((request) => request.status === "草稿").length,
    };
  }, [currentUser.id, scopedRequests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">REQUEST TRACKING</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">表單追蹤</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            預設只顯示目前登入者自己送出的表單，讓每個人都能連貫追蹤自己的申請、簽核軌跡與操作紀錄。
          </p>
          {dataMessage ? <p className="mt-2 text-sm font-semibold text-rose-700">{dataMessage}</p> : null}
        </div>
        <Button asChild><Link href="/requests/new">新增申請</Link></Button>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          { label: "簽核中", value: summary.active, detail: "等待主管或人資處理", icon: Hourglass, tone: "bg-[#fff3de] text-[#8a4b06]" },
          { label: "被退回", value: summary.returned, detail: "需要你補件", icon: AlertTriangle, tone: "bg-violet-50 text-violet-700" },
          { label: "已核准", value: summary.approved, detail: "流程完成", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "草稿", value: summary.drafts, detail: "尚未送出", icon: FileText, tone: "bg-slate-100 text-slate-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
              <span className="text-2xl font-black text-slate-950">{item.value}</span>
            </div>
            <p className="mt-3 font-black text-slate-950">{item.label}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold tracking-[0.12em] text-[#b45309]">TRACKING SCOPE</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {scopes.map((scope) => {
              const disabled = scope === "公司表單" && !canViewCompanyForms;
              return (
                <button
                  key={scope}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActiveScope(scope)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeScope === scope ? "border-[#d97706] bg-[#fff3de] text-[#8a4b06]" : "border-[#ead8c2] bg-white text-slate-600"
                  }`}
                >
                  {scope}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold tracking-[0.12em] text-[#b45309]">CURRENT USER</p>
          <p className="mt-2 text-lg font-black text-slate-950">{currentUser.name}</p>
          <p className="mt-1 text-sm text-slate-500">{currentUser.roleLabel} · {currentUser.email}</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-[1fr_280px]">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${
                activeTab === tab ? "border-[#d97706] bg-[#fff3de] text-[#8a4b06]" : "border-[#ead8c2] bg-white text-slate-600"
              }`}
            >
              {tab} <span className="ml-1 opacity-70">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-lg border border-[#dfc9b1] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#d97706]"
            placeholder="搜尋表單"
          />
        </label>
      </section>

      <section className="grid gap-4">
        {visibleRequests.map((request) => {
          const isMine = request.applicantId === currentUser.id;
          const progress = getProgress(request);
          const nextActionText = getNextActionText(request, isMine);
          const currentOwnerText = getCurrentOwnerText(request, isMine);
          const trackingHeadline = getTrackingHeadline(request, isMine);
          const trackingSubtext = getTrackingSubtext(request, isMine);
          const remainingStops = getRemainingStops(request);
          const nextStop = getNextStop(request);
          const trackingEta = getTrackingEta(request);

          return (
          <article key={request.id} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className={`mb-4 rounded-lg border p-4 ${statusStyle(request.status)}`}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-white/70 p-2">
                    <Package className="h-5 w-5 shrink-0" />
                  </span>
                  <div>
                    <div className="text-xs font-black tracking-[0.12em]">TRACKING NO. {request.requestNo ?? request.id}</div>
                    <div className="mt-1 text-xl font-black">{trackingHeadline}</div>
                    <div className="mt-1 text-sm opacity-80">{trackingSubtext}</div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[520px]">
                  <div className="rounded-lg bg-white/70 px-3 py-2">
                    <div className="text-[11px] font-black tracking-[0.1em] opacity-70">目前站點</div>
                    <div className="mt-1 text-sm font-black">{currentOwnerText}</div>
                  </div>
                  <div className="rounded-lg bg-white/70 px-3 py-2">
                    <div className="text-[11px] font-black tracking-[0.1em] opacity-70">下一站</div>
                    <div className="mt-1 text-sm font-black">{nextStop}</div>
                  </div>
                  <div className="rounded-lg bg-white/70 px-3 py-2">
                    <div className="text-[11px] font-black tracking-[0.1em] opacity-70">預估進度</div>
                    <div className="mt-1 text-sm font-black">{trackingEta}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs font-bold">
                  <span className="inline-flex items-center gap-1">
                    <Route className="h-3.5 w-3.5" />
                    配送進度
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/70">
                  <div className="h-2 rounded-full bg-current" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-white/70 px-3 py-1">申請日：{request.submittedAt || "尚未送出"}</span>
                <span className="rounded-full bg-white/70 px-3 py-1">剩餘關卡：{remainingStops}</span>
                <span className="rounded-full bg-white/70 px-3 py-1">下一步：{nextActionText}</span>
                <span className="rounded-full bg-white/70 px-3 py-1">{getAttachmentLabel(request.attachmentStatus)}</span>
                <span className="rounded-full bg-white/70 px-3 py-1">{getIntegrationLabel(request.integrationStatus)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#fff3de] px-3 py-1 text-xs font-black text-[#8a4b06]">{request.formTitle ?? request.type}</span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusStyle(request.status)}`}>{request.status}</span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                    {isMine ? "我的表單" : "公司表單"}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyRequestId(request.requestNo ?? request.id)}
                    className="rounded-full border border-[#ead8c2] bg-white px-3 py-1 text-xs font-bold text-slate-500 transition hover:border-[#d97706] hover:text-[#8a4b06]"
                  >
                    複製追蹤號
                  </button>
                </div>
                <h2 className="mt-3 text-lg font-black text-slate-900">{request.date}</h2>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">{request.reason}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>申請人：{request.applicant}</span>
                  <span>部門：{request.department}</span>
                  <span>據點：{request.branch}</span>
                  <span>附件：{request.attachmentNames.length ? request.attachmentNames.join("、") : "無"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copyRequestId(request.requestNo ?? request.id)}>
                  複製編號
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  列印
                </Button>
                {request.status === "草稿" && isMine ? (
                  <Button size="sm" asChild>
                    <Link href={`${formHref(request)}?draftId=${request.id}`}>續填草稿</Link>
                  </Button>
                ) : null}
                {request.status === "被退回" && isMine ? (
                  <Button
                    size="sm"
                    onClick={() => updateRequest(request.id, {
                      status: "待我簽核",
                      currentStep: "申請人主管",
                      currentOwnerRole: "supervisor",
                      revisionNo: (request.revisionNo ?? 1) + 1,
                      returnReason: undefined,
                      integrationStatus: "pending",
                      lastActionAt: new Date().toLocaleString("zh-TW", { hour12: false }),
                    })}
                  >
                    <RotateCcw className="h-4 w-4" />
                    補件重送
                  </Button>
                ) : null}
                {["草稿", "待我簽核", "簽核中", "被退回"].includes(request.status) && isMine ? (
                  <Button size="sm" variant="outline" onClick={() => updateRequest(request.id, { status: "已取消", currentStep: "申請人取消", currentOwnerRole: "done", integrationStatus: "not_required" })}>
                    <XCircle className="h-4 w-4" />
                    取消
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_320px]">
              <div className="space-y-3">
                <div className="rounded-lg border border-[#ead8c2] bg-white p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                      <Truck className="h-4 w-4 text-[#b45309]" />
                      表單配送歷程
                    </div>
                    <span className="rounded-full bg-[#fffaf4] px-3 py-1 text-xs font-bold text-[#8a4b06]">
                      固定路線：申請人 → 主管 → 部門主管 → 行政主任 → 人資 → 申請人
                    </span>
                  </div>
                  <div className="relative space-y-3">
                    <div className="absolute bottom-5 left-4 top-5 hidden w-px bg-[#ead8c2] sm:block" />
                    {request.timeline.map((step, index) => {
                      const meta = getMilestoneMeta(step.state);
                      const MilestoneIcon = meta.icon;
                      const isLast = index === request.timeline.length - 1;

                      return (
                        <div key={`${request.id}-${step.step}-${index}`} className="relative flex gap-3">
                          <span className={`z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.dotClassName}`}>
                            <MilestoneIcon className="h-4 w-4" />
                          </span>
                          <div className={`flex-1 rounded-lg border px-3 py-3 ${meta.className}`}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="text-[11px] font-black tracking-[0.12em] opacity-70">
                                  第 {index + 1} 站{isLast ? " · 終點" : ""}
                                </div>
                                <div className="mt-1 text-sm font-black">{step.step}</div>
                              </div>
                              <span className="w-fit rounded-full bg-white/70 px-3 py-1 text-xs font-black">
                                {meta.label}
                              </span>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                              <span>處理角色：{step.ownerLabel}</span>
                              <span>時間：{step.actedAt ?? (step.state === "current" ? "處理中" : "尚未到站")}</span>
                              <span>備註：{step.comment ?? (step.state === "current" ? getNextActionText(request, isMine) : "無")}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(request.details).slice(0, 6).map(([key, value]) => (
                    <div key={key} className="rounded-lg bg-[#fffaf4] p-3">
                      <div className="text-xs font-bold text-slate-400">{key}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{value || "未填寫"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg bg-[#fffaf4] p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800">
                    <PackageCheck className="h-4 w-4 text-[#b45309]" />
                    追蹤摘要
                  </div>
                  <div className="grid gap-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>正式單號</span>
                      <span className="font-black text-slate-900">{request.requestNo ?? request.id}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>目前站點</span>
                      <span className="font-black text-slate-900">{currentOwnerText}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>下一站</span>
                      <span className="font-black text-slate-900">{nextStop}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>狀態</span>
                      <span className="font-black text-slate-900">{request.status}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>附件</span>
                      <span className="font-black text-slate-900">{getAttachmentLabel(request.attachmentStatus)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>資料連動</span>
                      <span className="font-black text-slate-900">{getIntegrationLabel(request.integrationStatus)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                      <span>版本</span>
                      <span className="font-black text-slate-900">第 {request.revisionNo ?? 1} 版</span>
                    </div>
                    {request.returnReason ? (
                      <div className="rounded-md bg-violet-50 px-3 py-2 text-violet-700">
                        退回原因：{request.returnReason}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-lg bg-[#fffaf4] p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800">
                    <Clock3 className="h-4 w-4 text-[#b45309]" />
                    操作紀錄
                  </div>
                  <div className="space-y-2 text-xs text-slate-500">
                    {request.auditLogs.slice(-4).map((log) => (
                      <div key={log} className="rounded-md bg-white px-3 py-2">{log}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </article>
          );
        })}
        {visibleRequests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#dfc9b1] bg-white p-10 text-center">
            <FileText className="mx-auto h-9 w-9 text-slate-400" />
            <p className="mt-3 font-bold text-slate-700">目前沒有符合條件的表單</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
