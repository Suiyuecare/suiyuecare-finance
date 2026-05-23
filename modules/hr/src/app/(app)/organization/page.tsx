"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  Edit3,
  GitBranch,
  Loader2,
  MapPin,
  Network,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // Keep organization CRUD tolerant until the generated type is refreshed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type CompanyStatus = "active" | "inactive" | "suspended";
type BranchStatus = "active" | "inactive" | "closed";
type OrgStatus = "active" | "inactive";
type BranchType = "headquarters" | "branch" | "site" | "homecare_station" | "daycare_center";
type DepartmentType = "administration" | "hr" | "finance" | "homecare" | "daycare" | "operations" | "support";
type EmploymentType = "full_time" | "part_time" | "contract" | "intern" | "temporary";
type EntityKind = "company" | "branch" | "department" | "position";

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  status: CompanyStatus;
  address: { line1?: string; city?: string } | null;
};

type BranchRow = {
  id: string;
  company_id: string;
  parent_branch_id: string | null;
  code: string;
  name: string;
  branch_type: BranchType;
  phone: string | null;
  email: string | null;
  status: BranchStatus;
  address: { line1?: string; city?: string } | null;
};

type DepartmentRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  parent_department_id: string | null;
  code: string;
  name: string;
  department_type: DepartmentType;
  status: OrgStatus;
};

type PositionRow = {
  id: string;
  company_id: string;
  department_id: string | null;
  code: string;
  title: string;
  level: string | null;
  employment_type: EmploymentType;
  is_manager: boolean;
  status: OrgStatus;
};

type EmployeeCountRow = {
  company_id: string | null;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  position_id: string | null;
};

type OrganizationState = {
  companies: CompanyRow[];
  branches: BranchRow[];
  departments: DepartmentRow[];
  positions: PositionRow[];
  employeeCounts: EmployeeCountRow[];
};

type OrgNode = {
  id: string;
  name: string;
  meta?: string;
  children?: OrgNode[];
};

type SummaryCard = {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
};

const emptyState: OrganizationState = {
  companies: [],
  branches: [],
  departments: [],
  positions: [],
  employeeCounts: [],
};

const branchTypeLabels: Record<BranchType, string> = {
  headquarters: "總部",
  branch: "分店",
  site: "據點",
  homecare_station: "居服站",
  daycare_center: "日照中心",
};

const departmentTypeLabels: Record<DepartmentType, string> = {
  administration: "行政",
  hr: "人資",
  finance: "會計",
  homecare: "居家服務",
  daycare: "日照中心",
  operations: "營運",
  support: "支援",
};

const employmentTypeLabels: Record<EmploymentType, string> = {
  full_time: "全職",
  part_time: "兼職",
  contract: "約聘",
  intern: "實習",
  temporary: "臨時",
};

const companyStatusLabels: Record<CompanyStatus, string> = {
  active: "營運中",
  inactive: "停用",
  suspended: "暫停",
};

const branchStatusLabels: Record<BranchStatus, string> = {
  active: "啟用",
  inactive: "停用",
  closed: "關閉",
};

const orgStatusLabels: Record<OrgStatus, string> = {
  active: "啟用",
  inactive: "停用",
};

const defaultCompanyForm = {
  code: "",
  name: "",
  legal_name: "",
  tax_id: "",
  phone: "",
  email: "",
  address: "",
  status: "active" as CompanyStatus,
};

const defaultBranchForm = {
  company_id: "",
  parent_branch_id: "",
  code: "",
  name: "",
  branch_type: "branch" as BranchType,
  phone: "",
  email: "",
  address: "",
  status: "active" as BranchStatus,
};

const defaultDepartmentForm = {
  company_id: "",
  branch_id: "",
  parent_department_id: "",
  code: "",
  name: "",
  department_type: "administration" as DepartmentType,
  status: "active" as OrgStatus,
};

const defaultPositionForm = {
  company_id: "",
  department_id: "",
  code: "",
  title: "",
  level: "",
  employment_type: "full_time" as EmploymentType,
  is_manager: false,
  status: "active" as OrgStatus,
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫組織資料。");
  return supabase as unknown as SupabaseClient;
}

function countBy<T extends keyof EmployeeCountRow>(rows: EmployeeCountRow[], key: T, id: string) {
  return rows.filter((row) => row[key] === id).length;
}

function addressText(address: { line1?: string; city?: string } | null) {
  if (!address) return "";
  return [address.city, address.line1].filter(Boolean).join("") || "";
}

