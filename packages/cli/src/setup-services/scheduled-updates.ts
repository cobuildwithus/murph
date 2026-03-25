import {
  getAssistantCronJob,
  installAssistantCronPreset,
} from '../assistant/cron.js'
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

  if (input.dryRun) {
    const planned = selectedPresets.map((preset) => ({
      preset,
      jobName: preset.suggestedName,
      status: 'planned' as const,
    }))

    input.steps.push(
      createStep({
        detail: `Would install ${formatScheduledUpdateList(selectedPresets)}. These run while assistant run is active for the vault.`,
        id: 'assistant-scheduled-updates',
        kind: 'configure',
        status: 'planned',
        title: 'Assistant scheduled updates',
      }),
    )

    return planned
  }

  const configured: SetupScheduledUpdate[] = []

  for (const preset of selectedPresets) {
    try {
      const installed = await installAssistantCronPreset({
        vault: input.vault,
        presetId: preset.id,
      })
      configured.push({
        preset: installed.preset,
        jobName: installed.job.name,
        status: 'completed',
      })
    } catch (error) {
      if (!hasErrorCode(error, 'ASSISTANT_CRON_JOB_EXISTS')) {
        throw error
      }

      const existing = await getAssistantCronJob(input.vault, preset.suggestedName)
      configured.push({
        preset,
        jobName: existing.name,
        status: 'reused',
      })
    }
  }

  input.steps.push(
    createStep({
      detail: formatConfiguredScheduledUpdatesDetail(configured),
      id: 'assistant-scheduled-updates',
      kind: 'configure',
      status: configured.some((entry) => entry.status === 'completed')
        ? 'completed'
        : 'reused',
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

function formatScheduledUpdateList(
  presets: readonly AssistantCronPreset[],
): string {
  if (presets.length === 1) {
    const preset = presets[0] as AssistantCronPreset
    return `1 assistant scheduled update: ${preset.title} (${preset.suggestedScheduleLabel})`
  }

  return `${presets.length} assistant scheduled updates: ${presets
    .map((preset) => `${preset.title} (${preset.suggestedScheduleLabel})`)
    .join(', ')}`
}

function formatConfiguredScheduledUpdatesDetail(
  configured: readonly SetupScheduledUpdate[],
): string {
  const completed = configured.filter((entry) => entry.status === 'completed').length
  const reused = configured.filter((entry) => entry.status === 'reused').length
  const titles = configured.map((entry) => entry.preset.title).join(', ')

  if (completed > 0 && reused > 0) {
    return `Installed ${completed} assistant scheduled update${completed === 1 ? '' : 's'} and reused ${reused} existing job${reused === 1 ? '' : 's'}: ${titles}. Existing jobs with matching names were left unchanged.`
  }

  if (completed > 0) {
    return `Installed ${completed} assistant scheduled update${completed === 1 ? '' : 's'}: ${titles}. These run while assistant run is active for the vault.`
  }

  return `Reused ${reused} existing assistant scheduled update${reused === 1 ? '' : 's'}: ${titles}. Existing jobs with matching names were left unchanged.`
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
