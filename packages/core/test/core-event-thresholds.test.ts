import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, test } from "vitest";

import {
  addActivitySession,
  addBodyMeasurement,
  addMeal,
  acquireCanonicalWriteLock,
  applyCanonicalWriteBatch,
  buildActivitySessionEventDraft,
  buildBodyMeasurementEventDraft,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  deleteEvent,
  initializeVault,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
  upsertEvent,
  validateVault,
  VaultError,
} from "../src/index.ts";

const tempRoots: string[] = [];

async function makeTempDirectory(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(directory);
  return directory;
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function withEnvOverride<T>(
  name: string,
  value: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((directory) =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("applyCanonicalWriteBatch records raw contents without receipts and protected deletes with receipts", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-batch");
  const receiptRoot = await makeTempDirectory("murph-core-batch-receipts");
  await initializeVault({ vaultRoot });

  const deletePath = "bank/thresholds/delete-target.md";
  const deleteAbsolutePath = path.join(vaultRoot, deletePath);
  await fs.mkdir(path.dirname(deleteAbsolutePath), { recursive: true });
  await fs.writeFile(deleteAbsolutePath, "delete me\n", "utf8");

  const rawTextPath = "raw/testing/fixed/raw-text.txt";
  const rawBytesPath = "raw/testing/fixed/raw-bytes.bin";

  const result = await withEnvOverride(
    "MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR",
    receiptRoot,
    () =>
      applyCanonicalWriteBatch({
        vaultRoot,
        operationType: "test_raw_content_and_delete_receipt_shapes",
        summary: "stage raw content and a protected delete",
        rawContents: [
          {
            targetRelativePath: rawTextPath,
            content: "raw text\n",
            originalFileName: "raw-text.txt",
            mediaType: "text/plain",
          },
          {
            targetRelativePath: rawBytesPath,
            content: Buffer.from("raw bytes\n", "utf8"),
            originalFileName: "raw-bytes.bin",
            mediaType: "application/octet-stream",
          },
        ],
        deletes: [
          {
            relativePath: deletePath,
          },
        ],
      }),
  );

  assert.deepEqual(result.rawContents, [rawTextPath, rawBytesPath]);
  assert.deepEqual(result.deletes, [deletePath]);
  assert.equal(await fs.readFile(path.join(vaultRoot, rawTextPath), "utf8"), "raw text\n");
  assert.equal((await fs.readFile(path.join(vaultRoot, rawBytesPath))).toString("utf8"), "raw bytes\n");
  await assert.rejects(() => fs.access(deleteAbsolutePath));

  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );
  const operation = operations.find(
    (candidate) => candidate.operationType === "test_raw_content_and_delete_receipt_shapes",
  );

  assert.ok(operation);
  assert.equal(operation.status, "committed");
  assert.equal(operation.actions[0]?.kind, "raw_copy");
  assert.equal("committedPayloadReceipt" in (operation.actions[0] ?? {}), false);
  assert.equal(operation.actions[2]?.kind, "delete");

  const receipt = JSON.parse(
    await fs.readFile(path.join(receiptRoot, `${operation.operationId}.json`), "utf8"),
  ) as {
    actions?: Array<{ kind: string; targetRelativePath: string }>;
  };
  assert.equal(receipt.actions?.length, 1);
  assert.deepEqual(receipt.actions?.[0], {
    kind: "delete",
    targetRelativePath: deletePath,
  });
});

test("validateVault reports stale canonical-write locks", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-stale-lock");
  await initializeVault({ vaultRoot });

  const lock = await acquireCanonicalWriteLock(vaultRoot);
  const host = lock.metadata.host;
  await lock.release();

  await fs.mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "stale-lock-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host,
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
        issue.code === "CANONICAL_WRITE_LOCK_STALE" &&
        issue.path === CANONICAL_WRITE_LOCK_DIRECTORY &&
        issue.severity === "error",
    ),
  );
  assert.ok(validation.issues.some((issue) => issue.message.includes("no longer running")));
});

test("attachment-free and attachment-backed event writes stay honest and deleteEvent retains the backing raw path", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-event-thresholds");
  const sourceRoot = await makeTempDirectory("murph-core-event-thresholds-source");
  await initializeVault({ vaultRoot });

  const activitySession = await addActivitySession({
    vaultRoot,
    draft: buildActivitySessionEventDraft({
      occurredAt: new Date("2026-03-12T08:15:00.000Z"),
      title: "Strength session",
      activityType: "strength-training",
      durationMinutes: 45,
      workout: {
        exercises: [],
      },
    }),
  });

  assert.equal(activitySession.manifestPath, null);
  assert.deepEqual(activitySession.event.attachments ?? [], []);
  assert.deepEqual(activitySession.event.rawRefs ?? [], []);
  assert.deepEqual(activitySession.event.workout.media ?? [], []);

  const photoPath = await writeExternalFile(sourceRoot, "front.jpg", "photo");
  const bodyMeasurement = await addBodyMeasurement({
    vaultRoot,
    draft: buildBodyMeasurementEventDraft({
      occurredAt: new Date("2026-03-12T08:20:00.000Z"),
      title: "Weekly check-in",
      measurements: [
        {
          type: "weight",
          value: 182.4,
          unit: "lb",
        },
      ],
    }),
    attachments: [
      {
        role: "media_1",
        sourcePath: photoPath,
      },
    ],
  });

  const retainedPath = bodyMeasurement.event.attachments?.[0]?.relativePath;

  assert.ok(bodyMeasurement.manifestPath);
  assert.equal(bodyMeasurement.event.attachments?.length, 1);
  assert.equal(bodyMeasurement.event.rawRefs?.includes(retainedPath ?? ""), true);
  assert.equal(bodyMeasurement.event.media?.[0]?.relativePath, retainedPath);
  assert.equal(bodyMeasurement.event.media?.[0]?.kind, "photo");
  assert.ok(retainedPath);

  const deleted = await deleteEvent({
    vaultRoot,
    eventId: bodyMeasurement.event.id,
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.kind, "body_measurement");
  assert.deepEqual(deleted.retainedPaths, [retainedPath]);
});

test("specialized event upserts reject cold writes and permit rewrites against an existing meal event", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-specialized-rewrite");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          kind: "meal",
          occurredAt: "2026-03-14T12:00:00.000Z",
          title: "Rejected meal",
        },
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_KIND_INVALID",
  );

  const meal = await addMeal({
    vaultRoot,
    occurredAt: "2026-03-14T18:30:00.000Z",
    note: "Original dinner",
  });

  const rewritten = await upsertEvent({
    vaultRoot,
    allowSpecializedKindRewrite: true,
    payload: {
      ...meal.event,
      note: "Rewritten dinner",
    },
  });

  const rewrittenRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: meal.eventPath,
  });

  assert.equal(rewritten.created, false);
  assert.equal(rewritten.ledgerFile, meal.eventPath);
  assert.equal(rewrittenRecords.length, 2);
});
