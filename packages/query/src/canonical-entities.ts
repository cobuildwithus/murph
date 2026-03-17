import {
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  maybeString,
} from "./health/shared.js";

import type { MarkdownDocumentRecord } from "./health/shared.js";
import type { RegistryMarkdownRecord } from "./health/registries.js";

export type CanonicalEntityFamily =
  | "allergy"
  | "assessment"
  | "audit"
  | "condition"
  | "core"
  | "current_profile"
  | "event"
  | "experiment"
  | "family"
  | "genetics"
  | "goal"
  | "history"
  | "journal"
  | "profile_snapshot"
  | "regimen"
  | "sample";

export interface CanonicalEntity {
  entityId: string;
  primaryLookupId: string;
  lookupIds: string[];
  family: CanonicalEntityFamily;
  kind: string;
  status: string | null;
  occurredAt: string | null;
  date: string | null;
  path: string;
  title: string | null;
  body: string | null;
  attributes: Record<string, unknown>;
  frontmatter: Record<string, unknown> | null;
  relatedIds: string[];
  stream: string | null;
  experimentSlug: string | null;
  tags: string[];
}

export const HEALTH_HISTORY_KINDS = new Set([
  "encounter",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
] as const);

const REGISTRY_RELATION_ARRAY_KEYS = [
  "relatedIds",
  "relatedGoalIds",
  "relatedExperimentIds",
  "relatedRegimenIds",
  "sourceFamilyMemberIds",
  "sourceAssessmentIds",
  "sourceEventIds",
  "topGoalIds",
  "familyMemberIds",
  "conditionIds",
  "goalIds",
  "regimenIds",
] as const;

const REGISTRY_RELATION_SCALAR_KEYS = [
  "parentGoalId",
  "snapshotId",
  "conditionId",
  "goalId",
  "regimenId",
  "sourceAssessmentId",
  "sourceEventId",
] as const;

export function normalizeCanonicalDate(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value.length >= 10 ? value.slice(0, 10) : value;
}

export function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ];
}

export function normalizeUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeTags(value: unknown): string[] {
  return normalizeUniqueStringArray(value);
}

export function projectAssessmentEntity(
  value: unknown,
  relativePath: string,
): CanonicalEntity | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  if (!id?.startsWith("asmt_")) {
    return null;
  }

  const recordedAt = firstString(source, ["recordedAt", "occurredAt", "importedAt"]);
  const importedAt = firstString(source, ["importedAt"]);
  const questionnaireSlug = firstString(source, ["questionnaireSlug"]);

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id, questionnaireSlug]),
    family: "assessment",
    kind: "assessment",
    status: null,
    occurredAt: recordedAt ?? importedAt,
    date: normalizeCanonicalDate(recordedAt ?? importedAt),
    path: relativePath,
    title: firstString(source, ["title"]),
    body: null,
    attributes: {
      ...source,
      recordedAt,
      importedAt,
      questionnaireSlug,
      responses: firstObject(source, ["responses", "response"]) ?? {},
    },
    frontmatter: null,
    relatedIds: firstStringArray(source, ["relatedIds"]),
    stream: null,
    experimentSlug: null,
    tags: normalizeTags(source.tags),
  };
}

export function projectProfileSnapshotEntity(
  value: unknown,
  relativePath: string,
): CanonicalEntity | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  if (!id?.startsWith("psnap_")) {
    return null;
  }

  const sourceObject = firstObject(source, ["source"]) ?? {};
  const sourceAssessmentIds = firstStringArray(source, ["sourceAssessmentIds"]);
  const sourceAssessmentId = firstString(sourceObject, ["assessmentId"]);
  const resolvedAssessmentIds =
    sourceAssessmentIds.length > 0
      ? sourceAssessmentIds
      : sourceAssessmentId
        ? [sourceAssessmentId]
        : [];
  const sourceEventIds = firstStringArray(source, ["sourceEventIds"]);
  const recordedAt = firstString(source, ["recordedAt", "capturedAt"]);
  const capturedAt = firstString(source, ["capturedAt", "recordedAt"]);
  const summary = firstString(source, ["summary"]);
  const status = firstString(source, ["status"]) ?? "accepted";

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id]),
    family: "profile_snapshot",
    kind: "profile_snapshot",
    status,
    occurredAt: recordedAt ?? capturedAt,
    date: normalizeCanonicalDate(recordedAt ?? capturedAt),
    path: relativePath,
    title: summary ?? id,
    body: summary,
    attributes: {
      ...source,
      capturedAt,
      recordedAt,
      status,
      source:
        firstString(source, ["source"]) ??
        firstString(sourceObject, ["kind", "source", "importedFrom"]),
      sourceAssessmentIds: resolvedAssessmentIds,
      sourceEventIds,
      profile: firstObject(source, ["profile"]) ?? {},
    },
    frontmatter: null,
    relatedIds: uniqueStrings([...resolvedAssessmentIds, ...sourceEventIds]),
    stream: null,
    experimentSlug: null,
    tags: uniqueStrings(["profile_snapshot", status, ...normalizeTags(source.tags)]),
  };
}

