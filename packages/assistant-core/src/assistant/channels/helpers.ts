import {
  assistantBindingDeliverySchema,
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
} from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import type { ConversationRef } from '../conversation-ref.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelAdapterSpec,
  AssistantChannelActivityHandle,
  AssistantDeliveryCandidate,
} from './types.js'

export function createAssistantChannelAdapter(
  spec: AssistantChannelAdapterSpec,
): AssistantChannelAdapter {
  return {
    channel: spec.channel,
    canAutoReply: spec.canAutoReply,
    inferBindingDelivery: spec.inferBindingDelivery,
    isReadyForSetup: spec.isReadyForSetup,
    ...(spec.startTypingIndicator
      ? {
          async startTypingIndicator(input, dependencies) {
            const candidate = resolveDeliveryCandidates({
              bindingDelivery: input.bindingDelivery,
              explicitTarget: input.explicitTarget,
            })[0] ?? null
            if (!candidate) {
              return null
            }

            const startTypingIndicator = spec.startTypingIndicator
            if (!startTypingIndicator) {
              return null
            }

            const handle = await startTypingIndicator({
              candidate,
              dependencies,
              identityId: normalizeOptionalText(input.identityId),
            })
            return isAssistantChannelActivityHandle(handle) ? handle : null
          },
        }
      : {}),
    supportsIdempotencyKey: spec.supportsIdempotencyKey,
    async send(input, dependencies) {
      const candidate = resolveRequiredDeliveryCandidate(
        input,
        spec.targetRequiredMessage,
      )
      const idempotencyKey = normalizeOptionalText(input.idempotencyKey)
      const delivered = await spec.sendMessage({
        candidate,
        dependencies,
        idempotencyKey,
        identityId: normalizeOptionalText(input.identityId),
        message: input.message,
        replyToMessageId: normalizeOptionalText(input.replyToMessageId),
      })

      return assistantChannelDeliverySchema.parse({
        channel: spec.channel,
        idempotencyKey,
        target: readDeliveredTarget(delivered) ?? candidate.target,
        targetKind: candidate.kind,
        sentAt: new Date().toISOString(),
        messageLength: input.message.length,
        providerMessageId: readDeliveredProviderMessageId(delivered),
        providerThreadId: readDeliveredProviderThreadId(delivered),
      })
    },
  }
}

function isAssistantChannelActivityHandle(
  value: unknown,
): value is AssistantChannelActivityHandle {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'stop' in value &&
      typeof (value as { stop?: unknown }).stop === 'function',
  )
}

export function resolveRequiredDeliveryCandidate(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
  },
  message: string,
): AssistantDeliveryCandidate {
  const candidate = resolveDeliveryCandidates(input)[0] ?? null
  if (candidate) {
    return candidate
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_TARGET_REQUIRED',
    message,
  )
}

export function resolveDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  const explicitTarget = normalizeOptionalText(input.explicitTarget)
  if (explicitTarget) {
    return [
      {
        kind: 'explicit',
        target: explicitTarget,
      },
    ]
  }

  if (!input.bindingDelivery) {
    return []
  }

  return [
    {
      kind: input.bindingDelivery.kind,
      target: input.bindingDelivery.target,
    },
  ]
}

export function createAssistantBindingDelivery(
  kind: AssistantBindingDelivery['kind'],
  target: string,
): AssistantBindingDelivery {
  return assistantBindingDeliverySchema.parse({
    kind,
    target,
  })
}

export function resolveExplicitBindingDelivery(input: {
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const explicitKind = input.deliveryKind ?? null
  const explicitTarget = normalizeOptionalText(input.deliveryTarget)
  if (!explicitKind || !explicitTarget) {
    return null
  }

  return createAssistantBindingDelivery(explicitKind, explicitTarget)
}

export function inferThreadFirstBindingDelivery(
  input: {
    conversation: ConversationRef
    deliveryKind?: 'participant' | 'thread' | null
    deliveryTarget?: string | null
  },
  options: {
    includeParticipant: boolean
  },
): AssistantBindingDelivery | null {
  const explicitDelivery = resolveExplicitBindingDelivery(input)
  if (explicitDelivery) {
    return explicitDelivery
  }

  if (input.conversation.threadId) {
    return createAssistantBindingDelivery('thread', input.conversation.threadId)
  }

  if (options.includeParticipant && input.conversation.participantId) {
    return createAssistantBindingDelivery(
      'participant',
      input.conversation.participantId,
    )
  }

  return null
}

export function inferFallbackBindingDelivery(input: {
  conversation: ConversationRef
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const explicitDelivery = resolveExplicitBindingDelivery(input)
  if (explicitDelivery) {
    return explicitDelivery
  }

  if (input.conversation.directness === 'group' && input.conversation.threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: input.conversation.threadId,
    })
  }

  if (input.conversation.participantId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'participant',
      target: input.conversation.participantId,
    })
  }

  if (input.conversation.threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: input.conversation.threadId,
    })
  }

  return null
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

export function readDeliveredTarget(
  delivered: { target?: string | null } | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.target)
    : null
}

export function readDeliveredProviderMessageId(
  delivered:
    | {
        providerMessageId?: string | null
      }
    | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.providerMessageId)
    : null
}

export function readDeliveredProviderThreadId(
  delivered:
    | {
        providerThreadId?: string | null
      }
    | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.providerThreadId)
    : null
}
