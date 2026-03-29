import {
  extractHealthEntityRegistryLinks,
  extractIsoDatePrefix,
  type HealthEntityKind,
  type HealthEntityRegistryLink,
} from "@murph/contracts";

import {
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  maybeString,
} from "./health/shared.ts";

import type { MarkdownDocumentRecord } from "./health/shared.ts";
import type { RegistryMarkdownRecord } from "./health/registries.ts";

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
  | "protocol"
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
  links: CanonicalEntityLink[];
  relatedIds: string[];
  stream: string | null;
  experimentSlug: string | null;
  tags: string[];
}

export type CanonicalEntityLinkType =
  | "parent_of"
  | "related_to"
  | "supports_goal"
  | "addresses_condition"
  | "source_assessment"
  | "source_event"
  | "source_family_member"
  | "top_goal"
  | "snapshot_of";

export interface CanonicalEntityLink {
  type: CanonicalEntityLinkType;
  targetId: string;
}

export const HEALTH_HISTORY_KINDS = new Set([
  "encounter",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
] as const);

const REGISTRY_LINK_TYPE_MAP = {
  parent_goal: "parent_of",
  related_goal: "related_to",
  related_experiment: "related_to",
  related_protocol: "related_to",
  related_condition: "related_to",
  related_variant: "related_to",
  related_to: "related_to",
  supports_goal: "supports_goal",
  addresses_condition: "addresses_condition",
  source_family_member: "source_family_member",
} as const satisfies Record<string, CanonicalEntityLinkType>;

