import {
  assistantModelTargetToProviderConfigInput,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import {
  mergeAssistantProviderActivityLabels,
  type AssistantProviderProgressEvent,
} from './provider-progress.js'
import {
  executeCodexAssistantTurnAttempt as executeCodexAssistantTurnAttemptUnchecked,
  preinitializeCodexAssistantProcess as preinitializeCodexAssistantProcessUnchecked,
} from './providers/codex-cli.js'

import type {
  AssistantProviderAttemptMetadata,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './providers/types.js'

export interface HostedCodexAssistantProcessPreparationInput {
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal | null
  target: AssistantModelTarget
  workingDirectory: string
}
export interface HostedCodexAssistantProcessPreparation {
  cancelPending(): Promise<void>
}

/**
 * Admits the resident process and starts its process-only initialization.
 * The first real turn or workspace boundary joins readiness through the
 * assistant-engine lifecycle owner. A returned handle may cancel only the
 * still-pending exact process admitted by this call.
 */
export async function prepareHostedCodexAssistantProcess(
  input: HostedCodexAssistantProcessPreparationInput,
): Promise<HostedCodexAssistantProcessPreparation | null> {
  const providerConfig = normalizeAssistantProviderConfig(
    assistantModelTargetToProviderConfigInput(input.target),
  )
  return await preinitializeCodexAssistantProcessUnchecked({
    env: input.env,
    providerConfig,
    signal: input.signal ?? undefined,
    workingDirectory: input.workingDirectory,
  })
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

export async function executeCodexAssistantTurnAttemptFromInput(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnAttemptResult> {
  return await executeCodexAssistantTurnAttempt(
    toAssistantProviderTurnExecutionInput(input),
  )
}

function toAssistantProviderTurnExecutionInput(
  input: AssistantProviderTurnInput,
): AssistantProviderTurnExecutionInput {
  return {
    ...input.turn,
    providerConfig: normalizeAssistantProviderConfig(input.providerConfig),
  }
}

export type {
  AssistantProviderAttemptMetadata,
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
  AssistantProviderTurnInput,
} from './providers/types.js'

function createEmptyAssistantProviderAttemptMetadata(): AssistantProviderAttemptMetadata {
  return {
    activityLabels: [],
    providerActionCount: 0,
    runtimeIssueInputs: [],
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
