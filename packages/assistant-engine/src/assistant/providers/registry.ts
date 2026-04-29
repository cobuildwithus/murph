import type { AssistantChatProvider } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  normalizeAssistantProviderConfig,
  resolveAssistantChatProviderFromConfig,
  supportsAssistantNativeResume,
  supportsAssistantReasoningEffort,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import {
  mergeAssistantProviderActivityLabels,
  type AssistantProviderProgressEvent,
} from '../provider-progress.js'
import { codexCliProviderDefinition } from './codex-cli.js'
import { createCatalogModel } from './catalog.js'
import type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantProviderAttemptMetadata,
  AssistantProviderCapabilities,
  AssistantProviderDefinition,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
  AssistantUserMessageContentType,
} from './types.js'

const ASSISTANT_PROVIDER_DEFINITIONS: Readonly<Partial<Record<
  AssistantChatProvider,
  AssistantProviderDefinition
>>> = Object.freeze({
  'codex-cli': codexCliProviderDefinition,
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
  const definition = ASSISTANT_PROVIDER_DEFINITIONS[provider]
  if (!definition) {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      `Assistant provider "${provider}" is not available in this runtime.`,
    )
  }

  return definition
}

function resolveAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return getAssistantProviderDefinition(provider)
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return cloneAssistantProviderCapabilities(
    resolveAssistantProviderDefinition(provider).capabilities,
  )
}

export function resolveAssistantProviderTargetCapabilities(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderCapabilities {
  const normalized = normalizeAssistantProviderConfig(input)
  return cloneAssistantProviderCapabilities({
    ...resolveAssistantProviderDefinition(
      resolveAssistantChatProviderFromConfig(normalized),
    ).capabilities,
    supportsNativeResume: shouldAssistantProviderUseNativeResume(normalized),
    supportsReasoningEffort: supportsAssistantReasoningEffort(normalized),
  })
}

function shouldAssistantProviderUseNativeResume(
  config: AssistantProviderConfig,
): boolean {
  return supportsAssistantNativeResume(config)
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
    activeTurnId: input.activeTurnId,
    abortSignal: input.abortSignal,
    activeTurnSteering: input.activeTurnSteering,
    activeTurnMessages: input.activeTurnMessages,
    activeTurnSessionId: input.activeTurnSessionId,
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
    activeTurnId: input.activeTurnId,
    abortSignal: input.abortSignal,
    activeTurnSteering: input.activeTurnSteering,
    activeTurnMessages: input.activeTurnMessages,
    activeTurnSessionId: input.activeTurnSessionId,
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

function cloneAssistantProviderCapabilities(
  capabilities: AssistantProviderCapabilities,
): AssistantProviderCapabilities {
  return {
    supportedUserMessageContentTypes: [...capabilities.supportedUserMessageContentTypes],
    supportsNativeResume: capabilities.supportsNativeResume,
    supportsReasoningEffort: capabilities.supportsReasoningEffort,
    supportsRichUserMessageContent: capabilities.supportsRichUserMessageContent,
  }
}
