import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  deliverAssistantProgressUpdate,
} from './delivery-service.js'
import {
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
  currentHostedDeliveryContext?(): {
    conversationId: string | null
    recipientKey: string | null
  } | null
  currentHostedMailboxItemIds?(): readonly string[]
  readonly hostedComputerToolsAvailable?: boolean
  readonly requiredUserMessageDeliveryAvailable?: boolean
  send(
    text: string,
    options?: AssistantProgressDeliverySendOptions,
  ): Promise<AssistantProgressDeliveryResult>
}

export type AssistantProgressDeliverySource = 'model' | 'system'

export interface AssistantProgressDeliverySendOptions {
  required?: boolean
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

type DeliverAssistantProgressUpdate = typeof deliverAssistantProgressUpdate
type AssistantProgressDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}
type AssistantProgressDeliverInput = Parameters<DeliverAssistantProgressUpdate>[0]

export function shouldCreateAssistantProgressDelivery(
  input: Pick<AssistantMessageInput, 'deliverResponse' | 'turnTrigger'>,
  profile?: {
    promptProfile?: 'conversation' | 'notification-decision' | null
    toolProfile?: 'provider-turn' | 'notification-turn' | null
  } | null,
): boolean {
  return input.deliverResponse === true &&
    input.turnTrigger !== 'automation-auto-reply' &&
    (profile?.toolProfile ?? 'provider-turn') === 'provider-turn' &&
    (profile?.promptProfile ?? 'conversation') !== 'notification-decision'
}

export function createAssistantProgressDelivery(input: {
  deliver?: DeliverAssistantProgressUpdate
  getDeliveryContext?: () => AssistantProgressDeliveryContext
  hostedComputerToolsAvailable?: boolean
  messageInput: AssistantMessageInput
  requiredUserMessageDeliveryAvailable?: boolean
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): AssistantProgressDelivery {
  const deliver = input.deliver ?? deliverAssistantProgressUpdate
  const abortController = new AbortController()
  const sentTexts = new Set<string>()
  let sentCount = 0
  let deliveryOrdinal = 0

  return {
    currentHostedDeliveryContext: () => {
      const deliveryContext = input.getDeliveryContext?.() ?? {
        messageInput: input.messageInput,
        session: input.session,
      }
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      const conversationId = context?.conversationId ?? null
      const recipientKey = context?.recipientKey ?? null
      return conversationId || recipientKey
        ? { conversationId, recipientKey }
        : null
    },
    currentHostedMailboxItemIds: () => {
      const deliveryContext = input.getDeliveryContext?.() ?? {
        messageInput: input.messageInput,
        session: input.session,
      }
      return deliveryContext.messageInput.hostedDeliveryIdempotency
        ?.inboundMailboxItemIds ?? []
    },
    hostedComputerToolsAvailable: input.hostedComputerToolsAvailable === true,
    requiredUserMessageDeliveryAvailable:
      input.requiredUserMessageDeliveryAvailable ?? true,
    async send(rawText: string, options?: AssistantProgressDeliverySendOptions) {
      const source = options?.source ?? 'model'
      const required = options?.required === true
      if (abortController.signal.aborted) {
        return {
          kind: 'failed',
          source,
        }
      }
      const text = normalizeAssistantProgressText(rawText)
      if (!text || (!required && sentTexts.has(text))) {
        return {
          kind: 'skipped',
          reason: text ? 'duplicate' : 'empty',
          source,
        }
      }
      if (!required && sentCount >= MAX_PROGRESS_UPDATES_PER_TURN) {
        return {
          kind: 'skipped',
          reason: 'limit',
          source,
        }
      }

      const ordinal = deliveryOrdinal
      deliveryOrdinal += 1
      if (!required) {
        sentCount += 1
        sentTexts.add(text)
      }

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
  return normalized
}