export function fallbackCurrentProfileEntity(
  latestSnapshot: CanonicalEntity,
): CanonicalEntity | null {
  if (latestSnapshot.family !== "profile_snapshot") {
    return null;
  }

  const profile = asObject(latestSnapshot.attributes.profile) ?? {};
  const sourceAssessmentIds = normalizeUniqueStringArray(
    latestSnapshot.attributes.sourceAssessmentIds,
  );
  const sourceEventIds = normalizeUniqueStringArray(latestSnapshot.attributes.sourceEventIds);
  const topGoalIds = firstStringArray(profile, ["topGoalIds"]);

  return {
    entityId: "current",
    primaryLookupId: "current",
    lookupIds: uniqueStrings(["current", latestSnapshot.entityId]),
    family: "current_profile",
    kind: "current_profile",
    status: null,
    occurredAt: latestSnapshot.occurredAt,
    date: latestSnapshot.date,
    path: "bank/profile/current.md",
    title: "Current profile",
    body: null,
    attributes: {
      snapshotId: latestSnapshot.entityId,
      updatedAt: latestSnapshot.occurredAt,
      sourceAssessmentIds,
      sourceEventIds,
      topGoalIds,
    },
    frontmatter: {
      snapshotId: latestSnapshot.entityId,
      updatedAt: latestSnapshot.occurredAt,
      sourceAssessmentIds,
      sourceEventIds,
      topGoalIds,
    },
    relatedIds: uniqueStrings([
      latestSnapshot.entityId,
      ...sourceAssessmentIds,
      ...sourceEventIds,
      ...topGoalIds,
    ]),
    stream: null,
    experimentSlug: null,
    tags: ["current_profile"],
  };
}

export function projectCurrentProfileEntity(
  document: MarkdownDocumentRecord,
): CanonicalEntity {
  const attributes = document.attributes;
  const body = document.body || document.markdown.trim();
  const snapshotId =
    maybeString(attributes.snapshotId) ??
    body.match(/Snapshot ID:\s+`([^`]+)`/u)?.[1] ??
    null;
  const updatedAt =
    maybeString(attributes.updatedAt) ??
    body.match(/Recorded At:\s+([^\n]+)/u)?.[1]?.trim() ??
    null;
  const sourceAssessmentIds = firstStringArray(attributes, ["sourceAssessmentIds"]);
  const sourceEventIds = firstStringArray(attributes, ["sourceEventIds"]);
  const topGoalIds = firstStringArray(attributes, ["topGoalIds"]);

  return {
    entityId: "current",
    primaryLookupId: "current",
    lookupIds: uniqueStrings(["current", snapshotId]),
    family: "current_profile",
    kind: "current_profile",
    status: null,
    occurredAt: updatedAt,
    date: normalizeCanonicalDate(updatedAt),
    path: document.relativePath,
    title: "Current profile",
    body,
    attributes: {
      ...attributes,
      snapshotId,
      updatedAt,
      sourceAssessmentIds,
      sourceEventIds,
      topGoalIds,
    },
    frontmatter: attributes,
    relatedIds: uniqueStrings([
      snapshotId,
      ...sourceAssessmentIds,
      ...sourceEventIds,
      ...topGoalIds,
    ]),
    stream: null,
    experimentSlug: null,
    tags: uniqueStrings(["current_profile", ...normalizeTags(attributes.tags)]),
  };
}

export function projectHistoryEntity(
  value: unknown,
  relativePath: string,
): CanonicalEntity | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  const kind = firstString(source, ["kind"]);
  const occurredAt = firstString(source, ["occurredAt"]);
  const title = firstString(source, ["title"]);

  if (
    !id?.startsWith("evt_") ||
    !kind ||
    !HEALTH_HISTORY_KINDS.has(kind as (typeof HEALTH_HISTORY_KINDS extends Set<infer TValue> ? TValue : never)) ||
    !occurredAt ||
    !title
  ) {
    return null;
  }

  const relatedIds = firstStringArray(source, ["relatedIds"]);
  const tags = firstStringArray(source, ["tags"]);

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id]),
    family: "history",
    kind,
    status: firstString(source, ["status"]),
    occurredAt,
    date: normalizeCanonicalDate(occurredAt),
    path: relativePath,
    title,
    body: firstString(source, ["note", "summary"]),
    attributes: source,
    frontmatter: null,
    relatedIds,
    stream: null,
    experimentSlug: null,
    tags,
  };
}

export function projectRegistryEntity(
  family: Extract<
    CanonicalEntityFamily,
    "allergy" | "condition" | "family" | "genetics" | "goal" | "regimen"
  >,
  record: RegistryMarkdownRecord,
): CanonicalEntity {
  const attributes = record.attributes;
  const occurredAt =
    firstString(attributes, [
      "updatedAt",
      "recordedAt",
      "capturedAt",
      "assertedOn",
      "resolvedOn",
    ]) ?? null;
  const relatedIds = uniqueStrings([
    ...REGISTRY_RELATION_ARRAY_KEYS.flatMap((key) => firstStringArray(attributes, [key])),
    ...REGISTRY_RELATION_SCALAR_KEYS.map((key) => firstString(attributes, [key])),
  ]);

  return {
    entityId: record.id,
    primaryLookupId: record.id,
    lookupIds: uniqueStrings([record.id, record.slug]),
    family,
    kind: firstString(attributes, ["docType", "kind"]) ?? family,
    status: record.status,
    occurredAt,
    date: normalizeCanonicalDate(occurredAt),
    path: record.relativePath,
    title: record.title,
    body: record.body,
    attributes,
    frontmatter: attributes,
    relatedIds,
    stream: null,
    experimentSlug: firstString(attributes, ["experimentSlug", "experiment_slug"]),
    tags: normalizeTags(attributes.tags),
  };
}

export function compareCanonicalEntities(
  left: CanonicalEntity,
  right: CanonicalEntity,
): number {
  const leftSortKey = left.occurredAt ?? left.date ?? left.entityId;
  const rightSortKey = right.occurredAt ?? right.date ?? right.entityId;

  if (leftSortKey < rightSortKey) {
    return -1;
  }

  if (leftSortKey > rightSortKey) {
    return 1;
  }

  return left.entityId.localeCompare(right.entityId);
}
