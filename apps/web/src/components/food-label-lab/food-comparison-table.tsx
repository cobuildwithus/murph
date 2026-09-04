"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import { CheckIcon, CircleSlash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { MurphMark } from "@/src/components/ui/murph-mark";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { cn } from "@/src/lib/utils";

import {
  FoodBrandVisual,
  getFoodBrandHue,
} from "./food-brand-visual";

import {
  compareFoodMetrics,
  formatFoodMetricValue,
  getFoodComparisonCategoryQuery,
  getFoodCategoryAsset,
  getFoodProductIdentity,
  type FoodEvidenceCoverage,
  type FoodMetricBasis,
  type FoodMetricComparison,
} from "./food-label-model";
import { FoodMurphGradeButton } from "./food-murph-note";

const LABEL_COLUMN_WIDTH = 148;
const PRODUCT_COLUMN_WIDTH = "clamp(250px, calc((100vw - 244px) / 4), 289px)";
const STABLE_PRODUCT_COLUMN_SLOTS = 4;
const STABLE_TABLE_MIN_WIDTH =
  LABEL_COLUMN_WIDTH + STABLE_PRODUCT_COLUMN_SLOTS * 250;

function getComparisonTableWidth(columnCount: number): string {
  if (columnCount === STABLE_PRODUCT_COLUMN_SLOTS) {
    return `max(100%, ${STABLE_TABLE_MIN_WIDTH}px)`;
  }
  return `calc(${LABEL_COLUMN_WIDTH}px + ${Array.from(
    { length: columnCount },
    () => PRODUCT_COLUMN_WIDTH,
  ).join(" + ")})`;
}

function getProductColumnWidth(columnCount: number): string {
  return columnCount === STABLE_PRODUCT_COLUMN_SLOTS
    ? `calc((100% - ${LABEL_COLUMN_WIDTH}px) / ${STABLE_PRODUCT_COLUMN_SLOTS})`
    : PRODUCT_COLUMN_WIDTH;
}

