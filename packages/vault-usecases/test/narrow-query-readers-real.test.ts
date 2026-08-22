import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import { createExperiment, initializeVault, upsertEvent } from "@murphai/core";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { test } from "vitest";

import { showExperimentRecord } from "../src/usecases/experiment-journal-vault.ts";
import { showWorkoutRecord } from "../src/usecases/workout-read.ts";

test("exact event reads ignore unrelated canonical roots and do not create query.sqlite", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-narrow-event-read-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-08-20T12:00:00.000Z",
      timezone: "UTC",
    });
    const saved = await upsertEvent({
      vaultRoot,
      payload: {
        kind: "activity_session",
        occurredAt: "2026-08-20T13:00:00.000Z",
        title: "Narrow reader workout",
        activityType: "running",
        durationMinutes: 30,
        workout: {
          exercises: [],
        },
      },
    });
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

    const shown = await showWorkoutRecord(vaultRoot, saved.eventId);

    assert.equal(shown.entity.id, saved.eventId);
    assert.equal(shown.entity.kind, "activity_session");
    await assert.rejects(
      () => stat(queryDatabasePath),
      (error): boolean => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("experiment id and slug reads stay inside the experiment family and leave query.sqlite untouched", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-narrow-experiment-read-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-08-20T12:00:00.000Z",
      timezone: "UTC",
    });
    const saved = await createExperiment({
      vaultRoot,
      slug: "narrow-reader",
      title: "Narrow Reader",
      startedOn: "2026-08-20",
    });
    await writeVaultFile(
      vaultRoot,
      path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2099", "2099-01.jsonl"),
      "{\n",
    );

    const queryDatabasePath = path.join(vaultRoot, QUERY_DB_RELATIVE_PATH);
    await mkdir(path.dirname(queryDatabasePath), { recursive: true });
    await writeFile(queryDatabasePath, "narrow-reader-sentinel\n", "utf8");
    const beforeBytes = await readFile(queryDatabasePath);
    const beforeStat = await stat(queryDatabasePath);

    const byId = await showExperimentRecord(vaultRoot, saved.experiment.id);
    const bySlug = await showExperimentRecord(vaultRoot, saved.experiment.slug);

    assert.equal(byId.entity.id, saved.experiment.id);
    assert.equal(bySlug.entity.id, saved.experiment.id);
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
