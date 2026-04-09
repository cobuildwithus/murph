import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import {
  initializeVault,
  readPreferencesDocument,
  resolvePreferencesDocumentPath,
  updateWorkoutUnitPreferences,
  validateVault,
} from "../src/index.ts";

const createdVaultRoots: string[] = [];

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-preferences-"));
  createdVaultRoots.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Preferences Test Vault",
    timezone: "UTC",
  });
  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      })
    ),
  );
});

test("reads and writes canonical workout unit preferences from the singleton preferences owner", async () => {
  const vaultRoot = await createTempVault();

  const initial = await readPreferencesDocument(vaultRoot);
  assert.equal(initial.exists, false);
  assert.deepEqual(initial.workoutUnitPreferences, {});
  assert.equal(initial.updatedAt, null);
  assert.equal(initial.sourcePath, "bank/preferences.json");
  assert.equal(
    resolvePreferencesDocumentPath(vaultRoot),
    path.join(vaultRoot, "bank/preferences.json"),
  );
  assert.equal(
    resolvePreferencesDocumentPath(vaultRoot),
    path.join(vaultRoot, "bank/preferences.json"),
  );

  const updated = await updateWorkoutUnitPreferences({
    vaultRoot,
    updatedAt: "2026-04-08T10:00:00.000Z",
    preferences: {
      weight: "lb",
      bodyMeasurement: "in",
    },
  });
  assert.equal(updated.created, true);
  assert.equal(updated.document.exists, true);
  assert.equal(updated.document.updatedAt, "2026-04-08T10:00:00.000Z");
  assert.deepEqual(updated.document.workoutUnitPreferences, {
    weight: "lb",
    bodyMeasurement: "in",
  });

  const serialized = await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8");
  assert.match(serialized, /"schemaVersion": 1/u);
  assert.match(serialized, /"weight": "lb"/u);

  const noChange = await updateWorkoutUnitPreferences({
    vaultRoot,
    preferences: {
      weight: "lb",
    },
  });
  assert.equal(noChange.created, false);
  assert.equal(noChange.document.updatedAt, "2026-04-08T10:00:00.000Z");

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("reads legacy preference documents that still carry the removed distance key", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
        distance: "mi",
        bodyMeasurement: "cm",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const document = await readPreferencesDocument(vaultRoot);
  assert.equal(document.exists, true);
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "kg",
    bodyMeasurement: "cm",
  });
});

test("defaults updatedAt when writing new preferences without an explicit timestamp", async () => {
  const vaultRoot = await createTempVault();

  const updated = await updateWorkoutUnitPreferences({
    vaultRoot,
    preferences: {
      weight: "kg",
    },
  });

  assert.equal(updated.created, true);
  assert.equal(updated.document.exists, true);
  assert.equal(typeof updated.document.updatedAt, "string");
  assert.deepEqual(updated.document.workoutUnitPreferences, {
    weight: "kg",
  });
});
