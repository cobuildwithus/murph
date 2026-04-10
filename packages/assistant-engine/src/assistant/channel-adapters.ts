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
  resolveDeliveryCandidates,
} from './channels/registry.js'
export {
  sendEmailMessage,
  sendLinqMessage,
  sendTelegramMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './channels/runtime.js'
