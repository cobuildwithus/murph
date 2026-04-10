import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import type {
  AuditRecord,
  DocumentEventRecord,
  EventRecord,
  ExperimentEventRecord,
  MealEventRecord,
  SampleRecord,
  VaultMetadata,
} from "@murphai/contracts";
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
} from "@murphai/contracts";

import {
  addMeal,
  applyCanonicalWriteBatch,
  appendJournal,
  appendJsonlRecord,
  buildActivitySessionEventDraft,
  buildPublicEventRecord,
  checkpointExperiment,
  copyRawArtifact,
  createExperiment,
  deleteEvent,
  ensureJournalDay,
  importDocument,
  importAssessmentResponse,
  importSamples,
  initializeVault,
  linkJournalEventIds,
  linkJournalStreams,
  loadVault,
  listAssessmentResponses,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  parseFrontmatterDocument,
  projectAssessmentResponse,
  readJsonlRecords,
  readAssessmentResponse,
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
} from "../src/index.ts";
import {
  buildVaultMetadata,
  detectVaultMetadataFormatVersion,
  resolveVaultMetadataFormatVersion,
  validateVaultMetadata,
} from "../src/vault-metadata.ts";
import {
  appendVaultTextFile,
  copyImmutableFileIntoVaultRaw,
  writeImmutableJsonFileIntoVaultRaw,
  writeVaultTextFile,
} from "../src/fs.ts";
import {
  listProtectedCanonicalPaths,
  readRecoverableStoredWriteOperation,
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  WriteBatch,
  WRITE_OPERATION_SCHEMA_VERSION,
} from "../src/operations/index.ts";
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
  SAMPLE_QUALITIES as CORE_SAMPLE_QUALITIES,
  SAMPLE_SCHEMA_VERSION as CORE_SAMPLE_SCHEMA_VERSION,
  SAMPLE_SOURCES as CORE_SAMPLE_SOURCES,
  VAULT_SCHEMA_VERSION as CORE_VAULT_SCHEMA_VERSION,
} from "../src/constants.ts";

function expectRecord<T>(value: unknown): T {
  return value as T;
}

function readFileMode(stats: { mode: number }): number {
  return stats.mode & 0o777;
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
    recipe: CONTRACT_SCHEMA_VERSION.recipeFrontmatter,
    protocol: CONTRACT_SCHEMA_VERSION.protocolFrontmatter,
    workoutFormat: CONTRACT_SCHEMA_VERSION.workoutFormatFrontmatter,
  });
  assert.equal(Object.isFrozen(CORE_FRONTMATTER_SCHEMA_VERSIONS), true);
  assert.equal(CORE_ASSESSMENT_RESPONSE_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.assessmentResponse);
  assert.equal(CORE_EVENT_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION.event);
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const initialized = await initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
  });

  assert.equal(initialized.metadata.formatVersion, 1);
  assert.match(initialized.metadata.vaultId, /^vault_[0-9A-HJKMNP-TV-Z]{26}$/);

  const coreContent = await fs.readFile(path.join(vaultRoot, "CORE.md"), "utf8");
  const coreDocument = parseFrontmatterDocument(coreContent);
  assert.equal(coreDocument.attributes.docType, "core");
  assert.equal(coreDocument.attributes.schemaVersion, "murph.frontmatter.core.v1");

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

test("vault metadata helpers preserve the current format version and validate schema shape", () => {
  const metadata = buildVaultMetadata({
    vaultId: "vault_01JQ9R7WF97M1WAB2B4QF2Q1A1",
    createdAt: "2026-03-12T12:00:00.000Z",
    title: "Baseline vault",
    timezone: "Australia/Melbourne",
  });

  assert.deepEqual(metadata, {
    formatVersion: 1,
    vaultId: "vault_01JQ9R7WF97M1WAB2B4QF2Q1A1",
    createdAt: "2026-03-12T12:00:00.000Z",
    title: "Baseline vault",
    timezone: "Australia/Melbourne",
  });
  assert.equal(resolveVaultMetadataFormatVersion(metadata), 1);
  assert.equal(detectVaultMetadataFormatVersion(metadata), 1);
  assert.deepEqual(validateVaultMetadata(metadata, "VAULT_INVALID_METADATA", "broken"), {
    metadata,
    storedFormatVersion: 1,
  });
});

test("validateVaultMetadata remaps invalid schema details to the caller supplied code", () => {
  assert.throws(
    () =>
      validateVaultMetadata(
        {
          formatVersion: 1,
          vaultId: "vault_01JQ9R7WF97M1WAB2B4QF2Q1A1",
          createdAt: "2026-03-12T12:00:00.000Z",
          title: "",
          timezone: "Australia/Melbourne",
        },
        "CORE_INVALID_METADATA",
        "broken metadata",
      ),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "CORE_INVALID_METADATA" &&
      "errors" in error.details,
  );
});

test("initializeVault rejects roots that already contain a vault", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");

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

test("upsertEvent stores the vault-local dayKey without persisting the fallback timezone when UTC crosses midnight", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-local-day");
  await initializeVault({
    vaultRoot,
    timezone: "Australia/Melbourne",
  });

  const payload = {
    id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A1",
    kind: "note",
    occurredAt: "2026-03-26T21:00:00.000Z",
    title: "Breakfast note",
    note: "Should stay on the March 27 local day.",
  } satisfies Record<string, unknown>;

  const result = await upsertEvent({
    vaultRoot,
    payload,
  });
  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: result.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === payload.id,
  ) as EventRecord | undefined;

  assert.ok(eventRecord);
  assert.equal(eventRecord.dayKey, "2026-03-27");
  assert.equal(eventRecord.timeZone, undefined);
});

test("upsertEvent rejects specialized event kinds on the generic public boundary", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-kind-guard");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A9",
          kind: "meal",
          occurredAt: "2026-03-12T12:32:00.000Z",
          title: "Lunch bowl",
          note: "Chicken, rice, and avocado.",
          mealId: "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
        },
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );
});

test("upsertEvent rejects malformed specialized event kinds on the generic public boundary before contract validation", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-kind-guard-malformed");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "meal",
          occurredAt: "2026-03-12T12:32:00.000Z",
          title: "Lunch bowl",
        },
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );
});

test("upsertEvent rejects malformed attachment payloads instead of silently dropping them", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-attachment-guard");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "note",
          occurredAt: "2026-03-12T12:32:00.000Z",
          title: "Attachment guard",
          attachments: [
            {
              role: "photo",
              relativePath: "raw/workouts/2026/03/evt_01JQ9R7WF97M1WAB2B4QF2Q1B1/progress.jpg",
            },
          ],
        },
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_CONTRACT_INVALID",
  );
});

