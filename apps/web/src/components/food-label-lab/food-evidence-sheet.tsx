"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
} from "lucide-react";
import Image from "next/image";

import { Badge } from "@/src/components/ui/badge";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import { cn } from "@/src/lib/utils";

import {
  getEvidenceDimensions,
  getEvidenceMatrix,
  getFoodCategoryAsset,
  getFoodEvidenceSummary,
  type EvidenceTone,
} from "./food-label-model";

export type FoodEvidencePanel = "tests" | "gaps";

export function FoodEvidenceSheet(input: {
  panel: FoodEvidencePanel | null;
  product: PublicProductDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { panel, product } = input;

  return (
    <Sheet open={panel !== null && product !== null} onOpenChange={input.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-popover shadow-none sm:max-w-lg"
      >
        {product && panel === "tests" ? <TestsPanel product={product} /> : null}
        {product && panel === "gaps" ? <GapsPanel product={product} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ProductHeading(input: { product: PublicProductDetail }) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-4">
      <Image
        src={getFoodCategoryAsset(input.product)}
        alt=""
        width={56}
        height={56}
        className="size-14 object-contain"
      />
      <div className="min-w-0">
        {input.product.brand ? (
          <p className="truncate font-mono text-[9px] font-medium tracking-[0.11em] text-muted-foreground uppercase">
            {input.product.brand}
          </p>
        ) : null}
        <p className="truncate font-serif text-xl font-semibold tracking-[-0.02em] text-foreground">
          {input.product.name}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {formatServing(input.product)}
        </p>
      </div>
    </div>
  );
}

function TestsPanel(input: { product: PublicProductDetail }) {
  const summary = getFoodEvidenceSummary(input.product);
  const matrix = getEvidenceMatrix(input.product);
  const hasAlerts = summary.alertCount > 0;

  return (
    <>
      <SheetHeader className="gap-6 border-b border-border p-6 pr-14">
        <ProductHeading product={input.product} />
        <div>
          <SheetTitle className="font-serif text-3xl font-semibold leading-tight tracking-[-0.025em]">
            {summary.testCount === 0
              ? "No exact tests"
              : hasAlerts
                ? `${summary.alertCount} ${summary.alertCount === 1 ? "alert" : "alerts"} in tested samples`
                : "0 alerts in tested samples"}
          </SheetTitle>
          <SheetDescription className="mt-2">
            {summary.testCount} {summary.testCount === 1 ? "test" : "tests"}
            {matrix.length > 0 ? ` · ${matrix.length} measured ${matrix.length === 1 ? "analyte" : "analytes"}` : ""}
          </SheetDescription>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        {matrix.length > 0 ? (
          <div className="divide-y divide-border px-6">
            {matrix.map((row) => (
              <div
                key={row.analyte}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {row.analyte}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5" aria-label={sampleCoverageLabel(row)}>
                    {row.totalSampleCount !== null
                      ? Array.from({ length: Math.min(row.totalSampleCount, 8) }, (_, index) => (
                          <span
                            key={index}
                            className={cn(
                              "size-2 rounded-full border",
                              index < (row.coveredSampleCount ?? 0)
                                ? "border-primary bg-primary"
                                : "border-border bg-transparent",
                            )}
                          />
                        ))
                      : null}
                  </div>
                </div>
                <StatusBadge status={row.status} tone={row.tone} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center gap-5 px-8 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FlaskConicalIcon className="size-9" aria-hidden="true" />
            </div>
            <p className="max-w-xs font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
              No tested sample is linked to this exact product.
            </p>
          </div>
        )}

        {input.product.productTests.observations.length > 0 ? (
          <details className="mx-6 border-t border-border py-5">
            <summary className="cursor-pointer text-sm font-medium text-primary underline decoration-border underline-offset-4">
              View raw reports
            </summary>
            <div className="mt-4 flex flex-col gap-3">
              {input.product.productTests.observations.map((observation) => (
                <div
                  key={observation.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {observation.analyte.name} · {observation.source.reportDate ?? "date unknown"}
                  </span>
                  {observation.source.url ? (
                    <a
                      href={observation.source.url}
                      target="_blank"
                      rel="noreferrer"
                      referrerPolicy="no-referrer"
                      className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
                    >
                      Source
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </ScrollArea>

      <SheetFooter className="border-t border-border px-6 py-5">
        <p className="text-sm text-muted-foreground">
          Exact samples, not every package.
        </p>
      </SheetFooter>
    </>
  );
}

function GapsPanel(input: { product: PublicProductDetail }) {
  const dimensions = getEvidenceDimensions(input.product);
  const knownCount = dimensions.filter((dimension) => dimension.known).length;
  const importantUnknowns = dimensions.filter(
    (dimension) => !dimension.known && dimension.priority === "high",
  );
  const otherUnknowns = dimensions.filter(
    (dimension) => !dimension.known && dimension.priority === "standard",
  );

  return (
    <>
      <SheetHeader className="gap-6 border-b border-border p-6 pr-14">
        <ProductHeading product={input.product} />
        <div>
          <SheetTitle className="font-serif text-3xl font-semibold tracking-[-0.025em]">
            Evidence: {knownCount === 0 ? "limited" : knownCount === dimensions.length ? "reported" : "partial"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Evidence coverage and unknowns for this exact product.
          </SheetDescription>
          <div
            className="mt-4 grid grid-cols-9 gap-1.5"
            aria-label={`${knownCount} of ${dimensions.length} evidence areas reported`}
          >
            {dimensions.map((dimension) => (
              <span
                key={dimension.id}
                className={cn(
                  "h-2 rounded-full",
                  dimension.known ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {importantUnknowns.length > 0 ? (
            <div className="border-b border-border py-5">
              <p className="font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase">
                Matters most
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {importantUnknowns.map((dimension) => (
                  <GapRow key={dimension.id} label={dimension.label} important />
                ))}
              </div>
            </div>
          ) : null}

          <div className="divide-y divide-border">
            {otherUnknowns.map((dimension) => (
              <GapRow key={dimension.id} label={dimension.label} />
            ))}
          </div>

          {importantUnknowns.length === 0 && otherUnknowns.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckIcon className="size-8" aria-hidden="true" />
              </div>
              <p className="font-serif text-2xl font-semibold text-foreground">
                No known gaps in this record.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <SheetFooter className="border-t border-border px-6 py-5">
        <p className="text-sm text-muted-foreground">
          Unknown is not a failed test.
        </p>
      </SheetFooter>
    </>
  );
}

function GapRow(input: { important?: boolean; label: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4">
      <div
        className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        {input.important ? (
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
        ) : (
          <CircleHelpIcon className="size-4" aria-hidden="true" />
        )}
      </div>
      <span className={cn("text-sm", input.important ? "font-medium text-foreground" : "text-foreground")}>
        {input.label}
      </span>
      <span className="text-sm text-muted-foreground">Unknown</span>
    </div>
  );
}

function StatusBadge(input: { status: string; tone: EvidenceTone }) {
  return (
    <Badge
      variant={input.tone === "warning" ? "destructive" : "outline"}
      className={cn(
        "gap-1.5",
        input.tone === "affirmative" && "border-primary/30 bg-primary/10 text-primary",
        input.tone === "unknown" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {input.tone === "affirmative" ? <CheckIcon aria-hidden="true" /> : null}
      {input.tone === "warning" ? <AlertTriangleIcon aria-hidden="true" /> : null}
      {input.status}
    </Badge>
  );
}

function sampleCoverageLabel(row: {
  coveredSampleCount: number | null;
  totalSampleCount: number | null;
}): string | undefined {
  if (row.coveredSampleCount === null || row.totalSampleCount === null) {
    return undefined;
  }
  return `${row.coveredSampleCount} of ${row.totalSampleCount} identified samples`;
}

function formatServing(product: PublicProductDetail): string {
  const serving = product.serving;
  const parts = [serving?.description, serving?.grams ? `${serving.grams} g` : null]
    .filter(Boolean);
  if (product.upc) {
    parts.push(`UPC ${product.upc}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Serving not reported";
}
