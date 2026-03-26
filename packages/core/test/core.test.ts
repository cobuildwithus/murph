import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type {
  AuditRecord,
  DocumentEventRecord,
  ExperimentEventRecord,
  MealEventRecord,
  SampleRecord,
} from "@healthybob/contracts";
import {
  AUDIT_ACTORS as CONTRACT_AUDIT_ACTORS,
  AUDIT_STATUSES as CONTRACT_AUDIT_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  EVENT_KINDS as CONTRACT_EVENT_KINDS,
  EVENT_SOURCES as CONTRACT_EVENT_SOURCES,
  EXPERIMENT_STATUSES as CONTRACT_EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS as CONTRACT_FILE_CHANGE_OPERATIONS,
  ID_PREFIXES as CONTRACT_ID_PREFIXES,
  SAMPLE_QUALITIES as CONTRACT_SAMPLE_QUALITIES,
  SAMPLE_SOURCES as CONTRACT_SAMPLE_SOURCES,
  SAMPLE_STREAMS as CONTRACT_SAMPLE_STREAMS,
} from "@healthybob/contracts";

import {
  addMeal,
  applyCanonicalWriteBatch,
  appendJournal,
  appendProfileSnapshot,
  appendJsonlRecord,
  checkpointExperiment,
  copyRawArtifact,
  createExperiment,
  ensureJournalDay,
  importDocument,
  importAssessmentResponse,
  importSamples,
  initializeVault,
  linkJournalEventIds,
  linkJournalStreams,
  loadVault,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  parseFrontmatterDocument,
  projectAssessmentResponse,
  readJsonlRecords,
  repairVault,
  stopExperiment,
  stringifyFrontmatterDocument,
  toMonthlyShardRelativePath,
  unlinkJournalEventIds,
  unlinkJournalStreams,
  updateExperiment,
  updateVaultSummary,
  upsertEvent,
  upsertProvider,
  validateVault,
  VaultError,
} from "../src/index.js";
import {
  appendVaultTextFile,
  copyImmutableFileIntoVaultRaw,
  writeImmutableJsonFileIntoVaultRaw,
  writeVaultTextFile,
} from "../src/fs.js";
import {
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  WriteBatch,
  WRITE_OPERATION_SCHEMA_VERSION,
} from "../src/operations/index.js";
import {
  ASSESSMENT_RESPONSE_SCHEMA_VERSION as CORE_ASSESSMENT_RESPONSE_SCHEMA_VERSION,
  AUDIT_ACTORS as CORE_AUDIT_ACTORS,
  AUDIT_SCHEMA_VERSION as CORE_AUDIT_SCHEMA_VERSION,
  AUDIT_STATUSES as CORE_AUDIT_STATUSES,
  BASELINE_EVENT_KINDS as CORE_BASELINE_EVENT_KINDS,
  BASELINE_SAMPLE_STREAMS as CORE_BASELINE_SAMPLE_STREAMS,
  EVENT_SCHEMA_VERSION as CORE_EVENT_SCHEMA_VERSION,
  EVENT_SOURCES as CORE_EVENT_SOURCES,
  EXPERIMENT_STATUSES as CORE_EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS as CORE_FILE_CHANGE_OPERATIONS,
  FRONTMATTER_SCHEMA_VERSIONS as CORE_FRONTMATTER_SCHEMA_VERSIONS,
  ID_PREFIXES as CORE_ID_PREFIXES,
  PROFILE_SNAPSHOT_SCHEMA_VERSION as CORE_PROFILE_SNAPSHOT_SCHEMA_VERSION,
  SAMPLE_QUALITIES as CORE_SAMPLE_QUALITIES,
  SAMPLE_SCHEMA_VERSION as CORE_SAMPLE_SCHEMA_VERSION,
  SAMPLE_SOURCES as CORE_SAMPLE_SOURCES,
  VAULT_SCHEMA_VERSION as CORE_VAULT_SCHEMA_VERSION,
} from "../src/constants.js";

function expectRecord<T>(value: unknown): T {
  return value as T;
}

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

test("core constants stay aligned with canonical contracts constants", () => {
  assert.equal(CORE_VAULT_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.vault);
  assert.deepEqual(CORE_FRONTMATTER_SCHEMA_VERSIONS, {
    allergy: CONTRACT_SCHEMA_VERSION.allergyFrontmatter,
    condition: CONTRACT_SCHEMA_VERSION.conditionFrontmatter,
    core: CONTRACT_SCHEMA_VERSION.coreFrontmatter,
    experiment: CONTRACT_SCHEMA_VERSION.experimentFrontmatter,
    familyMember: CONTRACT_SCHEMA_VERSION.familyMemberFrontmatter,
    food: CONTRACT_SCHEMA_VERSION.foodFrontmatter,
    geneticVariant: CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter,
    goal: CONTRACT_SCHEMA_VERSION.goalFrontmatter,
    journalDay: CONTRACT_SCHEMA_VERSION.journalDayFrontmatter,
    profileCurrent: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
    recipe: CONTRACT_SCHEMA_VERSION.recipeFrontmatter,
    protocol: CONTRACT_SCHEMA_VERSION.protocolFrontmatter,
  });
  assert.equal(Object.isFrozen(CORE_FRONTMATTER_SCHEMA_VERSIONS), true);
  assert.equal(CORE_ASSESSMENT_RESPONSE_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.assessmentResponse);
  assert.equal(CORE_EVENT_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.event);
  assert.equal(CORE_PROFILE_SNAPSHOT_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.profileSnapshot);
  assert.equal(CORE_SAMPLE_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.sample);
  assert.equal(CORE_AUDIT_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.audit);
  assert.equal(CORE_ID_PREFIXES, CONTRACT_ID_PREFIXES);
  assert.equal(CORE_BASELINE_EVENT_KINDS, CONTRACT_EVENT_KINDS);
  assert.equal(CORE_EVENT_SOURCES, CONTRACT_EVENT_SOURCES);
  assert.equal(CORE_BASELINE_SAMPLE_STREAMS, CONTRACT_SAMPLE_STREAMS);
  assert.equal(CORE_SAMPLE_SOURCES, CONTRACT_SAMPLE_SOURCES);
  assert.equal(CORE_SAMPLE_QUALITIES, CONTRACT_SAMPLE_QUALITIES);
  assert.equal(CORE_EXPERIMENT_STATUSES, CONTRACT_EXPERIMENT_STATUSES);
  assert.equal(CORE_AUDIT_ACTORS, CONTRACT_AUDIT_ACTORS);
  assert.equal(CORE_AUDIT_STATUSES, CONTRACT_AUDIT_STATUSES);
  assert.equal(CORE_FILE_CHANGE_OPERATIONS, CONTRACT_FILE_CHANGE_OPERATIONS);
});

test("initializeVault bootstraps the baseline contract layout and passes validation", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const initialized = await initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
  });

  assert.equal(initialized.metadata.schemaVersion, "hb.vault.v1");
  assert.match(initialized.metadata.vaultId, /^vault_[0-9A-HJKMNP-TV-Z]{26}$/);

  const coreContent = await fs.readFile(path.join(vaultRoot, "CORE.md"), "utf8");
  const coreDocument = parseFrontmatterDocument(coreContent);
  assert.equal(coreDocument.attributes.docType, "core");
  assert.equal(coreDocument.attributes.schemaVersion, "hb.frontmatter.core.v1");

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: initialized.auditPath,
  });
  const auditRecord = expectRecord<AuditRecord>(auditRecords[0]);
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const operation = await readStoredWriteOperation(vaultRoot, operationPaths[0] as string);

  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecord.action, "vault_init");
  assert.equal(operationPaths.length, 1);
  assert.equal(operation.operationType, "vault_init");
  assert.equal(operation.status, "committed");
  assert.deepEqual(
    auditRecord.changes.map((change: AuditRecord["changes"][number]) => change.path),
    ["CORE.md", "vault.json"],
  );
});

test("initializeVault rejects roots that already contain a vault", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      initializeVault({
        vaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_ALREADY_EXISTS",
  );
});

