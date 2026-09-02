"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import Image from "next/image";
import { useEffect, useRef } from "react";

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

import { EvidenceMeter } from "./food-comparison-table";
import {
  getFoodCategoryAsset,
  getFoodEvidenceCoverage,
  getFoodEvidenceStatuses,
  getFoodProductIdentity,
  type FoodEvidenceTone,
} from "./food-label-model";
import {
  formatEvidenceBasis,
  formatNormalizedProductTestResult,
  formatProductTestNumber,
  formatProductTestResult,
  hasDistinctNormalizedProductTestResult,
} from "../murph-safe/product-test-presentation";

export type FoodEvidencePanel = "tests" | "gaps";

const STATUS_CODES_SHOWN_AS_RESULTS = new Set<PublicProductDetail["unknowns"][number]["code"]>([
  "NO_LINKED_PRODUCT_TESTS",
  "TEST_THRESHOLD_NOT_COMPARABLE",
]);

export function FoodEvidenceSheet(input: {
  focus: FoodEvidencePanel | null;
  product: PublicProductDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { focus, product } = input;

  return (
    <Sheet open={product !== null} onOpenChange={input.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-popover shadow-none data-[side=right]:w-full sm:max-w-md"
      >
        {product ? <EvidencePanel product={product} focus={focus} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function EvidencePanel(input: { product: PublicProductDetail; focus: FoodEvidencePanel | null }) {
  const { product } = input;
  const identity = getFoodProductIdentity(product);
  const coverage = getFoodEvidenceCoverage(product);
  const statuses = getFoodEvidenceStatuses(product);
  const gaps = product.unknowns.filter((unknown) => !STATUS_CODES_SHOWN_AS_RESULTS.has(unknown.code));
  const observations = product.productTests.observations;
  const gapsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (input.focus === "gaps" && typeof gapsRef.current?.scrollIntoView === "function") {
      gapsRef.current.scrollIntoView({ block: "start" });
    }
  }, [input.focus, product.productRef]);

  return (
    <>
      <SheetHeader className="gap-4 border-b border-border p-5 pr-12">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
          <Image
            src={getFoodCategoryAsset(product)}
            alt=""
            width={40}
            height={40}
            className="size-10 object-contain"
          />
          <div className="min-w-0">
            <SheetTitle className="truncate text-sm font-semibold text-foreground">
              {identity.brand ? `${identity.brand} · ` : ""}{identity.title}
            </SheetTitle>
            <SheetDescription className="truncate text-xs">
              {[identity.size, product.upc ? `UPC ${product.upc}` : null].filter(Boolean).join(" · ")
                || "Package size not reported"}
            </SheetDescription>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <EvidenceMeter coverage={coverage} />
          <p className="text-sm text-foreground">
            {coverage.coveredCount} of {coverage.segments.length} record parts
          </p>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col divide-y divide-border px-5">
          <section className="py-4" aria-label="Record coverage">
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {coverage.segments.map((segment) => (
                <li key={segment.id} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      segment.covered ? "bg-foreground/55" : "bg-[#c4a882]",
                    )}
                  />
                  <span className={segment.covered ? "text-foreground" : "text-muted-foreground"}>
                    {segment.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="py-4" aria-label="Linked test results">
            <h3 className="text-xs font-semibold text-foreground">Linked test results</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {statuses.map((status) => (
                <li key={status.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                  <ToneDot tone={status.tone} className="mt-1.5" />
                  <div>
                    <p
                      className={cn(
                        "text-sm",
                        status.tone === "alert" ? "font-medium text-destructive" : "text-foreground",
                      )}
                    >
                      {status.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{status.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            {observations.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
                  Show {observations.length} returned {observations.length === 1 ? "result" : "results"}
                </summary>
                <ul className="mt-2 divide-y divide-border">
                  {observations.map((observation) => (
                    <ObservationRow key={observation.id} observation={observation} />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="py-4" aria-label="Evidence gaps" ref={gapsRef}>
            <h3 className="text-xs font-semibold text-foreground">
              {gaps.length === 0 ? "No other known gaps" : `${gaps.length} known ${gaps.length === 1 ? "gap" : "gaps"}`}
            </h3>
            {gaps.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {gaps.map((gap) => (
                  <li key={gap.code} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <ToneDot tone="unknown" className="mt-1.5" />
                    <div>
                      <p className="text-sm text-foreground">{gap.title}</p>
                      <p className="text-xs text-muted-foreground">{gap.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </ScrollArea>

      <SheetFooter className="border-t border-border px-5 py-3">
        <p className="text-xs text-muted-foreground">
          Screening limits are references, not safety verdicts. Unknown is not a failed test.
        </p>
      </SheetFooter>
    </>
  );
}

function ToneDot(input: { tone: FoodEvidenceTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        input.tone === "alert" && "bg-destructive",
        input.tone === "supported" && "bg-primary",
        input.tone === "unknown" && "bg-[#c4a882]",
        input.tone === "neutral" && "bg-border",
        input.className,
      )}
    />
  );
}

function ObservationRow(input: {
  observation: PublicProductDetail["productTests"]["observations"][number];
}) {
  const { observation } = input;
  const screening = observation.screening;
  const tone: FoodEvidenceTone = screening === null
    ? "unknown"
    : screening.comparison === "exceeds" ? "alert" : "supported";
  const screeningLabel = screening === null
    ? "No comparable screening threshold"
    : screening.comparison === "exceeds"
      ? "Above this screening threshold"
      : "Did not exceed this screening threshold";

  return (
    <li className="py-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-foreground">{observation.analyte.name}</p>
        <p className="shrink-0 text-foreground">{formatProductTestResult(observation.result)}</p>
      </div>
      <p className="mt-1 flex items-center gap-1.5">
        <ToneDot tone={tone} />
        <span className={cn(tone === "alert" ? "font-medium text-destructive" : "text-muted-foreground")}>
          {screeningLabel}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground">
        {formatEvidenceBasis(observation.result.basis)}
        {observation.normalizedResult && hasDistinctNormalizedProductTestResult(observation)
          ? ` · Normalized: ${formatNormalizedProductTestResult(observation)} · ${formatEvidenceBasis(observation.normalizedResult.basis)}`
          : null}
      </p>

      {screening ? (
        <p className="mt-1.5 text-muted-foreground">
          {screening.threshold.name} · {formatProductTestNumber(screening.threshold.value)} {screening.threshold.unit} · {formatEvidenceBasis(screening.threshold.basis)} · {screening.threshold.authority}
          {screening.screeningPolicy ? (
            <>
              {" · "}
              {formatProductTestNumber(screening.screeningPolicy.assumedServingsPerDay)} servings/day
              {" · "}
              {formatProductTestNumber(screening.screeningPolicy.assumedBodyWeightKg)} kg
              {" · "}
              {formatProductTestNumber(Math.round(screening.screeningPolicy.ratio * 100) / 100)}× threshold
            </>
          ) : null}
          {screening.threshold.url ? (
            <>
              {" · "}
              <a
                href={screening.threshold.url}
                target="_blank"
                rel="noreferrer"
                referrerPolicy="no-referrer"
                className="underline decoration-border underline-offset-4 hover:text-foreground"
              >
                Threshold source
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <p className="mt-1.5 flex flex-wrap gap-x-2 text-muted-foreground">
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
            className="underline decoration-border underline-offset-4 hover:text-foreground"
          >
            Report
          </a>
        ) : null}
      </p>
    </li>
  );
}
