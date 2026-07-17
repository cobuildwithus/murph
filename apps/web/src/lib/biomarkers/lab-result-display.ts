interface LabResultValueInput {
  comparator: "<" | "<=" | ">" | ">=" | null;
  textValue: string | null;
  unit: string | null;
  value: number | null;
}

interface LabReferenceRangeInput {
  high?: number;
  low?: number;
  text?: string;
}

export function formatLabResultValue(input: LabResultValueInput): string {
  const unit = input.unit ? ` ${formatLabUnit(input.unit)}` : "";

  if (input.value !== null && Number.isFinite(input.value)) {
    return `${input.comparator ?? ""}${formatLabNumber(input.value)}${unit}`;
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

  const unitLabel = unit ? ` ${formatLabUnit(unit)}` : "";
  if (range.low !== undefined && range.high !== undefined) {
    return `${formatLabNumber(range.low)} to ${formatLabNumber(range.high)}${unitLabel}`;
  }
  if (range.low !== undefined) {
    return `At least ${formatLabNumber(range.low)}${unitLabel}`;
  }
  if (range.high !== undefined) {
    return `Up to ${formatLabNumber(range.high)}${unitLabel}`;
  }

  return null;
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
