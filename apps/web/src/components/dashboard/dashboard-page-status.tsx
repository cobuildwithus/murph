"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

export function DashboardPageStatus({
  actionLabel,
  description,
  onAction,
  title,
  tone = "neutral",
}: {
  actionLabel?: string;
  description: string;
  onAction?: () => void;
  title: string;
  tone?: "error" | "neutral";
}) {
  return (
    <div
      className={cn(
        "max-w-2xl rounded-2xl border bg-card p-6 sm:p-8",
        tone === "error" ? "border-destructive/30" : "border-border",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <CircleAlert
        className={cn(
          "size-7",
          tone === "error" ? "text-destructive" : "text-primary",
        )}
        aria-hidden="true"
      />
      <h2 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {actionLabel && onAction ? (
        <Button className="mt-5" onClick={onAction} size="sm" variant="outline">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
