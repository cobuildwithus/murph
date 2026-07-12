import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  applyCanonicalWriteBatch,
  initializeVault,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
  validateVault,
} from "@murphai/core";

import type { InboundCapture } from "../src/contracts/capture.ts";
import {
  buildInboxCaptureDirectory,
  buildInboxEnvelopePath,
} from "../src/indexing/capture-shape.ts";
import { runInboxEnvelopeMigration } from "../src/indexing/envelope-migration.ts";
import {
  findStoredCaptureSnapshot,
  persistCanonicalInboxCapture,
  readLegacyInboxCaptureRecord,
  rebuildRuntimeFromVault,
} from "../src/indexing/persist.ts";
import { openInboxRuntime } from "../src/kernel/sqlite.ts";
import {
  buildAttachmentId,
  createDeterministicInboxCaptureId,
} from "../src/shared.ts";

const LEDGER_PATH = "ledger/inbox-captures/2026/2026-03.jsonl";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function createLegacyInbound(externalId: string): InboundCapture {
  const attachmentBytes = Buffer.from("legacy attachment evidence");
  return {
    source: "email",
    externalId,
    accountId: "self",
    thread: {
      id: `thread-${externalId}`,
      isDirect: true,
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:30:00.000Z",
    receivedAt: "2026-03-13T12:30:05.000Z",
    text: "Legacy capture metadata",
    attachments: [
      {
        externalId: "att-legacy-document",
        kind: "document",
        mime: "text/plain",
        originalPath: null,
        fileName: "legacy.txt",
        byteSize: attachmentBytes.byteLength,
      },
    ],
    raw: {
      provider: "test",
    },
  };
}

async function createLegacyFixture(input: {
  externalId: string;
  vaultRoot: string;
}): Promise<{
  captureId: string;
  envelope: Record<string, unknown>;
  envelopeContent: string;
  envelopePath: string;
  inbound: InboundCapture;
  sourceDirectory: string;
  storedPath: string;
}> {
  const inbound = createLegacyInbound(input.externalId);
  const captureId = createDeterministicInboxCaptureId(inbound);
  const sourceDirectory = buildInboxCaptureDirectory(inbound, captureId);
  const envelopePath = buildInboxEnvelopePath(inbound, captureId);
  const attachmentBytes = Buffer.from("legacy attachment evidence");
  const storedPath = `${sourceDirectory}/attachments/01__legacy.txt`;
  const eventId = "evt_01HQW7K0M9N8P7Q6R5S4T3VB21";
  const storedAt = "2026-03-13T12:31:00.000Z";
  const envelope = {
    schema: "murph.inbox-envelope.v1",
    captureId,
    eventId,
    storedAt,
    input: inbound,
    stored: {
      captureId,
      eventId,
      storedAt,
      sourceDirectory,
      envelopePath,
      attachments: [
        {
          attachmentId: buildAttachmentId(captureId, 1),
          ordinal: 1,
          externalId: "att-legacy-document",
          kind: "document",
          mime: "text/plain",
          originalPath: null,
          fileName: "legacy.txt",
          byteSize: attachmentBytes.byteLength,
          storedPath,
          sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
        },
      ],
    },
  };
  const envelopeContent = `${JSON.stringify(envelope, null, 2)}\n`;
  await fs.mkdir(path.dirname(path.join(input.vaultRoot, envelopePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(input.vaultRoot, envelopePath), envelopeContent, "utf8");
  await fs.mkdir(path.dirname(path.join(input.vaultRoot, storedPath)), { recursive: true });
  await fs.writeFile(path.join(input.vaultRoot, storedPath), attachmentBytes);

  const legacyRecord = await readLegacyInboxCaptureRecord({
    vaultRoot: input.vaultRoot,
    relativePath: envelopePath,
  });
  assert.ok(legacyRecord);
  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "test_legacy_inbox_fixture",
    summary: "Create a legacy inbox capture fixture.",
    audit: {
      action: "jsonl_append",
      commandName: "test.createLegacyInboxFixture",
      summary: "Created a legacy inbox capture fixture.",
    },
    jsonlAppends: [
      {
        relativePath: LEDGER_PATH,
        record: legacyRecord,
      },
    ],
  });

  return {
    captureId,
    envelope,
    envelopeContent,
    envelopePath,
    inbound,
    sourceDirectory,
    storedPath,
  };
}

test("inbox envelope migration appends v2 and deletes v1 metadata atomically", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-envelope-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const fixture = await createLegacyFixture({
    externalId: "msg-envelope-migration",
    vaultRoot,
  });

  const dryRun = await runInboxEnvelopeMigration({ vaultRoot });
  assert.deepEqual(
    {
      blockerCount: dryRun.blockerCount,
      candidateCount: dryRun.candidateCount,
      deletedCount: dryRun.deletedCount,
      mode: dryRun.mode,
      mutated: dryRun.mutated,
      scannedEnvelopeCount: dryRun.scannedEnvelopeCount,
    },
    {
      blockerCount: 0,
      candidateCount: 1,
      deletedCount: 0,
      mode: "dry-run",
      mutated: false,
      scannedEnvelopeCount: 1,
    },
  );
  assert.equal((await readJsonlRecords({ vaultRoot, relativePath: LEDGER_PATH })).length, 1);
  await fs.access(path.join(vaultRoot, fixture.envelopePath));

  const applied = await runInboxEnvelopeMigration({ apply: true, vaultRoot });
  assert.equal(applied.mutated, true);
  assert.equal(applied.deletedCount, 1);
  assert.equal(applied.deletedBytes, Buffer.byteLength(fixture.envelopeContent));
  await assert.rejects(
    fs.access(path.join(vaultRoot, fixture.envelopePath)),
    (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
  );

  const records = await readJsonlRecords({ vaultRoot, relativePath: LEDGER_PATH });
  assert.equal(records.length, 2);
  assert.equal(records[0]?.schemaVersion, "murph.inbox-capture.v1");
  assert.equal(records[1]?.schemaVersion, "murph.inbox-capture.v2");
  assert.equal(records[1]?.captureId, fixture.captureId);
  assert.equal(records[1]?.sourceDirectory, fixture.sourceDirectory);
  assert.equal(records[1]?.envelopePath, undefined);
  assert.deepEqual(records[1]?.rawRefs, [fixture.storedPath]);
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  const snapshot = await findStoredCaptureSnapshot({
    vaultRoot,
    inbound: fixture.inbound,
    captureId: fixture.captureId,
  });
  assert.ok(snapshot);
  assert.equal(snapshot.stored.sourceDirectory, fixture.sourceDirectory);

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    assert.equal(runtime.listCaptures({ limit: 10 }).length, 1);
    assert.equal(runtime.getCapture(fixture.captureId)?.sourceDirectory, fixture.sourceDirectory);
  } finally {
    runtime.close();
  }

  const rerun = await runInboxEnvelopeMigration({ apply: true, vaultRoot });
  assert.equal(rerun.candidateCount, 0);
  assert.equal(rerun.deletedCount, 0);
  assert.equal(rerun.hasWork, false);
  assert.equal(rerun.mutated, false);
  assert.equal((await readJsonlRecords({ vaultRoot, relativePath: LEDGER_PATH })).length, 2);
});

