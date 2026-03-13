import {
  fallbackCurrentProfileEntity,
  projectAssessmentEntity,
  projectCurrentProfileEntity,
  projectHistoryEntity,
  projectProfileSnapshotEntity,
  projectRegistryEntity,
  type CanonicalEntity,
} from "./canonical-entities.js";
import {
  readJsonlRecordOutcomesSync,
  readMarkdownDocumentOutcomeSync,
  readOptionalMarkdownDocumentOutcomeSync,
  walkRelativeFilesSync,
  type JsonlRecordOutcome,
  type ParseFailure,
} from "./health/loaders.js";
import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  familyRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  regimenRegistryDefinition,
  sortRegistryRecords,
  toRegistryRecord,
  type RegistryDefinition,
  type RegistryMarkdownRecord,
} from "./health/registries.js";
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

interface TolerantCollection<TRecord> {
  records: TRecord[];
  failures: ParseFailure[];
}

interface ProjectedEntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

interface RegistryReadResult {
  goals: ExportPackBankPage[];
  conditions: ExportPackBankPage[];
  allergies: ExportPackBankPage[];
  regimens: ExportPackBankPage[];
  familyMembers: ExportPackBankPage[];
  geneticVariants: ExportPackBankPage[];
  failures: ParseFailure[];
}

export interface ExportPackHealthReadResult {
  health: ExportPackHealthContext;
  failures: ParseFailure[];
}

function collectProjectedEntities(
  outcomes: JsonlRecordOutcome[],
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): ProjectedEntityCollection {
  const failures: ParseFailure[] = [];
  const entities: CanonicalEntity[] = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = project(outcome.value, outcome.relativePath);
    if (entity) {
      entities.push(entity);
    }
  }

  return { entities, failures };
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

function compareAssessments(
  left: ExportPackAssessmentRecord,
  right: ExportPackAssessmentRecord,
): number {
  const leftTimestamp = left.recordedAt ?? left.importedAt ?? "";
  const rightTimestamp = right.recordedAt ?? right.importedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
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

function compareHistory(
  left: ExportPackHistoryRecord,
  right: ExportPackHistoryRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }

  return left.id.localeCompare(right.id);
}

function readAssessmentRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): TolerantCollection<ExportPackAssessmentRecord> {
  const collected = collectProjectedEntities(
    readJsonlRecordOutcomesSync(vaultRoot, "ledger/assessments"),
    projectAssessmentEntity,
  );

  return {
    records: collected.entities
      .map(assessmentRecordFromEntity)
      .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
      .sort(compareAssessments),
    failures: collected.failures,
  };
}

function readProfileSnapshotRecords(
  vaultRoot: string,
): { snapshots: CanonicalEntity[]; failures: ParseFailure[] } {
  const collected = collectProjectedEntities(
    readJsonlRecordOutcomesSync(vaultRoot, "ledger/profile-snapshots"),
    projectProfileSnapshotEntity,
  );

  return {
    snapshots: collected.entities.sort(compareLatestEntities),
    failures: collected.failures,
  };
}

function readHistoryRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): TolerantCollection<ExportPackHistoryRecord> {
  const collected = collectProjectedEntities(
    readJsonlRecordOutcomesSync(vaultRoot, "ledger/events"),
    projectHistoryEntity,
  );

  return {
    records: collected.entities
      .map(historyRecordFromEntity)
      .filter((entry): entry is ExportPackHistoryRecord => entry !== null)
      .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
      .sort(compareHistory),
    failures: collected.failures,
  };
}

function readCurrentProfileRecord(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
): { record: ExportPackCurrentProfile | null; failures: ParseFailure[] } {
  const latestSnapshot = profileSnapshots[0] ?? null;
  if (!latestSnapshot) {
    return { record: null, failures: [] };
  }

  const outcome = readOptionalMarkdownDocumentOutcomeSync(vaultRoot, "bank/profile/current.md");
  if (!outcome) {
    const fallback = fallbackCurrentProfileEntity(latestSnapshot);
    return {
      record: fallback ? currentProfileFromEntity(fallback, null) : null,
      failures: [],
    };
  }

  if (!outcome.ok) {
    const fallback = fallbackCurrentProfileEntity(latestSnapshot);
    return {
      record: fallback ? currentProfileFromEntity(fallback, null) : null,
      failures: [outcome],
    };
  }

  const currentProfile = projectCurrentProfileEntity(outcome.document);
  if (firstString(currentProfile.attributes, ["snapshotId"]) === latestSnapshot.entityId) {
    return {
      record: currentProfileFromEntity(currentProfile, outcome.document.markdown),
      failures: [],
    };
  }

  const fallback = fallbackCurrentProfileEntity(latestSnapshot);
  return {
    record: fallback ? currentProfileFromEntity(fallback, null) : null,
    failures: [],
  };
}

