import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONTRACT_SCHEMA_VERSION } from "@murphai/contracts";
import { afterEach, test, vi } from "vitest";

import {
  applyCanonicalWriteBatch,
  appendBloodTest,
  appendHistoryEvent,
  buildRawImportManifest,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  deleteFood,
  deleteProvider,
  deleteRecipe,
  initializeVault,
  inspectCanonicalWriteLock,
  listWriteOperationMetadataPaths,
  readRecoverableStoredWriteOperation,
  readStoredWriteOperation,
  repairVault,
  resolveRawAssetDirectory,
  resolveRawManifestPath,
  resolveVaultPath,
  validateVault,
  upsertAllergy,
  upsertCondition,
  upsertFamilyMember,
  upsertFood,
  upsertGoal,
  upsertGeneticVariant,
  upsertProvider,
  upsertProtocolItem,
  upsertRecipe,
  upsertWorkoutFormat,
  stopProtocolItem,
  VAULT_LAYOUT,
  VaultError,
} from "../src/index.ts";
import {
  copyFileAtomic,
  copyFileAtomicExclusive,
  writeTextFileAtomic,
  writeTextFileAtomicExclusive,
} from "../src/atomic-write.ts";
import { parseRawImportManifest, stageRawImportManifest } from "../src/operations/raw-manifests.ts";
import { WriteBatch, WRITE_OPERATION_SCHEMA_VERSION } from "../src/operations/write-batch.ts";
import {
  applyImmutableWriteTarget,
  applyJsonlAppendTarget,
  applyTextWriteTarget,
  assertWriteTargetPolicy,
  prepareVerifiedWriteTarget,
} from "../src/write-policy.ts";

const FIXED_TIME = "2026-04-08T10:15:00.000Z";

const tempRoots: string[] = [];

async function makeTempDirectory(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempRoots.splice(0).map((directory) =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("atomic writes preserve existing modes while replacing content", async () => {
  const tempDirectory = await makeTempDirectory("murph-core-operations-thresholds-atomic");
  const targetAbsolutePath = path.join(tempDirectory, "nested", "note.txt");
  const sourceAbsolutePath = path.join(tempDirectory, "source.txt");

  await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  await fs.writeFile(targetAbsolutePath, "original\n", "utf8");
  await fs.chmod(targetAbsolutePath, 0o640);

  await writeTextFileAtomic(targetAbsolutePath, "updated\n");

  assert.equal(await fs.readFile(targetAbsolutePath, "utf8"), "updated\n");
  assert.equal((await fs.stat(targetAbsolutePath)).mode & 0o777, 0o640);

  await fs.writeFile(sourceAbsolutePath, "copied\n", "utf8");
  await copyFileAtomic(sourceAbsolutePath, targetAbsolutePath);

  assert.equal(await fs.readFile(targetAbsolutePath, "utf8"), "copied\n");
  assert.equal((await fs.stat(targetAbsolutePath)).mode & 0o777, 0o640);
});

test("exclusive atomic writes fall back when hard links are unavailable", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-atomic-exclusive");
  const textTargetAbsolutePath = path.join(vaultRoot, "nested", "exclusive.txt");
  const copyTargetAbsolutePath = path.join(vaultRoot, "nested", "copied.txt");
  const freshTextTargetAbsolutePath = path.join(vaultRoot, "fresh", "new.txt");
  const sourceAbsolutePath = path.join(vaultRoot, "source.txt");

  await fs.mkdir(path.dirname(textTargetAbsolutePath), { recursive: true });
  await fs.writeFile(sourceAbsolutePath, "copy me\n", "utf8");

  vi.spyOn(fs, "rm").mockRejectedValueOnce(
    Object.assign(new Error("cleanup failed"), {
      code: "EBUSY",
    }),
  );
  const linkSpy = vi.spyOn(fs, "link").mockRejectedValue(
    Object.assign(new Error("link unsupported"), {
      code: "EXDEV",
    }),
  );

  await writeTextFileAtomicExclusive(textTargetAbsolutePath, "exclusive text\n");
  await copyFileAtomicExclusive(sourceAbsolutePath, copyTargetAbsolutePath);

  assert.equal(await fs.readFile(textTargetAbsolutePath, "utf8"), "exclusive text\n");
  assert.equal(await fs.readFile(copyTargetAbsolutePath, "utf8"), "copy me\n");
  await writeTextFileAtomic(freshTextTargetAbsolutePath, "fresh text\n");
  assert.equal(await fs.readFile(freshTextTargetAbsolutePath, "utf8"), "fresh text\n");
  assert.equal(linkSpy.mock.calls.length >= 2, true);
});

test("atomic writes surface non-ENOENT mode preservation errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-atomic-preserve");
  const targetAbsolutePath = path.join(vaultRoot, "mode", "preserve.txt");

  await fs.mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  await fs.writeFile(targetAbsolutePath, "original\n", "utf8");

  vi.spyOn(fs, "stat").mockRejectedValueOnce(
    Object.assign(new Error("stat failed"), {
      code: "EACCES",
    }),
  );

  await assert.rejects(
    () => writeTextFileAtomic(targetAbsolutePath, "updated\n"),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "EACCES",
  );

  assert.equal(await fs.readFile(targetAbsolutePath, "utf8"), "original\n");
});

