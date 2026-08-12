import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import { normalizeNullableString } from '@murphai/operator-config/assistant/shared'
import {
  normalizeAssistantCodexModelProvider,
  resolveAssistantCodexLocalOnboardingProviderConfig,
  resolveAssistantCodexModelProviderConfig,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  createSetupAssistantAccountResolver,
  formatSetupAssistantAccountLabel,
  type SetupAssistantAccountResolver,
} from './setup-assistant-account.js'
import {
  resolveSetupCodexHomeSelection,
  type SetupCodexHomeSelection,
} from './setup-codex-home.js'
import { prepareSetupPromptInput } from '@murphai/operator-config/setup-prompt-io'
import {
  type SetupAssistantPreset,
  type SetupCommandOptions,
  type SetupConfiguredAssistant,
} from '@murphai/operator-config/setup-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const DEFAULT_SETUP_ASSISTANT_PRESET: SetupAssistantPreset = 'codex'
export const DEFAULT_SETUP_CODEX_MODEL = 'gpt-5.6-terra'
export const DEFAULT_SETUP_CODEX_OSS_MODEL = 'gpt-oss:20b'
export const DEFAULT_SETUP_CODEX_REASONING_EFFORT = 'low'
const DEFAULT_SETUP_SANDBOX = 'danger-full-access' as const
const DEFAULT_SETUP_APPROVAL_POLICY = 'never' as const

type SetupAssistantOptionSubset = Pick<
  SetupCommandOptions,
  | 'assistantCodexCommand'
  | 'assistantCodexHome'
  | 'assistantModel'
  | 'assistantModelProvider'
  | 'assistantOss'
  | 'assistantPreset'
  | 'assistantProfile'
  | 'assistantReasoningEffort'
>

export interface ResolveSetupAssistantInput {
  allowPrompt: boolean
  commandName: string
  options: SetupCommandOptions
  preset: SetupAssistantPreset
}

export interface SetupAssistantResolver {
  resolve(input: ResolveSetupAssistantInput): Promise<SetupConfiguredAssistant>
}

interface SetupAssistantResolverDependencies {
  assistantAccount?: SetupAssistantAccountResolver
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  resolveCodexHome?: (input: {
    allowPrompt: boolean
    currentCodexHome?: string | null
    explicitCodexHome?: string | null
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
  }) => Promise<SetupCodexHomeSelection>
}

export function getDefaultSetupAssistantPreset(): SetupAssistantPreset {
  return DEFAULT_SETUP_ASSISTANT_PRESET
}

export function hasExplicitSetupAssistantOptions(
  options: Partial<SetupAssistantOptionSubset>,
): boolean {
  return Boolean(
    options.assistantPreset ||
      options.assistantModel ||
      options.assistantModelProvider ||
      options.assistantCodexCommand ||
      options.assistantCodexHome ||
      options.assistantProfile ||
      options.assistantReasoningEffort ||
      options.assistantOss !== undefined,
  )
}

export function inferSetupAssistantPresetFromOptions(
  options: Partial<SetupAssistantOptionSubset>,
): SetupAssistantPreset | null {
  if (options.assistantPreset) {
    return options.assistantPreset
  }

  if (
    options.assistantModel ||
    options.assistantModelProvider ||
    options.assistantCodexCommand ||
    options.assistantCodexHome ||
    options.assistantProfile ||
    options.assistantReasoningEffort ||
    options.assistantOss !== undefined
  ) {
    return 'codex'
  }

  return null
}

