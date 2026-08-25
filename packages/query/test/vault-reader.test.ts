import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "@murphai/contracts";
import {
  QUERY_DB_RELATIVE_PATH,
  openSqliteRuntimeDatabase,
} from "@murphai/runtime-state/node";

import { readVault, readVaultRawTolerant, readVaultTolerant } from "../src/model.ts";
import {
  QUERY_PROJECTION_SCHEMA_ID,
  ensureQueryProjectionSchema,
} from "../src/projection/schema.ts";
import { listCanonicalSourceManifest } from "../src/vault-source.ts";

test("readVaultTolerant builds a read model from sparse canonical layouts", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-reader-"));

  try {
    await writeVaultFile(
      vaultRoot,
      VAULT_LAYOUT.metadata,
      JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0C",
        createdAt: "2026-04-20T00:00:00.000Z",
        title: "Tolerant reader vault",
        timezone: "UTC",
      }),
    );
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-20.md"),
      [
        "---",
        "title: Tolerant journal",
        "tags:",
        "  - sleep",
        "---",
        "",
        "Lightweight note.",
      ].join("\n"),
    );
    await writeVaultFile(
      vaultRoot,
      "ledger/events/2026/2026-04.jsonl",
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_dense_device_observation_without_provenance",
        kind: "observation",
        occurredAt: "2026-04-20T08:00:00.000Z",
        recordedAt: "2026-04-20T08:01:00.000Z",
        source: "device",
        title: "Dense heart-rate point",
        metric: "heart-rate",
        unit: "bpm",
        value: 72,
      }),
    );
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.assessmentLedgerDirectory, "2026", "2026-04.jsonl"),
      "{",
    );

    const readModel = await readVaultTolerant(vaultRoot);
    const rawReadModel = await readVaultRawTolerant(vaultRoot);

    assert.equal(readModel.vaultRoot, vaultRoot);
    assert.equal(readModel.metadata?.title, "Tolerant reader vault");
    assert.equal(readModel.journalEntries[0]?.title, "Tolerant journal");
    assert.deepEqual(readModel.byFamily.journal?.map((entry) => entry.entityId), ["journal:2026-04-20"]);
    assert.equal(
      readModel.entities.some((entity) => entity.entityId === "evt_dense_device_observation_without_provenance"),
      false,
    );
    assert.equal(
      rawReadModel.entities.some((entity) => entity.entityId === "evt_dense_device_observation_without_provenance"),
      true,
    );
    await assert.rejects(
      () => stat(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH)),
      (error): boolean => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse JSONL at ledger\/assessments\/2026\/2026-04\.jsonl:1/u,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("readVault invalidates legacy v5 projections before strict reads", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-reader-legacy-"));

  try {
    await writeMinimalVault(vaultRoot);
    const assessmentPath = path.posix.join(
      VAULT_LAYOUT.assessmentLedgerDirectory,
      "2026",
      "2026-04.jsonl",
    );
    await writeVaultFile(vaultRoot, assessmentPath, "0");
    await seedLegacyV5QueryProjection(vaultRoot);

    const absoluteAssessmentPath = path.join(vaultRoot, assessmentPath);
    const before = await stat(absoluteAssessmentPath);
    await writeVaultFile(vaultRoot, assessmentPath, "{");
    await utimes(absoluteAssessmentPath, before.atime, before.mtime);

    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse JSONL at ledger\/assessments\/2026\/2026-04\.jsonl:1/u,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

async function seedLegacyV5QueryProjection(vaultRoot: string): Promise<void> {
  const database = openSqliteRuntimeDatabase(
    path.join(vaultRoot, QUERY_DB_RELATIVE_PATH),
    { create: true },
  );

  try {
    ensureQueryProjectionSchema(database);
    database.exec("PRAGMA user_version = 5;");
    database.prepare(`
      INSERT INTO query_meta (key, value)
      VALUES (?, ?)
    `).run("schema_version", QUERY_PROJECTION_SCHEMA_ID);
    database.prepare(`
      INSERT INTO query_meta (key, value)
      VALUES (?, ?)
    `).run("built_at", "2026-04-20T00:00:00.000Z");
    database.prepare(`
      INSERT INTO query_meta (key, value)
      VALUES (?, ?)
    `).run("metadata_json", "null");

    const insertManifestEntry = database.prepare(`
      INSERT INTO query_source_manifest (
        relative_path,
        size_bytes,
        mtime_ms
      ) VALUES (?, ?, ?)
    `);

    for (const entry of await listCanonicalSourceManifest(vaultRoot)) {
      insertManifestEntry.run(entry.relativePath, entry.sizeBytes, entry.mtimeMs);
    }
  } finally {
    database.close();
  }
}

async function writeMinimalVault(vaultRoot: string): Promise<void> {
  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.metadata,
    JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0D",
      createdAt: "2026-04-20T00:00:00.000Z",
      title: "Strict legacy cache vault",
      timezone: "UTC",
    }),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-20.md"),
    [
      "---",
      "title: Strict legacy cache journal",
      "---",
      "",
      "Lightweight note.",
    ].join("\n"),
  );
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
