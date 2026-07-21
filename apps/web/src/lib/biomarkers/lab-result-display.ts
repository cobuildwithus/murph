interface LabResultValueInput {
  comparator: "<" | "<=" | ">" | ">=" | null;
  normalizedUnit?: string | null;
  normalizedValue?: number | null;
  textValue: string | null;
  unit: string | null;
  value: number | null;
}

interface LabReferenceRangeInput {
  high?: number;
  highComparator?: "<" | "<=";
  low?: number;
  lowComparator?: ">" | ">=";
  text?: string;
}

interface LabResultReferenceRangeInput {
  normalizedReferenceRange?: LabReferenceRangeInput | null;
  normalizedUnit?: string | null;
  referenceRange: LabReferenceRangeInput | null;
  unit: string | null;
}

export function formatLabResultValue(input: LabResultValueInput): string {
  const normalized = typeof input.normalizedValue === "number"
    && Number.isFinite(input.normalizedValue)
    && typeof input.normalizedUnit === "string"
    && input.normalizedUnit.trim().length > 0
    ? { unit: input.normalizedUnit, value: input.normalizedValue }
    : null;
  const value = normalized?.value ?? input.value;
  const unit = labUnitSuffix(normalized?.unit ?? input.unit);

  if (value !== null && Number.isFinite(value)) {
    return `${input.comparator ?? ""}${formatLabNumber(value)}${unit}`;
  }

  const textValue = input.textValue?.trim();
  return textValue && textValue.length > 0 ? textValue : "Not reported";
}

export function formatLabReferenceRange(
  range: LabReferenceRangeInput | null,
  unit: string | null,
): string | null {
  if (!range) {
    return null;
  }

  const text = range.text?.trim();
  if (text) {
    return text;
  }

  const unitLabel = labUnitSuffix(unit);
  if (range.low !== undefined && range.high !== undefined) {
    return `${formatLabNumber(range.low)} to ${formatLabNumber(range.high)}${unitLabel}`;
  }
  if (range.low !== undefined) {
    if (range.lowComparator) {
      return `${range.lowComparator}${formatLabNumber(range.low)}${unitLabel}`;
    }
    return `At least ${formatLabNumber(range.low)}${unitLabel}`;
  }
  if (range.high !== undefined) {
    if (range.highComparator) {
      return `${range.highComparator}${formatLabNumber(range.high)}${unitLabel}`;
    }
    return `Up to ${formatLabNumber(range.high)}${unitLabel}`;
  }

  return null;
}

export function formatLabResultReferenceRange(
  input: LabResultReferenceRangeInput,
): string | null {
  const normalizedRange = input.normalizedReferenceRange;
  return formatLabReferenceRange(
    normalizedRange ?? input.referenceRange,
    normalizedRange ? input.normalizedUnit ?? input.unit : input.unit,
  );
}

export function formatLabDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsed);
}

export function formatLabUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  return normalized === "percent" || normalized === "percentage" ? "%" : unit;
}

/** Unit suffix for a number: "%" binds tightly, every other unit gets a space. */
export function labUnitSuffix(unit: string | null): string {
  if (!unit) {
    return "";
  }

  const label = formatLabUnit(unit);
  return label === "%" ? "%" : ` ${label}`;
}

export function formatLabNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 1) {
    return new Intl.NumberFormat("en", {
      maximumSignificantDigits: 6,
    }).format(value);
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatLabFlag(flag: string): string {
  return flag
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function labResultYear(date: string): string {
  return /^\d{4}/u.test(date) ? date.slice(0, 4) : "Earlier";
}