export function createSetupAssistantResolver(
  dependencies: SetupAssistantResolverDependencies = {},
): SetupAssistantResolver {
  const assistantAccount =
    dependencies.assistantAccount ?? createSetupAssistantAccountResolver()
  const input = dependencies.input ?? defaultInput
  const output = dependencies.output ?? defaultOutput
  const resolveCodexHome =
    dependencies.resolveCodexHome ?? resolveSetupCodexHomeSelection

  return {
    async resolve(resolutionInput) {
      let resolvedAssistant: SetupConfiguredAssistant
      switch (resolutionInput.preset) {
        case 'skip':
          assertNoAssistantSkipOptionConflict(resolutionInput.options)
          resolvedAssistant = {
            preset: 'skip',
            enabled: false,
            provider: null,
            model: null,
            modelProvider: null,
            codexCommand: null,
            codexHome: null,
            profile: null,
            reasoningEffort: null,
            sandbox: null,
            approvalPolicy: null,
            oss: null,
            account: null,
            detail:
              'Skipped assistant setup. Murph will keep your current assistant settings as they are.',
          }
          break

        case 'codex': {
          const useLocalModel = resolutionInput.options.assistantOss === true
          const modelProvider = resolveSetupAssistantModelProvider(
            resolutionInput.options.assistantModelProvider,
          )
          const localProviderConfig =
            resolveAssistantCodexLocalOnboardingProviderConfig(modelProvider)

          if (useLocalModel && modelProvider) {
            throw new VaultCliError(
              'invalid_option',
              '--assistant-model-provider cannot be used with --assistant-oss.',
            )
          }

          if (
            !resolutionInput.allowPrompt &&
            modelProvider &&
            localProviderConfig?.defaultModel === null &&
            !normalizeNullableString(resolutionInput.options.assistantModel)
          ) {
            throw new VaultCliError(
              'invalid_option',
              `--assistant-model is required when --assistant-model-provider ${modelProvider} is selected.`,
            )
          }

          const selectedCodexHome = await resolveCodexHome({
            allowPrompt: resolutionInput.allowPrompt,
            currentCodexHome:
              normalizeNullableString(
                resolutionInput.options.assistantCodexHome,
              ) ?? null,
            explicitCodexHome:
              resolutionInput.allowPrompt
                ? null
                : (resolutionInput.options.assistantCodexHome ?? null),
            input,
            output,
          })
          const model = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantModel) ??
              (localProviderConfig
                ? localProviderConfig.defaultModel
                : useLocalModel
                  ? DEFAULT_SETUP_CODEX_OSS_MODEL
                  : DEFAULT_SETUP_CODEX_MODEL),
            input,
            output,
            prompt:
              localProviderConfig?.modelPrompt ??
              (useLocalModel
                ? 'Local model id to use with Codex'
                : 'Model id to use with Codex'),
          })
          const normalizedModel = normalizeSetupAssistantModelId(model)

          resolvedAssistant = {
            preset: 'codex',
            enabled: true,
            provider: 'codex-cli',
            model: normalizedModel,
            modelProvider,
            codexCommand:
              normalizeNullableString(
                resolutionInput.options.assistantCodexCommand,
              ) ?? null,
            codexHome: selectedCodexHome.codexHome,
            profile:
              normalizeNullableString(resolutionInput.options.assistantProfile) ??
              null,
            reasoningEffort:
              normalizeNullableString(
                resolutionInput.options.assistantReasoningEffort,
              ) ?? DEFAULT_SETUP_CODEX_REASONING_EFFORT,
            sandbox: DEFAULT_SETUP_SANDBOX,
            approvalPolicy: DEFAULT_SETUP_APPROVAL_POLICY,
            oss: useLocalModel,
            account: null,
            detail: buildCodexAssistantDetail({
              codexHome: selectedCodexHome.codexHome,
              model: normalizedModel,
              modelProvider,
              oss: useLocalModel,
            }),
          }
          break
        }
      }

      const detectedAccount = shouldDetectSetupAssistantAccount(resolvedAssistant)
        ? await assistantAccount.resolve({
            assistant: resolvedAssistant,
          })
        : null

      return detectedAccount === null
        ? resolvedAssistant
        : {
            ...resolvedAssistant,
            account: detectedAccount,
            detail: appendDetectedAssistantAccountDetail(
              resolvedAssistant.detail,
              detectedAccount,
            ),
          }
    },
  }
}