test("initializeVault rejects invalid generated metadata before writing canonical files", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");

  await assert.rejects(
    () =>
      initializeVault({
        vaultRoot,
        title: "",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_METADATA",
  );

  await assert.rejects(() => fs.access(path.join(vaultRoot, "vault.json")));
  await assert.rejects(() => fs.access(path.join(vaultRoot, "CORE.md")));
});

test("loadVault backfills additive metadata defaults in memory and repairVault persists them", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const metadataPath = path.join(vaultRoot, "vault.json");
  const staleMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
    idPolicy: {
      prefixes: Record<string, string>;
    };
    paths: Record<string, string>;
  };
  delete staleMetadata.idPolicy.prefixes.recipe;
  delete staleMetadata.idPolicy.prefixes.food;
  delete staleMetadata.paths.recipesRoot;
  delete staleMetadata.paths.foodsRoot;
  await fs.writeFile(metadataPath, `${JSON.stringify(staleMetadata, null, 2)}\n`, "utf8");
  await fs.rm(path.join(vaultRoot, "bank/recipes"), { recursive: true, force: true });
  await fs.rm(path.join(vaultRoot, "bank/foods"), { recursive: true, force: true });

  const loaded = await loadVault({ vaultRoot });

  assert.equal(loaded.metadata.idPolicy.prefixes.recipe, "rcp");
  assert.equal(loaded.metadata.idPolicy.prefixes.food, "food");
  assert.equal(loaded.metadata.paths.recipesRoot, "bank/recipes");
  assert.equal(loaded.metadata.paths.foodsRoot, "bank/foods");
  assert.deepEqual(loaded.compatibilityRepairs.sort(), [
    "idPolicy.prefixes.food",
    "idPolicy.prefixes.recipe",
    "paths.foodsRoot",
    "paths.recipesRoot",
  ]);

  const validationBeforeRepair = await validateVault({ vaultRoot });
  assert.equal(validationBeforeRepair.valid, false);
  assert.deepEqual(
    validationBeforeRepair.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.code)
      .sort(),
    [
      "VAULT_METADATA_REPAIR_RECOMMENDED",
      "VAULT_METADATA_REPAIR_RECOMMENDED",
      "VAULT_METADATA_REPAIR_RECOMMENDED",
      "VAULT_METADATA_REPAIR_RECOMMENDED",
    ],
  );
  assert.equal(
    validationBeforeRepair.issues.some((issue) => issue.path === "bank/recipes"),
    true,
  );
  assert.equal(
    validationBeforeRepair.issues.some((issue) => issue.path === "bank/foods"),
    true,
  );

  const repaired = await repairVault({ vaultRoot });
  const persistedMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
    idPolicy: {
      prefixes: Record<string, string>;
    };
    paths: Record<string, string>;
  };
  const repairedRecipesDirectory = await fs.stat(path.join(vaultRoot, "bank/recipes"));
  const repairedFoodsDirectory = await fs.stat(path.join(vaultRoot, "bank/foods"));

  assert.equal(repaired.updated, true);
  assert.equal(repaired.metadataFile, "vault.json");
  assert.deepEqual(repaired.repairedFields.sort(), [
    "idPolicy.prefixes.food",
    "idPolicy.prefixes.recipe",
    "paths.foodsRoot",
    "paths.recipesRoot",
  ]);
  assert.deepEqual(repaired.createdDirectories.sort(), ["bank/foods", "bank/recipes"]);
  assert.equal(typeof repaired.auditPath, "string");
  assert.equal(persistedMetadata.idPolicy.prefixes.recipe, "rcp");
  assert.equal(persistedMetadata.idPolicy.prefixes.food, "food");
  assert.equal(persistedMetadata.paths.recipesRoot, "bank/recipes");
  assert.equal(persistedMetadata.paths.foodsRoot, "bank/foods");
  assert.equal(repairedRecipesDirectory.isDirectory(), true);
  assert.equal(repairedFoodsDirectory.isDirectory(), true);

  const validationAfterRepair = await validateVault({ vaultRoot });
  assert.equal(validationAfterRepair.valid, true);
  assert.deepEqual(validationAfterRepair.issues, []);
});

test("repairVault returns a no-op result when metadata and directories are already current", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const operationPathsBeforeRepair = await listWriteOperationMetadataPaths(vaultRoot);
  const repaired = await repairVault({ vaultRoot });
  const operationPathsAfterRepair = await listWriteOperationMetadataPaths(vaultRoot);

  assert.equal(repaired.updated, false);
  assert.deepEqual(repaired.repairedFields, []);
  assert.deepEqual(repaired.createdDirectories, []);
  assert.equal(repaired.auditPath, null);
  assert.deepEqual(operationPathsAfterRepair, operationPathsBeforeRepair);
});

test("copyRawArtifact enforces raw immutability and importDocument appends contract-shaped events", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const documentPath = await writeExternalFile(sourceRoot, "Lab Result.pdf", "document body");
  await copyRawArtifact({
    vaultRoot,
    sourcePath: documentPath,
    category: "documents",
    targetName: "lab-result.pdf",
    recordId: "fixed-record",
  });

  await assert.rejects(
    () =>
      copyRawArtifact({
        vaultRoot,
        sourcePath: documentPath,
        category: "documents",
        targetName: "lab-result.pdf",
        recordId: "fixed-record",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const imported = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    note: "baseline import",
  });

  assert.match(imported.raw.relativePath, /^raw\/documents\/\d{4}\/\d{2}\/doc_[0-9A-HJKMNP-TV-Z]{26}\//);
  assert.match(imported.documentId, /^doc_[0-9A-HJKMNP-TV-Z]{26}$/);

  const eventRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.eventPath,
  });
  const documentEvent = expectRecord<DocumentEventRecord>(eventRecords[0]);

  assert.equal(eventRecords.length, 1);
  assert.equal(documentEvent.kind, "document");
  assert.equal(documentEvent.documentId, imported.documentId);
  assert.equal(documentEvent.documentPath, imported.raw.relativePath);
  assert.equal(documentEvent.schemaVersion, "hb.event.v1");
  assert.equal("sourcePath" in documentEvent, false);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.auditPath,
  });
  const latestAuditRecord = expectRecord<AuditRecord | undefined>(auditRecords.at(-1));

  assert.ok(latestAuditRecord);
  assert.equal(latestAuditRecord.action, "document_import");
});

test("photo-only meals preserve an empty audioPaths array in the stored event", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const photoPath = await writeExternalFile(sourceRoot, "meal photo.jpg", "photo");
  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-10T18:30:00.000Z",
    photoPath,
    note: "dinner",
  });

  const mealEvents = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });
  const mealEvent = expectRecord<MealEventRecord>(mealEvents[0]);

  assert.equal(mealEvents.length, 1);
  assert.equal(mealEvent.kind, "meal");
  assert.deepEqual(mealEvent.audioPaths, []);
  assert.equal(meal.audio, null);
});

test("note-only meals stay first-class meal events without raw artifacts", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-10T18:30:00.000Z",
    note: "toast and eggs",
  });

  const mealEvents = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });
  const mealEvent = expectRecord<MealEventRecord>(mealEvents[0]);
  const manifest = JSON.parse(
    await fs.readFile(path.join(vaultRoot, meal.manifestPath), "utf8"),
  ) as {
    artifacts?: unknown[];
  };

  assert.equal(mealEvent.kind, "meal");
  assert.deepEqual(mealEvent.photoPaths, []);
  assert.deepEqual(mealEvent.audioPaths, []);
  assert.deepEqual(mealEvent.rawRefs, [meal.manifestPath]);
  assert.equal(meal.photo, null);
  assert.equal(meal.audio, null);
  assert.deepEqual(manifest.artifacts, []);
});

test("meal, journal, experiment, and samples mutations write expected contract data", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const photoPath = await writeExternalFile(sourceRoot, "meal photo.jpg", "photo");
  const audioPath = await writeExternalFile(sourceRoot, "meal-note.m4a", "audio");
  const csvPath = await writeExternalFile(sourceRoot, "heart-rate.csv", "recordedAt,value\n");

  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-10T18:30:00.000Z",
    photoPath,
    audioPath,
    note: "dinner",
  });

  const mealEvents = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });
  const mealEvent = expectRecord<MealEventRecord>(mealEvents[0]);

  assert.equal(meal.mealId, mealEvent.mealId);
  assert.equal(mealEvent.kind, "meal");
  assert.equal(mealEvent.photoPaths.length, 1);
  assert.equal(mealEvent.audioPaths.length, 1);

  const firstJournal = await ensureJournalDay({
    vaultRoot,
    date: "2026-03-10",
  });
  const secondJournal = await ensureJournalDay({
    vaultRoot,
    date: "2026-03-10",
  });

  assert.equal(firstJournal.created, true);
  assert.equal(secondJournal.created, false);

  const journalContent = await fs.readFile(path.join(vaultRoot, firstJournal.relativePath), "utf8");
  const journalDocument = parseFrontmatterDocument(journalContent);
  assert.equal(journalDocument.attributes.docType, "journal_day");
  assert.equal(journalDocument.attributes.dayKey, "2026-03-10");

  const experiment = await createExperiment({
    vaultRoot,
    slug: "Glucose Baseline",
    title: "Glucose Baseline",
    startedOn: "2026-03-11T08:00:00.000Z",
  });

  const experimentContent = await fs.readFile(
    path.join(vaultRoot, experiment.experiment.relativePath),
    "utf8",
  );
  const experimentDocument = parseFrontmatterDocument(experimentContent);
  assert.equal(experimentDocument.attributes.docType, "experiment");
  assert.equal(experimentDocument.attributes.slug, "glucose-baseline");
  assert.match(String(experimentDocument.attributes.experimentId), /^exp_[0-9A-HJKMNP-TV-Z]{26}$/);

  const samples = await importSamples({
    vaultRoot,
    stream: "heart_rate",
    unit: "bpm",
    sourcePath: csvPath,
    samples: [
      {
        recordedAt: "2026-01-15T10:00:00.000Z",
        value: 62,
      },
      {
        recordedAt: "2026-02-01T10:00:00.000Z",
        value: 64,
      },
    ],
  });

  assert.equal(samples.count, 2);
  assert.match(samples.transformId, /^xfm_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(samples.raw);
  assert.ok(samples.raw.relativePath.includes(`/${samples.transformId}/`));
  assert.equal(samples.shardPaths.length, 2);
  assert.ok(samples.records.every((record) => record.stream === "heart_rate"));
  assert.ok(samples.records.every((record) => !("transformId" in record)));

  const sampleAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: samples.auditPath,
  });
  const latestSampleAuditRecord = expectRecord<AuditRecord | undefined>(sampleAuditRecords.at(-1));

  assert.ok(latestSampleAuditRecord);
  assert.equal("transformId" in latestSampleAuditRecord, false);

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("importSamples normalizes uppercase unit aliases and falls back invalid source metadata", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const imported = await importSamples({
    vaultRoot,
    stream: "glucose",
    unit: "MG/DL",
    source: 42 as unknown as string,
    quality: { invalid: true } as unknown as string,
    samples: [
      {
        recordedAt: "2026-01-15T10:00:00.000Z",
        value: 95,
      },
    ],
  });
  const record = expectRecord<SampleRecord>(imported.records[0]);

  assert.equal(record.stream, "glucose");
  assert.equal(record.unit, "mg_dL");
  assert.equal(record.source, "import");
  assert.equal(record.quality, "raw");
});

