import readline from 'node:readline/promises'
import { stderr as defaultOutput, stdin as defaultInput } from 'node:process'
import { normalizeNullableString } from '@murphai/operator-config/assistant/shared'
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
export const DEFAULT_SETUP_CODEX_MODEL = 'gpt-6.1-sol'
export const DEFAULT_SETUP_CODEX_REASONING_EFFORT = 'low'
const DEFAULT_SETUP_SANDBOX = 'danger-full-access' as const
const DEFAULT_SETUP_APPROVAL_POLICY = 'never' as const

type SetupAssistantOptionSubset = Pick<
  SetupCommandOptions,
  | 'assistantCodexCommand'
  | 'assistantCodexHome'
  | 'assistantModel'
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
      options.assistantCodexCommand ||
      options.assistantCodexHome ||
      options.assistantProfile ||
      options.assistantReasoningEffort,
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
    options.assistantCodexCommand ||
    options.assistantCodexHome ||
    options.assistantProfile ||
    options.assistantReasoningEffort
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
              DEFAULT_SETUP_CODEX_MODEL,
            input,
            output,
            prompt: 'OpenAI model id to use with Codex',
          })
          const normalizedModel = normalizeSetupAssistantModelId(model)

          resolvedAssistant = {
            preset: 'codex',
            enabled: true,
            provider: 'codex-cli',
            model: normalizedModel,
            modelProvider: null,
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
            oss: false,
            account: null,
            detail: buildCodexAssistantDetail({
              codexHome: selectedCodexHome.codexHome,
              model: normalizedModel,
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
    ['--assistant-model', options.assistantModel],
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
}): string {
  const detail = `Use Codex with ${input.model}.`
  return input.codexHome
    ? `${detail} An explicit Codex home is configured; path redacted in CLI output.`
    : detail
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
