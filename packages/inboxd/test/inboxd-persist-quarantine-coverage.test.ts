import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import { initializeVault } from "@murphai/core";

import type { InboundCapture } from "../src/contracts/capture.ts";
import { findStoredCaptureEnvelope } from "../src/indexing/persist.ts";
import { createInboxPipeline } from "../src/kernel/pipeline.ts";
import { openInboxRuntime } from "../src/kernel/sqlite.ts";
import { createDeterministicInboxCaptureId } from "../src/shared.ts";
import {
  persistCanonicalInboxCapture,
} from "../src/index.ts";

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-persist-quarantine",
    accountId: "acct",
    thread: {
      id: "thread-1",
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

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("findStoredCaptureEnvelope returns null when no canonical inbox-capture record exists", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-missing-canonical-record");
  const input = createCapture({
    source: "telegram",
    accountId: "telegram-bot",
  });
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: input,
  });

  assert.equal(envelope, null);
});

test("persistCanonicalInboxCapture keeps unresolved attachments unstored instead of failing the capture", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-unstored-attachments");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-unstored-attachments",
    attachments: [
      {
        externalId: "att-empty",
        kind: "document",
        mime: "text/plain",
      },
      {
        externalId: "att-missing-path",
        kind: "document",
        mime: "text/plain",
        originalPath: path.join(vaultRoot, "missing.txt"),
        fileName: "missing.txt",
      },
    ],
  });
  const stored = (
    await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: createDeterministicInboxCaptureId(inbound),
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB01",
      input: inbound,
      storedAt: "2026-03-13T12:45:00.000Z",
    })
  ).stored;

  assert.equal(stored.attachments.length, 2);
  for (const attachment of stored.attachments) {
    assert.equal(attachment.storedPath, null);
    assert.equal(attachment.sha256, null);
    assert.equal(attachment.originalPath, null);
  }
});

test("findStoredCaptureEnvelope scans other canonical ledgers when the expected month has no record", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-canonical-ledger-scan");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const archivedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-02-13T12:30:00.000Z",
  });
  const requestedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-03-13T12:30:00.000Z",
  });
  const requestedCaptureId = createDeterministicInboxCaptureId(requestedCapture);

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_late",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB02",
    input: archivedCapture,
    storedAt: "2026-02-13T12:32:00.000Z",
  });
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_early",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB03",
    input: archivedCapture,
    storedAt: "2026-02-13T12:31:00.000Z",
  });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: requestedCapture,
    captureId: requestedCaptureId,
  });

  assert.ok(envelope);
  assert.equal(envelope.captureId, "cap_canonical_early");
  assert.equal(envelope.eventId, "evt_01HQW7K0M9N8P7Q6R5S4T3VB03");
});

test("expected-shard capture lookup stays idempotent without historical enumeration", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-expected-shard-idempotency");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const inbound = createCapture({ externalId: "msg-expected-shard-idempotency" });
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({
    captureLookupScope: "expected-shard",
    runtime,
    vaultRoot,
  });

  try {
    const first = await pipeline.processCapture(inbound);
    const replay = await pipeline.processCapture(inbound);

    assert.equal(first.deduped, false);
    assert.equal(replay.deduped, true);
    assert.equal(replay.captureId, first.captureId);
    assert.equal(replay.eventId, first.eventId);
  } finally {
    pipeline.close();
  }
});

