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
import {
  getFoodAlertLabel,
  getFoodCategoryAsset,
  getFoodEvidenceSummary,
  getFoodObservationScope,
} from "./food-label-model";
import {
  formatEvidenceBasis,
  formatNormalizedProductTestResult,
  formatProductTestNumber,
  formatProductTestResult,
  hasDistinctNormalizedProductTestResult,
} from "../murph-safe/product-test-presentation";

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
  const observations = input.product.productTests.observations;

  return (
    <>
      <SheetHeader className="gap-6 border-b border-border p-6 pr-14">
        <ProductHeading product={input.product} />
        <div>
          <SheetTitle className="font-serif text-3xl font-semibold leading-tight tracking-[-0.025em]">
            {getFoodAlertLabel(summary, true)}
          </SheetTitle>
          <SheetDescription className="mt-2">
            {getFoodObservationScope(summary)}
          </SheetDescription>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        {summary.alertCount === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-5 px-8 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FlaskConicalIcon className="size-9" aria-hidden="true" />
            </div>
            <p className="max-w-xs font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
              {summary.observationCount === 0
                ? "No product-level observation is linked to this exact product."
                : "No alert appears in the shown observations."}
            </p>
          </div>
        ) : null}

        {observations.length > 0 ? (
          <details className="mx-6 border-t border-border py-5">
            <summary className="cursor-pointer text-sm font-medium text-primary underline decoration-border underline-offset-4">
              View shown observations
            </summary>
            <div className="mt-4 divide-y divide-border">
              {observations.map((observation) => (
                <ObservationRow key={observation.id} observation={observation} />
              ))}
            </div>
          </details>
        ) : null}
      </ScrollArea>

      <SheetFooter className="border-t border-border px-6 py-5">
        <p className="text-sm text-muted-foreground">
          Screening references are not product safety determinations.
        </p>
      </SheetFooter>
    </>
  );
}

function ObservationRow(input: {
  observation: PublicProductDetail["productTests"]["observations"][number];
}) {
  const { observation } = input;
  return (
    <div className="py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{observation.analyte.name}</p>
          <p className="mt-1 font-serif text-lg font-semibold text-foreground">
            {formatProductTestResult(observation.result)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatEvidenceBasis(observation.result.basis)}</p>
          {observation.normalizedResult && hasDistinctNormalizedProductTestResult(observation) ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Normalized: {formatNormalizedProductTestResult(observation)} · {formatEvidenceBasis(observation.normalizedResult.basis)}
            </p>
          ) : null}
        </div>
        <ScreeningBadge screening={observation.screening} />
      </div>

      {observation.screening ? (
        <ThresholdFacts
          threshold={observation.screening.threshold}
          screeningPolicy={observation.screening.screeningPolicy}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{observation.source.name}</span>
        {observation.source.reportDate ? <span>{observation.source.reportDate}</span> : null}
        {observation.sample?.sampleCount ? (
          <span>Source reports {observation.sample.sampleCount} samples</span>
        ) : null}
        {observation.source.url ? (
          <a
            href={observation.source.url}
            target="_blank"
            rel="noreferrer"
            referrerPolicy="no-referrer"
            className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
          >
            Report
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ScreeningBadge(input: {
  screening: PublicProductDetail["productTests"]["observations"][number]["screening"];
}) {
  if (!input.screening) {
    return (
      <Badge variant="outline" className="h-fit border-border bg-muted text-muted-foreground">
        No comparable screening threshold
      </Badge>
    );
  }
  if (input.screening.comparison === "exceeds") {
    return (
      <Badge variant="destructive" className="h-fit gap-1.5">
        <AlertTriangleIcon aria-hidden="true" />
        Above this screening threshold
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-fit gap-1.5 border-primary/30 bg-primary/10 text-primary">
      <CheckIcon aria-hidden="true" />
      Did not exceed this screening threshold
    </Badge>
  );
}

function ThresholdFacts(input: {
  threshold: PublicProductDetail["productTests"]["alerts"][number]["threshold"];
  screeningPolicy?: PublicProductDetail["productTests"]["alerts"][number]["screeningPolicy"];
}) {
  return (
    <div className="mt-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{input.threshold.name}</p>
      <p>
        {formatProductTestNumber(input.threshold.value)} {input.threshold.unit} · {formatEvidenceBasis(input.threshold.basis)} · {input.threshold.authority}
      </p>
      {input.screeningPolicy ? (
        <p className="mt-1 text-xs">
          Exposure {formatProductTestNumber(input.screeningPolicy.exposure.value)} {input.screeningPolicy.exposure.unit}
          {` · ${formatEvidenceBasis(input.screeningPolicy.exposure.basis)}`}
          {` · ${formatProductTestNumber(input.screeningPolicy.assumedServingsPerDay)} servings/day`}
          {` · ${formatProductTestNumber(input.screeningPolicy.assumedBodyWeightKg)} kg`}
          {` · ${formatProductTestNumber(input.screeningPolicy.ratio)}× threshold`}
        </p>
      ) : null}
      {input.threshold.url ? (
        <a
          href={input.threshold.url}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
          className="mt-1 inline-block text-foreground underline decoration-border underline-offset-4 hover:text-primary"
        >
          Threshold source
        </a>
      ) : null}
    </div>
  );
}

function GapsPanel(input: { product: PublicProductDetail }) {
  const importantCodes = new Set<PublicProductDetail["unknowns"][number]["code"]>([
    "NO_LINKED_PRODUCT_TESTS",
    "TESTED_LOT_NOT_REPORTED",
    "TEST_THRESHOLD_NOT_COMPARABLE",
  ]);
  const importantUnknowns = input.product.unknowns.filter((unknown) =>
    importantCodes.has(unknown.code),
  );
  const otherUnknowns = input.product.unknowns.filter((unknown) =>
    !importantCodes.has(unknown.code),
  );

  return (
    <>
      <SheetHeader className="gap-6 border-b border-border p-6 pr-14">
        <ProductHeading product={input.product} />
        <div>
          <SheetTitle className="font-serif text-3xl font-semibold tracking-[-0.025em]">
            {input.product.unknowns.length === 0
              ? "No known evidence gaps"
              : `${input.product.unknowns.length} evidence ${input.product.unknowns.length === 1 ? "gap" : "gaps"}`}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Evidence coverage and unknowns for this exact product.
          </SheetDescription>
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
                  <GapRow key={dimension.code} unknown={dimension} important />
                ))}
              </div>
            </div>
          ) : null}

          <div className="divide-y divide-border">
            {otherUnknowns.map((dimension) => (
              <GapRow key={dimension.code} unknown={dimension} />
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

function GapRow(input: {
  important?: boolean;
  unknown: PublicProductDetail["unknowns"][number];
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-4">
      <div
        className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        {input.important ? (
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
        ) : (
          <CircleHelpIcon className="size-4" aria-hidden="true" />
        )}
      </div>
      <details className="group min-w-0">
        <summary className="cursor-pointer list-none text-sm font-medium text-foreground outline-none group-open:text-primary">
          {input.unknown.title}
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {input.unknown.description}
        </p>
      </details>
    </div>
  );
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