test("importSamples rejects invalid sample objects and unsupported units", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "heart_rate",
        unit: "bpm",
        samples: [null] as unknown as Array<Record<string, unknown>>,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE",
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "glucose",
        unit: "mmol/L",
        samples: [
          {
            recordedAt: "2026-01-15T10:00:00.000Z",
            value: 95,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE_UNIT",
  );
});

test("createExperiment returns the existing experiment for idempotent retries", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const input = {
    vaultRoot,
    slug: "Glucose Baseline",
    title: "Glucose Baseline",
    startedOn: "2026-03-11T08:00:00.000Z",
    hypothesis: "Hold meals steady for seven days.",
  };

  const first = await createExperiment(input);
  const second = await createExperiment(input);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.experiment.id, first.experiment.id);
  assert.equal(second.experiment.relativePath, first.experiment.relativePath);
  assert.equal(second.event, null);
  assert.equal(second.auditPath, null);

  const experimentEvents = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-03.jsonl",
  });

  assert.equal(
    experimentEvents.filter(
      (record) => expectRecord<ExperimentEventRecord>(record).kind === "experiment_event",
    ).length,
    1,
  );
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const operations = await Promise.all(
    operationPaths.map((relativePath) => readStoredWriteOperation(vaultRoot, relativePath)),
  );
  const experimentOperations = operations.filter((operation) => operation.operationType === "experiment_create");

  assert.equal(experimentOperations.length, 1);
  assert.equal(experimentOperations[0]?.status, "committed");
});

test("createExperiment coerces invalid status values to active for the legacy create path", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "status-boundary",
    title: "Status Boundary",
    status: "not-a-real-status",
  });

  const experimentDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8"),
  );

  assert.equal(created.created, true);
  assert.equal(experimentDocument.attributes.status, "active");
});

test("assessment imports append contract-shaped records and emit intake audits", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const assessmentPath = await writeExternalFile(
    sourceRoot,
    "intake.json",
    JSON.stringify({
      profile: {
        topGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      },
      family: [
        {
          title: "Mother",
          relationship: "mother",
        },
      ],
    }),
  );

  const imported = await importAssessmentResponse({
    vaultRoot,
    sourcePath: assessmentPath,
    assessmentType: "intake",
    questionnaireSlug: "baseline-intake",
    relatedIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });
  const projected = await projectAssessmentResponse({
    vaultRoot,
    assessmentId: imported.assessment.id,
  });

  const assessmentRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.ledgerPath,
  });
  const importAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.auditPath,
  });
  const projectionAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: projected.auditPath as string,
  });

  assert.equal(assessmentRecords.length, 1);
  assert.equal(expectRecord<{ id: string }>(assessmentRecords[0]).id, imported.assessment.id);
  assert.match(imported.raw.relativePath, /\/source\.json$/u);
  assert.equal(imported.assessment.rawPath, imported.raw.relativePath);
  assert.equal(
    importAuditRecords.filter((record) => expectRecord<AuditRecord>(record).action === "intake_import").length,
    1,
  );
  assert.equal(
    projectionAuditRecords.filter((record) => expectRecord<AuditRecord>(record).action === "intake_project").length,
    1,
  );
  assert.equal(projected.assessmentId, imported.assessment.id);
  assert.equal(projected.profileSnapshots.length, 1);

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("ensureJournalDay rethrows non-file-exists write failures", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.rm(path.join(vaultRoot, "journal"), {
    recursive: true,
    force: true,
  });
  await fs.writeFile(path.join(vaultRoot, "journal"), "not-a-directory", "utf8");

  await assert.rejects(
    () =>
      ensureJournalDay({
        vaultRoot,
        date: "2026-03-10",
      }),
    /ENOTDIR|not a directory/i,
  );
});

test("createExperiment rejects invalid or conflicting existing experiment documents", async () => {
  const invalidVaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot: invalidVaultRoot });
  const conflictingVaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot: conflictingVaultRoot });

  await fs.writeFile(
    path.join(invalidVaultRoot, "bank/experiments/glucose-baseline.md"),
    [
      "---",
      "schemaVersion: hb.frontmatter.experiment.v1",
      "docType: experiment",
      "slug: glucose-baseline",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    path.join(conflictingVaultRoot, "bank/experiments/glucose-baseline.md"),
    [
      "---",
      "schemaVersion: hb.frontmatter.experiment.v1",
      "docType: experiment",
      "experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM",
      "slug: glucose-baseline",
      "status: active",
      "title: Existing experiment",
      "startedOn: 2026-03-11",
      "---",
      "",
      "# Existing experiment",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      createExperiment({
        vaultRoot: invalidVaultRoot,
        slug: "Glucose Baseline",
        title: "Glucose Baseline",
        startedOn: "2026-03-11T08:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "HB_FRONTMATTER_INVALID",
  );

  await assert.rejects(
    () =>
      createExperiment({
        vaultRoot: conflictingVaultRoot,
        slug: "Glucose Baseline",
        title: "Glucose Baseline",
        startedOn: "2026-03-11T08:00:00.000Z",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_EXPERIMENT_CONFLICT",
  );
});

test("append-only helpers block traversal and validateVault reports tampered core documents", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      appendJsonlRecord({
        vaultRoot,
        relativePath: "../escape.jsonl",
        record: { ok: true },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );

  await fs.writeFile(path.join(vaultRoot, "CORE.md"), "---\ndocType: note\n---\n", "utf8");
  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.match(
    validation.issues.map((issue) => issue.code).join(","),
    /HB_FRONTMATTER_INVALID/,
  );
});

test("append-only helpers reject drive-prefixed paths and symlink escapes", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const outsideRoot = await makeTempDirectory("healthybob-outside");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      appendJsonlRecord({
        vaultRoot,
        relativePath: "C:escape.jsonl",
        record: { ok: true },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_PATH",
  );

  await fs.rm(path.join(vaultRoot, "ledger/events"), {
    recursive: true,
    force: true,
  });
  await fs.symlink(outsideRoot, path.join(vaultRoot, "ledger/events"));

  await assert.rejects(
    () =>
      appendJsonlRecord({
        vaultRoot,
        relativePath: "ledger/events/2026/2026-03.jsonl",
        record: { ok: true },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_PATH_SYMLINK",
  );

  assert.deepEqual(await fs.readdir(outsideRoot), []);
});

test("validateVault accumulates malformed journal and experiment frontmatter issues", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const journal = await ensureJournalDay({
    vaultRoot,
    date: "2026-03-10",
  });
  const experiment = await createExperiment({
    vaultRoot,
    slug: "Glucose Baseline",
    title: "Glucose Baseline",
    startedOn: "2026-03-11T08:00:00.000Z",
  });

  await fs.writeFile(
    path.join(vaultRoot, journal.relativePath),
    "---\nthis is not frontmatter\n---\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, experiment.experiment.relativePath),
    "---\nslug: glucose-baseline\nbad-line\n---\n",
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.filter((issue) => issue.code === "HB_FRONTMATTER_INVALID").length,
    2,
  );
  assert.deepEqual(
    validation.issues
      .filter((issue) => issue.code === "HB_FRONTMATTER_INVALID")
      .map((issue) => issue.path)
      .sort(),
    [
      "bank/experiments/glucose-baseline.md",
      "journal/2026/2026-03-10.md",
    ],
  );
});

test("jsonl helpers reject non-object writes and surface invalid JSON line numbers", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      appendJsonlRecord({
        vaultRoot,
        relativePath: "audit/2026/invalid.jsonl",
        record: ["not", "an", "object"] as unknown as Record<string, unknown>,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_RECORD",
  );

  const invalidJsonlPath = path.join(vaultRoot, "audit/2026/invalid.jsonl");
  await fs.writeFile(
    invalidJsonlPath,
    ['{"ok":true}', '{"broken": ]}'].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readJsonlRecords({
        vaultRoot,
        relativePath: "audit/2026/invalid.jsonl",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_JSONL" &&
      error.details.lineNumber === 2,
  );
});

test("validateVault reports invalid metadata before deeper validation", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      schemaVersion: "hb.vault.v1",
      title: "",
    }),
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(validation.metadata, null);
  assert.equal(validation.issues.length, 1);
  assert.equal(validation.issues[0]?.path, "vault.json");
  assert.equal(validation.issues[0]?.code, "VAULT_INVALID_METADATA");
});

test("validateVault reports malformed metadata files as load failures", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.writeFile(path.join(vaultRoot, "vault.json"), "{not-json", "utf8");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(validation.metadata, null);
  assert.equal(validation.issues.length, 1);
  assert.equal(validation.issues[0]?.path, "vault.json");
  assert.equal(validation.issues[0]?.code, "VAULT_INVALID_JSON");
});

test("validateVault reports missing metadata files before walking the vault", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(validation.metadata, null);
  assert.equal(validation.issues.length, 1);
  assert.equal(validation.issues[0]?.path, "vault.json");
  assert.equal(validation.issues[0]?.code, "VAULT_FILE_MISSING");
});

test("validateVault accumulates missing directory and malformed event issues", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.rm(path.join(vaultRoot, "bank/providers"), {
    recursive: true,
    force: true,
  });
  await fs.mkdir(path.join(vaultRoot, "ledger/events/2026"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    `${JSON.stringify({ id: "evt_invalid" })}\n`,
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "VAULT_MISSING_DIRECTORY" &&
        issue.path === "bank/providers",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_EVENT_INVALID" &&
        issue.path === "ledger/events/2026/2026-03.jsonl",
    ),
  );
});

test("validateVault covers health ledgers, registries, and the derived current profile page", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.mkdir(path.join(vaultRoot, "ledger/assessments/2026"), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, "ledger/profile-snapshots/2026"), { recursive: true });

  await fs.writeFile(
    path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
    `${JSON.stringify({ schemaVersion: "hb.assessment-response.v1", id: "asmt_invalid" })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "ledger/profile-snapshots/2026/2026-03.jsonl"),
    `${JSON.stringify({ schemaVersion: "hb.profile-snapshot.v1", id: "psnap_invalid" })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "bank/family/father.md"),
    [
      "---",
      "schemaVersion: hb.frontmatter.family-member.v1",
      "docType: family_member",
      "familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
      "slug: father",
      "title: Father",
      "relationship: father",
      "updatedAt: 2026-03-12T09:00:00Z",
      "---",
      "",
      "# Father",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "bank/profile/current.md"),
    [
      "---",
      "schemaVersion: hb.frontmatter.profile-current.v1",
      "docType: profile_current",
      "snapshotId: psnap_invalid",
      "updatedAt: not-a-timestamp",
      "---",
      "",
      "# Current Profile",
      "",
    ].join("\n"),
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });
  const issuePaths = new Set(validation.issues.map((issue) => issue.path));

  assert.equal(validation.valid, false);
  assert.ok(issuePaths.has("ledger/assessments/2026/2026-03.jsonl"));
  assert.ok(issuePaths.has("ledger/profile-snapshots/2026/2026-03.jsonl"));
  assert.ok(issuePaths.has("bank/family/father.md"));
  assert.ok(issuePaths.has("bank/profile/current.md"));
});

