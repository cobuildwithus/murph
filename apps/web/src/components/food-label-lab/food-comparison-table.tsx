"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import Image from "next/image";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/src/components/ui/toggle-group";
import { cn } from "@/src/lib/utils";

import {
  compareFoodMetrics,
  formatFoodMetricValue,
  getFoodCategoryAsset,
  getFoodEvidenceSummary,
  getFoodTopMatch,
  type FoodMetricBasis,
  type FoodMetricComparison,
} from "./food-label-model";
import type { FoodEvidencePanel } from "./food-evidence-sheet";

export function FoodComparisonTable(input: {
  products: PublicProductDetail[];
  basis: FoodMetricBasis;
  onBasisChange: (basis: FoodMetricBasis) => void;
  onRemoveProduct: (productRef: string) => void;
  onRequestAdd: () => void;
  onOpenEvidence: (
    product: PublicProductDetail,
    panel: FoodEvidencePanel,
  ) => void;
}) {
  const comparisons = compareFoodMetrics(input.products, input.basis);
  const topMatch = getFoodTopMatch(input.products, comparisons);
  const hasTopMatch = topMatch.productRefs.size > 0;

  return (
    <section
      aria-label="Food comparison"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={input.onRequestAdd}
          disabled={input.products.length >= 4}
        >
          <PlusIcon data-icon="inline-start" />
          Add food
        </Button>
        <ToggleGroup
          value={[input.basis]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "per_100_g" || next === "per_serving") {
              input.onBasisChange(next);
            }
          }}
          variant="outline"
          size="sm"
          aria-label="Nutrition basis"
        >
          <ToggleGroupItem value="per_100_g" aria-label="Compare per 100 grams">
            Per 100 g
          </ToggleGroupItem>
          <ToggleGroupItem value="per_serving" aria-label="Compare per serving">
            Per serving
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse"
          style={{ minWidth: `${176 + input.products.length * 272}px` }}
        >
          <colgroup>
            <col style={{ width: "176px" }} />
            {input.products.map((product) => (
              <col key={product.productRef} style={{ width: "272px" }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 border-r border-border bg-card px-5 py-6 text-left align-bottom font-mono text-[9px] font-medium tracking-[0.11em] text-muted-foreground uppercase"
              >
                Compare
              </th>
              {input.products.map((product) => {
                const wins = topMatch.winsByProductRef.get(product.productRef) ?? 0;
                const isTopMatch = topMatch.productRefs.has(product.productRef);
                return (
                  <th
                    key={product.productRef}
                    scope="col"
                    className={cn(
                      "relative border-r border-border px-5 py-5 text-left align-top last:border-r-0",
                      isTopMatch && "bg-primary/5",
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => input.onRemoveProduct(product.productRef)}
                      className="absolute top-3 right-3"
                    >
                      <XIcon />
                      <span className="sr-only">Remove {product.name}</span>
                    </Button>
                    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-4 pr-8">
                      <Image
                        src={getFoodCategoryAsset(product)}
                        alt=""
                        width={64}
                        height={64}
                        className="size-16 object-contain"
                      />
                      <div className="min-w-0">
                        {product.brand ? (
                          <p className="truncate font-mono text-[9px] font-medium tracking-[0.11em] text-muted-foreground uppercase">
                            {product.brand}
                          </p>
                        ) : null}
                        <p className="mt-1 line-clamp-2 font-serif text-lg font-semibold leading-tight tracking-[-0.015em] text-foreground">
                          {product.name}
                        </p>
                      </div>
                    </div>
                    {isTopMatch && hasTopMatch ? (
                      <Badge className="mt-4 border-primary/20 bg-primary/10 text-primary" variant="outline">
                        {topMatch.productRefs.size > 1 ? "Tied" : "Top match"} · {wins} of {topMatch.comparableMetricCount}
                      </Badge>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comparison) => (
              <MetricRow
                key={comparison.metric.id}
                comparison={comparison}
                products={input.products}
                basis={input.basis}
                onBasisChange={input.onBasisChange}
              />
            ))}
            <tr className="border-t-2 border-border">
              <th
                scope="row"
                className="sticky left-0 border-r border-border bg-card px-5 py-5 text-left text-sm font-normal text-muted-foreground"
              >
                Evidence
              </th>
              {input.products.map((product) => (
                <EvidenceCell
                  key={product.productRef}
                  product={product}
                  onOpenEvidence={input.onOpenEvidence}
                />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricRow(input: {
  basis: FoodMetricBasis;
  comparison: FoodMetricComparison;
  products: PublicProductDetail[];
  onBasisChange: (basis: FoodMetricBasis) => void;
}) {
  return (
    <tr className="border-t border-border">
      <th
        scope="row"
        className="sticky left-0 border-r border-border bg-card px-5 py-5 text-left text-sm font-normal text-muted-foreground"
      >
        {input.comparison.metric.label}
      </th>
      {input.products.map((product) => {
        const value = input.comparison.values.get(product.productRef);
        const isWinner = input.comparison.winnerRefs.has(product.productRef);
        return (
          <td
            key={product.productRef}
            className={cn(
              "border-r border-border p-0 last:border-r-0",
              isWinner && "bg-primary/5",
            )}
          >
            {value ? (
              <MetricPopover
                activeProduct={product}
                basis={input.basis}
                comparison={input.comparison}
                products={input.products}
                onBasisChange={input.onBasisChange}
              >
                <button
                  type="button"
                  className="flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {isWinner ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                  <span>
                    <span
                      className={cn(
                        "block font-serif text-2xl tracking-[-0.02em] text-foreground",
                        isWinner && "font-semibold",
                      )}
                    >
                      {formatFoodMetricValue(value)}
                    </span>
                    {isWinner ? (
                      <span className="mt-0.5 block text-xs font-medium text-primary">
                        {input.comparison.metric.preference === "higher" ? "Highest" : "Lowest"}
                      </span>
                    ) : null}
                  </span>
                </button>
              </MetricPopover>
            ) : (
              <span className="flex min-h-16 items-center px-5 py-4 font-serif text-2xl text-muted-foreground">
                —
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function MetricPopover(input: {
  activeProduct: PublicProductDetail;
  basis: FoodMetricBasis;
  children: React.ReactElement;
  comparison: FoodMetricComparison;
  products: PublicProductDetail[];
  onBasisChange: (basis: FoodMetricBasis) => void;
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
  const rank = sorted.findIndex(
    (entry) => entry.product.productRef === input.activeProduct.productRef,
  ) + 1;
  const max = Math.max(...sorted.map((entry) => entry.value.value), 1);

  return (
    <Popover>
      <PopoverTrigger render={input.children} />
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={10}
        className="w-80 gap-5 rounded-xl border border-border bg-popover p-5 shadow-none ring-0"
      >
        <div>
          <PopoverTitle className="font-serif text-lg font-semibold tracking-[-0.015em] text-foreground">
            {input.comparison.metric.label}
          </PopoverTitle>
          <p className="mt-1 font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {input.comparison.metric.preference === "higher" ? "Highest" : "Lowest"} · #{rank} of {sorted.length}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {sorted.map((entry) => {
            const active = entry.product.productRef === input.activeProduct.productRef;
            return (
              <div key={entry.product.productRef}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className={cn("truncate", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {entry.product.brand ?? entry.product.name}
                  </span>
                  <span className="shrink-0 font-serif font-semibold text-foreground">
                    {formatFoodMetricValue(entry.value)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", active ? "bg-primary" : "bg-border")}
                    style={{ width: `${Math.max(4, (entry.value.value / max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <ToggleGroup
            value={[input.basis]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "per_100_g" || next === "per_serving") {
                input.onBasisChange(next);
              }
            }}
            variant="outline"
            size="sm"
            aria-label={`${input.comparison.metric.label} basis`}
          >
            <ToggleGroupItem value="per_100_g" aria-label="Per 100 grams">100 g</ToggleGroupItem>
            <ToggleGroupItem value="per_serving" aria-label="Per serving">Serving</ToggleGroupItem>
          </ToggleGroup>
          {input.activeProduct.source.url ? (
            <a
              href={input.activeProduct.source.url}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
              className="text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Source
            </a>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EvidenceCell(input: {
  product: PublicProductDetail;
  onOpenEvidence: (
    product: PublicProductDetail,
    panel: FoodEvidencePanel,
  ) => void;
}) {
  const summary = getFoodEvidenceSummary(input.product);
  const hasAlerts = summary.alertCount > 0;

  return (
    <td className="border-r border-border px-5 py-4 last:border-r-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <button
          type="button"
          onClick={() => input.onOpenEvidence(input.product, "tests")}
          className={cn(
            "rounded-sm font-medium underline decoration-border underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hasAlerts ? "text-destructive" : "text-primary",
          )}
        >
          {summary.alertCount} {summary.alertCount === 1 ? "alert" : "alerts"}
        </button>
        <button
          type="button"
          onClick={() => input.onOpenEvidence(input.product, "gaps")}
          className="rounded-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Evidence: {summary.level}
        </button>
        <span className="text-xs text-muted-foreground">
          {summary.testCount} tests · {summary.gapCount} gaps
        </span>
      </div>
    </td>
  );
}
