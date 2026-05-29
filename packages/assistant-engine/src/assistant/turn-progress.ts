import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  deliverAssistantProgressUpdate,
} from './delivery-service.js'
import {
  MAX_PROGRESS_CHARS,
  MAX_PROGRESS_UPDATES_PER_TURN,
} from './progress-constants.js'
import {
  normalizeNullableString,
  warnAssistantBestEffortFailure,
} from './shared.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'

export interface AssistantProgressDelivery {
  close?(): void
  send(
    text: string,
    options?: AssistantProgressDeliverySendOptions,
  ): Promise<AssistantProgressDeliveryResult>
}

export type AssistantProgressDeliverySource = 'model' | 'system'

export interface AssistantProgressDeliverySendOptions {
  source?: AssistantProgressDeliverySource
}

export type AssistantProgressDeliveryResult =
  | { kind: 'sent'; source: AssistantProgressDeliverySource }
  | {
      kind: 'skipped'
      reason: 'duplicate' | 'empty' | 'limit'
      source: AssistantProgressDeliverySource
    }
  | { kind: 'failed'; source: AssistantProgressDeliverySource }

export function isAssistantModelProgressAvailable(input: {
  modelProgressUpdatesEnabled?: boolean | null
  progressDelivery?: AssistantProgressDelivery | null
}): boolean {
  return input.modelProgressUpdatesEnabled === true && Boolean(input.progressDelivery)
}

type DeliverAssistantProgressUpdate = typeof deliverAssistantProgressUpdate
type AssistantProgressDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}
type AssistantProgressDeliverInput = Parameters<DeliverAssistantProgressUpdate>[0]

export function shouldEnableAssistantModelProgressUpdates(
  input: Pick<AssistantMessageInput, 'deliverResponse'>,
  profile?: {
    promptProfile?: 'conversation' | 'notification-decision' | null
    toolProfile?: 'provider-turn' | 'notification-turn' | null
  } | null,
): boolean {
  return input.deliverResponse === true &&
    (profile?.toolProfile ?? 'provider-turn') === 'provider-turn' &&
    (profile?.promptProfile ?? 'conversation') !== 'notification-decision'
}

export function createAssistantProgressDelivery(input: {
  deliver?: DeliverAssistantProgressUpdate
  getDeliveryContext?: () => AssistantProgressDeliveryContext
  messageInput: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): AssistantProgressDelivery {
  const deliver = input.deliver ?? deliverAssistantProgressUpdate
  const abortController = new AbortController()
  const sentTexts = new Set<string>()
  const sentCountsBySource: Record<AssistantProgressDeliverySource, number> = {
    model: 0,
    system: 0,
  }
  let deliveryOrdinal = 0

  return {
    async send(rawText: string, options?: AssistantProgressDeliverySendOptions) {
      const source = options?.source ?? 'model'
      if (abortController.signal.aborted) {
        return {
          kind: 'failed',
          source,
        }
      }
      const text = normalizeAssistantProgressText(rawText)
      if (!text || sentTexts.has(text)) {
        return {
          kind: 'skipped',
          reason: text ? 'duplicate' : 'empty',
          source,
        }
      }
      if (sentCountsBySource[source] >= MAX_PROGRESS_UPDATES_PER_TURN) {
        return {
          kind: 'skipped',
          reason: 'limit',
          source,
        }
      }

      const ordinal = deliveryOrdinal
      deliveryOrdinal += 1
      sentCountsBySource[source] += 1
      sentTexts.add(text)

      try {
        const deliveryContext = input.getDeliveryContext?.() ?? {
          messageInput: input.messageInput,
          session: input.session,
        }
        const progressInput: AssistantProgressDeliverInput = {
          input: deliveryContext.messageInput,
          ordinal,
          session: deliveryContext.session,
          signal: abortController.signal,
          sharedPlan: input.sharedPlan,
          text,
          turnId: input.turnId,
        }
        await deliver(progressInput)
        return {
          kind: 'sent',
          source,
        }
      } catch (error) {
        warnAssistantBestEffortFailure({
          error,
          operation: 'progress update delivery',
        })
        return {
          kind: 'failed',
          source,
        }
      }
    },
    close() {
      abortController.abort()
    },
  }
}

export function normalizeAssistantProgressText(rawText: string): string | null {
  const withoutMarkdownLinks = rawText.replace(/\[([^\]\n]+)\]\([^)]+\)/gu, '$1')
  const normalized = normalizeNullableString(
    withoutMarkdownLinks.replace(/\s+/gu, ' '),
  )
  if (!normalized) {
    return null
  }
  if (normalized.length <= MAX_PROGRESS_CHARS) {
    return normalized
  }

  return `${normalized.slice(0, MAX_PROGRESS_CHARS - 3).trimEnd()}...`
}
