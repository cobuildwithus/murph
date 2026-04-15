import {
  inferGatewayReplyRouteForChannel,
  type GatewayResolvedReplyRoute,
} from '@murphai/gateway-core'
import {
  assistantBindingDeliverySchema,
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
  const inferBindingDelivery =
    spec.inferBindingDelivery ??
    ((input) =>
      inferBindingDeliveryForChannel({
        channel: spec.channel,
        conversation: input.conversation,
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
      }))

  return {
    channel: spec.channel,
    canAutoReply: spec.canAutoReply,
    inferBindingDelivery,
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

function assistantBindingDeliveryFromGatewayReply(
  reply: GatewayResolvedReplyRoute | null,
): AssistantBindingDelivery | null {
  if (!reply) {
    return null
  }

  return createAssistantBindingDelivery(reply.kind, reply.target)
}

export function inferBindingDeliveryForChannel(input: {
  channel?: string | null
  conversation: ConversationRef
  deliveryKind?: AssistantBindingDeliveryKind | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  return assistantBindingDeliveryFromGatewayReply(
    inferGatewayReplyRouteForChannel({
      channel: input.channel ?? input.conversation.channel ?? null,
      conversation: {
        directness: input.conversation.directness,
        participantId: input.conversation.participantId,
        threadId: input.conversation.threadId,
      },
      deliveryKind: input.deliveryKind ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
    }),
  )
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
