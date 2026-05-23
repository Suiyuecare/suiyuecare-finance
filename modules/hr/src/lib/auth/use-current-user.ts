"use client";

import { useEffect, useState } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import {
  getQuickLoginUser,
  quickLoginChangedEvent,
  unauthenticatedUser,
} from "@/lib/auth/current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { toCanonicalRole } from "@/lib/auth/rbac";

type UserProfileRow = {
  id: string;
  email: string;
  display_name: string;
  company_id: string | null;
  roles: { key: string | null; name: string | null } | null;
  employees: {
    primary_branch_id: string | null;
    primary_department_id: string | null;
    primary_team_id: string | null;
    departments: { code: string | null } | null;
  } | null;
};

function mapProfile(row: UserProfileRow): CurrentUser {
  const role = toCanonicalRole(row.roles?.key);
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    role,
    roleLabel: row.roles?.name ?? "員工",
    companyId: row.company_id ?? "",
    primaryBranchId: row.employees?.primary_branch_id ?? "",
    departmentCode: row.employees?.departments?.code ?? "",
    departmentId: row.employees?.primary_department_id ?? undefined,
    teamId: row.employees?.primary_team_id ?? undefined,
    supportBranchIds: [],
  };
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser>(() => getQuickLoginUser() ?? unauthenticatedUser);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const quickLoginUser = getQuickLoginUser();
      if (quickLoginUser) {
        if (isMounted) setUser(quickLoginUser);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) {
        if (isMounted) setUser(unauthenticatedUser);
        return;
      }

      // The generated Database type in this repo is older than the live HR schema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("users")
        .select(`
          id,
          email,
          display_name,
          company_id,
          roles(key, name),
          employees(
            primary_branch_id,
            primary_department_id,
            primary_team_id,
            departments(code)
          )
        `)
        .eq("auth_user_id", authUser.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!isMounted) return;
      if (error || !data) {
        setUser(unauthenticatedUser);
        return;
      }

      setUser(mapProfile(data as UserProfileRow));
    }

    void loadProfile();

    function handleQuickLoginChange() {
      const quickLoginUser = getQuickLoginUser();
      if (quickLoginUser) {
        setUser(quickLoginUser);
        return;
      }
      void loadProfile();
    }

    window.addEventListener(quickLoginChangedEvent, handleQuickLoginChange);

    const supabase = getSupabaseBrowserClient();
    const subscription = supabase?.auth.onAuthStateChange(() => {
      void loadProfile();
    });

    return () => {
      isMounted = false;
      window.removeEventListener(quickLoginChangedEvent, handleQuickLoginChange);
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  return user;
}
