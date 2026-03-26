import {
  assistantCronPresetSchema,
  type AssistantCronPreset,
  type AssistantCronPresetVariable,
} from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
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
    id: 'environment-health-watch',
    category: 'environment',
    title: 'Environment health watch',
    description:
      'Weekly location-aware checks for water quality, air quality, public-health notices, contamination alerts, and other local environmental hazards.',
    suggestedName: 'environment-health-watch',
    suggestedScheduleLabel: 'Mondays at 9:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 9 * * 1',
    },
    variables: [
      {
        key: 'location_context',
        label: 'Location context',
        description:
          'Where to anchor the audit. The default tells Healthy Bob to use the saved current location from memory or profile state.',
        required: true,
        defaultValue:
          'my current living location as stored in memory, profile context, or current-home details; if it is missing, say exactly what location detail I should save for future runs',
        example: 'Brisbane, Queensland, Australia',
      },
      {
        key: 'focus_areas',
        label: 'Focus areas',
        description:
          'What types of local environmental issues to prioritize in the weekly report.',
        required: true,
        defaultValue:
          'water quality, air quality, public-health notices, contamination advisories, wildfire smoke, flooding, heat, and any other local environmental-health risks',
        example:
          'water quality, air quality, mold, wildfire smoke, and contamination alerts',
      },
    ],
    promptTemplate: [
      'Run a weekly environmental health audit for me.',
      'Anchor the audit to this location context: {{location_context}}.',
      'Focus especially on: {{focus_areas}}.',
      'Look for anything practical I should know about water quality, air quality, environmental-health advisories, public-health notices, contamination events, pollution, weather-driven hazards, or other changes that could affect my health where I live.',
      'If a broader current-evidence scan would materially improve the answer, you may first use the research tool before writing the final summary.',
      'Summarize what changed this week, why it matters, how confident you are, and any concrete actions or monitoring steps I should take next.',
      'If my location is missing or ambiguous, say that clearly instead of guessing and tell me what detail to save for future runs.',
    ].join('\n\n'),
  },
  {
    id: 'condition-research-roundup',
    category: 'research',
    title: 'Condition research roundup',
    description:
      'Weekly research monitoring for a condition, biomarker, or health goal such as lowering cholesterol.',
    suggestedName: 'condition-research-roundup',
    suggestedScheduleLabel: 'Tuesdays at 9:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 9 * * 2',
    },
    variables: [
      {
        key: 'condition_or_goal',
        label: 'Condition or goal',
        description:
          'The condition, symptom area, biomarker, or goal to track for new studies and therapies.',
        required: true,
        defaultValue: 'lowering cholesterol',
        example: 'lowering LDL cholesterol',
      },
      {
        key: 'relevance_criteria',
        label: 'Relevance criteria',
        description:
          'What kinds of developments should count as worth surfacing in the weekly roundup.',
        required: true,
        defaultValue:
          'new studies, systematic reviews, therapies, clinical trials, practical lifestyle interventions, and any takeaways that could change what people actually try or discuss',
        example:
          'new therapies, stronger evidence, trial readouts, and practical clinician-or-patient takeaways',
      },
    ],
    promptTemplate: [
      'Prepare a weekly research roundup for this condition or goal: {{condition_or_goal}}.',
      'Treat these as the main relevance filters: {{relevance_criteria}}.',
      'Look for meaningful new evidence, clinical developments, emerging therapies, notable expert discussion, or anything else that would materially update my understanding of the space this week.',
      'If a broader current-evidence scan would materially improve the answer, you may first use the research tool before writing the final roundup.',
      'Prioritize signal over hype. Separate strong evidence from speculative or preliminary findings, and call out limitations, uncertainty, or conflicts between sources when they matter.',
      'End with a short section on what, if anything, seems actionable or worth watching next.',
    ].join('\n\n'),
  },
  {
    id: 'ingestible-watchlist',
    category: 'safety',
    title: 'Ingestible watchlist',
    description:
      'Weekly checks for recalls, contamination, third-party testing, labeling issues, and major sales across foods, beverages, and supplements I consume.',
    suggestedName: 'ingestible-watchlist',
    suggestedScheduleLabel: 'Wednesdays at 9:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 9 * * 3',
    },
    variables: [
      {
        key: 'watchlist',
        label: 'Watchlist',
        description:
          'The foods, beverages, supplements, or brands to track. The default uses memory and recent health context when available.',
        required: true,
        defaultValue:
          'the foods, beverages, supplements, and brands I regularly ingest based on memory, protocols, and recent logs; if the watchlist is incomplete, say what is missing',
        example:
          'Bob’s Red Mill granola, AG1, Nordic Naturals fish oil, and LMNT',
      },
      {
        key: 'monitoring_scope',
        label: 'Monitoring scope',
        description:
          'The safety and shopping signals to watch for on the selected watchlist.',
        required: true,
        defaultValue:
          'recalls, contamination reports, third-party testing, enforcement actions, ingredient or label discrepancies, retailer safety notices, and meaningful sales or price drops',
        example:
          'recalls, toxicology reports, third-party testing, and Amazon price drops',
      },
    ],
    promptTemplate: [
      'Review this ingestible watchlist for me: {{watchlist}}.',
      'Monitor it for: {{monitoring_scope}}.',
      'Tell me about anything important involving product safety, contamination, recalls, third-party test results, enforcement actions, label or ingredient discrepancies, or other issues that affect what I am eating, drinking, or supplementing with.',
      'If a broader current-evidence scan would materially improve the answer, you may first use the research tool before writing the final watchlist review.',
      'Also mention meaningful sales or price drops for items I regularly buy when they seem genuine and relevant.',
      'Group the output into urgent safety items, quality or evidence concerns, and optional shopping opportunities so it is easy to scan.',
    ].join('\n\n'),
  },
  {
    id: 'longevity-frontier-roundup',
    category: 'frontier',
    title: 'Longevity frontier roundup',
    description:
      'Weekly open-ended health, nutrition, exercise, and longevity updates with optional organization or company tracking.',
    suggestedName: 'longevity-frontier-roundup',
    suggestedScheduleLabel: 'Thursdays at 9:00',
    suggestedSchedule: {
      kind: 'cron',
      expression: '0 9 * * 4',
    },
    variables: [
      {
        key: 'interest_areas',
        label: 'Interest areas',
        description:
          'The broad topics to prioritize across the health and longevity landscape.',
        required: true,
        defaultValue: 'health, nutrition, exercise, and longevity',
        example: 'longevity biotech, nutrition, exercise science, and aging biomarkers',
      },
      {
        key: 'organizations_or_people',
        label: 'Organizations or people',
        description:
          'Specific labs, companies, institutes, or people to keep an eye on within the roundup.',
        required: true,
        defaultValue:
          'ARC Institute, NewLimit, and other organizations, companies, or people I seem especially interested in',
        example: 'ARC Institute, NewLimit, Retro Biosciences, and Peter Attia',
      },
    ],
    promptTemplate: [
      'Create a weekly frontier roundup across these interest areas: {{interest_areas}}.',
      'Pay extra attention to these organizations or people: {{organizations_or_people}}.',
      'Surface notable new studies, announcements, launches, technical progress, or discussions that would matter to someone following the cutting edge of health, nutrition, exercise, and longevity.',
      'If a broader current-evidence scan would materially improve the answer, you may first use the research tool before writing the final roundup.',
      'Prefer developments with genuine signal or strategic importance, and be explicit about what is robust evidence versus early or speculative work.',
      'End with a short “why this matters” section that connects the week’s updates back to practical implications or long-term trends.',
    ].join('\n\n'),
  },
  {
    id: 'weekly-health-snapshot',
    category: 'summary',
    title: 'Weekly health snapshot',
    description:
      'A weekly snapshot of progress versus goals, experiments, routines, and problem areas across the health data already available to Healthy Bob.',
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
          'What objectives, targets, and self-experiments to compare the week against. The default uses saved goals and recent context.',
        required: true,
        defaultValue:
          'my current health goals and self-experiments based on goals, experiments, protocols, recent logs, and memory; if any of that is missing, say what is not yet tracked',
        example:
          'lower LDL, improve sleep consistency, and track the impact of extra walking after meals',
      },
      {
        key: 'snapshot_focus',
        label: 'Snapshot focus',
        description:
          'Which evaluation dimensions to emphasize in the weekly summary.',
        required: true,
        defaultValue:
          'progress versus goals, experiment status, problem areas, leading indicators, habit consistency, and concrete recommendations for next week',
        example:
          'goal progress, missed habits, experiment outcomes, and what to improve next week',
      },
    ],
    promptTemplate: [
      'Produce a weekly health snapshot for me.',
      'Use this as the goal and experiment context: {{goals_and_experiments}}.',
      'Focus the analysis on: {{snapshot_focus}}.',
      'Summarize how I am doing, what seems to be improving, what is slipping, where the main problem areas are, and what the highest-leverage next steps would be for the coming week.',
      'When the available data is thin or missing for a claim, say that clearly instead of overreaching.',
      'Keep the final snapshot practical and concise enough that I could actually use it as a weekly review.',
    ].join('\n\n'),
  },
] satisfies readonly AssistantCronPresetDefinition[]

validateAssistantCronPresetDefinitions(assistantCronPresetDefinitions)

export function listAssistantCronPresets(): AssistantCronPreset[] {
  return assistantCronPresetDefinitions.map((preset) => stripPromptTemplate(preset))
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
    preset: stripPromptTemplate(preset),
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

function stripPromptTemplate(
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
    stripPromptTemplate(preset)

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