test("inbox envelope migration bounds each destructive apply pass", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-envelope-migration-bounded");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const first = await createLegacyFixture({
    externalId: "msg-envelope-bounded-a",
    vaultRoot,
  });
  const second = await createLegacyFixture({
    externalId: "msg-envelope-bounded-b",
    vaultRoot,
  });

  const firstPass = await runInboxEnvelopeMigration({
    apply: true,
    maxFiles: 1,
    vaultRoot,
  });
  assert.equal(firstPass.candidateCount, 2);
  assert.equal(firstPass.deletedCount, 1);
  assert.equal(firstPass.hasMore, true);

  const remainingAfterFirstPass = await Promise.all(
    [first.envelopePath, second.envelopePath].map(async (relativePath) => {
      try {
        await fs.access(path.join(vaultRoot, relativePath));
        return relativePath;
      } catch {
        return null;
      }
    }),
  );
  assert.equal(remainingAfterFirstPass.filter(Boolean).length, 1);

  const secondPass = await runInboxEnvelopeMigration({
    apply: true,
    maxFiles: 1,
    vaultRoot,
  });
  assert.equal(secondPass.candidateCount, 1);
  assert.equal(secondPass.deletedCount, 1);
  assert.equal(secondPass.hasMore, false);
  await assert.rejects(fs.access(path.join(vaultRoot, first.envelopePath)));
  await assert.rejects(fs.access(path.join(vaultRoot, second.envelopePath)));
});

test("current v2 attachment directories validate while unowned attachment directories do not", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-current-attachment-owner");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const inbound = createLegacyInbound("msg-current-attachment-owner");
  inbound.attachments = [
    {
      externalId: "att-current-document",
      kind: "document",
      mime: "text/plain",
      fileName: "current.txt",
      data: Buffer.from("current attachment evidence"),
    },
  ];
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: createDeterministicInboxCaptureId(inbound),
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB22",
    input: inbound,
    storedAt: "2026-03-13T12:32:00.000Z",
  });
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  const orphanPath =
    "raw/inbox/email/self/2026/03/cap_orphan/attachments/01__orphan.txt";
  await fs.mkdir(path.dirname(path.join(vaultRoot, orphanPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, orphanPath), "orphan attachment", "utf8");
  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some(
      (issue) =>
        issue.path === "raw/inbox/email/self/2026/03/cap_orphan/envelope.json",
    ),
    true,
  );
});

