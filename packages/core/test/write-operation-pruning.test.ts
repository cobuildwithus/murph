import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  initializeVault,
  listWriteOperationMetadataPaths,
  pruneTerminalWriteOperationRecords,
  readStoredWriteOperation,
  resolveVaultPath,
  VaultError,
} from "../src/index.ts";
import {
  WriteBatch,
  WRITE_OPERATION_DIRECTORY,
  WRITE_OPERATION_SCHEMA_VERSION,
} from "../src/operations/write-batch.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((directory) =>
      fs.rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

test("pruneTerminalWriteOperationRecords removes only clean committed records covered by a newer checkpoint and retention window", async () => {
  const vaultRoot = await makeVaultRoot();
  const staleCommitted = await createCommittedOperation(vaultRoot, "bank/prune-committed.md");
  const retainedRolledBack = await createRolledBackOperation(vaultRoot, "bank/retain-rolled-back.md");
  const staged = await createStagedOperation(vaultRoot, "bank/retain-staged.md");
  const committing = await createProtectedOperation(vaultRoot, {
    operationId: "op_committing_protected",
    status: "committing",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  const failed = await createProtectedOperation(vaultRoot, {
    operationId: "op_failed_protected",
    status: "failed",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  const recentCommitted = await createCommittedOperation(vaultRoot, "bank/retain-recent.md");
  const uncheckpointedCommitted = await createCommittedOperation(vaultRoot, "bank/retain-uncheckpointed.md");
  const erroredCommitted = await createCommittedOperation(vaultRoot, "bank/retain-error.md");
  const stageResidueCommitted = await createCommittedOperation(vaultRoot, "bank/retain-stage-residue.md");

  await markOperationUpdatedAt(vaultRoot, staleCommitted.metadataRelativePath, "2026-06-01T00:00:00.000Z");
  await markOperationUpdatedAt(vaultRoot, retainedRolledBack.metadataRelativePath, "2026-06-01T00:00:00.000Z");
  await markOperationUpdatedAt(vaultRoot, staged.metadataRelativePath, "2026-06-01T00:00:00.000Z");
  await markOperationUpdatedAt(vaultRoot, recentCommitted.metadataRelativePath, "2026-06-21T06:00:00.000Z");
  await markOperationUpdatedAt(vaultRoot, uncheckpointedCommitted.metadataRelativePath, "2026-06-21T13:00:00.000Z");
  await markOperation(vaultRoot, erroredCommitted.metadataRelativePath, {
    error: { message: "hosted canonical persistence failed" },
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  await markOperationUpdatedAt(
    vaultRoot,
    stageResidueCommitted.metadataRelativePath,
    "2026-06-01T00:00:00.000Z",
  );
  await writeStageResidue(
    vaultRoot,
    stageResidueCommitted.stageRootRelativePath,
    "payloads/residue.txt",
    "leftover\n",
  );

  const result = await pruneTerminalWriteOperationRecords({
    checkpointedAfter: "2026-06-21T12:00:00.000Z",
    now: "2026-06-22T00:00:00.000Z",
    retainedOperationCount: 0,
    vaultRoot,
  });

  assert.equal(result.scannedCount, 9);
  assert.equal(result.prunedCount, 1);
  assert.equal(result.prunedFileCount, 1);
  assert.equal(result.prunedByteCount > 0, true);
  assert.equal(result.retainedProtectedCount, 4);
  assert.equal(result.retainedErroredTerminalCount, 1);
  assert.equal(result.retainedNewestTerminalCount, 0);
  assert.equal(result.retainedRecentTerminalCount, 1);
  assert.equal(result.retainedStageDirectoryCount, 1);
  assert.equal(result.retainedUncheckpointedTerminalCount, 1);
  assert.equal(result.invalidCount, 0);

  await assertMissing(vaultRoot, staleCommitted.metadataRelativePath);
  await assertMissing(vaultRoot, staleCommitted.stageRootRelativePath);
  assert.equal(
    await fs.readFile(resolveVaultPath(vaultRoot, "bank/prune-committed.md").absolutePath, "utf8"),
    "committed\n",
  );
  await assertPresent(vaultRoot, retainedRolledBack.metadataRelativePath);
  await assertPresent(vaultRoot, staged.metadataRelativePath);
  await assertPresent(vaultRoot, staged.stageRootRelativePath);
  await assertPresent(vaultRoot, committing.metadataRelativePath);
  await assertPresent(vaultRoot, failed.metadataRelativePath);
  await assertPresent(vaultRoot, recentCommitted.metadataRelativePath);
  await assertPresent(vaultRoot, uncheckpointedCommitted.metadataRelativePath);
  await assertPresent(vaultRoot, erroredCommitted.metadataRelativePath);
  await assertPresent(vaultRoot, stageResidueCommitted.metadataRelativePath);
  await assertPresent(vaultRoot, stageResidueCommitted.stageRootRelativePath);

  assert.deepEqual((await listWriteOperationMetadataPaths(vaultRoot)).sort(), [
    committing.metadataRelativePath,
    erroredCommitted.metadataRelativePath,
    failed.metadataRelativePath,
    recentCommitted.metadataRelativePath,
    retainedRolledBack.metadataRelativePath,
    stageResidueCommitted.metadataRelativePath,
    staged.metadataRelativePath,
    uncheckpointedCommitted.metadataRelativePath,
  ].sort());
});

test("pruneTerminalWriteOperationRecords is inert without checkpoint proof and skips malformed records", async () => {
  const vaultRoot = await makeVaultRoot();
  const staleCommitted = await createCommittedOperation(vaultRoot, "bank/retain-without-checkpoint.md");
  await markOperationUpdatedAt(vaultRoot, staleCommitted.metadataRelativePath, "2026-06-01T00:00:00.000Z");
  await writeMalformedOperation(vaultRoot, "op_malformed", "2026-06-01T00:00:00.000Z");
  await writeWrongSchemaTerminalOperation(vaultRoot, "op_wrong_schema", "2026-06-01T00:00:00.000Z");

  assert.deepEqual(await pruneTerminalWriteOperationRecords({
    checkpointedAfter: null,
    now: "2026-06-22T00:00:00.000Z",
    retainedOperationCount: 0,
    vaultRoot,
  }), {
    invalidCount: 0,
    prunedByteCount: 0,
    prunedCount: 0,
    prunedFileCount: 0,
    retainedErroredTerminalCount: 0,
    retainedNewestTerminalCount: 0,
    retainedProtectedCount: 0,
    retainedRecentTerminalCount: 0,
    retainedStageDirectoryCount: 0,
    retainedUncheckpointedTerminalCount: 0,
    scannedCount: 0,
  });

  const result = await pruneTerminalWriteOperationRecords({
    checkpointedAfter: "2026-06-10T00:00:00.000Z",
    now: "2026-06-22T00:00:00.000Z",
    retainedOperationCount: 0,
    vaultRoot,
  });

  assert.equal(result.scannedCount, 3);
  assert.equal(result.prunedCount, 1);
  assert.equal(result.invalidCount, 2);
  await assertMissing(vaultRoot, staleCommitted.metadataRelativePath);
  await assertPresent(vaultRoot, `${WRITE_OPERATION_DIRECTORY}/op_malformed.json`);
  await assertPresent(vaultRoot, `${WRITE_OPERATION_DIRECTORY}/op_wrong_schema.json`);
});

test("pruneTerminalWriteOperationRecords retains the newest clean committed records", async () => {
  const vaultRoot = await makeVaultRoot();
  const operationIds = Array.from({ length: 101 }, (_, index) =>
    `op_clean_committed_${String(index).padStart(3, "0")}`);
  for (const [index, operationId] of operationIds.entries()) {
    await writeCommittedOperationRecord(vaultRoot, {
      operationId,
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, index, 0)).toISOString(),
    });
  }

  const result = await pruneTerminalWriteOperationRecords({
    checkpointedAfter: "2026-06-10T00:00:00.000Z",
    now: "2026-06-22T00:00:00.000Z",
    vaultRoot,
  });

  assert.equal(result.scannedCount, 101);
  assert.equal(result.prunedCount, 1);
  assert.equal(result.retainedNewestTerminalCount, 100);
  assert.equal(result.retainedRecentTerminalCount, 0);
  await assertMissing(vaultRoot, `${WRITE_OPERATION_DIRECTORY}/op_clean_committed_000.json`);
  await assertPresent(vaultRoot, `${WRITE_OPERATION_DIRECTORY}/op_clean_committed_001.json`);
  await assertPresent(vaultRoot, `${WRITE_OPERATION_DIRECTORY}/op_clean_committed_100.json`);
});

test("pruneTerminalWriteOperationRecords rejects symlinked operation directories without deleting external records", async () => {
  const vaultRoot = await makeVaultRoot();
  const externalOperationDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-core-write-operation-prune-external-"),
  );
  tempRoots.push(externalOperationDirectory);
  const operationDirectory = resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath;
  const operationIds = Array.from({ length: 101 }, (_, index) =>
    `op_external_committed_${String(index).padStart(3, "0")}`);

  for (const [index, operationId] of operationIds.entries()) {
    await writeCommittedOperationRecordInDirectory(externalOperationDirectory, {
      operationId,
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, index, 0)).toISOString(),
    });
  }

  await fs.rm(operationDirectory, { force: true, recursive: true });
  await fs.mkdir(path.dirname(operationDirectory), { recursive: true });
  await fs.symlink(externalOperationDirectory, operationDirectory, "dir");

  await assert.rejects(
    () => pruneTerminalWriteOperationRecords({
      checkpointedAfter: "2026-06-10T00:00:00.000Z",
      now: "2026-06-22T00:00:00.000Z",
      vaultRoot,
    }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_PATH_SYMLINK",
  );

  const externalEntries = await fs.readdir(externalOperationDirectory);
  assert.equal(externalEntries.filter((entry) => entry.endsWith(".json")).length, operationIds.length);
  for (const operationId of operationIds) {
    await fs.access(path.join(externalOperationDirectory, `${operationId}.json`));
  }
});

async function makeVaultRoot(): Promise<string> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-core-write-operation-prune-"));
  tempRoots.push(vaultRoot);
  await initializeVault({ vaultRoot });
  await fs.rm(resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath, {
    force: true,
    recursive: true,
  });
  return vaultRoot;
}

async function createCommittedOperation(
  vaultRoot: string,
  targetRelativePath: string,
): Promise<WriteBatch> {
  const batch = await WriteBatch.create({
    operationType: "test_commit",
    summary: `test commit ${targetRelativePath}`,
    vaultRoot,
  });
  await batch.stageTextWrite(targetRelativePath, "committed\n");
  await batch.commit();
  return batch;
}

async function createRolledBackOperation(
  vaultRoot: string,
  targetRelativePath: string,
): Promise<WriteBatch> {
  const batch = await WriteBatch.create({
    operationType: "test_rollback",
    summary: `test rollback ${targetRelativePath}`,
    vaultRoot,
  });
  await batch.stageTextWrite(targetRelativePath, "rolled back\n");
  await batch.rollback();
  return batch;
}

async function createStagedOperation(
  vaultRoot: string,
  targetRelativePath: string,
): Promise<WriteBatch> {
  const batch = await WriteBatch.create({
    operationType: "test_staged",
    summary: `test staged ${targetRelativePath}`,
    vaultRoot,
  });
  await batch.stageTextWrite(targetRelativePath, "staged\n");
  return batch;
}

async function createProtectedOperation(
  vaultRoot: string,
  input: {
    operationId: string;
    status: "committing" | "failed";
    updatedAt: string;
  },
): Promise<{ metadataRelativePath: string }> {
  const metadataRelativePath = `${WRITE_OPERATION_DIRECTORY}/${input.operationId}.json`;
  await fs.mkdir(resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath, {
    recursive: true,
  });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, metadataRelativePath).absolutePath,
    `${JSON.stringify({
      actions: [],
      createdAt: input.updatedAt,
      ...(input.status === "failed"
        ? {
            error: {
              message: "retained failed operation",
            },
          }
        : {}),
      occurredAt: input.updatedAt,
      operationId: input.operationId,
      operationType: `test_${input.status}`,
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      status: input.status,
      summary: `retained ${input.status} operation`,
      updatedAt: input.updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
  return { metadataRelativePath };
}

async function writeMalformedOperation(
  vaultRoot: string,
  operationId: string,
  updatedAt: string,
): Promise<void> {
  const metadataRelativePath = `${WRITE_OPERATION_DIRECTORY}/${operationId}.json`;
  await fs.mkdir(resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath, {
    recursive: true,
  });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, metadataRelativePath).absolutePath,
    `${JSON.stringify({
      actions: [],
      createdAt: updatedAt,
      occurredAt: updatedAt,
      operationId: `${operationId}_mismatch`,
      operationType: "test_malformed",
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      status: "committed",
      summary: "malformed operation",
      updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeWrongSchemaTerminalOperation(
  vaultRoot: string,
  operationId: string,
  updatedAt: string,
): Promise<void> {
  const metadataRelativePath = `${WRITE_OPERATION_DIRECTORY}/${operationId}.json`;
  await fs.mkdir(resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath, {
    recursive: true,
  });
  await fs.writeFile(
    resolveVaultPath(vaultRoot, metadataRelativePath).absolutePath,
    `${JSON.stringify({
      actions: [],
      createdAt: updatedAt,
      occurredAt: updatedAt,
      operationId,
      operationType: "test_malformed_schema",
      schemaVersion: "murph.write-operation.legacy",
      status: "committed",
      summary: "malformed schema operation",
      updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function markOperationUpdatedAt(
  vaultRoot: string,
  metadataRelativePath: string,
  updatedAt: string,
): Promise<void> {
  await markOperation(vaultRoot, metadataRelativePath, { updatedAt });
}

async function markOperation(
  vaultRoot: string,
  metadataRelativePath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const operation = await readStoredWriteOperation(vaultRoot, metadataRelativePath);
  await fs.writeFile(
    resolveVaultPath(vaultRoot, metadataRelativePath).absolutePath,
    `${JSON.stringify({
      ...operation,
      ...patch,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeCommittedOperationRecord(
  vaultRoot: string,
  input: {
    operationId: string;
    updatedAt: string;
  },
): Promise<void> {
  await writeCommittedOperationRecordInDirectory(
    resolveVaultPath(vaultRoot, WRITE_OPERATION_DIRECTORY).absolutePath,
    input,
  );
}

async function writeCommittedOperationRecordInDirectory(
  operationDirectory: string,
  input: {
    operationId: string;
    updatedAt: string;
  },
): Promise<void> {
  await fs.mkdir(operationDirectory, { recursive: true });
  await fs.writeFile(
    path.join(operationDirectory, `${input.operationId}.json`),
    `${JSON.stringify({
      actions: [],
      createdAt: input.updatedAt,
      occurredAt: input.updatedAt,
      operationId: input.operationId,
      operationType: "test_committed",
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      status: "committed",
      summary: "clean committed operation",
      updatedAt: input.updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeStageResidue(
  vaultRoot: string,
  stageRootRelativePath: string,
  residueRelativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = resolveVaultPath(
    vaultRoot,
    path.posix.join(stageRootRelativePath, residueRelativePath),
  ).absolutePath;
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

async function assertPresent(vaultRoot: string, relativePath: string): Promise<void> {
  await fs.access(resolveVaultPath(vaultRoot, relativePath).absolutePath);
}

async function assertMissing(vaultRoot: string, relativePath: string): Promise<void> {
  await assert.rejects(
    () => fs.access(resolveVaultPath(vaultRoot, relativePath).absolutePath),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ENOENT",
  );
}
