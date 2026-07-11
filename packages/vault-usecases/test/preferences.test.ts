import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, test } from "vitest";

import { initializeVault } from "@murphai/core";
import {
  resetAllAssistantPersonalitySettings,
  resetAssistantPersonalitySetting,
  setAssistantPersonalitySetting,
  setWearablePreferences,
  showAssistantPersonality,
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

test("assistant personality usecases expose defaults and preserve explicit default intent", async () => {
  const vaultRoot = await createTempVault();

  const initial = await showAssistantPersonality(vaultRoot);
  assert.deepEqual(initial, {
    vault: vaultRoot,
    preferencesPath: "bank/preferences.json",
    updated: false,
    recordedAt: null,
    settings: {
      humor: { value: 3, source: "default" },
      push: { value: 3, source: "default" },
      detail: { value: 5, source: "default" },
    },
  });

  const explicitlyDefault = await setAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "humor",
    value: 3,
    recordedAt: "2026-07-10T12:00:00.000Z",
  });
  assert.equal(explicitlyDefault.updated, true);
  assert.equal(explicitlyDefault.recordedAt, "2026-07-10T12:00:00.000Z");
  assert.deepEqual(explicitlyDefault.settings.humor, {
    value: 3,
    source: "custom",
  });

  const unchanged = await setAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "humor",
    value: 3,
    recordedAt: "2026-07-10T12:05:00.000Z",
  });
  assert.equal(unchanged.updated, false);
  assert.equal(unchanged.recordedAt, "2026-07-10T12:00:00.000Z");
  assert.deepEqual(unchanged.settings.humor, {
    value: 3,
    source: "custom",
  });
});

test("assistant personality usecases set zero and reset one or all sparse overrides", async () => {
  const vaultRoot = await createTempVault();

  const humor = await setAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "humor",
    value: 0,
    recordedAt: "2026-07-10T13:00:00.000Z",
  });
  assert.deepEqual(humor.settings, {
    humor: { value: 0, source: "custom" },
    push: { value: 3, source: "default" },
    detail: { value: 5, source: "default" },
  });

  const detail = await setAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "detail",
    value: 10,
    recordedAt: "2026-07-10T13:05:00.000Z",
  });
  assert.deepEqual(detail.settings, {
    humor: { value: 0, source: "custom" },
    push: { value: 3, source: "default" },
    detail: { value: 10, source: "custom" },
  });

  const resetHumor = await resetAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "humor",
    recordedAt: "2026-07-10T13:10:00.000Z",
  });
  assert.equal(resetHumor.updated, true);
  assert.deepEqual(resetHumor.settings, {
    humor: { value: 3, source: "default" },
    push: { value: 3, source: "default" },
    detail: { value: 10, source: "custom" },
  });

  const resetAll = await resetAllAssistantPersonalitySettings({
    vault: vaultRoot,
    recordedAt: "2026-07-10T13:15:00.000Z",
  });
  assert.equal(resetAll.updated, true);
  assert.deepEqual(resetAll.settings, {
    humor: { value: 3, source: "default" },
    push: { value: 3, source: "default" },
    detail: { value: 5, source: "default" },
  });

  const unchanged = await resetAllAssistantPersonalitySettings({
    vault: vaultRoot,
    recordedAt: "2026-07-10T13:20:00.000Z",
  });
  assert.equal(unchanged.updated, false);
  assert.equal(unchanged.recordedAt, "2026-07-10T13:15:00.000Z");
});

test("resetting absent assistant personality settings does not create preferences", async () => {
  const vaultRoot = await createTempVault();

  const one = await resetAssistantPersonalitySetting({
    vault: vaultRoot,
    setting: "push",
    recordedAt: "2026-07-10T14:00:00.000Z",
  });
  assert.equal(one.updated, false);
  assert.equal(one.recordedAt, null);

  const all = await resetAllAssistantPersonalitySettings({
    vault: vaultRoot,
    recordedAt: "2026-07-10T14:05:00.000Z",
  });
  assert.equal(all.updated, false);
  assert.equal(all.recordedAt, null);
});