test("expected-shard canonical replay honors retention when raw bytes still exist", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-expected-shard-retention");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const inbound = createCapture({
    attachments: [
      {
        data: Buffer.from("retained audio bytes"),
        externalId: "att-expected-shard-retention",
        fileName: "voice.m4a",
        kind: "audio",
        mime: "audio/mp4",
      },
    ],
    externalId: "msg-expected-shard-retention",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB05",
    input: inbound,
    storedAt: "2026-03-13T12:31:00.000Z",
  });
  const attachment = persisted.stored.attachments[0];
  assert.ok(attachment?.storedPath);
  assert.ok(attachment.sha256);
  const retentionDirectory = path.join(
    vaultRoot,
    "ledger",
    "inbox-attachment-retention",
    "2026",
  );
  await fs.mkdir(retentionDirectory, { recursive: true });
  await fs.writeFile(
    path.join(retentionDirectory, "2026-04.jsonl"),
    `${JSON.stringify({
      schemaVersion: "murph.inbox-attachment-retention.v1",
      attachmentId: attachment.attachmentId,
      byteSize: attachment.byteSize ?? null,
      captureId,
      captureOccurredAt: inbound.occurredAt,
      fileName: attachment.fileName ?? null,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
      ordinal: attachment.ordinal,
      purgedAt: "2026-04-01T00:00:00.000Z",
      reason: "inbox_media_retention",
      recordedAt: persisted.stored.storedAt,
      sha256: attachment.sha256,
      storedPath: attachment.storedPath,
    })}\n`,
    "utf8",
  );

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound,
    captureId,
    lookupScope: "expected-shard",
  });

  assert.ok(envelope);
  assert.equal(envelope.stored.attachments[0]?.contentStatus, "retention_expired");
  assert.equal(envelope.stored.attachments[0]?.storedPath, null);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, attachment.storedPath)),
    Buffer.from("retained audio bytes"),
  );
});

