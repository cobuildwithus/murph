import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import { Cli, z } from 'incur'
import {
  assistantModelTargetSchema,
  assistantReasoningEffortValues,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantOperatorDefaults,
  resolveAssistantBackendTarget,
  resolveOperatorHomeDirectory,
  resolveAssistantProviderDefaults,
  saveAssistantOperatorDefaultsPatch,
  type AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import {
  setupAssistantAccountSchema,
  setupCommandOptionsSchema,
  setupAssistantProviderPresetSchema,
  type SetupAssistantPreset,
  type SetupCommandOptions,
} from '@murphai/operator-config/setup-cli-contracts'
import { prepareSetupPromptInput } from '@murphai/operator-config/setup-prompt-io'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createSetupAssistantResolver,
  type SetupAssistantResolver,
} from '@murphai/setup-cli/setup-assistant'
import {
  assistantOperatorDefaultsMatch,
  assistantSelectionToOperatorDefaults,
  buildSetupAssistantOptionsFromDefaults,
  formatAssistantDefaultsSummary,
  formatSavedAssistantDefaultsSummary,
} from '@murphai/setup-cli/setup-assistant-defaults'
import {
  runSetupAssistantWizard,
  type SetupAssistantWizardInput,
  type SetupAssistantWizardResult,
} from '@murphai/setup-cli/setup-assistant-wizard'

const modelCommandPresetSchema = z.enum(['codex', 'openai-compatible'])

const modelCommandOptionsSchema = z.object({
  show: z
    .boolean()
    .optional()
    .describe('Show the saved default assistant backend without changing it.'),
  preset: modelCommandPresetSchema
    .optional()
    .describe('Assistant backend preset to save: Codex or an OpenAI-compatible endpoint.'),
  providerPreset: setupAssistantProviderPresetSchema
    .optional()
    .describe('Optional named OpenAI-compatible provider preset to seed the endpoint prompts.'),
  model: z
    .string()
    .min(1)
    .optional()
    .describe('Default model to save for the selected backend.'),
  baseUrl: z
    .string()
    .min(1)
    .optional()
    .describe('OpenAI-compatible base URL to save, such as http://127.0.0.1:11434/v1.'),
  apiKeyEnv: z
    .string()
    .min(1)
    .optional()
    .describe('Environment variable name that should hold the OpenAI-compatible API key.'),
  providerName: z
    .string()
    .min(1)
    .optional()
    .describe('Stable label for the saved OpenAI-compatible provider.'),
  codexCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex CLI executable path. Defaults to codex.'),
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex profile name to save.'),
  reasoningEffort: z
    .enum(assistantReasoningEffortValues)
    .optional()
    .describe('Optional assistant reasoning effort default to save.'),
  oss: z
    .boolean()
    .optional()
    .describe('Save a local Codex OSS model target instead of the signed-in Codex cloud path.'),
})

const modelCommandResultSchema = z
  .object({
    action: z.enum(['show', 'set']),
    changed: z.boolean(),
    configured: z.boolean(),
    backend: assistantModelTargetSchema.nullable(),
    account: setupAssistantAccountSchema.nullable(),
    summary: z.string().min(1).nullable(),
    notes: z.array(z.string().min(1)),
  })
  .strict()

type ModelCommandOptions = z.infer<typeof modelCommandOptionsSchema>
type ModelCommandPreset = z.infer<typeof modelCommandPresetSchema>

interface ModelCommandDependencies {
  assistantSetup?: SetupAssistantResolver
  assistantWizard?: (
    input: SetupAssistantWizardInput,
  ) => Promise<SetupAssistantWizardResult>
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  readDefaults?: (homeDirectory: string) => Promise<AssistantOperatorDefaults | null>
  resolveHomeDirectory?: () => string
  saveDefaultsPatch?: (
    patch: Partial<AssistantOperatorDefaults>,
    homeDirectory: string,
  ) => Promise<void>
  terminal?: {
    stdinIsTTY: boolean
    stderrIsTTY: boolean
  }
}

