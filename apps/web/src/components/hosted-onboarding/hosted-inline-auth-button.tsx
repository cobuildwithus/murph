"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        "h-11 w-full justify-center gap-2 border-stone-200 bg-white font-semibold text-stone-700 hover:bg-stone-50",
        active ? "border-stone-300 bg-stone-50" : null,
        className,
      )}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}
