import type { ReactNode } from "react";

import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import { cn } from "@/src/lib/utils";

/** One state of a link page, at phone height and without its live behavior. */
export function LinkPageStudyState({
  children,
  fit = false,
  id,
  label,
}: {
  children: ReactNode;
  /** Exactly one phone screen tall, like a page in a one-screen frame, so long lists scroll inside it. */
  fit?: boolean;
  /** The anchor a PR's design proof links to. */
  id?: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3" id={id}>
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]",
          fit ? "h-[46rem]" : "min-h-[46rem]",
        )}
        inert
      >
        <LinkPageSurface fit={fit}>{children}</LinkPageSurface>
      </div>
    </div>
  );
}
