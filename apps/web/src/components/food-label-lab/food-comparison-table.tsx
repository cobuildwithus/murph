"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import Image from "next/image";

import { Button } from "@/src/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { cn } from "@/src/lib/utils";

import {
  FOOD_COMPARISON_LIMIT,
  compareFoodMetrics,
  formatFoodMetricValue,
  getFoodCategoryAsset,
  getFoodEvidenceCoverage,
  getFoodEvidenceSummary,
  getFoodLeadSummary,
  getFoodMetricConclusion,
  getFoodProductIdentity,
  getFoodTopMatch,
  type FoodEvidenceCoverage,
  type FoodMetricBasis,
  type FoodMetricComparison,
} from "./food-label-model";

const LABEL_COLUMN_WIDTH = 148;
const PRODUCT_COLUMN_WIDTH = 236;

export function FoodComparisonTable(input: {
  products: PublicProductDetail[];
  basis: FoodMetricBasis;
  onBasisChange: (basis: FoodMetricBasis) => void;
  onRemoveProduct: (productRef: string) => void;
  onRequestAdd: () => void;
  onOpenEvidence: (product: PublicProductDetail) => void;
}) {
  const comparisons = compareFoodMetrics(input.products, input.basis);
  const topMatch = getFoodTopMatch(input.products, comparisons);
  const leadSummary = getFoodLeadSummary(input.products, topMatch);
  const showAddColumn = input.products.length < FOOD_COMPARISON_LIMIT;
  const columnCount = input.products.length + (showAddColumn ? 1 : 0);

  return (
    <section
      aria-label="Food comparison"
      className="inline-block max-w-full overflow-hidden rounded-xl border border-border bg-card align-top"
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {`${input.products.length} of ${FOOD_COMPARISON_LIMIT} products`}
        </p>
        <BasisToggle
          basis={input.basis}
          onBasisChange={input.onBasisChange}
          label="Nutrition basis"
        />
      </div>

      <div className="overflow-x-auto">
        <table
          className="table-fixed border-collapse"
          style={{ width: `${LABEL_COLUMN_WIDTH + columnCount * PRODUCT_COLUMN_WIDTH}px` }}
        >
          <colgroup>
            <col style={{ width: `${LABEL_COLUMN_WIDTH}px` }} />
            {input.products.map((product) => (
              <col key={product.productRef} style={{ width: `${PRODUCT_COLUMN_WIDTH}px` }} />
            ))}
            {showAddColumn ? <col style={{ width: `${PRODUCT_COLUMN_WIDTH}px` }} /> : null}
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
                  onRemove={() => input.onRemoveProduct(product.productRef)}
                />
              ))}
              {showAddColumn ? (
                <th scope="col" className="p-2 align-top">
                  <button
                    type="button"
                    onClick={input.onRequestAdd}
                    className="flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PlusIcon className="size-4" aria-hidden="true" />
                    {input.products.length === 1 ? "Add a product to compare" : "Add another product"}
                  </button>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => (
              <MetricRow
                key={comparison.metric.id}
                comparison={comparison}
                products={input.products}
                basis={input.basis}
                showAddColumn={showAddColumn}
              />
            ))}
            <tr className="border-t border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-border bg-card px-4 py-4 text-left align-top"
              >
                <span className="block text-sm font-normal text-foreground">Evidence</span>
                <span className="block text-xs font-normal text-muted-foreground">Record coverage</span>
              </th>
              {input.products.map((product) => (
                <EvidenceCell
                  key={product.productRef}
                  product={product}
                  onOpenEvidence={() => input.onOpenEvidence(product)}
                />
              ))}
              {showAddColumn ? <td /> : null}
            </tr>
          </tbody>
        </table>
      </div>

      {leadSummary ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {`${leadSummary} Rows compare the visible values only.`}
        </p>
      ) : null}
    </section>
  );
}

