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
import { createDeterministicInboxCaptureId, walkNamedFiles } from "../src/shared.js";
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

function countRows(databasePath: string, table: "capture" | "derived_job"): number {
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
  assert.equal(countRows(runtime.databasePath, "derived_job"), 1);

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
  assert.equal(countRows(runtime.databasePath, "derived_job"), 1);

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
  assert.equal(countRows(runtime.databasePath, "derived_job"), 0);

  runtime.close();
});
