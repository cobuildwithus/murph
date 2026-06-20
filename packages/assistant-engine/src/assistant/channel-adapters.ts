export type {
  AssistantChannelActivityHandle,
  AssistantChannelAdapter,
  AssistantChannelDependencies,
  AssistantDeliveryCandidate,
} from './channels/types.js'
export {
  getAssistantChannelAdapter,
  inferAssistantBindingDelivery,
  listAssistantChannelAdapters,
  listAssistantChannelNames,
  normalizeAssistantDeliverySubject,
  resolveDeliveryCandidates,
  selectedAssistantEmailDeliveryIsThreadReply,
} from './channels/registry.js'
export {
  sendEmailMessage,
  sendLinqMessage,
  sendLinqVoiceMemoMessage,
  sendTelegramMessage,
  sendTelegramVoiceMemoMessage,
  sendWhatsAppMessage,
  startAssistantChannelActivitySession,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './channels/runtime.js'