function ProductHeader(input: { product: PublicProductDetail; onRemove: () => void }) {
  const identity = getFoodProductIdentity(input.product);
  return (
    <th
      scope="col"
      className="relative border-r border-border px-4 py-4 text-left align-top font-normal last:border-r-0"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={input.onRemove}
        className="absolute top-2 right-2 text-muted-foreground"
      >
        <XIcon />
        <span className="sr-only">Remove {identity.brand ?? ""} {identity.title}</span>
      </Button>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 pr-7">
        <Image
          src={getFoodCategoryAsset(input.product)}
          alt=""
          width={56}
          height={56}
          className="size-14 object-contain"
        />
        <div className="min-w-0">
          {identity.brand ? (
            <p className="truncate text-sm font-semibold text-foreground">{identity.brand}</p>
          ) : null}
          <p className="line-clamp-2 text-sm leading-snug text-foreground">{identity.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {identity.size ?? "Package size not reported"}
          </p>
        </div>
      </div>
    </th>
  );
}

function BasisToggle(input: {
  basis: FoodMetricBasis;
  label: string;
  onBasisChange: (basis: FoodMetricBasis) => void;
}) {
  return (
    <div
      role="group"
      aria-label={input.label}
      className="flex w-fit items-center rounded-lg border border-border bg-card p-0.5"
    >
      {([
        ["per_100_g", "Per 100 g", "Compare per 100 grams"],
        ["per_serving", "Per serving", "Compare per serving"],
      ] as const).map(([value, text, label]) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={input.basis === value}
          onClick={() => input.onBasisChange(value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
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
  products: PublicProductDetail[];
  showAddColumn: boolean;
}) {
  const preference = input.comparison.metric.preference === "higher"
    ? "Highest marked"
    : "Lowest marked";
  return (
    <tr className="border-t border-border">
      <th
        scope="row"
        className="sticky left-0 z-10 border-r border-border bg-card px-4 py-3 text-left align-top"
      >
        <span className="block text-sm font-normal text-foreground">
          {input.comparison.metric.label}
        </span>
        <span className="block text-xs font-normal text-muted-foreground">{preference}</span>
      </th>
      {input.products.map((product) => {
        const value = input.comparison.values.get(product.productRef);
        const isWinner = input.comparison.winnerRefs.has(product.productRef);
        return (
          <td
            key={product.productRef}
            className="border-r border-border p-0 align-top last:border-r-0"
          >
            {value ? (
              <MetricPopover
                activeProduct={product}
                comparison={input.comparison}
                products={input.products}
              >
                <button
                  type="button"
                  title={`${input.comparison.metric.label} detail`}
                  className="relative flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {isWinner ? (
                    <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                  <span
                    className={cn(
                      "font-serif text-xl tracking-[-0.02em] text-foreground",
                      isWinner && "font-semibold",
                    )}
                  >
                    {formatFoodMetricValue(value)}
                  </span>
                  {isWinner ? (
                    <span className="sr-only">
                      {input.comparison.metric.preference === "higher" ? "highest" : "lowest"}
                    </span>
                  ) : null}
                </button>
              </MetricPopover>
            ) : (
              <span className="flex min-h-12 items-center px-4 py-3 text-sm text-muted-foreground">
                {product.nutrition.rows.length === 0
                  ? "No nutrition in record"
                  : input.basis === "per_serving" && !product.serving?.grams
                    ? "Serving mass not reported"
                    : "Not on label"}
              </span>
            )}
          </td>
        );
      })}
      {input.showAddColumn ? <td /> : null}
    </tr>
  );
}

function MetricPopover(input: {
  activeProduct: PublicProductDetail;
  children: React.ReactElement;
  comparison: FoodMetricComparison;
  products: PublicProductDetail[];
}) {
  const sorted = input.products
    .flatMap((product) => {
      const value = input.comparison.values.get(product.productRef);
      return value ? [{ product, value }] : [];
    })
    .sort((left, right) =>
      input.comparison.metric.preference === "higher"
        ? right.value.value - left.value.value
        : left.value.value - right.value.value,
    );
  const conclusion = getFoodMetricConclusion(
    input.comparison,
    input.activeProduct.productRef,
    input.products.length,
  );
  const max = Math.max(...sorted.map((entry) => entry.value.value), 1);

  return (
    <Popover>
      <PopoverTrigger render={input.children} />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 gap-3 rounded-lg border border-border bg-popover p-3 shadow-none ring-0"
      >
        <div className="flex items-baseline justify-between gap-3">
          <PopoverTitle className="text-sm font-semibold text-foreground">
            {input.comparison.metric.label}
          </PopoverTitle>
          <span className="text-xs text-muted-foreground">{conclusion}</span>
        </div>

        <ul className="flex flex-col gap-2">
          {sorted.map((entry) => {
            const active = entry.product.productRef === input.activeProduct.productRef;
            const identity = getFoodProductIdentity(entry.product);
            return (
              <li key={entry.product.productRef}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className={cn("truncate", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {identity.brand ? `${identity.brand} · ${identity.title}` : identity.title}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {formatFoodMetricValue(entry.value)}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", active ? "bg-primary" : "bg-border")}
                    style={{ width: `${Math.max(3, (entry.value.value / max) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {input.activeProduct.source.url ? (
          <a
            href={input.activeProduct.source.url}
            target="_blank"
            rel="noreferrer"
            referrerPolicy="no-referrer"
            className="self-end border-t border-border pt-3 text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
          >
            Source
          </a>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function EvidenceMeter(input: {
  coverage: FoodEvidenceCoverage;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1", input.className)} aria-hidden="true">
      {input.coverage.segments.map((segment) => (
        <span
          key={segment.id}
          className={cn(
            "h-1.5 w-4 rounded-full",
            segment.covered ? "bg-foreground/55" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

function EvidenceCell(input: {
  product: PublicProductDetail;
  onOpenEvidence: () => void;
}) {
  const coverage = getFoodEvidenceCoverage(input.product);
  const summary = getFoodEvidenceSummary(input.product);
  const alertLabel = summary.alertCount > 0
    ? `${summary.alertsLowerBound ? "At least " : ""}${summary.alertCount} above a screening limit`
    : null;

  return (
    <td className="border-r border-border px-4 py-3 align-top last:border-r-0">
      <button
        type="button"
        onClick={input.onOpenEvidence}
        className="group relative flex flex-col items-start gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <EvidenceMeter coverage={coverage} />
        <span className="text-xs text-muted-foreground underline decoration-border underline-offset-4 group-hover:text-foreground">
          {`${coverage.coveredCount} of ${coverage.segments.length} record parts`}
          <span className="sr-only">
            {" "}
            · {coverage.segments.map((segment) => `${segment.label}: ${segment.covered ? "covered" : "missing"}`).join(", ")}
          </span>
        </span>
        {alertLabel ? (
          <span className="text-xs font-medium text-destructive">{alertLabel}</span>
        ) : null}
      </button>
    </td>
  );
}
