import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BiomarkerIcon } from "./biomarker-icon";
import { cn } from "@/src/lib/utils";

export interface BiomarkerBrowsePrivateValue {
  dateLabel: string;
  sourceLabel: string | null;
  stale: boolean;
  unit: string | null;
  valueLabel: string;
}

export interface BiomarkerBrowseCardProps {
  routeId: string;
  title: string;
  category: string | null;
  unit: string | null;
  summary: string | null;
  privateValue?: BiomarkerBrowsePrivateValue | null;
  privateValueSyncing?: boolean;
  className?: string;
}

export function BiomarkerBrowseCard({
  routeId,
  title,
  category,
  summary,
  privateValue,
  privateValueSyncing,
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
        <p className="text-sm/6 text-muted-foreground text-pretty line-clamp-2">
          {summary}
        </p>
      ) : null}

      <div className="flex flex-1 items-center justify-center border-t border-border/60 pt-3">
        {privateValue ? (
          <span className="font-serif text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {privateValue.valueLabel}{privateValue.unit ? ` ${displayUnit(privateValue.unit)}` : ""}
          </span>
        ) : privateValueSyncing ? (
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
            Syncing...
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">---</span>
        )}
      </div>

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

function displayUnit(unit: string): string {
  const n = unit.trim().toLowerCase();
  if (n === "percent" || n === "percentage") return "%";
  return unit;
}

function formatCategory(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
