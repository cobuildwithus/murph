import { extractIsoDatePrefix } from "@healthybob/contracts";

import {
  type CanonicalEntity,
} from "./canonical-entities.js";
import type { ParseFailure } from "./health/loaders.js";
import { collectCanonicalEntities } from "./health/canonical-collector.js";
import {
  compareByOccurredAtDescThenId,
  compareByRecordedOrImportedAtDescThenId,
} from "./health/comparators.js";
import { firstObject, firstString, firstStringArray } from "./health/shared.js";

import type { FrontmatterObject } from "./health/shared.js";
import type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackCurrentProfile,
  ExportPackFilters,
  ExportPackHealthContext,
  ExportPackHistoryRecord,
  ExportPackProfileSnapshotRecord,
} from "./export-pack.js";

export interface ExportPackHealthReadResult {
  health: ExportPackHealthContext;
  failures: ParseFailure[];
}

function assessmentRecordFromEntity(
  entity: CanonicalEntity,
): ExportPackAssessmentRecord | null {
  if (entity.family !== "assessment") {
    return null;
  }

  return {
    id: entity.entityId,
    title: entity.title,
    assessmentType: firstString(entity.attributes, ["assessmentType"]),
    recordedAt: firstString(entity.attributes, ["recordedAt", "occurredAt", "importedAt"]),
    importedAt: firstString(entity.attributes, ["importedAt"]),
    source: firstString(entity.attributes, ["source"]),
    sourcePath: firstString(entity.attributes, ["rawPath", "sourcePath"]),
    questionnaireSlug: firstString(entity.attributes, ["questionnaireSlug"]),
    relatedIds: entity.relatedIds,
    responses: firstObject(entity.attributes, ["responses", "response"]) ?? {},
    relativePath: entity.path,
  };
}

function profileSnapshotRecordFromEntity(
  entity: CanonicalEntity,
): ExportPackProfileSnapshotRecord | null {
  if (entity.family !== "profile_snapshot") {
    return null;
  }

  return {
    id: entity.entityId,
    recordedAt: firstString(entity.attributes, ["recordedAt", "capturedAt"]),
    source: firstString(entity.attributes, ["source"]),
    sourceAssessmentIds: firstStringArray(entity.attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(entity.attributes, ["sourceEventIds"]),
    profile: firstObject(entity.attributes, ["profile"]) ?? {},
    relativePath: entity.path,
  };
}

function historyRecordFromEntity(
  entity: CanonicalEntity,
): ExportPackHistoryRecord | null {
  if (entity.family !== "history" || !entity.occurredAt || !entity.title) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: entity.kind,
    occurredAt: entity.occurredAt,
    recordedAt: firstString(entity.attributes, ["recordedAt"]),
    source: firstString(entity.attributes, ["source"]),
    title: entity.title,
    status: entity.status,
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data: entity.attributes,
  };
}

function currentProfileFromEntity(
  entity: CanonicalEntity,
  markdown: string | null,
): ExportPackCurrentProfile | null {
  if (entity.family !== "current_profile") {
    return null;
  }

  return {
    snapshotId: firstString(entity.attributes, ["snapshotId"]),
    updatedAt: firstString(entity.attributes, ["updatedAt"]),
    sourceAssessmentIds: firstStringArray(entity.attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(entity.attributes, ["sourceEventIds"]),
    topGoalIds: firstStringArray(entity.attributes, ["topGoalIds"]),
    relativePath: entity.path,
    markdown,
    body: entity.body,
  };
}

function bankPageFromEntity(
  entity: CanonicalEntity,
  markdown: string,
): ExportPackBankPage {
  return {
    id: entity.entityId,
    slug: entity.lookupIds.find((lookupId) => lookupId !== entity.entityId) ?? entity.entityId,
    title: entity.title,
    status: entity.status,
    relativePath: entity.path,
    markdown,
    body: entity.body ?? "",
    attributes: entity.attributes as FrontmatterObject,
  };
}

function mapBankPages(
  entities: CanonicalEntity[],
  markdownByPath: ReadonlyMap<string, string>,
): ExportPackBankPage[] {
  return entities.map((entity) =>
    bankPageFromEntity(entity, markdownByPath.get(entity.path) ?? ""),
  );
}

function compareSnapshots(
  left: ExportPackProfileSnapshotRecord,
  right: ExportPackProfileSnapshotRecord,
): number {
  const leftTimestamp = left.recordedAt ?? "";
  const rightTimestamp = right.recordedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
}

export function readHealthContext(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthReadResult {
  const collected = collectCanonicalEntities(vaultRoot, { mode: "tolerant-sync" });

  return {
    health: {
      assessments: collected.assessments
        .map(assessmentRecordFromEntity)
        .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
        .sort(compareByRecordedOrImportedAtDescThenId),
      profileSnapshots: collected.profileSnapshots
        .map(profileSnapshotRecordFromEntity)
        .filter((entry): entry is ExportPackProfileSnapshotRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.recordedAt, filters))
        .sort(compareSnapshots),
      historyEvents: collected.history
        .map(historyRecordFromEntity)
        .filter((entry): entry is ExportPackHistoryRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
        .sort(compareByOccurredAtDescThenId),
      currentProfile: collected.currentProfile
        ? currentProfileFromEntity(
            collected.currentProfile,
            collected.markdownByPath.get(collected.currentProfile.path) ?? null,
          )
        : null,
      goals: mapBankPages(collected.goals, collected.markdownByPath),
      conditions: mapBankPages(collected.conditions, collected.markdownByPath),
      allergies: mapBankPages(collected.allergies, collected.markdownByPath),
      protocols: mapBankPages(collected.protocols, collected.markdownByPath),
      familyMembers: mapBankPages(collected.familyMembers, collected.markdownByPath),
      geneticVariants: mapBankPages(collected.geneticVariants, collected.markdownByPath),
    },
    failures: collected.failures,
  };
}

export function readHealthContextTolerant(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  return readHealthContext(vaultRoot, filters).health;
}

function matchesDateWindow(
  value: string | null,
  filters: ExportPackFilters,
): boolean {
  if (!value) {
    return false;
  }

  const comparable = extractIsoDatePrefix(value);
  if (!comparable) {
    return false;
  }
  if (filters.from && comparable < filters.from) {
    return false;
  }

  if (filters.to && comparable > filters.to) {
    return false;
  }

  return true;
}
