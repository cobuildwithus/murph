import { VaultError } from "./errors.js";

import type { DateInput } from "./types.js";

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
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toIsoTimestamp(value, fieldName).slice(0, 10);
}

export function toMonthShard(value: DateInput | undefined, fieldName = "date"): string {
  return toIsoTimestamp(value, fieldName).slice(0, 7);
}
