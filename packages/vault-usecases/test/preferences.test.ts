import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { initializeVault } from "@murphai/core";
import {
  setWearablePreferences,
  showWearablePreferences,
} from "../src/preferences.ts";

const createdVaultRoots: string[] = [];

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-vault-usecases-preferences-"));
  createdVaultRoots.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Preferences Usecase Test Vault",
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
      }),
    ),
  );
});

test("wearable preference usecases show and set canonical desired providers", async () => {
  const vaultRoot = await createTempVault();

  const initial = await showWearablePreferences(vaultRoot);
  assert.deepEqual(initial.wearablePreferences, {
    desiredProviders: [],
  });
  assert.equal(initial.preferencesPath, "bank/preferences.json");
  assert.equal(initial.recordedAt, null);

  const persistedEmpty = await setWearablePreferences({
    vault: vaultRoot,
    desiredProviders: [],
    recordedAt: "2026-04-09T23:00:00.000Z",
  });
  assert.equal(persistedEmpty.updated, true);
  assert.equal(persistedEmpty.recordedAt, "2026-04-09T23:00:00.000Z");
  assert.deepEqual(persistedEmpty.wearablePreferences, {
    desiredProviders: [],
  });

  const updated = await setWearablePreferences({
    vault: vaultRoot,
    desiredProviders: ["whoop", "garmin", "whoop"],
    recordedAt: "2026-04-10T00:00:00.000Z",
  });
  assert.equal(updated.updated, true);
  assert.equal(updated.recordedAt, "2026-04-10T00:00:00.000Z");
  assert.deepEqual(updated.wearablePreferences, {
    desiredProviders: ["garmin", "whoop"],
  });

  const unchanged = await setWearablePreferences({
    vault: vaultRoot,
    desiredProviders: ["garmin", "whoop"],
  });
  assert.equal(unchanged.updated, false);
  assert.equal(unchanged.recordedAt, "2026-04-10T00:00:00.000Z");

  const cleared = await setWearablePreferences({
    vault: vaultRoot,
    desiredProviders: [],
    recordedAt: "2026-04-10T01:00:00.000Z",
  });
  assert.equal(cleared.updated, true);
  assert.equal(cleared.recordedAt, "2026-04-10T01:00:00.000Z");
  assert.deepEqual(cleared.wearablePreferences, {
    desiredProviders: [],
  });

  const stillEmpty = await setWearablePreferences({
    vault: vaultRoot,
    desiredProviders: [],
  });
  assert.equal(stillEmpty.updated, false);
  assert.equal(stillEmpty.recordedAt, "2026-04-10T01:00:00.000Z");
  assert.deepEqual(stillEmpty.wearablePreferences, {
    desiredProviders: [],
  });
});