test("upsertEvent appends new events without parsing unrelated invalid shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-fast-path");
  await initializeVault({ vaultRoot });

  const invalidShardPath = path.join(vaultRoot, "ledger/events/2026/2026-01.jsonl");
  await fs.mkdir(path.dirname(invalidShardPath), { recursive: true });
  await fs.writeFile(invalidShardPath, "{\"broken\":\n", "utf8");

  const result = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-03-12T08:15:00.000Z",
      title: "Morning note",
      note: "Should still append successfully.",
    },
  });
  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: result.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === result.eventId,
  ) as EventRecord | undefined;

  assert.equal(result.created, true);
  assert.ok(eventRecord);
  assert.equal(eventRecord.note, "Should still append successfully.");
});

test("upsertEvent accepts typed public event drafts and still validates against the stored contract", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-typed-draft");
  await initializeVault({
    vaultRoot,
    timezone: "Australia/Melbourne",
  });

  const draft = buildActivitySessionEventDraft({
    occurredAt: new Date("2026-03-12T08:15:00.000Z"),
    title: "Strength session",
    note: "Usual upper-body work.",
    activityType: "strength-training",
    durationMinutes: 45,
    workout: {
      sessionNote: "Usual upper-body work.",
      exercises: [
        {
          name: "pushups",
          order: 1,
          mode: "bodyweight",
          sets: [
            { order: 1, reps: 20 },
            { order: 2, reps: 20 },
            { order: 3, reps: 20 },
            { order: 4, reps: 20 },
          ],
        },
      ],
    },
  });
  const preview = buildPublicEventRecord(draft, "Australia/Melbourne");
  const result = await upsertEvent({
    vaultRoot,
    draft,
  });
  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: result.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === result.eventId,
  ) as EventRecord | undefined;

  assert.equal(preview.kind, "activity_session");
  assert.equal(preview.dayKey, "2026-03-12");
  assert.equal(preview.source, "manual");
  assert.equal(result.created, true);
  assert.ok(eventRecord);
  assert.equal(eventRecord.kind, "activity_session");
  assert.equal((eventRecord as Extract<EventRecord, { kind: "activity_session" }>).activityType, "strength-training");
});

test("upsertEvent appends revisions across shards and deleteEvent appends a tombstone", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-rewrite");
  await initializeVault({ vaultRoot });

  const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1A2";
  const marchResult = await upsertEvent({
    vaultRoot,
    payload: {
      id: eventId,
      kind: "note",
      occurredAt: "2026-03-12T08:15:00.000Z",
      title: "Morning note",
      note: "Original note.",
    },
  });
  const aprilResult = await upsertEvent({
    vaultRoot,
    payload: {
      id: eventId,
      kind: "note",
      occurredAt: "2026-04-02T07:00:00.000Z",
      title: "Morning note",
      note: "Updated note.",
    },
  });

  assert.equal(marchResult.created, true);
  assert.equal(aprilResult.created, false);
  assert.notEqual(aprilResult.ledgerFile, marchResult.ledgerFile);

  const marchRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: marchResult.ledgerFile,
  });
  const aprilRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: aprilResult.ledgerFile,
  });
  const originalEvent = marchRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === eventId,
  ) as EventRecord | undefined;
  const updatedEvent = aprilRecords.find(
    (record) => expectRecord<{ id?: string }>(record).id === eventId,
  ) as EventRecord | undefined;
  assert.ok(originalEvent);
  assert.equal(originalEvent.lifecycle?.revision, 1);
  assert.equal(originalEvent.note, "Original note.");
  assert.ok(updatedEvent);
  assert.equal(updatedEvent.lifecycle?.revision, 2);
  assert.equal(updatedEvent.note, "Updated note.");

  const deleted = await deleteEvent({
    vaultRoot,
    eventId,
  });
  assert.equal(deleted.eventId, eventId);
  assert.equal(deleted.kind, "note");
  assert.deepEqual(deleted.retainedPaths, []);
  assert.equal(deleted.deleted, true);

  const aprilRecordsAfterDelete = await readJsonlRecords({
    vaultRoot,
    relativePath: aprilResult.ledgerFile,
  });
  const tombstoneEvent = aprilRecordsAfterDelete
    .filter((record) => expectRecord<{ id?: string }>(record).id === eventId)
    .map((record) => record as EventRecord)
    .find((record) => record.lifecycle?.state === "deleted");

  assert.equal(aprilRecordsAfterDelete.length, 2);
  assert.ok(tombstoneEvent);
  assert.equal(tombstoneEvent.lifecycle?.revision, 3);
  assert.equal(tombstoneEvent.note, "Updated note.");
});

test("deleteEvent leaves historical rows in place and the same event id can be revived later", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-delete-duplicates");
  await initializeVault({ vaultRoot });

  const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1B1";
  const marchResult = await upsertEvent({
    vaultRoot,
    payload: {
      id: eventId,
      kind: "note",
      occurredAt: "2026-03-12T08:15:00.000Z",
      title: "Original note",
      note: "First revision.",
    },
  });
  await deleteEvent({ vaultRoot, eventId });
  const aprilResult = await upsertEvent({
    vaultRoot,
    payload: {
      id: eventId,
      kind: "note",
      occurredAt: "2026-04-03T08:00:00.000Z",
      title: "Revived note",
      note: "Latest active revision.",
    },
  });

  assert.equal(marchResult.created, true);
  assert.equal(aprilResult.created, false);

  const marchRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: marchResult.ledgerFile,
  });
  const aprilRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: aprilResult.ledgerFile,
  });

  const revisions = [...marchRecords, ...aprilRecords]
    .filter((record) => expectRecord<{ id?: string }>(record).id === eventId)
    .map((record) => (record as EventRecord).lifecycle?.revision)
    .sort((left, right) => (left ?? 0) - (right ?? 0));

  assert.equal(marchRecords.length, 2);
  assert.equal(aprilRecords.length, 1);
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(
    (aprilRecords[0] as EventRecord).lifecycle?.state,
    undefined,
  );
  assert.equal((aprilRecords[0] as EventRecord).lifecycle?.revision, 3);
  assert.equal((aprilRecords[0] as EventRecord).note, "Latest active revision.");
});

