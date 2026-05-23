"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FilePenLine,
  GitFork,
  GitMerge,
  GitPullRequestArrow,
  Hourglass,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FinanceStyleApprovalFlow } from "@/components/workflow/finance-style-approval-flow";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type FlowMode = "固定串簽";
type RequestType = "請假" | "加班" | "補卡" | "換班" | "人事異動" | "薪資調整";
type FlowStatus = "啟用" | "草稿" | "停用";
type StepType = "申請人" | "申請人主管" | "申請人部門主管" | "行政部門主任" | "人資";
type ApprovalRequestType = "leave" | "overtime" | "punch_correction" | "document" | "license" | "training" | "payroll" | "general";
type ApproverPolicy = "direct_manager" | "department_manager" | "branch_manager" | "role" | "employee" | "hr" | "accounting";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type ApprovalStep = {
  order: number;
  name: string;
  stepType: StepType;
  approver: string;
  mode: "串簽" | "會簽";
  canReturnForSupplement: boolean;
};

type ApprovalFlow = {
  id: string;
  dbFlowIds: string[];
  name: string;
  mode: FlowMode;
  requestTypes: RequestType[];
  departmentRule: string;
  amountRule: string;
  requestTypeRule: string;
  proxyEnabled: boolean;
  returnForSupplement: boolean;
  status: FlowStatus;
  steps: ApprovalStep[];
  updatedAt: string;
};

type ApprovalFlowRow = {
  id: string;
  company_id: string;
  name: string;
  request_type: ApprovalRequestType;
  applies_to: {
    uiGroupId?: string;
    requestTypes?: RequestType[];
    mode?: FlowMode;
    departmentRule?: string;
    amountRule?: string;
    requestTypeRule?: string;
    proxyEnabled?: boolean;
    returnForSupplement?: boolean;
    uiStatus?: FlowStatus;
  } | null;
  is_active: boolean;
  updated_at: string;
  approval_steps?: ApprovalStepRow[];
};

const flowStepDescriptions: Record<string, string> = {
  申請人: "申請人建立表單、填寫原因與附件，送出後正式開始簽核流程。",
  申請人主管: "確認申請內容是否合理、是否影響部門人力與工作交接。",
  申請人部門主管: "確認部門制度、跨組別影響與人力配置，避免重複或越權核准。",
  行政部門主任: "確認行政流程、附件完整性、制度版本與公司內控需求。",
  人資: "確認假勤、出勤、薪資與法規底線，必要時回寫員工主檔與紀錄。",
  申請人確認: "流程完成後由申請人確認結果，後續可在表單追蹤查看完整紀錄。",
};

type ApprovalStepRow = {
  id: string;
  approval_flow_id: string;
  step_order: number;
  step_name: string;
  approver_policy: ApproverPolicy;
  is_required: boolean;
};

type FlowForm = {
  name: string;
  mode: FlowMode;
  requestTypes: RequestType[];
  departmentRule: string;
  amountRule: string;
  requestTypeRule: string;
  proxyEnabled: boolean;
  returnForSupplement: boolean;
};

const flowModes: Array<{ mode: FlowMode; icon: LucideIcon; description: string }> = [
  { mode: "固定串簽", icon: GitPullRequestArrow, description: "所有表單一律依申請人、主管、部門主管、行政部門主任、人資、申請人推進。" },
];

const requestTypes: RequestType[] = ["請假", "加班", "補卡", "換班", "人事異動", "薪資調整"];

const requestTypeToDb: Record<RequestType, ApprovalRequestType> = {
  請假: "leave",
  加班: "overtime",
  補卡: "punch_correction",
  換班: "general",
  人事異動: "general",
  薪資調整: "payroll",
};

const dbRequestTypeToLabel: Record<ApprovalRequestType, RequestType> = {
  leave: "請假",
  overtime: "加班",
  punch_correction: "補卡",
  document: "人事異動",
  license: "人事異動",
  training: "人事異動",
  payroll: "薪資調整",
  general: "換班",
};

const stepPolicyMap: Record<StepType, ApproverPolicy> = {
  申請人: "employee",
  申請人主管: "direct_manager",
  申請人部門主管: "department_manager",
  行政部門主任: "role",
  人資: "hr",
};

