import type { AssistantChatProvider } from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
  resolveAssistantChatProviderFromConfig,
  supportsAssistantNativeResume,
  supportsAssistantReasoningEffort,
  supportsAssistantZeroDataRetention,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import {
  mergeAssistantProviderActivityLabels,
  type AssistantProviderProgressEvent,
} from '../provider-progress.js'
import { codexCliProviderDefinition } from './codex-cli.js'
import { createCatalogModel } from './catalog.js'
import { openAiCompatibleProviderDefinition } from './openai-compatible.js'
import { supportsAnyAssistantRichUserMessageContent } from './types.js'
import type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantModelDiscoveryResult,
  AssistantMurphCommandAccessMode,
  AssistantMurphCommandSurface,
  AssistantProviderAttemptMetadata,
  AssistantProviderCapabilities,
  AssistantProviderExecutionCapabilities,
  AssistantProviderDefinition,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
  AssistantUserMessageContentType,
} from './types.js'

const ASSISTANT_PROVIDER_DEFINITIONS: Readonly<Record<
  AssistantChatProvider,
  AssistantProviderDefinition
>> = Object.freeze({
  'codex-cli': codexCliProviderDefinition,
  'openai-compatible': openAiCompatibleProviderDefinition,
})

export function listAssistantProviderDefinitions(): readonly AssistantProviderDefinition[] {
  return Object.values(ASSISTANT_PROVIDER_DEFINITIONS)
}

export function listAssistantProviders(): readonly AssistantChatProvider[] {
  return Object.keys(ASSISTANT_PROVIDER_DEFINITIONS) as AssistantChatProvider[]
}

export function getAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return ASSISTANT_PROVIDER_DEFINITIONS[provider]
}

function resolveAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return getAssistantProviderDefinition(provider)
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return stripAssistantProviderExecutionCapabilities(
    resolveAssistantProviderDefinition(provider).capabilities,
  )
}

export function resolveAssistantProviderExecutionCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderExecutionCapabilities {
  return {
    ...resolveAssistantProviderDefinition(provider).capabilities,
  }
}