test("repairVault recreates missing required directories when metadata is current", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const metadataPath = path.join(vaultRoot, "vault.json");
  const originalMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as VaultMetadata;
  await fs.rm(path.join(vaultRoot, "bank/recipes"), { recursive: true, force: true });
  await fs.rm(path.join(vaultRoot, "bank/foods"), { recursive: true, force: true });

  const loaded = await loadVault({ vaultRoot });

  assert.equal(loaded.metadata.formatVersion, 1);
  const validationBeforeRepair = await validateVault({ vaultRoot });
  assert.equal(validationBeforeRepair.valid, false);
  assert.equal(
    validationBeforeRepair.issues.some((issue) => issue.path === "bank/recipes"),
    true,
  );
  assert.equal(
    validationBeforeRepair.issues.some((issue) => issue.path === "bank/foods"),
    true,
  );

  const repaired = await repairVault({ vaultRoot });
  const persistedMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as VaultMetadata;
  const repairedRecipesDirectory = await fs.stat(path.join(vaultRoot, "bank/recipes"));
  const repairedFoodsDirectory = await fs.stat(path.join(vaultRoot, "bank/foods"));

  assert.equal(repaired.updated, true);
  assert.equal(repaired.metadataFile, "vault.json");
  assert.deepEqual(repaired.createdDirectories.sort(), ["bank/foods", "bank/recipes"]);
  assert.equal(typeof repaired.auditPath, "string");
  assert.deepEqual(persistedMetadata, originalMetadata);
  assert.equal(repairedRecipesDirectory.isDirectory(), true);
  assert.equal(repairedFoodsDirectory.isDirectory(), true);

  const validationAfterRepair = await validateVault({ vaultRoot });
  assert.equal(validationAfterRepair.valid, true);
  assert.deepEqual(validationAfterRepair.issues, []);
});

test("repairVault returns a no-op result when metadata and directories are already current", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const operationPathsBeforeRepair = await listWriteOperationMetadataPaths(vaultRoot);
  const repaired = await repairVault({ vaultRoot });
  const operationPathsAfterRepair = await listWriteOperationMetadataPaths(vaultRoot);

  assert.equal(repaired.updated, false);
  assert.deepEqual(repaired.createdDirectories, []);
  assert.equal(repaired.auditPath, null);
  assert.deepEqual(operationPathsAfterRepair, operationPathsBeforeRepair);
});

test("repairVault recreates missing required directories", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const missingDirectory = path.join(vaultRoot, "bank/providers");
  await fs.rm(missingDirectory, { recursive: true, force: true });

  const repaired = await repairVault({ vaultRoot });
  const repairedDirectory = await fs.stat(missingDirectory);

  assert.equal(repaired.updated, true);
  assert.deepEqual(repaired.createdDirectories, ["bank/providers"]);
  assert.equal(typeof repaired.auditPath, "string");
  assert.equal(repairedDirectory.isDirectory(), true);

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("loadVault and repairVault reject vault metadata with unexpected extra fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const metadataPath = path.join(vaultRoot, "vault.json");
  const staleMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
  staleMetadata.paths = {
    experimentsRoot: "bank/experiments",
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(staleMetadata, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => loadVault({ vaultRoot }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_METADATA",
  );
  await assert.rejects(
    () => repairVault({ vaultRoot }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_METADATA",
  );

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) => issue.code === "VAULT_METADATA_REPAIR_RECOMMENDED"),
    false,
  );
});

test("copyRawArtifact enforces raw immutability and importDocument appends contract-shaped events", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const documentPath = await writeExternalFile(sourceRoot, "Lab Result.pdf", "document body");
  await copyRawArtifact({
    vaultRoot,
    sourcePath: documentPath,
    owner: {
      kind: "document",
      id: "doc_01JQ9R7WF97M1WAB2B4QF2Q1AA",
    },
    targetName: "lab-result.pdf",
  });

  await assert.rejects(
    () =>
      copyRawArtifact({
        vaultRoot,
        sourcePath: documentPath,
        owner: {
          kind: "document",
          id: "doc_01JQ9R7WF97M1WAB2B4QF2Q1AA",
        },
        targetName: "lab-result.pdf",
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
  assert.deepEqual(documentEvent.links, [
    { type: "related_to", targetId: imported.documentId },
  ]);
  assert.deepEqual(documentEvent.rawRefs, [imported.raw.relativePath]);
  assert.equal(documentEvent.attachments?.length, 1);
  assert.equal(documentEvent.attachments?.[0]?.relativePath, imported.raw.relativePath);
  assert.equal(documentEvent.attachments?.[0]?.kind, "document");
  assert.equal(documentEvent.schemaVersion, "murph.event.v1");
  assert.equal("sourcePath" in documentEvent, false);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.auditPath,
  });
  const latestAuditRecord = expectRecord<AuditRecord | undefined>(auditRecords.at(-1));

  assert.ok(latestAuditRecord);
  assert.equal(latestAuditRecord.action, "document_import");
});

test("photo-only meals keep canonical attachments without legacy audio path projections", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  assert.equal(mealEvent.attachments?.length, 1);
  assert.equal(mealEvent.attachments?.[0]?.kind, "photo");
  assert.equal("audioPaths" in mealEvent, false);
  assert.equal(meal.audio, null);
});

test("note-only meals stay first-class meal events without raw artifacts", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  assert.deepEqual(mealEvent.attachments ?? [], []);
  assert.deepEqual(mealEvent.rawRefs, [meal.manifestPath]);
  assert.equal(meal.photo, null);
  assert.equal(meal.audio, null);
  assert.deepEqual(manifest.artifacts, []);
});

test("meal day keys follow the vault timezone instead of UTC date slicing", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({
    vaultRoot,
    timezone: "Australia/Melbourne",
  });

  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-26T21:00:00.000Z",
    note: "breakfast",
  });

  const mealEvents = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });
  const mealEvent = expectRecord<MealEventRecord>(mealEvents[0]);

  assert.equal(mealEvent.dayKey, "2026-03-27");
  assert.equal(mealEvent.timeZone, "Australia/Melbourne");
});

