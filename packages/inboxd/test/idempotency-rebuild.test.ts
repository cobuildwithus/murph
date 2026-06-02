import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test, vi } from "vitest";

import {
  initializeVault,
  isVaultError,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
} from "@murphai/core";
import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
} from "../src/kernel/sqlite.ts";
import { createInboxPipeline } from "../src/kernel/pipeline.ts";
import {
  findStoredCaptureEnvelope,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
} from "../src/indexing/persist.ts";
import { createDeterministicInboxCaptureId, walkNamedFiles } from "../src/shared.ts";
import type { InboundCapture } from "../src/contracts/capture.ts";

const require = createRequire(import.meta.url);

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-durable-1",
    accountId: "self",
    thread: {
      id: "chat-durable",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:00:00.000Z",
    receivedAt: "2026-03-13T10:00:05.000Z",
    text: "Breakfast sync",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

function countRows(
  databasePath: string,
  table: "attachment_parse_job" | "capture" | "capture_mutation_tombstone",
): number {
  const database = openDatabaseSync(databasePath);

  try {
    const row = database.prepare(`select count(*) as count from ${table}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

async function readJsonlRecordsIfPresent(vaultRoot: string, relativePath: string): Promise<unknown[]> {
  try {
    return await readJsonlRecords({ vaultRoot, relativePath });
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }
}

async function findOperationByType(vaultRoot: string, operationType: string) {
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const operations = await Promise.all(
    operationPaths.map(async (relativePath) => ({
      relativePath,
      operation: await readStoredWriteOperation(vaultRoot, relativePath),
    })),
  );
  return operations.find((entry) => entry.operation.operationType === operationType) ?? null;
}

async function removeInboxCaptureLedgerForOccurredAt(vaultRoot: string, occurredAt: string): Promise<void> {
  await fs.rm(
    path.join(
      vaultRoot,
      "ledger",
      "inbox-captures",
      occurredAt.slice(0, 4),
      `${occurredAt.slice(0, 7)}.jsonl`,
    ),
    { force: true },
  );
}

async function markInboxCapturePersistOperationInterrupted(input: {
  vaultRoot: string;
  capturePath: string;
}): Promise<void> {
  const operationPaths = await listWriteOperationMetadataPaths(input.vaultRoot);
  const operations = await Promise.all(
    operationPaths.map(async (relativePath) => ({
      relativePath,
      operation: await readStoredWriteOperation(input.vaultRoot, relativePath),
    })),
  );
  const persistedOperation = operations.find(
    (entry) =>
      entry.operation.operationType === "inbox_capture_persist" &&
      entry.operation.actions.some(
        (action) =>
          action.kind === "jsonl_append" &&
          action.targetRelativePath === input.capturePath,
      ),
  ) ?? null;
  assert.ok(persistedOperation);

  const operationAbsolutePath = path.join(input.vaultRoot, persistedOperation.relativePath);
  const rawOperation = JSON.parse(await fs.readFile(operationAbsolutePath, "utf8")) as {
    status: string;
    updatedAt: string;
    actions: Array<Record<string, unknown>>;
  };
  rawOperation.status = "committing";
  rawOperation.updatedAt = "2026-03-13T10:01:30.000Z";
  rawOperation.actions = rawOperation.actions.map((action) => {
    if (action.kind !== "jsonl_append" || action.targetRelativePath !== input.capturePath) {
      return action;
    }

    return {
      ...action,
      state: "staged",
      effect: undefined,
      existedBefore: undefined,
      originalSize: undefined,
      committedPayloadReceipt: undefined,
      appliedAt: undefined,
    };
  });

  await fs.writeFile(operationAbsolutePath, `${JSON.stringify(rawOperation, null, 2)}\n`, "utf8");
}

test("processCapture recovers from a crash after raw inbox evidence is written but before the canonical ledger append", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-idempotent-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-idempotent-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "receipt.txt", "attachment");
  const inbound = createCapture({
    attachments: [
      {
        externalId: "att-1",
        kind: "document",
        originalPath: attachmentPath,
        fileName: "receipt.txt",
      },
    ],
    raw: {
      externalPath: "/tmp/inbox-source/capture.sqlite",
    },
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1";
  const runtime = await openInboxRuntime({ vaultRoot });

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:01:00.000Z",
  });
  await removeInboxCaptureLedgerForOccurredAt(vaultRoot, inbound.occurredAt);
  await markInboxCapturePersistOperationInterrupted({
    vaultRoot,
    capturePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });

  assert.equal(runtime.findByExternalId(inbound.source, inbound.accountId, inbound.externalId), null);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl")).length, 0);

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const replayed = await pipeline.processCapture(inbound);

  assert.equal(replayed.deduped, true);
  assert.equal(replayed.captureId, captureId);
  assert.equal(replayed.eventId, eventId);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  const envelopeFiles = await walkNamedFiles(path.join(vaultRoot, "raw", "inbox"), "envelope.json", {
    skipDirectories: ["attachments"],
  });
  assert.equal(envelopeFiles.length, 1);

  const captureRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });
  assert.equal(captureRecords.length, 1);
  assert.equal(captureRecords[0]?.captureId, captureId);

  pipeline.close();
});

test("processCapture persists canonical evidence even when a stale projection row already claims the external id", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-stale-dedupe-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-stale-dedupe-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "canonical.pdf", "canonical attachment");
  const inbound = createCapture({
    externalId: "msg-stale-dedupe",
    occurredAt: "2026-03-13T10:12:00.000Z",
    text: "Canonical capture",
    attachments: [
      {
        externalId: "att-stale-dedupe",
        kind: "document",
        mime: "application/pdf",
        originalPath: attachmentPath,
        fileName: "canonical.pdf",
      },
    ],
  });
  const runtime = await openInboxRuntime({ vaultRoot });
  const staleCaptureId = "cap_projection_stale";
  const staleEventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2ST";

  runtime.upsertCaptureIndex({
    captureId: staleCaptureId,
    eventId: staleEventId,
    input: {
      ...inbound,
      text: "stale runtime row",
      attachments: [],
    },
    stored: {
      captureId: staleCaptureId,
      eventId: staleEventId,
      storedAt: "2026-03-13T10:12:30.000Z",
      sourceDirectory: "raw/inbox/email/self/2026/03/cap_projection_stale",
      envelopePath: "raw/inbox/email/self/2026/03/cap_projection_stale/envelope.json",
      attachments: [],
    },
  });

  assert.equal(runtime.findByExternalId(inbound.source, inbound.accountId, inbound.externalId)?.captureId, staleCaptureId);

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const persisted = await pipeline.processCapture(inbound);
  const captureId = createDeterministicInboxCaptureId(inbound);

  assert.equal(persisted.deduped, false);
  assert.equal(persisted.captureId, captureId);
  assert.equal(runtime.getCapture(staleCaptureId), null);
  assert.equal(runtime.getCapture(captureId)?.text, "Canonical capture");
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  assert.equal(runtime.listAttachmentParseJobs({ captureId, limit: 10 }).length, 0);

  const captureRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });
  assert.equal(captureRecords.length, 1);
  assert.equal(captureRecords[0]?.captureId, captureId);

  pipeline.close();
});

test("persistCanonicalInboxCapture stores in-memory attachment bytes without inlining payload receipts into raw actions", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-inline-bytes-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentBytes = Buffer.from("raw-attachment-bytes");
  const inbound = createCapture({
    externalId: "msg-inline-bytes",
    occurredAt: "2026-03-13T10:20:00.000Z",
    attachments: [
      {
        externalId: "att-inline-bytes",
        kind: "document",
        mime: "application/octet-stream",
        data: attachmentBytes,
        fileName: "payload.bin",
        byteSize: attachmentBytes.byteLength + 9,
      },
    ],
    raw: {
      transientPath: "/Users/<REDACTED_USER>/chat-export/photo.jpg",
    },
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2WC";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:21:00.000Z",
  });
  const stored = persisted.stored;

  assert.equal(stored.attachments.length, 1);
  const attachment = stored.attachments[0];
  assert.ok(attachment);
  assert.match(attachment.storedPath ?? "", /attachments\/01__payload\.bin$/u);
  assert.equal(attachment.byteSize, attachmentBytes.byteLength);
  assert.equal(attachment.sha256, createHash("sha256").update(attachmentBytes).digest("hex"));
  assert.equal(attachment.originalPath, null);

  const attachmentAbsolutePath = path.join(vaultRoot, attachment.storedPath ?? "");
  assert.deepEqual(await fs.readFile(attachmentAbsolutePath), attachmentBytes);

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound,
    captureId,
  });
  assert.ok(envelope);
  assert.equal(envelope.input.attachments[0]?.originalPath, null);
  assert.equal(envelope.input.raw?.transientPath, "<REDACTED_PATH>");
  assert.equal(envelope.stored.attachments[0]?.storedPath, attachment.storedPath);
  assert.equal(envelope.stored.attachments[0]?.byteSize, attachmentBytes.byteLength);

  const persistOperation = await findOperationByType(vaultRoot, "inbox_capture_persist");
  assert.ok(persistOperation);
  assert.equal(persistOperation.operation.status, "committed");
  assert.equal(
    persistOperation.operation.actions.filter((action) => action.kind === "raw_copy").length,
    2,
  );
  for (const action of persistOperation.operation.actions) {
    if (action.kind !== "raw_copy") {
      continue;
    }

    assert.equal("committedPayloadReceipt" in action, false);
  }
});

test("persistCanonicalInboxCapture snapshots file-backed attachment bytes before staging and stores measured size", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-file-snapshot-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-file-snapshot-source");
  const originalBytes = Buffer.from("original attachment bytes");
  const mutatedBytes = Buffer.from("mutated attachment bytes after metadata");
  const sourcePath = path.join(sourceRoot, "snapshot.txt");
  await fs.writeFile(sourcePath, originalBytes);

  vi.resetModules();
  vi.doMock("@murphai/core", async () => {
    const actual = await vi.importActual<typeof import("@murphai/core")>("@murphai/core");
    let mutated = false;

    return {
      ...actual,
      applyCanonicalWriteBatch: async (
        input: Parameters<typeof actual.applyCanonicalWriteBatch>[0],
      ) => {
        if (!mutated) {
          mutated = true;
          await fs.writeFile(sourcePath, mutatedBytes);
        }

        return await actual.applyCanonicalWriteBatch(input);
      },
    };
  });

  try {
    const core = await import("@murphai/core");
    const persistSurface = await import("../src/indexing/persist.ts");
    await core.initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

    const inbound = createCapture({
      externalId: "msg-file-snapshot",
      occurredAt: "2026-03-13T10:24:00.000Z",
      attachments: [
        {
          externalId: "att-file-snapshot",
          kind: "document",
          mime: "text/plain",
          originalPath: sourcePath,
          fileName: "snapshot.txt",
          byteSize: originalBytes.byteLength + 99,
        },
      ],
    });
    const captureId = createDeterministicInboxCaptureId(inbound);

    const persisted = await persistSurface.persistCanonicalInboxCapture({
      vaultRoot,
      captureId,
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WD",
      input: inbound,
      storedAt: "2026-03-13T10:25:00.000Z",
    });
    const attachment = persisted.stored.attachments[0];

    assert.ok(attachment);
    assert.equal(attachment.byteSize, originalBytes.byteLength);
    assert.equal(attachment.sha256, createHash("sha256").update(originalBytes).digest("hex"));

    const storedBytes = await fs.readFile(path.join(vaultRoot, attachment.storedPath ?? ""));
    assert.deepEqual(storedBytes, originalBytes);

    const envelope = await persistSurface.findStoredCaptureEnvelope({
      vaultRoot,
      inbound,
      captureId,
    });
    assert.ok(envelope);
    assert.equal(envelope.stored.attachments[0]?.byteSize, originalBytes.byteLength);
    assert.equal(
      envelope.stored.attachments[0]?.sha256,
      createHash("sha256").update(originalBytes).digest("hex"),
    );

    assert.deepEqual(await fs.readFile(sourcePath), mutatedBytes);
  } finally {
    vi.doUnmock("@murphai/core");
    vi.resetModules();
  }
});

test("processCapture keeps importing a capture when one local attachment file disappears before persistence", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-missing-attachment-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-missing-attachment-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const keptAttachmentPath = await writeExternalFile(sourceRoot, "kept.pdf", "kept");
  const missingAttachmentPath = path.join(sourceRoot, "missing.pdf");
  const inbound = createCapture({
    externalId: "msg-missing-attachment",
    occurredAt: "2026-03-13T10:47:00.000Z",
    attachments: [
      {
        externalId: "att-kept",
        kind: "document",
        mime: "application/pdf",
        originalPath: keptAttachmentPath,
        fileName: "kept.pdf",
      },
      {
        externalId: "att-missing",
        kind: "document",
        mime: "application/pdf",
        originalPath: missingAttachmentPath,
        fileName: "missing.pdf",
      },
    ],
  });
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const persisted = await pipeline.processCapture(inbound);
  const capture = runtime.getCapture(persisted.captureId);

  assert.ok(capture);
  assert.equal(capture.attachments.length, 2);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  const keptAttachment = capture.attachments.find(
    (attachment) => attachment.externalId === "att-kept",
  );
  assert.ok(keptAttachment);
  assert.match(keptAttachment.storedPath ?? "", /kept\.pdf$/u);
  assert.notEqual(keptAttachment.sha256, null);

  const missingAttachment = capture.attachments.find(
    (attachment) => attachment.externalId === "att-missing",
  );
  assert.ok(missingAttachment);
  assert.equal(missingAttachment.storedPath, null);
  assert.equal(missingAttachment.sha256, null);
  assert.equal(missingAttachment.originalPath, null);

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound,
    captureId: persisted.captureId,
  });
  assert.ok(envelope);
  const storedMissingAttachment = envelope.stored.attachments.find(
    (attachment) => attachment.externalId === "att-missing",
  );
  assert.ok(storedMissingAttachment);
  assert.equal(storedMissingAttachment.storedPath, null);
  assert.equal(storedMissingAttachment.sha256, null);
  assert.equal(storedMissingAttachment.originalPath, null);

  pipeline.close();
});

test("rebuildRuntimeFromVault restores canonical captures and remains idempotent across repeated runs", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-rebuild-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "photo.pdf", "document");
  const inbound = createCapture({
    externalId: "msg-rebuild-1",
    occurredAt: "2026-03-13T11:00:00.000Z",
    text: "Rebuild me once",
    attachments: [
      {
        externalId: "att-rebuild",
        kind: "document",
        mime: "application/pdf",
        originalPath: attachmentPath,
        fileName: "photo.pdf",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W2",
    input: inbound,
    storedAt: "2026-03-13T11:01:00.000Z",
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const capture = runtime.getCapture(captureId);
  assert.ok(capture);
  assert.equal(capture.text, "Rebuild me once");
  assert.equal(capture.attachments.length, 1);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl")).length, 1);

  runtime.close();
});

test("rebuildRuntimeFromVault restores deterministic raw inbox envelopes that are missing canonical inbox-capture records", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-raw-only-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const sourceRoot = await makeTempDirectory("murph-inbox-raw-only-source");

  const inbound = createCapture({
    externalId: "msg-raw-only-current",
    occurredAt: "2026-03-13T11:05:00.000Z",
    text: "Current raw-only capture",
    attachments: [
      {
        externalId: "att-raw-only",
        kind: "document",
        mime: "text/plain",
        originalPath: await writeExternalFile(sourceRoot, "raw-only.txt", "current attachment"),
        fileName: "raw-only.txt",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W9",
    input: inbound,
    storedAt: "2026-03-13T11:06:00.000Z",
  });
  await removeInboxCaptureLedgerForOccurredAt(vaultRoot, inbound.occurredAt);
  await markInboxCapturePersistOperationInterrupted({
    vaultRoot,
    capturePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const capture = runtime.getCapture(captureId);
  assert.ok(capture);
  assert.equal(capture.text, "Current raw-only capture");
  assert.equal(capture.attachments.length, 1);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl")).length, 1);

  runtime.close();
});

test("rebuildRuntimeFromVault replaces stale runtime projection rows, resets parser state, and preserves cursors", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-reset-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-rebuild-reset-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const documentPath = await writeExternalFile(sourceRoot, "rebuild-reset.m4a", "authoritative audio");
  const inbound = createCapture({
    externalId: "msg-rebuild-reset",
    occurredAt: "2026-03-13T11:07:00.000Z",
    text: "Authoritative capture",
    attachments: [
      {
        externalId: "att-rebuild-reset",
        kind: "audio",
        mime: "audio/mp4",
        originalPath: documentPath,
        fileName: "rebuild-reset.m4a",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2RB";
  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T11:08:00.000Z",
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  runtime.setCursor("email", "self", { messageId: "msg-rebuild-reset" });
  runtime.upsertCaptureIndex({
    captureId,
    eventId,
    input: inbound,
    stored: persisted.stored,
  });
  runtime.enqueueDerivedJobs({
    captureId,
    stored: persisted.stored,
  });

  const staleJob = runtime.claimNextAttachmentParseJob({ captureId });
  assert.ok(staleJob);
  runtime.completeAttachmentParseJob({
    jobId: staleJob.jobId,
    attempt: staleJob.attempts,
    providerId: "stale-parser",
    resultPath: "derived/inbox/stale-parser.json",
    transcriptText: "Glucose 88 mg/dL",
  });
  assert.equal(runtime.searchCaptures({ text: "glucose", limit: 10 }).length, 1);

  const staleCaptureId = "cap_runtime_projection_stale";
  runtime.upsertCaptureIndex({
    captureId: staleCaptureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2RC",
    input: createCapture({
      externalId: "msg-stale-runtime-projection",
      occurredAt: "2026-03-13T11:06:00.000Z",
      text: "Stale runtime projection row",
    }),
    stored: {
      captureId: staleCaptureId,
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2RC",
      storedAt: "2026-03-13T11:06:30.000Z",
      sourceDirectory: "raw/inbox/email/self/2026/03/cap_runtime_projection_stale",
      envelopePath: "raw/inbox/email/self/2026/03/cap_runtime_projection_stale/envelope.json",
      attachments: [],
    },
  });
  const headBefore = await readInboxCaptureMutationHead(vaultRoot);
  assert.ok(headBefore > 0);
  assert.equal(countRows(runtime.databasePath, "capture"), 2);
  assert.equal(runtime.getCapture(captureId)?.attachments[0]?.parseState, "succeeded");

  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const rebuilt = runtime.getCapture(captureId);
  assert.ok(rebuilt);
  assert.deepEqual(runtime.getCursor("email", "self"), { messageId: "msg-rebuild-reset" });
  assert.equal(runtime.getCapture(staleCaptureId), null);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
  assert.equal(countRows(runtime.databasePath, "capture_mutation_tombstone"), 1);
  assert.equal(rebuilt.attachments[0]?.parseState, "pending");
  assert.equal(rebuilt.attachments[0]?.parserProviderId ?? null, null);
  assert.equal(rebuilt.attachments[0]?.derivedPath ?? null, null);
  assert.equal(rebuilt.attachments[0]?.extractedText ?? null, null);
  assert.equal(rebuilt.attachments[0]?.transcriptText ?? null, null);
  assert.equal(runtime.searchCaptures({ text: "glucose", limit: 10 }).length, 0);

  const headAfter = await readInboxCaptureMutationHead(vaultRoot);
  assert.ok(headAfter > headBefore);
  assert.deepEqual(
    await listInboxCaptureMutations({
      vaultRoot,
      afterCursor: headBefore,
      limit: 10,
    }),
    [
      {
        captureId,
        cursor: headAfter - 1,
      },
      {
        captureId: staleCaptureId,
        cursor: headAfter,
      },
    ],
  );

  runtime.close();
});

test("processCapture reuses raw-only inbox evidence when retry occurredAt drifts to a different shard", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-raw-only-drift-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const sourceRoot = await makeTempDirectory("murph-inbox-raw-only-drift-source");

  const inbound = createCapture({
    externalId: "msg-raw-only-drift",
    occurredAt: "2026-03-13T11:15:00.000Z",
    text: "Raw-only before retry normalization",
    attachments: [
      {
        externalId: "att-raw-only-drift",
        kind: "document",
        mime: "text/plain",
        originalPath: await writeExternalFile(sourceRoot, "raw-only-drift.txt", "original raw-only"),
        fileName: "raw-only-drift.txt",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2WE";
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T11:16:00.000Z",
  });
  await removeInboxCaptureLedgerForOccurredAt(vaultRoot, inbound.occurredAt);
  await markInboxCapturePersistOperationInterrupted({
    vaultRoot,
    capturePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });

  const retryInbound = createCapture({
    ...inbound,
    occurredAt: "2026-04-01T00:15:00.000Z",
    receivedAt: "2026-04-01T00:15:05.000Z",
  });
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const replayed = await pipeline.processCapture(retryInbound);

  assert.equal(replayed.deduped, true);
  assert.equal(replayed.captureId, captureId);
  assert.equal(replayed.eventId, eventId);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  const envelopeFiles = await walkNamedFiles(path.join(vaultRoot, "raw", "inbox"), "envelope.json", {
    skipDirectories: ["attachments"],
  });
  assert.equal(envelopeFiles.length, 1);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl")).length, 1);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-04.jsonl")).length, 0);

  pipeline.close();
});

test("processCapture ignores malformed unrelated recoverable envelopes while reusing matching raw-only evidence", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-raw-only-malformed-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const unrelatedInbound = createCapture({
    externalId: "msg-raw-only-malformed-unrelated",
    occurredAt: "2026-02-13T11:20:00.000Z",
    text: "Broken unrelated raw-only capture",
  });
  const unrelatedCaptureId = createDeterministicInboxCaptureId(unrelatedInbound);
  const unrelatedPersisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: unrelatedCaptureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WF",
    input: unrelatedInbound,
    storedAt: "2026-02-13T11:21:00.000Z",
  });
  await removeInboxCaptureLedgerForOccurredAt(vaultRoot, unrelatedInbound.occurredAt);
  await markInboxCapturePersistOperationInterrupted({
    vaultRoot,
    capturePath: unrelatedPersisted.capture.relativePath,
  });
  await fs.writeFile(
    path.join(vaultRoot, unrelatedPersisted.stored.envelopePath),
    "{\"captureId\":\"broken-unrelated\"}\n",
    "utf8",
  );

  const targetInbound = createCapture({
    externalId: "msg-raw-only-malformed-target",
    occurredAt: "2026-03-13T11:25:00.000Z",
    text: "Valid raw-only capture",
  });
  const targetCaptureId = createDeterministicInboxCaptureId(targetInbound);
  const targetEventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2WG";
  const targetPersisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: targetCaptureId,
    eventId: targetEventId,
    input: targetInbound,
    storedAt: "2026-03-13T11:26:00.000Z",
  });
  await removeInboxCaptureLedgerForOccurredAt(vaultRoot, targetInbound.occurredAt);
  await markInboxCapturePersistOperationInterrupted({
    vaultRoot,
    capturePath: targetPersisted.capture.relativePath,
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const replayed = await pipeline.processCapture(targetInbound);

  assert.equal(replayed.deduped, true);
  assert.equal(replayed.captureId, targetCaptureId);
  assert.equal(replayed.eventId, targetEventId);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(runtime.getCapture(targetCaptureId)?.text, "Valid raw-only capture");

  pipeline.close();
});

test("processCapture backfills missing parse jobs for a recovered capture that already exists in runtime", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-recovered-parse-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-recovered-parse-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "voice-note.m4a", "audio bytes");
  const inbound = createCapture({
    externalId: "msg-recovered-parse",
    occurredAt: "2026-03-13T11:10:00.000Z",
    text: "Recovered parse job",
    attachments: [
      {
        externalId: "att-recovered-audio",
        kind: "audio",
        mime: "audio/mp4",
        originalPath: attachmentPath,
        fileName: "voice-note.m4a",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2WA";
  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T11:11:00.000Z",
  });
  const runtime = await openInboxRuntime({ vaultRoot });
  runtime.upsertCaptureIndex({
    captureId,
    eventId,
    input: inbound,
    stored: persisted.stored,
  });

  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  assert.equal(runtime.getCapture(captureId)?.attachments[0]?.parseState, null);

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const replayed = await pipeline.processCapture(inbound);

  assert.equal(replayed.deduped, true);
  assert.equal(replayed.captureId, captureId);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
  assert.equal(runtime.listAttachmentParseJobs({ limit: 10 })[0]?.state, "pending");
  assert.equal(runtime.getCapture(captureId)?.attachments[0]?.parseState, "pending");

  pipeline.close();
});

test("persistCanonicalInboxCapture rejects attachment writes that traverse vault symlinks", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-symlink-write-vault");
  const outsideRoot = await makeTempDirectory("murph-inbox-symlink-write-outside");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    attachments: [
      {
        externalId: "att-symlink-write",
        kind: "document",
        data: Buffer.from("unsafe write"),
        fileName: "unsafe.txt",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  await fs.mkdir(path.join(vaultRoot, "raw", "inbox", "email", "self", "2026"), { recursive: true });
  await fs.symlink(outsideRoot, path.join(vaultRoot, "raw", "inbox", "email", "self", "2026", "03"));

  await assert.rejects(
    () =>
      persistCanonicalInboxCapture({
        vaultRoot,
        captureId,
        eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3",
        input: inbound,
      }),
    (error: unknown) =>
      isVaultError(error) &&
      error.code === "VAULT_PATH_SYMLINK" &&
      error.message === "Vault paths may not traverse symbolic links.",
  );

  assert.deepEqual(await fs.readdir(outsideRoot), []);
});

test("openInboxRuntime rejects runtime rows missing canonical attachment ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const databasePath = resolveRuntimePaths(vaultRoot).inboxDbPath;
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const database = openDatabaseSync(databasePath);

  try {
    database.exec(`
      create table if not exists capture (
        capture_id text primary key,
        source text not null,
        account_id text not null default '',
        external_id text not null,
        thread_id text not null,
        thread_title text,
        thread_is_direct integer not null,
        actor_id text,
        actor_name text,
        actor_is_self integer not null,
        occurred_at text not null,
        received_at text,
        text_content text,
        raw_json text not null,
        vault_event_id text not null,
        envelope_path text not null,
        created_at text not null,
        mutation_cursor integer not null default 0,
        unique (source, account_id, external_id)
      );

      create table if not exists capture_attachment (
        id integer primary key autoincrement,
        capture_id text not null references capture(capture_id) on delete cascade,
        attachment_id text,
        ordinal integer not null,
        external_id text,
        kind text not null,
        mime text,
        original_path text,
        stored_path text,
        file_name text,
        sha256 text,
        size_bytes integer,
        extracted_text text,
        transcript_text text,
        derived_path text,
        parser_provider_id text,
        parser_state text,
        parse_updated_at text,
        created_at text not null
      );
    `);

    database
      .prepare(
        `
          insert into capture (
            capture_id,
            source,
            account_id,
            external_id,
            thread_id,
            thread_title,
            thread_is_direct,
            actor_id,
            actor_name,
            actor_is_self,
            occurred_at,
            received_at,
            text_content,
            raw_json,
            vault_event_id,
            envelope_path,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "cap_legacy_attach",
        "email",
        "self",
        "msg-legacy-attachment-row",
        "thread-legacy",
        null,
        0,
        null,
        null,
        0,
        "2026-03-13T11:30:00.000Z",
        null,
        "legacy row",
        "{}",
        "evt_legacy_attachment_row",
        "raw/inbox/email/self/2026/03/cap_legacy_attach/envelope.json",
        "2026-03-13T11:31:00.000Z",
      );

    database
      .prepare(
        `
          insert into capture_attachment (
            capture_id,
            attachment_id,
            ordinal,
            external_id,
            kind,
            mime,
            original_path,
            stored_path,
            file_name,
            sha256,
            size_bytes,
            extracted_text,
            transcript_text,
            derived_path,
            parser_provider_id,
            parser_state,
            parse_updated_at,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "cap_legacy_attach",
        null,
        1,
        null,
        "document",
        "text/plain",
        null,
        "raw/inbox/email/self/2026/03/cap_legacy_attach/attachments/01__legacy.txt",
        "legacy.txt",
        null,
        6,
        null,
        null,
        null,
        null,
        null,
        null,
        "2026-03-13T11:31:00.000Z",
      );
  } finally {
    database.close();
  }

  await assert.rejects(
    () => openInboxRuntime({ vaultRoot }),
    /Inbox runtime requires canonical attachment metadata; capture_attachment row for capture "cap_legacy_attach" ordinal 1 is missing "attachment_id"\./u,
  );
});

test("rebuildRuntimeFromVault chooses one canonical capture record for duplicate external ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-duplicate-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const canonicalInput = createCapture({
    externalId: "msg-duplicate-1",
    occurredAt: "2026-03-13T12:00:00.000Z",
    text: "canonical envelope",
  });
  const legacyInput = {
    ...canonicalInput,
    text: "legacy duplicate",
  };

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_legacy_duplicate",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3",
    input: legacyInput,
    storedAt: "2026-03-13T12:00:30.000Z",
  });
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: createDeterministicInboxCaptureId(canonicalInput),
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W4",
    input: canonicalInput,
    storedAt: "2026-03-13T12:05:00.000Z",
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const captures = runtime.listCaptures({ limit: 10 });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.captureId, "cap_legacy_duplicate");
  assert.equal(captures[0]?.text, "legacy duplicate");
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  runtime.close();
});

function openDatabaseSync(databasePath: string): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(databasePath);
}