function toAddress(value: string) {
  return value.trim() ? { line1: value.trim() } : {};
}

function getCompanyName(companies: CompanyRow[], id: string | null) {
  return companies.find((company) => company.id === id)?.name ?? "未設定公司";
}

function getBranchName(branches: BranchRow[], id: string | null) {
  return branches.find((branch) => branch.id === id)?.name ?? "未設定據點";
}

function getDepartmentName(departments: DepartmentRow[], id: string | null) {
  return departments.find((department) => department.id === id)?.name ?? "未設定部門";
}

function statusClassName(status: string) {
  if (status === "active") return "bg-emerald-600 text-white";
  if (status === "closed" || status === "suspended") return "bg-rose-600 text-white";
  return "bg-slate-500 text-white";
}

function buildOrgTree(state: OrganizationState): OrgNode[] {
  return state.companies.map((company) => {
    const companyBranches = state.branches.filter((branch) => branch.company_id === company.id);
    const companyDepartments = state.departments.filter((department) => department.company_id === company.id);

    return {
      id: company.id,
      name: company.name,
      meta: `${company.code} / ${companyStatusLabels[company.status]}`,
      children: companyBranches.map((branch) => {
        const branchDepartments = companyDepartments.filter((department) => department.branch_id === branch.id);

        return {
          id: branch.id,
          name: branch.name,
          meta: branchTypeLabels[branch.branch_type],
          children: branchDepartments.map((department) => {
            const departmentPositions = state.positions.filter((position) => position.department_id === department.id);

            return {
              id: department.id,
              name: department.name,
              meta: departmentTypeLabels[department.department_type],
              children: departmentPositions.map((position) => ({
                id: position.id,
                name: position.title,
                meta: `${position.level || "未設職等"} / ${employmentTypeLabels[position.employment_type]}`,
              })),
            };
          }),
        };
      }),
    };
  });
}