export function registerModelCommands(
  cli: Cli.Cli,
  dependencies: ModelCommandDependencies = {},
) {
  const assistantSetup =
    dependencies.assistantSetup ?? createSetupAssistantResolver()
  const assistantWizard =
    dependencies.assistantWizard ?? runSetupAssistantWizard
  const input = dependencies.input ?? defaultInput
  const output = dependencies.output ?? defaultOutput
  const readDefaults =
    dependencies.readDefaults ??
    (async (homeDirectory: string) =>
      await resolveAssistantOperatorDefaults(homeDirectory))
  const resolveHomeDirectory =
    dependencies.resolveHomeDirectory ?? (() => resolveOperatorHomeDirectory())
  const saveDefaultsPatch =
    dependencies.saveDefaultsPatch ??
    (async (patch: Partial<AssistantOperatorDefaults>, homeDirectory: string) => {
      await saveAssistantOperatorDefaultsPatch(patch, homeDirectory)
    })
  const terminal =
    dependencies.terminal ??
    ({
      stdinIsTTY: Boolean((input as NodeJS.ReadStream).isTTY),
      stderrIsTTY: Boolean((output as NodeJS.WriteStream).isTTY),
    } as const)

  cli.command('model', {
    args: z.object({}),
    description:
      'Show or update the saved default assistant backend that Murph reuses for future chats and auto-reply.',
    examples: [
      {
        description: 'Show the currently saved default assistant backend.',
        options: {
          show: true,
        },
      },
      {
        description: 'Interactively switch the saved backend using the existing setup prompts.',
      },
      {
        description: 'Save a Codex default model without re-running onboarding.',
        options: {
          preset: 'codex',
          model: 'gpt-5.4',
        },
      },
      {
        description: 'Save a local OpenAI-compatible endpoint and model.',
        options: {
          preset: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'gpt-oss:20b',
          providerName: 'ollama',
        },
      },
    ],
    hint:
      'Run `murph model` in a TTY to reopen the provider/model picker, or use `--show` for the current saved backend.',
    options: modelCommandOptionsSchema,
    output: modelCommandResultSchema,
    async run({ options }) {
      const homeDirectory = resolveHomeDirectory()
      const existingDefaults = await readDefaults(homeDirectory)

      if (options.show) {
        assertShowOnly(options)
        return buildModelCommandResult({
          action: 'show',
          changed: false,
          defaults: existingDefaults,
        })
      }

      const allowPrompt = terminal.stdinIsTTY && terminal.stderrIsTTY
      const wizardSelection =
        allowPrompt && shouldRunModelAssistantWizard(options)
          ? await assistantWizard({
              ...buildSetupAssistantWizardInputFromDefaults(existingDefaults),
            })
          : null
      const resolvedOptions = mergeModelCommandOptionsWithWizardSelection(
        options,
        wizardSelection,
      )
      const preset =
        wizardSelection?.assistantPreset ??
        (await resolveModelCommandPreset({
          allowPrompt,
          currentPreset:
            buildSetupAssistantOptionsFromDefaults(existingDefaults).assistantPreset ??
            null,
          input,
          options: resolvedOptions,
          output,
        }))
      assertCompatibleModelCommandOptions(preset, resolvedOptions)

      const setupOptions = createModelSetupOptions({
        defaults: existingDefaults,
        options: resolvedOptions,
        preset,
        wizardSelection,
      })
      const selectedAssistant = await assistantSetup.resolve({
        allowPrompt,
        commandName: 'model',
        options: setupOptions,
        preset,
      })

      if (!selectedAssistant.enabled || selectedAssistant.provider === null) {
        throw new VaultCliError(
          'invalid_option',
          'Model selection must resolve to a saved assistant backend.',
        )
      }

      const nextDefaults = assistantSelectionToOperatorDefaults(
        selectedAssistant,
        existingDefaults,
      )
      const changed = !assistantOperatorDefaultsMatch(existingDefaults, nextDefaults)

      if (changed) {
        await saveDefaultsPatch(nextDefaults, homeDirectory)
      }

      const currentDefaults = changed
        ? await readDefaults(homeDirectory)
        : existingDefaults

      return {
        action: 'set' as const,
        changed,
        configured: true,
        backend: currentDefaults?.backend ?? null,
        account: currentDefaults?.account ?? selectedAssistant.account ?? null,
        summary:
          formatSavedAssistantDefaultsSummary(currentDefaults) ??
          formatAssistantDefaultsSummary(selectedAssistant),
        notes: buildAssistantBackendNotes(currentDefaults),
      }
    },
  })
}

function assertShowOnly(options: ModelCommandOptions): void {
  if (!hasModelUpdateOptions(options)) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    'Do not combine `--show` with model update options.',
  )
}

function hasModelUpdateOptions(options: ModelCommandOptions): boolean {
  return Boolean(
    options.preset ??
      options.providerPreset ??
      options.model ??
      options.baseUrl ??
      options.apiKeyEnv ??
      options.providerName ??
      options.codexCommand ??
      options.profile ??
      options.reasoningEffort ??
      options.oss,
  )
}

function shouldRunModelAssistantWizard(options: ModelCommandOptions): boolean {
  return !hasModelUpdateOptions(options)
}

