import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import { initializeVault, readJsonlRecords } from "@healthybob/core";

import {
  appendImportAudit,
  appendInboxCaptureEvent,
  createInboxPipeline,
  openInboxRuntime,
  persistRawCapture,
  rebuildRuntimeFromVault,
} from "../src/index.js";
import { buildLegacyAttachmentId, createDeterministicInboxCaptureId, walkNamedFiles } from "../src/shared.js";
import type { InboundCapture } from "../src/contracts/capture.js";

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
  const database = new DatabaseSync(databasePath);

  try {
    const row = database.prepare(`select count(*) as count from ${table}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

test("processCapture recovers from a crash after vault persistence without duplicating vault artifacts", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-idempotent-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-idempotent-source");
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

test("rebuildRuntimeFromVault is idempotent across repeated runs", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-rebuild-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-rebuild-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "photo.jpg", "image");
  const inbound = createCapture({
    externalId: "msg-rebuild-1",
    occurredAt: "2026-03-13T11:00:00.000Z",
    text: "Rebuild me once",
    attachments: [
      {
        externalId: "att-rebuild",
        kind: "image",
        mime: "image/jpeg",
        originalPath: attachmentPath,
        fileName: "photo.jpg",
      },
    ],
  });
  const captureId = createDeterministicInboxCaptureId(inbound);

  await persistRawCapture({
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

  runtime.close();
});

test("rebuildRuntimeFromVault backfills legacy attachment ids and keeps parse jobs idempotent", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-legacy-envelope-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-legacy-envelope-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "voice-note.wav", "audio");
  const inbound = createCapture({
    externalId: "msg-legacy-envelope-1",
    occurredAt: "2026-03-13T11:30:00.000Z",
    attachments: [
      {
        externalId: "att-legacy",
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
  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const expectedAttachmentId = buildLegacyAttachmentId(captureId, 1);
  const rebuilt = runtime.getCapture(captureId);
  assert.ok(rebuilt);
  assert.equal(rebuilt.attachments.length, 1);
  assert.equal(rebuilt.attachments[0]?.attachmentId, expectedAttachmentId);

  const firstJobs = runtime.listAttachmentParseJobs({ captureId, limit: 10 });
  assert.equal(firstJobs.length, 1);
  assert.equal(firstJobs[0]?.attachmentId, expectedAttachmentId);
  assert.equal(firstJobs[0]?.state, "pending");

  await rebuildRuntimeFromVault({ vaultRoot, runtime });

  const secondJobs = runtime.listAttachmentParseJobs({ captureId, limit: 10 });
  assert.equal(secondJobs.length, 1);
  assert.equal(secondJobs[0]?.attachmentId, expectedAttachmentId);
  assert.equal(runtime.getCapture(captureId)?.attachments[0]?.attachmentId, expectedAttachmentId);

  runtime.close();
});

test("rebuildRuntimeFromVault chooses one canonical envelope for duplicate external ids", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-duplicate-vault");
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
