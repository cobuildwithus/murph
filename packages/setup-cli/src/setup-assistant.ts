import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import {
  discoverAssistantProviderModels,
  resolveAssistantTargetCapabilities,
  type AssistantModelDiscoveryResult,
} from '@murphai/assistant-engine/assistant/provider-catalog'
import {
  getOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromId,
  type OpenAICompatibleProviderPreset,
} from '@murphai/assistant-engine/assistant-provider'
import { normalizeNullableString } from '@murphai/operator-config/assistant/shared'
import {
  createSetupAssistantAccountResolver,
  formatSetupAssistantAccountLabel,
  type SetupAssistantAccountResolver,
} from './setup-assistant-account.js'
import { prepareSetupPromptInput } from '@murphai/operator-config/setup-prompt-io'
import {
  type SetupAssistantPreset,
  type SetupCommandOptions,
  type SetupConfiguredAssistant,
} from '@murphai/operator-config/setup-cli-contracts'

export const DEFAULT_SETUP_ASSISTANT_PRESET: SetupAssistantPreset = 'codex'
export const DEFAULT_SETUP_CODEX_MODEL = 'gpt-5.4'
export const DEFAULT_SETUP_CODEX_OSS_MODEL = 'gpt-oss:20b'
export const DEFAULT_SETUP_CODEX_REASONING_EFFORT = 'medium'
export const DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL =
  'http://127.0.0.1:11434/v1'
const DEFAULT_SETUP_SANDBOX = 'danger-full-access' as const
const DEFAULT_SETUP_APPROVAL_POLICY = 'never' as const

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
  }) => Promise<AssistantModelDiscoveryResult>
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
    | 'assistantProviderPreset'
    | 'assistantModel'
    | 'assistantBaseUrl'
    | 'assistantApiKeyEnv'
    | 'assistantProviderName'
    | 'assistantCodexCommand'
    | 'assistantProfile'
    | 'assistantReasoningEffort'
    | 'assistantOss'
  >,
): boolean {
  return Boolean(
    options.assistantPreset ||
      options.assistantProviderPreset ||
      options.assistantModel ||
      options.assistantBaseUrl ||
      options.assistantApiKeyEnv ||
      options.assistantProviderName ||
      options.assistantCodexCommand ||
      options.assistantProfile ||
      options.assistantReasoningEffort ||
      options.assistantOss,
  )
}

export function inferSetupAssistantPresetFromOptions(
  options: Pick<
    SetupCommandOptions,
    | 'assistantPreset'
    | 'assistantProviderPreset'
    | 'assistantModel'
    | 'assistantBaseUrl'
    | 'assistantApiKeyEnv'
    | 'assistantProviderName'
    | 'assistantCodexCommand'
    | 'assistantProfile'
    | 'assistantReasoningEffort'
    | 'assistantOss'
  >,
): SetupAssistantPreset | null {
  if (options.assistantPreset) {
    return options.assistantPreset
  }

  if (
    options.assistantProviderPreset ||
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
    options.assistantReasoningEffort ||
    options.assistantOss
  ) {
    return 'codex'
  }

  return null
}

