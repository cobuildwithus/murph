import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BiomarkerIcon } from "./biomarker-icon";
import { cn } from "@/src/lib/utils";

export interface BiomarkerBrowseCardProps {
  routeId: string;
  title: string;
  category: string | null;
  unit: string | null;
  summary: string | null;
  className?: string;
}

export function BiomarkerBrowseCard({
  routeId,
  title,
  category,
  unit,
  summary,
  className,
}: BiomarkerBrowseCardProps) {
  return (
    <Link
      href={`/biomarkers/${routeId}`}
      className={cn(
        "group flex h-full flex-col gap-4 rounded-xl border border-border/60 bg-card/90 p-5 transition-colors hover:border-border",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <BiomarkerIcon routeId={routeId} className="size-10 shrink-0" />
        {unit ? (
          <span className="rounded-md bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {category ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
            {formatCategory(category)}
          </span>
        ) : null}
        <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground text-balance sm:text-[22px]">
          {title}
        </h2>
      </div>

      {summary ? (
        <p className="text-sm/6 text-muted-foreground text-pretty line-clamp-3">
          {summary}
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Open biomarker
        </span>
        <ArrowRight
          aria-hidden="true"
          className="size-4 text-muted-foreground/70 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground"
          strokeWidth={1.75}
        />
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
