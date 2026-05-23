"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  Filter,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Upload,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  canManageEmployeeMasterData,
  canViewSensitiveEmployeeData,
  maskEmail,
  maskNationalId,
  maskPhone,
  maskText,
  restrictedValue,
} from "@/lib/auth/privacy";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  genderLabels,
  statusClassNames,
  statusLabels,
  type Employee,
  type EmployeeStatus,
  type Gender,
} from "@/lib/employees/mock-data";
import { loadEmployees, saveEmployees } from "@/lib/employees/employee-store";

type EmployeeForm = Employee;
type FormErrors = Partial<Record<keyof EmployeeForm, string>>;
type SortKey = keyof Pick<Employee, "employeeNo" | "name" | "department" | "branch" | "position" | "hireDate" | "status">;
type ImportPreviewRow = {
  rowNumber: number;
  employee: Employee;
  errors: string[];
};
type CompletenessSeverity = "blocking" | "warning";
type CompletenessGroup = "basic" | "employment" | "contact" | "offboarding";
type CompletenessIssue = {
  field: keyof Employee;
  label: string;
  group: CompletenessGroup;
  severity: CompletenessSeverity;
  impact: string;
};
type CompletenessFocus = "all" | "blocked" | "payroll" | "scheduling" | "evaluation";
type EmployeeCompleteness = {
  score: number;
  completed: number;
  total: number;
  missing: CompletenessIssue[];
  blockers: number;
  warnings: number;
  payrollReady: boolean;
  schedulingReady: boolean;
  evaluationReady: boolean;
  status: "complete" | "attention" | "blocked";
};
type CompletenessActionRow = {
  employee: Employee;
  completeness: EmployeeCompleteness;
  missingTop: CompletenessIssue[];
  blockingText: string;
  firstImpact: string;
  focusMatch: boolean;
};

const blankEmployeeForm: EmployeeForm = {
  employeeNo: "",
  name: "",
  englishName: "",
  nationalId: "",
  birthday: "",
  gender: "not_disclosed",
  department: "",
  branch: "",
  position: "",
  hireDate: "",
  terminationDate: "",
  company: "",
  supervisor: "",
  status: "active",
  phone: "",
  email: "",
  registeredAddress: "",
  mailingAddress: "",
  emergencyContact: "",
  emergencyPhone: "",
};

const allOption = "全部";
const completenessGroupLabels: Record<CompletenessGroup, string> = {
  basic: "基本識別",
  employment: "任職與權責",
  contact: "聯絡與緊急",
  offboarding: "離職資料",
};

const completenessChecks: CompletenessIssue[] = [
  { field: "employeeNo", label: "員工編號", group: "basic", severity: "blocking", impact: "主檔識別" },
  { field: "name", label: "中文姓名", group: "basic", severity: "blocking", impact: "簽核與報表" },
  { field: "nationalId", label: "身分證字號", group: "basic", severity: "blocking", impact: "薪資、勞健保、扣繳" },
  { field: "birthday", label: "生日", group: "basic", severity: "blocking", impact: "勞健保與眷屬資料" },
  { field: "gender", label: "性別", group: "basic", severity: "warning", impact: "人事統計" },
  { field: "phone", label: "手機", group: "basic", severity: "warning", impact: "通知與緊急聯繫" },
  { field: "email", label: "Email", group: "basic", severity: "warning", impact: "通知與帳號" },
  { field: "company", label: "公司", group: "employment", severity: "blocking", impact: "權限與報表切分" },
  { field: "branch", label: "據點", group: "employment", severity: "blocking", impact: "排班與出勤打卡" },
  { field: "department", label: "部門", group: "employment", severity: "blocking", impact: "簽核流程" },
  { field: "position", label: "職稱", group: "employment", severity: "blocking", impact: "排班資格與評鑑" },
  { field: "supervisor", label: "直屬主管", group: "employment", severity: "blocking", impact: "簽核流程" },
  { field: "hireDate", label: "到職日", group: "employment", severity: "blocking", impact: "特休、年資與薪資" },
  { field: "status", label: "員工狀態", group: "employment", severity: "blocking", impact: "權限與結薪" },
  { field: "registeredAddress", label: "戶籍地址", group: "contact", severity: "warning", impact: "人事文件" },
  { field: "mailingAddress", label: "通訊地址", group: "contact", severity: "warning", impact: "文件寄送" },
  { field: "emergencyContact", label: "緊急聯絡人", group: "contact", severity: "warning", impact: "職安與緊急事件" },
  { field: "emergencyPhone", label: "緊急聯絡人電話", group: "contact", severity: "warning", impact: "職安與緊急事件" },
];
const csvHeaders: Array<{ label: string; key: keyof Employee }> = [
  { label: "員工編號", key: "employeeNo" },
  { label: "中文姓名", key: "name" },
  { label: "英文姓名", key: "englishName" },
  { label: "身分證字號", key: "nationalId" },
  { label: "生日", key: "birthday" },
  { label: "性別", key: "gender" },
  { label: "手機", key: "phone" },
  { label: "Email", key: "email" },
  { label: "戶籍地址", key: "registeredAddress" },
  { label: "通訊地址", key: "mailingAddress" },
  { label: "緊急聯絡人", key: "emergencyContact" },
  { label: "緊急聯絡人電話", key: "emergencyPhone" },
  { label: "到職日", key: "hireDate" },
  { label: "離職日", key: "terminationDate" },
  { label: "公司", key: "company" },
  { label: "據點", key: "branch" },
  { label: "部門", key: "department" },
  { label: "職稱", key: "position" },
  { label: "直屬主管", key: "supervisor" },
  { label: "員工狀態", key: "status" },
];

function uniqueOptions(
  rows: Employee[],
  key: keyof Pick<Employee, "department" | "branch" | "position" | "company" | "supervisor">,
) {
  return [allOption, ...Array.from(new Set(rows.map((employee) => employee[key]).filter(Boolean)))];
}

