import Link from "next/link";
import type { ReactNode } from "react";

import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

export function BiomarkerHeader({
  biomarker,
  trendSlot,
}: {
  biomarker: BiomarkerPageModel;
  trendSlot: ReactNode;
}) {
  const eyebrowParts = [
    biomarker.categories[0] ? formatCategoryLabel(biomarker.categories[0]) : null,
    biomarker.unit,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="flex flex-col gap-6">
      <BiomarkerBreadcrumb biomarker={biomarker} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex max-w-[700px] flex-col gap-3.5">
          <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
            {eyebrowParts.join(" · ")}
          </span>
          <h1 className="font-serif text-3xl font-semibold leading-[110%] tracking-[-0.03em] text-foreground sm:text-[38px]">
            {biomarker.title}
          </h1>
          <p className="text-[16px] leading-[160%] text-muted-foreground">
            {biomarker.summary}
          </p>
        </div>
        <div className="lg:min-h-[280px]">{trendSlot}</div>
      </div>
    </div>
  );
}

function BiomarkerBreadcrumb({ biomarker }: { biomarker: BiomarkerPageModel }) {
  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
      <Link
        href="/experiments"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Murph
      </Link>
      <span className="text-muted-foreground/60">→</span>
      <span className="text-muted-foreground">Biomarkers</span>
      <span className="text-muted-foreground/60">→</span>
      <span className="font-medium text-foreground">{biomarker.shortName}</span>
    </nav>
  );
}

function formatCategoryLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
