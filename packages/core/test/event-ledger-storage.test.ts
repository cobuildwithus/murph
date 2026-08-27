import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";

import { test } from "vitest";

import {
  applyHostedCanonicalWriteReceipt,
  appendHistoryEvent,
  archiveClosedEventLedgerShards,
  initializeVault,
  listEventLedgerShardSources,
  readEvent,
  readEventLedgerShardRecords,
  readRecoverableStoredWriteOperation,
  readJsonlRecords,
  upsertEvent,
  VaultError,
  withHostedCanonicalWritePort,
} from "../src/index.ts";
import type { HostedCanonicalWritePersistenceInput } from "../src/index.ts";
import { appendArchivedEventLedgerShard } from "../src/event-ledger-storage.ts";
import { WriteBatch } from "../src/operations/write-batch.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("closed event months archive losslessly while the current month stays plain", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-ledger-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });

  const historical = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-01-12T09:00:00.000Z",
      note: "Archived event body.",
      title: "Archived event",
    },
  });
  const current = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-02-02T09:00:00.000Z",
      note: "Current event body.",
      title: "Current event",
    },
  });

  const result = await archiveClosedEventLedgerShards({
    now: new Date("2026-02-15T12:00:00.000Z"),
    vaultRoot,
  });
  assert.equal(result.archivedShardCount, 1);
  assert.equal(result.repairedShardCount, 0);
  await assert.rejects(fs.access(path.join(vaultRoot, historical.ledgerFile)));
  await fs.access(path.join(vaultRoot, `${historical.ledgerFile}.gz`));
  await fs.access(path.join(vaultRoot, current.ledgerFile));
  await assert.rejects(fs.access(path.join(vaultRoot, `${current.ledgerFile}.gz`)));

  const stored = await readEvent({ vaultRoot, eventId: historical.eventId });
  assert.equal(stored.event.title, "Archived event");
  assert.equal(stored.ledgerFile, historical.ledgerFile);
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: historical.ledgerFile })).length,
    1,
  );
});

test("backdated writes and hosted replay amend archived event shards exactly once", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-ledger-amend");
  const replayRoot = await makeTempDirectory("murph-event-ledger-replay");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
  const first = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-01-10T09:00:00.000Z",
      note: "First event body.",
      title: "First event",
    },
  });
  const archivedHistoryId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1D3";
  await appendHistoryEvent({
    vaultRoot,
    eventId: archivedHistoryId,
    kind: "encounter",
    occurredAt: "2026-01-09T09:00:00.000Z",
    title: "Archived visit",
    encounterType: "office_visit",
  });
  await archiveClosedEventLedgerShards({
    now: new Date("2026-02-01T00:00:00.000Z"),
    vaultRoot,
  });
  await assert.rejects(
    appendHistoryEvent({
      vaultRoot,
      eventId: archivedHistoryId,
      kind: "encounter",
      occurredAt: "2026-01-12T09:00:00.000Z",
      title: "Duplicate archived visit",
      encounterType: "office_visit",
    }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_ALREADY_EXISTS",
  );
  await fs.cp(vaultRoot, replayRoot, { recursive: true });

  const capture: { persisted?: HostedCanonicalWritePersistenceInput } = {};
  const second = await withHostedCanonicalWritePort(
    {
      async persistCanonicalWrite(input) {
        capture.persisted = input;
      },
    },
    async () => await upsertEvent({
      vaultRoot,
      payload: {
        kind: "note",
        occurredAt: "2026-01-11T09:00:00.000Z",
        note: "Second event body.",
        title: "Second event",
      },
    }),
  );
  assert.equal(second.ledgerFile, first.ledgerFile);
  const persistedWrite = capture.persisted;
  assert.ok(persistedWrite);
  assert.equal(
    persistedWrite.receipt.actions.some(
      (action) => action.kind === "jsonl_append"
        && action.targetRelativePath === first.ledgerFile
        && action.allowArchivedEventLedgerAmendment === true,
    ),
    true,
  );

  const payloads = new Map(
    persistedWrite.payloads.map((payload) => [payload.sha256, payload.bytes]),
  );
  const applyReplay = async () => await applyHostedCanonicalWriteReceipt({
    vaultRoot: replayRoot,
    receipt: persistedWrite.receipt,
    readPayload: async (ref) => payloads.get(ref.sha256) ?? null,
  });
  await applyReplay();
  await applyReplay();

  for (const root of [vaultRoot, replayRoot]) {
    const records = await readEventLedgerShardRecords({
      vaultRoot: root,
      relativePath: first.ledgerFile,
    });
    assert.equal(records.filter((record) => record.id === second.eventId).length, 1);
    await assert.rejects(fs.access(path.join(root, first.ledgerFile)));
    await fs.access(path.join(root, `${first.ledgerFile}.gz`));
  }
});

