import {
  assistantCronPresetSchema,
  type AssistantCronPreset,
  type AssistantCronPresetVariable,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeNullableString } from '../shared.js'

const PRESET_TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-z0-9_-]+)\s*\}\}/giu

export interface AssistantCronPresetDefinition extends AssistantCronPreset {
  promptTemplate: string
}

export interface RenderAssistantCronPresetInput {
  additionalInstructions?: string | null
  presetId: string
  variables?: Record<string, string | null | undefined> | null
}

export interface RenderAssistantCronPresetResult {
  preset: AssistantCronPreset
  promptTemplate: string
  resolvedPrompt: string
  resolvedVariables: Record<string, string>
}

const assistantCronPresetDefinitions: readonly AssistantCronPresetDefinition[] = [
  {
    id: 'morning-mindfulness',
    category: 'mindfulness',
    title: 'Morning mindfulness',
    description:
      'Daily meditation or mindfulness prompts with one grounded line to reflect on and one simple practice to carry into the morning.',
    suggestedName: 'morning-mindfulness',
    suggestedScheduleLabel: 'Daily at 7:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 7 * * *',
    },
    variables: [
      {
        key: 'practice_window',
        label: 'Practice window',
        description:
          'The kind of morning meditation or mindfulness session this should support.',
        required: true,
        defaultValue:
          'a short 5 to 10 minute morning meditation before the day gets busy',
        example: 'a 10 minute seated meditation before work',
      },
      {
        key: 'focus_for_today',
        label: 'Focus for today',
        description:
          'The sensations, qualities, or themes to emphasize in the prompt.',
        required: true,
        defaultValue:
          'breath awareness, gently returning attention, calm, gratitude, and self-compassion',
        example: 'breath awareness, relaxing my shoulders, and gratitude',
      },
    ],
    promptTemplate: [
      'Send me a short morning mindfulness prompt for today.',
      'Assume this is the practice window I am aiming for: {{practice_window}}.',
      'Center the message on: {{focus_for_today}}.',
      'Open with one short, grounded meditation or mindfulness line that feels memorable.',
      'Then give me one specific thing to notice, practice, or return to during the sit.',
      'If helpful, add one sentence on how to carry that attention into the next hour of the day.',
      'Keep the whole response calm, concise, and text-message friendly.',
      'Do not turn it into a long essay.',
    ].join('\n\n'),
  },
  {
    id: 'weekly-health-snapshot',
    category: 'summary',
    title: 'Weekly health compass',
    description:
      'A weekly compass that highlights what changed, what stayed steady, what likely explains the week, and what is or is not worth reacting to yet.',
    suggestedName: 'weekly-health-snapshot',
    suggestedScheduleLabel: 'Sundays at 18:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 18 * * 0',
    },
    variables: [
      {
        key: 'goals_and_experiments',
        label: 'Goals and experiments',
        description:
          'What goals, active investigations, and bounded experiments should anchor the weekly read. The default uses saved goals and recent context.',
        required: true,
        defaultValue:
          'my current health goals and current investigations based on goals, experiments, protocols, recent logs, and memory; if any of that is missing, say what is not yet tracked',
        example:
          'lower LDL, protect sleep consistency, and continue extra walking after meals long enough to get a cleaner read',
      },
      {
        key: 'snapshot_focus',
        label: 'Snapshot focus',
        description:
          'Which dimensions should shape the weekly compass summary.',
        required: true,
        defaultValue:
          'what changed, what stayed steady, what was probably noise, the likely context behind the week, one thing worth keeping, one lightweight thing worth trying, and one thing not worth overreacting to',
        example:
          'what changed, likely context, one thing to keep, and one thing to leave alone',
      },
    ],
    promptTemplate: [
      'Produce a weekly health compass for me.',
      'Use this as the goal and experiment context: {{goals_and_experiments}}.',
      'Focus the analysis on: {{snapshot_focus}}.',
      'Lead with a calm weekly read: what changed, what stayed steady, and what seems like normal variation or thin data rather than something to fix.',
      'Interpret the week in context, including sleep, stress, illness, travel, work, meals, relationships, and any other real-life factors that seem relevant from the available data.',
      'If there is a useful next step, keep it lightweight, reversible, and easy to live with. Include burden, tradeoffs, and when it would make sense to stop or ignore it.',
      'It is good to conclude that nothing new needs to be added right now, that an existing investigation simply needs more time, or that a change in the numbers did not obviously make life better.',
      'Do not sound like a nagging coach. Avoid compliance framing, shame framing, purity language, or a stack of protocols.',
      'When the available data is thin or missing for a claim, say that clearly instead of overreaching.',
      'Keep the final compass practical, concise, and easy to scan in a message thread.',
    ].join('\n\n'),
  },
] satisfies readonly AssistantCronPresetDefinition[]

validateAssistantCronPresetDefinitions(assistantCronPresetDefinitions)