test("meal, journal, experiment, and samples mutations write expected contract data", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  assert.equal(mealEvent.attachments?.length, 2);
  assert.deepEqual(mealEvent.rawRefs?.sort(), [
    meal.photo?.relativePath,
    meal.audio?.relativePath,
  ].filter((value): value is string => Boolean(value)).sort());

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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const createdExperimentEvents = experimentEvents.filter(
    (record): record is ExperimentEventRecord =>
      expectRecord<ExperimentEventRecord>(record).kind === "experiment_event",
  );

  assert.equal(
    createdExperimentEvents.length,
    1,
  );
  assert.deepEqual(createdExperimentEvents[0]?.links, [
    { type: "related_to", targetId: first.experiment.id },
  ]);
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const operations = await Promise.all(
    operationPaths.map((relativePath) => readStoredWriteOperation(vaultRoot, relativePath)),
  );
  const experimentOperations = operations.filter((operation) => operation.operationType === "experiment_create");

  assert.equal(experimentOperations.length, 1);
  assert.equal(experimentOperations[0]?.status, "committed");
});

test("createExperiment rejects invalid status values on the canonical path", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      createExperiment({
        vaultRoot,
        slug: "status-boundary",
        title: "Status Boundary",
        status: "not-a-real-status",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EXPERIMENT_STATUS_INVALID",
  );
});

test("assessment imports append contract-shaped records and emit intake audits", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const assessmentPath = await writeExternalFile(
    sourceRoot,
    "intake.json",
    JSON.stringify({
      profile: {
        goals: {
          topGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
        },
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

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("assessment imports and projections normalize rich nested proposals across every supported category", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const goalId = "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  const secondaryGoalId = "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F9";
  const assessmentPath = await writeExternalFile(
    sourceRoot,
    "rich-intake.json",
    JSON.stringify({
      response: {
        profile: {
          goals: {
            topGoalIds: [goalId],
          },
          custom: {
            domains: ["sleep", "nutrition"],
          },
        },
        goals: [
          {
            label: "Sleep 8 hours",
            status: "active",
            horizon: "quarter",
            priority: "high",
            details: "Recover faster.",
            tags: ["sleep", "recovery"],
          },
        ],
        conditions: [
          {
            diagnosis: "Asthma",
            status: "active",
            recordedAt: "2021-02-03T07:30:00.000Z",
            details: "Exercise induced.",
          },
        ],
        allergies: [
          {
            allergen: "Shellfish",
            reactions: "hives",
            severity: "severe",
            description: "Avoid entirely.",
          },
        ],
        protocols: [
          {
            medicationName: "Magnesium glycinate",
            dose: "200",
            unit: "mg",
            frequency: "nightly",
            instructions: "Take before bed.",
          },
        ],
        historyEvents: [
          {
            event: "ACL surgery",
            type: "procedure",
            date: "2022-07-04T12:00:00.000Z",
            note: "Recovered fully.",
          },
        ],
        familyMembers: [
          {
            relationship: "mother",
            note: "Migraines.",
          },
        ],
        genetics: [
          {
            variant: "BRCA1 c.68_69delAG",
            gene: "BRCA1",
            classification: "pathogenic",
            zygosity: "heterozygous",
          },
        ],
        proposal: {
          structured: {
            data: {
              goal: {
                name: "Build base",
                note: "Nested goal.",
                tags: ["baseline"],
              },
              condition: {
                name: "Hypertension",
                onsetAt: "2021-03-01T08:15:00.000Z",
                note: "Managed.",
              },
              allergy: {
                substance: "Penicillin",
                reaction: "rash",
                severity: "moderate",
              },
              supplements: {
                name: "Vitamin D",
                dose: "2000",
                unit: "IU",
                schedule: "daily",
                note: "Morning.",
              },
              historyEvent: {
                title: "Appendectomy",
                occurredAt: "2020-06-12T09:00:00.000Z",
                description: "No complications.",
              },
              familyMember: {
                name: "Father",
                relation: "father",
                description: "Heart disease.",
              },
              geneticVariant: {
                name: "APOE E4",
                significance: "risk",
                zygosity: "heterozygous",
              },
            },
          },
        },
      },
    }),
  );

  const imported = await importAssessmentResponse({
    vaultRoot,
    sourcePath: assessmentPath,
    assessmentType: " intake ",
    questionnaireSlug: " rich-intake ",
    recordedAt: "2026-03-12T09:15:00.000Z",
    relatedIds: [goalId, ` ${goalId} `, secondaryGoalId],
  });
  const projected = await projectAssessmentResponse({
    vaultRoot,
    assessmentId: imported.assessment.id,
  });

  assert.equal(imported.assessment.assessmentType, "intake");
  assert.equal(imported.assessment.title, "rich-intake.json");
  assert.equal(imported.assessment.questionnaireSlug, "rich-intake");
  assert.deepEqual(imported.assessment.relatedIds, [goalId, secondaryGoalId]);
  assert.equal(projected.assessmentId, imported.assessment.id);
  assert.equal(projected.sourcePath, imported.assessment.rawPath);
  assert.equal(projected.goals.length, 2);
  assert.equal(projected.conditions.length, 2);
  assert.equal(projected.allergies.length, 2);
  assert.equal(projected.protocols.length, 2);
  assert.equal(projected.historyEvents.length, 2);
  assert.equal(projected.familyMembers.length, 2);
  assert.equal(projected.geneticVariants.length, 2);

  const nestedGoal = projected.goals.find((goal) => goal.title === "Build base");
  const nestedCondition = projected.conditions.find((condition) => condition.name === "Hypertension");
  const nestedAllergy = projected.allergies.find((allergy) => allergy.substance === "Penicillin");
  const nestedProtocol = projected.protocols.find((protocol) => protocol.name === "Vitamin D");
  const nestedHistory = projected.historyEvents.find((event) => event.title === "Appendectomy");
  const nestedFamily = projected.familyMembers.find((member) => member.name === "Father");
  const nestedVariant = projected.geneticVariants.find((variant) => variant.variant === "APOE E4");

  assert.ok(nestedGoal);
  assert.equal(nestedGoal.source.assessmentPointer, "/response/proposal/structured/data/goal");
  assert.deepEqual(nestedGoal.tags, ["baseline"]);
  assert.ok(nestedCondition);
  assert.equal(nestedCondition.source.assessmentPointer, "/response/proposal/structured/data/condition");
  assert.equal(nestedCondition.onsetAt, "2021-03-01T08:15:00.000Z");
  assert.ok(nestedAllergy);
  assert.equal(nestedAllergy.source.assessmentPointer, "/response/proposal/structured/data/allergy");
  assert.equal(nestedAllergy.reaction, "rash");
  assert.ok(nestedProtocol);
  assert.equal(nestedProtocol.source.assessmentPointer, "/response/proposal/structured/data/supplements");
  assert.equal(nestedProtocol.dose, "2000 IU");
  assert.ok(nestedHistory);
  assert.equal(nestedHistory.source.assessmentPointer, "/response/proposal/structured/data/historyEvent");
  assert.equal(nestedHistory.occurredAt, "2020-06-12T09:00:00.000Z");
  assert.ok(nestedFamily);
  assert.equal(nestedFamily.source.assessmentPointer, "/response/proposal/structured/data/familyMember");
  assert.ok(nestedVariant);
  assert.equal(nestedVariant.source.assessmentPointer, "/response/proposal/structured/data/geneticVariant");
  assert.equal(nestedVariant.significance, "risk");
  assert.equal(typeof projected.auditPath, "string");

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("projectAssessmentResponse rejects missing payloads and assessmentIds without a vault root", async () => {
  await assert.rejects(
    () => projectAssessmentResponse({}),
    (error: unknown) =>
      error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_PROJECT_INVALID",
  );

  await assert.rejects(
    () =>
      projectAssessmentResponse({
        assessmentId: "asmt_01JQ9R7WF97M1WAB2B4QF2Q1A1",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_PROJECT_INVALID",
  );
});

test("assessment projection drops legacy flat profile blobs after the hard cutover", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const assessmentPath = await writeExternalFile(
    sourceRoot,
    "legacy-intake.json",
    JSON.stringify({
      profile: {
        summary: "Legacy flat summary",
        topGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
      },
    }),
  );

  const imported = await importAssessmentResponse({
    vaultRoot,
    sourcePath: assessmentPath,
    assessmentType: "intake",
    questionnaireSlug: "legacy-intake",
  });
  const projected = await projectAssessmentResponse({
    vaultRoot,
    assessmentId: imported.assessment.id,
  });

  assert.equal(projected.goals.length, 0);
});

test("importAssessmentResponse rejects non-object assessment payloads", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const assessmentPath = await writeExternalFile(sourceRoot, "invalid-intake.json", "[]");

  await assert.rejects(
    () =>
      importAssessmentResponse({
        vaultRoot,
        sourcePath: assessmentPath,
        assessmentType: "intake",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "ASSESSMENT_INVALID_JSON",
  );
});

test("listAssessmentResponses sorts by recordedAt and id", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const earlierPath = await writeExternalFile(
    sourceRoot,
    "earlier-intake.json",
    JSON.stringify({
      profile: {
        goals: {
          topGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
        },
      },
    }),
  );
  const laterPath = await writeExternalFile(
    sourceRoot,
    "later-intake.json",
    JSON.stringify({
      profile: {
        goals: {
          topGoalIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F9"],
        },
      },
    }),
  );

  const later = await importAssessmentResponse({
    vaultRoot,
    sourcePath: laterPath,
    recordedAt: "2026-03-14T10:00:00.000Z",
  });
  const earlier = await importAssessmentResponse({
    vaultRoot,
    sourcePath: earlierPath,
    recordedAt: "2026-03-12T10:00:00.000Z",
  });

  const records = await listAssessmentResponses({ vaultRoot });
  const actualOrder = records.map((record) => record.id);

  assert.deepEqual(actualOrder, [earlier.assessment.id, later.assessment.id]);
});

test("listAssessmentResponses rejects malformed stored assessment rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const shardPath = path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl");
  await fs.mkdir(path.dirname(shardPath), { recursive: true });
  await fs.writeFile(
    shardPath,
    `${JSON.stringify({
      schemaVersion: "murph.assessment-response.v1",
      id: "asmt_01JQ9R7WF97M1WAB2B4QF2Q1A2",
    })}\n`,
    "utf8",
  );

  await assert.rejects(
    () => listAssessmentResponses({ vaultRoot }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_INVALID",
  );
});

test("readAssessmentResponse throws when the assessment id is missing", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      readAssessmentResponse({
        vaultRoot,
        assessmentId: "asmt_01JQ9R7WF97M1WAB2B4QF2Q1A9",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_NOT_FOUND",
  );
});

test("ensureJournalDay rethrows non-file-exists write failures", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const invalidVaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot: invalidVaultRoot });
  const conflictingVaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot: conflictingVaultRoot });

  await fs.writeFile(
    path.join(invalidVaultRoot, "bank/experiments/glucose-baseline.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.experiment.v1",
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
      "schemaVersion: murph.frontmatter.experiment.v1",
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
      error instanceof VaultError && error.code === "FRONTMATTER_INVALID",
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
    /FRONTMATTER_INVALID/,
  );
});

test("append-only helpers reject drive-prefixed paths and symlink escapes", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const outsideRoot = await makeTempDirectory("murph-outside");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
    validation.issues.filter((issue) => issue.code === "FRONTMATTER_INVALID").length,
    2,
  );
  assert.deepEqual(
    validation.issues
      .filter((issue) => issue.code === "FRONTMATTER_INVALID")
      .map((issue) => issue.path)
      .sort(),
    [
      "bank/experiments/glucose-baseline.md",
      "journal/2026/2026-03-10.md",
    ],
  );
});

