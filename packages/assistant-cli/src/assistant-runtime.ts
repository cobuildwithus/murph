export type {
  AssistantConversationAudience,
  AssistantConversationDeliveryPolicy,
  AssistantConversationPolicy,
} from '@murphai/assistant-core/assistant-runtime'
export {
  resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationAudience,
  resolveAssistantConversationPolicy,
  shouldExposeSensitiveHealthContext,
} from '@murphai/assistant-core/assistant-runtime'
export type {
  AssistantRuntimeStateService,
} from '@murphai/assistant-core/assistant-state'
export {
  createAssistantRuntimeStateService,
} from '@murphai/assistant-core/assistant-state'

export type {
  AddAssistantCronJobInput,
  AssistantCronProcessDueResult,
  AssistantCronTargetMutationResult,
  InstallAssistantCronPresetInput,
  InstallAssistantCronPresetResult,
  AssistantCronRunExecutionResult,
  SetAssistantCronJobTargetInput,
  AssistantCronStatusSnapshot,
  ProcessDueAssistantCronJobsInput,
  RunAssistantCronJobInput,
} from './assistant/cron.js'
export {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronPreset,
  getAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  installAssistantCronPreset,
  listAssistantCronPresets,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  removeAssistantCronJob,
  runAssistantCronJobNow,
  setAssistantCronJobTarget,
  setAssistantCronJobEnabled,
} from './assistant/cron.js'
export type {
  AssistantChatInput,
  AssistantMessageInput,
} from './assistant/service.js'
export type {
  ConversationRef,
} from '@murphai/assistant-core/assistant-runtime'
export {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
} from './assistant/service.js'
export {
  getAssistantStatus,
  readAssistantStatusSnapshot,
  refreshAssistantStatusSnapshot,
} from './assistant/status.js'
export {
  stopAssistantAutomation,
} from './assistant/stop.js'
export type {
  AssistantAutoReplyScanResult,
  AssistantAutomationScanResult,
  AssistantInboxScanResult,
  AssistantRunEvent,
  RunAssistantAutomationInput,
} from './assistant/automation.js'
export {
  runAssistantAutomation,
  scanAssistantAutomationOnce,
  scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce,
} from './assistant/automation.js'
export type {
  AssistantOutboxDispatchHooks,
  AssistantOutboxDispatchMode,
} from './assistant/outbox.js'
export type {
  AssistantOutboxIntent,
} from '@murphai/assistant-core/assistant-cli-contracts'
export {
  dispatchAssistantOutboxIntent,
  drainAssistantOutbox,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
} from './assistant/outbox.js'
export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('@murphai/assistant-core/assistant-cli-contracts').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}

export {
  runAssistantDoctor,
} from './assistant/doctor.js'
