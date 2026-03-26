import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets,
} from '../assistant/cron/presets.js'
import type { AssistantCronPreset } from '../assistant-cli-contracts.js'
import type {
  SetupScheduledUpdate,
  SetupStepResult,
} from '../setup-cli-contracts.js'
import { createStep } from './steps.js'

export interface ConfigureSetupScheduledUpdatesInput {
  dryRun: boolean
  presetIds: readonly string[]
  steps: SetupStepResult[]
  vault: string
}

export async function configureSetupScheduledUpdates(
  input: ConfigureSetupScheduledUpdatesInput,
): Promise<SetupScheduledUpdate[]> {
  const selectedPresets = resolveSelectedScheduledUpdates(input.presetIds)

  if (selectedPresets.length === 0) {
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

  const configured: SetupScheduledUpdate[] = selectedPresets.map((preset) => ({
    preset,
    jobName: preset.suggestedName,
    status: 'skipped',
  }))

  input.steps.push(
    createStep({
      detail: formatDeferredScheduledUpdatesDetail(selectedPresets, input.dryRun),
      id: 'assistant-scheduled-updates',
      kind: 'configure',
      status: 'skipped',
      title: 'Assistant scheduled updates',
    }),
  )

  return configured
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

function toAssistantCronPreset(
  preset: ReturnType<typeof getAssistantCronPresetDefinition>,
): AssistantCronPreset {
  return {
    id: preset.id,
    category: preset.category,
    title: preset.title,
    description: preset.description,
    suggestedName: preset.suggestedName,
    suggestedSchedule: preset.suggestedSchedule,
    suggestedScheduleLabel: preset.suggestedScheduleLabel,
    variables: preset.variables,
  }
}

function formatDeferredScheduledUpdatesDetail(
  presets: readonly AssistantCronPreset[],
  dryRun: boolean,
): string {
  const titles = presets.map((entry) => entry.title).join(', ')
  const prefix = dryRun ? 'Would defer' : 'Deferred'

  return `${prefix} ${presets.length} assistant scheduled update${presets.length === 1 ? '' : 's'}: ${titles}. Cron jobs now require an explicit outbound channel route and delivery target, so onboarding no longer installs preset jobs automatically. Install them later with \`assistant cron preset install --channel ...\`.`
}