export function FoodComparisonTable(input: {
  products: PublicProductDetail[];
  basis: FoodMetricBasis;
  onBasisChange: (basis: FoodMetricBasis) => void;
  onOpenProduct: (product: PublicProductDetail) => void;
  onRemoveProduct: (productRef: string) => void;
  brandfetchClientId?: string | null;
}) {
  const { basis, onBasisChange } = input;
  const comparisons = compareFoodMetrics(input.products, input.basis);
  const perServingAvailable = compareFoodMetrics(
    input.products,
    "per_serving",
  ).some((comparison) => comparison.values.size > 0);
  const emptyColumnCount = Math.max(
    0,
    STABLE_PRODUCT_COLUMN_SLOTS - input.products.length,
  );
  const visibleColumnCount = Math.max(
    STABLE_PRODUCT_COLUMN_SLOTS,
    input.products.length,
  );
  const productColumnWidth = getProductColumnWidth(visibleColumnCount);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredProductRef, setHoveredProductRef] = useState<string | null>(
    null,
  );
  const [canScrollRight, setCanScrollRight] = useState(false);
  const showScrollHint =
    canScrollRight && input.products.length > STABLE_PRODUCT_COLUMN_SLOTS;
  const updateScrollEdge = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const remainingWidth =
      container.scrollWidth - container.clientWidth - container.scrollLeft;
    setCanScrollRight(remainingWidth > 4);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    updateScrollEdge();
    container.addEventListener("scroll", updateScrollEdge, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollEdge);
    resizeObserver?.observe(container);

    return () => {
      container.removeEventListener("scroll", updateScrollEdge);
      resizeObserver?.disconnect();
    };
  }, [updateScrollEdge, visibleColumnCount]);

  useEffect(() => {
    if (basis === "per_serving" && !perServingAvailable) {
      onBasisChange("per_100_g");
    }
  }, [basis, onBasisChange, perServingAvailable]);

  return (
    <TooltipProvider delay={150}>
      <section
        aria-label="Food comparison"
        data-food-basis={basis}
        className="w-full overflow-hidden rounded-xl border border-border bg-card"
        onMouseLeave={() => setHoveredProductRef(null)}
      >
        <div className="relative">
          <div
            ref={scrollContainerRef}
            data-food-comparison-scroll
            className="overflow-x-auto"
          >
            <table
              className="table-fixed border-collapse"
              style={{ width: getComparisonTableWidth(visibleColumnCount) }}
            >
              <colgroup>
                <col style={{ width: `${LABEL_COLUMN_WIDTH}px` }} />
                {input.products.map((product) => (
                  <col
                    key={product.productRef}
                    style={{ width: productColumnWidth }}
                  />
                ))}
                {Array.from({ length: emptyColumnCount }, (_, index) => (
                  <col
                    key={`empty-${index}`}
                    style={{ width: productColumnWidth }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 border-r border-border bg-card px-4 py-4 text-left align-bottom text-xs font-normal text-muted-foreground"
                  >
                    <span className="sr-only">Metric</span>
                  </th>
                  {input.products.map((product) => (
                    <ProductHeader
                      key={product.productRef}
                      product={product}
                      brandfetchClientId={input.brandfetchClientId}
                      hovered={hoveredProductRef === product.productRef}
                      onHover={setHoveredProductRef}
                      onOpen={() => input.onOpenProduct(product)}
                      onRemove={() => input.onRemoveProduct(product.productRef)}
                    />
                  ))}
                  {Array.from({ length: emptyColumnCount }, (_, index) => (
                    <th
                      key={`empty-${index}`}
                      aria-hidden="true"
                      className="border-r border-border bg-card last:border-r-0"
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisons.map((comparison) => (
                  <MetricRow
                    key={comparison.metric.id}
                    comparison={comparison}
                    products={input.products}
                    basis={input.basis}
                    emptyColumnCount={emptyColumnCount}
                    hoveredProductRef={hoveredProductRef}
                    onHoverProduct={setHoveredProductRef}
                    onOpenProduct={input.onOpenProduct}
                  />
                ))}
                <tr className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-border bg-card px-4 py-4 text-left align-top"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-normal text-foreground">
                      <MurphMark className="h-3.5" />
                      <span className="sr-only">Murph</span>
                      grade
                    </span>
                  </th>
                  {input.products.map((product) => (
                    <MurphNoteCell
                      key={product.productRef}
                      product={product}
                      hovered={hoveredProductRef === product.productRef}
                      onHover={setHoveredProductRef}
                      onOpen={() => input.onOpenProduct(product)}
                    />
                  ))}
                  <EmptyMetricCells count={emptyColumnCount} />
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-border bg-card px-4 py-3 text-left"
                  >
                    <span className="sr-only">Nutrition basis</span>
                  </th>
                  <td colSpan={visibleColumnCount} className="p-0">
                    <div className="sticky right-0 ml-auto flex w-fit px-4 py-2">
                      {perServingAvailable ? (
                        <BasisToggle
                          basis={input.basis}
                          perServingAvailable
                          onBasisChange={input.onBasisChange}
                          label="Nutrition basis"
                        />
                      ) : (
                        <span className="py-1.5 text-xs font-medium text-muted-foreground">
                          Per 100 g
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <span
            aria-hidden="true"
            data-food-scroll-shadow="right"
            data-visible={showScrollHint ? "true" : "false"}
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 z-20 w-24 rounded-r-xl bg-linear-to-r from-transparent via-card/75 to-card transition-opacity duration-150",
              showScrollHint ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
      </section>
    </TooltipProvider>
  );
}

function ProductHeader(input: {
  brandfetchClientId?: string | null;
  hovered: boolean;
  onHover: (productRef: string | null) => void;
  product: PublicProductDetail;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const identity = getFoodProductIdentity(input.product);
  const asset = getFoodCategoryAsset(input.product);
  const brandHue = getFoodBrandHue(identity.brand, asset);
  const accent = `oklch(0.56 0.12 ${brandHue})`;
  return (
    <th
      scope="col"
      data-food-product-header="brand-tint"
      className="relative border-r border-border px-4 py-4 text-left align-top font-normal transition-colors last:border-r-0"
      style={{
        backgroundColor: `color-mix(in oklch, ${accent} ${
          input.hovered ? 10 : 5
        }%, var(--card))`,
      }}
      onMouseEnter={() => input.onHover(input.product.productRef)}
      onMouseLeave={() => input.onHover(null)}
      onFocusCapture={() => input.onHover(input.product.productRef)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          input.onHover(null);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={input.onRemove}
        className="absolute top-2 right-2 text-muted-foreground"
      >
        <XIcon />
        <span className="sr-only">
          Remove {identity.brand ?? ""} {identity.title}
        </span>
      </Button>
      <button
        type="button"
        data-food-open-product={input.product.productRef}
        onClick={input.onOpen}
        className="block w-full rounded-sm pr-7 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-2.5">
          <FoodBrandVisual
            asset={asset}
            brand={identity.brand}
            brandfetchClientId={input.brandfetchClientId}
            searchContext={getFoodComparisonCategoryQuery(input.product)}
            size="sm"
          />
          <span className="min-w-0">
            {identity.brand ? (
              <span className="block text-sm font-semibold leading-[1.25] text-foreground">
                {identity.brand}
              </span>
            ) : null}
            {identity.title ? (
              <span className="block text-sm leading-[1.25] text-foreground">
                {identity.title}
              </span>
            ) : null}
            <span className="mt-1 block text-xs text-muted-foreground">
              {identity.size ?? "Package size not reported"}
            </span>
          </span>
        </span>
        <span className="sr-only">Open product details</span>
      </button>
    </th>
  );
}

function BasisToggle(input: {
  basis: FoodMetricBasis;
  label: string;
  onBasisChange: (basis: FoodMetricBasis) => void;
  perServingAvailable: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={input.label}
      className="flex w-fit items-center rounded-lg border border-border bg-card p-0.5"
    >
      {(
        [
          ["per_100_g", "Per 100 g", "Compare per 100 grams"],
          ["per_serving", "Per serving", "Compare per serving"],
        ] as const
      ).map(([value, text, label]) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={input.basis === value}
          disabled={value === "per_serving" && !input.perServingAvailable}
          title={
            value === "per_serving" && !input.perServingAvailable
              ? "No selected product reports nutrition per serving"
              : undefined
          }
          onClick={() => input.onBasisChange(value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
            input.basis === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function MetricRow(input: {
  basis: FoodMetricBasis;
  comparison: FoodMetricComparison;
  emptyColumnCount: number;
  hoveredProductRef: string | null;
  onHoverProduct: (productRef: string | null) => void;
  onOpenProduct: (product: PublicProductDetail) => void;
  products: PublicProductDetail[];
}) {
  const winnerLabel =
    input.comparison.metric.preference === "higher" ? "Highest" : "Lowest";
  return (
    <tr
      className="border-t border-border"
      data-food-metric={input.comparison.metric.id}
    >
      <th
        scope="row"
        className="sticky left-0 z-10 border-r border-border bg-card px-4 py-3.5 text-left align-top"
      >
        <span className="block text-sm font-normal text-foreground">
          {input.comparison.metric.label}
        </span>
      </th>
      {input.products.map((product) => {
        const value = input.comparison.values.get(product.productRef);
        const isWinner = input.comparison.winnerRefs.has(product.productRef);
        const missingLabel =
          product.nutrition.rows.length === 0
            ? "No nutrition in record"
            : input.basis === "per_serving" && !product.serving?.grams
            ? "Serving mass not reported"
            : "Not on label";
        return (
          <td
            key={product.productRef}
            className={cn(
              "border-r border-border p-0 align-top transition-colors last:border-r-0",
              input.hoveredProductRef === product.productRef && "bg-muted/45",
            )}
            onMouseEnter={() => input.onHoverProduct(product.productRef)}
            onMouseLeave={() => input.onHoverProduct(null)}
            onFocusCapture={() => input.onHoverProduct(product.productRef)}
            onBlurCapture={() => input.onHoverProduct(null)}
          >
            {value ? (
              <button
                type="button"
                onClick={() => input.onOpenProduct(product)}
                className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "font-serif text-xl tracking-[-0.02em] text-foreground",
                    isWinner && "font-semibold",
                  )}
                >
                  {formatFoodMetricValue(value)}
                </span>
                {isWinner ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            aria-hidden="true"
                            data-food-winner={winnerLabel.toLocaleLowerCase(
                              "en-US",
                            )}
                            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          />
                        }
                      >
                        <CheckIcon className="size-3.5 stroke-[2.5]" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {winnerLabel}{" "}
                        {input.comparison.metric.label.toLowerCase()}
                      </TooltipContent>
                    </Tooltip>
                    <span className="sr-only">
                      {winnerLabel.toLocaleLowerCase("en-US")}
                    </span>
                  </>
                ) : null}
                <span className="sr-only">Open product details</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => input.onOpenProduct(product)}
                aria-label={`${missingLabel}. Open product details`}
                className="flex min-h-12 w-full items-center px-4 py-3.5 text-left text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        aria-hidden="true"
                        data-food-missing-label={missingLabel}
                        className="inline-flex size-5 items-center justify-center text-muted-foreground/65"
                      />
                    }
                  >
                    <CircleSlash2Icon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>{missingLabel}</TooltipContent>
                </Tooltip>
              </button>
            )}
          </td>
        );
      })}
      <EmptyMetricCells count={input.emptyColumnCount} />
    </tr>
  );
}

export function EvidenceMeter(input: {
  coverage: FoodEvidenceCoverage;
  className?: string;
}) {
  const percentage = Math.round(
    (input.coverage.coveredCount / input.coverage.segments.length) * 100,
  );
  const filledSegmentCount = Math.round(percentage / 20);

  return (
    <span
      className={cn("flex items-center gap-1", input.className)}
      role="img"
      aria-label={`${percentage}% evidence coverage`}
      title={`${percentage}% evidence coverage`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            "h-1.5 w-3 rounded-sm",
            index < filledSegmentCount ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

function MurphNoteCell(input: {
  hovered: boolean;
  onHover: (productRef: string | null) => void;
  onOpen: () => void;
  product: PublicProductDetail;
}) {
  return (
    <td
      className={cn(
        "border-r border-border p-0 align-top transition-colors last:border-r-0",
        input.hovered && "bg-muted/45",
      )}
      onMouseEnter={() => input.onHover(input.product.productRef)}
      onMouseLeave={() => input.onHover(null)}
      onFocusCapture={() => input.onHover(input.product.productRef)}
      onBlurCapture={() => input.onHover(null)}
    >
      <FoodMurphGradeButton product={input.product} onOpen={input.onOpen} />
    </td>
  );
}

function EmptyMetricCells(input: { count: number }) {
  return Array.from({ length: input.count }, (_, index) => (
    <td
      key={`empty-${index}`}
      aria-hidden="true"
      className="border-r border-border bg-card last:border-r-0"
    />
  ));
}
