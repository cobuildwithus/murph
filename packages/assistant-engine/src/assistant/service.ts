// Local-only assistant orchestration surface for headless consumers.
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
import { sendAssistantNotificationLocal as sendAssistantNotificationTurnLocal } from './notification-turn.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
export { sendAssistantNotificationLocal } from './notification-turn.js'
export type {
  AssistantChatInput,
  AssistantChannelTypingDependencies,
  AssistantExecutionContext,
  AssistantMessageInput,
  AssistantHostedExecutionContext,
  AssistantHostedProgressDeliveryDependencies,
  AssistantSessionResolutionFields,
  AssistantTurnEnvironment,
} from './service-contracts.js'
export type {
  AssistantActiveTurnInputCheckpointHook,
  AssistantActiveTurnInputCheckpointInput,
} from './turn-input.js'
export type {
  AssistantNotificationDecision,
  AssistantNotificationFirstContactPolicy,
  AssistantNotificationInput,
  AssistantNotificationResponsePolicy,
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

export async function updateAssistantSessionOptions(input: {
  providerOptions: AssistantSessionOptionsPatch
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  return updateAssistantSessionOptionsLocal(input)
}
