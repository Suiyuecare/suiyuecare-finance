"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type EmployeeRosterContractRow = {
  employeeId: string;
  companyId: string;
  employeeNo: string;
  name: string;
  company: string;
  branch: string;
  department: string;
  position: string;
  hireDate: string;
  status: string;
  contractId: string;
  contractTitle: string;
  contractPath: string;
  contractUploadedAt: string;
  contractStatus: "已上傳" | "缺契約";
};

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string | null;
  full_name: string | null;
  hire_date: string | null;
  employment_status: string | null;
  companies: { name: string | null } | null;
  branches: { name: string | null } | null;
  departments: { name: string | null } | null;
  positions: { title: string | null } | null;
};

type DocumentRow = {
  id: string;
  employee_id: string | null;
  title: string | null;
  storage_path: string | null;
  status: string | null;
  created_at: string | null;
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫員工契約。");
  return supabase;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

export async function loadEmployeeRosterContracts() {
  const supabase = getClient();
  // The generated Database type is older than the live schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: employeeRows, error: employeeError } = await (supabase as any)
    .from("employees")
    .select(`
      id,
      company_id,
      employee_no,
      full_name,
      hire_date,
      employment_status,
      companies(name),
      branches(name),
      departments(name),
      positions(title)
    `)
    .is("deleted_at", null)
    .order("employee_no", { ascending: true });

  if (employeeError) throw employeeError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: documentRows, error: documentError } = await (supabase as any)
    .from("documents")
    .select("id, employee_id, title, storage_path, status, created_at")
    .eq("document_type", "contract")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (documentError) throw documentError;

  const latestContractByEmployee = new Map<string, DocumentRow>();
  ((documentRows ?? []) as DocumentRow[]).forEach((document) => {
    if (!document.employee_id || latestContractByEmployee.has(document.employee_id)) return;
    latestContractByEmployee.set(document.employee_id, document);
  });

  return ((employeeRows ?? []) as EmployeeRow[]).map((employee): EmployeeRosterContractRow => {
    const contract = latestContractByEmployee.get(employee.id);
    return {
      employeeId: employee.id,
      companyId: employee.company_id,
      employeeNo: employee.employee_no ?? "",
      name: employee.full_name ?? "",
      company: employee.companies?.name ?? "",
      branch: employee.branches?.name ?? "",
      department: employee.departments?.name ?? "",
      position: employee.positions?.title ?? "",
      hireDate: employee.hire_date ?? "",
      status: employee.employment_status ?? "",
      contractId: contract?.id ?? "",
      contractTitle: contract?.title ?? "",
      contractPath: contract?.storage_path ?? "",
      contractUploadedAt: formatDateTime(contract?.created_at ?? null),
      contractStatus: contract ? "已上傳" : "缺契約",
    };
  });
}

export async function uploadLaborContract(input: {
  employee: EmployeeRosterContractRow;
  file: File;
  uploadedByUserId: string;
  issuedAt: string;
}) {
  const supabase = getClient();
  const safeFileName = input.file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const storagePath = `contracts/${input.employee.employeeNo || input.employee.employeeId}/${Date.now()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("hr-documents")
    .upload(storagePath, input.file, {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: documentError } = await (supabase as any)
    .from("documents")
    .insert({
      company_id: input.employee.companyId,
      employee_id: input.employee.employeeId,
      uploaded_by: input.uploadedByUserId || null,
      document_type: "contract",
      title: `勞動契約-${input.employee.employeeNo}-${input.employee.name}`,
      storage_bucket: "hr-documents",
      storage_path: storagePath,
      mime_type: input.file.type || null,
      file_size: input.file.size,
      issued_at: input.issuedAt || null,
      status: "active",
    });
  if (documentError) throw documentError;

  return storagePath;
}

export async function createContractSignedUrl(storagePath: string) {
  const supabase = getClient();
  const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
