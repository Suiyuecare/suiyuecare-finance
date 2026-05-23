"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = ClipboardList,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  primaryAction?: { label: string; href?: string; onClick?: () => void };
  secondaryAction?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] p-6 text-center sm:p-8", className)}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#ead8c2] bg-white text-[#b45309]">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
      {(primaryAction || secondaryAction) ? (
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          {primaryAction ? <EmptyStateAction action={primaryAction} /> : null}
          {secondaryAction ? <EmptyStateAction action={secondaryAction} variant="outline" /> : null}
        </div>
      ) : (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          無需處理
        </div>
      )}
    </div>
  );
}

function EmptyStateAction({
  action,
  variant = "default",
}: {
  action: { label: string; href?: string; onClick?: () => void };
  variant?: "default" | "outline";
}) {
  if (action.href) {
    return (
      <Button asChild variant={variant}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }

  return (
    <Button type="button" variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}
