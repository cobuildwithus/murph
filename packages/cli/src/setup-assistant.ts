import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import {
  defaultDiscoverOpenAICompatibleModels,
} from './assistant/provider-catalog.js'
import { normalizeNullableString } from './assistant/shared.js'
import {
  createSetupAssistantAccountResolver,
  formatSetupAssistantAccountLabel,
  type SetupAssistantAccountResolver,
} from './setup-assistant-account.js'
import { prepareSetupPromptInput } from './setup-prompt-io.js'
import {
  type SetupAssistantPreset,
  type SetupCommandOptions,
  type SetupConfiguredAssistant,
} from './setup-cli-contracts.js'

export const DEFAULT_SETUP_ASSISTANT_PRESET: SetupAssistantPreset = 'codex-cli'
export const DEFAULT_SETUP_CODEX_MODEL = 'gpt-5.4'
export const DEFAULT_SETUP_CODEX_OSS_MODEL = 'gpt-oss:20b'
export const DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL =
  'http://127.0.0.1:11434/v1'
const DEFAULT_SETUP_SANDBOX = 'workspace-write' as const
const DEFAULT_SETUP_APPROVAL_POLICY = 'on-request' as const

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
  discoverModels?: (input: {
    apiKeyEnv?: string | null
    baseUrl: string
    providerName?: string | null
  }) => Promise<string[]>
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

export function getDefaultSetupAssistantPreset(): SetupAssistantPreset {
  return DEFAULT_SETUP_ASSISTANT_PRESET
}

export function hasExplicitSetupAssistantOptions(
  options: Pick<
    SetupCommandOptions,
    | 'assistantPreset'
    | 'assistantModel'
    | 'assistantBaseUrl'
    | 'assistantApiKeyEnv'
    | 'assistantProviderName'
    | 'assistantCodexCommand'
    | 'assistantProfile'
    | 'assistantReasoningEffort'
  >,
): boolean {
  return Boolean(
    options.assistantPreset ||
      options.assistantModel ||
      options.assistantBaseUrl ||
      options.assistantApiKeyEnv ||
      options.assistantProviderName ||
      options.assistantCodexCommand ||
      options.assistantProfile ||
      options.assistantReasoningEffort,
  )
}

export function inferSetupAssistantPresetFromOptions(
  options: Pick<
    SetupCommandOptions,
    | 'assistantPreset'
    | 'assistantModel'
    | 'assistantBaseUrl'
    | 'assistantApiKeyEnv'
    | 'assistantProviderName'
    | 'assistantCodexCommand'
    | 'assistantProfile'
    | 'assistantReasoningEffort'
  >,
): SetupAssistantPreset | null {
  if (options.assistantPreset) {
    return options.assistantPreset
  }

  if (
    options.assistantBaseUrl ||
    options.assistantApiKeyEnv ||
    options.assistantProviderName
  ) {
    return 'openai-compatible'
  }

  if (
    options.assistantModel ||
    options.assistantCodexCommand ||
    options.assistantProfile ||
    options.assistantReasoningEffort
  ) {
    return 'codex-cli'
  }

  return null
}

export function createSetupAssistantResolver(
  dependencies: SetupAssistantResolverDependencies = {},
): SetupAssistantResolver {
  const discoverModels =
    dependencies.discoverModels ??
    (async (input: {
      apiKeyEnv?: string | null
      baseUrl: string
      providerName?: string | null
    }) =>
      await defaultDiscoverOpenAICompatibleModels(input.baseUrl, {
        apiKeyEnv: input.apiKeyEnv,
        providerName: input.providerName,
      }))
  const assistantAccount =
    dependencies.assistantAccount ?? createSetupAssistantAccountResolver()
  const input = dependencies.input ?? defaultInput
  const output = dependencies.output ?? defaultOutput

  return {
    async resolve(resolutionInput) {
      let resolvedAssistant: SetupConfiguredAssistant
      switch (resolutionInput.preset) {
        case 'skip':
          resolvedAssistant = {
            preset: 'skip',
            enabled: false,
            provider: null,
            model: null,
            baseUrl: null,
            apiKeyEnv: null,
            providerName: null,
            codexCommand: null,
            profile: null,
            reasoningEffort: null,
            sandbox: null,
            approvalPolicy: null,
            oss: null,
            account: null,
            detail:
              'Skipped saving assistant defaults during setup. Healthy Bob will keep any existing assistant config unchanged.',
          }
          break

        case 'codex-cli': {
          const model = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantModel) ??
              DEFAULT_SETUP_CODEX_MODEL,
            input,
            output,
            prompt:
              'Default assistant model for Codex CLI',
          })

          resolvedAssistant = {
            preset: 'codex-cli',
            enabled: true,
            provider: 'codex-cli',
            model,
            baseUrl: null,
            apiKeyEnv: null,
            providerName: null,
            codexCommand:
              normalizeNullableString(
                resolutionInput.options.assistantCodexCommand,
              ) ?? null,
            profile:
              normalizeNullableString(resolutionInput.options.assistantProfile) ??
              null,
            reasoningEffort:
              normalizeNullableString(
                resolutionInput.options.assistantReasoningEffort,
              ) ?? null,
            sandbox: DEFAULT_SETUP_SANDBOX,
            approvalPolicy: DEFAULT_SETUP_APPROVAL_POLICY,
            oss: false,
            account: null,
            detail: buildCodexAssistantDetail({
              model,
              oss: false,
            }),
          }
          break
        }

        case 'codex-oss': {
          const model = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantModel) ??
              DEFAULT_SETUP_CODEX_OSS_MODEL,
            input,
            output,
            prompt:
              'Default local model for Codex OSS',
          })

          resolvedAssistant = {
            preset: 'codex-oss',
            enabled: true,
            provider: 'codex-cli',
            model,
            baseUrl: null,
            apiKeyEnv: null,
            providerName: null,
            codexCommand:
              normalizeNullableString(
                resolutionInput.options.assistantCodexCommand,
              ) ?? null,
            profile:
              normalizeNullableString(resolutionInput.options.assistantProfile) ??
              null,
            reasoningEffort:
              normalizeNullableString(
                resolutionInput.options.assistantReasoningEffort,
              ) ?? null,
            sandbox: DEFAULT_SETUP_SANDBOX,
            approvalPolicy: DEFAULT_SETUP_APPROVAL_POLICY,
            oss: true,
            account: null,
            detail: buildCodexAssistantDetail({
              model,
              oss: true,
            }),
          }
          break
        }

        case 'openai-compatible': {
          const baseUrl = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantBaseUrl) ??
              DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
            input,
            output,
            prompt:
              'OpenAI-compatible base URL',
          })

          const apiKeyEnv = await resolveOptionalPromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(
                resolutionInput.options.assistantApiKeyEnv,
              ) ?? null,
            input,
            output,
            prompt:
              'API key environment variable (leave blank for local/no auth)',
          })
          const providerName =
            normalizeNullableString(
              resolutionInput.options.assistantProviderName,
            ) ?? null
          const discoveredModels =
            normalizeNullableString(resolutionInput.options.assistantModel) === null
              ? await discoverModels({
                  baseUrl,
                  apiKeyEnv,
                  providerName,
                })
              : []

          const model = await resolveOpenAICompatibleModel({
            allowPrompt: resolutionInput.allowPrompt,
            discoveredModels,
            explicitModel: normalizeNullableString(
              resolutionInput.options.assistantModel,
            ),
            input,
            output,
          })

          resolvedAssistant = {
            preset: 'openai-compatible',
            enabled: true,
            provider: 'openai-compatible',
            model,
            baseUrl,
            apiKeyEnv,
            providerName,
            codexCommand: null,
            profile: null,
            reasoningEffort:
              normalizeNullableString(
                resolutionInput.options.assistantReasoningEffort,
              ) ?? null,
            sandbox: null,
            approvalPolicy: null,
            oss: false,
            account: null,
            detail: buildOpenAICompatibleAssistantDetail({
              apiKeyEnv,
              baseUrl,
              model,
            }),
          }
          break
        }
      }

      const detectedAccount = await assistantAccount.resolve({
        assistant: resolvedAssistant,
      })

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

