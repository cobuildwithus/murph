"use client";

import type { ReactNode } from "react";

import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

export function HostedInlineAuthButton({
  active = false,
  children,
  className,
  disabled = false,
  icon,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      disabled={disabled}
      className={cn(
        "h-11 w-full justify-center gap-2 border-border bg-card font-semibold text-foreground hover:bg-muted",
        active ? "border-border bg-muted" : null,
        className,
      )}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}
