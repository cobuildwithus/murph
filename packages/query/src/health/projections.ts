import {
  type HealthHistoryEventKind,
} from "@murphai/contracts";
import {
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import {
  HEALTH_HISTORY_KINDS,
  projectHistoryEntity,
} from "./projectors/history.ts";
import { compareByOccurredAtDescThenId, compareByRecordedOrImportedAtDescThenId } from "./comparators.ts";
import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesStatus,
  matchesText,
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
