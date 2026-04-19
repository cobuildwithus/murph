// Local-only assistant orchestration surface for headless consumers.
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import {
  openAssistantConversationLocal,
  queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
import { sendAssistantNotificationLocal as sendAssistantNotificationTurnLocal } from './notification-turn.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  openAssistantConversationLocal,
  queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
export { sendAssistantNotificationLocal } from './notification-turn.js'
export type {
  AssistantChatInput,
  AssistantExecutionContext,
  AssistantMessageInput,
  AssistantHostedExecutionContext,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
export type {
  AssistantNotificationDecision,
  AssistantNotificationInput,
  AssistantNotificationResult,
} from './notification-turn.js'

export type AssistantSessionOptionsPatch = Pick<
  AssistantSession['providerOptions'],
  'provider'
> &
  Partial<Omit<AssistantSession['providerOptions'], 'provider'>>

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  return openAssistantConversationLocal(input)
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
) {
  return sendAssistantMessageLocal(input)
}

export async function sendAssistantNotification(
  input: import('./notification-turn.js').AssistantNotificationInput,
) {
  return sendAssistantNotificationTurnLocal(input)
}

export async function queueAssistantFirstContactWelcome(
  input: import('./first-contact-welcome-delivery.js').AssistantFirstContactWelcomeInput,
) {
  return queueAssistantFirstContactWelcomeLocal(input)
}

export async function sendAssistantFirstContactWelcome(
  input: import('./first-contact-welcome-delivery.js').AssistantFirstContactWelcomeInput,
) {
  return sendAssistantFirstContactWelcomeLocal(input)
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: AssistantSessionOptionsPatch
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  return updateAssistantSessionOptionsLocal(input)
}
