import {
  compareAssessments,
  toAssessmentRecord,
} from "./health/assessments.js";
import {
  compareHistory,
  toHistoryRecord,
} from "./health/history.js";
import {
  readJsonlRecordOutcomesSync,
  readOptionalMarkdownDocumentOutcomeSync,
  readMarkdownDocumentOutcomeSync,
  walkRelativeFilesSync,
  type ParseFailure,
  type JsonlRecordOutcome,
} from "./health/loaders.js";
import {
  buildCurrentProfileRecord,
  compareSnapshots,
  toCurrentProfileRecord,
  toProfileSnapshotRecord,
} from "./health/profile-snapshots.js";
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
import { firstStringArray } from "./health/shared.js";

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

function collectJsonlRecords<TRecord>(
  outcomes: JsonlRecordOutcome[],
  transform: (value: unknown, relativePath: string) => TRecord | null,
): TolerantCollection<TRecord> {
  const failures: ParseFailure[] = [];
  const records: TRecord[] = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const record = transform(outcome.value, outcome.relativePath);
    if (record) {
      records.push(record);
    }
  }

  return { records, failures };
}

function finalizeCollection<TSource, TRecord>(
  collection: TolerantCollection<TSource>,
  options: {
    filter?: (record: TSource) => boolean;
    compare?: (left: TSource, right: TSource) => number;
    map: (record: TSource) => TRecord;
  },
): TolerantCollection<TRecord> {
  let records = collection.records;

  if (options.filter) {
    records = records.filter(options.filter);
  }

  if (options.compare) {
    records = records.sort(options.compare);
  }

  return {
    records: records.map(options.map),
    failures: collection.failures,
  };
}

function toBankPage(record: RegistryMarkdownRecord): ExportPackBankPage {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    status: record.status,
    relativePath: record.relativePath,
    markdown: record.markdown,
    body: record.body,
    attributes: record.attributes,
  };
}

function toExportPackAssessmentRecord(
  record: NonNullable<ReturnType<typeof toAssessmentRecord>>,
): ExportPackAssessmentRecord {
  return {
    id: record.id,
    title: record.title,
    assessmentType: record.assessmentType,
    recordedAt: record.recordedAt,
    importedAt: record.importedAt,
    source: record.source,
    sourcePath: record.sourcePath,
    questionnaireSlug: record.questionnaireSlug,
    relatedIds: record.relatedIds,
    responses: record.responses,
    relativePath: record.relativePath,
  };
}

function toExportPackProfileSnapshotRecord(
  record: NonNullable<ReturnType<typeof toProfileSnapshotRecord>>,
): ExportPackProfileSnapshotRecord {
  return {
    id: record.id,
    recordedAt: record.recordedAt,
    source: record.source,
    sourceAssessmentIds: record.sourceAssessmentIds,
    sourceEventIds: record.sourceEventIds,
    profile: record.profile,
    relativePath: record.relativePath,
  };
}

function toExportPackHistoryRecord(
  record: NonNullable<ReturnType<typeof toHistoryRecord>>,
): ExportPackHistoryRecord {
  return {
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    source: record.source,
    title: record.title,
    status: record.status,
    tags: record.tags,
    relatedIds: record.relatedIds,
    relativePath: record.relativePath,
    data: record.data,
  };
}

function toExportPackCurrentProfile(
  record: {
    snapshotId: string | null;
    updatedAt: string | null;
    sourceAssessmentIds: string[];
    sourceEventIds: string[];
    topGoalIds: string[];
    relativePath: string;
    markdown: string | null;
    body: string | null;
  },
): ExportPackCurrentProfile {
  return {
    snapshotId: record.snapshotId,
    updatedAt: record.updatedAt,
    sourceAssessmentIds: record.sourceAssessmentIds,
    sourceEventIds: record.sourceEventIds,
    topGoalIds: record.topGoalIds,
    relativePath: record.relativePath,
    markdown: record.markdown,
    body: record.body,
  };
}

function readAssessmentRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): TolerantCollection<ExportPackAssessmentRecord> {
  return finalizeCollection(
    collectJsonlRecords(
      readJsonlRecordOutcomesSync(vaultRoot, "ledger/assessments"),
      toAssessmentRecord,
    ),
    {
      filter: (entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters),
      compare: compareAssessments,
      map: toExportPackAssessmentRecord,
    },
  );
}

