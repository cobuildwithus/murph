import type { ComponentProps } from "react";

import {
  formatLabResultValue,
  formatLabUnit,
} from "@/src/lib/biomarkers/lab-result-display";
import { cn } from "@/src/lib/utils";

type LabResultValueInput = Parameters<typeof formatLabResultValue>[0];

export function LabResultValue({
  className,
  presentation = "default",
  result,
}: {
  presentation?: "default" | "hero";
  result: LabResultValueInput;
} & Pick<ComponentProps<"span">, "className">) {
  const visibleValue = formatLabResultValue(result);

  if (presentation === "hero") {
    const numeric = result.value !== null && Number.isFinite(result.value);
    if (!numeric) {
      return (
        <span className={cn(
          "min-w-0 break-words font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl",
          className,
        )}>
          {visibleValue}
        </span>
      );
    }

    const normalizedValue = typeof result.normalizedValue === "number"
      && Number.isFinite(result.normalizedValue)
      ? result.normalizedValue
      : null;
    const normalizedUnit = typeof result.normalizedUnit === "string"
      && result.normalizedUnit.trim().length > 0
      ? result.normalizedUnit
      : null;
    const hasNormalizedValue = normalizedValue !== null && normalizedUnit !== null;
    const visibleNumber = formatLabResultValue({
      ...result,
      normalizedUnit: null,
      unit: null,
      value: hasNormalizedValue ? normalizedValue : result.value,
    });
    const displayedUnit = hasNormalizedValue ? normalizedUnit : result.unit;
    const unit = displayedUnit ? formatLabUnit(displayedUnit) : null;
    const visualValue = (
      <>
        <span className="min-w-0 break-words font-serif text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
          {visibleNumber}
        </span>
        {unit ? (
          <span className="text-lg text-muted-foreground sm:text-xl">{unit}</span>
        ) : null}
      </>
    );

    return (
      <span className={cn("inline-flex min-w-0 items-baseline gap-3", className)}>
        {result.comparator ? (
          <>
            <span aria-hidden="true" className="contents">{visualValue}</span>
            <span className="sr-only">
              {formatComparatorLabel(result.comparator)}{" "}
              {formatLabResultValue({ ...result, comparator: null })}
            </span>
          </>
        ) : visualValue}
      </span>
    );
  }

  if (!result.comparator) {
    return <span className={className}>{visibleValue}</span>;
  }

  return (
    <span className={className}>
      <span aria-hidden="true">{visibleValue}</span>
      <span className="sr-only">
        {formatComparatorLabel(result.comparator)}{" "}
        {formatLabResultValue({ ...result, comparator: null })}
      </span>
    </span>
  );
}

function formatComparatorLabel(
  comparator: NonNullable<LabResultValueInput["comparator"]>,
): string {
  switch (comparator) {
    case "<":
      return "Less than";
    case "<=":
      return "Less than or equal to";
    case ">":
      return "Greater than";
    case ">=":
      return "Greater than or equal to";
  }
}
