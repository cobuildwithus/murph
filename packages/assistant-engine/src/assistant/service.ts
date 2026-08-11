// Local-only assistant orchestration surface for headless consumers.
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { prepareAssistantCronNotificationInput } from './cron/output-history.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
import {
  sendAssistantNotificationLocal as sendAssistantNotificationTurnLocal,
  type AssistantNotificationInput,
  type AssistantNotificationResult,
} from './notification-turn.js'
import { sendAssistantAskContinuationLocal as sendAssistantAskContinuationTurnLocal } from './ask-continuation.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
} from './local-service.js'
export {
  ASSISTANT_ASK_CONTINUATION_TURN_PROFILE,
  buildAssistantAskContinuationMessageInput,
  readAssistantAskOriginSession,
  sendAssistantAskContinuationLocal,
} from './ask-continuation.js'
export type {
  AssistantChatInput,
  AssistantBeforeProviderAcceptedInputsHook,
  AssistantChannelTypingDependencies,
  AssistantExecutionContext,
  AssistantMessageInput,
  AssistantHostedExecutionContext,
  AssistantHostedProgressDeliveryDependencies,
  AssistantSessionResolutionFields,
  AssistantProviderAcceptedInputsRelease,
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
  AssistantNotificationTurnPolicy,
} from './notification-turn.js'
export type {
  AssistantAskContinuationInput,
  AssistantAskContinuationResult,
} from './ask-continuation.js'

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

export async function sendAssistantNotificationLocal(
  input: AssistantNotificationInput,
): Promise<AssistantNotificationResult> {
  return sendAssistantNotificationTurnLocal(
    await prepareAssistantCronNotificationInput(input),
  )
}

export async function sendAssistantNotification(
  input: AssistantNotificationInput,
): Promise<AssistantNotificationResult> {
  return sendAssistantNotificationLocal(input)
}

export async function sendAssistantAskContinuation(
  input: import('./ask-continuation.js').AssistantAskContinuationInput,
) {
  return sendAssistantAskContinuationTurnLocal(input)
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: AssistantSessionOptionsPatch
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  return updateAssistantSessionOptionsLocal(input)
}
