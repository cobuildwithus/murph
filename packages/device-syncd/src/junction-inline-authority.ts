import { canNormalizeJunctionSleepCycleRecordToCompactStages } from "@murphai/importers/device-providers/junction";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";

const JUNCTION_CREDENTIAL_INDEPENDENT_INLINE_SUMMARY_RESOURCES = new Set<string>(
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
);
const JUNCTION_INLINE_NESTED_RECORD_KEYS = Object.freeze([
  "data",
  "results",
  "items",
  "records",
] as const);

/**
 * Returns true only when a Junction resource job carries everything the
 * provider needs to reach a canonical import without connection credentials.
 */
export function isJunctionCredentialIndependentInlineImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  return readJunctionCredentialIndependentInlineImport(input) !== null;
}

/**
 * Returns true only when the inline import cannot cross the Junction provider
 * boundary. Source-reference sleep payloads still need an authenticated
 * provider-list lookup and therefore remain active/default work.
 */
export function isJunctionProviderEgressFreeInlineImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  const directImport = readJunctionCredentialIndependentInlineImport(input);
  return directImport !== null
    && !requiresJunctionInlineImportProviderLookup(directImport);
}

export function requiresJunctionInlineImportProviderLookup(input: {
  record: Record<string, unknown>;
  resource: string;
}): boolean {
  return (input.resource === "sleep_cycle" || input.resource === "sleep")
    && hasJunctionSourceReferenceIdentity(input.record);
}

function readJunctionCredentialIndependentInlineImport(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): {
  record: Record<string, unknown>;
  resource: string;
} | null {
  if (input.kind !== "resource" || input.payload?.resourceCategory !== "summary") {
    return null;
  }
  const resource = normalizeJunctionResourceName(input.payload.resource);
  if (
    !resource
    || !JUNCTION_CREDENTIAL_INDEPENDENT_INLINE_SUMMARY_RESOURCES.has(resource)
    || typeof input.payload.webhookDataJson !== "string"
    || input.payload.webhookDataJson.trim().length === 0
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payload.webhookDataJson);
  } catch {
    return null;
  }
  const record = readJunctionInlineRecord(parsed);
  if (!record) {
    return null;
  }
  const sourceProviderSlug = resolveDeviceSyncJunctionInlineSourceProviderSlug(record);
  if (!sourceProviderSlug) {
    return null;
  }

  if (
    resource === "sleep_cycle"
    && !canNormalizeJunctionSleepCycleRecordToCompactStages(record, sourceProviderSlug)
  ) {
    return null;
  }

  return { record, resource };
}

export function resolveDeviceSyncJunctionInlineSourceProviderSlug(
  record: Record<string, unknown>,
): string | null {
  const slugs = new Set<string>();
  const addRecordSlug = (entry: Record<string, unknown>): void => {
    const slug = normalizeHostedJunctionProviderSlug(
      resolveJunctionOrigin(entry).sourceProviderSlug,
    );
    if (slug) {
      slugs.add(slug);
    }
  };

  addRecordSlug(record);
  for (const entry of readJunctionInlineNestedRecords(record)) {
    addRecordSlug(entry);
  }

  const groups = readJunctionInlineRecord(record.groups);
  if (groups) {
    for (const [sourceSlug, rawGroups] of Object.entries(groups)) {
      const normalizedGroupSlug = normalizeHostedJunctionProviderSlug(sourceSlug);
      if (normalizedGroupSlug) {
        slugs.add(normalizedGroupSlug);
      }
      for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) {
        const group = readJunctionInlineRecord(rawGroup);
        if (!group) {
          continue;
        }
        addRecordSlug(group);
        for (const entry of readJunctionInlineNestedRecords(group)) {
          addRecordSlug(entry);
        }
      }
    }
  }

  return slugs.size === 1 ? [...slugs][0] ?? null : null;
}

function readJunctionInlineNestedRecords(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  return JUNCTION_INLINE_NESTED_RECORD_KEYS.flatMap((key) => {
    const direct = readJunctionInlineRecord(record[key]);
    if (direct) {
      return [direct];
    }
    return (Array.isArray(record[key]) ? record[key] : []).flatMap((entry) => {
      const nested = readJunctionInlineRecord(entry);
      return nested ? [nested] : [];
    });
  });
}

function readJunctionInlineRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasJunctionSourceReferenceIdentity(
  value: unknown,
  seen: Set<Record<string, unknown>> = new Set(),
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasJunctionSourceReferenceIdentity(entry, seen));
  }

  const record = readJunctionInlineRecord(value);
  if (!record || seen.has(record)) {
    return false;
  }
  seen.add(record);

  return Object.entries(record).some(([key, nested]) =>
    (isJunctionSourceReferenceIdentityKey(key) && normalizeJunctionReference(nested) !== null)
    || hasJunctionSourceReferenceIdentity(nested, seen)
  );
}

function isJunctionSourceReferenceIdentityKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return normalized === "connectionid"
    || normalized === "providerconnectionid"
    || normalized === "sourceid";
}

function normalizeJunctionReference(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeHostedJunctionProviderSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized || null;
}
