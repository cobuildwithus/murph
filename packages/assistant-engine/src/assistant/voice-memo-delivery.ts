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
  if (channel !== 'linq' && channel !== 'telegram') {
    return null
  }
  // For both channels, the deliver path accepts an explicit target OR a
  // binding target (thread or participant). Mirror that here so we do not
  // hide the tool for audiences delivery can actually reach.
  const hasTarget =
    normalizeNullableString(deliveryFields.explicitTarget) !== null ||
    normalizeNullableString(deliveryFields.bindingDelivery?.target) !== null
  return hasTarget ? channel : null
}