export function normalizeCanonicalDate(
  value: string | null | undefined,
): string | null {
  return extractIsoDatePrefix(value);
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

export function linkTargetIds(
  links: readonly CanonicalEntityLink[],
): string[] {
  return uniqueStrings(links.map((link) => link.targetId));
}

export function normalizeCanonicalLinks(
  links: readonly (CanonicalEntityLink | null | undefined)[],
): CanonicalEntityLink[] {
  const normalized: CanonicalEntityLink[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    if (!link) {
      continue;
    }

    const targetId = link.targetId.trim();
    if (!targetId) {
      continue;
    }

    const dedupeKey = `${link.type}:${targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      type: link.type,
      targetId,
    });
  }

  return normalized;
}

export function relatedToLinks(
  targetIds: readonly string[],
): CanonicalEntityLink[] {
  return normalizeCanonicalLinks(
    targetIds.map((targetId) => ({
      type: "related_to" as const,
      targetId,
    })),
  );
}

function normalizeTags(value: unknown): string[] {
  return normalizeUniqueStringArray(value);
}

function buildArrayLinks(
  source: Record<string, unknown>,
  keys: readonly string[],
  type: CanonicalEntityLinkType,
): CanonicalEntityLink[] {
  return firstStringArray(source, keys).map((targetId) => ({
    type,
    targetId,
  }));
}

function buildScalarLinks(
  source: Record<string, unknown>,
  keys: readonly string[],
  type: CanonicalEntityLinkType,
): CanonicalEntityLink[] {
  const targetId = firstString(source, keys);
  return targetId ? [{ type, targetId }] : [];
}

function normalizeRegistryLinkType(
  link: HealthEntityRegistryLink,
): CanonicalEntityLinkType {
  return link.type in REGISTRY_LINK_TYPE_MAP
    ? REGISTRY_LINK_TYPE_MAP[
        link.type as keyof typeof REGISTRY_LINK_TYPE_MAP
      ]
    : "related_to";
}

function buildRegistryLinks(
  family: Extract<
    CanonicalEntityFamily,
    "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
  >,
  attributes: Record<string, unknown>,
): CanonicalEntityLink[] {
  const protocolSelfId =
    family === "protocol" ? firstString(attributes, ["protocolId"]) : null;

  return normalizeCanonicalLinks(
    extractHealthEntityRegistryLinks(family as HealthEntityKind, attributes)
      .filter((link) =>
        !(
          family === "protocol" &&
          protocolSelfId &&
          link.type === "related_protocol" &&
          link.targetId === protocolSelfId &&
          link.sourceKeys.length === 1 &&
          link.sourceKeys[0] === "protocolId"
        ))
      .map((link) => ({
        type: normalizeRegistryLinkType(link),
        targetId: link.targetId,
      })),
  );
}

function registryCompatibilitySelfIds(
  family: Extract<
    CanonicalEntityFamily,
    "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
  >,
  attributes: Record<string, unknown>,
): string[] {
  switch (family) {
    case "goal":
      return uniqueStrings([firstString(attributes, ["goalId"])]);
    case "condition":
      return uniqueStrings([firstString(attributes, ["conditionId"])]);
    case "protocol":
      return uniqueStrings([firstString(attributes, ["protocolId"])]);
    default:
      return [];
  }
}

export function extractProfileTopGoalIds(profile: unknown): string[] {
  const profileObject = asObject(profile);
  if (!profileObject) {
    return [];
  }

  const directTopGoalIds = firstStringArray(profileObject, ["topGoalIds"]);
  if (directTopGoalIds.length > 0) {
    return directTopGoalIds;
  }

  const nestedGoals = firstObject(profileObject, ["goals"]);
  return nestedGoals ? firstStringArray(nestedGoals, ["topGoalIds"]) : [];
}

export function extractProfileSummary(profile: unknown): string | null {
  const profileObject = asObject(profile);
  if (!profileObject) {
    return null;
  }

  const narrative = firstObject(profileObject, ["narrative"]);
  return narrative ? firstString(narrative, ["summary"]) : null;
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
  const links = relatedToLinks(firstStringArray(source, ["relatedIds"]));

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
    links,
    relatedIds: linkTargetIds(links),
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
  const profile = firstObject(source, ["profile"]) ?? {};
  const summary = extractProfileSummary(profile);
  const status = firstString(source, ["status"]) ?? "accepted";
  const links = normalizeCanonicalLinks([
    ...resolvedAssessmentIds.map((targetId) => ({
      type: "source_assessment" as const,
      targetId,
    })),
    ...sourceEventIds.map((targetId) => ({
      type: "source_event" as const,
      targetId,
    })),
  ]);

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
      profile,
      summary,
    },
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
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
  const topGoalIds = extractProfileTopGoalIds(profile);
  const links = buildCurrentProfileLinks({
    snapshotId: latestSnapshot.entityId,
    sourceAssessmentIds,
    sourceEventIds,
    topGoalIds,
  });

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
    links,
    relatedIds: linkTargetIds(links),
    stream: null,
    experimentSlug: null,
    tags: ["current_profile"],
  };
}

function buildCurrentProfileLinks({
  snapshotId,
  sourceAssessmentIds,
  sourceEventIds,
  topGoalIds,
}: {
  snapshotId: string;
  sourceAssessmentIds: readonly string[];
  sourceEventIds: readonly string[];
  topGoalIds: readonly string[];
}): CanonicalEntityLink[] {
  return normalizeCanonicalLinks([
    { type: "snapshot_of", targetId: snapshotId },
    ...sourceAssessmentIds.map((targetId) => ({
      type: "source_assessment" as const,
      targetId,
    })),
    ...sourceEventIds.map((targetId) => ({
      type: "source_event" as const,
      targetId,
    })),
    ...topGoalIds.map((targetId) => ({
      type: "top_goal" as const,
      targetId,
    })),
  ]);
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
  const links = normalizeCanonicalLinks([
    ...buildScalarLinks(attributes, ["snapshotId"], "snapshot_of"),
    ...sourceAssessmentIds.map((targetId) => ({
      type: "source_assessment" as const,
      targetId,
    })),
    ...sourceEventIds.map((targetId) => ({
      type: "source_event" as const,
      targetId,
    })),
    ...topGoalIds.map((targetId) => ({
      type: "top_goal" as const,
      targetId,
    })),
  ]);

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
    links,
    relatedIds: linkTargetIds(links),
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

  const links = normalizeCanonicalLinks(buildArrayLinks(source, ["relatedIds"], "related_to"));
  const tags = firstStringArray(source, ["tags"]);
  const status =
    kind === "test"
      ? firstString(source, ["resultStatus", "status"])
      : firstString(source, ["status", "severity"]);

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id]),
    family: "history",
    kind,
    status,
    occurredAt,
    date: firstString(source, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
    path: relativePath,
    title,
    body: firstString(source, ["note", "summary"]),
    attributes: source,
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
    stream: null,
    experimentSlug: null,
    tags,
  };
}

export function projectRegistryEntity(
  family: Extract<
    CanonicalEntityFamily,
    "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
  >,
  record: RegistryMarkdownRecord,
): CanonicalEntity {
  const attributes = record.document.attributes;
  const occurredAt =
    firstString(attributes, [
      "updatedAt",
      "recordedAt",
      "capturedAt",
      "assertedOn",
      "resolvedOn",
    ]) ?? null;
  const links = buildRegistryLinks(family, attributes);
  const relatedIds = uniqueStrings([
    ...linkTargetIds(links),
    ...registryCompatibilitySelfIds(family, attributes),
  ]);

  return {
    entityId: record.entity.id,
    primaryLookupId: record.entity.id,
    lookupIds: uniqueStrings([record.entity.id, record.entity.slug]),
    family,
    kind: firstString(attributes, ["docType", "kind"]) ?? family,
    status: record.entity.status,
    occurredAt,
    date: firstString(attributes, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
    path: record.document.relativePath,
    title: record.entity.title,
    body: record.document.body,
    attributes,
    frontmatter: attributes,
    links,
    relatedIds,
    stream: null,
    experimentSlug: firstString(attributes, ["experimentSlug"]),
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