function mergeModelCommandOptionsWithWizardSelection(
  options: ModelCommandOptions,
  wizardSelection: SetupAssistantWizardResult | null,
): ModelCommandOptions {
  if (!wizardSelection?.assistantPreset) {
    return options
  }

  return {
    ...options,
    preset: wizardSelection.assistantPreset,
    ...(wizardSelection.assistantBaseUrl !== undefined
      ? {
          baseUrl: wizardSelection.assistantBaseUrl ?? undefined,
        }
      : {}),
    ...(wizardSelection.assistantApiKeyEnv !== undefined
      ? {
          apiKeyEnv: wizardSelection.assistantApiKeyEnv ?? undefined,
        }
      : {}),
    ...(wizardSelection.assistantProviderName !== undefined
      ? {
          providerName: wizardSelection.assistantProviderName ?? undefined,
        }
      : {}),
    ...(wizardSelection.assistantPreset === 'codex' &&
    wizardSelection.assistantOss !== undefined
      ? {
          oss: wizardSelection.assistantOss ?? undefined,
        }
      : {}),
  }
}

async function resolveModelCommandPreset(input: {
  allowPrompt: boolean
  currentPreset: SetupAssistantPreset | null | undefined
  input: NodeJS.ReadableStream
  options: ModelCommandOptions
  output: NodeJS.WritableStream
}): Promise<ModelCommandPreset> {
  if (input.options.preset) {
    return input.options.preset
  }

  if (
    input.options.providerPreset ??
    input.options.baseUrl ??
    input.options.apiKeyEnv ??
    input.options.providerName
  ) {
    return 'openai-compatible'
  }

  if (input.options.codexCommand ?? input.options.profile ?? input.options.oss) {
    return 'codex'
  }

  if (input.options.model ?? input.options.reasoningEffort) {
    if (
      input.currentPreset === 'codex' ||
      input.currentPreset === 'openai-compatible'
    ) {
      return input.currentPreset
    }

    if (!input.allowPrompt) {
      throw new VaultCliError(
        'invalid_option',
        'Provide `--preset` when saving a model without an existing saved backend.',
      )
    }
  }

  if (!input.allowPrompt) {
    throw new VaultCliError(
      'invalid_option',
      'Run `murph model --show` to inspect the saved backend, or pass `--preset` / provider options to update it non-interactively.',
    )
  }

  return await promptForModelPreset({
    currentPreset:
      input.currentPreset === 'codex' || input.currentPreset === 'openai-compatible'
        ? input.currentPreset
        : 'codex',
    input: input.input,
    output: input.output,
  })
}

function assertCompatibleModelCommandOptions(
  preset: ModelCommandPreset,
  options: ModelCommandOptions,
): void {
  if (
    preset === 'codex' &&
    (options.providerPreset ??
      options.baseUrl ??
      options.apiKeyEnv ??
      options.providerName)
  ) {
    throw new VaultCliError(
      'invalid_option',
      'OpenAI-compatible options require `--preset openai-compatible`.',
    )
  }

  if (
    preset === 'openai-compatible' &&
    (options.codexCommand ?? options.profile ?? options.oss)
  ) {
    throw new VaultCliError(
      'invalid_option',
      'Codex-specific options require `--preset codex`.',
    )
  }
}

function createModelSetupOptions(input: {
  defaults: AssistantOperatorDefaults | null
  options: ModelCommandOptions
  preset: ModelCommandPreset
  wizardSelection?: SetupAssistantWizardResult | null
}): SetupCommandOptions {
  const savedAssistantOptions = buildModelSetupAssistantOptionsFromDefaults(
    input.defaults,
    input.preset,
  )
  if (input.wizardSelection) {
    delete savedAssistantOptions.assistantModel
    if (input.wizardSelection.assistantBaseUrl === null) {
      delete savedAssistantOptions.assistantBaseUrl
    }
    if (input.wizardSelection.assistantApiKeyEnv === null) {
      delete savedAssistantOptions.assistantApiKeyEnv
    }
    if (input.wizardSelection.assistantProviderName === null) {
      delete savedAssistantOptions.assistantProviderName
    }
  }

  return setupCommandOptionsSchema.parse({
    vault: './vault',
    ...savedAssistantOptions,
    assistantPreset: input.preset,
    ...(input.options.providerPreset !== undefined
      ? {
          assistantProviderPreset: input.options.providerPreset,
        }
      : {}),
    ...(input.options.model !== undefined
      ? {
          assistantModel: input.options.model,
        }
      : {}),
    ...(input.options.baseUrl !== undefined
      ? {
          assistantBaseUrl: input.options.baseUrl,
        }
      : {}),
    ...(input.options.apiKeyEnv !== undefined
      ? {
          assistantApiKeyEnv: input.options.apiKeyEnv,
        }
      : {}),
    ...(input.options.providerName !== undefined
      ? {
          assistantProviderName: input.options.providerName,
        }
      : {}),
    ...(input.options.codexCommand !== undefined
      ? {
          assistantCodexCommand: input.options.codexCommand,
        }
      : {}),
    ...(input.options.profile !== undefined
      ? {
          assistantProfile: input.options.profile,
        }
      : {}),
    ...(input.options.reasoningEffort !== undefined
      ? {
          assistantReasoningEffort: input.options.reasoningEffort,
        }
      : {}),
    ...(input.options.oss !== undefined
      ? {
          assistantOss: input.options.oss,
        }
      : {}),
  })
}

function buildModelSetupAssistantOptionsFromDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
  preset: ModelCommandPreset,
): Partial<SetupCommandOptions> {
  const backend = resolveAssistantBackendTarget(defaults)
  if (
    !backend ||
    (preset === 'openai-compatible' && backend.adapter !== 'openai-compatible') ||
    (preset === 'codex' && backend.adapter !== 'codex-cli')
  ) {
    return {}
  }

  const savedAssistantOptions = buildSetupAssistantOptionsFromDefaults(defaults)

  // `murph model` intentionally does not seed OpenAI-compatible edits with a
  // persisted reasoning-effort value because compatibility is target-specific
  // and the resolved endpoint/model may change during the edit flow.
  if (preset === 'openai-compatible') {
    delete savedAssistantOptions.assistantReasoningEffort
  }

  return savedAssistantOptions
}

async function promptForModelPreset(input: {
  currentPreset: ModelCommandPreset
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}): Promise<ModelCommandPreset> {
  prepareSetupPromptInput(input.input)
  const rl = readline.createInterface({
    input: input.input,
    output: input.output,
  })

  const defaultChoice = input.currentPreset === 'openai-compatible' ? '2' : '1'

  try {
    input.output.write('\nSelect the default assistant backend to save:\n')
    input.output.write('  1. Codex CLI\n')
    input.output.write('  2. OpenAI-compatible endpoint\n')

    while (true) {
      const answer = (await rl.question(`Choice [${defaultChoice}]: `)).trim()
      const choice = answer.length > 0 ? answer : defaultChoice

      if (choice === '1' || /^codex$/iu.test(choice)) {
        return 'codex'
      }

      if (
        choice === '2' ||
        /^openai-compatible$/iu.test(choice) ||
        /^openai$/iu.test(choice)
      ) {
        return 'openai-compatible'
      }

      input.output.write('Enter 1 for Codex or 2 for OpenAI-compatible.\n')
    }
  } finally {
    rl.close()
  }
}

function buildModelCommandResult(input: {
  action: 'show' | 'set'
  changed: boolean
  defaults: AssistantOperatorDefaults | null
}) {
  return {
    action: input.action,
    changed: input.changed,
    configured: input.defaults?.backend !== null && input.defaults?.backend !== undefined,
    backend: input.defaults?.backend ?? null,
    account: input.defaults?.account ?? null,
    summary: formatSavedAssistantDefaultsSummary(input.defaults),
    notes: buildAssistantBackendNotes(input.defaults),
  }
}

function buildAssistantBackendNotes(
  defaults: AssistantOperatorDefaults | null | undefined,
): string[] {
  const backend = defaults?.backend
  if (backend?.adapter === 'codex-cli' && backend.codexHome) {
    return [`Use the saved Codex home at ${backend.codexHome}.`]
  }

  return backend?.adapter === 'openai-compatible' && backend.apiKeyEnv
    ? [
        `Export ${backend.apiKeyEnv} before using the saved OpenAI-compatible assistant backend.`,
      ]
    : []
}

function buildSetupAssistantWizardInputFromDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
): SetupAssistantWizardInput {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return {}
  }

  switch (backend.adapter) {
    case 'openai-compatible': {
      const savedDefaults = resolveAssistantProviderDefaults(
        defaults ?? null,
        'openai-compatible',
      )

      return {
        initialAssistantPreset: 'openai-compatible',
        initialAssistantBaseUrl: savedDefaults?.baseUrl ?? undefined,
        initialAssistantApiKeyEnv: savedDefaults?.apiKeyEnv ?? undefined,
        initialAssistantProviderName: savedDefaults?.providerName ?? undefined,
      }
    }
    case 'codex-cli':
    default:
      return {
        initialAssistantPreset: 'codex',
        initialAssistantOss: backend.oss === true ? true : undefined,
      }
  }
}
