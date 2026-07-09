export interface MetricSelectionLike {
  selection?: {
    unit?: string | null;
    value?: number | null;
  } | null;
}

// Pinned so SSR and the browser format identically regardless of user locale;
// a locale-dependent format hydration-mismatches on SSR-ed client components.
const DISPLAY_LOCALE = "en-US";

export function formatIsoDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!value) {
    return "—";
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? `${value}T12:00:00Z`
    : value;
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, options).format(parsed);
}

export function formatIsoDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat(DISPLAY_LOCALE, options).format(value);
}

export function formatMetricValue(
  metric: MetricSelectionLike | null | undefined,
  fallback = "—",
): string {
  const value = metric?.selection?.value;
  const unit = metric?.selection?.unit;

  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const numeric = new Intl.NumberFormat(DISPLAY_LOCALE, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  }).format(value);

  return unit ? `${numeric} ${unit}` : numeric;
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  const formatted = new Intl.NumberFormat(DISPLAY_LOCALE, {
    maximumFractionDigits: Math.abs(value) >= 10 ? 0 : 1,
    signDisplay: "always",
  }).format(value);

  return `${formatted}%`;
}

export function formatConfidenceLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split(/[_-]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatStatusLabel(value: string | null | undefined): string {
  return formatConfidenceLabel(value);
}

export function formatStreamLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown stream";
  }

  return value
    .split(/[._-]/u)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 3) {
        return part.toUpperCase();
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
