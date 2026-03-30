import {
  type HealthHistoryEventKind,
} from "@murph/contracts";
import {
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import {
  HEALTH_HISTORY_KINDS,
  projectHistoryEntity,
} from "./projectors/history.ts";
import {
  extractProfileSummary,
  projectCurrentProfileEntity,
  projectProfileSnapshotEntity,
} from "./projectors/profile.ts";
import { compareByOccurredAtDescThenId, compareByRecordedOrImportedAtDescThenId } from "./comparators.ts";
import {
  compareCurrentProfileSnapshotRecency,
  type CurrentProfileSnapshotSortFields,
} from "./current-profile-resolution.ts";
import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesStatus,
  matchesText,
  type MarkdownDocumentRecord,
} from "./shared.ts";

export interface AssessmentQueryRecord {
  id: string;
  title: string | null;
  assessmentType: string | null;
  recordedAt: string | null;
  importedAt: string | null;
  source: string | null;
  sourcePath: string | null;
  questionnaireSlug: string | null;
  relatedIds: string[];
  responses: Record<string, unknown>;
  relativePath: string;
}

export interface AssessmentListOptions {
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

export type HealthHistoryKind = HealthHistoryEventKind;

export interface HistoryQueryRecord {
  id: string;
  kind: HealthHistoryKind;
  occurredAt: string;
  recordedAt: string | null;
  source: string | null;
  title: string;
  status: string | null;
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface HistoryListOptions {
  kind?: HealthHistoryKind | HealthHistoryKind[];
  status?: string | string[];
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

export interface ProfileSnapshotQueryRecord {
  id: string;
  capturedAt: string | null;
  recordedAt: string | null;
  status: string;
  summary: string | null;
  source: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface CurrentProfileQueryRecord {
  id: "current";
  snapshotId: string | null;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  relativePath: string;
  markdown: string | null;
  body: string | null;
}

export interface ProfileSnapshotListOptions {
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

export function assessmentRecordFromEntity(
  entity: CanonicalEntity,
): AssessmentQueryRecord | null {
  if (entity.family !== "assessment") {
    return null;
  }

  const attributes = asObject(entity.attributes);
  if (!attributes) {
    return null;
  }

  return {
    id: entity.entityId,
    title: entity.title,
    assessmentType: firstString(attributes, ["assessmentType"]),
    recordedAt: firstString(attributes, ["recordedAt", "occurredAt", "importedAt"]),
    importedAt: firstString(attributes, ["importedAt"]),
    source: firstString(attributes, ["source"]),
    sourcePath: firstString(attributes, ["rawPath", "sourcePath"]),
    questionnaireSlug: firstString(attributes, ["questionnaireSlug"]),
    relatedIds: entity.relatedIds,
    responses: firstObject(attributes, ["responses", "response"]) ?? {},
    relativePath: entity.path,
  };
}

export function toAssessmentRecord(
  value: unknown,
  relativePath: string,
): AssessmentQueryRecord | null {
  const entity = projectAssessmentEntity(value, relativePath);
  return entity ? assessmentRecordFromEntity(entity) : null;
}

export function compareAssessments(
  left: AssessmentQueryRecord,
  right: AssessmentQueryRecord,
): number {
  return compareByRecordedOrImportedAtDescThenId(left, right);
}

export function selectAssessmentRecords(
  entities: readonly CanonicalEntity[],
  options: AssessmentListOptions = {},
): AssessmentQueryRecord[] {
  const records = entities
    .map(assessmentRecordFromEntity)
    .filter((record): record is AssessmentQueryRecord => record !== null)
    .filter((record) =>
      matchesDateRange(record.recordedAt ?? record.importedAt, options.from, options.to),
    )
    .filter((record) => matchesText([record], options.text))
    .sort(compareAssessments);

  return applyLimit(records, options.limit);
}

export function historyRecordFromEntity(
  entity: CanonicalEntity,
): HistoryQueryRecord | null {
  if (entity.family !== "history") {
    return null;
  }

  const data = asObject(entity.attributes);
  if (
    !data ||
    !HEALTH_HISTORY_KINDS.has(entity.kind as HealthHistoryKind) ||
    !entity.occurredAt ||
    !entity.title
  ) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: entity.kind as HealthHistoryKind,
    occurredAt: entity.occurredAt,
    recordedAt: firstString(data, ["recordedAt"]),
    source: firstString(data, ["source"]),
    title: entity.title,
    status: entity.status,
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data,
  };
}

export function toHistoryRecord(
  value: unknown,
  relativePath: string,
): HistoryQueryRecord | null {
  const entity = projectHistoryEntity(value, relativePath);
  return entity ? historyRecordFromEntity(entity) : null;
}

export function compareHistory(left: HistoryQueryRecord, right: HistoryQueryRecord): number {
  return compareByOccurredAtDescThenId(left, right);
}

export function selectHistoryRecords(
  entities: readonly CanonicalEntity[],
  options: HistoryListOptions = {},
): HistoryQueryRecord[] {
  const kindFilters = Array.isArray(options.kind)
    ? new Set(options.kind)
    : options.kind
      ? new Set([options.kind])
      : null;
  const records = entities
    .map(historyRecordFromEntity)
    .filter((record): record is HistoryQueryRecord => record !== null)
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .filter((record) => matchesHistoryOptions(record, options, kindFilters))
    .sort(compareHistory);

  return applyLimit(records, options.limit);
}

export function profileSnapshotRecordFromEntity(
  entity: CanonicalEntity,
): ProfileSnapshotQueryRecord | null {
  if (entity.family !== "profile_snapshot") {
    return null;
  }

  const attributes = asObject(entity.attributes);
  if (!attributes) {
    return null;
  }

  return {
    id: entity.entityId,
    capturedAt: firstString(attributes, ["capturedAt", "recordedAt"]),
    recordedAt: firstString(attributes, ["recordedAt", "capturedAt"]),
    status: firstString(attributes, ["status"]) ?? "accepted",
    summary:
      firstString(attributes, ["summary"]) ??
      extractProfileSummary(firstObject(attributes, ["profile"])),
    source: firstString(attributes, ["source"]),
    sourceAssessmentIds: firstStringArray(attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(attributes, ["sourceEventIds"]),
    profile: firstObject(attributes, ["profile"]) ?? {},
    relativePath: entity.path,
  };
}

export function currentProfileRecordFromEntity(
  entity: CanonicalEntity,
  rawDocumentMarkdown: string | null = entity.body,
): CurrentProfileQueryRecord | null {
  if (entity.family !== "current_profile") {
    return null;
  }

  const attributes = asObject(entity.attributes);
  if (!attributes) {
    return null;
  }

  return {
    id: "current",
    snapshotId: firstString(attributes, ["snapshotId"]),
    updatedAt: firstString(attributes, ["updatedAt"]),
    sourceAssessmentIds: firstStringArray(attributes, ["sourceAssessmentIds"]),
    sourceEventIds: firstStringArray(attributes, ["sourceEventIds"]),
    topGoalIds: firstStringArray(attributes, ["topGoalIds"]),
    relativePath: entity.path,
    markdown: rawDocumentMarkdown,
    body: entity.body,
  };
}

export function resolveCurrentProfileRecord(
  entity: CanonicalEntity | null,
  markdownByPath: ReadonlyMap<string, string>,
): CurrentProfileQueryRecord | null {
  return entity
    ? currentProfileRecordFromEntity(
        entity,
        markdownByPath.get(entity.path) ?? entity.body,
      )
    : null;
}

export function buildCurrentProfileRecord(input: {
  snapshotId: string;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  markdown: string | null;
  body: string | null;
}): CurrentProfileQueryRecord {
  return {
    id: "current",
    snapshotId: input.snapshotId,
    updatedAt: input.updatedAt,
    sourceAssessmentIds: input.sourceAssessmentIds,
    sourceEventIds: input.sourceEventIds,
    topGoalIds: input.topGoalIds,
    relativePath: "bank/profile/current.md",
    markdown: input.markdown,
    body: input.body,
  };
}

export function toProfileSnapshotRecord(
  value: unknown,
  relativePath: string,
): ProfileSnapshotQueryRecord | null {
  const entity = projectProfileSnapshotEntity(value, relativePath);
  return entity ? profileSnapshotRecordFromEntity(entity) : null;
}

export function compareSnapshots(
  left: ProfileSnapshotQueryRecord,
  right: ProfileSnapshotQueryRecord,
): number {
  return compareCurrentProfileSnapshotRecency(
    profileSnapshotSortFields(left),
    profileSnapshotSortFields(right),
  );
}

export function toCurrentProfileRecord(
  document: MarkdownDocumentRecord,
): CurrentProfileQueryRecord {
  const projectedCurrentProfile = projectCurrentProfileEntity(document);
  const record = currentProfileRecordFromEntity(projectedCurrentProfile, document.markdown);

  if (!record) {
    throw new Error("Failed to project current profile.");
  }

  return record;
}

export function selectProfileSnapshotRecords(
  entities: readonly CanonicalEntity[],
  options: ProfileSnapshotListOptions = {},
): ProfileSnapshotQueryRecord[] {
  const records = entities
    .map(profileSnapshotRecordFromEntity)
    .filter((record): record is ProfileSnapshotQueryRecord => record !== null)
    .filter((record) =>
      matchesDateRange(record.recordedAt ?? record.capturedAt, options.from, options.to),
    )
    .filter((record) => matchesText([record], options.text))
    .sort(compareSnapshots);

  return applyLimit(records, options.limit);
}

function matchesHistoryOptions(
  record: HistoryQueryRecord,
  options: HistoryListOptions,
  kindFilters: ReadonlySet<HealthHistoryKind> | null,
): boolean {
  return (
    matchesKindFilter(record, kindFilters) &&
    matchesStatus(record.status, options.status) &&
    matchesText(
      [
        record.id,
        record.title,
        record.kind,
        record.source,
        record.tags,
        record.relatedIds,
        record.data,
      ],
      options.text,
    )
  );
}

function matchesKindFilter(
  record: HistoryQueryRecord,
  kindFilters: ReadonlySet<HealthHistoryKind> | null,
): boolean {
  return !kindFilters || kindFilters.has(record.kind);
}

function profileSnapshotSortFields(
  snapshot: ProfileSnapshotQueryRecord,
): CurrentProfileSnapshotSortFields {
  return {
    snapshotId: snapshot.id,
    snapshotTimestamp: snapshot.recordedAt ?? snapshot.capturedAt,
  };
}
