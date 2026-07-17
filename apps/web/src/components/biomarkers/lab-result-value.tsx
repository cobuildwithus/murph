import type { ComponentProps } from "react";

import { formatLabResultValue } from "@/src/lib/biomarkers/lab-result-display";

type LabResultValueInput = Parameters<typeof formatLabResultValue>[0];

export function LabResultValue({
  className,
  result,
}: {
  result: LabResultValueInput;
} & Pick<ComponentProps<"span">, "className">) {
  const visibleValue = formatLabResultValue(result);
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