test("jsonl helpers reject non-object writes and surface invalid JSON line numbers", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  await fs.writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      formatVersion: 1,
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.equal(validation.metadata, null);
  assert.equal(validation.issues.length, 1);
  assert.equal(validation.issues[0]?.path, "vault.json");
  assert.equal(validation.issues[0]?.code, "VAULT_FILE_MISSING");
});

test("validateVault accumulates missing directory and malformed event issues", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
        issue.code === "EVENT_INVALID" &&
        issue.path === "ledger/events/2026/2026-03.jsonl",
    ),
  );
});

test("validateVault covers health ledgers and registries", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  await fs.mkdir(path.join(vaultRoot, "ledger/assessments/2026"), { recursive: true });

  await fs.writeFile(
    path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
    `${JSON.stringify({ schemaVersion: "murph.assessment-response.v1", id: "asmt_invalid" })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "bank/family/father.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.family-member.v1",
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

  const validation = await validateVault({ vaultRoot });
  const issuePaths = new Set(validation.issues.map((issue) => issue.path));

  assert.equal(validation.valid, false);
  assert.ok(issuePaths.has("ledger/assessments/2026/2026-03.jsonl"));
  assert.ok(issuePaths.has("bank/family/father.md"));
});

test("validateVault checks raw manifests and referenced artifacts", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
  await initializeVault({ vaultRoot });

  const documentPath = await writeExternalFile(sourceRoot, "visit-summary.md", "# Visit summary\n");
  const documentImport = await importDocument({
    vaultRoot,
    sourcePath: documentPath,
    occurredAt: "2026-03-12T10:00:00.000Z",
    title: "Visit summary",
  });

  await fs.rm(path.join(vaultRoot, documentImport.raw.relativePath), { force: true });
  await fs.rm(path.join(vaultRoot, documentImport.manifestPath), { force: true });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_REFERENCE_MISSING" &&
        issue.path === documentImport.raw.relativePath,
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.path === documentImport.manifestPath,
    ),
  );
});

test("validateVault accepts workout and body-measurement media references", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  async function writeMediaBatch(input: {
    eventId: string;
    rawDirectory: string;
    mediaRelativePath: string;
    importKind: "workout_batch" | "measurement_batch";
    family: "workout" | "measurement";
  }) {
    const mediaBuffer = Buffer.from(`${input.family}-media`, "utf8");
    const manifestRelativePath = `${input.rawDirectory}/manifest.json`;
    await fs.mkdir(path.join(vaultRoot, input.rawDirectory), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, input.mediaRelativePath), mediaBuffer);
    await fs.writeFile(
      path.join(vaultRoot, manifestRelativePath),
      `${JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
        importId: "xfm_01JNW000A1B2C3D4E5F6G7H8JK",
        importKind: input.importKind,
        importedAt: "2026-03-12T08:00:00.000Z",
        source: "manual",
        owner: {
          kind: input.family,
          id: input.eventId,
        },
        rawDirectory: input.rawDirectory,
        artifacts: [
          {
            role: "media_1",
            relativePath: input.mediaRelativePath,
            originalFileName: "progress-front.jpg",
            mediaType: "image/jpeg",
            byteSize: mediaBuffer.byteLength,
            sha256: createHash("sha256").update(mediaBuffer).digest("hex"),
          },
        ],
        provenance: {
          eventId: input.eventId,
          family: input.family,
          mediaCount: 1,
        },
      }, null, 2)}\n`,
      "utf8",
    );
  }

  const workoutEventId = "evt_01JNW000A1B2C3D4E5F6G7H8JK";
  const workoutRawDirectory = `raw/workouts/2026/03/${workoutEventId}`;
  const workoutMediaRelativePath = `${workoutRawDirectory}/01-progress-front.jpg`;
  const workoutMediaBuffer = Buffer.from("workout-media", "utf8");
  await writeMediaBatch({
    eventId: workoutEventId,
    rawDirectory: workoutRawDirectory,
    mediaRelativePath: workoutMediaRelativePath,
    importKind: "workout_batch",
    family: "workout",
  });
  await upsertEvent({
    vaultRoot,
    payload: {
      id: workoutEventId,
      kind: "activity_session",
      occurredAt: "2026-03-12T08:00:00.000Z",
      title: "Gym check-in",
      activityType: "strength-training",
      durationMinutes: 45,
      attachments: [
        {
          role: "media_1",
          kind: "photo",
          relativePath: workoutMediaRelativePath,
          mediaType: "image/jpeg",
          sha256: createHash("sha256").update(workoutMediaBuffer).digest("hex"),
          originalFileName: "progress-front.jpg",
        },
      ],
      rawRefs: [workoutMediaRelativePath],
      workout: {
        media: [
          {
            kind: "photo",
            relativePath: workoutMediaRelativePath,
            mediaType: "image/jpeg",
          },
        ],
        exercises: [],
      },
    },
  });

  const measurementEventId = "evt_01JNW000Z9Y8X7W6V5T4S3R2QP";
  const measurementRawDirectory = `raw/measurements/2026/03/${measurementEventId}`;
  const measurementMediaRelativePath = `${measurementRawDirectory}/01-progress-front.jpg`;
  const measurementMediaBuffer = Buffer.from("measurement-media", "utf8");
  await writeMediaBatch({
    eventId: measurementEventId,
    rawDirectory: measurementRawDirectory,
    mediaRelativePath: measurementMediaRelativePath,
    importKind: "measurement_batch",
    family: "measurement",
  });
  await upsertEvent({
    vaultRoot,
    payload: {
      id: measurementEventId,
      kind: "body_measurement",
      occurredAt: "2026-03-12T08:05:00.000Z",
      title: "Weekly check-in",
      measurements: [
        {
          type: "weight",
          value: 182.4,
          unit: "lb",
        },
      ],
      attachments: [
        {
          role: "media_1",
          kind: "photo",
          relativePath: measurementMediaRelativePath,
          mediaType: "image/jpeg",
          sha256: createHash("sha256").update(measurementMediaBuffer).digest("hex"),
          originalFileName: "progress-front.jpg",
        },
      ],
      rawRefs: [measurementMediaRelativePath],
      media: [
        {
          kind: "photo",
          relativePath: measurementMediaRelativePath,
          mediaType: "image/jpeg",
        },
      ],
    },
  });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("write batches roll back earlier writes when a later action fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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

test("committed raw-copy actions omit payload blobs while replayable text and jsonl actions keep only receipts", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  assert.equal("committedPayloadReceipt" in (operation.actions[0] ?? {}), false);
  assert.equal(operation.actions[1]?.kind, "text_write");
  assert.deepEqual(operation.actions[1]?.committedPayloadReceipt, {
    sha256: createHash("sha256").update("text payload\n").digest("hex"),
    byteLength: Buffer.byteLength("text payload\n"),
  });
  assert.equal(operation.actions[2]?.kind, "jsonl_append");
  assert.ok(operation.actions[2]?.committedPayloadReceipt);
  assert.equal(typeof operation.actions[2]?.committedPayloadReceipt?.sha256, "string");
  assert.equal(typeof operation.actions[2]?.committedPayloadReceipt?.byteLength, "number");
});

test("applyCanonicalWriteBatch rejects empty staged actions with CANONICAL_WRITE_EMPTY", async () => {
  const vaultRoot = await makeTempDirectory("murph-empty-write-batch");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "test_empty_batch",
        summary: "reject empty staged actions",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "CANONICAL_WRITE_EMPTY",
  );
});

test("readRecoverableStoredWriteOperation tolerates malformed top-level metadata when staged actions stay recoverable", async () => {
  const vaultRoot = await makeTempDirectory("murph-recoverable-write-operation");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations/op_test/payloads"), { recursive: true });

  const relativePath = ".runtime/operations/op_test.json";
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    JSON.stringify(
      {
        operationId: "op_test",
        status: "staged",
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:01.000Z",
        actions: [
          {
            kind: "text_write",
            state: "applied",
            targetRelativePath: "bank/test.md",
            stageRelativePath: ".runtime/operations/op_test/payloads/test.md",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const recovered = await readRecoverableStoredWriteOperation(vaultRoot, relativePath);

  assert.deepEqual(recovered, {
    operationId: "op_test",
    status: "staged",
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:01.000Z",
    actions: [
      {
        kind: "text_write",
        state: "applied",
        targetRelativePath: "bank/test.md",
        stageRelativePath: ".runtime/operations/op_test/payloads/test.md",
        overwrite: true,
        allowExistingMatch: false,
        allowRaw: false,
        effect: undefined,
        existedBefore: undefined,
        backupRelativePath: undefined,
        committedPayloadReceipt: undefined,
        appliedAt: undefined,
        rolledBackAt: undefined,
      },
    ],
  });
});

test("readRecoverableStoredWriteOperation rejects committed text actions that omit committed payload receipts", async () => {
  const vaultRoot = await makeTempDirectory("murph-recoverable-write-operation-missing-receipt");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations/op_test/payloads"), { recursive: true });

  const relativePath = ".runtime/operations/op_test.json";
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    JSON.stringify(
      {
        operationId: "op_test",
        status: "committed",
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:01.000Z",
        actions: [
          {
            kind: "text_write",
            state: "applied",
            targetRelativePath: "bank/test.md",
            stageRelativePath: ".runtime/operations/op_test/payloads/test.md",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  assert.equal(await readRecoverableStoredWriteOperation(vaultRoot, relativePath), null);
});

test("readStoredWriteOperation rejects write actions with unknown states", async () => {
  const vaultRoot = await makeTempDirectory("murph-write-operation-invalid-state");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations/op_test/payloads"), { recursive: true });

  const relativePath = ".runtime/operations/op_test.json";
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    JSON.stringify(
      {
        schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
        operationId: "op_test",
        operationType: "document_import",
        summary: "Invalid action state",
        status: "staged",
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:01.000Z",
        occurredAt: "2026-03-27T00:00:00.000Z",
        actions: [
          {
            kind: "text_write",
            state: "unknown",
            targetRelativePath: "bank/test.md",
            stageRelativePath: ".runtime/operations/op_test/payloads/test.md",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(
    () => readStoredWriteOperation(vaultRoot, relativePath),
    (error: unknown) => error instanceof VaultError && error.code === "OPERATION_INVALID",
  );
});

test("readRecoverableStoredWriteOperation rejects write actions with unknown states", async () => {
  const vaultRoot = await makeTempDirectory("murph-recoverable-write-operation-invalid-state");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, ".runtime/operations/op_test/payloads"), { recursive: true });

  const relativePath = ".runtime/operations/op_test.json";
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    JSON.stringify(
      {
        operationId: "op_test",
        status: "staged",
        createdAt: "2026-03-27T00:00:00.000Z",
        updatedAt: "2026-03-27T00:00:01.000Z",
        actions: [
          {
            kind: "text_write",
            state: "unknown",
            targetRelativePath: "bank/test.md",
            stageRelativePath: ".runtime/operations/op_test/payloads/test.md",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  assert.equal(await readRecoverableStoredWriteOperation(vaultRoot, relativePath), null);
});

test("listProtectedCanonicalPaths excludes symlinks under protected trees", async () => {
  const vaultRoot = await makeTempDirectory("murph-protected-path-symlink");
  const externalRoot = await makeTempDirectory("murph-protected-path-symlink-external");

  try {
    await initializeVault({ vaultRoot });
    const externalPath = await writeExternalFile(externalRoot, "external.md", "# external\n");
    await fs.writeFile(path.join(vaultRoot, "bank", "real.md"), "# real\n", "utf8");
    await fs.symlink(externalPath, path.join(vaultRoot, "bank", "linked.md"));

    const protectedPaths = await listProtectedCanonicalPaths(vaultRoot);

    assert.equal(protectedPaths.includes("bank/real.md"), true);
    assert.equal(protectedPaths.includes("bank/linked.md"), false);
  } finally {
    await fs.rm(externalRoot, { recursive: true, force: true });
  }
});

test("WriteBatch rejects further mutations after commit with OPERATION_STATE_INVALID", async () => {
  const vaultRoot = await makeTempDirectory("murph-terminal-write-batch");
  await initializeVault({ vaultRoot });

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_terminal_batch",
    summary: "commit and then reject further mutations",
  });

  await batch.stageTextWrite("notes/terminal-batch.txt", "first\n", {
    overwrite: false,
  });
  await batch.commit();

  await assert.rejects(
    () =>
      batch.stageTextWrite("notes/terminal-batch.txt", "second\n", {
        overwrite: true,
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "OPERATION_STATE_INVALID",
  );
});

test("direct and batched text writes keep no-overwrite and append semantics aligned", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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

test("writeVaultTextFile leaves the prior canonical file intact when an atomic replace cannot commit", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault-atomic-write");
  await initializeVault({ vaultRoot });

  const notePath = "notes/source-of-truth.md";
  await writeVaultTextFile(vaultRoot, notePath, "before\n");

  const renameSpy = vi.spyOn(fs, "rename").mockRejectedValueOnce(
    Object.assign(new Error("rename blocked"), {
      code: "EACCES",
    }),
  );

  try {
    await assert.rejects(
      () => writeVaultTextFile(vaultRoot, notePath, "after\n"),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EACCES",
    );
  } finally {
    renameSpy.mockRestore();
  }

  const noteAbsolutePath = path.join(vaultRoot, notePath);
  const noteDirectory = path.dirname(noteAbsolutePath);
  const noteContent = await fs.readFile(noteAbsolutePath, "utf8");
  const noteEntries = await fs.readdir(noteDirectory);

  assert.equal(noteContent, "before\n");
  assert.deepEqual(noteEntries, ["source-of-truth.md"]);
});

test("writeVaultTextFile preserves an existing file mode when overwriting", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault-permissions");
  await initializeVault({ vaultRoot });

  const notePath = "notes/private.md";
  const noteAbsolutePath = path.join(vaultRoot, notePath);
  await writeVaultTextFile(vaultRoot, notePath, "before\n");
  await fs.chmod(noteAbsolutePath, 0o600);

  await writeVaultTextFile(vaultRoot, notePath, "after\n");

  const stats = await fs.stat(noteAbsolutePath);
  assert.equal(readFileMode(stats), 0o600);
});

test("WriteBatch text overwrites preserve an existing file mode", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault-batch-permissions");
  await initializeVault({ vaultRoot });

  const notePath = "notes/private-batch.md";
  const noteAbsolutePath = path.join(vaultRoot, notePath);
  await writeVaultTextFile(vaultRoot, notePath, "before\n");
  await fs.chmod(noteAbsolutePath, 0o600);

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "test_preserve_permissions_batch",
    summary: "preserve restrictive permissions while overwriting a text file",
  });
  await batch.stageTextWrite(notePath, "after\n", { overwrite: true });
  await batch.commit();

  const stats = await fs.stat(noteAbsolutePath);
  assert.equal(readFileMode(stats), 0o600);
});

test("validateVault reports unresolved write operations", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
        issue.code === "OPERATION_UNRESOLVED" &&
        issue.path === batch.metadataRelativePath,
    ),
  );
});

test("validateVault reports raw artifact directories that are missing manifest.json", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes('missing manifest.json') &&
        issue.path === imported.manifestPath,
    ),
  );
});

test("validateVault allows envelope-based inbox raw evidence without manifest sidecars", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
      schemaVersion: "murph.event.v1",
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
      schemaVersion: "murph.raw-import-manifest.v1",
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
        issue.code === "RAW_REFERENCE_MISSING" &&
        issue.path === expectedEnvelopePath &&
        issue.message.includes("attachment recovery manifest"),
    ),
  );
});

test("WriteBatch rolls back earlier writes when a later staged action fails during commit", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  await initializeVault({ vaultRoot });

  const emptyManifestPath = path.join(
    vaultRoot,
    "raw/documents/2026/03/empty/manifest.json",
  );
  await fs.mkdir(path.dirname(emptyManifestPath), { recursive: true });
  await fs.writeFile(
    emptyManifestPath,
    JSON.stringify({
      schemaVersion: "murph.raw-import.v1",
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
      schemaVersion: "murph.raw-import.v1",
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
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes("missing a valid relativePath") &&
        issue.path === "raw/documents/2026/03/malformed/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes('must remain inside "raw/documents/2026/03/malformed"') &&
        issue.path === "raw/documents/2026/03/malformed/manifest.json",
    ),
  );
});

test("validateVault reports unreadable and structurally invalid raw manifest files", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
      schemaVersion: "murph.raw-import.v1",
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
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes("must be a JSON object") &&
        issue.path === "raw/documents/2026/03/array/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes("must provide an artifacts array") &&
        issue.path === "raw/documents/2026/03/missing-artifacts/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes("missing schemaVersion") &&
        issue.path === "raw/documents/2026/03/mismatched/manifest.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "RAW_MANIFEST_INVALID" &&
        issue.message.includes('rawDirectory must equal "raw/documents/2026/03/mismatched"') &&
        issue.path === "raw/documents/2026/03/mismatched/manifest.json",
    ),
  );
});

test("validateVault surfaces malformed JSONL ledger files through family validation", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
        issue.code === "OPERATION_UNRESOLVED" &&
        issue.path === ".runtime/operations/op-unresolved.json",
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "OPERATION_INVALID" &&
        issue.path === ".runtime/operations/op-invalid.json",
    ),
  );
});

test("validateVault preserves unresolved write-operation error messages and vault errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
        issue.code === "OPERATION_UNRESOLVED" &&
        issue.path === ".runtime/operations/op-error.json" &&
        issue.message.includes("Last error: Network timeout"),
    ),
  );
  assert.ok(
    validation.issues.some(
      (issue) =>
        issue.code === "OPERATION_INVALID" &&
        issue.path === ".runtime/operations/op-invalid-shape.json" &&
        issue.message === "Write operation metadata has an unexpected shape.",
    ),
  );
});

test("mutation helpers reject empty meal imports and invalid sample batches", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
  const sourceRoot = await makeTempDirectory("murph-source");
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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  const experimentLifecycleRecords = lifecycleRecords.filter(
    (record): record is ExperimentEventRecord =>
      expectRecord<{ kind?: string; experimentId?: string }>(record).kind === "experiment_event" &&
      expectRecord<{ experimentId?: string }>(record).experimentId === created.experiment.id,
  );
  const phases = experimentLifecycleRecords.map((record) => record.phase);
  assert.deepEqual(phases, ["start", "checkpoint", "stop"]);
  assert.deepEqual(
    experimentLifecycleRecords.map((record) => record.links),
    [
      [{ type: "related_to", targetId: created.experiment.id }],
      [{ type: "related_to", targetId: created.experiment.id }],
      [{ type: "related_to", targetId: created.experiment.id }],
    ],
  );

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
  const vaultRoot = await makeTempDirectory("murph-vault");
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
  assert.deepEqual(eventRecord.links, [{ type: "related_to", targetId: createdProvider.providerId }]);
  assert.equal(eventRecord.kind, "note");
});

test("high-level canonical mutation ports own inbox journal and experiment-note promotions", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault");
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
    source: "telegram",
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

test("updateVaultSummary rejects invalid metadata and malformed CORE frontmatter with renamed codes", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault-summary-errors");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      updateVaultSummary({
        vaultRoot,
        timezone: "Mars/Olympus",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_METADATA_INVALID",
  );

  await fs.writeFile(
    path.join(vaultRoot, "CORE.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.core.v1",
      "docType: core",
      "---",
      "# Broken Core",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      updateVaultSummary({
        vaultRoot,
        title: "Still Broken",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "CORE_FRONTMATTER_INVALID",
  );
});

test("updateVaultSummary serializes concurrent metadata and CORE rewrites through the shared resource bundle", async () => {
  const vaultRoot = await makeTempDirectory("murph-vault-summary-parallel");
  await initializeVault({ vaultRoot });

  await Promise.all([
    updateVaultSummary({
      vaultRoot,
      title: "Parallel Health Vault",
    }),
    updateVaultSummary({
      vaultRoot,
      timezone: "America/Los_Angeles",
    }),
  ]);

  const vaultMetadata = JSON.parse(
    await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8"),
  ) as {
    title: string;
    timezone: string;
  };
  const coreDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, "CORE.md"), "utf8"),
  );

  assert.equal(vaultMetadata.title, "Parallel Health Vault");
  assert.equal(vaultMetadata.timezone, "America/Los_Angeles");
  assert.equal(coreDocument.attributes.title, "Parallel Health Vault");
  assert.equal(coreDocument.attributes.timezone, "America/Los_Angeles");
});