const defaultForm: FlowForm = {
  name: "長照人資標準簽核流程",
  mode: "固定串簽",
  requestTypes: ["請假", "加班", "補卡", "換班", "人事異動", "薪資調整"],
  departmentRule: "依員工主要部門決定直屬主管與部門主管",
  amountRule: "所有金額與類型皆不改變固定簽核順序，可在關卡內顯示提醒。",
  requestTypeRule: "所有表單一律走：申請人 → 申請人主管 → 申請人部門主管 → 行政部門主任 → 人資 → 申請人。",
  proxyEnabled: true,
  returnForSupplement: true,
};

const initialFlows: ApprovalFlow[] = [
  {
    id: "AF-001",
    dbFlowIds: [],
    name: "全表單固定簽核流程",
    mode: "固定串簽",
    requestTypes: ["請假", "加班", "補卡", "換班", "人事異動", "薪資調整"],
    departmentRule: "依申請人主要歸屬帶入申請人主管與申請人部門主管。",
    amountRule: "不因金額改變流程，金額風險改以提示或關卡備註呈現。",
    requestTypeRule: "申請人 → 申請人主管 → 申請人部門主管 → 行政部門主任 → 人資 → 申請人。",
    proxyEnabled: true,
    returnForSupplement: true,
    status: "啟用",
    updatedAt: "2026-05-18 10:20",
    steps: [
      { order: 1, name: "申請人", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
      { order: 2, name: "申請人主管", stepType: "申請人主管", approver: "系統依申請人帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 3, name: "申請人部門主管", stepType: "申請人部門主管", approver: "系統依部門帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 4, name: "行政部門主任", stepType: "行政部門主任", approver: "行政部門主任", mode: "串簽", canReturnForSupplement: true },
      { order: 5, name: "人資", stepType: "人資", approver: "人資主管 / 人資人員", mode: "串簽", canReturnForSupplement: true },
      { order: 6, name: "申請人確認", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
    ],
  },
  {
    id: "AF-002",
    dbFlowIds: [],
    name: "薪資調整條件式流程",
    mode: "固定串簽",
    requestTypes: ["薪資調整", "人事異動"],
    departmentRule: "依申請人部門加簽部門最高主管。",
    amountRule: "金額 >= 10000 元加簽總經理；金額 >= 30000 元需會計與總經理會簽。",
    requestTypeRule: "仍套用固定簽核流程，不因薪資調整或人事異動改變順序。",
    proxyEnabled: true,
    returnForSupplement: true,
    status: "啟用",
    updatedAt: "2026-05-18 11:05",
    steps: [
      { order: 1, name: "申請人", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
      { order: 2, name: "申請人主管", stepType: "申請人主管", approver: "系統依申請人帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 3, name: "申請人部門主管", stepType: "申請人部門主管", approver: "系統依部門帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 4, name: "行政部門主任", stepType: "行政部門主任", approver: "行政部門主任", mode: "串簽", canReturnForSupplement: true },
      { order: 5, name: "人資", stepType: "人資", approver: "人資主管 / 人資人員", mode: "串簽", canReturnForSupplement: true },
      { order: 6, name: "申請人確認", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
    ],
  },
  {
    id: "AF-003",
    dbFlowIds: [],
    name: "補卡與換班快速流程",
    mode: "固定串簽",
    requestTypes: ["補卡", "換班"],
    departmentRule: "依部門決定直屬主管。",
    amountRule: "不適用金額條件。",
    requestTypeRule: "補卡與換班也一律套用固定簽核流程。",
    proxyEnabled: false,
    returnForSupplement: true,
    status: "草稿",
    updatedAt: "2026-05-17 16:40",
    steps: [
      { order: 1, name: "申請人", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
      { order: 2, name: "申請人主管", stepType: "申請人主管", approver: "系統依申請人帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 3, name: "申請人部門主管", stepType: "申請人部門主管", approver: "系統依部門帶入", mode: "串簽", canReturnForSupplement: true },
      { order: 4, name: "行政部門主任", stepType: "行政部門主任", approver: "行政部門主任", mode: "串簽", canReturnForSupplement: true },
      { order: 5, name: "人資", stepType: "人資", approver: "人資主管 / 人資人員", mode: "串簽", canReturnForSupplement: true },
      { order: 6, name: "申請人確認", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
    ],
  },
];

const statusStyles: Record<FlowStatus, string> = {
  啟用: "border-emerald-200 bg-emerald-50 text-emerald-700",
  草稿: "border-amber-200 bg-amber-50 text-amber-700",
  停用: "border-slate-200 bg-slate-50 text-slate-600",
};

const modeStyles: Record<FlowMode, string> = {
  固定串簽: "bg-emerald-50 text-emerald-700",
};

function createDefaultSteps(): ApprovalStep[] {
  return [
    { order: 1, name: "申請人", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
    { order: 2, name: "申請人主管", stepType: "申請人主管", approver: "系統依申請人帶入", mode: "串簽", canReturnForSupplement: true },
    { order: 3, name: "申請人部門主管", stepType: "申請人部門主管", approver: "系統依部門帶入", mode: "串簽", canReturnForSupplement: true },
    { order: 4, name: "行政部門主任", stepType: "行政部門主任", approver: "行政部門主任", mode: "串簽", canReturnForSupplement: true },
    { order: 5, name: "人資", stepType: "人資", approver: "人資主管 / 人資人員", mode: "串簽", canReturnForSupplement: true },
    { order: 6, name: "申請人確認", stepType: "申請人", approver: "申請人本人", mode: "串簽", canReturnForSupplement: false },
  ];
}

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫簽核流程。");
  return supabase as unknown as SupabaseClient;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function mapStepRow(row: ApprovalStepRow): ApprovalStep {
  const stepType = row.step_name.includes("部門主管")
    ? "申請人部門主管"
    : row.step_name.includes("主管")
      ? "申請人主管"
      : row.step_name.includes("行政")
        ? "行政部門主任"
        : row.step_name.includes("人資")
          ? "人資"
          : "申請人";

  return {
    order: row.step_order,
    name: row.step_name,
    stepType,
    approver:
      row.approver_policy === "direct_manager"
        ? "系統依申請人帶入"
        : row.approver_policy === "department_manager"
          ? "系統依部門帶入"
          : row.approver_policy === "hr"
            ? "人資主管 / 人資人員"
            : row.approver_policy === "role"
              ? "行政部門主任"
              : "申請人本人",
    mode: "串簽",
    canReturnForSupplement: row.is_required,
  };
}

function mapFlowRows(rows: ApprovalFlowRow[]): ApprovalFlow[] {
  const grouped = new Map<string, ApprovalFlowRow[]>();
  rows.forEach((row) => {
    const groupId = row.applies_to?.uiGroupId ?? row.name;
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), row]);
  });

  return Array.from(grouped.entries()).map(([groupId, groupRows]) => {
    const first = groupRows[0];
    const requestTypes = first.applies_to?.requestTypes?.length
      ? first.applies_to.requestTypes
      : Array.from(new Set(groupRows.map((row) => dbRequestTypeToLabel[row.request_type])));
    const steps = first.approval_steps?.length
      ? [...first.approval_steps].sort((a, b) => a.step_order - b.step_order).map(mapStepRow)
      : createDefaultSteps();
    const active = groupRows.some((row) => row.is_active);

    return {
      id: groupId,
      dbFlowIds: groupRows.map((row) => row.id),
      name: first.name,
      mode: first.applies_to?.mode ?? "固定串簽",
      requestTypes,
      departmentRule: first.applies_to?.departmentRule ?? defaultForm.departmentRule,
      amountRule: first.applies_to?.amountRule ?? defaultForm.amountRule,
      requestTypeRule: first.applies_to?.requestTypeRule ?? defaultForm.requestTypeRule,
      proxyEnabled: first.applies_to?.proxyEnabled ?? true,
      returnForSupplement: first.applies_to?.returnForSupplement ?? true,
      status: active ? "啟用" : first.applies_to?.uiStatus === "草稿" ? "草稿" : "停用",
      steps,
      updatedAt: formatUpdatedAt(first.updated_at),
    };
  });
}

export default function ApprovalFlowsPage() {
  const currentUser = useCurrentUser();
  const [flows, setFlows] = useState<ApprovalFlow[]>([]);
  const [form, setForm] = useState<FlowForm>(defaultForm);
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("簽核流程會寫入 Supabase approval_flows / approval_steps。");

  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? flows[0] ?? initialFlows[0];

  const stats = useMemo(
    () => ({
      total: flows.length,
      active: flows.filter((flow) => flow.status === "啟用").length,
      proxy: flows.filter((flow) => flow.proxyEnabled).length,
      fixed: flows.filter((flow) => flow.mode === "固定串簽").length,
    }),
    [flows],
  );

  const toggleRequestType = (type: RequestType) => {
    setForm((current) => ({
      ...current,
      requestTypes: current.requestTypes.includes(type)
        ? current.requestTypes.filter((item) => item !== type)
        : [...current.requestTypes, type],
    }));
  };

  async function getCompanyId(supabase: SupabaseClient) {
    if (currentUser.companyId) return currentUser.companyId;
    const { data, error } = await supabase
      .from("companies")
      .select("id")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const companyId = (data as { id: string } | null)?.id;
    if (!companyId) throw new Error("找不到公司主檔，無法建立簽核流程。");
    return companyId;
  }

  async function loadFlows() {
    setLoading(true);
    try {
      const supabase = getClient();
      let query = supabase
        .from("approval_flows")
        .select(`
          id,
          company_id,
          name,
          request_type,
          applies_to,
          is_active,
          updated_at,
          approval_steps(
            id,
            approval_flow_id,
            step_order,
            step_name,
            approver_policy,
            is_required
          )
        `)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (currentUser.companyId && currentUser.role !== "ceo") {
        query = query.eq("company_id", currentUser.companyId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const nextFlows = mapFlowRows((data ?? []) as unknown as ApprovalFlowRow[]);
      setFlows(nextFlows);
      setSelectedFlowId((current) => (current && nextFlows.some((flow) => flow.id === current) ? current : nextFlows[0]?.id ?? ""));
      setMessage(nextFlows.length ? "簽核流程已從 Supabase 載入。" : "目前尚未建立簽核流程，請新增第一組流程。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "簽核流程載入失敗。");
      setFlows([]);
    } finally {
      setLoading(false);
    }
  }

  async function createFlow() {
    if (!form.name.trim() || form.requestTypes.length === 0) {
      setMessage("請填寫流程名稱並至少選擇一種申請類型。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const companyId = await getCompanyId(supabase);
      const groupId = crypto.randomUUID();
      const steps = createDefaultSteps();
      const uniqueDbTypes = Array.from(new Set(form.requestTypes.map((type) => requestTypeToDb[type])));
      const appliesTo = {
        uiGroupId: groupId,
        requestTypes: form.requestTypes,
        mode: form.mode,
        departmentRule: form.departmentRule,
        amountRule: form.amountRule,
        requestTypeRule: form.requestTypeRule,
        proxyEnabled: form.proxyEnabled,
        returnForSupplement: form.returnForSupplement,
        uiStatus: "草稿" as FlowStatus,
        source: "approval-flows-page",
      };

      const { data: insertedFlows, error: flowError } = await supabase
        .from("approval_flows")
        .upsert(
          uniqueDbTypes.map((requestType) => ({
            company_id: companyId,
            name: form.name.trim(),
            request_type: requestType,
            applies_to: appliesTo,
            is_active: false,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "company_id,request_type,name" },
        )
        .select("id");
      if (flowError) throw flowError;

      const flowIds = ((insertedFlows ?? []) as Array<{ id: string }>).map((item) => item.id);
      if (flowIds.length) {
        await supabase.from("approval_steps").update({ deleted_at: new Date().toISOString() }).in("approval_flow_id", flowIds);
        const { error: stepError } = await supabase.from("approval_steps").insert(
          flowIds.flatMap((flowId) =>
            steps.map((step) => ({
              approval_flow_id: flowId,
              step_order: step.order,
              step_name: step.name,
              approver_policy: stepPolicyMap[step.stepType],
              is_required: step.canReturnForSupplement,
            })),
          ),
        );
        if (stepError) throw stepError;
      }

      setForm(defaultForm);
      setMessage("流程已建立為草稿，並寫入 Supabase approval_flows / approval_steps。");
      await loadFlows();
      setSelectedFlowId(groupId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程建立失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlowStatus(id: string) {
    const flow = flows.find((item) => item.id === id);
    if (!flow) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const nextActive = flow.status !== "啟用";
      const { error } = await supabase
        .from("approval_flows")
        .update({
          is_active: nextActive,
          applies_to: {
            requestTypes: flow.requestTypes,
            mode: flow.mode,
            departmentRule: flow.departmentRule,
            amountRule: flow.amountRule,
            requestTypeRule: flow.requestTypeRule,
            proxyEnabled: flow.proxyEnabled,
            returnForSupplement: flow.returnForSupplement,
            uiGroupId: flow.id,
            uiStatus: nextActive ? "啟用" : "停用",
          },
          updated_at: new Date().toISOString(),
        })
        .in("id", flow.dbFlowIds);
      if (error) throw error;
      setMessage(`${flow.name} 已${nextActive ? "啟用" : "停用"}，並回寫 approval_flows.is_active。`);
      await loadFlows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流程狀態切換失敗。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadFlows();
  }, [currentUser.companyId, currentUser.role]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-violet-700">Workflow Engine</p>
          <h1 className="text-2xl font-semibold text-slate-950">簽核流程引擎</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            所有表單一律採固定串簽流程：申請人、申請人主管、申請人部門主管、行政部門主任、人資、申請人。新增與啟停會直接寫入 Supabase。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-violet-700">代理簽核</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">退回補件</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">自動套用流程</span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "流程模板", value: `${stats.total} 組`, icon: GitFork, tone: "bg-violet-50 text-violet-700" },
          { label: "啟用流程", value: `${stats.active} 組`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "代理簽核", value: `${stats.proxy} 組`, icon: RefreshCw, tone: "bg-sky-50 text-sky-700" },
          { label: "固定串簽", value: `${stats.fixed} 組`, icon: ArrowDownUp, tone: "bg-amber-50 text-amber-700" },
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

      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-800">
        {loading ? "正在從 Supabase 載入 approval_flows..." : saving ? "正在寫入 Supabase approval_flows / approval_steps..." : message}
      </div>

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">建立流程模板</h2>
              <p className="text-sm text-slate-500">設定固定串簽流程適用申請類型、簽核人帶入規則、代理簽核與退回補件。</p>
            </div>
            <Plus className="h-5 w-5 text-violet-600" />
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              流程名稱
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              簽核模式
              <select
                value={form.mode}
                onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value as FlowMode }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {flowModes.map((item) => (
                  <option key={item.mode}>{item.mode}</option>
                ))}
              </select>
            </label>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">可套用申請類型</p>
              <div className="grid grid-cols-2 gap-2">
                {requestTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.requestTypes.includes(type)}
                      onChange={() => toggleRequestType(type)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              依部門決定簽核人
              <textarea
                value={form.departmentRule}
                onChange={(event) => setForm((current) => ({ ...current, departmentRule: event.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              金額與風險提醒
              <textarea
                value={form.amountRule}
                onChange={(event) => setForm((current) => ({ ...current, amountRule: event.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              固定流程說明
              <textarea
                value={form.requestTypeRule}
                onChange={(event) => setForm((current) => ({ ...current, requestTypeRule: event.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.proxyEnabled}
                  onChange={(event) => setForm((current) => ({ ...current, proxyEnabled: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                代理簽核
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.returnForSupplement}
                  onChange={(event) => setForm((current) => ({ ...current, returnForSupplement: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                退回補件
              </label>
            </div>
          </div>

          <button
            onClick={createFlow}
            disabled={saving || loading}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            <Send className="h-4 w-4" />
            {saving ? "寫入中..." : "建立流程"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">簽核模式能力</h2>
              <p className="text-sm text-slate-500">流程引擎目前依需求固定為同一條串簽線，避免不同表單流程不一致。</p>
            </div>
            <GitMerge className="h-5 w-5 text-violet-600" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flowModes.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.mode} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-white p-2 text-violet-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <p className="font-semibold text-slate-950">{item.mode}</p>
                  </div>
                  <p className="mt-3 text-sm text-slate-500">{item.description}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-950">固定流程規則摘要</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-sky-50 p-3">
                <Building2 className="h-5 w-5 text-sky-700" />
                <p className="mt-2 text-sm font-semibold text-sky-900">依部門決定主管</p>
                <p className="mt-1 text-xs text-sky-700">依申請人歸屬帶出申請人主管與申請人部門主管。</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <BadgeDollarSign className="h-5 w-5 text-amber-700" />
                <p className="mt-2 text-sm font-semibold text-amber-900">金額只做提醒</p>
                <p className="mt-1 text-xs text-amber-700">費用或薪資調整不改變流程，只在關卡內顯示風險提示。</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <ClipboardCheck className="h-5 w-5 text-emerald-700" />
                <p className="mt-2 text-sm font-semibold text-emerald-900">所有類型同流程</p>
                <p className="mt-1 text-xs text-emerald-700">請假、加班、補卡、換班、人事異動、薪資調整都套用固定流程。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">流程模板清單</h2>
            <p className="text-sm text-slate-500">所有表單流程固定一致，可套用在請假、加班、補卡、換班、人事異動、薪資調整。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">流程</th>
                  <th className="px-4 py-3">模式</th>
                  <th className="px-4 py-3">適用類型</th>
                  <th className="px-4 py-3">條件規則</th>
                  <th className="px-4 py-3">代理 / 補件</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flows.map((flow) => (
                  <tr key={flow.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <button onClick={() => setSelectedFlowId(flow.id)} className="text-left">
                        <p className="font-semibold text-slate-950">{flow.name}</p>
                        <p className="text-xs text-slate-500">{flow.id} · {flow.updatedAt}</p>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${modeStyles[flow.mode]}`}>{flow.mode}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-xs flex-wrap gap-1.5">
                        {flow.requestTypes.map((type) => (
                          <span key={`${flow.id}-${type}`} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                            {type}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-sm text-xs text-slate-600">{flow.departmentRule}</p>
                      <p className="mt-1 max-w-sm text-xs text-slate-500">{flow.amountRule}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <span className={`block rounded-full px-2.5 py-1 text-center text-xs font-semibold ${flow.proxyEnabled ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-500"}`}>
                          {flow.proxyEnabled ? "代理簽核" : "無代理"}
                        </span>
                        <span className={`block rounded-full px-2.5 py-1 text-center text-xs font-semibold ${flow.returnForSupplement ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {flow.returnForSupplement ? "退回補件" : "不可補件"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[flow.status]}`}>{flow.status}</span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => toggleFlowStatus(flow.id)}
                        disabled={saving || loading}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {flow.status === "啟用" ? "停用" : "啟用"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!flows.length ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm font-semibold text-slate-500" colSpan={7}>
                      {loading ? "正在載入流程..." : "尚未建立流程，請從左側新增第一組流程。"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FilePenLine className="h-5 w-5 text-violet-700" />
              <h2 className="text-lg font-semibold text-slate-950">流程步驟預覽</h2>
            </div>
            <p className="text-sm font-semibold text-slate-800">{selectedFlow.name}</p>
            <div className="mt-4">
              <FinanceStyleApprovalFlow
                compact
                steps={selectedFlow.steps.map((step) => ({
                  label: step.name,
                  detail: `${flowStepDescriptions[step.name] ?? step.approver} 簽核人：${step.approver}。${step.canReturnForSupplement ? "可退回補件。" : "不可退回補件。"}`,
                  state: "pending",
                  comment: step.mode,
                }))}
              />
            </div>
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-sky-700" />
              <h2 className="font-semibold text-sky-900">代理簽核</h2>
            </div>
            <p className="text-sm text-sky-800">簽核人請假、離職或逾時未處理時，可依代理人設定轉派，並保留代理簽核紀錄。</p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">退回補件</h2>
            </div>
            <p className="text-sm text-amber-800">簽核人可退回申請，要求補充附件、原因或資料；申請人補件後回到原關卡續審。</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Hourglass className="h-5 w-5 text-slate-700" />
              <h2 className="font-semibold text-slate-950">引擎套用順序</h2>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>1. 申請人送出表單。</p>
              <p>2. 系統帶入申請人主管與申請人部門主管。</p>
              <p>3. 固定送行政部門主任與人資。</p>
              <p>4. 最後回到申請人確認。</p>
              <p>5. 補件後回到退回前關卡。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
