"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileCheck2,
  FileText,
  RefreshCcw,
  Search,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { csv, downloadTextFile } from "@/lib/client/download";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  createContractSignedUrl,
  loadEmployeeRosterContracts,
  uploadLaborContract,
  type EmployeeRosterContractRow,
} from "@/lib/employees/employee-contract-store";

const statusLabels: Record<string, string> = {
  active: "在職",
  on_leave: "留停",
  suspended: "停職",
  terminated: "離職",
};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

export default function EmployeeContractsPage() {
  const currentUser = useCurrentUser();
  const [rows, setRows] = useState<EmployeeRosterContractRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [issuedAt, setIssuedAt] = useState(getToday);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("員工名冊與勞動契約會直接讀寫 Supabase employees / documents。");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const nextRows = await loadEmployeeRosterContracts();
      setRows(nextRows);
      setSelectedEmployeeId((current) => current || nextRows[0]?.employeeId || "");
      setMessage(`已載入 ${nextRows.length} 位員工，缺契約 ${nextRows.filter((row) => row.contractStatus === "缺契約").length} 位。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "讀取員工名冊與契約失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.employeeNo, row.name, row.company, row.branch, row.department, row.position, row.contractStatus]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, rows]);

  const selectedEmployee = rows.find((row) => row.employeeId === selectedEmployeeId) ?? rows[0];
  const activeRows = rows.filter((row) => row.status === "active");
  const missingRows = rows.filter((row) => row.contractStatus === "缺契約");
  const completedRows = rows.filter((row) => row.contractStatus === "已上傳");
  const completionRate = rows.length ? Math.round((completedRows.length / rows.length) * 100) : 0;

  async function handleUpload() {
    if (!selectedEmployee) {
      setMessage("請先選擇員工。");
      return;
    }
    if (!file) {
      setMessage("請先選擇要上傳的勞動契約檔案。");
      return;
    }
    setUploading(true);
    try {
      await uploadLaborContract({
        employee: selectedEmployee,
        file,
        uploadedByUserId: currentUser.id,
        issuedAt,
      });
      setFile(null);
      setMessage(`已上傳 ${selectedEmployee.name} 的勞動契約，並寫入 Supabase documents。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上傳勞動契約失敗。");
    } finally {
      setUploading(false);
    }
  }

  async function openContract(row: EmployeeRosterContractRow) {
    if (!row.contractPath) return;
    try {
      const url = await createContractSignedUrl(row.contractPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "產生契約下載連結失敗。");
    }
  }

  function exportRoster() {
    downloadTextFile(
      `employee-roster-contracts-${getToday()}.csv`,
      csv([
        ["員工編號", "姓名", "公司", "據點", "部門", "職稱", "到職日", "狀態", "勞動契約狀態", "契約上傳日", "契約檔名"],
        ...filteredRows.map((row) => [
          row.employeeNo,
          row.name,
          row.company,
          row.branch,
          row.department,
          row.position,
          row.hireDate,
          statusLabels[row.status] ?? row.status,
          row.contractStatus,
          row.contractUploadedAt,
          row.contractTitle,
        ]),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">LABOR INSPECTION READY</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">員工名冊與勞動契約</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            勞檢常會要求員工名冊、到職日、職稱、在職狀態與勞動契約。此頁集中讀取員工主檔，並把勞動契約上傳到 Supabase Storage 與 documents。
          </p>
          <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            重新整理
          </Button>
          <Button onClick={exportRoster}>
            <Download className="h-4 w-4" />
            匯出勞檢名冊
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "員工總數", value: rows.length, detail: "employees 主檔", icon: UsersRound, tone: "bg-sky-50 text-sky-700" },
          { label: "在職人員", value: activeRows.length, detail: "勞檢優先抽查", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "已上傳契約", value: completedRows.length, detail: `${completionRate}% 完成`, icon: FileCheck2, tone: "bg-cyan-50 text-cyan-700" },
          { label: "缺勞動契約", value: missingRows.length, detail: "需優先補件", icon: AlertTriangle, tone: "bg-rose-50 text-rose-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-500">{item.label}</div>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-950">{item.value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">{item.detail}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">上傳勞動契約</h2>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              員工
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                className="w-full rounded-lg border border-[#dfc9b1] bg-white px-3 py-2 text-sm font-normal"
              >
                {rows.map((row) => (
                  <option key={row.employeeId} value={row.employeeId}>
                    {row.employeeNo} {row.name} · {row.department}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              契約簽署日
              <Input type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              勞動契約檔案
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] px-3 py-3 text-sm"
              />
            </label>
            <Button onClick={handleUpload} disabled={uploading || !rows.length}>
              <UploadCloud className="h-4 w-4" />
              {uploading ? "上傳中" : "上傳並歸檔"}
            </Button>
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
            建議上傳 PDF 掃描檔，檔名保留員工編號、姓名與簽署日期。契約屬高敏感文件，僅人資、行政部門主任、執行長應可查看。
          </div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
          <div className="flex items-start gap-3">
            <FileArchive className="mt-1 h-5 w-5 text-rose-700" />
            <div>
              <h2 className="font-black text-rose-950">勞檢今天來，這區要能立刻交付</h2>
              <p className="mt-2 text-sm leading-6 text-rose-800">
                這頁可直接匯出員工名冊，也能列出缺勞動契約的人員。若承辦抽查特定員工，請從下方清單確認契約是否已上傳，並產生文件連結。
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {["員工編號、姓名、部門、職稱、到職日", "在職/離職/留停狀態", "勞動契約是否已簽署上傳", "缺件名單與補件責任人"].map((item) => (
                  <div key={item} className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-rose-800">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#ead8c2] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-black text-slate-950">員工名冊與契約狀態</h2>
            <p className="mt-1 text-sm text-slate-500">資料來源：employees / documents。可搜尋員工、部門、據點或契約狀態。</p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋員工、部門、狀態"
              className="w-full rounded-lg border border-[#dfc9b1] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d97706]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-[#fffaf4] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">員工</th>
                <th className="px-4 py-3">組織</th>
                <th className="px-4 py-3">到職日</th>
                <th className="px-4 py-3">在職狀態</th>
                <th className="px-4 py-3">勞動契約</th>
                <th className="px-4 py-3">上傳日</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <tr key={row.employeeId} className="hover:bg-[#fffaf4]">
                  <td className="px-4 py-4">
                    <div className="font-black text-slate-950">{row.name}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{row.employeeNo}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-800">{row.department || "未設定部門"}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.company} · {row.branch} · {row.position}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{row.hireDate || "未設定"}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {statusLabels[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${row.contractStatus === "已上傳" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {row.contractStatus}
                    </span>
                    <div className="mt-1 text-xs text-slate-500">{row.contractTitle || "尚未歸檔"}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{row.contractUploadedAt || "未上傳"}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openContract(row)} disabled={!row.contractPath}>
                        <FileText className="h-3.5 w-3.5" />
                        查看契約
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelectedEmployeeId(row.employeeId)}>
                        <UploadCloud className="h-3.5 w-3.5" />
                        補上傳
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
