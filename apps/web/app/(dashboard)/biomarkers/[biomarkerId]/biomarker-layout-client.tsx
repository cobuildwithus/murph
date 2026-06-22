"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BiomarkerAboutGrid } from "@/src/components/biomarkers/biomarker-detail/biomarker-about-grid";
import { PageHeader } from "@/src/components/ui/page-header";
import type { BiomarkerShellProjection } from "@/src/lib/health-commons/biomarker-projections";

export function BiomarkerLayoutClient({
  biomarker,
  children,
}: {
  biomarker: BiomarkerShellProjection;
  children: ReactNode;
}) {
  const eyebrowParts = [
    biomarker.categories[0] ? formatCategoryEyebrow(biomarker.categories[0]) : null,
    biomarker.unit,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <PageHeader
          eyebrow={
            eyebrowParts.length > 0 ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
                {eyebrowParts.join(" · ")}
              </span>
            ) : undefined
          }
          title={biomarker.title}
          description={biomarker.summary}
        />
        <Link
          href="/biomarkers"
          className="relative inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-[''] sm:mt-1"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
          All biomarkers
        </Link>
      </div>

      <BiomarkerAboutGrid biomarker={biomarker} />

      <div className="pt-4">{children}</div>
    </div>
  );
}

function formatCategoryEyebrow(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join(" ");
}
