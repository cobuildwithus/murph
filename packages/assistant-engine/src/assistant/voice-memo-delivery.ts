import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  resolveAssistantCurrentAudienceDeliveryFields,
} from './delivery-service.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'
import { normalizeNullableString } from './shared.js'

export type AssistantVoiceMemoDeliveryChannel = 'linq' | 'telegram'

export function resolveAssistantVoiceMemoDeliveryChannel(input: {
  messageInput: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantVoiceMemoDeliveryChannel | null {
  if (!input.messageInput.deliverResponse) {
    return null
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.messageInput,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const channel = normalizeNullableString(deliveryFields.channel)?.toLowerCase()
  if (channel === 'linq') {
    const bindingTarget =
      deliveryFields.bindingDelivery?.kind === 'thread'
        ? normalizeNullableString(deliveryFields.bindingDelivery.target)
        : null
    const explicitTarget = normalizeNullableString(deliveryFields.explicitTarget)
    return bindingTarget !== null &&
      (explicitTarget === null || explicitTarget === bindingTarget)
      ? 'linq'
      : null
  }

  if (channel === 'telegram') {
    return (
      normalizeNullableString(deliveryFields.explicitTarget) !== null ||
      normalizeNullableString(deliveryFields.bindingDelivery?.target) !== null
    )
      ? 'telegram'
      : null
  }

  return null
}
