import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import {
  initializeVault,
  isVaultError,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
} from "@murph/core";
import { resolveRuntimePaths } from "@murph/runtime-state/node";

import {
  appendImportAudit,
  appendInboxCaptureEvent,
  createInboxPipeline,
  openInboxRuntime,
  persistRawCapture,
  rebuildRuntimeFromVault,
} from "../src/index.ts";
import { findStoredCaptureEnvelope } from "../src/indexing/persist.ts";
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "imessage",
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

function countRows(databasePath: string, table: "attachment_parse_job" | "capture"): number {
  const database = openDatabaseSync(databasePath);

  try {
    const row = database.prepare(`select count(*) as count from ${table}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

async function readEventRecordsForCapture(vaultRoot: string, occurredAt: string) {
  try {
    return await readJsonlRecords({
      vaultRoot,
      relativePath: `ledger/events/${occurredAt.slice(0, 4)}/${occurredAt.slice(0, 7)}.jsonl`,
    });
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }
}

async function readInboxCaptureRecordsForCapture(vaultRoot: string, occurredAt: string) {
  try {
    return await readJsonlRecords({
      vaultRoot,
      relativePath: `ledger/inbox-captures/${occurredAt.slice(0, 4)}/${occurredAt.slice(0, 7)}.jsonl`,
    });
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }
}

async function readImportAuditsForCapture(vaultRoot: string, storedAt: string) {
  let records: unknown[];

  try {
    records = await readJsonlRecords({
      vaultRoot,
      relativePath: `audit/${storedAt.slice(0, 4)}/${storedAt.slice(0, 7)}.jsonl`,
    });
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }

  return records.filter((record) => record.action === "intake_import");
}

async function findOperationByType(vaultRoot: string, operationType: string) {
  const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
  const operations = await Promise.all(
    operationPaths.map((relativePath) => readStoredWriteOperation(vaultRoot, relativePath)),
  );
  return operations.find((operation) => operation.operationType === operationType) ?? null;
}

test("processCapture recovers from a crash after vault persistence without duplicating vault artifacts", async () => {
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
      externalPath: "/tmp/messages/chat.db",
    },
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1";
  const auditId = "aud_01HQW7K0M9N8P7Q6R5S4T3V2W1";
  const runtime = await openInboxRuntime({ vaultRoot });

  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:01:00.000Z",
  });
  const event = await appendInboxCaptureEvent({
    vaultRoot,
    eventId,
    occurredAt: inbound.occurredAt,
    inbound,
    stored,
  });
  await appendImportAudit({
    vaultRoot,
    auditId,
    eventId,
    inbound,
    stored,
    eventPath: event.relativePath,
  });

  assert.equal(runtime.findByExternalId(inbound.source, inbound.accountId, inbound.externalId), null);

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const replayed = await pipeline.processCapture(inbound);

  assert.equal(replayed.deduped, true);
  assert.equal(replayed.captureId, captureId);
  assert.equal(replayed.eventId, eventId);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);

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
  assert.equal(captureRecords[0]?.auditId, auditId);

  const eventRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-03.jsonl",
  });
  assert.equal(eventRecords.length, 1);

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "audit/2026/2026-03.jsonl",
  });
  assert.equal(auditRecords.filter((record) => record.action === "intake_import").length, 1);

  pipeline.close();
});

test("persistRawCapture stores in-memory attachment bytes through audited raw operations without inlining payload metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-inline-bytes-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentBytes = Buffer.from("raw-image-bytes");
  const inbound = createCapture({
    externalId: "msg-inline-bytes",
    occurredAt: "2026-03-13T10:20:00.000Z",
    attachments: [
      {
        externalId: "att-inline-bytes",
        kind: "image",
        mime: "image/jpeg",
        data: attachmentBytes,
        fileName: "photo.jpg",
      },
    ],
    raw: {
      transientPath: "/Users/<REDACTED_USER>/chat-export/photo.jpg",
    },
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2WC";

  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:21:00.000Z",
  });

  assert.equal(stored.attachments.length, 1);
  const attachment = stored.attachments[0];
  assert.ok(attachment);
  assert.match(attachment.storedPath ?? "", /attachments\/01__photo\.jpg$/u);
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

  const rawPersistOperation = await findOperationByType(vaultRoot, "inbox_capture_raw_persist");
  assert.ok(rawPersistOperation);
  assert.equal(rawPersistOperation.status, "committed");
  assert.equal(
    rawPersistOperation.actions.filter((action) => action.kind === "raw_copy").length,
    2,
  );
  for (const action of rawPersistOperation.actions) {
    if (action.kind !== "raw_copy") {
      continue;
    }

    assert.equal("committedPayloadReceipt" in action, false);
  }
});

test("processCapture repairs a raw-only stored envelope by appending missing inbox-capture, event, and audit rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-replay-raw-only-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-replay-raw-only",
    occurredAt: "2026-03-13T10:30:00.000Z",
    text: "Repair raw-only capture",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2W6";
  const runtime = await openInboxRuntime({ vaultRoot });

  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:31:00.000Z",
  });

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const repaired = await pipeline.processCapture(inbound);

  assert.equal(repaired.deduped, true);
  assert.equal(repaired.captureId, captureId);
  assert.equal(repaired.eventId, eventId);
  assert.match(repaired.auditId ?? "", /^aud_/u);
  assert.equal((await readInboxCaptureRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 1);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  const repairOperation = await findOperationByType(vaultRoot, "inbox_capture_canonical_evidence");
  assert.ok(repairOperation);
  assert.equal(repairOperation.status, "committed");
  assert.equal(
    repairOperation.actions.every(
      (action) =>
        action.kind === "jsonl_append" &&
        typeof action.committedPayloadReceipt?.sha256 === "string" &&
        typeof action.committedPayloadReceipt?.byteLength === "number",
    ),
    true,
  );
  assert.equal(
    repairOperation.actions.some((action) => action.targetRelativePath === "ledger/inbox-captures/2026/2026-03.jsonl"),
    true,
  );
  assert.equal(
    repairOperation.actions.some((action) => action.targetRelativePath === "ledger/events/2026/2026-03.jsonl"),
    true,
  );
  assert.equal(
    repairOperation.actions.some((action) => action.targetRelativePath === "audit/2026/2026-03.jsonl"),
    true,
  );

  pipeline.close();
});

test("processCapture repairs a stored envelope when only the audit append was lost", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-replay-missing-audit-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-replay-missing-audit",
    occurredAt: "2026-03-13T10:45:00.000Z",
    text: "Repair missing audit",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2W7";
  const runtime = await openInboxRuntime({ vaultRoot });

  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T10:46:00.000Z",
  });
  await appendInboxCaptureEvent({
    vaultRoot,
    eventId,
    occurredAt: inbound.occurredAt,
    inbound,
    stored,
  });

  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const repaired = await pipeline.processCapture(inbound);

  assert.equal(repaired.deduped, true);
  assert.equal(repaired.captureId, captureId);
  assert.equal(repaired.eventId, eventId);
  assert.match(repaired.auditId ?? "", /^aud_/u);
  assert.equal((await readInboxCaptureRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 1);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);

  pipeline.close();
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
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);

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

test("rebuildRuntimeFromVault repairs raw-only captures and remains idempotent across repeated runs", async () => {
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

  const stored = await persistRawCapture({
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
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
  assert.equal((await readInboxCaptureRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 1);

  runtime.close();
});

test("rebuildRuntimeFromVault canonicalizes safe stored capture ids back to the deterministic runtime id", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-canonicalize-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-rebuild-canonicalize-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "canonicalize.pdf", "document");
  const inbound = createCapture({
    externalId: "msg-rebuild-canonicalize",
    occurredAt: "2026-03-13T11:05:00.000Z",
    text: "Canonicalize my stored id",
    attachments: [
      {
        externalId: "att-canonicalize",
        kind: "document",
        mime: "application/pdf",
        originalPath: attachmentPath,
        fileName: "canonicalize.pdf",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W9",
    input: inbound,
    storedAt: "2026-03-13T11:06:00.000Z",
  });
  const envelopePath = path.join(vaultRoot, stored.envelopePath);
  const envelope = JSON.parse(await fs.readFile(envelopePath, "utf8")) as {
    captureId: string;
    stored: {
      attachments: Array<{ attachmentId: string; ordinal: number }>;
    };
  };
  const legacyCaptureId = "cap_legacysafe";
  envelope.captureId = legacyCaptureId;
  envelope.stored.attachments = envelope.stored.attachments.map((attachment) => ({
    ...attachment,
    attachmentId: `att_${legacyCaptureId}_${String(attachment.ordinal).padStart(2, "0")}`,
  }));
  await fs.writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const capture = runtime.getCapture(captureId);
  assert.ok(capture);
  assert.equal(capture.captureId, captureId);
  assert.equal(runtime.getCapture(legacyCaptureId), null);
  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.attachmentId, `att_${captureId}_01`);
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 1);

  runtime.close();
});

test("rebuildRuntimeFromVault quarantines stored envelopes with malicious capture ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-quarantine-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-rebuild-malicious-id",
    occurredAt: "2026-03-13T11:10:00.000Z",
    text: "Quarantine this stored id",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WA",
    input: inbound,
    storedAt: "2026-03-13T11:11:00.000Z",
  });
  const envelopePath = path.join(vaultRoot, stored.envelopePath);
  const envelope = JSON.parse(await fs.readFile(envelopePath, "utf8")) as {
    captureId: string;
  };
  envelope.captureId = path.posix.join("..", "..", "..", "escaped-capture");
  await fs.writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  assert.equal(runtime.getCapture(captureId), null);
  assert.equal(countRows(runtime.databasePath, "capture"), 0);
  assert.equal((await readInboxCaptureRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 0);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 0);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 0);
  assert.equal(await pathExists(envelopePath), false);
  assert.equal(
    await pathExists(
      path.join(
        path.dirname(envelopePath),
        "envelope.quarantined-invalid-capture-id.json",
      ),
    ),
    true,
  );
  assert.equal(
    await findStoredCaptureEnvelope({
      vaultRoot,
      inbound,
      captureId,
    }),
    null,
  );

  runtime.close();
});

test("persistRawCapture rejects attachment writes that traverse vault symlinks", async () => {
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
  await fs.mkdir(path.join(vaultRoot, "raw", "inbox", "imessage", "self", "2026"), { recursive: true });
  await fs.symlink(outsideRoot, path.join(vaultRoot, "raw", "inbox", "imessage", "self", "2026", "03"));

  await assert.rejects(
    () =>
      persistRawCapture({
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

test("findStoredCaptureEnvelope rejects symlinked envelope files", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-symlink-envelope-vault");
  const outsideRoot = await makeTempDirectory("murph-inbox-symlink-envelope-outside");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-symlink-envelope",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const captureDirectory = path.join(
    vaultRoot,
    "raw",
    "inbox",
    "imessage",
    "self",
    "2026",
    "03",
    captureId,
  );
  const outsideEnvelopePath = path.join(outsideRoot, "envelope.json");
  await fs.mkdir(captureDirectory, { recursive: true });
  await fs.writeFile(outsideEnvelopePath, JSON.stringify({ leaked: true }), "utf8");
  await fs.symlink(outsideEnvelopePath, path.join(captureDirectory, "envelope.json"));

  await assert.rejects(
    () =>
      findStoredCaptureEnvelope({
        vaultRoot,
        inbound,
        captureId,
      }),
    {
      name: "TypeError",
      message: "Vault paths may not traverse symbolic links.",
    },
  );
});

test("rebuildRuntimeFromVault rejects symlinked inbox roots", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-symlink-rebuild-vault");
  const outsideRoot = await makeTempDirectory("murph-inbox-symlink-rebuild-outside");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const runtime = await openInboxRuntime({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, "raw"), { recursive: true });
  await fs.symlink(outsideRoot, path.join(vaultRoot, "raw", "inbox"));

  try {
    await assert.rejects(
      () =>
        rebuildRuntimeFromVault({
          vaultRoot,
          runtime,
        }),
      {
        name: "TypeError",
        message: "Vault paths may not traverse symbolic links.",
      },
    );
  } finally {
    runtime.close();
  }
});

test("rebuildRuntimeFromVault repairs captures missing only the audit record", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-missing-audit-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-rebuild-missing-audit",
    occurredAt: "2026-03-13T11:15:00.000Z",
    text: "Rebuild missing audit",
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3V2W8";
  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId,
    input: inbound,
    storedAt: "2026-03-13T11:16:00.000Z",
  });
  await appendInboxCaptureEvent({
    vaultRoot,
    eventId,
    occurredAt: inbound.occurredAt,
    inbound,
    stored,
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const capture = runtime.getCapture(captureId);
  assert.ok(capture);
  assert.equal(capture.text, "Rebuild missing audit");
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  assert.equal((await readEventRecordsForCapture(vaultRoot, inbound.occurredAt)).length, 1);
  assert.equal((await readImportAuditsForCapture(vaultRoot, stored.storedAt)).length, 1);

  runtime.close();
});

test("rebuildRuntimeFromVault rejects envelopes missing canonical attachment metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-invalid-envelope-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-invalid-envelope-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "voice-note.wav", "audio");
  const inbound = createCapture({
    externalId: "msg-invalid-envelope-1",
    occurredAt: "2026-03-13T11:30:00.000Z",
    attachments: [
      {
        externalId: "att-invalid",
        kind: "audio",
        mime: "audio/wav",
        originalPath: attachmentPath,
        fileName: "voice-note.wav",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);
  const stored = await persistRawCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W5",
    input: inbound,
    storedAt: "2026-03-13T11:31:00.000Z",
  });
  const envelopePath = path.join(vaultRoot, stored.envelopePath);
  const envelope = JSON.parse(await fs.readFile(envelopePath, "utf8")) as {
    stored: {
      attachments: Array<Record<string, unknown>>;
    };
  };
  delete envelope.stored.attachments[0]?.attachmentId;
  delete envelope.stored.attachments[0]?.ordinal;
  await fs.writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const runtime = await openInboxRuntime({ vaultRoot });

  try {
    await assert.rejects(
      () => rebuildRuntimeFromVault({ vaultRoot, runtime }),
      /Missing canonical "attachmentId" in stored inbox envelope at .*envelope\.json at index 0\./u,
    );
    assert.equal(runtime.getCapture(captureId), null);
    assert.equal(countRows(runtime.databasePath, "capture"), 0);
    assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);
  } finally {
    runtime.close();
  }
});

test("openInboxRuntime rejects runtime rows missing canonical attachment ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-legacy-runtime-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const databasePath = resolveRuntimePaths(vaultRoot).inboxDbPath;
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
        "imessage",
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
        "raw/inbox/imessage/self/2026/03/cap_legacy_attach/envelope.json",
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
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "raw/inbox/imessage/self/2026/03/cap_legacy_attach/attachments/01__legacy.txt",
        "legacy.txt",
        null,
        6,
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

test("rebuildRuntimeFromVault chooses one canonical envelope for duplicate external ids", async () => {
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

  await persistRawCapture({
    vaultRoot,
    captureId: "cap_legacy_duplicate",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3",
    input: legacyInput,
    storedAt: "2026-03-13T12:00:30.000Z",
  });
  await persistRawCapture({
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
  assert.equal(captures[0]?.captureId, createDeterministicInboxCaptureId(canonicalInput));
  assert.equal(captures[0]?.text, "canonical envelope");
  assert.equal(countRows(runtime.databasePath, "capture"), 1);
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 0);

  runtime.close();
});

function openDatabaseSync(databasePath: string): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(databasePath);
}
