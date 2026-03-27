import {
  extractIsoDatePrefix as extractIsoDatePrefixShared,
  normalizeIanaTimeZone,
  toLocalDayKey as toLocalDayKeyShared,
} from "@healthybob/contracts";

import { DEFAULT_TIMEZONE } from "./constants.ts";
import { VaultError } from "./errors.ts";

import type { DateInput } from "./types.ts";

export function coerceDate(value: DateInput | undefined, fieldName = "date"): Date {
  const candidate = value === undefined ? new Date() : value;
  const date = candidate instanceof Date ? new Date(candidate) : new Date(candidate);

  if (Number.isNaN(date.getTime())) {
    throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
      fieldName,
      value: value instanceof Date ? value.toISOString() : value ?? null,
    });
  }

  return date;
}

export function toIsoTimestamp(value: DateInput | undefined, fieldName = "date"): string {
  return coerceDate(value, fieldName).toISOString();
}

export function toDateOnly(value: DateInput | undefined, fieldName = "date"): string {
  const extracted = typeof value === "string" ? extractIsoDatePrefixShared(value) : null;
  if (extracted) {
    return extracted;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toIsoTimestamp(value, fieldName).slice(0, 10);
}

export function toMonthShard(value: DateInput | undefined, fieldName = "date"): string {
  return toIsoTimestamp(value, fieldName).slice(0, 7);
}

export function normalizeTimeZone(
  value: string | null | undefined,
  fieldName = "timeZone",
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = normalizeIanaTimeZone(value);
  if (!normalized) {
    throw new VaultError("VAULT_INVALID_TIMEZONE", `Invalid ${fieldName}.`, {
      fieldName,
      value,
    });
  }

  return normalized;
}

export function requireTimeZone(
  value: string | null | undefined,
  fieldName = "timeZone",
): string {
  return normalizeTimeZone(value, fieldName) ?? defaultTimeZone();
}

export function defaultTimeZone(): string {
  return DEFAULT_TIMEZONE;
}

export function toLocalDayKey(
  value: DateInput | undefined,
  timeZone: string,
  fieldName = "date",
): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const extracted = extractIsoDatePrefixShared(value);
    if (extracted) {
      return extracted;
    }
  }

  try {
    return toLocalDayKeyShared(coerceDate(value, fieldName), requireTimeZone(timeZone));
  } catch (error) {
    throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
      fieldName,
      timeZone,
      value: value instanceof Date ? value.toISOString() : value ?? null,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function extractIsoDatePrefix(value: string | null | undefined): string | null {
  return extractIsoDatePrefixShared(value);
}