test("validateVault checks raw manifests, referenced artifacts, and current-profile consistency", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const documentPath = await writeExternalFile(sourceRoot, "visit-summary.md", "# Visit summary\n");
  const documentImport = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Visit summary",
  });
  await appendProfileSnapshot({
    vaultRoot,
    recordedAt: "2026-03-12T11:00:00.000Z",
    source: "manual",
    profile: {
      domains: ["sleep"],
      topGoalIds: [],
    },
  });

  await fs.rm(path.join(vaultRoot, documentImport.raw.relativePath), { force: true });
  await fs.rm(path.join(vaultRoot, documentImport.manifestPath), { force: true });
  await fs.appendFile(path.join(vaultRoot, "bank/profile/current.md"), "\nStale view\n", "utf8");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_REFERENCE_MISSING" &&
        issue.path === documentImport.raw.relativePath,
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.path === documentImport.manifestPath,
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_PROFILE_CURRENT_STALE" &&
        issue.path === "bank/profile/current.md",
    ),
  );
});

test("write batches roll back earlier writes when a later action fails", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_batch",
    summary: "rollback on failure",
  });

  await batch.stageTextWrite("notes/partial.txt", "partial\n", { overwrite: false });
  await batch.stageTextWrite("CORE.md", "should fail\n", { overwrite: false });

  await assert.rejects(
    () => batch.commit(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  await assert.rejects(() => fs.access(path.join(vaultRoot, "notes/partial.txt")));

  const operation = await readStoredWriteOperation(vaultRoot, batch.metadataRelativePath);
  assert.equal(operation.status, "rolled_back");
});

test("direct and batched writes reject the same invalid vault targets", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const sourcePath = await writeExternalFile(sourceRoot, "artifact.txt", "artifact\n");
  const rawPath = "raw/testing/fixed/artifact.txt";
  const jsonlPath = "ledger/events/2026/2026-03.jsonl";
  const notePath = "notes/entry.txt";

  await assert.rejects(
    () => writeVaultTextFile(vaultRoot, rawPath, "raw\n"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const rawTextBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_policy_reject_raw_text",
    summary: "reject staged text writes into raw",
  });
  await assert.rejects(
    () => rawTextBatch.stageTextWrite(rawPath, "raw\n"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  await assert.rejects(
    () => writeVaultTextFile(vaultRoot, jsonlPath, "not-append-only\n"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );

  const appendOnlyBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_policy_reject_append_only_text",
    summary: "reject staged text writes into append-only ledgers",
  });
  await assert.rejects(
    () => appendOnlyBatch.stageTextWrite(jsonlPath, "not-append-only\n"),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );

  await assert.rejects(
    () => appendVaultTextFile(vaultRoot, notePath, '{"ok":true}\n'),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );

  const jsonlBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_policy_reject_jsonl_append",
    summary: "reject staged jsonl appends outside append-only paths",
  });
  await assert.rejects(
    () => jsonlBatch.stageJsonlAppend(notePath, '{"ok":true}\n'),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );

  await assert.rejects(
    () => copyImmutableFileIntoVaultRaw(vaultRoot, sourcePath, notePath),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_PATH_REQUIRED",
  );

  const rawCopyBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_policy_reject_raw_copy",
    summary: "reject staged raw copies outside raw",
  });
  await assert.rejects(
    () =>
      rawCopyBatch.stageRawCopy({
        sourcePath,
        targetRelativePath: notePath,
        originalFileName: "artifact.txt",
        mediaType: "text/plain",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_PATH_REQUIRED",
  );

  const deleteBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_policy_reject_delete",
    summary: "reject staged deletes for protected paths",
  });
  await assert.rejects(
    () => deleteBatch.stageDelete(rawPath),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );
  await assert.rejects(
    () => deleteBatch.stageDelete(jsonlPath),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );
});

test("direct and batched immutable raw writes reuse identical content and reject divergent content", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const rawPath = "raw/testing/fixed/source.json";
  const stableValue = {
    ok: true,
    nested: {
      count: 1,
    },
  };
  const stableContent = `${JSON.stringify(stableValue, null, 2)}\n`;

  assert.equal(
    await writeImmutableJsonFileIntoVaultRaw(vaultRoot, rawPath, stableValue, {
      allowExistingMatch: true,
    }),
    rawPath,
  );
  assert.equal(
    await writeImmutableJsonFileIntoVaultRaw(vaultRoot, rawPath, stableValue, {
      allowExistingMatch: true,
    }),
    rawPath,
  );

  const reuseBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_raw_reuse_batch",
    summary: "reuse identical staged raw content",
  });
  await reuseBatch.stageRawText({
    targetRelativePath: rawPath,
    originalFileName: "source.json",
    mediaType: "application/json",
    content: stableContent,
    allowExistingMatch: true,
  });
  await reuseBatch.commit();

  const reusedOperation = await readStoredWriteOperation(vaultRoot, reuseBatch.metadataRelativePath);
  assert.equal(reusedOperation.status, "committed");
  assert.equal(reusedOperation.actions[0]?.state, "reused");
  assert.equal(reusedOperation.actions[0]?.effect, "reuse");

  await assert.rejects(
    () =>
      writeImmutableJsonFileIntoVaultRaw(
        vaultRoot,
        rawPath,
        {
          ok: false,
        },
        { allowExistingMatch: true },
      ),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const failingBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_raw_reuse_batch_reject",
    summary: "reject divergent staged raw content",
  });
  await failingBatch.stageRawText({
    targetRelativePath: rawPath,
    originalFileName: "source.json",
    mediaType: "application/json",
    content: `${JSON.stringify({ ok: false }, null, 2)}\n`,
    allowExistingMatch: true,
  });
  await assert.rejects(
    () => failingBatch.commit(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const failedOperation = await readStoredWriteOperation(vaultRoot, failingBatch.metadataRelativePath);
  assert.equal(failedOperation.status, "rolled_back");
});

test("direct and batched raw copies reuse identical files and reject divergent files", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const rawPath = "raw/testing/fixed/source.txt";
  const matchingSourcePath = await writeExternalFile(sourceRoot, "matching.txt", "stable raw payload\n");
  const divergentSourcePath = await writeExternalFile(sourceRoot, "divergent.txt", "different raw payload\n");

  assert.equal(
    await copyImmutableFileIntoVaultRaw(vaultRoot, matchingSourcePath, rawPath, {
      allowExistingMatch: true,
    }),
    rawPath,
  );
  assert.equal(
    await copyImmutableFileIntoVaultRaw(vaultRoot, matchingSourcePath, rawPath, {
      allowExistingMatch: true,
    }),
    rawPath,
  );

  const reuseBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_raw_copy_reuse_batch",
    summary: "reuse identical staged raw copies",
  });
  await reuseBatch.stageRawCopy({
    sourcePath: matchingSourcePath,
    targetRelativePath: rawPath,
    originalFileName: "matching.txt",
    mediaType: "text/plain",
    allowExistingMatch: true,
  });
  await reuseBatch.commit();

  const reusedOperation = await readStoredWriteOperation(vaultRoot, reuseBatch.metadataRelativePath);
  assert.equal(reusedOperation.status, "committed");
  assert.equal(reusedOperation.actions[0]?.state, "reused");
  assert.equal(reusedOperation.actions[0]?.effect, "reuse");

  await assert.rejects(
    () =>
      copyImmutableFileIntoVaultRaw(vaultRoot, divergentSourcePath, rawPath, {
        allowExistingMatch: true,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const failingBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_raw_copy_reuse_batch_reject",
    summary: "reject divergent staged raw copies",
  });
  await failingBatch.stageRawCopy({
    sourcePath: divergentSourcePath,
    targetRelativePath: rawPath,
    originalFileName: "divergent.txt",
    mediaType: "text/plain",
    allowExistingMatch: true,
  });
  await assert.rejects(
    () => failingBatch.commit(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );

  const failedOperation = await readStoredWriteOperation(vaultRoot, failingBatch.metadataRelativePath);
  assert.equal(failedOperation.status, "rolled_back");
});

