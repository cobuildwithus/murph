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
} from "@murphai/core";
import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import {
  createInboxPipeline,
  openInboxRuntime,
  persistCanonicalInboxCapture,
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

function countRows(databasePath: string, table: "attachment_parse_job" | "capture"): number {
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
  const persistedOperation = await findOperationByType(input.vaultRoot, "inbox_capture_persist");
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

  pipeline.close();
});

test("persistCanonicalInboxCapture stores in-memory attachment bytes without inlining payload receipts into raw actions", async () => {
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
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
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
  assert.equal(countRows(runtime.databasePath, "attachment_parse_job"), 1);
  assert.equal((await readJsonlRecordsIfPresent(vaultRoot, "ledger/inbox-captures/2026/2026-03.jsonl")).length, 1);

  runtime.close();
});

test("processCapture backfills missing parse jobs for a recovered capture that already exists in runtime", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-recovered-parse-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-recovered-parse-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "barcode.png", "image-bytes");
  const inbound = createCapture({
    externalId: "msg-recovered-parse",
    occurredAt: "2026-03-13T11:10:00.000Z",
    text: "Recovered parse job",
    attachments: [
      {
        externalId: "att-recovered-image",
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "barcode.png",
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