function readRegistryPages<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  family: Extract<
    CanonicalEntity["family"],
    "allergy" | "condition" | "family" | "genetics" | "goal" | "regimen"
  >,
): TolerantCollection<ExportPackBankPage> {
  const failures: ParseFailure[] = [];
  const records: TRecord[] = [];
  const relativePaths = walkRelativeFilesSync(vaultRoot, definition.directory, ".md");

  for (const relativePath of relativePaths) {
    const outcome = readMarkdownDocumentOutcomeSync(vaultRoot, relativePath);
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const record = toRegistryRecord(outcome.document, definition);
    if (record) {
      records.push(record);
    }
  }

  return {
    records: sortRegistryRecords(records, definition).map((record) =>
      bankPageFromEntity(projectRegistryEntity(family, record), record.markdown),
    ),
    failures,
  };
}

function readAllRegistryPages(vaultRoot: string): RegistryReadResult {
  const goalsRead = readRegistryPages(vaultRoot, goalRegistryDefinition, "goal");
  const conditionsRead = readRegistryPages(vaultRoot, conditionRegistryDefinition, "condition");
  const allergiesRead = readRegistryPages(vaultRoot, allergyRegistryDefinition, "allergy");
  const regimensRead = readRegistryPages(vaultRoot, regimenRegistryDefinition, "regimen");
  const familyRead = readRegistryPages(vaultRoot, familyRegistryDefinition, "family");
  const geneticsRead = readRegistryPages(vaultRoot, geneticsRegistryDefinition, "genetics");

  return {
    goals: goalsRead.records,
    conditions: conditionsRead.records,
    allergies: allergiesRead.records,
    regimens: regimensRead.records,
    familyMembers: familyRead.records,
    geneticVariants: geneticsRead.records,
    failures: [
      ...goalsRead.failures,
      ...conditionsRead.failures,
      ...allergiesRead.failures,
      ...regimensRead.failures,
      ...familyRead.failures,
      ...geneticsRead.failures,
    ],
  };
}

export function readHealthContext(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthReadResult {
  const assessmentRead = readAssessmentRecords(vaultRoot, filters);
  const profileSnapshotRead = readProfileSnapshotRecords(vaultRoot);
  const historyRead = readHistoryRecords(vaultRoot, filters);
  const currentProfileRead = readCurrentProfileRecord(vaultRoot, profileSnapshotRead.snapshots);
  const registryRead = readAllRegistryPages(vaultRoot);

  return {
    health: {
      assessments: assessmentRead.records,
      profileSnapshots: profileSnapshotRead.snapshots
        .map(profileSnapshotRecordFromEntity)
        .filter((entry): entry is ExportPackProfileSnapshotRecord => entry !== null)
        .filter((entry) => matchesDateWindow(entry.recordedAt, filters))
        .sort(compareSnapshots),
      historyEvents: historyRead.records,
      currentProfile: currentProfileRead.record,
      goals: registryRead.goals,
      conditions: registryRead.conditions,
      allergies: registryRead.allergies,
      regimens: registryRead.regimens,
      familyMembers: registryRead.familyMembers,
      geneticVariants: registryRead.geneticVariants,
    },
    failures: [
      ...assessmentRead.failures,
      ...profileSnapshotRead.failures,
      ...historyRead.failures,
      ...currentProfileRead.failures,
      ...registryRead.failures,
    ],
  };
}

export function readHealthContextTolerant(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  return readHealthContext(vaultRoot, filters).health;
}

function compareLatestEntities(left: CanonicalEntity, right: CanonicalEntity): number {
  const leftSortKey = left.occurredAt ?? left.date ?? "";
  const rightSortKey = right.occurredAt ?? right.date ?? "";

  if (leftSortKey !== rightSortKey) {
    return rightSortKey.localeCompare(leftSortKey);
  }

  return left.entityId.localeCompare(right.entityId);
}

function matchesDateWindow(
  value: string | null,
  filters: ExportPackFilters,
): boolean {
  if (!value) {
    return false;
  }

  const comparable = value.slice(0, 10);
  if (filters.from && comparable < filters.from) {
    return false;
  }

  if (filters.to && comparable > filters.to) {
    return false;
  }

  return true;
}
