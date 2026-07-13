import {
  assistantPersonalitySettingIds,
  resolveAssistantPersonalityScores,
  type AssistantPersonalityPreferences,
  type AssistantPersonalityScores,
  type AssistantPersonalitySettingId,
  type AssistantPreferences,
  type WearablePreferenceProvider,
  type WearablePreferences,
} from "@murphai/contracts";
import { loadRuntimeModule } from "./runtime-import.js"

interface PreferencesDocument {
  assistant?: AssistantPreferences
  sourcePath: string
  updatedAt: string | null
  wearablePreferences: WearablePreferences
}

interface AssistantPersonalityResult {
  vault: string
  preferencesPath: string
  updated: boolean
  recordedAt: string | null
  settings: Record<
    AssistantPersonalitySettingId,
    {
      value: AssistantPersonalityScore
      source: "custom" | "default"
    }
  >
}

type AssistantPersonalityScore =
  AssistantPersonalityScores[AssistantPersonalitySettingId]

type AssistantPersonalityPreferencesUpdate = Partial<
  Record<AssistantPersonalitySettingId, AssistantPersonalityScore | null>
>

interface PreferencesCoreRuntime {
  readPreferencesDocument(vaultRoot: string): Promise<PreferencesDocument>
  updateAssistantPreferences(input: {
    causalOrigin?: "event" | "turn"
    causalSeq?: string
    vaultRoot: string
    updatedAt?: string
    preferences: {
      personality: AssistantPersonalityPreferencesUpdate
    }
  }): Promise<{
    updated: boolean
    document: PreferencesDocument
  }>
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

function hasPersonalityOverride(
  personality: AssistantPersonalityPreferences | undefined,
  setting: AssistantPersonalitySettingId,
): boolean {
  return (
    personality !== undefined &&
    Object.prototype.hasOwnProperty.call(personality, setting)
  )
}

function buildAssistantPersonalityResult(
  vault: string,
  preferences: PreferencesDocument,
  updated: boolean,
): AssistantPersonalityResult {
  const personality = preferences.assistant?.personality
  const effective = resolveAssistantPersonalityScores(personality)
  const settingResult = (setting: AssistantPersonalitySettingId) => ({
    value: effective[setting],
    source: hasPersonalityOverride(personality, setting)
      ? ("custom" as const)
      : ("default" as const),
  })

  return {
    vault,
    preferencesPath: preferences.sourcePath,
    updated,
    recordedAt: preferences.updatedAt,
    settings: {
      humor: settingResult("humor"),
      push: settingResult("push"),
      detail: settingResult("detail"),
    },
  }
}

export async function showAssistantPersonality(vault: string) {
  const { readPreferencesDocument } = await loadPreferencesCoreRuntime()
  return buildAssistantPersonalityResult(
    vault,
    await readPreferencesDocument(vault),
    false,
  )
}

export async function setAssistantPersonalitySetting(input: {
  causalSeq?: string
  vault: string
  setting: AssistantPersonalitySettingId
  value: AssistantPersonalityScore
  recordedAt?: string
}) {
  const { updateAssistantPreferences } = await loadPreferencesCoreRuntime()
  const updated = await updateAssistantPreferences({
    ...(await withAssistantPreferenceCausalSeq(input.causalSeq)),
    vaultRoot: input.vault,
    updatedAt: input.recordedAt,
    preferences: {
      personality: {
        [input.setting]: input.value,
      },
    },
  })

  return buildAssistantPersonalityResult(
    input.vault,
    updated.document,
    updated.updated,
  )
}

export async function resetAssistantPersonalitySetting(input: {
  causalSeq?: string
  vault: string
  setting: AssistantPersonalitySettingId
  recordedAt?: string
}) {
  const { updateAssistantPreferences } = await loadPreferencesCoreRuntime()
  const updated = await updateAssistantPreferences({
    ...(await withAssistantPreferenceCausalSeq(input.causalSeq)),
    vaultRoot: input.vault,
    updatedAt: input.recordedAt,
    preferences: {
      personality: {
        [input.setting]: null,
      },
    },
  })

  return buildAssistantPersonalityResult(
    input.vault,
    updated.document,
    updated.updated,
  )
}

export async function resetAllAssistantPersonalitySettings(input: {
  causalSeq?: string
  vault: string
  recordedAt?: string
}) {
  const { updateAssistantPreferences } = await loadPreferencesCoreRuntime()
  const personality: AssistantPersonalityPreferencesUpdate = {}
  for (const setting of assistantPersonalitySettingIds) {
    personality[setting] = null
  }
  const updated = await updateAssistantPreferences({
    ...(await withAssistantPreferenceCausalSeq(input.causalSeq)),
    vaultRoot: input.vault,
    updatedAt: input.recordedAt,
    preferences: { personality },
  })

  return buildAssistantPersonalityResult(
    input.vault,
    updated.document,
    updated.updated,
  )
}

async function withAssistantPreferenceCausalSeq(
  explicit: string | undefined,
): Promise<{ causalOrigin: "turn"; causalSeq: string } | Record<string, never>> {
  if (explicit !== undefined) {
    return {
      causalOrigin: "turn",
      causalSeq: explicit,
    }
  }
  if (process.env.MURPH_HOSTED_RUNTIME_PROCESS?.trim() === "1") {
    throw new TypeError(
      "Hosted assistant preference mutation requires mailbox causal order.",
    )
  }
  return {}
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