function TreeNode({ node, level = 0 }: { node: OrgNode; level?: number }) {
  return (
    <div className="relative">
      <div
        className={`flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm ${
          level === 0 ? "border-primary bg-primary text-primary-foreground" : ""
        }`}
      >
        <Network className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-black">{node.name}</div>
          {node.meta ? <div className="mt-0.5 text-xs opacity-75">{node.meta}</div> : null}
        </div>
      </div>
      {node.children?.length ? (
        <div className="ml-5 mt-3 space-y-3 border-l pl-4">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export default function OrganizationPage() {
  const [state, setState] = useState<OrganizationState>(emptyState);
  const [activeKind, setActiveKind] = useState<EntityKind>("company");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("組織資料會直接串接 Supabase，新增與編輯後會影響員工、簽核、排班與報表。");
  const [companyForm, setCompanyForm] = useState(defaultCompanyForm);
  const [branchForm, setBranchForm] = useState(defaultBranchForm);
  const [departmentForm, setDepartmentForm] = useState(defaultDepartmentForm);
  const [positionForm, setPositionForm] = useState(defaultPositionForm);

  const orgTree = useMemo(() => buildOrgTree(state), [state]);
  const normalizedQuery = query.trim().toLowerCase();

  const summaryCards: SummaryCard[] = [
    { label: "公司管理", value: String(state.companies.length), icon: Building2, hint: "法人、稅籍與系統歸屬" },
    { label: "據點管理", value: String(state.branches.length), icon: MapPin, hint: "總部、居服站、日照中心" },
    { label: "部門管理", value: String(state.departments.length), icon: UsersRound, hint: "部門、團隊與人力編制" },
    { label: "職稱管理", value: String(state.positions.length), icon: BriefcaseBusiness, hint: "職稱、職等與主管職" },
  ];

  const filteredCompanies = state.companies.filter((item) =>
    [item.code, item.name, item.legal_name, item.tax_id].some((value) => value?.toLowerCase().includes(normalizedQuery)),
  );
  const filteredBranches = state.branches.filter((item) =>
    [item.code, item.name, branchTypeLabels[item.branch_type], getCompanyName(state.companies, item.company_id)].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
  const filteredDepartments = state.departments.filter((item) =>
    [item.code, item.name, departmentTypeLabels[item.department_type], getBranchName(state.branches, item.branch_id)].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
  const filteredPositions = state.positions.filter((item) =>
    [item.code, item.title, item.level, employmentTypeLabels[item.employment_type], getDepartmentName(state.departments, item.department_id)].some((value) =>
      value?.toLowerCase().includes(normalizedQuery),
    ),
  );

  async function loadOrganization() {
    setLoading(true);
    try {
      const supabase = getClient();
      const [companiesResult, branchesResult, departmentsResult, positionsResult, employeesResult] = await Promise.all([
        supabase.from("companies").select("id, code, name, legal_name, tax_id, phone, email, address, status").is("deleted_at", null).order("code"),
        supabase.from("branches").select("id, company_id, parent_branch_id, code, name, branch_type, phone, email, address, status").is("deleted_at", null).order("code"),
        supabase.from("departments").select("id, company_id, branch_id, parent_department_id, code, name, department_type, status").is("deleted_at", null).order("code"),
        supabase.from("positions").select("id, company_id, department_id, code, title, level, employment_type, is_manager, status").is("deleted_at", null).order("code"),
        supabase.from("employees").select("company_id, primary_branch_id, primary_department_id, position_id").is("deleted_at", null),
      ]);

      const firstError = [companiesResult, branchesResult, departmentsResult, positionsResult, employeesResult].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      setState({
        companies: (companiesResult.data ?? []) as CompanyRow[],
        branches: (branchesResult.data ?? []) as BranchRow[],
        departments: (departmentsResult.data ?? []) as DepartmentRow[],
        positions: (positionsResult.data ?? []) as PositionRow[],
        employeeCounts: (employeesResult.data ?? []) as EmployeeCountRow[],
      });
      setMessage("組織資料已從 Supabase 載入。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "組織資料載入失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrganization();
  }, []);

  function startCreate(kind: EntityKind) {
    setActiveKind(kind);
    setEditingId(null);
    const firstCompanyId = state.companies[0]?.id ?? "";
    const firstBranchId = state.branches.find((branch) => branch.company_id === firstCompanyId)?.id ?? "";
    const firstDepartmentId = state.departments.find((department) => department.company_id === firstCompanyId)?.id ?? "";

    if (kind === "company") setCompanyForm(defaultCompanyForm);
    if (kind === "branch") setBranchForm({ ...defaultBranchForm, company_id: firstCompanyId });
    if (kind === "department") setDepartmentForm({ ...defaultDepartmentForm, company_id: firstCompanyId, branch_id: firstBranchId });
    if (kind === "position") setPositionForm({ ...defaultPositionForm, company_id: firstCompanyId, department_id: firstDepartmentId });
  }

  function startEdit(kind: EntityKind, id: string) {
    setActiveKind(kind);
    setEditingId(id);

    if (kind === "company") {
      const item = state.companies.find((company) => company.id === id);
      if (!item) return;
      setCompanyForm({
        code: item.code,
        name: item.name,
        legal_name: item.legal_name ?? "",
        tax_id: item.tax_id ?? "",
        phone: item.phone ?? "",
        email: item.email ?? "",
        address: addressText(item.address),
        status: item.status,
      });
    }

    if (kind === "branch") {
      const item = state.branches.find((branch) => branch.id === id);
      if (!item) return;
      setBranchForm({
        company_id: item.company_id,
        parent_branch_id: item.parent_branch_id ?? "",
        code: item.code,
        name: item.name,
        branch_type: item.branch_type,
        phone: item.phone ?? "",
        email: item.email ?? "",
        address: addressText(item.address),
        status: item.status,
      });
    }

    if (kind === "department") {
      const item = state.departments.find((department) => department.id === id);
      if (!item) return;
      setDepartmentForm({
        company_id: item.company_id,
        branch_id: item.branch_id ?? "",
        parent_department_id: item.parent_department_id ?? "",
        code: item.code,
        name: item.name,
        department_type: item.department_type,
        status: item.status,
      });
    }

    if (kind === "position") {
      const item = state.positions.find((position) => position.id === id);
      if (!item) return;
      setPositionForm({
        company_id: item.company_id,
        department_id: item.department_id ?? "",
        code: item.code,
        title: item.title,
        level: item.level ?? "",
        employment_type: item.employment_type,
        is_manager: item.is_manager,
        status: item.status,
      });
    }
  }

  function validateRequired(fields: Record<string, string>, labels: Record<string, string>) {
    const missing = Object.entries(fields).find(([, value]) => !value.trim());
    if (!missing) return null;
    return `${labels[missing[0]]}為必填。`;
  }

  async function saveActiveEntity() {
    setSaving(true);
    try {
      const supabase = getClient();
      const now = new Date().toISOString();

      if (activeKind === "company") {
        const validation = validateRequired({ code: companyForm.code, name: companyForm.name }, { code: "公司代碼", name: "公司名稱" });
        if (validation) throw new Error(validation);
        const payload = {
          code: companyForm.code.trim(),
          name: companyForm.name.trim(),
          legal_name: companyForm.legal_name.trim() || null,
          tax_id: companyForm.tax_id.trim() || null,
          phone: companyForm.phone.trim() || null,
          email: companyForm.email.trim() || null,
          address: toAddress(companyForm.address),
          status: companyForm.status,
          updated_at: now,
        };
        const result = editingId
          ? await supabase.from("companies").update(payload).eq("id", editingId)
          : await supabase.from("companies").insert(payload);
        if (result.error) throw result.error;
      }

      if (activeKind === "branch") {
        const validation = validateRequired({ company_id: branchForm.company_id, code: branchForm.code, name: branchForm.name }, { company_id: "公司", code: "據點代碼", name: "據點名稱" });
        if (validation) throw new Error(validation);
        const payload = {
          company_id: branchForm.company_id,
          parent_branch_id: branchForm.parent_branch_id || null,
          code: branchForm.code.trim(),
          name: branchForm.name.trim(),
          branch_type: branchForm.branch_type,
          phone: branchForm.phone.trim() || null,
          email: branchForm.email.trim() || null,
          address: toAddress(branchForm.address),
          status: branchForm.status,
          updated_at: now,
        };
        const result = editingId
          ? await supabase.from("branches").update(payload).eq("id", editingId)
          : await supabase.from("branches").insert(payload);
        if (result.error) throw result.error;
      }

      if (activeKind === "department") {
        const validation = validateRequired({ company_id: departmentForm.company_id, code: departmentForm.code, name: departmentForm.name }, { company_id: "公司", code: "部門代碼", name: "部門名稱" });
        if (validation) throw new Error(validation);
        const payload = {
          company_id: departmentForm.company_id,
          branch_id: departmentForm.branch_id || null,
          parent_department_id: departmentForm.parent_department_id || null,
          code: departmentForm.code.trim(),
          name: departmentForm.name.trim(),
          department_type: departmentForm.department_type,
          status: departmentForm.status,
          updated_at: now,
        };
        const result = editingId
          ? await supabase.from("departments").update(payload).eq("id", editingId)
          : await supabase.from("departments").insert(payload);
        if (result.error) throw result.error;
      }

      if (activeKind === "position") {
        const validation = validateRequired({ company_id: positionForm.company_id, code: positionForm.code, title: positionForm.title }, { company_id: "公司", code: "職稱代碼", title: "職稱名稱" });
        if (validation) throw new Error(validation);
        const payload = {
          company_id: positionForm.company_id,
          department_id: positionForm.department_id || null,
          code: positionForm.code.trim(),
          title: positionForm.title.trim(),
          level: positionForm.level.trim() || null,
          employment_type: positionForm.employment_type,
          is_manager: positionForm.is_manager,
          status: positionForm.status,
          updated_at: now,
        };
        const result = editingId
          ? await supabase.from("positions").update(payload).eq("id", editingId)
          : await supabase.from("positions").insert(payload);
        if (result.error) throw result.error;
      }

      setMessage(`${editingId ? "編輯" : "新增"}成功，已回寫 Supabase。`);
      setEditingId(null);
      await loadOrganization();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function softDelete(kind: EntityKind, id: string) {
    const label = kind === "company" ? "公司" : kind === "branch" ? "據點" : kind === "department" ? "部門" : "職稱";
    if (!window.confirm(`確定要停用這筆${label}資料？資料會以 deleted_at 軟刪除保留稽核。`)) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const table = kind === "company" ? "companies" : kind === "branch" ? "branches" : kind === "department" ? "departments" : "positions";
      const result = await supabase.from(table).update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      if (result.error) throw result.error;
      setMessage(`${label}已停用，組織圖與管理清單已同步更新。`);
      await loadOrganization();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "停用失敗。");
    } finally {
      setSaving(false);
    }
  }

  function entityTitle() {
    const prefix = editingId ? "編輯" : "新增";
    if (activeKind === "company") return `${prefix}公司`;
    if (activeKind === "branch") return `${prefix}據點`;
    if (activeKind === "department") return `${prefix}部門`;
    return `${prefix}職稱`;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">ORGANIZATION</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">組織管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            公司、據點、部門與職稱已改為 Supabase 真實資料；新增、編輯、停用後會連動員工主檔、簽核、排班與報表篩選。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void loadOrganization()} variant="outline" disabled={loading || saving}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重新整理
          </Button>
          <Button onClick={() => startCreate(activeKind)}>
            <Plus className="mr-2 h-4 w-4" />
            新增目前類別
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <Card key={item.label} className="rounded-lg">
            <CardContent className="flex items-center justify-between gap-3 p-5">
              <div>
                <div className="text-sm text-muted-foreground">{item.label}</div>
                <div className="mt-2 text-3xl font-black">{loading ? "..." : item.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.hint}</div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["company", "公司"] as const,
              ["branch", "據點"] as const,
              ["department", "部門"] as const,
              ["position", "職稱"] as const,
            ].map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => startCreate(kind)}
                className={`rounded-lg border px-4 py-2 text-sm font-black transition ${
                  activeKind === kind ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative min-w-full lg:min-w-[320px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋代碼、名稱、類型..."
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>
        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800">
          {loading ? "正在載入 Supabase 組織資料..." : message}
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              組織樹狀圖
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                載入組織圖...
              </div>
            ) : orgTree.length ? (
              orgTree.map((node) => <TreeNode key={node.id} node={node} />)
            ) : (
              <EmptyBlock message="尚未建立公司資料，請先新增公司。" />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Save className="h-5 w-5 text-primary" />
              {entityTitle()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeKind === "company" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="公司代碼" value={companyForm.code} onChange={(value) => setCompanyForm((form) => ({ ...form, code: value }))} required />
                <TextField label="公司名稱" value={companyForm.name} onChange={(value) => setCompanyForm((form) => ({ ...form, name: value }))} required />
                <TextField label="法定名稱" value={companyForm.legal_name} onChange={(value) => setCompanyForm((form) => ({ ...form, legal_name: value }))} />
                <TextField label="統一編號" value={companyForm.tax_id} onChange={(value) => setCompanyForm((form) => ({ ...form, tax_id: value }))} />
                <TextField label="電話" value={companyForm.phone} onChange={(value) => setCompanyForm((form) => ({ ...form, phone: value }))} />
                <TextField label="Email" value={companyForm.email} onChange={(value) => setCompanyForm((form) => ({ ...form, email: value }))} />
                <TextField label="地址" value={companyForm.address} onChange={(value) => setCompanyForm((form) => ({ ...form, address: value }))} className="md:col-span-2" />
                <SelectField label="狀態" value={companyForm.status} onChange={(value) => setCompanyForm((form) => ({ ...form, status: value as CompanyStatus }))} options={companyStatusLabels} />
              </div>
            ) : null}

            {activeKind === "branch" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <RelationSelect label="公司" value={branchForm.company_id} onChange={(value) => setBranchForm((form) => ({ ...form, company_id: value, parent_branch_id: "" }))} options={state.companies.map((company) => ({ value: company.id, label: company.name }))} required />
                <RelationSelect label="上層據點" value={branchForm.parent_branch_id} onChange={(value) => setBranchForm((form) => ({ ...form, parent_branch_id: value }))} options={state.branches.filter((branch) => branch.company_id === branchForm.company_id && branch.id !== editingId).map((branch) => ({ value: branch.id, label: branch.name }))} allowEmpty />
                <TextField label="據點代碼" value={branchForm.code} onChange={(value) => setBranchForm((form) => ({ ...form, code: value }))} required />
                <TextField label="據點名稱" value={branchForm.name} onChange={(value) => setBranchForm((form) => ({ ...form, name: value }))} required />
                <SelectField label="據點類型" value={branchForm.branch_type} onChange={(value) => setBranchForm((form) => ({ ...form, branch_type: value as BranchType }))} options={branchTypeLabels} />
                <SelectField label="狀態" value={branchForm.status} onChange={(value) => setBranchForm((form) => ({ ...form, status: value as BranchStatus }))} options={branchStatusLabels} />
                <TextField label="電話" value={branchForm.phone} onChange={(value) => setBranchForm((form) => ({ ...form, phone: value }))} />
                <TextField label="Email" value={branchForm.email} onChange={(value) => setBranchForm((form) => ({ ...form, email: value }))} />
                <TextField label="地址" value={branchForm.address} onChange={(value) => setBranchForm((form) => ({ ...form, address: value }))} className="md:col-span-2" />
              </div>
            ) : null}

            {activeKind === "department" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <RelationSelect label="公司" value={departmentForm.company_id} onChange={(value) => setDepartmentForm((form) => ({ ...form, company_id: value, branch_id: "", parent_department_id: "" }))} options={state.companies.map((company) => ({ value: company.id, label: company.name }))} required />
                <RelationSelect label="主要據點" value={departmentForm.branch_id} onChange={(value) => setDepartmentForm((form) => ({ ...form, branch_id: value }))} options={state.branches.filter((branch) => branch.company_id === departmentForm.company_id).map((branch) => ({ value: branch.id, label: branch.name }))} allowEmpty />
                <RelationSelect label="上層部門" value={departmentForm.parent_department_id} onChange={(value) => setDepartmentForm((form) => ({ ...form, parent_department_id: value }))} options={state.departments.filter((department) => department.company_id === departmentForm.company_id && department.id !== editingId).map((department) => ({ value: department.id, label: department.name }))} allowEmpty />
                <SelectField label="部門類型" value={departmentForm.department_type} onChange={(value) => setDepartmentForm((form) => ({ ...form, department_type: value as DepartmentType }))} options={departmentTypeLabels} />
                <TextField label="部門代碼" value={departmentForm.code} onChange={(value) => setDepartmentForm((form) => ({ ...form, code: value }))} required />
                <TextField label="部門名稱" value={departmentForm.name} onChange={(value) => setDepartmentForm((form) => ({ ...form, name: value }))} required />
                <SelectField label="狀態" value={departmentForm.status} onChange={(value) => setDepartmentForm((form) => ({ ...form, status: value as OrgStatus }))} options={orgStatusLabels} />
              </div>
            ) : null}

            {activeKind === "position" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <RelationSelect label="公司" value={positionForm.company_id} onChange={(value) => setPositionForm((form) => ({ ...form, company_id: value, department_id: "" }))} options={state.companies.map((company) => ({ value: company.id, label: company.name }))} required />
                <RelationSelect label="所屬部門" value={positionForm.department_id} onChange={(value) => setPositionForm((form) => ({ ...form, department_id: value }))} options={state.departments.filter((department) => department.company_id === positionForm.company_id).map((department) => ({ value: department.id, label: department.name }))} allowEmpty />
                <TextField label="職稱代碼" value={positionForm.code} onChange={(value) => setPositionForm((form) => ({ ...form, code: value }))} required />
                <TextField label="職稱名稱" value={positionForm.title} onChange={(value) => setPositionForm((form) => ({ ...form, title: value }))} required />
                <TextField label="職等" value={positionForm.level} onChange={(value) => setPositionForm((form) => ({ ...form, level: value }))} />
                <SelectField label="聘僱型態" value={positionForm.employment_type} onChange={(value) => setPositionForm((form) => ({ ...form, employment_type: value as EmploymentType }))} options={employmentTypeLabels} />
                <SelectField label="狀態" value={positionForm.status} onChange={(value) => setPositionForm((form) => ({ ...form, status: value as OrgStatus }))} options={orgStatusLabels} />
                <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={positionForm.is_manager}
                    onChange={(event) => setPositionForm((form) => ({ ...form, is_manager: event.target.checked }))}
                  />
                  主管職
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveActiveEntity()} disabled={saving || loading}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {editingId ? "儲存編輯" : "新增資料"}
              </Button>
              {editingId ? (
                <Button variant="outline" onClick={() => startCreate(activeKind)} disabled={saving}>
                  取消編輯
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EntityCard title="公司管理" icon={Building2} onCreate={() => startCreate("company")}>
          {filteredCompanies.length ? (
            <div className="space-y-3">
              {filteredCompanies.map((company) => (
                <div key={company.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-black">{company.name}</div>
                        <Badge className={statusClassName(company.status)}>{companyStatusLabels[company.status]}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{company.code} / 統編 {company.tax_id || "未設定"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{addressText(company.address) || "未設定地址"}</div>
                    </div>
                    <RowActions onEdit={() => startEdit("company", company.id)} onDelete={() => void softDelete("company", company.id)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                    <Metric label="據點" value={state.branches.filter((branch) => branch.company_id === company.id).length} />
                    <Metric label="部門" value={state.departments.filter((department) => department.company_id === company.id).length} />
                    <Metric label="員工" value={countBy(state.employeeCounts, "company_id", company.id)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock message="沒有符合條件的公司資料。" />
          )}
        </EntityCard>

        <EntityCard title="據點管理" icon={MapPin} onCreate={() => startCreate("branch")}>
          {filteredBranches.length ? (
            <div className="space-y-3">
              {filteredBranches.map((branch) => (
                <div key={branch.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-black">{branch.name}</div>
                        <Badge className={statusClassName(branch.status)}>{branchStatusLabels[branch.status]}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {branch.code} / {branchTypeLabels[branch.branch_type]} / {getCompanyName(state.companies, branch.company_id)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{addressText(branch.address) || "未設定地址"}</div>
                    </div>
                    <RowActions onEdit={() => startEdit("branch", branch.id)} onDelete={() => void softDelete("branch", branch.id)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                    <Metric label="部門" value={state.departments.filter((department) => department.branch_id === branch.id).length} />
                    <Metric label="員工" value={countBy(state.employeeCounts, "primary_branch_id", branch.id)} />
                    <Metric label="電話" value={branch.phone || "未設定"} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock message="沒有符合條件的據點資料。" />
          )}
        </EntityCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EntityCard title="部門管理" icon={UsersRound} onCreate={() => startCreate("department")}>
          {filteredDepartments.length ? (
            <div className="space-y-3">
              {filteredDepartments.map((department) => (
                <div key={department.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-black">{department.name}</div>
                        <Badge className={statusClassName(department.status)}>{orgStatusLabels[department.status]}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {department.code} / {departmentTypeLabels[department.department_type]} / {getBranchName(state.branches, department.branch_id)}
                      </div>
                    </div>
                    <RowActions onEdit={() => startEdit("department", department.id)} onDelete={() => void softDelete("department", department.id)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                    <Metric label="職稱" value={state.positions.filter((position) => position.department_id === department.id).length} />
                    <Metric label="員工" value={countBy(state.employeeCounts, "primary_department_id", department.id)} />
                    <Metric label="公司" value={getCompanyName(state.companies, department.company_id)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock message="沒有符合條件的部門資料。" />
          )}
        </EntityCard>

        <EntityCard title="職稱管理" icon={BriefcaseBusiness} onCreate={() => startCreate("position")}>
          {filteredPositions.length ? (
            <div className="space-y-3">
              {filteredPositions.map((position) => (
                <div key={position.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-black">{position.title}</div>
                        <Badge className={statusClassName(position.status)}>{orgStatusLabels[position.status]}</Badge>
                        {position.is_manager ? (
                          <Badge className="bg-cyan-600">
                            <BadgeCheck className="mr-1 h-3 w-3" />
                            主管職
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {position.code} / {position.level || "未設職等"} / {employmentTypeLabels[position.employment_type]}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{getDepartmentName(state.departments, position.department_id)}</div>
                    </div>
                    <RowActions onEdit={() => startEdit("position", position.id)} onDelete={() => void softDelete("position", position.id)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                    <Metric label="員工" value={countBy(state.employeeCounts, "position_id", position.id)} />
                    <Metric label="公司" value={getCompanyName(state.companies, position.company_id)} />
                    <Metric label="職務類型" value={position.is_manager ? "主管職" : "一般職"} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock message="沒有符合條件的職稱資料。" />
          )}
        </EntityCard>
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`space-y-1 text-sm font-semibold ${className}`}>
      {label}
      {required ? <span className="ml-1 text-rose-600">*</span> : null}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: string) => void;
  options: Record<T, string>;
}) {
  return (
    <label className="space-y-1 text-sm font-semibold">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
      >
        {Object.entries(options).map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {String(labelText)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RelationSelect({
  label,
  value,
  onChange,
  options,
  required,
  allowEmpty,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm font-semibold">
      {label}
      {required ? <span className="ml-1 text-rose-600">*</span> : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
      >
        {allowEmpty ? <option value="">不指定</option> : null}
        {!allowEmpty && !options.length ? <option value="">請先建立資料</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EntityCard({
  title,
  icon: Icon,
  onCreate,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          新增
        </Button>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Edit3 className="mr-2 h-4 w-4" />
        編輯
      </Button>
      <Button size="sm" variant="outline" onClick={onDelete}>
        <Trash2 className="mr-2 h-4 w-4" />
        停用
      </Button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-black">{value}</div>
    </div>
  );
}