test("archived event append resumes exactly once after finalization failure", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-ledger-resume");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
  const event = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-01-05T09:00:00.000Z",
      note: "Stored event body.",
      title: "Stored event",
    },
  });
  await archiveClosedEventLedgerShards({
    now: new Date("2026-02-01T00:00:00.000Z"),
    vaultRoot,
  });

  const appendedId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1D4";
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "event_archive_resume_test",
    summary: "Resume an archived event append.",
  });
  await batch.stageJsonlAppend(
    event.ledgerFile,
    `${JSON.stringify({ id: appendedId, kind: "note" })}\n`,
  );

  const prototype = Object.getPrototypeOf(batch);
  const applyJsonlAppend = Reflect.get(prototype, "applyJsonlAppend");
  const originalPersist = Reflect.get(prototype, "persist");
  const record = Reflect.get(batch, "record");
  const actions = typeof record === "object" && record !== null
    ? Reflect.get(record, "actions")
    : null;
  const action = Array.isArray(actions) ? actions[0] : null;
  if (
    typeof applyJsonlAppend !== "function"
    || typeof originalPersist !== "function"
    || typeof action !== "object"
    || action === null
  ) {
    throw new Error("Expected an archived JSONL append action.");
  }
  let injectedFailure = false;
  Reflect.set(prototype, "persist", async function persistWithFailure(this: object) {
    if (!injectedFailure && Reflect.get(action, "state") === "applied") {
      injectedFailure = true;
      throw new Error("injected archived event finalize failure");
    }
    return await Reflect.apply(originalPersist, this, []);
  });

  try {
    await assert.rejects(
      Reflect.apply(applyJsonlAppend, batch, [action]),
      /injected archived event finalize failure/u,
    );
  } finally {
    Reflect.set(prototype, "persist", originalPersist);
  }

  assert.equal(injectedFailure, true);
  assert.equal(
    (await readEventLedgerShardRecords({
      relativePath: event.ledgerFile,
      vaultRoot,
    })).filter((record) => record.id === appendedId).length,
    1,
  );
  const recoverable = await readRecoverableStoredWriteOperation(
    vaultRoot,
    batch.metadataRelativePath,
  );
  assert.equal(recoverable?.actions[0]?.state, "staged");
  const recoverableAction = recoverable?.actions[0];
  assert.ok(recoverableAction && recoverableAction.kind === "jsonl_append");
  assert.equal(recoverableAction.allowArchivedEventLedgerAmendment, true);

  Reflect.set(action, "state", "staged");
  Reflect.set(action, "appliedAt", undefined);
  await Reflect.apply(applyJsonlAppend, batch, [action]);
  assert.equal(
    (await readEventLedgerShardRecords({
      relativePath: event.ledgerFile,
      vaultRoot,
    })).filter((record) => record.id === appendedId).length,
    1,
  );
});

test("archived event append rolls back when a later action fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-ledger-rollback");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
  const event = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-01-05T09:00:00.000Z",
      note: "Stored event body.",
      title: "Stored event",
    },
  });
  await archiveClosedEventLedgerShards({
    now: new Date("2026-02-01T00:00:00.000Z"),
    vaultRoot,
  });
  const archivePath = path.join(vaultRoot, `${event.ledgerFile}.gz`);
  const originalArchive = await fs.readFile(archivePath);
  const appendedId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1D5";
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "event_archive_rollback_test",
    summary: "Roll back an archived event append.",
  });
  await batch.stageJsonlAppend(
    event.ledgerFile,
    `${JSON.stringify({ id: appendedId, kind: "note" })}\n`,
  );
  await batch.stageTextWrite("CORE.md", "conflicting replacement\n", {
    overwrite: false,
  });

  await assert.rejects(
    batch.commit(),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FILE_EXISTS",
  );
  assert.deepEqual(await fs.readFile(archivePath), originalArchive);
  assert.equal(
    (await readEventLedgerShardRecords({
      relativePath: event.ledgerFile,
      vaultRoot,
    })).some((record) => record.id === appendedId),
    false,
  );
});

test("event ledger readers reject duplicate representations and failed amendments preserve bytes", async () => {
  const vaultRoot = await makeTempDirectory("murph-event-ledger-ambiguous");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
  const event = await upsertEvent({
    vaultRoot,
    payload: {
      kind: "note",
      occurredAt: "2026-01-05T09:00:00.000Z",
      note: "Stored event body.",
      title: "Stored event",
    },
  });
  await archiveClosedEventLedgerShards({
    now: new Date("2026-02-01T00:00:00.000Z"),
    vaultRoot,
  });
  const archivePath = path.join(vaultRoot, `${event.ledgerFile}.gz`);
  const originalArchive = await fs.readFile(archivePath);

  await assert.rejects(
    appendArchivedEventLedgerShard({
      expectedBaseByteLength: gunzipSync(originalArchive).byteLength,
      expectedBaseSha256: "invalid",
      payload: `${JSON.stringify({ id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1D6" })}\n`,
      targetRelativePath: event.ledgerFile,
      vaultRoot,
    }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_LEDGER_ARCHIVE_BASE_MISMATCH",
  );
  assert.deepEqual(await fs.readFile(archivePath), originalArchive);

  await fs.writeFile(path.join(vaultRoot, event.ledgerFile), gunzipSync(originalArchive));
  await assert.rejects(
    listEventLedgerShardSources(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_LEDGER_SHARD_AMBIGUOUS",
  );
  await assert.rejects(
    readEvent({ vaultRoot, eventId: event.eventId }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_LEDGER_SHARD_AMBIGUOUS",
  );
  const repaired = await archiveClosedEventLedgerShards({
    now: new Date("2026-02-01T00:00:00.000Z"),
    vaultRoot,
  });
  assert.equal(repaired.repairedShardCount, 1);
  assert.equal((await readEvent({ vaultRoot, eventId: event.eventId })).eventId, event.eventId);
});
