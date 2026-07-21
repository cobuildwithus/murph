import Link from "next/link";

import { BiomarkerIcon } from "./biomarker-icon";
import { cn } from "@/src/lib/utils";

export interface BiomarkerDeviceReadingCardProps {
  category: string | null;
  className?: string;
  routeId: string;
  stale: boolean;
  summary: string | null;
  title: string;
  valueLabel: string;
}

export function BiomarkerDeviceReadingCard({
  category,
  className,
  routeId,
  stale,
  summary,
  title,
  valueLabel,
}: BiomarkerDeviceReadingCardProps) {
  return (
    <Link
      className={cn(
        "group flex h-full min-h-72 flex-col rounded-xl border border-border/60 bg-card/90 p-5 transition-colors duration-200 hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      href={`/biomarkers/${encodeURIComponent(routeId)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <BiomarkerIcon className="size-10 shrink-0" routeId={routeId} />
        {stale ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Out of date
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {category ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {formatCategory(category)}
          </span>
        ) : null}
        <h3 className="text-balance font-serif text-[22px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
      </div>

      {summary ? (
        <p className="mt-3 mb-5 line-clamp-2 text-pretty text-sm/6 text-muted-foreground">
          {summary}
        </p>
      ) : null}

      <div className="mt-auto border-t border-border/60 pt-4">
        <p className="break-words font-serif text-3xl font-semibold tracking-tight tabular-nums text-foreground">
          {valueLabel}
        </p>
      </div>
    </Link>
  );
}

function formatCategory(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
