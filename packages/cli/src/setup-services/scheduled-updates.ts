import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets,
  toAssistantCronPreset,
} from '@murphai/assistant-core/assistant-cron'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '@murphai/assistant-core/assistant-state'
import type { AssistantCronPreset } from '@murphai/assistant-core/assistant-cli-contracts'
import type {
  SetupScheduledUpdate,
  SetupStepResult,
} from '@murphai/assistant-core/setup-cli-contracts'
import { createStep } from './steps.js'

export interface ConfigureSetupScheduledUpdatesInput {
  dryRun: boolean
  presetIds: readonly string[]
  steps: SetupStepResult[]
  vault?: string
}

export async function configureSetupScheduledUpdates(
  input: ConfigureSetupScheduledUpdatesInput,
): Promise<SetupScheduledUpdate[]> {
  const recommendedPresets = resolveSelectedScheduledUpdates(input.presetIds)
  const selectedPresetIds = recommendedPresets.map((preset) => preset.id)

  if (!input.dryRun && input.vault) {
    await updateAssistantScheduledUpdateState({
      presetIds: selectedPresetIds,
      vault: input.vault,
    })
  }

  if (recommendedPresets.length === 0) {
    input.steps.push(
      createStep({
        detail: 'No assistant scheduled updates selected during onboarding.',
        id: 'assistant-scheduled-updates',
        kind: 'configure',
        status: 'skipped',
        title: 'Assistant scheduled updates',
      }),
    )
    return []
  }

  const deferredRecommendations: SetupScheduledUpdate[] = recommendedPresets.map(
    (preset) => ({
      preset,
      jobName: preset.suggestedName,
      status: 'skipped',
    }),
  )

  input.steps.push(
    createStep({
      detail: formatDeferredScheduledUpdatesDetail(recommendedPresets, input.dryRun),
      id: 'assistant-scheduled-updates',
      kind: 'configure',
      status: 'skipped',
      title: 'Assistant scheduled updates',
    }),
  )

  return deferredRecommendations
}

function resolveSelectedScheduledUpdates(
  presetIds: readonly string[],
): AssistantCronPreset[] {
  const order = new Map<string, number>(
    listAssistantCronPresets().map((preset, index) => [preset.id, index] as const),
  )
  const uniqueIds = [...new Set(presetIds)].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )

  return uniqueIds.map((presetId) =>
    toAssistantCronPreset(getAssistantCronPresetDefinition(presetId)),
  )
}

function formatDeferredScheduledUpdatesDetail(
  presets: readonly AssistantCronPreset[],
  dryRun: boolean,
): string {
  const titles = presets.map((entry) => entry.title).join(', ')
  const prefix = dryRun ? 'Would defer' : 'Deferred'

  return `${prefix} ${presets.length} assistant scheduled update${presets.length === 1 ? '' : 's'}: ${titles}. Cron jobs now require an explicit outbound channel route and delivery target, so onboarding no longer installs preset jobs automatically. Install them later with \`assistant cron preset install --channel ...\`.`
}

async function updateAssistantScheduledUpdateState(input: {
  presetIds: readonly string[]
  vault: string
}): Promise<void> {
  const state = await readAssistantAutomationState(input.vault)
  const preferredScheduledUpdates = [...input.presetIds]
  const currentPreferredScheduledUpdates = state.preferredScheduledUpdates ?? []
  const preferredChanged =
    state.preferredScheduledUpdates === undefined ||
    preferredScheduledUpdates.length !== currentPreferredScheduledUpdates.length ||
    preferredScheduledUpdates.some(
      (presetId, index) => currentPreferredScheduledUpdates[index] !== presetId,
    )

  if (!preferredChanged) {
    return
  }

  await saveAssistantAutomationState(input.vault, {
    ...state,
    preferredScheduledUpdates,
    updatedAt: new Date().toISOString(),
  })
}
