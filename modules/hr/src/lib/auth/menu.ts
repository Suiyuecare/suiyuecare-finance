import type { HrRole } from "@/lib/auth/rbac";
import { canAny } from "@/lib/auth/rbac";
import { navigationGroups } from "@/lib/config/navigation";

export function getVisibleNavigation(role: HrRole) {
  const seenHrefs = new Set<string>();

  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!canAny(role, item.permissions) || seenHrefs.has(item.href)) return false;
        seenHrefs.add(item.href);
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}
