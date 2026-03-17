import path from "node:path";

import { VaultError } from "../errors.js";
import { parseFrontmatterDocument } from "../frontmatter.js";
import { readUtf8File, walkVaultFiles } from "../fs.js";
import { sanitizePathSegment } from "../path-safety.js";
import { resolveRecordByIdOrSlug } from "../registry/id-or-slug.js";
import { toDateOnly } from "../time.js";

import {
  bulletList,
  heading,
  normalizeId,
  normalizeSlug,
  normalizeStringList,
  optionalEnum,
  optionalInteger,
  optionalString,
  requireString,
} from "../history/shared.js";

import type { DateInput, FrontmatterObject } from "../types.js";

export interface RegistryRecordBase {
  slug: string;
  relativePath: string;
  markdown: string;
}

export function stripUndefined<TRecord>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

export function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function normalizeDateOnly(value: DateInput, fieldName: string): string {
  return toDateOnly(value, fieldName);
}

export function optionalDateOnly(value: DateInput | undefined, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeDateOnly(value, fieldName);
}

export function normalizeRecordIdList(
  value: unknown,
  fieldName: string,
  prefix: string,
  maxItems = 24,
): string[] | undefined {
  const values = normalizeStringList(value, fieldName, "id", maxItems, 80);

  if (!values) {
    return undefined;
  }

  return values.map((entry, index) => normalizeId(entry, `${fieldName}[${index}]`, prefix) as string);
}

export function normalizeDomainList(value: unknown, fieldName: string): string[] | undefined {
  const values = normalizeStringList(value, fieldName, "domain", 24, 80);

  if (!values) {
    return undefined;
  }

  const normalized = values.map((entry, index) => {
    const domain = sanitizePathSegment(entry, "");
    if (!domain) {
      throw new VaultError("VAULT_INVALID_INPUT", `${fieldName}[${index}] could not be normalized.`);
    }

    return domain;
  });

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function optionalFiniteNumber(
  value: unknown,
  fieldName: string,
  minimum?: number,
  maximum?: number,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a finite number.`);
  }

  if (minimum !== undefined && value < minimum) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be >= ${minimum}.`);
  }

  if (maximum !== undefined && value > maximum) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be <= ${maximum}.`);
  }

  return value;
}

export async function loadMarkdownRegistry<TRecord>(
  vaultRoot: string,
  relativeDirectory: string,
  parseRecord: (attributes: FrontmatterObject, relativePath: string, markdown: string) => TRecord,
  sortRecords: (left: TRecord, right: TRecord) => number,
): Promise<TRecord[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, relativeDirectory, { extension: ".md" });
  const records: TRecord[] = [];

  for (const relativePath of relativePaths) {
    const markdown = await readUtf8File(vaultRoot, relativePath);
    const document = parseFrontmatterDocument(markdown);
    records.push(parseRecord(document.attributes, relativePath, markdown));
  }

  records.sort(sortRecords);

  return records;
}

export function selectRecordByIdOrSlug<TRecord extends RegistryRecordBase>(
  records: TRecord[],
  idValue: string | undefined,
  slug: string | undefined,
  getId: (record: TRecord) => string,
  entityLabel: string,
  conflictCode: string,
): TRecord | null {
  const selection = resolveRecordByIdOrSlug({
    records,
    recordId: idValue,
    slug,
    getRecordId: getId,
    detectConflict: true,
  });

  if (selection.hasConflict) {
    throw new VaultError(conflictCode, `${entityLabel} id and slug resolve to different records.`);
  }

  return selection.match;
}

export function findRecordByIdOrSlug<TRecord extends RegistryRecordBase>(
  records: TRecord[],
  idValue: string | undefined,
  slug: string | undefined,
  getId: (record: TRecord) => string,
): TRecord | null {
  return resolveRecordByIdOrSlug({
    records,
    recordId: idValue,
    slug,
    getRecordId: getId,
  }).match;
}

export function requireMatchingDocType(
  attributes: FrontmatterObject,
  schemaVersion: string,
  docType: string,
  missingCode: string,
  missingMessage: string,
): void {
  if (
    requireString(attributes.schemaVersion, "schemaVersion", 64) !== schemaVersion ||
    requireString(attributes.docType, "docType", 64) !== docType
  ) {
    throw new VaultError(missingCode, missingMessage);
  }
}

export function normalizePriority(value: unknown): number {
  return optionalInteger(value ?? 5, "priority", 1, 10) ?? 5;
}

export function normalizeSelectorSlug(value: string | undefined): string | undefined {
  return value ? normalizeSlug(value, "slug") : undefined;
}

export function normalizeUpsertSelectorSlug(
  rawSlug: string | undefined,
  rawTitle: string | undefined,
): string | undefined {
  return normalizeSelectorSlug(rawSlug) ?? (rawTitle ? normalizeSlug(undefined, "slug", rawTitle) : undefined);
}

export function normalizeGroupPath(value: string | undefined, fallback: string): string {
  const rawValue = optionalString(value, "group", 160) ?? fallback;
  const segments = rawValue
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment, ""))
    .filter(Boolean);

  if (segments.length === 0) {
    throw new VaultError("VAULT_INVALID_INPUT", "group could not be normalized.");
  }

  return segments.join("/");
}

export function groupFromRegimenPath(relativePath: string, rootDirectory: string): string {
  const relativeToRoot = path.posix.relative(rootDirectory, relativePath);
  const directoryName = path.posix.dirname(relativeToRoot);

  if (!directoryName || directoryName === ".") {
    throw new VaultError("VAULT_INVALID_REGIMEN", "Regimen path is missing a group directory.");
  }

  return directoryName;
}

export function section(title: string, body: string): string {
  return `${heading(title)}\n\n${body}`;
}

export function listSection(title: string, values: readonly string[] | undefined): string {
  return section(title, bulletList(values));
}

export function buildMarkdownBody(title: string, summary: string, sections: readonly string[]): string {
  return [`# ${title}`, summary, ...sections, ""].join("\n\n");
}

export function detailList(entries: Array<[string, string | number | undefined | null]>): string {
  return bulletList(
    entries.map(([label, value]) => {
      if (value === undefined || value === null || value === "") {
        return `${label}: none`;
      }

      return `${label}: ${value}`;
    }),
  );
}

export function resolveOptionalUpsertValue<TRawValue, TPersistedValue>(
  rawInputValue: TRawValue | undefined,
  persistedValue: TPersistedValue | undefined,
  normalize: (value: TRawValue) => TPersistedValue | undefined,
): TPersistedValue | undefined {
  return rawInputValue === undefined ? persistedValue : normalize(rawInputValue);
}

export function resolveRequiredUpsertValue<TRawValue, TPersistedValue>(
  rawInputValue: TRawValue | undefined,
  persistedValue: TPersistedValue | undefined,
  defaultValue: TPersistedValue,
  normalize: (value: TRawValue) => TPersistedValue,
): TPersistedValue {
  return rawInputValue === undefined ? persistedValue ?? defaultValue : normalize(rawInputValue);
}

export {
  normalizeId,
  normalizeSlug,
  normalizeStringList,
  optionalEnum,
  optionalInteger,
  optionalString,
  requireString,
};