export function resolveAssistantProviderTargetCapabilities(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderCapabilities {
  const normalized = normalizeAssistantProviderConfig(input)
  return stripAssistantProviderExecutionCapabilities({
    ...resolveAssistantProviderDefinition(
      resolveAssistantChatProviderFromConfig(normalized),
    ).capabilities,
    supportsNativeResume: shouldAssistantProviderUseNativeResume(normalized),
    supportsReasoningEffort: supportsAssistantReasoningEffort(normalized),
    supportsZeroDataRetention: supportsAssistantZeroDataRetention(normalized),
  })
}

export function resolveAssistantProviderTargetExecutionCapabilities(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderExecutionCapabilities {
  const normalized = normalizeAssistantProviderConfig(input)
  return {
    ...resolveAssistantProviderDefinition(
      resolveAssistantChatProviderFromConfig(normalized),
    ).capabilities,
    supportsNativeResume: shouldAssistantProviderUseNativeResume(normalized),
    supportsReasoningEffort: supportsAssistantReasoningEffort(normalized),
    supportsZeroDataRetention: supportsAssistantZeroDataRetention(normalized),
  }
}

function shouldAssistantProviderUseNativeResume(
  config: AssistantProviderConfig,
): boolean {
  return (
    supportsAssistantNativeResume(config) &&
    config.policy.zeroDataRetention !== true
  )
}

export function resolveAssistantProviderLabel(
  input: AssistantProviderConfigLike | null | undefined,
): string {
  const normalized = normalizeAssistantProviderConfig(input)
  const definition = resolveAssistantProviderDefinition(
    resolveAssistantChatProviderFromConfig(normalized),
  )
  return definition.resolveLabel(normalized)
}

export async function discoverAssistantProviderModels(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  provider: AssistantChatProvider
  providerName?: string | null
}): Promise<AssistantModelDiscoveryResult> {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(
    resolveAssistantChatProviderFromConfig(normalized),
  ).discoverModels({
    config: normalized,
    env: input.env,
  })
}

export function resolveAssistantProviderStaticModels(
  input: AssistantProviderConfigLike | null | undefined,
): readonly AssistantCatalogModel[] {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(
    resolveAssistantChatProviderFromConfig(normalized),
  ).resolveStaticModels(normalized)
}

export async function executeAssistantProviderTurnWithDefinition(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const result = await executeAssistantProviderTurnAttemptWithDefinition(input)
  if (!result.ok) {
    throw result.error
  }

  return result.result
}

export async function executeAssistantProviderTurnAttemptWithDefinition(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnAttemptResult> {
  const progressEvents: AssistantProviderProgressEvent[] = []
  const executionInput: AssistantProviderTurnExecutionInput = {
    ...input,
    onEvent: (event) => {
      progressEvents.push(event)
      input.onEvent?.(event)
    },
  }

  try {
    const result = await resolveAssistantProviderDefinition(
      resolveAssistantChatProviderFromConfig(input.providerConfig),
    ).executeTurn(executionInput)
    return finalizeAssistantProviderAttemptResult(result, progressEvents)
  } catch (error) {
    return {
      error,
      metadata: finalizeAssistantProviderAttemptMetadata(
        createEmptyAssistantProviderAttemptMetadata(),
        progressEvents,
      ),
      ok: false,
    }
  }
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeAssistantProviderTurnWithDefinition({
    abortSignal: input.abortSignal,
    continuityContext: input.continuityContext,
    conversationMessages: input.conversationMessages,
    env: input.env,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resumeProviderSessionId: input.resumeProviderSessionId,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    toolRuntime: input.toolRuntime,
    userPrompt: input.userPrompt,
    userMessageContent: input.userMessageContent,
    usageAttribution: input.usageAttribution,
    workingDirectory: input.workingDirectory,
  })
}

export async function executeAssistantProviderTurnAttempt(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnAttemptResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeAssistantProviderTurnAttemptWithDefinition({
    abortSignal: input.abortSignal,
    continuityContext: input.continuityContext,
    conversationMessages: input.conversationMessages,
    env: input.env,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resumeProviderSessionId: input.resumeProviderSessionId,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    toolRuntime: input.toolRuntime,
    userPrompt: input.userPrompt,
    userMessageContent: input.userMessageContent,
    usageAttribution: input.usageAttribution,
    workingDirectory: input.workingDirectory,
  })
}

export { createCatalogModel }
export { ASSISTANT_PROVIDER_DEFINITIONS }
export type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantModelDiscoveryResult,
  AssistantMurphCommandAccessMode,
  AssistantMurphCommandSurface,
  AssistantProviderAttemptMetadata,
  AssistantProviderCapabilities,
  AssistantProviderDefinition,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './types.js'

function createEmptyAssistantProviderAttemptMetadata(): AssistantProviderAttemptMetadata {
  return {
    activityLabels: [],
    executedToolCount: 0,
    providerActionCount: 0,
    rawToolEvents: [],
  }
}

function finalizeAssistantProviderAttemptResult(
  result: AssistantProviderTurnAttemptResult,
  progressEvents: readonly AssistantProviderProgressEvent[],
): AssistantProviderTurnAttemptResult {
  return {
    ...result,
    metadata: finalizeAssistantProviderAttemptMetadata(
      result.metadata ?? createEmptyAssistantProviderAttemptMetadata(),
      progressEvents,
    ),
  }
}

function finalizeAssistantProviderAttemptMetadata(
  metadata: AssistantProviderAttemptMetadata,
  progressEvents: readonly AssistantProviderProgressEvent[],
): AssistantProviderAttemptMetadata {
  return {
    ...metadata,
    activityLabels: mergeAssistantProviderActivityLabels({
      events: progressEvents,
      labels: metadata.activityLabels,
    }),
  }
}

function stripAssistantProviderExecutionCapabilities(
  capabilities: AssistantProviderExecutionCapabilities,
): AssistantProviderCapabilities {
  return {
    supportedUserMessageContentTypes: [...capabilities.supportedUserMessageContentTypes],
    supportsModelDiscovery: capabilities.supportsModelDiscovery,
    supportsNativeResume: capabilities.supportsNativeResume,
    supportsReasoningEffort: capabilities.supportsReasoningEffort,
    supportsRichUserMessageContent: supportsAnyAssistantRichUserMessageContent(
      capabilities.supportedUserMessageContentTypes,
    ),
    supportsZeroDataRetention: capabilities.supportsZeroDataRetention,
  }
}
