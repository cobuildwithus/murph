import { VaultError } from "../errors.js";
import { normalizeRelativeVaultPath, sanitizePathSegment } from "../path-safety.js";
import { toIsoTimestamp } from "../time.js";

import type { DateInput } from "../types.js";

const ULID_SUFFIX_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";

export function requireString(value: unknown, fieldName: string, maxLength = 240): string {
  const candidate = String(value ?? "").trim();

  if (!candidate) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} is required.`);
  }

  if (candidate.length > maxLength) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum length.`);
  }

  return candidate;
}

export function optionalString(
  value: unknown,
  fieldName: string,
  maxLength = 4000,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const candidate = String(value).trim();

  if (!candidate) {
    return undefined;
  }

  if (candidate.length > maxLength) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum length.`);
  }

  return candidate;
}

export function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a boolean.`);
  }

  return value;
}

export function optionalInteger(
  value: unknown,
  fieldName: string,
  minimum?: number,
  maximum?: number,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an integer.`);
  }

  if (minimum !== undefined && value < minimum) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be >= ${minimum}.`);
  }

  if (maximum !== undefined && value > maximum) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be <= ${maximum}.`);
  }

  return value;
}

export function optionalEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fieldName: string,
): TValue | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a string.`);
  }

  if (!allowed.includes(value as TValue)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be one of ${allowed.join(", ")}.`);
  }

  return value as TValue;
}

export function validateSortedStringList(
  value: unknown,
  fieldName: string,
  itemFieldName = "item",
  maxItems = 32,
  maxLength = 240,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array.`);
  }

  if (value.length > maxItems) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum item count.`);
  }

  const normalized = value
    .map((entry, index) => requireString(entry, `${fieldName}[${index}].${itemFieldName}`, maxLength))
    .filter(Boolean);

  if (normalized.length === 0) {
    return undefined;
  }

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function normalizeTagList(value: unknown, fieldName: string): string[] | undefined {
  const values = validateSortedStringList(value, fieldName, "tag", 32, 80);

  if (!values) {
    return undefined;
  }

  return values.map((entry) => sanitizePathSegment(entry, "tag"));
}

export function normalizeRelativePathList(value: unknown, fieldName: string): string[] | undefined {
  const values = validateSortedStringList(value, fieldName, "path", 32, 240);

  if (!values) {
    return undefined;
  }

  return values.map((entry) => normalizeRelativeVaultPath(entry));
}

export function normalizeId(
  value: unknown,
  fieldName: string,
  prefix: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const candidate = requireString(value, fieldName, 64);
  const pattern = new RegExp(`^${prefix}_${ULID_SUFFIX_PATTERN}$`);

  if (!pattern.test(candidate)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must match ${prefix}_<ULID>.`);
  }

  return candidate;
}

export function normalizeSlug(value: unknown, fieldName: string, fallbackField?: string): string {
  const candidate = optionalString(value, fieldName, 160) ?? fallbackField;
  const slug = sanitizePathSegment(candidate, "");

  if (!slug) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} could not be normalized to a slug.`);
  }

  return slug;
}

export function normalizeTimestamp(value: DateInput | undefined, fieldName: string): string {
  return toIsoTimestamp(value, fieldName);
}

export function compareIsoTimestamps(
  left: { occurredAt: string; recordedAt: string; id: string },
  right: { occurredAt: string; recordedAt: string; id: string },
  order: "asc" | "desc",
): number {
  const occurredComparison = left.occurredAt.localeCompare(right.occurredAt);
  if (occurredComparison !== 0) {
    return order === "asc" ? occurredComparison : -occurredComparison;
  }

  const recordedComparison = left.recordedAt.localeCompare(right.recordedAt);
  if (recordedComparison !== 0) {
    return order === "asc" ? recordedComparison : -recordedComparison;
  }

  return order === "asc" ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
}

export function heading(text: string): string {
  return `## ${text}`;
}

export function bulletList(values: readonly string[] | undefined): string {
  if (!values || values.length === 0) {
    return "- none";
  }

  return values.map((value) => `- ${value}`).join("\n");
}

export function maybeSection(title: string, content: string | undefined): string {
  if (!content) {
    return `${heading(title)}\n\n- none`;
  }

  return `${heading(title)}\n\n${content}`;
}
