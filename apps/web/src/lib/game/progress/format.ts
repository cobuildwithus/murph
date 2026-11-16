import type { Amount } from "./contract";
import type { MeasureSeries } from "./series";
import type { ClientUnits } from "../../companion/client-info";

/** Shared by totals, goals, medals and Friends. Only signed gaps compact below 10,000. */
export function formatNumber(value: number, style: "full" | "compact" | "delta"): string {
  const absolute = Math.abs(value);
  const compact = style !== "full" && absolute >= (style === "delta" ? 1000 : 10_000);
  const text = (compact ? value / 1000 : value).toLocaleString("en-US", {
    maximumFractionDigits: compact && absolute < 100_000 ? 1 : 0,
  });
  return `${style === "delta" && value > 0 ? "+" : ""}${text}${compact ? "k" : ""}`;
}

export function formatAmount(value: number, unit: MeasureSeries["unit"], style: "full" | "compact", units: ClientUnits): Amount {
  let text: string;
  if (unit === "seconds") {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    text = hours ? `${formatNumber(hours, style)}h${minutes ? ` ${minutes}m` : ""}` : minutes ? `${minutes}m` : `${Math.floor(value)}s`;
  } else if (unit === "meters") {
    const distance = value / (units === "metric" ? 1000 : 1609.344);
    text = `${distance < 10 ? distance.toLocaleString("en-US", { maximumFractionDigits: 1 }) : formatNumber(distance, style)} ${units === "metric" ? "km" : "mi"}`;
  } else text = formatNumber(value, style);
  return { value, text, unit };
}

export function formatHeight(feet: number, units: ClientUnits): string {
  return `${formatNumber(units === "us" ? feet : feet * 0.3048, "compact")} ${units === "us" ? "ft" : "m"}`;
}

/** Rungs retain seconds and longer durations that the compact measure label omits. */
export function formatRungTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toLocaleString("en-US", { maximumFractionDigits: 2 })} sec`;
  if (seconds >= 86400) {
    const days = Math.round(seconds / 86400);
    return `${formatNumber(days, "compact")} ${days === 1 ? "day" : "days"}`;
  }
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours} hr${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}
