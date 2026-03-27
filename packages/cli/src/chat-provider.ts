import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from './assistant-cli-contracts.js'
import { getAssistantBindingContextLines } from './assistant/bindings.js'
import {
  sanitizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from './assistant/provider-config.js'
import {
  executeAssistantProviderTurnWithDefinition,
  resolveAssistantProviderCapabilities as resolveAssistantRegistryProviderCapabilities,
  type AssistantProviderCapabilities,
  type AssistantProviderProgressEvent,
  type AssistantProviderTurnExecutionResult,
} from './assistant/provider-registry.js'
import type { AssistantProviderTraceEvent } from './assistant/provider-traces.js'
import { normalizeNullableString } from './assistant/shared.js'

export type { AssistantProviderProgressEvent } from './assistant/provider-registry.js'

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
  headers?: Record<string, string> | null
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

export type AssistantProviderTurnResult = AssistantProviderTurnExecutionResult

export function resolveAssistantProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}) {
  return serializeAssistantProviderSessionOptions(input)
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return resolveAssistantRegistryProviderCapabilities(provider)
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnResult> {
  const provider = input.provider ?? 'codex-cli'
  const providerConfig = sanitizeAssistantProviderConfig(provider, input)

  return await executeAssistantProviderTurnWithDefinition({
    abortSignal: input.abortSignal,
    configOverrides: input.configOverrides,
    conversationMessages:
      provider === 'openai-compatible'
        ? buildAssistantProviderMessages({
            continuityContext: input.continuityContext,
            conversationMessages: input.conversationMessages,
            prompt: input.prompt,
            sessionContext: input.sessionContext,
            userPrompt: input.userPrompt,
          })
        : input.conversationMessages,
    env: input.env,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    prompt: flattenAssistantProviderPrompt(input),
    providerConfig,
    resumeProviderSessionId: input.resumeProviderSessionId,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    workingDirectory: input.workingDirectory,
  })
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
    throw new Error(
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
    | 'continuityContext'
    | 'conversationMessages'
    | 'prompt'
    | 'sessionContext'
    | 'userPrompt'
  >,
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  const messages = (input.conversationMessages ?? [])
    .map((message) => ({
      role: message.role,
      content: normalizeNullableString(message.content) ?? '',
    }))
    .filter((message) => message.content.length > 0)

  const prompt = normalizeNullableString(input.prompt)
  if (prompt) {
    messages.push({
      role: 'user',
      content: prompt,
    })
    return messages
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new Error(
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const sessionContextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []
  const continuityContext = normalizeNullableString(input.continuityContext)
  const userParts = [
    sessionContextLines.length > 0
      ? `Conversation context:\n${sessionContextLines.join('\n')}`
      : null,
    continuityContext,
    userPrompt,
  ].filter((part): part is string => Boolean(part))

  messages.push({
    role: 'user',
    content: userParts.join('\n\n'),
  })
  return messages
}
