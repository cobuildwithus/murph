import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  getAssistantChannelAdapter,
  type AssistantChannelActivityHandle,
  type AssistantChannelDependencies,
} from './channel-adapters.js'
import { resolveAssistantConversationScope } from './conversation-policy.js'
import {
  type AssistantCurrentAudienceDeliveryPrecedence,
  resolveAssistantCurrentAudienceDeliveryFields,
} from './delivery-service.js'
import type { AssistantChannelActivityStopOptions } from './channels/types.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'

import { createAssistantChannelTypingHandle } from './channels/typing-handle.js'
export { createAssistantChannelTypingHandle } from './channels/typing-handle.js'

export function startAssistantChannelTypingIndicator(input: {
  channelDependencies?: AssistantChannelDependencies | null
  input: AssistantMessageInput
  // Only the held message draft path may opt into group typing.
  heldGroupReply?: true
  precedence?: AssistantCurrentAudienceDeliveryPrecedence
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): (AssistantChannelActivityHandle & {
  recordAcceptedInputs: (acceptedInputIds: readonly string[]) => void
}) | null {
  if (input.input.deliverResponse !== true
    || (resolveAssistantConversationScope(input.sharedPlan.conversationPolicy.audience) === 'group'
      && input.heldGroupReply !== true)) {
    return null
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    precedence: input.precedence,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const channel = deliveryFields.channel
  const adapter = getAssistantChannelAdapter(channel)
  if (!channel || !adapter?.startTypingIndicator) {
    return null
  }
  const startTypingIndicator = adapter.startTypingIndicator

  const handle = createAssistantChannelTypingHandle({
    start: () => startTypingIndicator({
      bindingDelivery: deliveryFields.bindingDelivery,
      explicitTarget: deliveryFields.explicitTarget,
      identityId: deliveryFields.identityId,
      replyToMessageId: deliveryFields.replyToMessageId,
    }, input.channelDependencies ?? {}),
  })
  return Object.assign(handle, {
    recordAcceptedInputs(acceptedInputIds: readonly string[]) {
      if (!input.channelDependencies?.onTypingAccepted || acceptedInputIds.length === 0) return
      void handle.ready.then((at) => {
        if (!at || !handle.isActive() || input.input.abortSignal?.aborted) return
        input.channelDependencies?.onTypingAccepted?.({ acceptedInputIds, at, channel })
      }).catch(() => {})
    },
  })
}


export async function stopAssistantChannelTypingIndicator(
  indicator: AssistantChannelActivityHandle | null,
  options: AssistantChannelActivityStopOptions = {},
): Promise<void> {
  if (!indicator) {
    return
  }

  await indicator.stop(options)
}

export function assistantDeliveryOutcomeSupersedesTypingIndicator(
  kind: AssistantDeliveryOutcome['kind'] | null,
): boolean {
  return kind === 'sent' || kind === 'queued'
}