test("committed raw-copy actions omit payload blobs while replayable text and jsonl actions keep them", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const sourcePath = await writeExternalFile(sourceRoot, "artifact.txt", "raw payload\n");

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "test_payload_metadata_shapes",
    summary: "verify committed payload metadata by action kind",
    rawCopies: [
      {
        sourcePath,
        targetRelativePath: "raw/testing/fixed/artifact.txt",
        originalFileName: "artifact.txt",
        mediaType: "text/plain",
      },
    ],
    textWrites: [
      {
        relativePath: "notes/payload-metadata.txt",
        content: "text payload\n",
        overwrite: false,
      },
    ],
    jsonlAppends: [
      {
        relativePath: "audit/2026/payload-metadata.jsonl",
        record: {
          ok: true,
        },
      },
    ],
  });

  const operation = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
        readStoredWriteOperation(vaultRoot, relativePath),
      ),
    )
  ).find((candidate) => candidate.operationType === "test_payload_metadata_shapes");

  assert.ok(operation);
  assert.equal(operation.status, "committed");
  assert.equal(operation.actions.length, 3);
  assert.equal(operation.actions[0]?.kind, "raw_copy");
  assert.equal("committedPayloadBase64" in (operation.actions[0] ?? {}), false);
  assert.equal(operation.actions[1]?.kind, "text_write");
  assert.equal(typeof operation.actions[1]?.committedPayloadBase64, "string");
  assert.equal(operation.actions[2]?.kind, "jsonl_append");
  assert.equal(typeof operation.actions[2]?.committedPayloadBase64, "string");
});

test("direct and batched text writes keep no-overwrite and append semantics aligned", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const notePath = "notes/parity.txt";
  const jsonlPath = "audit/2026/parity.jsonl";

  await writeVaultTextFile(vaultRoot, notePath, "first\n", { overwrite: false });
  await assert.rejects(
    () => writeVaultTextFile(vaultRoot, notePath, "second\n", { overwrite: false }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  const noOverwriteBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_no_overwrite_batch",
    summary: "reject staged text overwrite when overwrite is disabled",
  });
  await noOverwriteBatch.stageTextWrite(notePath, "second\n", { overwrite: false });
  await assert.rejects(
    () => noOverwriteBatch.commit(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  await appendVaultTextFile(vaultRoot, jsonlPath, '{"source":"direct"}\n');

  const appendBatch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_jsonl_append_batch",
    summary: "append staged jsonl payload after direct append",
  });
  await appendBatch.stageJsonlAppend(jsonlPath, '{"source":"batch"}\n');
  await appendBatch.commit();

  assert.equal(
    await fs.readFile(path.join(vaultRoot, jsonlPath), "utf8"),
    '{"source":"direct"}\n{"source":"batch"}\n',
  );

  const appendOperation = await readStoredWriteOperation(vaultRoot, appendBatch.metadataRelativePath);
  assert.equal(appendOperation.status, "committed");
  assert.equal(appendOperation.actions[0]?.effect, "append");
  assert.equal(appendOperation.actions[0]?.existedBefore, true);
});

test("validateVault reports unresolved write operations", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_batch",
    summary: "leave staged operation metadata behind",
  });

  await batch.stageTextWrite("notes/pending.txt", "pending\n", { overwrite: false });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_OPERATION_UNRESOLVED" &&
        issue.path === batch.metadataRelativePath,
    ),
  );
});

test("validateVault reports raw artifact directories that are missing manifest.json", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const documentPath = await writeExternalFile(sourceRoot, "manifest-gap.md", "# Missing manifest\n");
  const imported = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Manifest gap",
  });

  await fs.rm(path.join(vaultRoot, imported.manifestPath), { force: true });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes('missing manifest.json') &&
        issue.path === imported.manifestPath,
    ),
  );
});

test("validateVault allows envelope-based inbox raw evidence without manifest sidecars", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const captureDirectory = path.join(
    vaultRoot,
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab",
  );
  const envelopeRelativePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/envelope.json";
  const attachmentRelativePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/attachments/photo.jpg";

  await fs.mkdir(path.join(captureDirectory, "attachments"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, envelopeRelativePath),
    JSON.stringify({
      id: "cap_251f7d1222f2dc12f9666f54ab",
      channel: "telegram",
      capturedAt: "2026-03-27T08:09:31.000+11:00",
      attachments: [
        {
          path: attachmentRelativePath,
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, attachmentRelativePath), "jpeg-bytes", "utf8");
  await appendJsonlRecord({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-03.jsonl",
    record: {
      schemaVersion: "hb.event.v1",
      id: "evt_01JQ8PWXP5A68SQM1W0GYM40V4",
      kind: "note",
      occurredAt: "2026-03-27T08:09:31.000Z",
      recordedAt: "2026-03-27T08:09:31.000Z",
      dayKey: "2026-03-27",
      source: "manual",
      title: "Inbox capture",
      note: "Envelope-backed raw inbox evidence.",
      rawRefs: [envelopeRelativePath, attachmentRelativePath],
    },
  });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateVault allows inbox attachment recovery manifests without envelope.json", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const attachmentRelativePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/attachments/photo.jpg";
  const manifestRelativePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/attachments/manifest.json";

  await fs.mkdir(path.join(vaultRoot, path.posix.dirname(attachmentRelativePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(vaultRoot, attachmentRelativePath), "jpeg-bytes", "utf8");
  await fs.writeFile(
    path.join(vaultRoot, manifestRelativePath),
    JSON.stringify({
      schemaVersion: "hb.raw-import-manifest.v1",
      importId: "evt_01JQ8PWXP5A68SQM1W0GYM40V5",
      importKind: "document",
      importedAt: "2026-03-27T08:09:31.000Z",
      source: "telegram",
      rawDirectory: "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/attachments",
      artifacts: [
        {
          role: "attachment_01",
          relativePath: attachmentRelativePath,
          originalFileName: "photo.jpg",
          mediaType: "image/jpeg",
          byteSize: 10,
          sha256: "a".repeat(64),
        },
      ],
      provenance: {
        syntheticBackfill: true,
        reason: "orphan attachments directory without envelope.json",
        captureId: "cap_251f7d1222f2dc12f9666f54ab",
        attachmentCount: 1,
      },
    }),
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateVault reports inbox capture roots that have neither envelope nor recovery manifest", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const attachmentRelativePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/attachments/photo.jpg";
  const expectedEnvelopePath =
    "raw/inbox/telegram/bot/2026/03/cap_251f7d1222f2dc12f9666f54ab/envelope.json";

  await fs.mkdir(path.join(vaultRoot, path.posix.dirname(attachmentRelativePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(vaultRoot, attachmentRelativePath), "jpeg-bytes", "utf8");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_REFERENCE_MISSING" &&
        issue.path === expectedEnvelopePath &&
        issue.message.includes("attachment recovery manifest"),
    ),
  );
});

test("WriteBatch rolls back earlier writes when a later staged action fails during commit", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_rollback",
    summary: "Rollback test",
  });

  await batch.stageTextWrite("bank/goals/rollback-check.md", "# rollback\n", {
    overwrite: false,
  });
  await batch.stageTextWrite("CORE.md", "# duplicate\n", {
    overwrite: false,
  });

  await assert.rejects(() => batch.commit());
  await assert.rejects(() => fs.access(path.join(vaultRoot, "bank/goals/rollback-check.md")));

  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );
  const operation = operations.find((candidate) => candidate.operationType === "test_rollback");

  assert.ok(operation);
  assert.equal(operation.status, "rolled_back");
  assert.equal(
    operation.actions.filter((action) => action.state === "rolled_back").length,
    1,
  );
});

test("applyCanonicalWriteBatch rolls back vault summary writes when a later text write fails", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const metadataAbsolutePath = path.join(vaultRoot, "vault.json");
  const coreAbsolutePath = path.join(vaultRoot, "CORE.md");
  const originalMetadata = await fs.readFile(metadataAbsolutePath, "utf8");
  const originalCore = await fs.readFile(coreAbsolutePath, "utf8");
  const parsedMetadata = JSON.parse(originalMetadata) as Record<string, unknown>;
  const parsedCore = parseFrontmatterDocument(originalCore);
  const nextTitle = "Rollback Summary Test";
  const nextTimezone = "UTC";
  const updatedAt = "2026-03-16T12:00:00.000Z";
  const nextCore = stringifyFrontmatterDocument({
    attributes: {
      ...parsedCore.attributes,
      title: nextTitle,
      timezone: nextTimezone,
      updatedAt,
    },
    body: parsedCore.body.replace(/^# .*$/mu, `# ${nextTitle}`),
  });
  const originalApplyTextWrite = (
    WriteBatch.prototype as unknown as {
      applyTextWrite: (index: number, action: unknown) => Promise<void>;
    }
  ).applyTextWrite;
  let textWriteCalls = 0;

  (
    WriteBatch.prototype as unknown as {
      applyTextWrite: (index: number, action: unknown) => Promise<void>;
    }
  ).applyTextWrite = async function applyTextWriteWithFailure(index: number, action: unknown) {
    textWriteCalls += 1;

    if (textWriteCalls === 2) {
      throw new Error("injected text write failure");
    }

    return originalApplyTextWrite.call(this, index, action);
  };

  try {
    await assert.rejects(
      () =>
        applyCanonicalWriteBatch({
          vaultRoot,
          operationType: "vault_summary_update",
          summary: "Rollback summary update",
          occurredAt: updatedAt,
          textWrites: [
            {
              relativePath: "vault.json",
              content: `${JSON.stringify(
                {
                  ...parsedMetadata,
                  title: nextTitle,
                  timezone: nextTimezone,
                },
                null,
                2,
              )}\n`,
              overwrite: true,
            },
            {
              relativePath: "CORE.md",
              content: nextCore,
              overwrite: true,
            },
          ],
        }),
      /injected text write failure/u,
    );
  } finally {
    (
      WriteBatch.prototype as unknown as {
        applyTextWrite: (index: number, action: unknown) => Promise<void>;
      }
    ).applyTextWrite = originalApplyTextWrite;
  }

  assert.equal(await fs.readFile(metadataAbsolutePath, "utf8"), originalMetadata);
  assert.equal(await fs.readFile(coreAbsolutePath, "utf8"), originalCore);
});

test("applyCanonicalWriteBatch rolls back experiment markdown when the lifecycle ledger append fails", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const experiment = await createExperiment({
    vaultRoot,
    slug: "focus-sprint",
    title: "Focus Sprint",
    startedOn: "2026-03-10",
  });
  const experimentRelativePath = experiment.experiment.relativePath;
  const experimentAbsolutePath = path.join(vaultRoot, experimentRelativePath);
  const originalExperimentMarkdown = await fs.readFile(experimentAbsolutePath, "utf8");
  const occurredAt = "2026-03-16T14:30:00.000Z";
  const ledgerRelativePath = toMonthlyShardRelativePath("ledger/events", occurredAt, "occurredAt");
  const rollbackEventId = "evt_rollback_check";
  const ledgerRecordsBefore = await readJsonlRecords({
    vaultRoot,
    relativePath: ledgerRelativePath,
  });
  const originalApplyJsonlAppend = (
    WriteBatch.prototype as unknown as {
      applyJsonlAppend: (index: number, action: unknown) => Promise<void>;
    }
  ).applyJsonlAppend;

  (
    WriteBatch.prototype as unknown as {
      applyJsonlAppend: (index: number, action: unknown) => Promise<void>;
    }
  ).applyJsonlAppend = async function applyJsonlAppendWithFailure() {
    throw new Error("injected jsonl append failure");
  };

  try {
    await assert.rejects(
      () =>
        applyCanonicalWriteBatch({
          vaultRoot,
          operationType: "experiment_lifecycle_event",
          summary: "Rollback lifecycle append",
          occurredAt,
          textWrites: [
            {
              relativePath: experimentRelativePath,
              content: `${originalExperimentMarkdown.trimEnd()}\n\n## Checkpoint\n\nAppend should roll back.\n`,
              overwrite: true,
            },
          ],
          jsonlAppends: [
            {
              relativePath: ledgerRelativePath,
              record: {
                schemaVersion: CONTRACT_SCHEMA_VERSION.event,
                id: rollbackEventId,
                kind: "experiment_event",
                occurredAt,
                recordedAt: occurredAt,
                dayKey: "2026-03-16",
                source: "manual",
                title: "Focus Sprint Checkpoint",
                experimentId: experiment.experiment.id,
                experimentSlug: experiment.experiment.slug,
                phase: "checkpoint",
              },
            },
          ],
        }),
      /injected jsonl append failure/u,
    );
  } finally {
    (
      WriteBatch.prototype as unknown as {
        applyJsonlAppend: (index: number, action: unknown) => Promise<void>;
      }
    ).applyJsonlAppend = originalApplyJsonlAppend;
  }

  assert.equal(await fs.readFile(experimentAbsolutePath, "utf8"), originalExperimentMarkdown);
  const ledgerRecordsAfter = await readJsonlRecords({
    vaultRoot,
    relativePath: ledgerRelativePath,
  });
  assert.equal(ledgerRecordsAfter.length, ledgerRecordsBefore.length);
  assert.equal(
    ledgerRecordsAfter.some((record) => record.id === rollbackEventId),
    false,
  );
});

