import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import { normalizeNullableString } from './assistant/shared.js'
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
export const DEFAULT_SETUP_OPENAI_COMPATIBLE_MODEL = 'local-model'
const DEFAULT_SETUP_SANDBOX = 'workspace-write' as const
const DEFAULT_SETUP_APPROVAL_POLICY = 'on-request' as const
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500
const MAX_DISCOVERED_MODELS = 12

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
  discoverModels?: (baseUrl: string) => Promise<string[]>
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
    dependencies.discoverModels ?? defaultDiscoverOpenAICompatibleModels
  const input = dependencies.input ?? defaultInput
  const output = dependencies.output ?? defaultOutput

  return {
    async resolve(resolutionInput) {
      switch (resolutionInput.preset) {
        case 'skip':
          return {
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
            detail:
              'Skipped saving assistant defaults during setup. Healthy Bob will keep any existing assistant config unchanged.',
          }

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

          return {
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
            detail: `Use Codex CLI with ${model}.`,
          }
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

          return {
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
            detail: `Use Codex CLI in OSS mode with ${model}.`,
          }
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

          const discoveredModels =
            normalizeNullableString(resolutionInput.options.assistantModel) === null &&
            resolutionInput.allowPrompt
              ? await discoverModels(baseUrl)
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

          return {
            preset: 'openai-compatible',
            enabled: true,
            provider: 'openai-compatible',
            model,
            baseUrl,
            apiKeyEnv,
            providerName:
              normalizeNullableString(
                resolutionInput.options.assistantProviderName,
              ) ?? null,
            codexCommand: null,
            profile: null,
            reasoningEffort:
              normalizeNullableString(
                resolutionInput.options.assistantReasoningEffort,
              ) ?? null,
            sandbox: null,
            approvalPolicy: null,
            oss: false,
            detail: buildOpenAICompatibleAssistantDetail({
              apiKeyEnv,
              baseUrl,
              model,
            }),
          }
        }
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
    return input.discoveredModels[0] ?? DEFAULT_SETUP_OPENAI_COMPATIBLE_MODEL
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
        return input.discoveredModels[numericIndex - 1] ??
          DEFAULT_SETUP_OPENAI_COMPATIBLE_MODEL
      }

      return choice
    }
  }

  return await resolvePromptedValue({
    allowPrompt: true,
    defaultValue: DEFAULT_SETUP_OPENAI_COMPATIBLE_MODEL,
    input: input.input,
    output: input.output,
    prompt: 'Default model for the OpenAI-compatible endpoint',
  })
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

async function defaultDiscoverOpenAICompatibleModels(
  baseUrl: string,
): Promise<string[]> {
  try {
    const modelsUrl = new URL('models', ensureTrailingSlash(baseUrl))
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)
        : undefined
    const response = await fetch(modelsUrl, {
      headers: {
        accept: 'application/json',
      },
      signal: timeoutSignal,
    })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>
    }
    const discovered = (payload.data ?? [])
      .map((entry) =>
        typeof entry?.id === 'string' ? entry.id.trim() : null,
      )
      .filter((entry): entry is string => Boolean(entry))

    return [...new Set(discovered)].slice(0, MAX_DISCOVERED_MODELS)
  } catch {
    return []
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
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
