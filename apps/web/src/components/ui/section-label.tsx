import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5",
        className,
      )}
    >
      {children}
    </span>
  );
}