export function listAssistantCronPresets(): AssistantCronPreset[] {
  return assistantCronPresetDefinitions.map((preset) => toAssistantCronPreset(preset))
}

export function getAssistantCronPresetDefinition(
  presetId: string,
): AssistantCronPresetDefinition {
  const normalizedPresetId = normalizeNullableString(presetId)
  if (!normalizedPresetId) {
    throw new VaultCliError(
      'ASSISTANT_CRON_PRESET_NOT_FOUND',
      'Assistant cron preset id must be a non-empty string.',
    )
  }

  const preset = assistantCronPresetDefinitions.find(
    (entry) => entry.id === normalizedPresetId,
  )
  if (!preset) {
    throw new VaultCliError(
      'ASSISTANT_CRON_PRESET_NOT_FOUND',
      `Assistant cron preset "${normalizedPresetId}" was not found.`,
    )
  }

  return preset
}

export function renderAssistantCronPreset(
  input: RenderAssistantCronPresetInput,
): RenderAssistantCronPresetResult {
  const preset = getAssistantCronPresetDefinition(input.presetId)
  const resolvedVariables = resolveAssistantCronPresetVariables(
    preset.variables,
    input.variables ?? null,
    preset.id,
  )
  let resolvedPrompt = preset.promptTemplate.replace(
    PRESET_TEMPLATE_VARIABLE_PATTERN,
    (_, key: string) => {
      const resolved = resolvedVariables[key]
      if (typeof resolved !== 'string') {
        throw new VaultCliError(
          'ASSISTANT_CRON_PRESET_INVALID_TEMPLATE',
          `Assistant cron preset "${preset.id}" references an unknown variable "${key}".`,
        )
      }

      return resolved
    },
  )

  const additionalInstructions = normalizeNullableString(
    input.additionalInstructions,
  )
  if (additionalInstructions) {
    resolvedPrompt = [
      resolvedPrompt,
      `Additional user instructions:\n${additionalInstructions}`,
    ].join('\n\n')
  }

  return {
    preset: toAssistantCronPreset(preset),
    promptTemplate: preset.promptTemplate,
    resolvedPrompt,
    resolvedVariables,
  }
}

function resolveAssistantCronPresetVariables(
  variables: readonly AssistantCronPresetVariable[],
  input: Record<string, string | null | undefined> | null,
  presetId: string,
): Record<string, string> {
  const allowedKeys = new Set<string>(variables.map((variable) => variable.key))
  const invalidKeys = Object.keys(input ?? {}).filter((key) => !allowedKeys.has(key))
  if (invalidKeys.length > 0) {
    const supportedKeys = [...allowedKeys].sort().join(', ')
    const invalidSummary = invalidKeys.map((key) => `"${key}"`).join(', ')
    throw new VaultCliError(
      'ASSISTANT_CRON_PRESET_INVALID_INPUT',
      `Assistant cron preset "${presetId}" does not define ${invalidKeys.length === 1 ? 'variable' : 'variables'} ${invalidSummary}. Supported keys: ${supportedKeys}.`,
    )
  }

  const resolvedEntries = variables.map((variable) => {
    const candidate = normalizeNullableString(input?.[variable.key])
    const resolved = candidate ?? variable.defaultValue
    if (!resolved) {
      if (!variable.required) {
        return [variable.key, ''] as const
      }

      throw new VaultCliError(
        'ASSISTANT_CRON_PRESET_MISSING_VARIABLE',
        `Assistant cron preset "${presetId}" requires --var ${variable.key}=...`,
      )
    }

    return [variable.key, resolved] as const
  })

  return Object.fromEntries(resolvedEntries)
}

export function toAssistantCronPreset(
  preset: AssistantCronPresetDefinition,
): AssistantCronPreset {
  return assistantCronPresetSchema.parse({
    id: preset.id,
    category: preset.category,
    title: preset.title,
    description: preset.description,
    suggestedName: preset.suggestedName,
    suggestedSchedule: preset.suggestedSchedule,
    suggestedScheduleLabel: preset.suggestedScheduleLabel,
    variables: preset.variables,
  })
}

function validateAssistantCronPresetDefinitions(
  presets: readonly AssistantCronPresetDefinition[],
): void {
  const seenIds = new Set<string>()

  for (const preset of presets) {
    toAssistantCronPreset(preset)

    if (seenIds.has(preset.id)) {
      throw new Error(`Duplicate assistant cron preset id: ${preset.id}`)
    }
    seenIds.add(preset.id)

    const variableKeys = new Set(preset.variables.map((variable) => variable.key))
    const placeholderKeys = new Set(
      [...preset.promptTemplate.matchAll(PRESET_TEMPLATE_VARIABLE_PATTERN)].map(
        (match) => match[1] ?? '',
      ),
    )

    for (const key of placeholderKeys) {
      if (!variableKeys.has(key)) {
        throw new Error(
          `Assistant cron preset "${preset.id}" references unknown variable "${key}".`,
        )
      }
    }
  }
}
