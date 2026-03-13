import {
  applyLimit,
  asObject,
  firstObject,
  firstString,
  matchesDateRange,
  matchesLookup,
  matchesText,
} from "./shared.js";
import { readJsonlRecords } from "./loaders.js";
import { projectAssessmentEntity } from "../canonical-entities.js";

import type { CanonicalEntity } from "../canonical-entities.js";

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

function assessmentRecordFromEntity(
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
  const leftTimestamp = left.recordedAt ?? left.importedAt ?? "";
  const rightTimestamp = right.recordedAt ?? right.importedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
}

function isAssessmentRecord(
  record: AssessmentQueryRecord | null,
): record is AssessmentQueryRecord {
  return record !== null;
}

export async function listAssessments(
  vaultRoot: string,
  options: AssessmentListOptions = {},
): Promise<AssessmentQueryRecord[]> {
  const entries = await readJsonlRecords(vaultRoot, "ledger/assessments");
  const records = entries
    .map((entry) => projectAssessmentEntity(entry.value, entry.relativePath))
    .map((entity) => (entity ? assessmentRecordFromEntity(entity) : null))
    .filter(isAssessmentRecord)
    .filter((record) => matchesDateRange(record.recordedAt ?? record.importedAt, options.from, options.to))
    .filter((record) => matchesText([record], options.text))
    .sort(compareAssessments);

  return applyLimit(records, options.limit);
}

export async function readAssessment(
  vaultRoot: string,
  assessmentId: string,
): Promise<AssessmentQueryRecord | null> {
  const records = await listAssessments(vaultRoot);
  return records.find((record) => record.id === assessmentId) ?? null;
}

export async function showAssessment(
  vaultRoot: string,
  lookup: string,
): Promise<AssessmentQueryRecord | null> {
  const records = await listAssessments(vaultRoot);
  return records.find((record) => matchesLookup(lookup, record.id, record.title)) ?? null;
}
