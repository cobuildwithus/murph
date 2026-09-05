import type { PublicProductDetail } from "@murphai/contracts";

export type ProductTestObservation =
  PublicProductDetail["productTests"]["observations"][number];

export function formatProductTestResult(
  result: ProductTestObservation["result"],
): string {
  switch (result.operator) {
    case "not_detected":
      return `Not detected (reported in ${result.unit})`;
    case "detected":
      return `Detected (reported in ${result.unit})`;
    case "trace":
      return `Trace (reported in ${result.unit})`;
    case "lt":
      return `Less than ${formatNullableNumber(result.value)} ${
        result.unit
      }`.trim();
    case "lte":
      return `Less than or equal to ${formatNullableNumber(result.value)} ${
        result.unit
      }`.trim();
    case "gt":
      return `Greater than ${formatNullableNumber(result.value)} ${
        result.unit
      }`.trim();
    case "gte":
      return `Greater than or equal to ${formatNullableNumber(result.value)} ${
        result.unit
      }`.trim();
    case "range":
      return formatProductTestRange(result);
    case "eq":
      return `${formatNullableNumber(result.value)} ${result.unit}`.trim();
  }
}

function formatProductTestRange(
  result: ProductTestObservation["result"],
): string {
  if (result.value !== null && result.upperValue != null) {
    return `${formatProductTestNumber(result.value)}–${formatProductTestNumber(
      result.upperValue,
    )} ${result.unit}`.trim();
  }

  if (result.value !== null) {
    return `From ${formatProductTestNumber(result.value)} ${
      result.unit
    } (upper bound not reported)`.trim();
  }

  if (result.upperValue != null) {
    return `Up to ${formatProductTestNumber(result.upperValue)} ${
      result.unit
    } (lower bound not reported)`.trim();
  }

  return result.unit
    ? `Range not reported (${result.unit})`
    : "Range not reported";
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "Value not reported" : formatProductTestNumber(value);
}

export function formatNormalizedProductTestResult(
  observation: ProductTestObservation,
): string {
  const normalized = observation.normalizedResult;
  if (!normalized) {
    return "Value not reported";
  }

  if (observation.result.operator === "range") {
    if (normalized.upperValue != null) {
      return `${formatProductTestNumber(
        normalized.value,
      )}–${formatProductTestNumber(normalized.upperValue)} ${
        normalized.unit
      }`.trim();
    }

    return `From ${formatProductTestNumber(normalized.value)} ${
      normalized.unit
    } (upper bound not reported)`.trim();
  }

  return `${formatProductTestNumber(normalized.value)} ${
    normalized.unit
  }`.trim();
}

export function formatProductTestNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 15,
  }).format(value);
}

export function hasDistinctNormalizedProductTestResult(
  observation: ProductTestObservation,
): boolean {
  const normalized = observation.normalizedResult;
  if (!normalized) {
    return false;
  }

  if (
    observation.result.operator !== "eq" &&
    observation.result.operator !== "range"
  ) {
    return true;
  }

  return (
    observation.result.value !== normalized.value ||
    (observation.result.upperValue ?? null) !==
      (normalized.upperValue ?? null) ||
    observation.result.unit !== normalized.unit ||
    observation.result.basis !== normalized.basis
  );
}

export function formatEvidenceBasis(value: string): string {
  switch (value) {
    case "product_mass":
      return "per unit of product mass";
    case "oral_total_dietary_exposure":
      return "total daily oral exposure";
    default:
      return value.replaceAll("_", " ");
  }
}
