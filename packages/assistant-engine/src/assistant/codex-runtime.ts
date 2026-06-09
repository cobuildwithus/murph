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
} from './provider-progress.js'
import {
  CODEX_ASSISTANT_CAPABILITIES,
  executeCodexAssistantTurnAttempt as executeCodexAssistantTurnAttemptUnchecked,
  resolveCodexAssistantLabel as resolveCodexAssistantConfigLabel,
  resolveCodexStaticModels as resolveCodexStaticModelCatalog,
} from './providers/codex-cli.js'
import { createCatalogModel } from './providers/catalog.js'
import type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantProviderAttemptMetadata,
  AssistantProviderCapabilities,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './providers/types.js'

export function resolveCodexAssistantCapabilities(): AssistantProviderCapabilities {
  return cloneAssistantProviderCapabilities(CODEX_ASSISTANT_CAPABILITIES)
}

export function resolveCodexAssistantTargetCapabilities(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderCapabilities {
  const normalized = normalizeAssistantProviderConfig(input)
  assertCodexAssistantProvider(resolveAssistantChatProviderFromConfig(normalized))

  return cloneAssistantProviderCapabilities({
    ...CODEX_ASSISTANT_CAPABILITIES,
    supportsNativeResume: shouldCodexAssistantUseNativeResume(normalized),
    supportsReasoningEffort: supportsAssistantReasoningEffort(normalized),
  })
}

function shouldCodexAssistantUseNativeResume(
  config: AssistantProviderConfig,
): boolean {
  return supportsAssistantNativeResume(config)
}

export function resolveCodexAssistantLabel(
  input: AssistantProviderConfigLike | null | undefined,
): string {
  const normalized = normalizeAssistantProviderConfig(input)
  assertCodexAssistantProvider(resolveAssistantChatProviderFromConfig(normalized))
  return resolveCodexAssistantConfigLabel(normalized)
}

export function resolveCodexStaticModels(
  input: AssistantProviderConfigLike | null | undefined,
): readonly AssistantCatalogModel[] {
  const normalized = normalizeAssistantProviderConfig(input)
  assertCodexAssistantProvider(resolveAssistantChatProviderFromConfig(normalized))
  return resolveCodexStaticModelCatalog()
}

export async function executeCodexAssistantTurn(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const result = await executeCodexAssistantTurnAttempt(input)
  if (!result.ok) {
    throw result.error
  }

  return result.result
}

export async function executeCodexAssistantTurnAttempt(
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
    assertCodexAssistantProvider(
      resolveAssistantChatProviderFromConfig(input.providerConfig),
    )
    const result = await executeCodexAssistantTurnAttemptUnchecked(executionInput)
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

export async function executeCodexAssistantTurnFromInput(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeCodexAssistantTurn({
    activeTurnId: input.activeTurnId,
    abortSignal: input.abortSignal,
    activeTurnSteering: input.activeTurnSteering,
    activeTurnSessionId: input.activeTurnSessionId,
    conversationHistoryMessages: input.conversationHistoryMessages,
    developerInstructions: input.developerInstructions,
    env: input.env,
    onEvent: input.onEvent,
    onProviderRequestStarted: input.onProviderRequestStarted,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resume: input.resume,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    progressDelivery: input.progressDelivery,
    turnContextPrompt: input.turnContextPrompt,
    userPrompt: input.userPrompt,
    userMessageContent: input.userMessageContent,
    usageAttribution: input.usageAttribution,
    workingDirectory: input.workingDirectory,
  })
}

export async function executeCodexAssistantTurnAttemptFromInput(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnAttemptResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeCodexAssistantTurnAttempt({
    activeTurnId: input.activeTurnId,
    abortSignal: input.abortSignal,
    activeTurnSteering: input.activeTurnSteering,
    activeTurnSessionId: input.activeTurnSessionId,
    conversationHistoryMessages: input.conversationHistoryMessages,
    developerInstructions: input.developerInstructions,
    env: input.env,
    onEvent: input.onEvent,
    onProviderRequestStarted: input.onProviderRequestStarted,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resume: input.resume,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    progressDelivery: input.progressDelivery,
    turnContextPrompt: input.turnContextPrompt,
    userPrompt: input.userPrompt,
    userMessageContent: input.userMessageContent,
    usageAttribution: input.usageAttribution,
    workingDirectory: input.workingDirectory,
  })
}

export { createCatalogModel }
export type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
  AssistantProviderAttemptMetadata,
  AssistantProviderCapabilities,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './providers/types.js'

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

function assertCodexAssistantProvider(provider: AssistantChatProvider): void {
  if (provider === 'codex-cli') {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_PROVIDER_UNSUPPORTED',
    `Assistant provider "${provider}" is not available in the Codex-only runtime.`,
  )
}
