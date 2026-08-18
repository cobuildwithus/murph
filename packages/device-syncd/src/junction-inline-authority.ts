import { canNormalizeJunctionSleepCycleRecordToCompactStages } from "@murphai/importers/device-providers/junction";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";

import {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
} from "./config/connect-routes.ts";

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
 * Returns true when a Junction resource job carries a complete inline import.
 */
export function isJunctionInlineImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  return readJunctionInlineImportJob(input) !== null;
}

/**
 * Returns true only when an inline import is owned by the job's executor source
 * and can therefore survive replacement of that source's credentials.
 */
export function isJunctionCredentialIndependentInlineImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  const inlineImport = readJunctionInlineImportJob(input);
  return inlineImport !== null && areJunctionProviderSlugsDataEquivalent(
    input.payload?.sourceProviderSlug,
    inlineImport.sourceProviderSlug,
  );
}

function readJunctionInlineImportJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
}): {
  sourceProviderSlug: string;
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

  return (
    resource !== "sleep_cycle"
    || canNormalizeJunctionSleepCycleRecordToCompactStages(record, sourceProviderSlug)
  )
    ? { sourceProviderSlug }
    : null;
}

export function resolveDeviceSyncJunctionInlineSourceProviderSlug(
  record: Record<string, unknown>,
): string | null {
  const classification = classifyDeviceSyncJunctionInlineSourceProviderSlug(record);
  return classification.status === "resolved"
    ? classification.sourceProviderSlug
    : null;
}

export type DeviceSyncJunctionInlineSourceProviderClassification =
  | { status: "ambiguous" | "missing" }
  | { sourceProviderSlug: string; status: "resolved" };

export function areJunctionProviderSlugsDataEquivalent(
  left: unknown,
  right: unknown,
): boolean {
  const normalizedLeft = normalizeHostedJunctionProviderSlug(left);
  const normalizedRight = normalizeHostedJunctionProviderSlug(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const isFitbitMigrationPair = (
    normalizedLeft === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    && normalizedRight === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
  ) || (
    normalizedLeft === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
    && normalizedRight === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
  );
  return !isFitbitMigrationPair && areJunctionDeviceConnectProviderSlugsEquivalent(
    normalizedLeft,
    normalizedRight,
  );
}

export function classifyDeviceSyncJunctionInlineSourceProviderSlug(
  record: Record<string, unknown>,
): DeviceSyncJunctionInlineSourceProviderClassification {
  return classifyJunctionInlineRecordSource(record, null);
}

function classifyJunctionInlineRecordSource(
  record: Record<string, unknown>,
  fallbackSourceProviderSlug: string | null,
): DeviceSyncJunctionInlineSourceProviderClassification {
  const explicitSourceProviderSlug = normalizeHostedJunctionProviderSlug(
    resolveJunctionOrigin({ ...record, provider: undefined }).sourceProviderSlug,
  );
  const providerMetadataSourceProviderSlug = normalizeHostedJunctionProviderSlug(
    resolveJunctionOrigin({ provider: record.provider }).sourceProviderSlug,
  );
  const childClassifications: DeviceSyncJunctionInlineSourceProviderClassification[] = [];

  for (const key of JUNCTION_INLINE_NESTED_RECORD_KEYS) {
    const value = record[key];
    for (const candidate of Array.isArray(value) ? value : [value]) {
      const child = readJunctionInlineRecord(candidate);
      if (child) {
        childClassifications.push(classifyJunctionInlineRecordSource(child, null));
      }
    }
  }

  const groups = readJunctionInlineRecord(record.groups);
  if (groups) {
    for (const [sourceSlug, rawGroups] of Object.entries(groups)) {
      const groupFallback = normalizeHostedJunctionProviderSlug(sourceSlug);
      for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : [rawGroups]) {
        const group = readJunctionInlineRecord(rawGroup);
        if (group) {
          childClassifications.push(
            classifyJunctionInlineRecordSource(group, groupFallback),
          );
        }
      }
    }
  }

  if (childClassifications.length > 0) {
    const childClassification = combineJunctionInlineSourceClassifications(
      childClassifications,
    );
    if (childClassification.status !== "missing") {
      if (
        explicitSourceProviderSlug
        && childClassification.status === "resolved"
        && !areJunctionProviderSlugsDataEquivalent(
          childClassification.sourceProviderSlug,
          explicitSourceProviderSlug,
        )
      ) {
        return { status: "ambiguous" };
      }
      return childClassification;
    }
  }

  const sourceProviderSlug = explicitSourceProviderSlug
    ?? providerMetadataSourceProviderSlug
    ?? fallbackSourceProviderSlug;
  return sourceProviderSlug
    ? { sourceProviderSlug, status: "resolved" }
    : { status: "missing" };
}

function combineJunctionInlineSourceClassifications(
  classifications: readonly DeviceSyncJunctionInlineSourceProviderClassification[],
): DeviceSyncJunctionInlineSourceProviderClassification {
  if (classifications.some((classification) => classification.status === "ambiguous")) {
    return { status: "ambiguous" };
  }
  const hasMissing = classifications.some((classification) =>
    classification.status === "missing"
  );
  const slugs = classifications.flatMap((classification) =>
    classification.status === "resolved"
      ? [classification.sourceProviderSlug]
      : []
  );
  const sourceProviderSlug = slugs[0];
  if (
    sourceProviderSlug
    && slugs.some((slug) =>
      !areJunctionProviderSlugsDataEquivalent(sourceProviderSlug, slug)
    )
  ) {
    return { status: "ambiguous" };
  }
  if (sourceProviderSlug && hasMissing) {
    return { status: "ambiguous" };
  }
  return sourceProviderSlug
    ? { sourceProviderSlug, status: "resolved" }
    : { status: "missing" };
}

function readJunctionInlineRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