test("applyCanonicalWriteBatch rolls back provider slug renames when deleting the previous path fails", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const alphaRelativePath = "bank/providers/alpha.md";
  const betaRelativePath = "bank/providers/beta.md";
  const alphaAbsolutePath = path.join(vaultRoot, alphaRelativePath);
  const betaAbsolutePath = path.join(vaultRoot, betaRelativePath);
  const alphaMarkdown = "---\nproviderId: prov_alpha\nslug: alpha\ntitle: Alpha Clinic\n---\n# Alpha Clinic\n";
  const originalApplyDelete = (
    WriteBatch.prototype as unknown as {
      applyDelete: (index: number, action: unknown) => Promise<void>;
    }
  ).applyDelete;

  await fs.mkdir(path.dirname(alphaAbsolutePath), { recursive: true });
  await fs.writeFile(alphaAbsolutePath, alphaMarkdown, "utf8");
  (
    WriteBatch.prototype as unknown as {
      applyDelete: (index: number, action: unknown) => Promise<void>;
    }
  ).applyDelete = async function applyDeleteWithFailure() {
    throw new Error("injected delete failure");
  };

  try {
    await assert.rejects(
      () =>
        applyCanonicalWriteBatch({
          vaultRoot,
          operationType: "provider_upsert",
          summary: "Rollback provider rename",
          occurredAt: "2026-03-16T16:00:00.000Z",
          textWrites: [
            {
              relativePath: betaRelativePath,
              content: "---\nproviderId: prov_alpha\nslug: beta\ntitle: Alpha Clinic Renamed\n---\n# Alpha Clinic Renamed\n",
              overwrite: true,
            },
          ],
          deletes: [
            {
              relativePath: alphaRelativePath,
            },
          ],
        }),
      /injected delete failure/u,
    );
  } finally {
    (
      WriteBatch.prototype as unknown as {
        applyDelete: (index: number, action: unknown) => Promise<void>;
      }
    ).applyDelete = originalApplyDelete;
  }

  assert.equal(await fs.readFile(alphaAbsolutePath, "utf8"), alphaMarkdown);
  await assert.rejects(() => fs.access(betaAbsolutePath));
});

test("validateVault reports malformed raw manifests while allowing zero-artifact manifests", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const emptyManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/empty/manifest.json",
  );
  await fs.mkdir(path.dirname(emptyManifestPath), { recursive: true });
  await fs.writeFile(
    emptyManifestPath,
    JSON.stringify({
      schemaVersion: "hb.raw-import.v1",
      importId: "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
      importKind: "meal",
      importedAt: "2026-03-12T12:33:00.000Z",
      source: "manual",
      rawDirectory: "raw/documents/2026/03/empty",
      artifacts: [],
      provenance: {
        eventId: "evt_01JNV42F34M22V2PE9Q4KQ7H1X",
      },
    }),
    "utf8",
  );

  const malformedManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/malformed/manifest.json",
  );
  await fs.mkdir(path.dirname(malformedManifestPath), { recursive: true });
  await fs.writeFile(
    malformedManifestPath,
    JSON.stringify({
      schemaVersion: "hb.raw-import.v1",
      rawDirectory: "raw/documents/2026/03/malformed",
      artifacts: [
        {},
        { relativePath: "raw/documents/2026/03/elsewhere/file.txt" },
      ],
    }),
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.path === "raw/documents/2026/03/empty/manifest.json" &&
        issue.message.includes("must list at least one artifact"),
    ),
    false,
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes("missing a valid relativePath") &&
        issue.path === "raw/documents/2026/03/malformed/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes('must remain inside "raw/documents/2026/03/malformed"') &&
        issue.path === "raw/documents/2026/03/malformed/manifest.json",
    ),
  );
});

test("validateVault reports unreadable and structurally invalid raw manifest files", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const invalidJsonManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/invalid-json/manifest.json",
  );
  await fs.mkdir(path.dirname(invalidJsonManifestPath), { recursive: true });
  await fs.writeFile(invalidJsonManifestPath, "{not-json", "utf8");

  const arrayManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/array/manifest.json",
  );
  await fs.mkdir(path.dirname(arrayManifestPath), { recursive: true });
  await fs.writeFile(arrayManifestPath, JSON.stringify(["not", "an", "object"]), "utf8");

  const missingArtifactsManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/missing-artifacts/manifest.json",
  );
  await fs.mkdir(path.dirname(missingArtifactsManifestPath), { recursive: true });
  await fs.writeFile(
    missingArtifactsManifestPath,
    JSON.stringify({
      schemaVersion: "hb.raw-import.v1",
      importId: "meal_01JNV42NP0KH6JQXMZM1G0V6SF",
      importKind: "meal",
      importedAt: "2026-03-12T12:33:00.000Z",
      rawDirectory: "raw/documents/2026/03/missing-artifacts",
      provenance: {
        eventId: "evt_01JNV42F34M22V2PE9Q4KQ7H1Y",
      },
    }),
    "utf8",
  );

  const mismatchedManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/mismatched/manifest.json",
  );
  await fs.mkdir(path.dirname(mismatchedManifestPath), { recursive: true });
  await fs.writeFile(
    mismatchedManifestPath,
    JSON.stringify({
      rawDirectory: "raw/documents/2026/03/somewhere-else",
      artifacts: [
        {
          relativePath: "raw/documents/2026/03/mismatched/source.txt",
        },
        {
          relativePath: "../escape.txt",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "raw/documents/2026/03/mismatched/source.txt"),
    "raw",
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "VAULT_INVALID_JSON" &&
        issue.path === "raw/documents/2026/03/invalid-json/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes("must be a JSON object") &&
        issue.path === "raw/documents/2026/03/array/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes("must provide an artifacts array") &&
        issue.path === "raw/documents/2026/03/missing-artifacts/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes("missing schemaVersion") &&
        issue.path === "raw/documents/2026/03/mismatched/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes('rawDirectory must equal "raw/documents/2026/03/mismatched"') &&
        issue.path === "raw/documents/2026/03/mismatched/manifest.json",
    ),
  );
});