function readProfileSnapshotRecords(
  vaultRoot: string,
): TolerantCollection<ExportPackProfileSnapshotRecord> {
  return finalizeCollection(
    collectJsonlRecords(
      readJsonlRecordOutcomesSync(vaultRoot, "ledger/profile-snapshots"),
      toProfileSnapshotRecord,
    ),
    {
      compare: compareSnapshots,
      map: toExportPackProfileSnapshotRecord,
    },
  );
}

function readHistoryRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): TolerantCollection<ExportPackHistoryRecord> {
  return finalizeCollection(
    collectJsonlRecords(
      readJsonlRecordOutcomesSync(vaultRoot, "ledger/events"),
      toHistoryRecord,
    ),
    {
      filter: (entry) => matchesDateWindow(entry.occurredAt, filters),
      compare: compareHistory,
      map: toExportPackHistoryRecord,
    },
  );
}

function fallbackCurrentProfile(
  latestSnapshot: ExportPackProfileSnapshotRecord,
): ExportPackCurrentProfile {
  return toExportPackCurrentProfile(
    buildCurrentProfileRecord({
      snapshotId: latestSnapshot.id,
      updatedAt: latestSnapshot.recordedAt,
      sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
      sourceEventIds: latestSnapshot.sourceEventIds,
      topGoalIds: firstStringArray(latestSnapshot.profile, ["topGoalIds"]),
      markdown: null,
      body: null,
    }),
  );
}

function readCurrentProfileRecord(
  vaultRoot: string,
  profileSnapshots: ExportPackProfileSnapshotRecord[],
): { record: ExportPackCurrentProfile | null; failures: ParseFailure[] } {
  const latestSnapshot = profileSnapshots[0] ?? null;
  if (!latestSnapshot) {
    return { record: null, failures: [] };
  }

  const outcome = readOptionalMarkdownDocumentOutcomeSync(vaultRoot, "bank/profile/current.md");
  if (!outcome) {
    return {
      record: fallbackCurrentProfile(latestSnapshot),
      failures: [],
    };
  }

  if (!outcome.ok) {
    return {
      record: fallbackCurrentProfile(latestSnapshot),
      failures: [outcome],
    };
  }

  const record = toCurrentProfileRecord(outcome.document);
  if (record.snapshotId === latestSnapshot.id) {
    return {
      record: toExportPackCurrentProfile(record),
      failures: [],
    };
  }

  return {
    record: fallbackCurrentProfile(latestSnapshot),
    failures: [],
  };
}

function readRegistryPages<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
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
    records: sortRegistryRecords(records, definition).map(toBankPage),
    failures,
  };
}

function readAllRegistryPages(vaultRoot: string): RegistryReadResult {
  const goalsRead = readRegistryPages(vaultRoot, goalRegistryDefinition);
  const conditionsRead = readRegistryPages(vaultRoot, conditionRegistryDefinition);
  const allergiesRead = readRegistryPages(vaultRoot, allergyRegistryDefinition);
  const regimensRead = readRegistryPages(vaultRoot, regimenRegistryDefinition);
  const familyRead = readRegistryPages(vaultRoot, familyRegistryDefinition);
  const geneticsRead = readRegistryPages(vaultRoot, geneticsRegistryDefinition);

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
  const allProfileSnapshotRead = readProfileSnapshotRecords(vaultRoot);
  const historyRead = readHistoryRecords(vaultRoot, filters);
  const currentProfileRead = readCurrentProfileRecord(vaultRoot, allProfileSnapshotRead.records);
  const registryRead = readAllRegistryPages(vaultRoot);

  return {
    health: {
      assessments: assessmentRead.records,
      profileSnapshots: allProfileSnapshotRead.records.filter((entry) =>
        matchesDateWindow(entry.recordedAt, filters),
      ),
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
      ...allProfileSnapshotRead.failures,
      ...historyRead.failures,
      ...currentProfileRead.failures,
      ...registryRead.failures,
    ],
  };
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
