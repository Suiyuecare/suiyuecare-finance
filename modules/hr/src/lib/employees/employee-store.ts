import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Employee, EmployeeStatus, Gender } from "@/lib/employees/mock-data";

type SupabaseClient = {
  // The generated Database type in this repo is older than the live HR schema.
  // Keep this adapter local until the generated type is refreshed from Supabase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type EmployeeRow = {
  id: string;
  company_id: string;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  position_id: string | null;
  manager_employee_id: string | null;
  employee_no: string;
  full_name: string;
  english_name: string | null;
  national_id_cipher: string | null;
  birthday: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: {
    registered?: string;
    mailing?: string;
  } | null;
  emergency_contact: {
    name?: string;
    phone?: string;
  } | null;
  hire_date: string | null;
  termination_date: string | null;
  employment_status: string;
  companies?: { name: string | null } | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
  positions?: { title: string | null } | null;
  manager?: { full_name: string | null } | null;
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Supabase 尚未設定，無法讀寫員工主檔。");
  }
  return supabase as unknown as SupabaseClient;
}

function normalizeGender(value: string | null): Gender {
  if (value === "female" || value === "male") return value;
  return "not_disclosed";
}

function normalizeStatus(value: string | null): EmployeeStatus {
  if (value === "active" || value === "on_leave" || value === "suspended" || value === "terminated") return value;
  return "active";
}

function mapEmployeeRow(row: EmployeeRow): Employee {
  return {
    employeeNo: row.employee_no,
    name: row.full_name,
    englishName: row.english_name ?? "",
    nationalId: row.national_id_cipher ?? "",
    birthday: row.birthday ?? "",
    gender: normalizeGender(row.gender),
    department: row.departments?.name ?? "",
    branch: row.branches?.name ?? "",
    position: row.positions?.title ?? "",
    hireDate: row.hire_date ?? "",
    terminationDate: row.termination_date ?? "",
    company: row.companies?.name ?? "",
    supervisor: row.manager?.full_name ?? "",
    status: normalizeStatus(row.employment_status),
    phone: row.phone ?? "",
    email: row.email ?? "",
    registeredAddress: row.address?.registered ?? "",
    mailingAddress: row.address?.mailing ?? "",
    emergencyContact: row.emergency_contact?.name ?? "",
    emergencyPhone: row.emergency_contact?.phone ?? "",
  };
}

async function findIdByName(
  supabase: SupabaseClient,
  table: "companies" | "branches" | "departments" | "positions" | "employees",
  field: "name" | "title" | "full_name",
  value: string,
  companyId?: string,
) {
  if (!value.trim()) return null;
  let query = supabase.from(table).select("id").eq(field, value.trim()).is("deleted_at", null).limit(1);
  if (companyId && table !== "companies") query = query.eq("company_id", companyId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

async function getDefaultCompanyId(supabase: SupabaseClient, companyName: string) {
  const matchedId = await findIdByName(supabase, "companies", "name", companyName);
  if (matchedId) return matchedId;

  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

async function upsertEmployee(supabase: SupabaseClient, employee: Employee) {
  const companyId = await getDefaultCompanyId(supabase, employee.company);
  if (!companyId) throw new Error("找不到公司主檔，請先在 Supabase 建立 companies 資料。");

  const branchId = await findIdByName(supabase, "branches", "name", employee.branch, companyId);
  const departmentId = await findIdByName(supabase, "departments", "name", employee.department, companyId);
  const positionId = await findIdByName(supabase, "positions", "title", employee.position, companyId);
  const managerId = employee.supervisor
    ? await findIdByName(supabase, "employees", "full_name", employee.supervisor, companyId)
    : null;

  const payload = {
    company_id: companyId,
    primary_branch_id: branchId,
    primary_department_id: departmentId,
    position_id: positionId,
    manager_employee_id: managerId,
    employee_no: employee.employeeNo.trim(),
    full_name: employee.name.trim(),
    english_name: employee.englishName.trim() || null,
    national_id_cipher: employee.nationalId.trim() || null,
    birthday: employee.birthday || null,
    gender: employee.gender,
    phone: employee.phone.trim() || null,
    email: employee.email.trim() || null,
    address: {
      registered: employee.registeredAddress,
      mailing: employee.mailingAddress,
    },
    emergency_contact: {
      name: employee.emergencyContact,
      phone: employee.emergencyPhone,
    },
    hire_date: employee.hireDate || null,
    termination_date: employee.terminationDate || null,
    employment_status: employee.status,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("employees")
    .upsert(payload, { onConflict: "company_id,employee_no" });
  if (error) throw error;
}

export async function loadEmployees() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id,
      company_id,
      primary_branch_id,
      primary_department_id,
      position_id,
      manager_employee_id,
      employee_no,
      full_name,
      english_name,
      national_id_cipher,
      birthday,
      gender,
      phone,
      email,
      address,
      emergency_contact,
      hire_date,
      termination_date,
      employment_status,
      companies(name),
      branches(name),
      departments(name),
      positions(title),
      manager:employees!employees_manager_employee_id_fkey(full_name)
    `)
    .is("deleted_at", null)
    .order("employee_no", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as EmployeeRow[]).map(mapEmployeeRow);
}

export async function saveEmployees(employees: Employee[]) {
  const supabase = getClient();
  for (const employee of employees) {
    await upsertEmployee(supabase, employee);
  }
}