test("manual v1 envelope deletion remains invalid until the explicit migration adds v2", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-envelope-manual-delete");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const fixture = await createLegacyFixture({
    externalId: "msg-envelope-manual-delete",
    vaultRoot,
  });
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  await fs.rm(path.join(vaultRoot, fixture.envelopePath));
  const afterManualDelete = await validateVault({ vaultRoot });
  assert.equal(afterManualDelete.valid, false);
  assert.equal(
    afterManualDelete.issues.some((issue) => issue.path === fixture.envelopePath),
    true,
  );

  await fs.mkdir(path.dirname(path.join(vaultRoot, fixture.envelopePath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, fixture.envelopePath),
    fixture.envelopeContent,
    "utf8",
  );
  const applied = await runInboxEnvelopeMigration({ apply: true, vaultRoot });
  assert.equal(applied.deletedCount, 1);
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test("inbox envelope migration blocks a mismatched envelope without mutating it", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-envelope-mismatch");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const fixture = await createLegacyFixture({
    externalId: "msg-envelope-mismatch",
    vaultRoot,
  });
  const mismatchedEnvelope = {
    ...fixture.envelope,
    input: {
      ...(fixture.envelope.input as Record<string, unknown>),
      raw: { provider: "different" },
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, fixture.envelopePath),
    `${JSON.stringify(mismatchedEnvelope, null, 2)}\n`,
    "utf8",
  );

  const result = await runInboxEnvelopeMigration({ apply: true, vaultRoot });
  assert.equal(result.blockerCount, 1);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.deletedCount, 0);
  assert.equal(result.mutated, false);
  await fs.access(path.join(vaultRoot, fixture.envelopePath));
  assert.equal((await readJsonlRecords({ vaultRoot, relativePath: LEDGER_PATH })).length, 1);
});

test("inbox envelope migration blocks a nonterminal envelope-delete operation", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-envelope-active-operation");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const fixture = await createLegacyFixture({
    externalId: "msg-envelope-active-operation",
    vaultRoot,
  });
  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "test_interrupted_legacy_envelope_delete",
    summary: "Delete a legacy envelope before simulating an interruption.",
    audit: {
      action: "vault_repair",
      commandName: "test.interruptedLegacyEnvelopeDelete",
      summary: "Deleted a legacy envelope before simulating an interruption.",
    },
    deletes: [
      {
        allowRaw: true,
        expectedTargetReceipt: {
          byteLength: Buffer.byteLength(fixture.envelopeContent),
          sha256: createHash("sha256").update(fixture.envelopeContent).digest("hex"),
        },
        relativePath: fixture.envelopePath,
      },
    ],
  });
  await fs.mkdir(path.dirname(path.join(vaultRoot, fixture.envelopePath)), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(vaultRoot, fixture.envelopePath),
    fixture.envelopeContent,
    "utf8",
  );
  const activeOperationEntry = (
    await Promise.all(
      (await listWriteOperationMetadataPaths(vaultRoot)).map(async (relativePath) => ({
        relativePath,
        operation: await readStoredWriteOperation(vaultRoot, relativePath),
      })),
    )
  ).find(
    (entry) =>
      entry.operation.operationType === "test_interrupted_legacy_envelope_delete",
  );
  assert.ok(activeOperationEntry);
  assert.equal(
    activeOperationEntry.operation.actions.some(
      (action) =>
        action.kind === "delete" && action.targetRelativePath === fixture.envelopePath,
    ),
    true,
  );
  const operationPath = path.join(vaultRoot, activeOperationEntry.relativePath);
  const operation = JSON.parse(await fs.readFile(operationPath, "utf8")) as {
    status: string;
  };
  operation.status = "committing";
  await fs.writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`, "utf8");

  const result = await runInboxEnvelopeMigration({ apply: true, vaultRoot });
  assert.equal(result.activeOperationCount, 1);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.deletedCount, 0);
  assert.equal(result.mutated, false);
  await fs.access(path.join(vaultRoot, fixture.envelopePath));
  const records = await readJsonlRecords({ vaultRoot, relativePath: LEDGER_PATH });
  assert.equal(records.length, 1);
  assert.equal(records.some((record) => record.schemaVersion === "murph.inbox-capture.v2"), false);
});
