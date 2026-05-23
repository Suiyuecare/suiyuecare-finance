export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type HrRole =
  | "team_member"
  | "supervisor"
  | "hr"
  | "admin_director"
  | "ceo";

export type Database = {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          code: string;
          name: string;
          legal_name: string | null;
          tax_id: string | null;
          industry: string;
          status: string;
          timezone: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["companies"]["Row"]> & {
          id: string;
          code: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
      };
      branches: {
        Row: {
          id: string;
          company_id: string;
          parent_branch_id: string | null;
          code: string;
          name: string;
          branch_type: "headquarters" | "branch" | "site" | "homecare_station" | "daycare_center";
          phone: string | null;
          address: Json;
          geo_location: Json;
          manager_id: string | null;
          status: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["branches"]["Row"]> & {
          id: string;
          company_id: string;
          code: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["branches"]["Row"]>;
      };
      departments: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          parent_department_id: string | null;
          code: string;
          name: string;
          department_type: "administration" | "hr" | "finance" | "homecare" | "daycare" | "operations" | "support";
          manager_id: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["departments"]["Row"]> & {
          id: string;
          company_id: string;
          code: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Row"]>;
      };
      teams: {
        Row: {
          id: string;
          company_id: string;
          branch_id: string | null;
          department_id: string;
          code: string;
          name: string;
          team_type: "general" | "homecare_supervision" | "homecare_worker" | "daycare_shift" | "admin";
          supervisor_id: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["teams"]["Row"]> & {
          id: string;
          company_id: string;
          department_id: string;
          code: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
      };
      module_users: {
        Row: {
          id: string;
          auth_user_id: string | null;
          employee_no: string | null;
          name: string;
          email: string;
          entity_id: string;
          company_id: string | null;
          primary_branch_id: string | null;
          primary_department_id: string | null;
          primary_team_id: string | null;
          department_code: string;
          role: HrRole;
          role_label: string | null;
          status: string;
          hire_date: string | null;
          termination_date: string | null;
          manager_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["module_users"]["Row"]> & {
          id: string;
          name: string;
          email: string;
          entity_id: string;
          department_code: string;
          role: HrRole;
        };
        Update: Partial<Database["public"]["Tables"]["module_users"]["Row"]>;
      };
      hr_requests: {
        Row: {
          id: string;
          no: string;
          request_type: string;
          applicant_id: string;
          entity_id: string;
          department_code: string;
          status: string;
          current_step: number;
          started_at: string | null;
          ended_at: string | null;
          total_hours: number | null;
          payload: Json;
          files: Json;
          compliance_result: Json;
          finance_handoff_status: string;
          finance_reference_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["hr_requests"]["Row"]> & {
          id: string;
          no: string;
          request_type: string;
          applicant_id: string;
          entity_id: string;
          department_code: string;
        };
        Update: Partial<Database["public"]["Tables"]["hr_requests"]["Row"]>;
      };
      employee_branch_assignments: {
        Row: {
          id: string;
          employee_id: string;
          company_id: string;
          branch_id: string;
          department_id: string | null;
          team_id: string | null;
          assignment_type: "primary" | "support" | "temporary" | "training";
          position_title: string | null;
          effective_from: string;
          effective_to: string | null;
          weekly_hours: number | null;
          is_active: boolean;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["employee_branch_assignments"]["Row"]> & {
          employee_id: string;
          company_id: string;
          branch_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["employee_branch_assignments"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      hr_role: HrRole;
    };
  };
};