function assertNoAssistantSkipOptionConflict(options: SetupCommandOptions): void {
  const conflicts = ([
    ['--assistant-model-provider', options.assistantModelProvider],
    ['--assistant-model', options.assistantModel],
    ['--assistant-oss', options.assistantOss],
    ['--assistant-codex-command', options.assistantCodexCommand],
    ['--assistant-codex-home', options.assistantCodexHome],
    ['--assistant-profile', options.assistantProfile],
    ['--assistant-reasoning-effort', options.assistantReasoningEffort],
  ] as const).flatMap(([flag, value]) =>
    value === undefined ? [] : [flag],
  )

  if (conflicts.length === 0) {
    return
  }

  throw new VaultCliError(
    'SETUP_ASSISTANT_PRESET_CONFLICT',
    `${conflicts[0]} cannot be used with --assistant-preset skip.`,
  )
}

function shouldDetectSetupAssistantAccount(
  assistant: SetupConfiguredAssistant,
): boolean {
  return (
    assistant.enabled &&
    assistant.provider !== null &&
    assistant.modelProvider === null &&
    assistant.oss !== true
  )
}

function resolveSetupAssistantModelProvider(
  value: string | null | undefined,
): string | null {
  const raw = normalizeNullableString(value)
  if (!raw) {
    return null
  }

  const normalized = normalizeAssistantCodexModelProvider(raw)
  if (
    !normalized ||
    !resolveAssistantCodexModelProviderConfig(normalized) ||
    !resolveAssistantCodexLocalOnboardingProviderConfig(normalized)
  ) {
    throw new VaultCliError(
      'invalid_option',
      `Unknown Codex model provider: ${raw}.`,
    )
  }

  return normalized
}

function normalizeSetupAssistantModelId(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'invalid_option',
      'Assistant model id is required.',
    )
  }

  if (/[\r\n\p{Cc}]/u.test(normalized)) {
    throw new VaultCliError(
      'invalid_option',
      'Assistant model id must be a single line without control characters.',
    )
  }

  return normalized
}

async function resolvePromptedValue(input: {
  allowPrompt: boolean
  defaultValue: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  prompt: string
}): Promise<string> {
  const explicitDefault = normalizeNullableString(input.defaultValue)
  if (!input.allowPrompt) {
    return explicitDefault ?? ''
  }

  const response = await promptWithDefault({
    defaultValue: explicitDefault,
    input: input.input,
    output: input.output,
    prompt: input.prompt,
  })

  return response ?? explicitDefault ?? ''
}

async function promptWithDefault(input: {
  defaultValue: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  prompt: string
}): Promise<string | null> {
  prepareSetupPromptInput(input.input)
  const rl = readline.createInterface({
    input: input.input,
    output: input.output,
  })

  try {
    const suffix = input.defaultValue ? ` [${input.defaultValue}]` : ''
    const answer = await rl.question(`${input.prompt}${suffix}: `)
    return normalizeNullableString(answer) ?? input.defaultValue
  } finally {
    rl.close()
  }
}

function buildCodexAssistantDetail(input: {
  codexHome?: string | null
  model: string
  modelProvider?: string | null
  oss: boolean
}): string {
  const detail = input.oss
    ? `Use Codex with the local model ${input.model}.`
    : `Use Codex with ${input.model}.`
  const providerDetail = input.modelProvider
    ? ` Use Codex model provider ${input.modelProvider}.`
    : ''

  return input.codexHome
    ? `${detail}${providerDetail} An explicit Codex home is configured; path redacted in CLI output.`
    : `${detail}${providerDetail}`
}

function appendDetectedAssistantAccountDetail(
  detail: string,
  account: NonNullable<SetupConfiguredAssistant['account']>,
): string {
  const label = formatSetupAssistantAccountLabel(account)
  if (!label) {
    return detail
  }

  return `${detail} Detected ${label} from local Codex credentials.`
}