test("expected-shard lookup recovers the exact envelope without capture, operation, or retention history", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-expected-shard-bounds");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const inbound = createCapture({
    attachments: [
      {
        data: Buffer.from("current attachment bytes"),
        externalId: "att-expected-shard-bounds",
        fileName: "current.txt",
        kind: "document",
        mime: "text/plain",
      },
    ],
    externalId: "msg-expected-shard-bounds",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB04",
    input: inbound,
  });
  const attachment = persisted.stored.attachments[0];
  assert.ok(attachment?.storedPath);
  const attemptDirectory = path.posix.join(
    "derived/inbox",
    captureId,
    "attachments",
    attachment.attachmentId,
    "attempts/0001",
  );
  const plainTextPath = path.posix.join(attemptDirectory, "plain.txt");
  const manifestPath = path.posix.join(attemptDirectory, "manifest.json");
  await fs.mkdir(path.join(vaultRoot, attemptDirectory), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, plainTextPath), "current parser evidence\n", "utf8");
  await fs.writeFile(
    path.join(vaultRoot, manifestPath),
    `${JSON.stringify({
      schema: "murph.parser-manifest.v1",
      providerId: "test-parser",
      createdAt: "2026-03-13T12:31:00.000Z",
      artifact: {
        attachmentId: attachment.attachmentId,
        captureId,
        fileName: "current.txt",
        kind: "document",
        mime: "text/plain",
        storedPath: attachment.storedPath,
      },
      metadata: {},
      paths: {
        chunksPath: null,
        markdownPath: null,
        plainTextPath,
        tablesPath: null,
      },
    })}\n`,
    "utf8",
  );
  await fs.rm(path.join(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl"));

  const walkVaultFiles = vi.fn(async (
    inputVaultRoot: string,
    relativeDirectory: string,
    options?: { extension?: string },
  ) => {
    const actual = await vi.importActual<typeof import("@murphai/core")>("@murphai/core");
    return await actual.walkVaultFiles(inputVaultRoot, relativeDirectory, options);
  });
  const listWriteOperationMetadataPaths = vi.fn(async () => {
    throw new Error("write-operation recovery enumeration is forbidden");
  });
  const listInboxAttachmentRetentionRecords = vi.fn(async () => {
    throw new Error("attachment-retention enumeration is forbidden");
  });
  vi.resetModules();
  vi.doMock("@murphai/core", async () => {
    const actual = await vi.importActual<typeof import("@murphai/core")>("@murphai/core");
    return {
      ...actual,
      listWriteOperationMetadataPaths,
      walkVaultFiles,
    };
  });
  vi.doMock("../src/indexing/retention.js", async () => {
    const actual = await vi.importActual<typeof import("../src/indexing/retention.ts")>(
      "../src/indexing/retention.ts",
    );
    return {
      ...actual,
      listInboxAttachmentRetentionRecords,
    };
  });

  try {
    const boundedPersist = await import("../src/indexing/persist.ts");
    const envelope = await boundedPersist.findStoredCaptureEnvelope({
      vaultRoot,
      inbound,
      captureId,
      lookupScope: "expected-shard",
    });

    assert.ok(envelope);
    assert.equal(envelope.captureId, captureId);
    const projectedAttachment = envelope.stored.attachments[0];
    assert.ok(projectedAttachment);
    assert.equal(projectedAttachment.contentStatus, "available");
    assert.ok("parseState" in projectedAttachment);
    assert.equal(projectedAttachment.parseState, "succeeded");
    assert.ok("extractedText" in projectedAttachment);
    assert.equal(projectedAttachment.extractedText, "current parser evidence");
    assert.deepEqual(
      await fs.readFile(path.join(vaultRoot, attachment.storedPath)),
      Buffer.from("current attachment bytes"),
    );
    await fs.rm(path.join(vaultRoot, attachment.storedPath));
    const missingBytesEnvelope = await boundedPersist.findStoredCaptureEnvelope({
      vaultRoot,
      inbound,
      captureId,
      lookupScope: "expected-shard",
    });
    assert.ok(missingBytesEnvelope);
    const missingBytesAttachment = missingBytesEnvelope.stored.attachments[0];
    assert.ok(missingBytesAttachment);
    assert.equal(missingBytesAttachment.contentStatus, null);
    assert.equal(missingBytesAttachment.storedPath, null);
    assert.ok("parseState" in missingBytesAttachment);
    assert.equal(missingBytesAttachment.parseState, "succeeded");
    assert.ok("extractedText" in missingBytesAttachment);
    assert.equal(missingBytesAttachment.extractedText, "current parser evidence");
    const boundedRuntimeModule = await import("../src/kernel/sqlite.ts");
    const boundedPipelineModule = await import("../src/kernel/pipeline.ts");
    const runtime = await boundedRuntimeModule.openInboxRuntime({ vaultRoot });
    const pipeline = await boundedPipelineModule.createInboxPipeline({
      captureLookupScope: "expected-shard",
      runtime,
      vaultRoot,
    });
    try {
      const replayed = await pipeline.processCapture(inbound);
      assert.equal(replayed.deduped, true);
      const runtimeAttachment = runtime.getCapture(captureId)?.attachments[0];
      assert.ok(runtimeAttachment);
      assert.equal(runtimeAttachment.storedPath, null);
      assert.equal(runtimeAttachment.extractedText, "current parser evidence");
    } finally {
      pipeline.close();
    }
    const freshInbound = createCapture({
      externalId: "msg-expected-shard-fresh-miss",
    });
    assert.equal(await boundedPersist.findStoredCaptureEnvelope({
      vaultRoot,
      inbound: freshInbound,
      captureId: createDeterministicInboxCaptureId(freshInbound),
      lookupScope: "expected-shard",
    }), null);
    assert.deepEqual(
      walkVaultFiles.mock.calls.map((call) => call[1]),
      [
        path.posix.join("derived/inbox", captureId, "attachments", attachment.attachmentId, "attempts"),
        path.posix.join("derived/inbox", captureId, "attachments", attachment.attachmentId, "attempts"),
        path.posix.join("derived/inbox", captureId, "attachments", attachment.attachmentId, "attempts"),
      ],
    );
    assert.equal(listWriteOperationMetadataPaths.mock.calls.length, 0);
    assert.equal(listInboxAttachmentRetentionRecords.mock.calls.length, 0);
  } finally {
    vi.doUnmock("@murphai/core");
    vi.doUnmock("../src/indexing/retention.js");
    vi.resetModules();
  }
});