test("validateVault surfaces malformed JSONL ledger files through family validation", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await fs.mkdir(path.join(vaultRoot, "ledger/assessments/2026"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
    '{"broken": ]}\n',
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "VAULT_INVALID_JSONL" &&
        issue.path === "ledger/assessments/2026/2026-03.jsonl",
    ),
  );
});

test("validateVault reports unresolved and malformed write operation metadata", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations"), { recursive: true });

  await fs.writeFile(
    path.join(vaultRoot, ".runtime/operations/op-unresolved.json"),
    `${JSON.stringify(
      {
        schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
        operationId: "op_unresolved",
        operationType: "document_import",
        summary: "Unresolved operation",
        status: "committing",
        createdAt: "2026-03-13T10:00:00.000Z",
        updatedAt: "2026-03-13T10:00:01.000Z",
        occurredAt: "2026-03-13T10:00:00.000Z",
        actions: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, ".runtime/operations/op-invalid.json"),
    "{not-json",
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_OPERATION_UNRESOLVED" &&
        issue.path === ".runtime/operations/op-unresolved.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_OPERATION_INVALID" &&
        issue.path === ".runtime/operations/op-invalid.json",
    ),
  );
});

test("validateVault preserves unresolved write-operation error messages and vault errors", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations"), { recursive: true });

  await fs.writeFile(
    path.join(vaultRoot, ".runtime/operations/op-error.json"),
    `${JSON.stringify(
      {
        schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
        operationId: "op_error",
        operationType: "document_import",
        summary: "Unresolved operation with error",
        status: "committing",
        createdAt: "2026-03-13T10:00:00.000Z",
        updatedAt: "2026-03-13T10:00:01.000Z",
        occurredAt: "2026-03-13T10:00:00.000Z",
        actions: [],
        error: {
          message: "Network timeout",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, ".runtime/operations/op-invalid-shape.json"),
    `${JSON.stringify(
      {
        schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
        operationId: "op_invalid_shape",
        operationType: "document_import",
        summary: "Invalid operation shape",
        status: "committing",
        createdAt: "2026-03-13T10:00:00.000Z",
        updatedAt: "2026-03-13T10:00:01.000Z",
        occurredAt: "2026-03-13T10:00:00.000Z",
        actions: [{}],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_OPERATION_UNRESOLVED" &&
        issue.path === ".runtime/operations/op-error.json" &&
        issue.message.includes("Last error: Network timeout"),
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_OPERATION_INVALID" &&
        issue.path === ".runtime/operations/op-invalid-shape.json" &&
        issue.message === "Write operation metadata has an unexpected shape.",
    ),
  );
});

test("validateVault covers current profile success, missing-file, and unreadable-file branches", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await appendProfileSnapshot({
    vaultRoot,
    recordedAt: "2026-03-12T11:00:00.000Z",
    source: "manual",
    profile: {
      domains: ["sleep"],
      topGoalIds: [],
    },
  });

  const validState = await validateVault({ vaultRoot });
  assert.equal(validState.valid, true);
  assert.ok(
    validState.issues.every((issue) => issue.code !== "HB_PROFILE_CURRENT_STALE"),
  );

  const currentProfilePath = path.join(vaultRoot, "bank/profile/current.md");
  await fs.rm(currentProfilePath, { force: true });

  const missingCurrent = await validateVault({ vaultRoot });
  assert.equal(missingCurrent.valid, false);
  assert.ok(
    missingCurrent.issues.some(
      (issue) =>
        issue.code === "HB_PROFILE_CURRENT_STALE" &&
        issue.message.includes("Current profile is missing") &&
        issue.path === "bank/profile/current.md",
    ),
  );

  await fs.mkdir(currentProfilePath, { recursive: true });

  const unreadableCurrent = await validateVault({ vaultRoot });
  assert.equal(unreadableCurrent.valid, false);
  assert.ok(
    unreadableCurrent.issues.some(
      (issue) =>
        issue.code === "HB_PROFILE_CURRENT_STALE" &&
        issue.path === "bank/profile/current.md",
    ),
  );
});

test("mutation helpers reject empty meal imports and invalid sample batches", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      addMeal({
        vaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_MEAL_CONTENT_REQUIRED",
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "unsupported-stream",
        unit: "bpm",
        samples: [
          {
            recordedAt: "2026-03-12T08:00:00.000Z",
            value: 61,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_UNSUPPORTED_SAMPLE_STREAM",
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "heart_rate",
        unit: "bpm",
        samples: null as unknown as Array<Record<string, unknown>>,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLES",
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "heart_rate",
        unit: "bpm",
        samples: [],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLES",
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "glucose",
        unit: "mg_dL",
        samples: [
          {
            recordedAt: "2026-03-12T08:00:00.000Z",
            value: "not-a-number",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE",
  );

  const sleepStageImport = await importSamples({
    vaultRoot,
    stream: "sleep_stage",
    unit: "stage",
    samples: [
      {
        recordedAt: "2026-03-12T01:45:00.000Z",
        startAt: "2026-03-12T01:30:00.000Z",
        endAt: "2026-03-12T01:45:00.000Z",
        durationMinutes: 15,
        stage: "rem",
      },
    ],
  });

  assert.equal(sleepStageImport.count, 1);
  assert.equal(sleepStageImport.records[0]?.stream, "sleep_stage");
  assert.equal(sleepStageImport.records[0]?.unit, "stage");
});

test("importSamples validates the full batch before copying raw artifacts or appending ledgers", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const csvPath = await writeExternalFile(
    sourceRoot,
    "bad-samples.csv",
    [
      "timestamp,bpm",
      "2026-03-12T08:00:00.000Z,61",
      "2026-03-12T08:01:00.000Z,not-a-number",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    () =>
      importSamples({
        vaultRoot,
        stream: "heart_rate",
        unit: "bpm",
        sourcePath: csvPath,
        samples: [
          {
            recordedAt: "2026-03-12T08:00:00.000Z",
            value: 61,
          },
          {
            recordedAt: "2026-03-12T08:01:00.000Z",
            value: "not-a-number",
          },
        ] as unknown as Array<Record<string, unknown>>,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE",
  );

  const rawFiles = await fs.readdir(path.join(vaultRoot, "raw/samples"));
  const ledgerFiles = await fs.readdir(path.join(vaultRoot, "ledger/samples"));

  assert.deepEqual(rawFiles, []);
  assert.deepEqual(ledgerFiles, []);
});

test("importSamples retries reuse stable transform ids and avoid duplicating canonical rows", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const csvPath = await writeExternalFile(
    sourceRoot,
    "stable-samples.csv",
    [
      "timestamp,bpm",
      "2026-03-12T08:00:00.000Z,61",
      "2026-03-12T08:01:00.000Z,63",
      "",
    ].join("\n"),
  );
  const input = {
    vaultRoot,
    stream: "heart_rate" as const,
    unit: "bpm",
    sourcePath: csvPath,
    samples: [
      {
        recordedAt: "2026-03-12T08:00:00.000Z",
        value: 61,
      },
      {
        recordedAt: "2026-03-12T08:01:00.000Z",
        value: 63,
      },
    ],
  };

  const first = await importSamples(input);
  const second = await importSamples(input);
  const shardRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: first.shardPaths[0] as string,
  });

  assert.equal(second.transformId, first.transformId);
  assert.equal(second.raw?.relativePath, first.raw?.relativePath);
  assert.deepEqual(
    second.records.map((record) => record.id),
    first.records.map((record) => record.id),
  );
  assert.equal(shardRecords.length, 2);
  assert.deepEqual(
    shardRecords.map((record) => expectRecord<{ id: string }>(record).id),
    first.records.map((record) => record.id),
  );
});

test("importSamples retries repair partial shard state without minting new ids", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  const sourceRoot = await makeTempDirectory("healthybob-source");
  await initializeVault({ vaultRoot });

  const csvPath = await writeExternalFile(
    sourceRoot,
    "partial-samples.csv",
    [
      "timestamp,bpm",
      "2026-03-12T08:00:00.000Z,61",
      "2026-03-12T08:01:00.000Z,63",
      "",
    ].join("\n"),
  );
  const input = {
    vaultRoot,
    stream: "heart_rate" as const,
    unit: "bpm",
    sourcePath: csvPath,
    samples: [
      {
        recordedAt: "2026-03-12T08:00:00.000Z",
        value: 61,
      },
      {
        recordedAt: "2026-03-12T08:01:00.000Z",
        value: 63,
      },
    ],
  };

  const first = await importSamples(input);
  await fs.writeFile(
    path.join(vaultRoot, first.shardPaths[0] as string),
    `${JSON.stringify(first.records[0])}\n`,
    "utf8",
  );
  await fs.rm(path.join(vaultRoot, first.manifestPath), { force: true });

  const retried = await importSamples(input);
  const shardRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: first.shardPaths[0] as string,
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(vaultRoot, retried.manifestPath), "utf8"),
  ) as {
    importId: string;
    provenance?: {
      importedCount?: number;
      sampleIds?: string[];
    };
  };

  assert.equal(retried.transformId, first.transformId);
  assert.equal(retried.raw?.relativePath, first.raw?.relativePath);
  assert.equal(retried.manifestPath, first.manifestPath);
  assert.deepEqual(
    retried.records.map((record) => record.id),
    first.records.map((record) => record.id),
  );
  assert.equal(shardRecords.length, 2);
  assert.deepEqual(
    shardRecords.map((record) => expectRecord<{ id: string }>(record).id),
    first.records.map((record) => record.id),
  );
  assert.equal(manifest.importId, first.transformId);
  assert.equal(manifest.provenance?.importedCount, 2);
  assert.deepEqual(manifest.provenance?.sampleIds, first.records.map((record) => record.id));
});

test("public core exports include the high-level canonical mutation ports", () => {
  assert.equal(typeof appendJournal, "function");
  assert.equal(typeof checkpointExperiment, "function");
  assert.equal(typeof linkJournalEventIds, "function");
  assert.equal(typeof linkJournalStreams, "function");
  assert.equal(typeof promoteInboxExperimentNote, "function");
  assert.equal(typeof promoteInboxJournal, "function");
  assert.equal(typeof stopExperiment, "function");
  assert.equal(typeof unlinkJournalEventIds, "function");
  assert.equal(typeof unlinkJournalStreams, "function");
  assert.equal(typeof updateExperiment, "function");
  assert.equal(typeof updateVaultSummary, "function");
  assert.equal(typeof upsertEvent, "function");
  assert.equal(typeof upsertProvider, "function");
});

test("high-level canonical mutation ports own experiment and journal mutation semantics", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "focus-sprint",
    title: "Focus Sprint",
    startedOn: "2026-03-10",
  });
  const relativePath = created.experiment.relativePath;

  const updated = await updateExperiment({
    vaultRoot,
    relativePath,
    title: "Focus Sprint Updated",
    hypothesis: "Walking after lunch improves the afternoon energy dip.",
    status: "paused",
    body: "# Focus Sprint Updated\n\n## Plan\n\nKeep the walks short and consistent.\n",
    tags: ["energy", "walking"],
  });
  const checkpoint = await checkpointExperiment({
    vaultRoot,
    relativePath,
    occurredAt: "2026-03-12T14:30:00.000Z",
    title: "Midpoint",
    note: "Energy improved after lunch and the afternoon dip arrived later.",
  });
  const stopped = await stopExperiment({
    vaultRoot,
    relativePath,
    occurredAt: "2026-03-13T18:45:00.000Z",
    title: "Stopped",
    note: "The sprint is complete and the updated routine is stable enough to keep.",
  });

  assert.equal(updated.status, "paused");
  assert.equal(checkpoint.status, "paused");
  assert.equal(stopped.status, "completed");

  const experimentDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, relativePath), "utf8"),
  );
  assert.equal(experimentDocument.attributes.title, "Focus Sprint Updated");
  assert.equal(
    experimentDocument.attributes.hypothesis,
    "Walking after lunch improves the afternoon energy dip.",
  );
  assert.equal(experimentDocument.attributes.status, "completed");
  assert.equal(experimentDocument.attributes.endedOn, "2026-03-13");
  assert.deepEqual(experimentDocument.attributes.tags, ["energy", "walking"]);
  assert.match(experimentDocument.body, /Midpoint/u);
  assert.match(
    experimentDocument.body,
    /The sprint is complete and the updated routine is stable enough to keep\./u,
  );

  const lifecycleRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: checkpoint.ledgerFile,
  });
  const phases = lifecycleRecords
    .filter(
      (record): record is ExperimentEventRecord =>
        expectRecord<{ kind?: string; experimentId?: string }>(record).kind === "experiment_event" &&
        expectRecord<{ experimentId?: string }>(record).experimentId === created.experiment.id,
    )
    .map((record) => record.phase);
  assert.deepEqual(phases, ["start", "checkpoint", "stop"]);

  const appended = await appendJournal({
    vaultRoot,
    date: "2026-03-13",
    text: "Evening note from the canonical journal append port.",
  });
  const linkedEventIds = await linkJournalEventIds({
    vaultRoot,
    date: "2026-03-13",
    values: [checkpoint.eventId, stopped.eventId],
  });
  const linkedStreams = await linkJournalStreams({
    vaultRoot,
    date: "2026-03-13",
    values: ["heart_rate", "glucose"],
  });
  const unlinkedEventIds = await unlinkJournalEventIds({
    vaultRoot,
    date: "2026-03-13",
    values: [checkpoint.eventId],
  });
  const unlinkedStreams = await unlinkJournalStreams({
    vaultRoot,
    date: "2026-03-13",
    values: ["glucose"],
  });

  assert.equal(appended.created, true);
  assert.deepEqual(linkedEventIds.eventIds, [checkpoint.eventId, stopped.eventId].sort());
  assert.deepEqual(linkedStreams.sampleStreams, ["glucose", "heart_rate"]);
  assert.deepEqual(unlinkedEventIds.eventIds, [stopped.eventId]);
  assert.deepEqual(unlinkedStreams.sampleStreams, ["heart_rate"]);

  const journalDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, appended.relativePath), "utf8"),
  );
  assert.deepEqual(journalDocument.attributes.eventIds, [stopped.eventId]);
  assert.deepEqual(journalDocument.attributes.sampleStreams, ["heart_rate"]);
  assert.match(
    journalDocument.body,
    /Evening note from the canonical journal append port\./u,
  );
});

test("high-level canonical mutation ports own provider, event, and vault summary semantics", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const summary = await updateVaultSummary({
    vaultRoot,
    title: "Health Ops Vault",
    timezone: "America/Los_Angeles",
  });
  assert.equal(summary.title, "Health Ops Vault");
  assert.equal(summary.timezone, "America/Los_Angeles");

  const vaultMetadata = JSON.parse(
    await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8"),
  ) as {
    title: string;
    timezone: string;
  };
  const coreDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, "CORE.md"), "utf8"),
  );
  assert.equal(vaultMetadata.title, "Health Ops Vault");
  assert.equal(vaultMetadata.timezone, "America/Los_Angeles");
  assert.equal(coreDocument.attributes.title, "Health Ops Vault");
  assert.equal(coreDocument.attributes.timezone, "America/Los_Angeles");
  assert.match(coreDocument.body, /^# Health Ops Vault/mu);

  const createdProvider = await upsertProvider({
    vaultRoot,
    title: "Labcorp",
    slug: "labcorp",
    note: "Primary lab partner.",
    body: "# Labcorp\n\nPrimary lab partner.\n",
  });
  const renamedProvider = await upsertProvider({
    vaultRoot,
    providerId: createdProvider.providerId,
    slug: "labcorp-west",
    title: "Labcorp West",
    note: "Primary lab partner.",
    body: "# Labcorp West\n\nPrimary lab partner.\n",
  });

  assert.equal(createdProvider.created, true);
  assert.equal(renamedProvider.created, false);
  assert.equal(renamedProvider.relativePath, "bank/providers/labcorp-west.md");
  await assert.rejects(() => fs.access(path.join(vaultRoot, "bank/providers/labcorp.md")));

  const providerDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, renamedProvider.relativePath), "utf8"),
  );
  assert.equal(providerDocument.attributes.providerId, createdProvider.providerId);
  assert.equal(providerDocument.attributes.slug, "labcorp-west");
  assert.equal(providerDocument.attributes.title, "Labcorp West");

  const eventPayload = {
    id: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    kind: "note",
    occurredAt: "2026-03-12T08:15:00.000Z",
    title: "Morning note",
    note: "Provider follow-up scheduled.",
    relatedIds: [createdProvider.providerId],
  } satisfies Record<string, unknown>;
  const firstEvent = await upsertEvent({
    vaultRoot,
    payload: eventPayload,
  });
  const secondEvent = await upsertEvent({
    vaultRoot,
    payload: eventPayload,
  });

  assert.equal(firstEvent.created, true);
  assert.equal(secondEvent.created, false);
  assert.equal(secondEvent.ledgerFile, firstEvent.ledgerFile);

  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: firstEvent.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === eventPayload.id,
  ) as EventRecord | undefined;
  assert.ok(eventRecord);
  assert.deepEqual(eventRecord.relatedIds, [createdProvider.providerId]);
  assert.equal(eventRecord.kind, "note");
});

test("high-level canonical mutation ports own inbox journal and experiment-note promotions", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "focus-sprint",
    title: "Focus Sprint",
    startedOn: "2026-03-10",
  });
  const capture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRB1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB2",
    source: "imessage",
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "Breakfast note from inbox",
    thread: {
      id: "thread-1",
      title: "Breakfast Thread",
    },
    actor: {
      id: "contact-1",
      displayName: "Breakfast Buddy",
    },
    attachments: [],
  };

  const firstJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const secondJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const firstExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });
  const secondExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });

  assert.equal(firstJournalPromotion.created, true);
  assert.equal(firstJournalPromotion.appended, true);
  assert.equal(firstJournalPromotion.linked, true);
  assert.equal(secondJournalPromotion.created, false);
  assert.equal(secondJournalPromotion.appended, false);
  assert.equal(secondJournalPromotion.linked, false);
  assert.equal(firstExperimentPromotion.appended, true);
  assert.equal(secondExperimentPromotion.appended, false);

  const journalMarkdown = await fs.readFile(
    path.join(vaultRoot, firstJournalPromotion.journalPath),
    "utf8",
  );
  assert.equal(
    journalMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
    1,
  );
  assert.match(journalMarkdown, /Breakfast note from inbox/u);

  const experimentMarkdown = await fs.readFile(
    path.join(vaultRoot, created.experiment.relativePath),
    "utf8",
  );
  assert.equal(
    experimentMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
    1,
  );
  assert.match(experimentMarkdown, /## Inbox Experiment Notes/u);
  assert.match(experimentMarkdown, /Breakfast note from inbox/u);
});
