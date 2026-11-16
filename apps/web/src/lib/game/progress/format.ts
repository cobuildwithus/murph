import type { Amount } from "./contract";
import type { MeasureSeries } from "./series";

/** Shared by totals, goals, medals and Friends. Only signed gaps compact below 10,000. */
export function formatNumber(value: number, style: "full" | "compact" | "delta", precision = 0): string {
  const absolute = Math.abs(value);
  const compact = style !== "full" && absolute >= (style === "delta" ? 1000 : 10_000);
  const text = (compact ? value / 1000 : value).toLocaleString("en-US", {
    maximumFractionDigits: compact ? absolute < 100_000 ? 1 : 0 : precision,
  });
  return `${style === "delta" && value > 0 ? "+" : ""}${text}${compact ? "k" : ""}`;
}

export function formatAmount(value: number, unit: MeasureSeries["unit"] | "bpm" | "mL/kg/min", style: "full" | "compact" | "clock" = "compact"): Amount {
  let text: string;
  const numberStyle = style === "clock" ? "compact" : style;
  if (unit === "seconds") {
    const totalMinutes = style === "clock" ? Math.round(value / 60) : Math.floor(value / 60);
    const hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60;
    text = style === "clock" ? `${formatNumber(hours, numberStyle)}h ${String(minutes).padStart(2, "0")}`
      : hours ? `${formatNumber(hours, numberStyle)}h${minutes ? ` ${minutes}m` : ""}` : minutes ? `${minutes}m` : `${Math.floor(value)}s`;
  } else if (unit === "meters") {
    const miles = value / 1609.344;
    text = `${formatNumber(miles, numberStyle, miles < 10 ? 1 : 0)} mi`;
  } else text = formatNumber(value, numberStyle, unit === "mL/kg/min" ? 1 : 0);
  return { value, text, unit };
}
