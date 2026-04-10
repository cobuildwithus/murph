import {
  updateWearablePreferences,
} from "@murphai/core";
import { readPreferencesDocument } from "@murphai/core";
import { type WearablePreferenceProvider } from "@murphai/contracts";

export async function showWearablePreferences(vault: string) {
  const preferences = await readPreferencesDocument(vault);

  return {
    vault,
    preferencesPath: preferences.sourcePath,
    updated: false,
    recordedAt: preferences.updatedAt,
    wearablePreferences: preferences.wearablePreferences,
  };
}

export async function setWearablePreferences(input: {
  vault: string;
  desiredProviders: readonly WearablePreferenceProvider[];
  recordedAt?: string;
}) {
  const updated = await updateWearablePreferences({
    vaultRoot: input.vault,
    updatedAt: input.recordedAt,
    preferences: {
      desiredProviders: [...input.desiredProviders],
    },
  });

  return {
    vault: input.vault,
    preferencesPath: updated.document.sourcePath,
    updated: updated.updated,
    recordedAt: updated.document.updatedAt,
    wearablePreferences: updated.document.wearablePreferences,
  };
}
