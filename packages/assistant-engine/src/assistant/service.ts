// Local-only assistant orchestration surface for headless consumers.

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  sendAssistantMessageLocal,
  sendAssistantMessageLocal as sendAssistantMessage,
} from './local-service.js'
export {
  ASSISTANT_ASK_CONTINUATION_TURN_PROFILE,
  buildAssistantAskContinuationMessageInput,
  readAssistantAskOriginSession,
  sendAssistantAskContinuationLocal,
  sendAssistantAskContinuationLocal as sendAssistantAskContinuation,
} from './ask-continuation.js'
export type {
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

export {
  sendAssistantNotificationLocal,
  sendAssistantNotificationLocal as sendAssistantNotification,
} from './notification-turn.js'
