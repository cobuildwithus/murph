import type { Amount } from "./contract";
import type { MeasureSeries } from "./series";

/** Shared by totals, goals, medals and Friends. Only signed gaps compact below 10,000. */
export function formatNumber(value: number, style: "full" | "compact" | "delta"): string {
  const absolute = Math.abs(value);
  const compact = style !== "full" && absolute >= (style === "delta" ? 1000 : 10_000);
  const text = (compact ? value / 1000 : value).toLocaleString("en-US", {
    maximumFractionDigits: compact && absolute < 100_000 ? 1 : 0,
  });
  return `${style === "delta" && value > 0 ? "+" : ""}${text}${compact ? "k" : ""}`;
}

export function formatAmount(value: number, unit: MeasureSeries["unit"], style: "full" | "compact" = "compact"): Amount {
  let text: string;
  if (unit === "seconds") {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    text = hours ? `${formatNumber(hours, style)}h${minutes ? ` ${minutes}m` : ""}` : minutes ? `${minutes}m` : `${Math.floor(value)}s`;
  } else if (unit === "meters") {
    const miles = value / 1609.344;
    text = `${miles < 10 ? miles.toLocaleString("en-US", { maximumFractionDigits: 1 }) : formatNumber(miles, style)} mi`;
  } else text = formatNumber(value, style);
  return { value, text, unit };
}
