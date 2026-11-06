import type { ReactNode } from "react";

import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";

/** One state of a link page, at phone height and without its live behavior. */
export function LinkPageStudyState({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div
        className="flex min-h-[46rem] flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]"
        inert
      >
        <LinkPageSurface>{children}</LinkPageSurface>
      </div>
    </div>
  );
}