export function resolveSetupAssistantProviderPreset(
  options: Pick<
    SetupCommandOptions,
    | 'assistantProviderPreset'
    | 'assistantBaseUrl'
    | 'assistantApiKeyEnv'
    | 'assistantProviderName'
  >,
): OpenAICompatibleProviderPreset | null {
  const explicitPreset = resolveOpenAICompatibleProviderPresetFromId(
    normalizeNullableString(options.assistantProviderPreset),
  )
  if (explicitPreset) {
    return explicitPreset
  }

  return resolveOpenAICompatibleProviderPreset({
    apiKeyEnv: normalizeNullableString(options.assistantApiKeyEnv),
    baseUrl: normalizeNullableString(options.assistantBaseUrl),
    providerName: normalizeNullableString(options.assistantProviderName),
  })
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
      await discoverAssistantProviderModels({
        provider: 'openai-compatible',
        baseUrl: input.baseUrl,
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
              'Skipped assistant setup. Murph will keep your current assistant settings as they are.',
          }
          break

        case 'codex': {
          const useLocalModel = resolutionInput.options.assistantOss === true
          const model = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantModel) ??
              (useLocalModel
                ? DEFAULT_SETUP_CODEX_OSS_MODEL
                : DEFAULT_SETUP_CODEX_MODEL),
            input,
            output,
            prompt: useLocalModel
              ? 'Default local model to use with Codex'
              : 'Default model to use with Codex',
          })

          resolvedAssistant = {
            preset: 'codex',
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
              ) ?? DEFAULT_SETUP_CODEX_REASONING_EFFORT,
            sandbox: DEFAULT_SETUP_SANDBOX,
            approvalPolicy: DEFAULT_SETUP_APPROVAL_POLICY,
            oss: useLocalModel,
            account: null,
            detail: buildCodexAssistantDetail({
              model,
              oss: useLocalModel,
            }),
          }
          break
        }

        case 'openai-compatible': {
          const explicitReasoningEffort = normalizeNullableString(
            resolutionInput.options.assistantReasoningEffort,
          )

          const providerPreset =
            resolveSetupAssistantProviderPreset(resolutionInput.options) ??
            resolveOpenAICompatibleProviderPreset({
              baseUrl: DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
            }) ??
            getOpenAICompatibleProviderPreset('custom')
          const baseUrl = await resolvePromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(resolutionInput.options.assistantBaseUrl) ??
              providerPreset.baseUrl ??
              DEFAULT_SETUP_OPENAI_COMPATIBLE_BASE_URL,
            input,
            output,
            prompt: buildSetupAssistantBaseUrlPrompt(providerPreset),
          })

          const apiKeyEnv = await resolveOptionalPromptedValue({
            allowPrompt: resolutionInput.allowPrompt,
            defaultValue:
              normalizeNullableString(
                resolutionInput.options.assistantApiKeyEnv,
              ) ??
              providerPreset.apiKeyEnv ??
              null,
            input,
            output,
            prompt: buildSetupAssistantApiKeyEnvPrompt(providerPreset),
          })
          const providerName =
            normalizeNullableString(
              resolutionInput.options.assistantProviderName,
            ) ?? providerPreset.providerName
          const discovery =
            normalizeNullableString(resolutionInput.options.assistantModel) === null
              ? await discoverModels({
                  baseUrl,
                  apiKeyEnv,
                  providerName,
                })
              : null

          const model = await resolveOpenAICompatibleModel({
            allowPrompt: resolutionInput.allowPrompt,
            discovery,
            explicitModel: normalizeNullableString(
              resolutionInput.options.assistantModel,
            ),
            input,
            output,
          })
          if (
            explicitReasoningEffort &&
            !resolveAssistantTargetCapabilities({
              provider: 'openai-compatible',
              apiKeyEnv,
              baseUrl,
              model,
              providerName,
            }).supportsReasoningEffort
          ) {
            throw new Error(
              'The resolved OpenAI-compatible target does not support assistantReasoningEffort.',
            )
          }

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
            reasoningEffort: explicitReasoningEffort,
            sandbox: null,
            approvalPolicy: null,
            oss: false,
            account: null,
            detail: buildOpenAICompatibleAssistantDetail({
              apiKeyEnv,
              baseUrl,
              model,
              providerTitle: providerPreset.title,
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
  discovery: AssistantModelDiscoveryResult | null
  explicitModel: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}): Promise<string> {
  const discoveredModels = input.discovery?.models.map((model) => model.id) ?? []

  if (input.explicitModel) {
    return input.explicitModel
  }

  if (!input.allowPrompt) {
    const discoveredModel = discoveredModels[0] ?? null
    if (discoveredModel) {
      return discoveredModel
    }

    throw new Error(
      input.discovery?.message
        ? `OpenAI-compatible setup requires an explicit model when discovery does not return any models. ${input.discovery.message}`
        : 'OpenAI-compatible setup requires an explicit model when discovery does not return any models.',
    )
  }

  if (input.discovery?.message) {
    input.output.write(`\n${input.discovery.message}\n`)
  }

  if (discoveredModels.length > 0) {
    input.output.write('\nAvailable models:\n')
    for (const [index, model] of discoveredModels.entries()) {
      input.output.write(`  ${index + 1}. ${model}\n`)
    }

    const choice = await resolveOptionalPromptedValue({
      allowPrompt: true,
      defaultValue: '1',
      input: input.input,
      output: input.output,
      prompt: 'Pick a model number or type a model id',
    })

    if (choice) {
      const numericIndex = Number.parseInt(choice, 10)
      if (
        Number.isFinite(numericIndex) &&
        numericIndex >= 1 &&
        numericIndex <= discoveredModels.length
      ) {
        return discoveredModels[numericIndex - 1] ?? discoveredModels[0] ?? ''
      }

      return choice
    }
  }

  return await resolveRequiredPromptedValue({
    allowPrompt: true,
    input: input.input,
    output: input.output,
    prompt: 'Default model to use',
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
  providerTitle?: string | null
}): string {
  const providerLabel =
    normalizeNullableString(input.providerTitle) ?? input.baseUrl

  if (input.apiKeyEnv) {
    return `Use ${input.model} from ${providerLabel}. Murph will read the key from ${input.apiKeyEnv}.`
  }

  return `Use ${input.model} from ${providerLabel}.`
}

function buildCodexAssistantDetail(input: {
  model: string
  oss: boolean
}): string {
  return input.oss
    ? `Use Codex with the local model ${input.model}.`
    : `Use Codex with ${input.model}.`
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

function buildSetupAssistantBaseUrlPrompt(
  providerPreset: OpenAICompatibleProviderPreset,
): string {
  if (providerPreset.id === 'custom') {
    return 'Model endpoint URL'
  }

  return `${providerPreset.title} endpoint URL`
}

function buildSetupAssistantApiKeyEnvPrompt(
  providerPreset: OpenAICompatibleProviderPreset,
): string {
  if (providerPreset.kind === 'local') {
    return 'API key env var name (leave blank if this local endpoint does not need one)'
  }

  if (providerPreset.id === 'custom') {
    return 'API key env var name (leave blank if this endpoint does not need one)'
  }

  return `${providerPreset.title} API key env var name (leave blank if this endpoint does not need one)`
}
