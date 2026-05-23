"use client";

import { usePathname } from "next/navigation";
import { PageGuide } from "@/components/ui/page-guide";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getPageGuide } from "@/lib/help/page-guidance";

export function ContextualPageGuide() {
  const pathname = usePathname();
  const currentUser = useCurrentUser();
  const guide = getPageGuide(pathname);

  if (!guide || !currentUser.id) return null;

  return <PageGuide guide={guide} role={currentUser.role} />;
}