function optionValues(
  rows: Employee[],
  key: keyof Pick<Employee, "department" | "branch" | "position" | "company" | "supervisor">,
) {
  return Array.from(new Set(rows.map((employee) => employee[key]).filter(Boolean)));
}

function validateEmployeeForm(form: EmployeeForm): FormErrors {
  const errors: FormErrors = {};
  const requiredFields: Array<keyof EmployeeForm> = [
    "employeeNo",
    "name",
    "nationalId",
    "birthday",
    "gender",
    "phone",
    "email",
    "registeredAddress",
    "mailingAddress",
    "emergencyContact",
    "emergencyPhone",
    "hireDate",
    "company",
    "branch",
    "department",
    "position",
    "supervisor",
    "status",
  ];

  requiredFields.forEach((field) => {
    if (!String(form[field] ?? "").trim()) {
      errors[field] = "此欄位為必填";
    }
  });

  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Email 格式不正確";
  }

  if (form.phone && !/^09\d{2}-?\d{3}-?\d{3}$/.test(form.phone)) {
    errors.phone = "手機格式需為 09xx-xxx-xxx";
  }

  if (form.emergencyPhone && !/^09\d{2}-?\d{3}-?\d{3}$/.test(form.emergencyPhone)) {
    errors.emergencyPhone = "緊急聯絡人電話格式需為 09xx-xxx-xxx";
  }

  if (form.nationalId && !/^[A-Z][12]\d{8}$/.test(form.nationalId.toUpperCase())) {
    errors.nationalId = "身分證字號格式不正確";
  }

  if (form.terminationDate && form.hireDate && form.terminationDate < form.hireDate) {
    errors.terminationDate = "離職日不可早於到職日";
  }

  if (form.status === "terminated" && !form.terminationDate) {
    errors.terminationDate = "離職狀態需填寫離職日";
  }

  return errors;
}

function hasValue(value: Employee[keyof Employee]) {
  return String(value ?? "").trim().length > 0;
}

function getEmployeeCompleteness(employee: Employee): EmployeeCompleteness {
  const dynamicChecks = [...completenessChecks];

  if (employee.status === "terminated") {
    dynamicChecks.push({
      field: "terminationDate",
      label: "離職日",
      group: "offboarding",
      severity: "blocking",
      impact: "離職清冊與薪資結清",
    });
  }

  const missing = dynamicChecks.filter((check) => !hasValue(employee[check.field]));
  const blockers = missing.filter((issue) => issue.severity === "blocking").length;
  const warnings = missing.length - blockers;
  const completed = dynamicChecks.length - missing.length;
  const score = dynamicChecks.length ? Math.round((completed / dynamicChecks.length) * 100) : 100;
  const payrollFields: Array<keyof Employee> = ["employeeNo", "name", "nationalId", "birthday", "company", "department", "position", "hireDate", "status"];
  const schedulingFields: Array<keyof Employee> = ["employeeNo", "name", "branch", "department", "position", "supervisor", "status"];
  const evaluationFields: Array<keyof Employee> = ["employeeNo", "name", "branch", "department", "position", "hireDate", "status"];

  return {
    score,
    completed,
    total: dynamicChecks.length,
    missing,
    blockers,
    warnings,
    payrollReady: payrollFields.every((field) => hasValue(employee[field])),
    schedulingReady: schedulingFields.every((field) => hasValue(employee[field])),
    evaluationReady: evaluationFields.every((field) => hasValue(employee[field])),
    status: blockers > 0 ? "blocked" : missing.length > 0 ? "attention" : "complete",
  };
}

function completenessBadgeClass(status: EmployeeCompleteness["status"]) {
  if (status === "complete") return "bg-emerald-600";
  if (status === "attention") return "bg-amber-600";
  return "bg-rose-600";
}

function completenessLabel(completeness: EmployeeCompleteness) {
  if (completeness.status === "complete") return "完整";
  if (completeness.status === "attention") return "待補件";
  return "阻擋";
}

function focusLabel(focus: CompletenessFocus) {
  const labels: Record<CompletenessFocus, string> = {
    all: "全部缺件",
    blocked: "阻擋優先",
    payroll: "薪資阻擋",
    scheduling: "排班阻擋",
    evaluation: "評鑑缺口",
  };
  return labels[focus];
}

function matchesCompletenessFocus(completeness: EmployeeCompleteness, focus: CompletenessFocus) {
  if (focus === "blocked") return completeness.blockers > 0;
  if (focus === "payroll") return !completeness.payrollReady;
  if (focus === "scheduling") return !completeness.schedulingReady;
  if (focus === "evaluation") return !completeness.evaluationReady;
  return completeness.missing.length > 0;
}

function groupCompletenessIssues(issues: CompletenessIssue[]) {
  return issues.reduce<Record<CompletenessGroup, CompletenessIssue[]>>(
    (groups, issue) => {
      groups[issue.group].push(issue);
      return groups;
    },
    { basic: [], employment: [], contact: [], offboarding: [] },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toExcelHtml(rows: Employee[]) {
  const headers = ["員工編號", "姓名", "部門", "據點", "職稱", "到職日", "狀態", "手機", "Email"];
  const body = rows.map((employee) => [
    employee.employeeNo,
    employee.name,
    employee.department,
    employee.branch,
    employee.position,
    employee.hireDate,
    statusLabels[employee.status],
    employee.phone,
    employee.email,
  ]);

  const tableRows = [headers, ...body]
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`,
    )
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <table>${tableRows}</table>
      </body>
    </html>
  `;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toCsv(rows: Employee[]) {
  const headerLine = csvHeaders.map((header) => csvCell(header.label)).join(",");
  const bodyLines = rows.map((employee) =>
    csvHeaders.map((header) => csvCell(String(employee[header.key] ?? ""))).join(","),
  );
  return "\uFEFF" + [headerLine, ...bodyLines].join("\n");
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseEmployeesCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { rows: [] as ImportPreviewRow[], errors: ["檔案沒有可匯入的員工資料。"] };
  }

  const headers = splitCsvLine(lines[0]);
  const missingHeaders = csvHeaders
    .filter((header) => !headers.includes(header.label))
    .map((header) => header.label);

  if (missingHeaders.length) {
    return {
      rows: [] as ImportPreviewRow[],
      errors: [`缺少必要欄位：${missingHeaders.join("、")}`],
    };
  }

  const rows = lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const employee = { ...blankEmployeeForm };
    csvHeaders.forEach((header) => {
      const cellIndex = headers.indexOf(header.label);
      employee[header.key] = (cells[cellIndex] ?? "") as never;
    });

    employee.gender = (employee.gender || "not_disclosed") as Gender;
    employee.status = (employee.status || "active") as EmployeeStatus;
    const validationErrors = validateEmployeeForm(employee);
    const errors = Object.entries(validationErrors).map(([field, message]) => `${field}: ${message}`);
    return { rowNumber: index + 2, employee, errors };
  });

  return { rows, errors: [] as string[] };
}

