import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { test } from "vitest";

import {
  readCanonicalEntityFamilySource,
  resolveCanonicalEntityInFamily,
} from "../src/vault-source.ts";

test("bounded event-family reads preserve lifecycle, display identity, aliases, and visibility without query.sqlite", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-narrow-event-"));

  try {
    const eventPath = path.posix.join(
      VAULT_LAYOUT.eventLedgerDirectory,
      "2026",
      "2026-08.jsonl",
    );
    await writeVaultFile(
      vaultRoot,
      eventPath,
      [
        {
          id: "evt_document_1",
          kind: "document",
          documentId: "doc_document_1",
          occurredAt: "2026-08-20T10:00:00.000Z",
          recordedAt: "2026-08-20T10:01:00.000Z",
          title: "Original document",
          lifecycle: { revision: 1 },
        },
        {
          id: "evt_document_1",
          kind: "document",
          documentId: "doc_document_1",
          occurredAt: "2026-08-20T10:00:00.000Z",
          recordedAt: "2026-08-20T10:02:00.000Z",
          title: "Revised document",
          lifecycle: { revision: 2 },
        },
        {
          id: "evt_deleted_1",
          kind: "note",
          occurredAt: "2026-08-20T11:00:00.000Z",
          recordedAt: "2026-08-20T11:01:00.000Z",
          title: "Deleted note",
          lifecycle: { revision: 1 },
        },
        {
          id: "evt_deleted_1",
          kind: "note",
          occurredAt: "2026-08-20T11:00:00.000Z",
          recordedAt: "2026-08-20T11:02:00.000Z",
          title: "Deleted note",
          lifecycle: { revision: 2, state: "deleted" },
        },
        {
          id: "evt_hidden_metric_1",
          kind: "observation",
          occurredAt: "2026-08-20T12:00:00.000Z",
          recordedAt: "2026-08-20T12:01:00.000Z",
          title: "Dense metric",
          metric: "heart-rate",
          value: 72,
          unit: "bpm",
        },
        {
          id: "evt_display_metric_1",
          kind: "observation",
          occurredAt: "2026-08-20T13:00:00.000Z",
          recordedAt: "2026-08-20T13:01:00.000Z",
          title: "Display metric",
          metric: "resting-heart-rate",
          value: 58,
          unit: "bpm",
          canonicalFact: true,
        },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    await writeVaultFile(
      vaultRoot,
      path.posix.join(
        VAULT_LAYOUT.assessmentLedgerDirectory,
        "2099",
        "2099-01.jsonl",
      ),
      "{\n",
    );

    const queryDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);
    await assert.rejects(
      () => stat(queryDatabasePath),
      (error): boolean => (error as NodeJS.ErrnoException).code === "ENOENT",
    );

    const entities = await readCanonicalEntityFamilySource(vaultRoot, "event");
    const byOwner = await resolveCanonicalEntityInFamily(
      vaultRoot,
      "event",
      "doc_document_1",
    );
    const byEventId = await resolveCanonicalEntityInFamily(
      vaultRoot,
      "event",
      "evt_document_1",
    );

    assert.equal(byOwner?.entityId, "doc_document_1");
    assert.equal(byEventId?.entityId, "doc_document_1");
    assert.equal(byOwner?.title, "Revised document");
    assert.equal(
      (byOwner?.attributes.lifecycle as { revision?: number } | undefined)?.revision,
      2,
    );
    assert.equal(entities.some((entity) => entity.entityId === "evt_deleted_1"), false);
    assert.equal(entities.some((entity) => entity.entityId === "evt_hidden_metric_1"), false);
    assert.equal(entities.some((entity) => entity.entityId === "evt_display_metric_1"), true);
    await assert.rejects(
      () => stat(queryDatabasePath),
      (error): boolean => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("bounded family reads do not open or replace an existing query.sqlite", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-narrow-sentinel-"));

  try {
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-08-20.md"),
      [
        "---",
        "title: Narrow journal",
        "date: 2026-08-20",
        "---",
        "",
        "Family-local journal body.",
      ].join("\n"),
    );
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2099", "2099-01.jsonl"),
      "{\n",
    );

    const queryDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);
    await mkdir(path.dirname(queryDatabasePath), { recursive: true });
    await writeFile(queryDatabasePath, "query-sentinel\n", "utf8");
    const beforeBytes = await readFile(queryDatabasePath);
    const beforeStat = await stat(queryDatabasePath);

    const journal = await resolveCanonicalEntityInFamily(
      vaultRoot,
      "journal",
      "2026-08-20",
    );

    assert.equal(journal?.entityId, "journal:2026-08-20");
    assert.deepEqual(await readFile(queryDatabasePath), beforeBytes);
    assert.equal((await stat(queryDatabasePath)).mtimeMs, beforeStat.mtimeMs);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}
