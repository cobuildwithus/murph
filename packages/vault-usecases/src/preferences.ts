import {
  assistantPersonalitySettingIds,
  resolveAssistantEffectiveStyle,
  type AssistantPersonalityPreferences,
  type AssistantPersonalityScores,
  type AssistantPersonalitySettingId,
  type AssistantPreferences,
  type SavedHealthView,
  type WearablePreferenceProvider,
  type WearableTrendMetricKey,
  type WearablePreferences,
} from "@murphai/contracts";
import { loadRuntimeModule } from "./runtime-import.js"
import { toVaultCliError } from "./usecases/vault-usecase-helpers.js"

interface PreferencesDocument {
  assistant?: AssistantPreferences
  sourcePath: string
  updatedAt: string | null
  savedHealthViews: SavedHealthView[]
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
  createSavedHealthView(input: {
    vaultRoot: string
    name: string
    metricKeys: readonly WearableTrendMetricKey[]
    updatedAt?: string
  }): Promise<{
    created: true
    view: SavedHealthView
    document: PreferencesDocument
  }>
  deleteSavedHealthView(input: {
    vaultRoot: string
    savedViewId: string
    updatedAt?: string
  }): Promise<{
    deleted: true
    view: SavedHealthView
    document: PreferencesDocument
  }>
  patchSavedHealthView(input: {
    vaultRoot: string
    savedViewId: string
    name?: string
    metricKeys?: readonly WearableTrendMetricKey[]
    updatedAt?: string
  }): Promise<{
    updated: boolean
    view: SavedHealthView
    document: PreferencesDocument
  }>
  readSavedHealthViewSnapshot(input: {
    vaultRoot: string
    lookup: string
  }): Promise<{
    document: PreferencesDocument
    view: SavedHealthView
  }>
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
  const effective = resolveAssistantEffectiveStyle(preferences.assistant).personality
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
      unhinged: settingResult("unhinged"),
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

function toSavedHealthViewCliError(error: unknown) {
  return toVaultCliError(error, {
    SAVED_HEALTH_VIEW_EMPTY_PATCH: { code: 'invalid_option' },
    SAVED_HEALTH_VIEW_ID_INVALID: { code: 'invalid_option' },
    SAVED_HEALTH_VIEW_LIMIT_REACHED: {
      code: 'conflict',
      details: { stage: 'conflict' },
    },
    SAVED_HEALTH_VIEW_LOOKUP_INVALID: { code: 'invalid_option' },
    SAVED_HEALTH_VIEW_NAME_CONFLICT: {
      code: 'conflict',
      details: { stage: 'conflict' },
    },
    SAVED_HEALTH_VIEW_NOT_FOUND: {
      code: 'not_found',
      details: { stage: 'read' },
    },
  })
}

function savedHealthViewEnvelope(
  vault: string,
  preferences: PreferencesDocument,
) {
  return {
    vault,
    preferencesPath: preferences.sourcePath,
    recordedAt: preferences.updatedAt,
  }
}

export async function listSavedHealthViews(vault: string) {
  try {
    const { readPreferencesDocument } = await loadPreferencesCoreRuntime()
    const preferences = await readPreferencesDocument(vault)
    return {
      ...savedHealthViewEnvelope(vault, preferences),
      count: preferences.savedHealthViews.length,
      views: preferences.savedHealthViews,
    }
  } catch (error) {
    throw toSavedHealthViewCliError(error)
  }
}

export async function showSavedHealthView(input: {
  vault: string
  lookup: string
}) {
  try {
    const { readSavedHealthViewSnapshot } =
      await loadPreferencesCoreRuntime()
    const snapshot = await readSavedHealthViewSnapshot({
      vaultRoot: input.vault,
      lookup: input.lookup,
    })
    return {
      ...savedHealthViewEnvelope(input.vault, snapshot.document),
      view: snapshot.view,
    }
  } catch (error) {
    throw toSavedHealthViewCliError(error)
  }
}

export async function saveSavedHealthView(input: {
  vault: string
  name: string
  metricKeys: readonly WearableTrendMetricKey[]
  recordedAt?: string
}) {
  try {
    const { createSavedHealthView } = await loadPreferencesCoreRuntime()
    const created = await createSavedHealthView({
      vaultRoot: input.vault,
      name: input.name,
      metricKeys: input.metricKeys,
      updatedAt: input.recordedAt,
    })
    return {
      ...savedHealthViewEnvelope(input.vault, created.document),
      created: created.created,
      view: created.view,
    }
  } catch (error) {
    throw toSavedHealthViewCliError(error)
  }
}

export async function editSavedHealthView(input: {
  vault: string
  savedViewId: string
  name?: string
  metricKeys?: readonly WearableTrendMetricKey[]
  recordedAt?: string
}) {
  try {
    const { patchSavedHealthView } = await loadPreferencesCoreRuntime()
    const updated = await patchSavedHealthView({
      vaultRoot: input.vault,
      savedViewId: input.savedViewId,
      name: input.name,
      metricKeys: input.metricKeys,
      updatedAt: input.recordedAt,
    })
    return {
      ...savedHealthViewEnvelope(input.vault, updated.document),
      updated: updated.updated,
      view: updated.view,
    }
  } catch (error) {
    throw toSavedHealthViewCliError(error)
  }
}

export async function deleteSavedHealthView(input: {
  vault: string
  savedViewId: string
  recordedAt?: string
}) {
  try {
    const { deleteSavedHealthView: removeSavedHealthView } =
      await loadPreferencesCoreRuntime()
    const deleted = await removeSavedHealthView({
      vaultRoot: input.vault,
      savedViewId: input.savedViewId,
      updatedAt: input.recordedAt,
    })
    return {
      ...savedHealthViewEnvelope(input.vault, deleted.document),
      deleted: deleted.deleted,
      view: deleted.view,
    }
  } catch (error) {
    throw toSavedHealthViewCliError(error)
  }
}