type FormFieldProps = {
  label: string;
  field: keyof EmployeeForm;
  required?: boolean;
  type?: string;
  placeholder?: string;
  children?: ReactNode;
  value?: string;
  error?: string;
  onChange?: (value: string) => void;
};

function FormField({
  label,
  field,
  required,
  type = "text",
  placeholder,
  children,
  value = "",
  error,
  onChange,
}: FormFieldProps) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold" htmlFor={field}>
      <span>
        {label}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </span>
      {children ?? (
        <Input
          id={field}
          type={type}
          value={value}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
      {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
    </label>
  );
}

export default function EmployeesPage() {
  const currentUser = useCurrentUser();
  const [employeeRows, setEmployeeRows] = useState<Employee[]>([]);
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState(allOption);
  const [branch, setBranch] = useState(allOption);
  const [position, setPosition] = useState(allOption);
  const [status, setStatus] = useState<EmployeeStatus | typeof allOption>(allOption);
  const [importFileName, setImportFileName] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [actionMode, setActionMode] = useState<"detail" | "edit" | "create">("detail");
  const [form, setForm] = useState<EmployeeForm>(blankEmployeeForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [importPreviewRows, setImportPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("employeeNo");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [completenessFocus, setCompletenessFocus] = useState<CompletenessFocus>("blocked");
  const [isLoading, setIsLoading] = useState(true);
  const [dataMessage, setDataMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canManageEmployees = canManageEmployeeMasterData(currentUser);
  const canViewSensitiveEmployees = canViewSensitiveEmployeeData(currentUser);

  useEffect(() => {
    let isMounted = true;

    async function loadRows() {
      setIsLoading(true);
      setDataMessage("");
      try {
        const rows = await loadEmployees();
        if (!isMounted) return;
        setEmployeeRows(rows);
        setSelectedEmployee(rows[0] ?? null);
      } catch (error) {
        if (!isMounted) return;
        setDataMessage(error instanceof Error ? error.message : "讀取 Supabase 員工資料失敗。");
        setEmployeeRows([]);
        setSelectedEmployee(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadRows();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return employeeRows.filter((employee) => {
      const matchesKeyword =
        normalizedKeyword.length === 0 ||
        [
          employee.employeeNo,
          employee.name,
          employee.department,
          employee.branch,
          employee.position,
          canViewSensitiveEmployees ? employee.phone : "",
          canViewSensitiveEmployees ? employee.email : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedKeyword);

      return (
        matchesKeyword &&
        (department === allOption || employee.department === department) &&
        (branch === allOption || employee.branch === branch) &&
        (position === allOption || employee.position === position) &&
        (status === allOption || employee.status === status)
      );
    }).sort((firstEmployee, secondEmployee) => {
      const firstValue = String(firstEmployee[sortKey] ?? "");
      const secondValue = String(secondEmployee[sortKey] ?? "");
      const compared = firstValue.localeCompare(secondValue, "zh-Hant");
      return sortDirection === "asc" ? compared : -compared;
    });
  }, [branch, canViewSensitiveEmployees, department, employeeRows, keyword, position, sortDirection, sortKey, status]);

  const completenessByEmployeeNo = useMemo(
    () => new Map(employeeRows.map((employee) => [employee.employeeNo, getEmployeeCompleteness(employee)])),
    [employeeRows],
  );
  const completenessSummary = useMemo(() => {
    const records = employeeRows.map((employee) => getEmployeeCompleteness(employee));
    const averageScore = records.length
      ? Math.round(records.reduce((total, completeness) => total + completeness.score, 0) / records.length)
      : 100;

    return {
      averageScore,
      incompleteCount: records.filter((completeness) => completeness.missing.length > 0).length,
      blockedCount: records.filter((completeness) => completeness.blockers > 0).length,
      payrollBlockedCount: records.filter((completeness) => !completeness.payrollReady).length,
      schedulingBlockedCount: records.filter((completeness) => !completeness.schedulingReady).length,
      evaluationBlockedCount: records.filter((completeness) => !completeness.evaluationReady).length,
    };
  }, [employeeRows]);
  const completenessActionRows = useMemo<CompletenessActionRow[]>(() => {
    return employeeRows
      .map((employee) => {
        const completeness = getEmployeeCompleteness(employee);
        const blockingIssues = completeness.missing.filter((issue) => issue.severity === "blocking");
        const missingTop = (blockingIssues.length ? blockingIssues : completeness.missing).slice(0, 3);
        return {
          employee,
          completeness,
          missingTop,
          blockingText: blockingIssues.length ? `${blockingIssues.length} 個阻擋欄位` : `${completeness.missing.length} 個待補欄位`,
          firstImpact: missingTop[0]?.impact ?? "資料完整，可進入後續流程",
          focusMatch: matchesCompletenessFocus(completeness, completenessFocus),
        };
      })
      .filter((row) => row.completeness.missing.length > 0 && row.focusMatch)
      .sort((a, b) => {
        if (b.completeness.blockers !== a.completeness.blockers) return b.completeness.blockers - a.completeness.blockers;
        return a.completeness.score - b.completeness.score;
      });
  }, [employeeRows, completenessFocus]);
  const selectedCompleteness = selectedEmployee ? getEmployeeCompleteness(selectedEmployee) : null;
  const selectedMissingGroups = selectedCompleteness
    ? groupCompletenessIssues(selectedCompleteness.missing)
    : null;

  const selectOptions = useMemo(
    () => ({
      companies: optionValues(employeeRows, "company"),
      branches: optionValues(employeeRows, "branch"),
      departments: optionValues(employeeRows, "department"),
      positions: optionValues(employeeRows, "position"),
      supervisors: optionValues(employeeRows, "supervisor"),
    }),
    [employeeRows],
  );

  function updateForm<K extends keyof EmployeeForm>(field: K, value: EmployeeForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
    setFormMessage("");
  }

  function startCreate() {
    setActionMode("create");
    setSelectedEmployee(null);
    setForm(blankEmployeeForm);
    setFormErrors({});
    setFormMessage("");
  }

  async function persistEmployeeRows(nextRows: Employee[]) {
    setDataMessage("");
    await saveEmployees(nextRows);
    setEmployeeRows(nextRows);
  }

  function startEdit(employee: Employee) {
    setActionMode("edit");
    setSelectedEmployee(employee);
    setForm(employee);
    setFormErrors({});
    setFormMessage("");
  }

  async function handleFormSubmit() {
    const nextErrors = validateEmployeeForm(form);
    const hasDuplicateEmployeeNo = employeeRows.some(
      (employee) =>
        employee.employeeNo === form.employeeNo &&
        (actionMode === "create" || employee.employeeNo !== selectedEmployee?.employeeNo),
    );

    if (hasDuplicateEmployeeNo) {
      nextErrors.employeeNo = "員工編號不可重複";
    }

    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setFormMessage("請先修正紅色提示欄位，再儲存員工資料。");
      return;
    }

    const normalizedForm = {
      ...form,
      nationalId: form.nationalId.toUpperCase(),
      email: form.email.trim(),
    };

    if (actionMode === "create") {
      try {
        await persistEmployeeRows([normalizedForm, ...employeeRows]);
        setSelectedEmployee(normalizedForm);
        setActionMode("detail");
        setFormMessage("已新增員工資料，已寫入 Supabase。");
      } catch (error) {
        setFormMessage(error instanceof Error ? error.message : "寫入 Supabase 失敗。");
      }
      return;
    }

    try {
      await persistEmployeeRows(
        employeeRows.map((employee) =>
          employee.employeeNo === selectedEmployee?.employeeNo ? normalizedForm : employee,
        ),
      );
      setSelectedEmployee(normalizedForm);
      setActionMode("detail");
      setFormMessage("已更新員工資料，已寫入 Supabase。");
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "寫入 Supabase 失敗。");
    }
  }

  function handleExport() {
    const excelHtml = toExcelHtml(filteredEmployees);
    downloadFile(
      `hris-employees-${new Date().toISOString().slice(0, 10)}.xls`,
      excelHtml,
      "application/vnd.ms-excel;charset=utf-8",
    );
  }

  function handleExportCsv() {
    downloadFile(
      `hris-employees-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(filteredEmployees),
      "text/csv;charset=utf-8",
    );
  }

  function handleTemplateDownload() {
    downloadFile("hris-employees-import-template.csv", toCsv([blankEmployeeForm]), "text/csv;charset=utf-8");
  }

  function handleSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function resetFilters() {
    setKeyword("");
    setDepartment(allOption);
    setBranch(allOption);
    setPosition(allOption);
    setStatus(allOption);
    setSortKey("employeeNo");
    setSortDirection("asc");
  }

  async function markTerminated(employee: Employee) {
    const today = new Date().toISOString().slice(0, 10);
    const terminatedEmployee: Employee = {
      ...employee,
      status: "terminated",
      terminationDate: employee.terminationDate || today,
    };
    const nextRows = employeeRows.map((row) => (row.employeeNo === employee.employeeNo ? terminatedEmployee : row));
    try {
      await persistEmployeeRows(nextRows);
      setSelectedEmployee(terminatedEmployee);
      setActionMode("detail");
      setFormMessage(`${employee.name} 已標記為離職，員工資料已同步至 Supabase。`);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "寫入 Supabase 失敗。");
    }
  }

  function handleImportFile(file: File | undefined) {
    setImportPreviewRows([]);
    setImportErrors([]);
    setImportMessage("");

    if (!file) {
      setImportFileName("");
      return;
    }

    setImportFileName(file.name);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportErrors(["目前前端匯入先支援 CSV。請下載範本填寫後再匯入，Excel 檔可另存為 CSV。"]);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = parseEmployeesCsv(String(reader.result ?? ""));
      setImportPreviewRows(result.rows);
      setImportErrors(result.errors);
      const validCount = result.rows.filter((row) => row.errors.length === 0).length;
      const errorCount = result.rows.length - validCount + result.errors.length;
      setImportMessage(`已讀取 ${result.rows.length} 筆，${validCount} 筆可匯入，${errorCount} 筆需修正。`);
    };
    reader.onerror = () => {
      setImportErrors(["讀取檔案失敗，請重新選擇 CSV 檔。"]);
    };
    reader.readAsText(file, "utf-8");
  }

  async function confirmImport() {
    const validRows = importPreviewRows.filter((row) => row.errors.length === 0).map((row) => row.employee);
    if (!validRows.length) {
      setImportErrors(["目前沒有通過檢查的資料可匯入。"]);
      return;
    }

    const mergedRows = [...employeeRows];
    validRows.forEach((employee) => {
      const existingIndex = mergedRows.findIndex((row) => row.employeeNo === employee.employeeNo);
      if (existingIndex >= 0) {
        mergedRows[existingIndex] = employee;
      } else {
        mergedRows.unshift(employee);
      }
    });

    try {
      await persistEmployeeRows(mergedRows);
      setSelectedEmployee(validRows[0] ?? selectedEmployee);
      setActionMode("detail");
      setImportMessage(`已匯入 ${validRows.length} 筆員工資料，員工編號相同者已更新並寫入 Supabase。`);
      setImportPreviewRows([]);
      setImportErrors([]);
      setImportFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : "匯入寫入 Supabase 失敗。"]);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">EMPLOYEE MASTER</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">員工管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {canManageEmployees
              ? "集中管理員工主檔、任職狀態、部門據點歸屬與聯絡資訊。"
              : "主管安全視圖只顯示部門管理必要資訊，個資、薪資與緊急聯絡資料不在列表揭露。"}
          </p>
          {dataMessage ? <p className="mt-2 text-sm font-semibold text-rose-700">{dataMessage}</p> : null}
          {isLoading ? <p className="mt-2 text-sm text-muted-foreground">正在從 Supabase 讀取員工資料...</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageEmployees ? (
            <>
              <Button variant="outline" onClick={handleTemplateDownload}>
                <FileDown className="h-4 w-4" />
                下載範本
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                批次匯入
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4" />
                匯出 Excel
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download className="h-4 w-4" />
                匯出 CSV
              </Button>
              <Button onClick={startCreate}>
                <Plus className="h-4 w-4" />
                新增員工
              </Button>
            </>
          ) : (
            <Badge variant="secondary">主管安全視圖：已隱藏敏感個資與匯出維護功能</Badge>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => handleImportFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">總員工數</div>
            <div className="mt-2 text-2xl font-black">{employeeRows.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">在職</div>
            <div className="mt-2 text-2xl font-black">
              {employeeRows.filter((employee) => employee.status === "active").length}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">據點數</div>
            <div className="mt-2 text-2xl font-black">{uniqueOptions(employeeRows, "branch").length - 1}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">目前列表</div>
            <div className="mt-2 text-2xl font-black">{filteredEmployees.length}</div>
          </CardContent>
        </Card>
        {canManageEmployees ? (
          <>
            <Card className="rounded-lg">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">主檔平均完整度</div>
                <div className="mt-2 text-2xl font-black">{completenessSummary.averageScore}%</div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-emerald-600"
                    style={{ width: `${completenessSummary.averageScore}%` }}
                  />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">缺件 / 阻擋</div>
                <div className="mt-2 text-2xl font-black">
                  {completenessSummary.incompleteCount}
                  <span className="text-base text-rose-600"> / {completenessSummary.blockedCount}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  薪資 {completenessSummary.payrollBlockedCount}、排班 {completenessSummary.schedulingBlockedCount}、評鑑{" "}
                  {completenessSummary.evaluationBlockedCount}
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </section>

      {canManageEmployees ? (
        <Card className="rounded-lg border-amber-200 bg-amber-50/70">
          <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex gap-3">
              <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <div className="font-black text-amber-950">員工主檔完整度檢核</div>
                <p className="mt-1 text-sm text-amber-900">
                  低於完整度的資料會影響薪資結算、排班、簽核、長照評鑑清冊與緊急聯絡。請優先補齊紅色「阻擋」項目。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-amber-950">
              <span className="rounded-full bg-white px-3 py-1">薪資阻擋 {completenessSummary.payrollBlockedCount}</span>
              <span className="rounded-full bg-white px-3 py-1">排班阻擋 {completenessSummary.schedulingBlockedCount}</span>
              <span className="rounded-full bg-white px-3 py-1">評鑑缺口 {completenessSummary.evaluationBlockedCount}</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg border-emerald-200 bg-emerald-50/70">
          <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="font-black text-emerald-950">主管個資保護視圖</div>
              <p className="mt-1 text-sm text-emerald-800">
                這裡只保留員工編號、姓名、部門、據點、職稱、到職日與任職狀態。手機、Email、身分資料、地址、緊急聯絡人、薪資與完整度缺件已隱藏。
              </p>
            </div>
            <Badge className="w-fit bg-emerald-600">最小必要揭露</Badge>
          </CardContent>
        </Card>
      )}

      {canManageEmployees ? (
        <Card className="rounded-lg border-[#ead8c2] bg-white shadow-sm">
          <CardHeader className="border-b border-[#ead8c2]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-[#b45309]" />
                  主檔補齊工作清單
                </CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  依阻擋數與完整度排序，直接告訴人資先補誰、缺什麼、會解鎖哪個流程。
                </p>
              </div>
              <Badge className="w-fit bg-[#b45309]">{focusLabel(completenessFocus)} {completenessActionRows.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap gap-2">
              {([
                ["blocked", `阻擋優先 ${completenessSummary.blockedCount}`],
                ["payroll", `薪資阻擋 ${completenessSummary.payrollBlockedCount}`],
                ["scheduling", `排班阻擋 ${completenessSummary.schedulingBlockedCount}`],
                ["evaluation", `評鑑缺口 ${completenessSummary.evaluationBlockedCount}`],
                ["all", `全部缺件 ${completenessSummary.incompleteCount}`],
              ] as Array<[CompletenessFocus, string]>).map(([focus, label]) => (
                <button
                  key={focus}
                  type="button"
                  onClick={() => setCompletenessFocus(focus)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                    completenessFocus === focus
                      ? "border-[#d97706] bg-[#fff3de] text-[#8a4b06]"
                      : "border-[#ead8c2] bg-white text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              {completenessActionRows.slice(0, 6).map((row, index) => (
                <div key={row.employee.employeeNo} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
                  <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-sm font-black text-[#8a4b06]">
                      #{index + 1}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-950">{row.employee.name}</span>
                        <span className="text-sm text-slate-500">{row.employee.employeeNo}</span>
                        <Badge className={completenessBadgeClass(row.completeness.status)}>
                          {completenessLabel(row.completeness)} {row.completeness.score}%
                        </Badge>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-rose-700">
                          {row.blockingText}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{row.firstImpact}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.missingTop.map((issue) => (
                          <span
                            key={`${row.employee.employeeNo}-${issue.field}`}
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              issue.severity === "blocking"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            補 {issue.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedEmployee(row.employee);
                          setActionMode("detail");
                        }}
                      >
                        查看缺口
                      </Button>
                      <Button size="sm" onClick={() => startEdit(row.employee)}>
                        <Pencil className="h-3.5 w-3.5" />
                        補資料
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {completenessActionRows.length === 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                  目前此分類沒有待補員工。可以切換其他分類，或進行薪資/排班前置檢核。
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            搜尋與篩選
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={canViewSensitiveEmployees ? "搜尋員工編號、姓名、手機、Email" : "搜尋員工編號、姓名、部門、據點、職稱"}
                className="pl-9"
              />
            </div>
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="部門篩選"
            >
              {uniqueOptions(employeeRows, "department").map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="據點篩選"
            >
              {uniqueOptions(employeeRows, "branch").map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="職稱篩選"
            >
              {uniqueOptions(employeeRows, "position").map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as EmployeeStatus | typeof allOption)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="在職狀態篩選"
            >
              <option>{allOption}</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={resetFilters}>
              <RefreshCcw className="h-4 w-4" />
              重置
            </Button>
          </div>

          {importFileName || importMessage || importErrors.length ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                {importFileName ? `匯入檔案：${importFileName}` : "匯入檢查"}
              </div>
              {importMessage ? <div className="mt-2 text-muted-foreground">{importMessage}</div> : null}
              {importErrors.length ? (
                <div className="mt-2 space-y-1 text-rose-700">
                  {importErrors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {importPreviewRows.length ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-bold">匯入預覽</div>
                  <div className="text-sm text-muted-foreground">確認欄位檢查通過後，才會寫入員工主檔。</div>
                </div>
                <Button onClick={confirmImport}>確認匯入有效資料</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/70 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">列號</th>
                      <th className="px-3 py-2">員工編號</th>
                      <th className="px-3 py-2">姓名</th>
                      <th className="px-3 py-2">部門</th>
                      <th className="px-3 py-2">據點</th>
                      <th className="px-3 py-2">檢查結果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreviewRows.slice(0, 8).map((row) => (
                      <tr key={`${row.rowNumber}-${row.employee.employeeNo}`} className="bg-card">
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-semibold">{row.employee.employeeNo || "未填"}</td>
                        <td className="px-3 py-2">{row.employee.name || "未填"}</td>
                        <td className="px-3 py-2">{row.employee.department || "未填"}</td>
                        <td className="px-3 py-2">{row.employee.branch || "未填"}</td>
                        <td className="px-3 py-2">
                          {row.errors.length ? (
                            <span className="text-rose-700">{row.errors.join("；")}</span>
                          ) : (
                            <Badge className="bg-emerald-600">可匯入</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPreviewRows.length > 8 ? (
                <div className="text-xs text-muted-foreground">只顯示前 8 筆預覽，其餘資料會一併檢查。</div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            {actionMode === "create"
              ? "新增員工"
              : actionMode === "edit"
                ? "編輯員工"
                : "員工詳細資料"}
          </CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="secondary">
              {actionMode === "create" ? "新增模式" : selectedEmployee?.employeeNo ?? "未選擇"}
            </Badge>
            {actionMode === "detail" && selectedEmployee && canManageEmployees ? (
              <>
                <Button size="sm" variant="outline" onClick={() => startEdit(selectedEmployee)}>
                  <Pencil className="h-4 w-4" />
                  編輯
                </Button>
                {selectedEmployee.status !== "terminated" ? (
                  <Button size="sm" variant="outline" onClick={() => markTerminated(selectedEmployee)}>
                    <UserX className="h-4 w-4" />
                    標記離職
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {formMessage && actionMode === "detail" ? (
            <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
              {formMessage}
            </div>
          ) : null}
          {actionMode === "create" || actionMode === "edit" ? (
            <div className="space-y-5">
              {formMessage ? (
                <div
                  className={`rounded-lg p-3 text-sm font-semibold ${
                    Object.keys(formErrors).length > 0
                      ? "bg-rose-50 text-rose-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {formMessage}
                </div>
              ) : null}

              <div className="rounded-lg border p-4">
                <div className="mb-4 text-base font-black">基本資料</div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField
                    label="員工編號"
                    field="employeeNo"
                    required
                    value={form.employeeNo}
                    error={formErrors.employeeNo}
                    placeholder="例：HC-052"
                    onChange={(value) => updateForm("employeeNo", value)}
                  />
                  <FormField
                    label="中文姓名"
                    field="name"
                    required
                    value={form.name}
                    error={formErrors.name}
                    placeholder="例：陳小悅"
                    onChange={(value) => updateForm("name", value)}
                  />
                  <FormField
                    label="英文姓名"
                    field="englishName"
                    value={form.englishName}
                    error={formErrors.englishName}
                    placeholder="例：Hsiao-Yue Chen"
                    onChange={(value) => updateForm("englishName", value)}
                  />
                  <FormField
                    label="身分證字號"
                    field="nationalId"
                    required
                    value={form.nationalId}
                    error={formErrors.nationalId}
                    placeholder="例：A123456789"
                    onChange={(value) => updateForm("nationalId", value.toUpperCase())}
                  />
                  <FormField
                    label="生日"
                    field="birthday"
                    required
                    type="date"
                    value={form.birthday}
                    error={formErrors.birthday}
                    onChange={(value) => updateForm("birthday", value)}
                  />
                  <FormField label="性別" field="gender" required error={formErrors.gender}>
                    <select
                      id="gender"
                      value={form.gender}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("gender", event.target.value as Gender)}
                    >
                      {Object.entries(genderLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    label="手機"
                    field="phone"
                    required
                    value={form.phone}
                    error={formErrors.phone}
                    placeholder="例：0912-345-678"
                    onChange={(value) => updateForm("phone", value)}
                  />
                  <FormField
                    label="Email"
                    field="email"
                    required
                    type="email"
                    value={form.email}
                    error={formErrors.email}
                    placeholder="name@example.com"
                    onChange={(value) => updateForm("email", value)}
                  />
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-4 text-base font-black">聯絡與緊急聯絡人</div>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    label="戶籍地址"
                    field="registeredAddress"
                    required
                    value={form.registeredAddress}
                    error={formErrors.registeredAddress}
                    placeholder="請輸入戶籍地址"
                    onChange={(value) => updateForm("registeredAddress", value)}
                  />
                  <FormField
                    label="通訊地址"
                    field="mailingAddress"
                    required
                    value={form.mailingAddress}
                    error={formErrors.mailingAddress}
                    placeholder="請輸入通訊地址"
                    onChange={(value) => updateForm("mailingAddress", value)}
                  />
                  <FormField
                    label="緊急聯絡人"
                    field="emergencyContact"
                    required
                    value={form.emergencyContact}
                    error={formErrors.emergencyContact}
                    placeholder="例：陳小明"
                    onChange={(value) => updateForm("emergencyContact", value)}
                  />
                  <FormField
                    label="緊急聯絡人電話"
                    field="emergencyPhone"
                    required
                    value={form.emergencyPhone}
                    error={formErrors.emergencyPhone}
                    placeholder="例：0912-000-000"
                    onChange={(value) => updateForm("emergencyPhone", value)}
                  />
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-4 text-base font-black">任職資料</div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField
                    label="到職日"
                    field="hireDate"
                    required
                    type="date"
                    value={form.hireDate}
                    error={formErrors.hireDate}
                    onChange={(value) => updateForm("hireDate", value)}
                  />
                  <FormField
                    label="離職日"
                    field="terminationDate"
                    type="date"
                    value={form.terminationDate}
                    error={formErrors.terminationDate}
                    onChange={(value) => updateForm("terminationDate", value)}
                  />
                  <FormField label="公司" field="company" required error={formErrors.company}>
                    <input
                      id="company"
                      list="company-options"
                      value={form.company}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("company", event.target.value)}
                    />
                  </FormField>
                  <FormField label="據點" field="branch" required error={formErrors.branch}>
                    <input
                      id="branch"
                      list="branch-options"
                      value={form.branch}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("branch", event.target.value)}
                    />
                  </FormField>
                  <FormField label="部門" field="department" required error={formErrors.department}>
                    <input
                      id="department"
                      list="department-options"
                      value={form.department}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("department", event.target.value)}
                    />
                  </FormField>
                  <FormField label="職稱" field="position" required error={formErrors.position}>
                    <input
                      id="position"
                      list="position-options"
                      value={form.position}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("position", event.target.value)}
                    />
                  </FormField>
                  <FormField label="直屬主管" field="supervisor" required error={formErrors.supervisor}>
                    <input
                      id="supervisor"
                      list="supervisor-options"
                      value={form.supervisor}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("supervisor", event.target.value)}
                    />
                  </FormField>
                  <FormField label="員工狀態" field="status" required error={formErrors.status}>
                    <select
                      id="status"
                      value={form.status}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => updateForm("status", event.target.value as EmployeeStatus)}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </div>

              <datalist id="company-options">
                {selectOptions.companies.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="branch-options">
                {selectOptions.branches.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="department-options">
                {selectOptions.departments.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="position-options">
                {selectOptions.positions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="supervisor-options">
                {selectOptions.supervisors.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedEmployee) {
                      setActionMode("detail");
                    } else {
                      const fallbackEmployee = employeeRows[0] ?? null;
                      setSelectedEmployee(fallbackEmployee);
                      setActionMode(fallbackEmployee ? "detail" : "create");
                    }
                    setFormErrors({});
                    setFormMessage("");
                  }}
                >
                  取消
                </Button>
                <Button onClick={handleFormSubmit}>
                  {actionMode === "create" ? "建立員工" : "儲存變更"}
                </Button>
              </div>
            </div>
          ) : selectedEmployee ? (
            <div className="space-y-4">
              {selectedCompleteness && canManageEmployees ? (
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 xl:grid-cols-[260px_1fr]">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black">資料完整度</div>
                      <Badge className={completenessBadgeClass(selectedCompleteness.status)}>
                        {completenessLabel(selectedCompleteness)}
                      </Badge>
                    </div>
                    <div className="mt-3 text-3xl font-black">{selectedCompleteness.score}%</div>
                    <div className="mt-2 h-2 rounded-full bg-background">
                      <div
                        className={`h-2 rounded-full ${
                          selectedCompleteness.status === "complete"
                            ? "bg-emerald-600"
                            : selectedCompleteness.status === "attention"
                              ? "bg-amber-500"
                              : "bg-rose-600"
                        }`}
                        style={{ width: `${selectedCompleteness.score}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      已完成 {selectedCompleteness.completed}/{selectedCompleteness.total} 項，阻擋{" "}
                      {selectedCompleteness.blockers} 項，提醒 {selectedCompleteness.warnings} 項。
                    </div>
                    {selectedCompleteness.missing.length ? (
                      <Button className="mt-3 w-full" size="sm" onClick={() => startEdit(selectedEmployee)}>
                        <Pencil className="h-3.5 w-3.5" />
                        立即補齊資料
                      </Button>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-xs font-bold">
                      <span
                        className={`rounded-full px-3 py-1 ${
                          selectedCompleteness.payrollReady
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        薪資結算 {selectedCompleteness.payrollReady ? "可用" : "待補"}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 ${
                          selectedCompleteness.schedulingReady
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        排班出勤 {selectedCompleteness.schedulingReady ? "可用" : "待補"}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 ${
                          selectedCompleteness.evaluationReady
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        評鑑清冊 {selectedCompleteness.evaluationReady ? "可用" : "待補"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {selectedMissingGroups &&
                      (Object.keys(completenessGroupLabels) as CompletenessGroup[]).map((group) => {
                        const issues = selectedMissingGroups[group];
                        return (
                          <div key={group} className="rounded-lg border bg-card p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-bold">{completenessGroupLabels[group]}</div>
                              {issues.length ? (
                                <Badge variant="outline">{issues.length} 項</Badge>
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              )}
                            </div>
                            {issues.length ? (
                              <div className="mt-3 space-y-2">
                                {issues.map((issue) => (
                                  <div key={`${issue.group}-${issue.field}`} className="rounded-md bg-muted/60 p-2">
                                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                                      {issue.severity === "blocking" ? (
                                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                                      ) : (
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                      )}
                                      {issue.label}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{issue.impact}</div>
                                    <Button
                                      className="mt-2 h-7 px-2 text-xs"
                                      variant="outline"
                                      onClick={() => startEdit(selectedEmployee)}
                                    >
                                      補這項
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-3 text-sm text-muted-foreground">此區資料已完整。</div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ["員工編號", selectedEmployee.employeeNo],
                  ["姓名", selectedEmployee.name],
                  ["英文姓名", restrictedValue(canViewSensitiveEmployees, selectedEmployee.englishName, maskText(selectedEmployee.englishName, 2))],
                  ["身分證字號", restrictedValue(canViewSensitiveEmployees, selectedEmployee.nationalId, maskNationalId(selectedEmployee.nationalId))],
                  ["生日", restrictedValue(canViewSensitiveEmployees, selectedEmployee.birthday, "已遮罩")],
                  ["性別", canViewSensitiveEmployees ? genderLabels[selectedEmployee.gender] : "已遮罩"],
                  ["公司", selectedEmployee.company],
                  ["部門", selectedEmployee.department],
                  ["據點", selectedEmployee.branch],
                  ["職稱", selectedEmployee.position],
                  ["直屬主管", selectedEmployee.supervisor],
                  ["到職日", selectedEmployee.hireDate],
                  ["離職日", selectedEmployee.terminationDate || "未設定"],
                  ["手機", restrictedValue(canViewSensitiveEmployees, selectedEmployee.phone, maskPhone(selectedEmployee.phone))],
                  ["Email", restrictedValue(canViewSensitiveEmployees, selectedEmployee.email, maskEmail(selectedEmployee.email))],
                  ["戶籍地址", restrictedValue(canViewSensitiveEmployees, selectedEmployee.registeredAddress, maskText(selectedEmployee.registeredAddress, 3))],
                  ["通訊地址", restrictedValue(canViewSensitiveEmployees, selectedEmployee.mailingAddress, maskText(selectedEmployee.mailingAddress, 3))],
                  ["緊急聯絡人", restrictedValue(canViewSensitiveEmployees, selectedEmployee.emergencyContact, maskText(selectedEmployee.emergencyContact, 1))],
                  ["緊急聯絡人電話", restrictedValue(canViewSensitiveEmployees, selectedEmployee.emergencyPhone, maskPhone(selectedEmployee.emergencyPhone))],
                  ["狀態", statusLabels[selectedEmployee.status]],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 font-bold">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>員工列表</CardTitle>
          <Badge variant="secondary">{filteredEmployees.length} 筆資料</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm ${canViewSensitiveEmployees ? "min-w-[1120px]" : "min-w-[860px]"}`}>
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    {[
                      ["employeeNo", "員工編號"],
                      ["name", "姓名"],
                      ["department", "部門"],
                      ["branch", "據點"],
                      ["position", "職稱"],
                      ["hireDate", "到職日"],
                      ["status", "狀態"],
                    ].map(([key, label]) => (
                      <th key={key} className="px-4 py-3 font-bold">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-left"
                          onClick={() => handleSort(key as SortKey)}
                        >
                          {label}
                          {sortKey === key ? (
                            <span className="text-[10px]">{sortDirection === "asc" ? "▲" : "▼"}</span>
                          ) : null}
                        </button>
                      </th>
                    ))}
                    {canViewSensitiveEmployees ? <th className="px-4 py-3 font-bold">手機</th> : null}
                    {canViewSensitiveEmployees ? <th className="px-4 py-3 font-bold">Email</th> : null}
                    {canManageEmployees ? <th className="px-4 py-3 font-bold">完整度</th> : null}
                    <th className="px-4 py-3 text-right font-bold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredEmployees.map((employee) => {
                    const completeness = completenessByEmployeeNo.get(employee.employeeNo) ?? getEmployeeCompleteness(employee);
                    return (
                      <tr key={employee.employeeNo} className="bg-card hover:bg-muted/40">
                        <td className="px-4 py-3 font-semibold">{employee.employeeNo}</td>
                        <td className="px-4 py-3 font-bold">{employee.name}</td>
                        <td className="px-4 py-3">{employee.department}</td>
                        <td className="px-4 py-3">{employee.branch}</td>
                        <td className="px-4 py-3">{employee.position}</td>
                        <td className="px-4 py-3">{employee.hireDate}</td>
                        <td className="px-4 py-3">
                          <Badge className={statusClassNames[employee.status]}>
                            {statusLabels[employee.status]}
                          </Badge>
                        </td>
                        {canViewSensitiveEmployees ? <td className="px-4 py-3">{employee.phone}</td> : null}
                        {canViewSensitiveEmployees ? <td className="px-4 py-3 text-muted-foreground">{employee.email}</td> : null}
                        {canManageEmployees ? (
                          <td className="px-4 py-3">
                            <div className="min-w-[132px]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-black">{completeness.score}%</span>
                                <Badge className={completenessBadgeClass(completeness.status)}>
                                  {completenessLabel(completeness)}
                                </Badge>
                              </div>
                              <div className="mt-2 h-1.5 rounded-full bg-muted">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    completeness.status === "complete"
                                      ? "bg-emerald-600"
                                      : completeness.status === "attention"
                                        ? "bg-amber-500"
                                        : "bg-rose-600"
                                  }`}
                                  style={{ width: `${completeness.score}%` }}
                                />
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                缺 {completeness.missing.length}，阻擋 {completeness.blockers}
                              </div>
                            </div>
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label={`查看 ${employee.name} 詳細資料`}
                            >
                              <Link href={`/employees/${encodeURIComponent(employee.employeeNo)}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            {canManageEmployees ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`編輯 ${employee.name}`}
                                  onClick={() => startEdit(employee)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {employee.status !== "terminated" ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`標記 ${employee.name} 離職`}
                                    onClick={() => markTerminated(employee)}
                                  >
                                    <UserX className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </>
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

          {filteredEmployees.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              找不到符合條件的員工，請調整搜尋或篩選條件。
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
