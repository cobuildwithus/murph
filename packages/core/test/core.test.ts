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

  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecord.action, "vault_init");
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
