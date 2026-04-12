import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import {
  initializeVault,
  readPreferencesDocument,
  resolvePreferencesDocumentPath,
  updateWearablePreferences,
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
  assert.deepEqual(initial.wearablePreferences, {
    desiredProviders: [],
  });
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
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: [],
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

test("rejects legacy preference documents that still carry the removed distance key", async () => {
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

  await assert.rejects(() => readPreferencesDocument(vaultRoot));

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
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
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: [],
  });
});

test("serializes parallel workout unit preference updates against the singleton document", async () => {
  const vaultRoot = await createTempVault();

  await Promise.all([
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:30:00.000Z",
      preferences: {
        weight: "lb",
      },
    }),
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:30:01.000Z",
      preferences: {
        bodyMeasurement: "in",
      },
    }),
  ]);

  const document = await readPreferencesDocument(vaultRoot);
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "lb",
    bodyMeasurement: "in",
  });
});

test("serializes concurrent workout and wearable preference updates through the singleton document", async () => {
  const vaultRoot = await createTempVault();

  await Promise.all([
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:40:00.000Z",
      preferences: {
        weight: "lb",
      },
    }),
    updateWearablePreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:40:01.000Z",
      preferences: {
        desiredProviders: ["whoop", "oura", "whoop"],
      },
    }),
  ]);

  const document = await readPreferencesDocument(vaultRoot);
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "lb",
  });
  assert.deepEqual(document.wearablePreferences, {
    desiredProviders: ["oura", "whoop"],
  });
});

test("reads and writes canonical wearable preferences from the singleton preferences owner", async () => {
  const vaultRoot = await createTempVault();

  const updated = await updateWearablePreferences({
    vaultRoot,
    updatedAt: "2026-04-08T10:00:00.000Z",
    preferences: {
      desiredProviders: ["whoop", "oura", "whoop"],
    },
  });
  assert.equal(updated.created, true);
  assert.equal(updated.updated, true);
  assert.equal(updated.document.exists, true);
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: ["oura", "whoop"],
  });
  assert.deepEqual(updated.document.workoutUnitPreferences, {});

  const serialized = await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8");
  assert.match(serialized, /"desiredProviders": \[/u);
  assert.match(serialized, /"oura"/u);
  assert.match(serialized, /"whoop"/u);

  const noChange = await updateWearablePreferences({
    vaultRoot,
    preferences: {
      desiredProviders: ["oura", "whoop"],
    },
  });
  assert.equal(noChange.created, false);
  assert.equal(noChange.updated, false);
  assert.equal(noChange.document.updatedAt, "2026-04-08T10:00:00.000Z");
});

test("rejects legacy preference documents without wearable preferences", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(() => readPreferencesDocument(vaultRoot));
});

test("rejects future preference schema versions instead of coercing them to the current shape", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
      },
      wearablePreferences: {
        desiredProviders: ["oura"],
      },
      futurePreference: {
        enabled: true,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(() => readPreferencesDocument(vaultRoot));

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
  assert.match(
    validation.issues.map((issue) => issue.message).join("\n"),
    /schemaVersion/u,
  );
});
