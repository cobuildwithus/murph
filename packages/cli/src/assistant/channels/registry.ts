import type { AssistantBindingDelivery } from '../../assistant-cli-contracts.js'
import type { ConversationRef } from '../conversation-ref.js'
import {
  inferFallbackBindingDelivery,
  resolveDeliveryCandidates,
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

  return ASSISTANT_CHANNEL_ADAPTERS[channel as AssistantChannelName] ?? null
}

export { resolveDeliveryCandidates }

export function inferAssistantBindingDelivery(input: {
  channel?: string | null
  conversation?: ConversationRef | null
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const adapter = getAssistantChannelAdapter(input.channel ?? input.conversation?.channel)
  if (!adapter) {
    return inferFallbackBindingDelivery({
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

export function resolveImessageDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  return resolveDeliveryCandidates(input)
}