async function resolveOpenAICompatibleModel(input: {
  allowPrompt: boolean
  discoveredModels: readonly string[]
  explicitModel: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}): Promise<string> {
  if (input.explicitModel) {
    return input.explicitModel
  }

  if (!input.allowPrompt) {
    const discoveredModel = input.discoveredModels[0] ?? null
    if (discoveredModel) {
      return discoveredModel
    }

    throw new Error(
      'OpenAI-compatible setup requires an explicit model when discovery does not return any models.',
    )
  }

  if (input.discoveredModels.length > 0) {
    input.output.write('\nDiscovered OpenAI-compatible models:\n')
    for (const [index, model] of input.discoveredModels.entries()) {
      input.output.write(`  ${index + 1}. ${model}\n`)
    }

    const choice = await resolveOptionalPromptedValue({
      allowPrompt: true,
      defaultValue: '1',
      input: input.input,
      output: input.output,
      prompt: 'Choose a model number or type a model id',
    })

    if (choice) {
      const numericIndex = Number.parseInt(choice, 10)
      if (
        Number.isFinite(numericIndex) &&
        numericIndex >= 1 &&
        numericIndex <= input.discoveredModels.length
      ) {
        return input.discoveredModels[numericIndex - 1] ?? input.discoveredModels[0] ?? ''
      }

      return choice
    }
  }

  return await resolveRequiredPromptedValue({
    allowPrompt: true,
    input: input.input,
    output: input.output,
    prompt: 'Default model for the OpenAI-compatible endpoint',
  })
}

async function resolveRequiredPromptedValue(input: {
  allowPrompt: boolean
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  prompt: string
}): Promise<string> {
  if (!input.allowPrompt) {
    return ''
  }

  while (true) {
    const response = await promptWithDefault({
      defaultValue: null,
      input: input.input,
      output: input.output,
      prompt: input.prompt,
    })

    if (response) {
      return response
    }

    input.output.write('A model id is required.\n')
  }
}

async function resolvePromptedValue(input: {
  allowPrompt: boolean
  defaultValue: string
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

async function resolveOptionalPromptedValue(input: {
  allowPrompt: boolean
  defaultValue: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  prompt: string
}): Promise<string | null> {
  if (!input.allowPrompt) {
    return input.defaultValue
  }

  return await promptWithDefault({
    defaultValue: input.defaultValue,
    input: input.input,
    output: input.output,
    prompt: input.prompt,
  })
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

function buildOpenAICompatibleAssistantDetail(input: {
  apiKeyEnv: string | null
  baseUrl: string
  model: string
}): string {
  if (input.apiKeyEnv) {
    return `Use ${input.model} through the OpenAI-compatible endpoint at ${input.baseUrl} with credentials sourced from ${input.apiKeyEnv}.`
  }

  return `Use ${input.model} through the OpenAI-compatible endpoint at ${input.baseUrl}.`
}

function buildCodexAssistantDetail(input: {
  model: string
  oss: boolean
}): string {
  return input.oss
    ? `Use Codex CLI in OSS mode with ${input.model}.`
    : `Use Codex CLI with ${input.model}.`
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
