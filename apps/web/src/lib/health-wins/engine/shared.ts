import { formatNumber as formatProgressNumber } from "../../game/progress/format";

export { isStrictIsoDate as isDate } from "@murphai/contracts/time";

export function labUnitKey(unit: string): string {
  return unit.trim().replace(/[µμ]/gu, "u");
}

/** Normalize arrows from caller-supplied display text, including ASCII and emoji forms. */
export function cardText(value: string): string {
  return value.replace(/\s*(?:<?[-=]+>|<[-=]+|[\u2190-\u21ff\u2794\u2798-\u27af\u27b1-\u27be\u27f0-\u27ff\u2900-\u297f\u2b00-\u2b11\u2b30-\u2b4c\u2b60-\u2b95\u{1f800}-\u{1f8ff}])\uFE0F?\s*/gu, " ").trim();
}

/** The input is a validated local calendar date. UTC arithmetic preserves day counts across DST. */
export function dayNumber(date: string): number {
  return Date.parse(date) / 86_400_000;
}

const months = {
  long: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }),
  short: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }),
};

export function formatWinMonth(date: string, style: "long" | "short" = "long"): string {
  return months[style].format(new Date(date));
}

/** Display a validated local calendar day relative to the member's current year. */
export function formatWinDate(date: string, today: string): string {
  const year = date.slice(0, 4);
  const day = `${formatWinMonth(date, "short")} ${Number(date.slice(8, 10))}`;
  return year === today.slice(0, 4) ? day : `${day}, ${year}`;
}

/** A card ID keeps the observation's year even as the member's display year changes. */
export function cardDateKey(date: string): string {
  return date.replaceAll("-", "");
}

export function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mad(values: readonly number[]): number {
  const center = median(values);
  return median(values.map(value => Math.abs(value - center)));
}

export function formatNumber(value: number, digits = 1): string {
  return formatProgressNumber(value, "full", digits);
}

export function milesFromKm(km: number): number {
  return km / 1.609344;
}

export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${formatNumber(hours, 0)}h ${remainder}m` : `${formatNumber(hours, 0)}h`;
}

export function formatLabValue(value: number, unit: string): string {
  const number = value > 0 && value < 0.05 ? "<0.1" : formatNumber(value);
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
}
