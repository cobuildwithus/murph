import { type WearablePreferenceProvider } from "@murphai/contracts";
import { loadRuntimeModule } from "./runtime-import.js"

interface PreferencesDocument {
  sourcePath: string
  updatedAt: string
  wearablePreferences: {
    desiredProviders?: readonly WearablePreferenceProvider[]
  } | null
}

interface PreferencesCoreRuntime {
  readPreferencesDocument(vaultRoot: string): Promise<PreferencesDocument>
  updateWearablePreferences(input: {
    vaultRoot: string
    updatedAt?: string
    preferences: {
      desiredProviders: WearablePreferenceProvider[]
    }
  }): Promise<{
    updated: boolean
    document: PreferencesDocument
  }>
}

async function loadPreferencesCoreRuntime(): Promise<PreferencesCoreRuntime> {
  return loadRuntimeModule<PreferencesCoreRuntime>("@murphai/core")
}

export async function showWearablePreferences(vault: string) {
  const { readPreferencesDocument } = await loadPreferencesCoreRuntime()
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
  const { updateWearablePreferences } = await loadPreferencesCoreRuntime()
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
