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
  saveAssistantOperatorDefaultsPatch,
  type AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import {
  setupAssistantAccountSchema,
  setupCommandOptionsSchema,
  type SetupCommandOptions,
} from '@murphai/operator-config/setup-cli-contracts'
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
import type {
  runSetupAssistantWizard,
  SetupAssistantWizardInput,
  SetupAssistantWizardResult,
} from '@murphai/setup-cli/setup-assistant-wizard'

// Lazy import: the setup assistant wizard renders with ink, which must stay
// off the per-invocation CLI hot path. Load it only when the wizard runs.
const runSetupAssistantWizardLazily: typeof runSetupAssistantWizard = async (
  ...args
) => {
  const { runSetupAssistantWizard: wizard } = await import(
    '@murphai/setup-cli/setup-assistant-wizard'
  )
  return wizard(...args)
}

const modelCommandPresetSchema = z.literal('codex')

function optionalNonEmptyStringOption(description: string) {
  return z
    .string()
    .min(1)
    .optional()
    .describe(description)
}

function describePresetScopedOption(
  description: string,
  preset: z.infer<typeof modelCommandPresetSchema>,
) {
  return `${description} Only applies with \`--preset ${preset}\`.`
}

const modelCommandOptionsSchema = z.object({
  show: z
    .boolean()
    .optional()
    .describe(
      'Show the saved default assistant backend configuration without changing it. This inspects persisted defaults, not live session state. When set, no update options are allowed.',
    ),
  preset: modelCommandPresetSchema
    .optional()
    .describe(
      'Assistant backend preset to save. The CLI setup surface only accepts Codex for new model configuration.',
    ),
  model: optionalNonEmptyStringOption(
    'Model id to save for the selected backend. In non-interactive mode, pair this with `--preset` unless Murph can reuse the currently saved backend.',
  ),
  modelProvider: optionalNonEmptyStringOption(
    describePresetScopedOption(
      'Optional Codex model provider id to save.',
      'codex',
    ),
  ),
  codexCommand: optionalNonEmptyStringOption(
    `${describePresetScopedOption(
      'Optional Codex CLI executable path.',
      'codex',
    )} Defaults to \`codex\`.`,
  ),
  profile: optionalNonEmptyStringOption(
    describePresetScopedOption(
      'Optional Codex profile name to save.',
      'codex',
    ),
  ),
  codexHome: optionalNonEmptyStringOption(
    describePresetScopedOption(
      'Optional Codex home directory to save.',
      'codex',
    ),
  ),
  reasoningEffort: z
    .enum(assistantReasoningEffortValues)
    .optional()
    .describe(
      'Optional assistant reasoning effort default to save for the selected backend. Use the matching `--preset` when Murph cannot infer the backend non-interactively.',
    ),
  oss: z
    .boolean()
    .optional()
    .describe(
      describePresetScopedOption(
        'Save a local Codex OSS model target instead of the signed-in Codex cloud path.',
        'codex',
      ),
    ),
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
type ModelCommandResult = z.infer<typeof modelCommandResultSchema>
type ModelCommandBackend = NonNullable<ModelCommandResult['backend']>

const REDACTED_CODEX_PATH_FOR_DISPLAY = '[path]' as const

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
    dependencies.assistantWizard ?? runSetupAssistantWizardLazily
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
      'Show or update the saved default assistant backend configuration that Murph reuses for future chats and auto-reply. This inspects saved defaults, not the provider or model used by recent turns.',
    examples: [
      {
        description: 'Show the currently saved default assistant backend.',
        options: {
          show: true,
        },
      },
      {
        description: 'Interactively refresh the saved Codex backend using the existing setup prompts.',
      },
      {
        description: 'Save a Codex model id without re-running onboarding.',
        options: {
          preset: 'codex',
          model: 'gpt-5.6-terra',
        },
      },
    ],
    hint:
      'Run `murph model` in a TTY to refresh Codex model setup. In non-interactive contexts, use `murph model --show` to inspect saved defaults, or pass `--preset codex` plus Codex options to update them.',
    options: modelCommandOptionsSchema,
    output: modelCommandResultSchema,
    async run({ options }) {
      const homeDirectory = resolveHomeDirectory()
      let existingDefaults: AssistantOperatorDefaults | null
      try {
        existingDefaults = await readDefaults(homeDirectory)
      } catch (error) {
        if (!hasErrorCode(error, 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED')) {
          throw error
        }

        if (options.show || !hasModelUpdateOptions(options)) {
          throwModelCommandError(error)
        }

        existingDefaults = null
      }

      if (options.show) {
        assertShowOnly(options)
        try {
          return buildModelCommandResult({
            action: 'show',
            changed: false,
            defaults: existingDefaults,
          })
        } catch (error) {
          throwModelCommandError(error)
        }
      }

      const allowPrompt = terminal.stdinIsTTY && terminal.stderrIsTTY
      const wizardSelection =
        allowPrompt && shouldRunModelAssistantWizard(options)
          ? await assistantWizard({
              enableApiKeyProviderOnboarding: false,
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
          options: resolvedOptions,
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
        backend: sanitizeAssistantBackendForOutput(currentDefaults?.backend ?? null),
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

function hasCodexModelOptions(options: ModelCommandOptions): boolean {
  return (
    options.codexCommand !== undefined ||
    options.codexHome !== undefined ||
    options.modelProvider !== undefined ||
    options.profile !== undefined ||
    options.oss !== undefined
  )
}

function hasModelSelectionOptions(options: ModelCommandOptions): boolean {
  return (
    options.model !== undefined ||
    options.reasoningEffort !== undefined
  )
}

function hasModelUpdateOptions(options: ModelCommandOptions): boolean {
  return (
    options.preset !== undefined ||
    hasModelSelectionOptions(options) ||
    hasCodexModelOptions(options)
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
    ...(wizardSelection.assistantPreset === 'codex' &&
    wizardSelection.assistantOss !== undefined
      ? {
          oss: wizardSelection.assistantOss ?? undefined,
        }
      : {}),
    ...(wizardSelection.assistantPreset === 'codex' &&
    'assistantModelProvider' in wizardSelection
      ? {
          modelProvider: wizardSelection.assistantModelProvider ?? undefined,
        }
      : {}),
  }
}

async function resolveModelCommandPreset(input: {
  allowPrompt: boolean
  options: ModelCommandOptions
}): Promise<ModelCommandPreset> {
  if (input.options.preset) {
    return input.options.preset
  }

  if (hasCodexModelOptions(input.options) || hasModelSelectionOptions(input.options)) {
    return 'codex'
  }

  if (!input.allowPrompt) {
    throw new VaultCliError(
      'invalid_option',
      'Run `murph model --show` to inspect saved defaults, or pass `--preset codex` plus Codex options to update them non-interactively.',
    )
  }

  return 'codex'
}

function assertCompatibleModelCommandOptions(
  _preset: ModelCommandPreset,
  _options: ModelCommandOptions,
): void {
}

function createModelSetupOptions(input: {
  defaults: AssistantOperatorDefaults | null
  options: ModelCommandOptions
  preset: ModelCommandPreset
  wizardSelection?: SetupAssistantWizardResult | null
}): SetupCommandOptions {
  const savedAssistantOptions = buildModelSetupAssistantOptionsFromDefaults(
    input.defaults,
  )
  if (input.wizardSelection) {
    delete savedAssistantOptions.assistantModel
    delete savedAssistantOptions.assistantOss
    if ('assistantModelProvider' in input.wizardSelection) {
      delete savedAssistantOptions.assistantModelProvider
    }
  }
  const wizardAssistantModelProvider =
    input.wizardSelection && 'assistantModelProvider' in input.wizardSelection
      ? input.wizardSelection.assistantModelProvider
      : undefined

  return setupCommandOptionsSchema.parse({
    vault: './vault',
    ...savedAssistantOptions,
    assistantPreset: input.preset,
    ...(input.options.model !== undefined
      ? {
          assistantModel: input.options.model,
        }
      : {}),
    ...(input.options.modelProvider !== undefined
      ? { assistantModelProvider: input.options.modelProvider }
      : wizardAssistantModelProvider
        ? { assistantModelProvider: wizardAssistantModelProvider }
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
    ...(input.options.codexHome !== undefined
      ? {
          assistantCodexHome: input.options.codexHome,
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
): Partial<SetupCommandOptions> {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return {}
  }

  return buildSetupAssistantOptionsFromDefaults(defaults)
}

function throwModelCommandError(error: unknown): never {
  if (hasErrorCode(error, 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED')) {
    throw new VaultCliError(
      'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED',
      error instanceof Error
        ? error.message
        : 'Assistant runtimes must use Codex App Server. Reconfigure the assistant for Codex App Server.',
    )
  }

  throw error
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

function buildModelCommandResult(input: {
  action: 'show' | 'set'
  changed: boolean
  defaults: AssistantOperatorDefaults | null
}) {
  const backend = sanitizeAssistantBackendForOutput(input.defaults?.backend ?? null)

  return {
    action: input.action,
    changed: input.changed,
    configured: backend !== null,
    backend,
    account: input.defaults?.account ?? null,
    summary: formatSavedAssistantDefaultsSummary(input.defaults),
    notes: buildAssistantBackendNotes(input.defaults),
  }
}

function buildAssistantBackendNotes(
  defaults: AssistantOperatorDefaults | null | undefined,
): string[] {
  const backend = defaults?.backend
  if (backend?.codexHome) {
    return ['A saved Codex home is configured; path redacted in CLI output.']
  }

  return []
}

function sanitizeAssistantBackendForOutput(
  backend: AssistantOperatorDefaults['backend'] | null | undefined,
): ModelCommandBackend | null {
  if (!backend) {
    return null
  }

  return {
    ...backend,
    codexCommand: redactCodexPathForDisplay(backend.codexCommand),
    ...(backend.codexHome
      ? { codexHome: REDACTED_CODEX_PATH_FOR_DISPLAY }
      : {}),
  }
}

function redactCodexPathForDisplay(value: string | null | undefined) {
  return value ? REDACTED_CODEX_PATH_FOR_DISPLAY : (value ?? null)
}

function buildSetupAssistantWizardInputFromDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
): SetupAssistantWizardInput {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return {}
  }

  return {
    initialAssistantPreset: 'codex',
    initialAssistantModelProvider: backend.modelProvider ?? null,
    initialAssistantOss: backend.oss === true ? true : undefined,
  }
}