test("write-policy rejects forbidden targets and distinguishes reuse, update, and append outcomes", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-policy");
  const reusableTarget = await prepareVerifiedWriteTarget(vaultRoot, "bank/reuse.txt", {
    kind: "text",
  });
  const updateTarget = await prepareVerifiedWriteTarget(vaultRoot, "bank/update.txt", {
    kind: "text",
  });
  const appendTarget = await prepareVerifiedWriteTarget(vaultRoot, "ledger/events/2026-04.jsonl", {
    kind: "jsonl_append",
  });

  assert.throws(
    () =>
      assertWriteTargetPolicy("bank/notes.md", {
        kind: "raw",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_PATH_REQUIRED",
  );
  assert.throws(
    () =>
      assertWriteTargetPolicy("raw/documents/2026/04/raw-note.txt", {
        kind: "text",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RAW_IMMUTABLE",
  );
  assert.throws(
    () =>
      assertWriteTargetPolicy("ledger/events/2026-04.jsonl", {
        kind: "text",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_APPEND_ONLY_PATH",
  );

  const reused = await applyImmutableWriteTarget({
    allowExistingMatch: true,
    createTarget: async () => {
      throw Object.assign(new Error("exists"), {
        code: "EEXIST",
      });
    },
    existsErrorMessage: "should not be used",
    matchesExistingContent: async () => true,
    target: reusableTarget,
  });

  assert.deepEqual(reused, {
    effect: "reuse",
    existedBefore: true,
  });

  await fs.writeFile(updateTarget.absolutePath, "before\n", "utf8");
  let backedUp = false;
  const updated = await applyTextWriteTarget({
    backupExisting: async () => {
      backedUp = true;
    },
    createTarget: async () => {
      throw new Error("createTarget should not be called for overwrite updates");
    },
    matchesExistingContent: async () => false,
    overwrite: true,
    replaceTarget: async () => {
      await fs.writeFile(updateTarget.absolutePath, "after\n", "utf8");
    },
    target: updateTarget,
  });

  assert.deepEqual(updated, {
    effect: "update",
    existedBefore: true,
  });
  assert.equal(backedUp, true);
  assert.equal(await fs.readFile(updateTarget.absolutePath, "utf8"), "after\n");

  await fs.writeFile(appendTarget.absolutePath, "first\n", "utf8");
  const appended = await applyJsonlAppendTarget({
    appendPayload: async (payload) => {
      await fs.appendFile(appendTarget.absolutePath, payload, "utf8");
    },
    readPayload: async () => "second\n",
    target: appendTarget,
  });

  assert.deepEqual(appended, {
    effect: "append",
    existedBefore: true,
    originalSize: "first\n".length,
  });
  assert.equal(await fs.readFile(appendTarget.absolutePath, "utf8"), "first\nsecond\n");
});

test("public mutation wrappers cover the thin lock-routing exports", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-public-mutations");
  await initializeVault({ vaultRoot });

  const goal = await upsertGoal({
    vaultRoot,
    title: "Keep fasting glucose stable",
    window: {
      startAt: "2026-03-01",
    },
  });
  const condition = await upsertCondition({
    vaultRoot,
    title: "Migraine",
    clinicalStatus: "active",
  });
  const allergy = await upsertAllergy({
    vaultRoot,
    title: "Penicillin allergy",
    substance: "penicillin",
  });
  const familyMember = await upsertFamilyMember({
    vaultRoot,
    title: "Mother",
    relationship: "mother",
  });
  const variant = await upsertGeneticVariant({
    vaultRoot,
    gene: "APOE",
    title: "APOE e4 allele",
  });
  const historyEvent = await appendHistoryEvent({
    vaultRoot,
    kind: "encounter",
    occurredAt: FIXED_TIME,
    title: "Endocrinology follow-up",
    encounterType: "specialist_follow_up",
  });
  const bloodTest = await appendBloodTest({
    vaultRoot,
    occurredAt: FIXED_TIME,
    title: "Functional health panel",
    testName: "functional_health_panel",
    results: [
      {
        analyte: "Ferritin",
        textValue: "reported as elevated",
      },
    ],
  });
  const provider = await upsertProvider({
    vaultRoot,
    title: "Labcorp West",
  });
  const recipe = await upsertRecipe({
    vaultRoot,
    title: "Recovery bowl",
  });
  const food = await upsertFood({
    vaultRoot,
    title: "Greek yogurt",
  });
  const workoutFormat = await upsertWorkoutFormat({
    vaultRoot,
    title: "Upper Body A",
    activityType: "strength training",
    durationMinutes: 45,
    template: {
      routineNote: "Usual upper-body session.",
      exercises: [],
    },
  });
  const protocol = await upsertProtocolItem({
    vaultRoot,
    title: "Magnesium glycinate",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-03",
    dose: 200,
    unit: "mg",
    schedule: "nightly",
  });
  const stoppedProtocol = await stopProtocolItem({
    vaultRoot,
    protocolId: protocol.record.entity.protocolId,
    stoppedOn: "2026-03-20",
  });
  const deletedProvider = await deleteProvider({
    vaultRoot,
    providerId: provider.providerId,
  });
  const deletedRecipe = await deleteRecipe({
    vaultRoot,
    recipeId: recipe.record.recipeId,
  });
  const deletedFood = await deleteFood({
    vaultRoot,
    foodId: food.record.foodId,
  });

  assert.equal(goal.record.entity.title, "Keep fasting glucose stable");
  assert.equal(condition.record.entity.title, "Migraine");
  assert.equal(allergy.record.entity.substance, "penicillin");
  assert.equal(familyMember.record.entity.relationship, "mother");
  assert.equal(variant.record.entity.gene, "APOE");
  assert.equal(historyEvent.record.kind, "encounter");
  assert.equal(bloodTest.record.kind, "test");
  assert.equal(workoutFormat.record.title, "Upper Body A");
  assert.equal(stoppedProtocol.record.entity.status, "stopped");
  assert.equal(deletedProvider.deleted, true);
  assert.equal(deletedRecipe.deleted, true);
  assert.equal(deletedFood.deleted, true);
});

test("raw manifest staging composes operator metadata and parses the current manifest shape", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-raw");
  const sourceRoot = await makeTempDirectory("murph-core-operations-thresholds-raw-source");
  await initializeVault({ vaultRoot });

  const owner = {
    kind: "document" as const,
    id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  };
  const rawDirectory = resolveRawAssetDirectory({
    owner,
    occurredAt: FIXED_TIME,
  });
  const stagedSourcePath = path.join(sourceRoot, "scan.txt");
  await fs.writeFile(stagedSourcePath, "scan\n", "utf8");

  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "raw_manifest_staging",
    summary: "stage raw manifest",
  });
  const manifestPath = await stageRawImportManifest({
    batch,
    importId: owner.id,
    importKind: "document",
    importedAt: FIXED_TIME,
    owner,
    rawDirectory,
    source: "manual",
    artifacts: [
      {
        role: "source",
        raw: {
          relativePath: `${rawDirectory}/scan.txt`,
          originalFileName: "scan.txt",
          mediaType: "text/plain",
          stagedAbsolutePath: stagedSourcePath,
        },
      },
    ],
    provenance: {
      sourceFileName: "scan.txt",
    },
    operatorMetadata: {
      actor: "tester",
    },
  });

  await batch.commit();

  assert.equal(manifestPath, `${rawDirectory}/manifest.json`);
  const manifest = JSON.parse(
    await fs.readFile(resolveVaultPath(vaultRoot, manifestPath).absolutePath, "utf8"),
  ) as {
    artifacts: Array<{ mediaType?: string; role?: string; sha256?: string }>;
    provenance?: { operatorMetadata?: { actor?: string } };
  };

  assert.equal(manifest.artifacts[0]?.role, "source");
  assert.equal(manifest.artifacts[0]?.mediaType, "text/plain");
  assert.equal(typeof manifest.artifacts[0]?.sha256, "string");
  assert.equal(manifest.provenance?.operatorMetadata?.actor, "tester");

  const parsedManifest = parseRawImportManifest(manifest);

  assert.equal(parsedManifest.schemaVersion, CONTRACT_SCHEMA_VERSION.rawImportManifest);
  assert.deepEqual(parsedManifest.owner, owner);
  assert.equal(resolveRawManifestPath({ artifacts: parsedManifest.artifacts }), `${rawDirectory}/manifest.json`);
});

test("validateVault ignores unrelated raw inbox files and non-attachment manifest placeholders", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-raw-inbox-noise");
  await initializeVault({ vaultRoot });

  const captureDirectory = path.join(
    vaultRoot,
    VAULT_LAYOUT.rawInboxDirectory,
    "telegram",
    "bot",
    "2026",
    "03",
    "cap_251f7d1222f2dc12f9666f54ab",
  );
  const looseRawPath = path.join(captureDirectory, "note.txt");
  const strayManifestPath = path.join(captureDirectory, "manifest.json");

  await fs.mkdir(captureDirectory, { recursive: true });
  await fs.writeFile(looseRawPath, "note\n", "utf8");
  await fs.writeFile(strayManifestPath, "placeholder\n", "utf8");

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("raw manifest helpers reject missing directories and reserved provenance metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-raw-errors");
  const sourceRoot = await makeTempDirectory("murph-core-operations-thresholds-raw-errors-source");
  await initializeVault({ vaultRoot });
  const owner = {
    kind: "document" as const,
    id: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  };
  const rawDirectory = resolveRawAssetDirectory({
    owner,
    occurredAt: FIXED_TIME,
  });
  const mismatchedOwner = {
    kind: "measurement" as const,
    id: "mem_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  };
  const mismatchedRawDirectory = resolveRawAssetDirectory({
    owner: mismatchedOwner,
    occurredAt: FIXED_TIME,
  });

  assert.throws(
    () => resolveRawManifestPath({ artifacts: [] }),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === "raw import manifest requires either a rawDirectory or at least one raw artifact",
  );
  assert.throws(
    () =>
      buildRawImportManifest({
        importId: owner.id,
        importKind: "document",
        importedAt: FIXED_TIME,
        owner,
        rawDirectory: mismatchedRawDirectory,
        source: "manual",
        artifacts: [
          {
            role: "source",
            relativePath: `${mismatchedRawDirectory}/scan.txt`,
            originalFileName: "scan.txt",
            mediaType: "text/plain",
            byteSize: 5,
            sha256: "b".repeat(64),
          },
        ],
        provenance: {
          sourceFileName: "scan.txt",
        },
      }),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message.includes("does not match owner"),
  );

  await assert.rejects(
    async () => {
      const stagedSourcePath = path.join(sourceRoot, "scan.txt");
      await fs.writeFile(stagedSourcePath, "scan\n", "utf8");
      const batch = await WriteBatch.create({
        vaultRoot,
        operationType: "raw_manifest_reserved_operator_metadata",
        summary: "stage raw manifest with reserved operator metadata",
      });

      await stageRawImportManifest({
        batch,
        importId: owner.id,
        importKind: "document",
        importedAt: FIXED_TIME,
        owner,
        rawDirectory,
        source: "manual",
        artifacts: [
          {
            role: "source",
            raw: {
              relativePath: `${rawDirectory}/scan.txt`,
              originalFileName: "scan.txt",
              mediaType: "text/plain",
              stagedAbsolutePath: stagedSourcePath,
            },
          },
        ],
        provenance: {
          operatorMetadata: {
            shouldFail: true,
          },
        },
      });
    },
    (error: unknown) =>
      error instanceof TypeError &&
      error.message.includes('reserves "operatorMetadata"'),
  );
});

test("stored write operations reject committed payloads without receipts and remain recoverable", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-write-batch");
  await initializeVault({ vaultRoot });

  const metadataDirectory = resolveVaultPath(vaultRoot, ".runtime/operations").absolutePath;
  const operationPath = ".runtime/operations/rejected-committed-operation.json";
  await fs.mkdir(metadataDirectory, { recursive: true });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, operationPath).absolutePath,
    `${JSON.stringify(
      {
        schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
        operationId: "op_test",
        operationType: "manual",
        summary: "broken committed write",
        status: "committed",
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
        occurredAt: FIXED_TIME,
        actions: [
          {
            kind: "text_write",
            state: "applied",
            targetRelativePath: "bank/test.md",
            stageRelativePath: ".runtime/operations/op_test/payloads/0000.txt",
            overwrite: true,
            allowExistingMatch: false,
            allowRaw: false,
            effect: "create",
            existedBefore: false,
            appliedAt: FIXED_TIME,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    () => readStoredWriteOperation(vaultRoot, operationPath),
    (error: unknown) => error instanceof VaultError && error.code === "OPERATION_INVALID",
  );
});

test("applyCanonicalWriteBatch rejects empty batches and rolls back applied writes when a later write fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-batch");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "empty_batch",
        summary: "nothing to stage",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "CANONICAL_WRITE_EMPTY",
  );

  const createdPath = "bank/thresholds/created.md";
  const failingPath = "bank/thresholds/existing.md";
  const createdAbsolutePath = resolveVaultPath(vaultRoot, createdPath).absolutePath;
  const failingAbsolutePath = resolveVaultPath(vaultRoot, failingPath).absolutePath;

  await fs.mkdir(path.dirname(failingAbsolutePath), { recursive: true });
  await fs.writeFile(failingAbsolutePath, "keep\n", "utf8");

  await assert.rejects(
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "rollback_test",
        summary: "stage a write and then fail",
        textWrites: [
          {
            relativePath: createdPath,
            content: "created\n",
          },
          {
            relativePath: failingPath,
            content: "replaced\n",
            overwrite: false,
          },
        ],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  assert.equal(await fs.access(createdAbsolutePath).then(() => true, () => false), false);
  assert.equal(await fs.readFile(failingAbsolutePath, "utf8"), "keep\n");

  const rollbackOperation = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map(async (relativePath) => ({
        relativePath,
        operation: await readStoredWriteOperation(vaultRoot, relativePath),
      })),
    )
  ).find(({ operation }) => operation.operationType === "rollback_test");

  assert.ok(rollbackOperation);
  assert.equal(rollbackOperation?.operation.status, "rolled_back");
  assert.equal(rollbackOperation?.operation.actions[0]?.state, "rolled_back");
  assert.equal(rollbackOperation?.operation.actions[1]?.state, "staged");

  const recoverable = await readRecoverableStoredWriteOperation(
    vaultRoot,
    rollbackOperation?.relativePath ?? "",
  );
  assert.equal(recoverable?.operationId, rollbackOperation?.operation.operationId);
  assert.equal(recoverable?.status, "rolled_back");
});

test("applyCanonicalWriteBatch records rollback failures and validateVault reports them", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-batch-failed");
  await initializeVault({ vaultRoot });

  const createdPath = "bank/thresholds/rollback-created.md";
  const existingPath = "bank/thresholds/rollback-existing.md";
  const createdAbsolutePath = resolveVaultPath(vaultRoot, createdPath).absolutePath;
  const existingAbsolutePath = resolveVaultPath(vaultRoot, existingPath).absolutePath;

  await fs.mkdir(path.dirname(existingAbsolutePath), { recursive: true });
  await fs.writeFile(existingAbsolutePath, "keep\n", "utf8");

  vi.spyOn(fs, "unlink").mockRejectedValueOnce(
    new VaultError("VAULT_ROLLBACK_FAILED", "rollback exploded"),
  );

  await assert.rejects(
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "rollback_failure",
        summary: "stage a write and then fail",
        textWrites: [
          {
            relativePath: createdPath,
            content: "created\n",
          },
          {
            relativePath: existingPath,
            content: "replacement\n",
            overwrite: false,
          },
        ],
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  assert.equal(await fs.readFile(createdAbsolutePath, "utf8"), "created\n");
  assert.equal(await fs.readFile(existingAbsolutePath, "utf8"), "keep\n");

  const rollbackOperation = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map(async (relativePath) => ({
        relativePath,
        operation: await readStoredWriteOperation(vaultRoot, relativePath),
      })),
    )
  ).find(({ operation }) => operation.operationType === "rollback_failure");

  assert.ok(rollbackOperation);
  assert.equal(rollbackOperation?.operation.status, "failed");
  assert.equal(rollbackOperation?.operation.error?.code, "VAULT_ROLLBACK_FAILED");
  assert.equal(rollbackOperation?.operation.error?.message, "rollback exploded");

  const recoverable = await readRecoverableStoredWriteOperation(
    vaultRoot,
    rollbackOperation?.relativePath ?? "",
  );
  assert.equal(recoverable?.status, "failed");

  const validation = await validateVault({ vaultRoot });
  const unresolved = validation.issues.find((issue) => issue.code === "OPERATION_UNRESOLVED");
  assert.ok(unresolved);
  assert.equal(unresolved?.path, rollbackOperation?.relativePath);
  assert.match(unresolved?.message ?? "", /Last error: rollback exploded/u);
  assert.equal(validation.valid, false);
});

test("applyCanonicalWriteBatch rolls back deletes through their backups", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-delete-rollback");
  await initializeVault({ vaultRoot });

  const deletedPath = "bank/thresholds/delete-me.md";
  const failingPath = "bank/thresholds/delete-existing.md";
  const deletedAbsolutePath = resolveVaultPath(vaultRoot, deletedPath).absolutePath;
  const failingAbsolutePath = resolveVaultPath(vaultRoot, failingPath).absolutePath;

  await fs.mkdir(path.dirname(deletedAbsolutePath), { recursive: true });
  await fs.writeFile(deletedAbsolutePath, "remove me\n", "utf8");
  await fs.writeFile(failingAbsolutePath, "keep\n", "utf8");

  await assert.rejects(
    () =>
      (async () => {
        const batch = await WriteBatch.create({
          vaultRoot,
          operationType: "delete_rollback",
          summary: "delete then fail",
        });

        await batch.stageDelete(deletedPath);
        await batch.stageTextWrite(failingPath, "replacement\n", {
          overwrite: false,
        });
        await batch.commit();
      })(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );

  assert.equal(await fs.readFile(deletedAbsolutePath, "utf8"), "remove me\n");
  assert.equal(await fs.readFile(failingAbsolutePath, "utf8"), "keep\n");

  const rollbackOperation = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map(async (relativePath) => ({
        relativePath,
        operation: await readStoredWriteOperation(vaultRoot, relativePath),
      })),
    )
  ).find(({ operation }) => operation.operationType === "delete_rollback");

  assert.ok(rollbackOperation);
  assert.equal(rollbackOperation?.operation.status, "rolled_back");
  assert.equal(rollbackOperation?.operation.actions[0]?.kind, "delete");
  assert.equal(rollbackOperation?.operation.actions[0]?.state, "rolled_back");
  assert.equal(typeof rollbackOperation?.operation.actions[0]?.backupRelativePath, "string");
  assert.equal(rollbackOperation?.operation.actions[1]?.state, "staged");
});

test("validateVault reports missing metadata and missing required directories", async () => {
  const missingMetadataVaultRoot = await makeTempDirectory(
    "murph-core-operations-thresholds-vault-metadata-missing",
  );

  const missingMetadataValidation = await validateVault({ vaultRoot: missingMetadataVaultRoot });
  assert.equal(missingMetadataValidation.valid, false);
  assert.ok(
    missingMetadataValidation.issues.some(
      (issue) => issue.code === "VAULT_FILE_MISSING" && issue.path === "vault.json",
    ),
  );

  const missingDirectoryVaultRoot = await makeTempDirectory(
    "murph-core-operations-thresholds-vault-directory-missing",
  );
  await initializeVault({ vaultRoot: missingDirectoryVaultRoot });
  await fs.rm(path.join(missingDirectoryVaultRoot, "bank/providers"), {
    recursive: true,
    force: true,
  });

  const missingDirectoryValidation = await validateVault({ vaultRoot: missingDirectoryVaultRoot });
  assert.equal(missingDirectoryValidation.valid, false);
  assert.ok(
    missingDirectoryValidation.issues.some(
      (issue) => issue.code === "VAULT_MISSING_DIRECTORY" && issue.path === "bank/providers",
    ),
  );
});

test("validateVault reports load failures when the metadata path is a directory", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-vault-metadata-dir");

  await fs.mkdir(path.join(vaultRoot, "vault.json"), {
    recursive: true,
  });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "VAULT_LOAD_FAILED" && issue.path === "vault.json",
    ),
  );
});

test("canonical write lock inspection treats malformed metadata as stale", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-lock");
  await initializeVault({ vaultRoot });

  await fs.mkdir(resolveVaultPath(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY).absolutePath, {
    recursive: true,
  });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH).absolutePath,
    "not-json\n",
    "utf8",
  );

  const inspection = await inspectCanonicalWriteLock(vaultRoot);

  assert.equal(inspection.state, "stale");
  assert.equal(inspection.metadata, null);
  assert.match(inspection.reason, /malformed/u);
});

test("repairVault is a no-op on healthy vaults and recreates missing required directories", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-repair");
  await initializeVault({ vaultRoot });

  const noOp = await repairVault({ vaultRoot });
  assert.equal(noOp.updated, false);
  assert.deepEqual(noOp.createdDirectories, []);

  const missingDirectory = path.join(vaultRoot, "bank/providers");
  await fs.rm(missingDirectory, {
    recursive: true,
    force: true,
  });

  const repaired = await repairVault({ vaultRoot });

  assert.equal(repaired.updated, true);
  assert.deepEqual(repaired.createdDirectories, ["bank/providers"]);
  assert.equal(await fs.stat(missingDirectory).then((stats) => stats.isDirectory()), true);
  assert.equal(typeof repaired.auditPath, "string");
  assert.equal(repaired.metadataFile, "vault.json");
});

test("repairVault recreates missing required directories", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-operations-thresholds-repair-throws");
  await initializeVault({ vaultRoot });

  const missingDirectory = path.join(vaultRoot, VAULT_LAYOUT.providersDirectory);

  await fs.rm(missingDirectory, {
    recursive: true,
    force: true,
  });

  const repaired = await repairVault({ vaultRoot });

  assert.equal(repaired.updated, true);
  assert.ok(repaired.createdDirectories.includes(VAULT_LAYOUT.providersDirectory));
  assert.equal(await fs.stat(missingDirectory).then((stats) => stats.isDirectory()), true);
  assert.equal(typeof repaired.auditPath, "string");
});
