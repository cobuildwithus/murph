import {
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeCanonicalLinks,
  normalizeUniqueStringArray,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityLink,
} from "../../canonical-entities.ts";
import {
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  maybeString,
  type MarkdownDocumentRecord,
} from "../shared.ts";

function normalizeTags(value: unknown): string[] {
  return normalizeUniqueStringArray(value);
}

export function extractProfileTopGoalIds(profile: unknown): string[] {
  const profileObject = asObject(profile);
  if (!profileObject) {
    return [];
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
    recordClass: resolveCanonicalRecordClass("profile_snapshot"),
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
  const sourceEventIds = normalizeUniqueStringArray(
    latestSnapshot.attributes.sourceEventIds,
  );
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
    recordClass: resolveCanonicalRecordClass("current_profile"),
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

function buildCurrentProfileLinks(input: {
  snapshotId: string;
  sourceAssessmentIds: readonly string[];
  sourceEventIds: readonly string[];
  topGoalIds: readonly string[];
}): CanonicalEntityLink[] {
  return normalizeCanonicalLinks([
    { type: "snapshot_of", targetId: input.snapshotId },
    ...input.sourceAssessmentIds.map((targetId) => ({
      type: "source_assessment" as const,
      targetId,
    })),
    ...input.sourceEventIds.map((targetId) => ({
      type: "source_event" as const,
      targetId,
    })),
    ...input.topGoalIds.map((targetId) => ({
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
    recordClass: resolveCanonicalRecordClass("current_profile"),
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

function buildScalarLinks(
  source: Record<string, unknown>,
  keys: readonly string[],
  type: CanonicalEntityLink["type"],
): CanonicalEntityLink[] {
  const targetId = firstString(source, keys);
  return targetId ? [{ type, targetId }] : [];
}
