export type {
  AssistantConversationAudience,
  AssistantConversationDeliveryPolicy,
  AssistantConversationPolicy,
} from '@murph/assistant-core/assistant/conversation-policy'
export {
  resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationAudience,
  resolveAssistantConversationPolicy,
  shouldExposeSensitiveHealthContext,
} from '@murph/assistant-core/assistant/conversation-policy'
export type {
  AssistantRuntimeStateService,
} from '@murph/assistant-core/assistant/runtime-state-service'
export {
  createAssistantRuntimeStateService,
} from '@murph/assistant-core/assistant/runtime-state-service'
export type {
  AssistantTranscriptDistillation,
} from '@murph/assistant-core/assistant-cli-contracts'
export {
  appendAssistantTranscriptDistillation,
  buildAssistantTranscriptDistillationContinuityText,
  listAssistantTranscriptDistillations,
  maybeRefreshAssistantTranscriptDistillation,
  readLatestAssistantTranscriptDistillation,
  resolveAssistantTranscriptDistillationPath,
} from '@murph/assistant-core/assistant/transcript-distillation'

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
} from '@murph/assistant-core/assistant/conversation-ref'
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
  AssistantMemoryForgetInput,
  AssistantMemoryGetInput,
  AssistantMemoryPromptInput,
  AssistantMemorySearchInput,
  AssistantMemorySearchResponse,
  AssistantMemoryTurnContext,
  AssistantMemoryTurnContextInput,
  AssistantMemoryUpsertInput,
  AssistantMemoryUpsertWriteResult,
} from '@murph/assistant-core/assistant/memory'
export {
  assertAssistantMemoryTurnContextVault,
  createAssistantMemoryTurnContextEnv,
  forgetAssistantMemory,
  getAssistantMemory,
  loadAssistantMemoryPromptBlock,
  resolveAssistantMemoryTurnContext,
  searchAssistantMemory,
  upsertAssistantMemory,
} from '@murph/assistant-core/assistant/memory'
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
} from '@murph/assistant-core/assistant-cli-contracts'
export {
  dispatchAssistantOutboxIntent,
  drainAssistantOutbox,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
} from './assistant/outbox.js'
export type {
  AssistantStateDeleteDocumentInput,
  AssistantStateDeleteDocumentResult,
  AssistantStateDocumentSnapshot,
  AssistantStateGetDocumentInput,
  AssistantStateListDocumentsInput,
  AssistantStatePatchDocumentInput,
  AssistantStatePutDocumentInput,
} from '@murph/assistant-core/assistant/state'
export {
  buildDefaultAssistantCronStateDocId,
  deleteAssistantStateDocument,
  getAssistantStateDocument,
  listAssistantStateDocuments,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  resolveAssistantStateDocumentPath,
} from '@murph/assistant-core/assistant/state'

export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('@murph/assistant-core/assistant-cli-contracts').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}

export {
  runAssistantDoctor,
} from './assistant/doctor.js'
