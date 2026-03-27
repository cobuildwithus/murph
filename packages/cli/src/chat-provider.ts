import { generateText } from 'ai'
import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from './assistant-cli-contracts.js'
import type { AssistantProviderTraceEvent } from './assistant/provider-traces.js'
import {
  executeCodexPrompt,
  type CodexProgressEvent,
} from './assistant-codex.js'
import { getAssistantBindingContextLines } from './assistant/bindings.js'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from './assistant/provider-config.js'
import { normalizeNullableString } from './assistant/shared.js'
import { resolveAssistantLanguageModel } from './model-harness.js'
import { VaultCliError } from './vault-cli-errors.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2

export interface AssistantProviderProgressEvent extends CodexProgressEvent {}

export interface AssistantProviderTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string
  configOverrides?: readonly string[]
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext?: string | null
  env?: NodeJS.ProcessEnv
  model?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean
  profile?: string | null
  prompt?: string
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  resumeProviderSessionId?: string | null
  sandbox?: AssistantSandbox | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  userPrompt?: string | null
  workingDirectory: string
}

export interface AssistantProviderTurnResult {
  provider: AssistantChatProvider
  providerSessionId: string | null
  response: string
  stderr: string
  stdout: string
  rawEvents: unknown[]
}

export interface AssistantProviderCapabilities {
  supportsDirectCliExecution: boolean
}

export function resolveAssistantProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}) {
  return serializeAssistantProviderSessionOptions(input)
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return {
    supportsDirectCliExecution: provider === 'codex-cli',
  }
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnResult> {
  const provider = input.provider ?? 'codex-cli'
  const prompt = flattenAssistantProviderPrompt(input)
  const providerConfig = normalizeAssistantProviderConfig(input)

  switch (provider) {
    case 'codex-cli': {
      const result = await executeCodexPrompt({
        codexCommand: providerConfig.codexCommand ?? undefined,
        configOverrides: mergeCodexConfigOverrides({
          configOverrides: input.configOverrides,
          showThinkingTraces: input.showThinkingTraces ?? false,
        }),
        abortSignal: input.abortSignal,
        env: input.env,
        workingDirectory: input.workingDirectory,
        prompt,
        resumeSessionId: input.resumeProviderSessionId,
        model: providerConfig.model ?? undefined,
        reasoningEffort: providerConfig.reasoningEffort ?? undefined,
        sandbox: providerConfig.sandbox ?? undefined,
        approvalPolicy: providerConfig.approvalPolicy ?? undefined,
        profile: providerConfig.profile ?? undefined,
        oss: providerConfig.oss ?? false,
        onProgress: input.onEvent ?? undefined,
        onTraceEvent: input.onTraceEvent,
      })

      return {
        provider,
        providerSessionId: result.sessionId,
        response: result.finalMessage,
        stderr: result.stderr,
        stdout: result.stdout,
        rawEvents: result.jsonEvents,
      }
    }

    case 'openai-compatible': {
      const baseUrl = providerConfig.baseUrl
      const model = providerConfig.model
      if (!baseUrl) {
        throw new VaultCliError(
          'ASSISTANT_BASE_URL_REQUIRED',
          'The openai-compatible assistant provider requires a base URL.',
        )
      }
      if (!model) {
        throw new VaultCliError(
          'ASSISTANT_MODEL_REQUIRED',
          'The openai-compatible assistant provider requires a model id.',
        )
      }

      const resolvedEnv = {
        ...process.env,
        ...(input.env ?? {}),
      }
      const apiKeyEnv = providerConfig.apiKeyEnv
      const languageModel = resolveAssistantLanguageModel({
        apiKey:
          apiKeyEnv && typeof resolvedEnv[apiKeyEnv] === 'string'
            ? resolvedEnv[apiKeyEnv]
            : undefined,
        apiKeyEnv: apiKeyEnv ?? undefined,
        baseUrl,
        model,
        providerName: providerConfig.providerName ?? undefined,
      })
      const result = await generateText({
        model: languageModel,
        system: normalizeNullableString(input.systemPrompt) ?? undefined,
        messages: buildAssistantProviderMessages({
          conversationMessages: input.conversationMessages,
          prompt: input.prompt,
          sessionContext: input.sessionContext,
          userPrompt: input.userPrompt,
        }),
        abortSignal: input.abortSignal,
        timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
        maxRetries: OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
      })

      return {
        provider,
        providerSessionId: null,
        response: result.text,
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    }

    default:
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        `Assistant provider "${provider}" is not supported in this build.`,
      )
  }
}

export function flattenAssistantProviderPrompt(
  input: Pick<
    AssistantProviderTurnInput,
    'continuityContext' | 'prompt' | 'sessionContext' | 'systemPrompt' | 'userPrompt'
  >,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new VaultCliError(
      'ASSISTANT_PROMPT_REQUIRED',
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const systemPrompt = normalizeNullableString(input.systemPrompt)
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []

  return [
    systemPrompt,
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    normalizeNullableString(input.continuityContext),
    `User message:\n${userPrompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

export function buildAssistantProviderMessages(
  input: Pick<
    AssistantProviderTurnInput,
    'continuityContext' | 'conversationMessages' | 'prompt' | 'sessionContext' | 'userPrompt'
  >,
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return [
      ...normalizeConversationMessages(input.conversationMessages),
      {
        role: 'user',
        content: explicitPrompt,
      },
    ]
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new VaultCliError(
      'ASSISTANT_PROMPT_REQUIRED',
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []
  const userContent = [
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    normalizeNullableString(input.continuityContext),
    userPrompt,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')

  return [
    ...normalizeConversationMessages(input.conversationMessages),
    {
      role: 'user',
      content: userContent,
    },
  ]
}

function normalizeConversationMessages(
  messages: AssistantProviderTurnInput['conversationMessages'],
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  return (messages ?? [])
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
}

function mergeCodexConfigOverrides(input: {
  configOverrides?: readonly string[]
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides = [...(input.configOverrides ?? [])]

  if (!input.showThinkingTraces) {
    return overrides.length > 0 ? overrides : input.configOverrides
  }

  upsertCodexConfigOverride(overrides, 'model_reasoning_summary', '"auto"')
  upsertCodexConfigOverride(overrides, 'hide_agent_reasoning', 'false')

  return overrides
}

function upsertCodexConfigOverride(
  overrides: string[],
  key: string,
  value: string,
): void {
  const assignmentPrefix = `${key}=`
  const existingIndex = overrides.findIndex((override) =>
    override.trim().startsWith(assignmentPrefix),
  )

  if (existingIndex >= 0) {
    overrides[existingIndex] = `${key}=${value}`
    return
  }

  overrides.push(`${key}=${value}`)
}
