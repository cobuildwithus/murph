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
  appendProfileSnapshot,
  appendJsonlRecord,
  copyRawArtifact,
  createExperiment,
  ensureJournalDay,
  importDocument,
  importAssessmentResponse,
  importSamples,
  initializeVault,
  parseFrontmatterDocument,
  projectAssessmentResponse,
  readJsonlRecords,
  validateVault,
  VaultError,
} from "../src/index.js";
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
    geneticVariant: CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter,
    goal: CONTRACT_SCHEMA_VERSION.goalFrontmatter,
    journalDay: CONTRACT_SCHEMA_VERSION.journalDayFrontmatter,
    profileCurrent: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
    regimen: CONTRACT_SCHEMA_VERSION.regimenFrontmatter,
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

test("validateVault reports malformed raw manifests", async () => {
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
      rawDirectory: "raw/documents/2026/03/empty",
      artifacts: [],
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
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "HB_RAW_MANIFEST_INVALID" &&
        issue.message.includes("must list at least one artifact") &&
        issue.path === "raw/documents/2026/03/empty/manifest.json",
    ),
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

test("mutation helpers reject missing meal photos and invalid sample batches", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      addMeal({
        vaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_MEAL_PHOTO_REQUIRED",
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
