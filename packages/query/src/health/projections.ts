import {
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import { compareByRecordedOrImportedAtDescThenId } from "./comparators.ts";
import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  matchesDateRange,
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
