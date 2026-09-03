"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Image from "next/image";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import { cn } from "@/src/lib/utils";

import { EvidenceMeter } from "./food-comparison-table";
import { FoodBrandVisual } from "./food-brand-visual";
import {
  getFoodCategoryAsset,
  getFoodComparisonCategoryQuery,
  getFoodEvidenceCoverage,
  getFoodProductIdentity,
} from "./food-label-model";
import { FoodMurphNoteSummary } from "./food-murph-note";
import {
  flattenFoodIngredientItems,
  getFoodIngredientItems,
  type FoodIngredientItem,
  type FoodIngredientNoteLevel,
} from "./food-product-review";
import {
  formatEvidenceBasis,
  formatNormalizedProductTestResult,
  formatProductTestNumber,
  formatProductTestResult,
  hasDistinctNormalizedProductTestResult,
} from "../murph-safe/product-test-presentation";

export type FoodEvidencePanel = "product" | "tests" | "gaps";

const STATUS_CODES_SHOWN_AS_RESULTS = new Set<
  PublicProductDetail["unknowns"][number]["code"]
>(["NO_LINKED_PRODUCT_TESTS", "TEST_THRESHOLD_NOT_COMPARABLE"]);

export function FoodEvidenceSheet(input: {
  focus: FoodEvidencePanel | null;
  brandfetchClientId?: string | null;
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
        {product ? (
          <EvidencePanel
            product={product}
            focus={focus}
            brandfetchClientId={input.brandfetchClientId}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EvidencePanel(input: {
  product: PublicProductDetail;
  focus: FoodEvidencePanel | null;
  brandfetchClientId?: string | null;
}) {
  const { product } = input;
  const identity = getFoodProductIdentity(product);
  const coverage = getFoodEvidenceCoverage(product);
  const gaps = getVisibleGaps(product);
  const observations = product.productTests.observations;
  const ingredients = getFoodIngredientItems(product);
  const analyteSummaries = getAnalyteSummaries(observations);
  const sampleCount = getReportedSampleCount(observations);
  const initialTab = input.focus === "tests" ? "tests" : "overview";

  return (
    <>
      <SheetHeader className="gap-4 border-b border-border p-5 pr-12">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
          <FoodBrandVisual
            asset={getFoodCategoryAsset(product)}
            brand={identity.brand}
            brandfetchClientId={input.brandfetchClientId}
            searchContext={getFoodComparisonCategoryQuery(product)}
            size="sm"
          />
          <div className="min-w-0">
            <SheetTitle className="text-sm font-semibold leading-tight text-foreground">
              {[identity.brand, identity.title].filter(Boolean).join(" · ")}
            </SheetTitle>
            <SheetDescription className="truncate text-xs">
              {identity.size || "Package size not reported"}
            </SheetDescription>
          </div>
        </div>
        <EvidenceCoveragePopover
          product={product}
          coverage={coverage}
          gaps={gaps}
          initiallyOpen={input.focus === "gaps"}
        />
      </SheetHeader>

      <Tabs
        key={`${product.productRef}:${initialTab}`}
        defaultValue={initialTab}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="w-full shrink-0 justify-start overflow-x-auto px-5">
          <TabsTrigger value="overview" aria-label="Overview" className="px-3">
            <StableTabLabel>Overview</StableTabLabel>
          </TabsTrigger>
          <TabsTrigger value="tests" aria-label="Lab tests" className="px-3">
            <StableTabLabel>Lab tests</StableTabLabel>
            {product.productTests.total > 0 ? (
              <CountBadge count={product.productTests.total} />
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="px-5 pb-6">
              <EvidenceOverview product={product} />
              <section className="py-5" aria-label="Product details">
                <h3 className="text-sm font-semibold text-foreground">
                  Ingredients
                </h3>
                <IngredientList ingredients={ingredients} />
              </section>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="tests" className="min-h-0">
          <ScrollArea className="h-full">
            <section className="px-5 py-5" aria-label="Linked test results">
              <LabSummary product={product} sampleCount={sampleCount} />
              {analyteSummaries.length > 0 ? (
                <div className="mt-6 divide-y divide-border border-y border-border">
                  {analyteSummaries.map((summary) => (
                    <AnalyteRow key={summary.id} summary={summary} />
                  ))}
                </div>
              ) : null}
            </section>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </>
  );
}

function StableTabLabel(input: { children: string }) {
  return (
    <span className="grid" data-stable-tab-label>
      <span className="[grid-area:1/1]">{input.children}</span>
      <span
        aria-hidden="true"
        className="invisible font-semibold [grid-area:1/1]"
      >
        {input.children}
      </span>
    </span>
  );
}

function CountBadge(input: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
      {input.count}
    </span>
  );
}

type ProductGap = PublicProductDetail["unknowns"][number];

function getVisibleGaps(product: PublicProductDetail): ProductGap[] {
  const hasReadableIngredients = getFoodIngredientItems(product).length > 0;
  return product.unknowns.filter(
    (unknown) =>
      !STATUS_CODES_SHOWN_AS_RESULTS.has(unknown.code) &&
      !(
        unknown.code === "INGREDIENTS_STATEMENT_ONLY" && hasReadableIngredients
      ),
  );
}

function getGapTitle(gap: ProductGap, product: PublicProductDetail): string {
  if (gap.code !== "SERVING_MASS_UNAVAILABLE") {
    return gap.title;
  }
  const size = getFoodProductIdentity(product).size;
  return size
    ? `Serving weight unavailable (${size})`
    : "Serving weight unavailable";
}

function EvidenceCoveragePopover(input: {
  product: PublicProductDetail;
  coverage: ReturnType<typeof getFoodEvidenceCoverage>;
  gaps: ProductGap[];
  initiallyOpen: boolean;
}) {
  return (
    <Popover defaultOpen={input.initiallyOpen}>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={120}
        render={
          <button
            type="button"
            className="flex w-fit items-center gap-2 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Show evidence coverage, known gaps, and record source"
          >
            <EvidenceMeter coverage={input.coverage} />
            <span>
              {input.coverage.coveredCount} of {input.coverage.segments.length}{" "}
              data areas
            </span>
          </button>
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-72 gap-0 rounded-xl border border-border bg-popover p-0 shadow-md ring-0"
      >
        <div className="px-4 py-3">
          <PopoverTitle className="text-sm font-semibold text-foreground">
            Evidence coverage
          </PopoverTitle>
        </div>
        <ul className="border-y border-border px-4 py-2">
          {input.coverage.segments.map((segment) => (
            <li
              key={segment.id}
              className="flex items-center gap-2 py-1.5 text-xs"
            >
              {segment.covered ? (
                <span className="flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground">
                  <CheckIcon
                    aria-hidden="true"
                    className="size-3 stroke-[2.5]"
                  />
                </span>
              ) : (
                <CircleXIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-[#9a8060]"
                />
              )}
              <span
                className={
                  segment.covered ? "text-foreground" : "text-muted-foreground"
                }
              >
                {segment.label}
              </span>
            </li>
          ))}
        </ul>
        {input.gaps.length > 0 ? (
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold text-foreground">Known gaps</p>
            <ul
              role="list"
              data-gap-count={input.gaps.length}
              className="mt-2 space-y-2"
            >
              {input.gaps.map((gap) => (
                <li
                  key={gap.code}
                  data-gap-code={gap.code}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <CircleXIcon
                    aria-hidden="true"
                    className="size-4 h-lh shrink-0 text-[#9a8060]"
                  />
                  <span>{getGapTitle(gap, input.product)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="px-4 py-3 text-xs text-muted-foreground">
          <span className="mr-1">Record source:</span>
          <SourceLink
            name={input.product.source.name}
            url={input.product.source.url}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EvidenceOverview(input: { product: PublicProductDetail }) {
  return (
    <section
      className="border-b border-border py-5"
      aria-label="Evidence overview"
    >
      <FoodMurphNoteSummary product={input.product} />
    </section>
  );
}

type ReviewTone = "alert" | "supported" | "review" | "unknown";

type ReviewStatus = {
  label: string;
  tone: ReviewTone;
};

function StatusBadge(input: { label: string; tone: ReviewTone }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        input.tone === "alert" &&
          "border-destructive/25 bg-destructive/10 text-destructive",
        input.tone === "supported" &&
          "border-primary/25 bg-primary/10 text-primary",
        input.tone === "review" &&
          "border-[#c4a882]/50 bg-[#c4a882]/15 text-[#765735]",
        input.tone === "unknown" &&
          "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      {input.label}
    </span>
  );
}

function LabSummary(input: {
  product: PublicProductDetail;
  sampleCount: number | null;
}) {
  const { observations } = input.product.productTests;
  const aboveCount = observations.filter(
    (observation) => observation.screening?.comparison === "exceeds",
  ).length;
  const comparableCount = observations.filter(
    (observation) => observation.screening !== null,
  ).length;
  const hasTests = input.product.productTests.total > 0;
  if (!hasTests) {
    return (
      <div
        data-lab-state="unavailable"
        className="flex min-h-[22rem] flex-col items-center justify-center px-6 text-center"
      >
        <Image
          src={getFoodCategoryAsset(input.product)}
          alt=""
          width={96}
          height={96}
          className="size-24 object-contain"
        />
        <h3 className="mt-5 font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
          No lab tests
        </h3>
      </div>
    );
  }

  const withoutLimitCount = observations.filter(
    (observation) => observation.screening === null,
  ).length;
  const withinCount = observations.filter(
    (observation) => observation.screening?.comparison === "does_not_exceed",
  ).length;
  const status: ReviewStatus =
    aboveCount > 0
      ? { label: "Needs attention", tone: "alert" }
      : comparableCount > 0
      ? { label: "Below shown limits", tone: "supported" }
      : { label: "No matching limits", tone: "unknown" };
  const showResultSummary =
    aboveCount > 0 ||
    withinCount > 0 ||
    (withoutLimitCount > 0 && comparableCount > 0) ||
    input.sampleCount !== null;

  return (
    <div data-lab-state={status.tone}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Lab results
        </h3>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {comparableCount === 0
          ? "These measurements have no matching health limit, so they do not change the Murph grade."
          : formatResultScope(input.product)}
      </p>
      {comparableCount === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {formatResultScope(input.product)}
        </p>
      ) : null}
      {showResultSummary ? (
        <div
          role="group"
          className="mt-4 flex flex-wrap gap-2"
          aria-label="Lab result summary"
        >
          {aboveCount > 0 ? (
            <LabCountBadge
              count={aboveCount}
              label="above limit"
              tone="alert"
            />
          ) : null}
          {withinCount > 0 ? (
            <LabCountBadge
              count={withinCount}
              label="below limit"
              tone="supported"
            />
          ) : null}
          {withoutLimitCount > 0 && comparableCount > 0 ? (
            <LabCountBadge
              count={withoutLimitCount}
              label="without a health limit"
              tone="unknown"
            />
          ) : null}
          {input.sampleCount ? (
            <LabCountBadge
              count={input.sampleCount}
              label="samples"
              tone="unknown"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LabCountBadge(input: {
  count: number;
  label: string;
  tone: ReviewTone;
}) {
  return (
    <StatusBadge label={`${input.count} ${input.label}`} tone={input.tone} />
  );
}

type TestObservation =
  PublicProductDetail["productTests"]["observations"][number];

type AnalyteSummary = {
  id: string;
  name: string;
  observations: TestObservation[];
};

function getAnalyteSummaries(
  observations: TestObservation[],
): AnalyteSummary[] {
  const grouped = new Map<string, TestObservation[]>();
  for (const observation of observations) {
    const key =
      observation.analyte.key ||
      observation.analyte.name.toLocaleLowerCase("en-US");
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  }
  return [...grouped.entries()].map(([id, groupedObservations]) => ({
    id,
    name: groupedObservations[0]?.analyte.name ?? id,
    observations: groupedObservations,
  }));
}

function AnalyteRow(input: { summary: AnalyteSummary }) {
  const { summary } = input;
  const firstObservation = summary.observations[0];
  if (!firstObservation) {
    return null;
  }
  const status = getAnalyteStatus(summary);

  return (
    <details
      className="group/result"
      data-analyte={summary.id}
      aria-label={`Lab results for ${summary.name}`}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {summary.name}
          </span>
          {summary.observations.length > 1 ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {summary.observations.length} results
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          {status.tone === "unknown" ? (
            <span className="sr-only">No matching health limit</span>
          ) : (
            <StatusBadge label={status.label} tone={status.tone} />
          )}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform group-open/result:rotate-180"
          />
        </span>
      </summary>
      <ul className="divide-y divide-border border-t border-border pl-4">
        {summary.observations.map((observation) => (
          <ObservationDetail key={observation.id} observation={observation} />
        ))}
      </ul>
    </details>
  );
}

function getAnalyteStatus(summary: AnalyteSummary): ReviewStatus {
  const above = summary.observations.filter(
    (observation) => observation.screening?.comparison === "exceeds",
  ).length;
  if (above > 0) {
    return { label: "Above limit", tone: "alert" };
  }
  const within = summary.observations.filter(
    (observation) => observation.screening?.comparison === "does_not_exceed",
  ).length;
  if (within > 0) {
    return { label: "Below limit", tone: "supported" };
  }
  if (
    summary.observations.every(
      (observation) => observation.result.operator === "not_detected",
    )
  ) {
    return { label: "Not detected", tone: "supported" };
  }
  return { label: "No health limit", tone: "unknown" };
}

function formatResultScope(product: PublicProductDetail): string {
  const { returned, total, truncated } = product.productTests;
  if (total === 0) {
    return "No product-level test is linked to this exact record.";
  }
  if (truncated || returned < total) {
    return `Showing the ${returned} newest of ${total} linked lab results.`;
  }
  return `${total} linked lab ${total === 1 ? "result" : "results"}.`;
}

function getReportedSampleCount(
  observations: TestObservation[],
): number | null {
  const sampleIds = new Set(
    observations.flatMap((observation) =>
      observation.sample?.sourceSampleId
        ? [observation.sample.sourceSampleId]
        : [],
    ),
  );
  if (sampleIds.size > 0) {
    return sampleIds.size;
  }
  const reportedCounts = observations.flatMap((observation) =>
    observation.sample?.sampleCount ? [observation.sample.sampleCount] : [],
  );
  return reportedCounts.length > 0 ? Math.max(...reportedCounts) : null;
}

function SourceLink(input: { name: string; url: string | null }) {
  return input.url ? (
    <a
      href={input.url}
      target="_blank"
      rel="noreferrer"
      referrerPolicy="no-referrer"
      className="underline decoration-border underline-offset-4 hover:text-foreground"
    >
      {input.name}
    </a>
  ) : (
    input.name
  );
}

function IngredientList(input: { ingredients: FoodIngredientItem[] }) {
  if (input.ingredients.length === 0) {
    return (
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Ingredients are not available for this record.
      </p>
    );
  }

  return (
    <ul
      role="list"
      data-food-ingredient-list="independent-columns"
      className="mt-3 columns-2 gap-5"
    >
      {input.ingredients.map((ingredient) => (
        <IngredientRow key={ingredient.id} ingredient={ingredient} />
      ))}
    </ul>
  );
}

function IngredientRow(input: { ingredient: FoodIngredientItem }) {
  const { ingredient } = input;
  const detailIngredients = flattenFoodIngredientItems(ingredient.children);
  const markerLevel = getIngredientMarkerLevel(ingredient);
  const hasDetails = ingredient.note !== null || detailIngredients.length > 0;
  return (
    <li className="mb-2 min-w-0 break-inside-avoid last:mb-0">
      {hasDetails ? (
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={120}
            closeDelay={180}
            render={
              <button
                type="button"
                aria-label={`About ${ingredient.name}`}
                className="min-h-6 w-full rounded-sm text-left text-xs leading-relaxed text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IngredientName name={ingredient.name} level={markerLevel} />
              </button>
            }
          />
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-80 gap-3 rounded-xl border border-border bg-popover p-4 shadow-md ring-0"
          >
            <PopoverTitle className="text-sm font-semibold text-foreground">
              {ingredient.name}
            </PopoverTitle>
            {ingredient.note ? <IngredientNote note={ingredient.note} /> : null}
            {detailIngredients.length > 0 ? (
              <div
                className={cn(ingredient.note && "border-t border-border pt-3")}
              >
                <p className="text-xs font-semibold text-foreground">
                  Contains
                </p>
                <ul role="list" className="mt-2 space-y-1.5">
                  {detailIngredients.map((child, index) => (
                    <li
                      key={`${child.id}:${index}`}
                      className="text-sm text-muted-foreground"
                    >
                      {child.note ? (
                        <IngredientName
                          name={child.name}
                          level={child.note.level}
                        />
                      ) : (
                        child.name
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : (
        <span className="block min-h-6 text-xs leading-relaxed text-foreground">
          {ingredient.name}
        </span>
      )}
    </li>
  );
}

function IngredientNote(input: {
  note: NonNullable<FoodIngredientItem["note"]>;
}) {
  return (
    <>
      <p className="text-xs font-medium text-foreground">{input.note.label}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {input.note.detail}
      </p>
      <StatusBadge
        label={
          input.note.level === "higher_concern"
            ? "Higher concern"
            : input.note.level === "caution"
            ? "Worth noting"
            : "Context"
        }
        tone={input.note.level === "higher_concern" ? "alert" : "review"}
      />
      <a
        href={input.note.sourceUrl}
        target="_blank"
        rel="noreferrer"
        referrerPolicy="no-referrer"
        className="text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
      >
        FDA guidance
      </a>
    </>
  );
}

function getIngredientMarkerLevel(
  ingredient: FoodIngredientItem,
): FoodIngredientNoteLevel {
  const levels = [
    ingredient.note?.level,
    ...flattenFoodIngredientItems(ingredient.children).map(
      (child) => child.note?.level,
    ),
  ];
  if (levels.includes("higher_concern")) return "higher_concern";
  if (levels.includes("caution")) return "caution";
  return "context";
}

function IngredientName(input: {
  level: FoodIngredientNoteLevel;
  name: string;
}) {
  const lastSpace = input.name.trimEnd().lastIndexOf(" ");
  const head = lastSpace === -1 ? "" : input.name.slice(0, lastSpace + 1);
  const tail = lastSpace === -1 ? input.name : input.name.slice(lastSpace + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        <IngredientMarker level={input.level} />
      </span>
    </>
  );
}

function IngredientMarker(input: { level: FoodIngredientNoteLevel }) {
  if (input.level === "context") {
    return (
      <InfoIcon
        aria-hidden="true"
        className="ml-1 inline size-3.5 align-[-0.125em] text-muted-foreground"
      />
    );
  }
  return (
    <TriangleAlertIcon
      aria-hidden="true"
      className={cn(
        "ml-1 inline size-3.5 align-[-0.125em]",
        input.level === "higher_concern"
          ? "text-destructive"
          : "text-[#a06a3d]",
      )}
    />
  );
}

function ObservationDetail(input: { observation: TestObservation }) {
  const { observation } = input;
  const screening = observation.screening;
  const tone: ReviewTone =
    screening === null
      ? observation.result.operator === "not_detected"
        ? "supported"
        : "review"
      : screening.comparison === "exceeds"
      ? "alert"
      : "supported";
  const screeningLabel =
    screening === null
      ? observation.result.operator === "not_detected"
        ? "Not detected"
        : "No health limit"
      : screening.comparison === "exceeds"
      ? "Above limit"
      : "Below limit";

  return (
    <li
      data-observation-id={observation.id}
      className="py-3 text-xs leading-relaxed text-muted-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <span data-slot="screening-outcome">
          {screening === null &&
          observation.result.operator !== "not_detected" ? (
            <span className="sr-only">No matching health limit</span>
          ) : (
            <StatusBadge label={screeningLabel} tone={tone} />
          )}
        </span>
        <span
          data-slot="test-result"
          className="shrink-0 text-sm tabular-nums text-foreground"
        >
          {formatProductTestResult(observation.result)}
        </span>
      </div>
      <p className="mt-1.5">
        {formatEvidenceBasis(observation.result.basis)}
        {observation.normalizedResult &&
        hasDistinctNormalizedProductTestResult(observation)
          ? ` · Normalized: ${formatNormalizedProductTestResult(
              observation,
            )} · ${formatEvidenceBasis(observation.normalizedResult.basis)}`
          : null}
      </p>

      {screening ? (
        <p className="mt-1.5">
          {screening.threshold.name} ·{" "}
          {formatProductTestNumber(screening.threshold.value)}{" "}
          {screening.threshold.unit} ·{" "}
          {formatEvidenceBasis(screening.threshold.basis)} ·{" "}
          {screening.threshold.authority}
          {screening.screeningPolicy ? (
            <>
              {" · "}
              {formatProductTestNumber(
                screening.screeningPolicy.assumedServingsPerDay,
              )}{" "}
              servings/day
              {" · "}
              {formatProductTestNumber(
                screening.screeningPolicy.assumedBodyWeightKg,
              )}{" "}
              kg
              {" · "}
              {formatProductTestNumber(
                Math.round(screening.screeningPolicy.ratio * 100) / 100,
              )}
              × threshold
            </>
          ) : null}
          {screening.threshold.url ? (
            <>
              {" · "}
              <SourceLink
                name="Threshold source"
                url={screening.threshold.url}
              />
            </>
          ) : null}
        </p>
      ) : null}

      <p className="mt-1.5 flex flex-wrap gap-x-2">
        <span>{observation.source.name}</span>
        {observation.source.reportDate ? (
          <span>{observation.source.reportDate}</span>
        ) : null}
        {observation.sample?.sampleCount ? (
          <span>Source reports {observation.sample.sampleCount} samples</span>
        ) : null}
        {observation.source.url ? (
          <SourceLink name="Report" url={observation.source.url} />
        ) : null}
      </p>
    </li>
  );
}
