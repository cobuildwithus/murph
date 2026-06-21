import type {
  AssistantBindingDelivery,
  AssistantBindingDeliveryKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { ConversationRef } from '../conversation-ref.js'
import {
  inferBindingDeliveryForChannel,
  normalizeAssistantDeliverySubject,
  resolveDeliveryCandidates,
  selectedAssistantEmailDeliveryIsThreadReply,
} from './helpers.js'
import { ASSISTANT_CHANNEL_ADAPTERS } from './descriptors.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelName,
  AssistantDeliveryCandidate,
} from './types.js'

export function listAssistantChannelAdapters(): readonly AssistantChannelAdapter[] {
  return Object.values(ASSISTANT_CHANNEL_ADAPTERS)
}

export function listAssistantChannelNames(): readonly AssistantChannelName[] {
  return Object.keys(ASSISTANT_CHANNEL_ADAPTERS) as AssistantChannelName[]
}

export function getAssistantChannelAdapter(
  channel: string | null | undefined,
): AssistantChannelAdapter | null {
  if (!channel) {
    return null
  }

  if (!Object.hasOwn(ASSISTANT_CHANNEL_ADAPTERS, channel)) {
    return null
  }

  return ASSISTANT_CHANNEL_ADAPTERS[channel as AssistantChannelName]
}

export {
  normalizeAssistantDeliverySubject,
  resolveDeliveryCandidates,
  selectedAssistantEmailDeliveryIsThreadReply,
}

export function inferAssistantBindingDelivery(input: {
  channel?: string | null
  conversation?: ConversationRef | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const adapter = getAssistantChannelAdapter(input.channel ?? input.conversation?.channel)
  if (!adapter) {
    return inferBindingDeliveryForChannel({
      channel: input.channel ?? input.conversation?.channel ?? null,
      conversation: input.conversation ?? {},
      deliveryKind: input.deliveryKind ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
    })
  }

  return adapter.inferBindingDelivery({
    conversation: input.conversation ?? {},
    deliveryKind: input.deliveryKind ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
  })
}
