import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault, listWriteOperationMetadataPaths, readStoredWriteOperation } from "@murphai/core";

import * as indexSurface from "../src/index.ts";
import * as runtimeSurface from "../src/runtime.ts";
import type { InboundCapture } from "../src/contracts/capture.ts";
import { findStoredCaptureSnapshot } from "../src/indexing/persist.ts";
import { createDeterministicInboxCaptureId } from "../src/shared.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function makeHomeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.homedir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function markInboxCapturePersistOperationInterrupted(vaultRoot: string, capturePath: string): Promise<void> {
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const matchingPath = (
    await Promise.all(
      operationPaths.map(async (relativePath) => ({
        relativePath,
        operation: await readStoredWriteOperation(vaultRoot, relativePath),
      })),
    )
  ).find((entry) => entry.operation.operationType === "inbox_capture_persist")?.relativePath;
  assert.ok(matchingPath);

  const metadataPath = path.join(vaultRoot, matchingPath);
  const rawOperation = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
    operationType: string;
    status: string;
    updatedAt: string;
    actions: Array<Record<string, unknown>>;
  };
  assert.equal(rawOperation.operationType, "inbox_capture_persist");
  const stagedCaptureAction = rawOperation.actions.find(
    (action) =>
      action.kind === "jsonl_append" && action.targetRelativePath === capturePath,
  );
  assert.ok(stagedCaptureAction);
  assert.equal(typeof stagedCaptureAction.stageRelativePath, "string");
  const stagedCapturePath = path.join(
    vaultRoot,
    String(stagedCaptureAction.stageRelativePath),
  );
  await fs.mkdir(path.dirname(stagedCapturePath), { recursive: true });
  await fs.copyFile(path.join(vaultRoot, capturePath), stagedCapturePath);
  rawOperation.status = "committing";
  rawOperation.updatedAt = "2026-03-13T12:33:30.000Z";
  rawOperation.actions = rawOperation.actions.map((action) => {
    if (action.kind !== "jsonl_append" || action.targetRelativePath !== capturePath) {
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

  await fs.writeFile(metadataPath, `${JSON.stringify(rawOperation, null, 2)}\n`, "utf8");
}

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-persist-edge-1",
    accountId: "self",
    thread: {
      id: "chat-persist-edge",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:30:00.000Z",
    receivedAt: "2026-03-13T12:30:05.000Z",
    text: "Persist edge coverage",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

test("runtime barrel keeps the rebuild seam aligned with the package surface", () => {
  assert.equal(runtimeSurface.rebuildRuntimeFromVault, indexSurface.rebuildRuntimeFromVault);
});

test("findStoredCaptureSnapshot resolves canonical ledger records without a raw envelope file", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-find-envelope-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-find-envelope-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "fallback-note.txt", "legacy attachment");
  const inbound = createCapture({
    externalId: "msg-find-envelope-canonical",
    attachments: [
      {
        externalId: "att-find-envelope",
        kind: "document",
        mime: "text/plain",
        originalPath: attachmentPath,
        fileName: "fallback-note.txt",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const persisted = await indexSurface.persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA02",
    input: inbound,
    storedAt: "2026-03-13T12:32:00.000Z",
  });

  await assert.rejects(
    fs.access(path.join(vaultRoot, persisted.stored.sourceDirectory, "envelope.json")),
    (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
  );

  const snapshot = await findStoredCaptureSnapshot({
    vaultRoot,
    inbound,
    captureId,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.captureId, captureId);
  assert.equal(snapshot.stored.captureId, captureId);
  assert.equal(snapshot.stored.attachments[0]?.attachmentId, `att_${captureId}_01`);
  assert.match(snapshot.stored.attachments[0]?.storedPath ?? "", /fallback-note\.txt$/u);
});

test("findStoredCaptureSnapshot recovers the staged canonical record when ledger evidence is missing", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-find-envelope-raw-only-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-find-envelope-raw-only",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const persisted = await indexSurface.persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA03",
    input: inbound,
    storedAt: "2026-03-13T12:33:00.000Z",
  });

  await markInboxCapturePersistOperationInterrupted(vaultRoot, persisted.capture.relativePath);
  await fs.rm(
    path.join(vaultRoot, persisted.capture.relativePath),
    { force: true },
  );

  const snapshot = await findStoredCaptureSnapshot({
    vaultRoot,
    inbound,
    captureId,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.captureId, captureId);
  assert.equal(snapshot.eventId, "evt_01HQW7K0M9N8P7Q6R5S4T3VA03");
  assert.equal(snapshot.stored.sourceDirectory, persisted.stored.sourceDirectory);
});

test("persistCanonicalInboxCapture only stores trusted temp-root attachment files and drops blocked path metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-trusted-attachment-vault");
  const trustedSourceRoot = await makeTempDirectory("murph-inbox-trusted-attachment-source");
  const untrustedSourceRoot = await makeHomeTempDirectory("murph-inbox-untrusted-attachment-source-");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  try {
    const trustedAttachmentPath = await writeExternalFile(
      trustedSourceRoot,
      "trusted-note.txt",
      "trusted attachment",
    );
    const blockedAttachmentPath = await writeExternalFile(
      untrustedSourceRoot,
      "do-not-copy.txt",
      "blocked attachment",
    );
    const trustedDirectoryPath = path.join(trustedSourceRoot, "directory-only");
    await fs.mkdir(trustedDirectoryPath);

    const inbound = createCapture({
      externalId: "msg-trusted-email-attachments",
      attachments: [
        {
          externalId: "att-trusted",
          kind: "document",
          mime: "text/plain",
          originalPath: trustedAttachmentPath,
        },
        {
          externalId: "att-blocked",
          kind: "document",
          mime: "text/plain",
          originalPath: blockedAttachmentPath,
        },
        {
          externalId: "att-directory",
          kind: "document",
          mime: "text/plain",
          originalPath: trustedDirectoryPath,
        },
      ],
    });

    const captureId = createDeterministicInboxCaptureId(inbound);
    const persisted = await indexSurface.persistCanonicalInboxCapture({
      vaultRoot,
      captureId,
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA04",
      input: inbound,
      storedAt: "2026-03-13T12:34:00.000Z",
    });
    const stored = persisted.stored;

    assert.equal(stored.attachments.length, 3);
    const trustedAttachment = stored.attachments[0];
    const blockedAttachment = stored.attachments[1];
    const directoryAttachment = stored.attachments[2];

    assert.ok(trustedAttachment);
    assert.match(trustedAttachment.storedPath ?? "", /trusted-note\.txt$/u);
    assert.equal(trustedAttachment.fileName, "trusted-note.txt");
    assert.notEqual(trustedAttachment.sha256, null);

    assert.ok(blockedAttachment);
    assert.equal(blockedAttachment.storedPath, null);
    assert.equal(blockedAttachment.fileName, undefined);
    assert.equal(blockedAttachment.sha256, null);
    assert.equal(blockedAttachment.originalPath, null);

    assert.ok(directoryAttachment);
    assert.equal(directoryAttachment.storedPath, null);
    assert.equal(directoryAttachment.fileName, undefined);
    assert.equal(directoryAttachment.sha256, null);
    assert.equal(directoryAttachment.originalPath, null);

    const snapshot = await findStoredCaptureSnapshot({
      vaultRoot,
      inbound,
      captureId,
    });
    assert.ok(snapshot);
    assert.equal(snapshot.input.attachments.length, 3);
    assert.equal(snapshot.input.attachments[0]?.originalPath, null);
    assert.equal(snapshot.input.attachments[1]?.originalPath, null);
    assert.equal(snapshot.input.attachments[2]?.originalPath, null);
  } finally {
    await fs.rm(untrustedSourceRoot, { recursive: true, force: true });
  }
});
