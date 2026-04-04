import * as React from 'react'
import { type AssistantSession } from '@murphai/assistant-core/assistant-cli-contracts'
import type { AssistantProviderProgressEvent } from '@murphai/assistant-core/assistant-provider'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from '@murphai/assistant-core/assistant-provider'
import {
  extractRecoveredAssistantSession,
  isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError,
} from '@murphai/assistant-core/assistant-provider'

import { sendAssistantMessage, type AssistantChatInput } from '../service.js'
import { appendAssistantTranscriptEntries, isAssistantSessionNotFoundError } from '../store.js'
import {
  applyProviderProgressEventToEntries,
  finalizePendingInkChatTraces,
  applyInkChatTraceUpdates,
  type InkChatEntry,
} from './view-model.js'

type AssistantSendMessageResult = Awaited<
  ReturnType<typeof sendAssistantMessage>
>

interface AssistantTurnErrorPresentation {
  entry: {
    kind: 'error' | 'status'
    text: string
  }
  persistTranscriptError: boolean
  status: {
    kind: 'error' | 'info'
    text: string
  }
}

export interface AssistantChatStatus {
  kind: 'error' | 'info' | 'success'
  text: string
}

export type AssistantPromptTurnOutcome =
  | {
      delivery: AssistantSendMessageResult['delivery']
      deliveryError: AssistantSendMessageResult['deliveryError']
      kind: 'completed'
      response: string
      session: AssistantSession
      streamedAssistantEntryKey: string | null
    }
  | {
      error: unknown
      kind: 'failed'
      recoveredSession: AssistantSession | null
    }
  | {
      kind: 'interrupted'
      recoveredSession: AssistantSession | null
    }

interface RunAssistantPromptTurnInput {
  activeModel: string | null
  activeReasoningEffort: string | null
  input: AssistantChatInput & {
    abortSignal: AbortSignal
  }
  prompt: string
  session: AssistantSession
  setEntries: React.Dispatch<React.SetStateAction<InkChatEntry[]>>
  setStatus: React.Dispatch<React.SetStateAction<AssistantChatStatus | null>>
  turnTracePrefix: string
}

function namespaceTurnTraceUpdates(
  updates: readonly AssistantProviderTraceUpdate[],
  turnTracePrefix: string,
): AssistantProviderTraceUpdate[] {
  return updates.map((update) => ({
    ...update,
    streamKey: update.streamKey
      ? `${turnTracePrefix}:${update.streamKey}`
      : update.streamKey,
  }))
}

function namespaceProviderProgressEvent(
  event: AssistantProviderProgressEvent,
  turnTracePrefix: string,
): AssistantProviderProgressEvent {
  return {
    ...event,
    id: event.id ? `${turnTracePrefix}:${event.id}` : `${turnTracePrefix}:trace`,
  }
}

export function createAssistantTurnTracePrefix(): string {
  return `turn:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function resolveAssistantTurnErrorPresentation(input: {
  error: unknown
  restoredQueuedPromptCount: number
}): AssistantTurnErrorPresentation {
  const errorText =
    input.error instanceof Error ? input.error.message : String(input.error)
  const connectionLost = isAssistantProviderConnectionLostError(input.error)
  const missingSession = isAssistantSessionNotFoundError(input.error)
  const queuedFollowUpSuffix =
    input.restoredQueuedPromptCount > 0
      ? ' Queued follow-ups are back in the composer.'
      : ''

  return {
    entry: {
      kind: 'error',
      text: errorText,
    },
    persistTranscriptError: !missingSession,
    status: connectionLost
      ? {
          kind: 'error',
          text: `The assistant lost its provider connection. Restore connectivity, then keep chatting to resume.${queuedFollowUpSuffix}`,
        }
      : missingSession
        ? {
            kind: 'error',
            text: `The local assistant session record is missing. Check the current vault/default vault or start a new chat.${queuedFollowUpSuffix}`,
          }
        : {
            kind: 'error',
            text: `The assistant hit an error. Fix it or keep chatting.${queuedFollowUpSuffix}`,
          },
  }
}

export async function runAssistantPromptTurn(
  input: RunAssistantPromptTurnInput,
): Promise<AssistantPromptTurnOutcome> {
  let streamedAssistantEntryKey: string | null = null

  const handleTraceEvent = (event: AssistantProviderTraceEvent) => {
    const namespacedUpdates = namespaceTurnTraceUpdates(
      event.updates,
      input.turnTracePrefix,
    )
    if (namespacedUpdates.length === 0) {
      return
    }

    for (const update of namespacedUpdates) {
      if (update.kind === 'assistant' && update.streamKey) {
        streamedAssistantEntryKey = streamedAssistantEntryKey ?? update.streamKey
      }
    }

    input.setEntries((previous: InkChatEntry[]) =>
      applyInkChatTraceUpdates(previous, namespacedUpdates),
    )

    const latestStatusUpdate = [...namespacedUpdates]
      .reverse()
      .find((update) => update.kind === 'error' || update.kind === 'status')

    if (latestStatusUpdate) {
      input.setStatus({
        kind: latestStatusUpdate.kind === 'error' ? 'error' : 'info',
        text: latestStatusUpdate.text,
      })
    }
  }

  try {
    const result = await sendAssistantMessage({
      ...input.input,
      abortSignal: input.input.abortSignal,
      conversation: {
        ...(input.input.conversation ?? {}),
        sessionId: input.session.sessionId,
      },
      model: input.activeModel,
      onProviderEvent: (event) => {
        input.setEntries((previous: InkChatEntry[]) =>
          applyProviderProgressEventToEntries({
            entries: previous,
            event: namespaceProviderProgressEvent(event, input.turnTracePrefix),
          }),
        )
      },
      onTraceEvent: handleTraceEvent,
      prompt: input.prompt,
      reasoningEffort: input.activeReasoningEffort,
      showThinkingTraces: true,
    })

    return {
      delivery: result.delivery,
      deliveryError: result.deliveryError,
      kind: 'completed',
      response: result.response,
      session: result.session,
      streamedAssistantEntryKey,
    }
  } catch (error) {
    const recoveredSession = extractRecoveredAssistantSession(error)

    if (isAssistantProviderInterruptedError(error)) {
      return {
        kind: 'interrupted',
        recoveredSession,
      }
    }

    return {
      error,
      kind: 'failed',
      recoveredSession,
    }
  }
}

export async function persistAssistantTurnError(input: {
  errorText: string
  sessionId: string
  vault: string
}): Promise<void> {
  await appendAssistantTranscriptEntries(input.vault, input.sessionId, [
    {
      kind: 'error',
      text: input.errorText,
    },
  ])
}

export function finalizeAssistantTurnTraces(
  entries: readonly InkChatEntry[],
  turnTracePrefix: string,
): InkChatEntry[] {
  return finalizePendingInkChatTraces(entries, turnTracePrefix)
}
