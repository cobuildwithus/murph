export type {
  AssistantConversationAudience,
  AssistantConversationDeliveryPolicy,
  AssistantConversationPolicy,
} from './assistant/conversation-policy.js'
export {
  resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationAudience,
  resolveAssistantConversationPolicy,
  shouldExposeSensitiveHealthContext,
} from './assistant/conversation-policy.js'
export type {
  AssistantRuntimeStateService,
} from './assistant/runtime-state-service.js'
export {
  createAssistantRuntimeStateService,
} from './assistant/runtime-state-service.js'
export type {
  AssistantTranscriptDistillation,
} from './assistant-cli-contracts.js'
export {
  appendAssistantTranscriptDistillation,
  buildAssistantTranscriptDistillationContinuityText,
  listAssistantTranscriptDistillations,
  maybeRefreshAssistantTranscriptDistillation,
  readLatestAssistantTranscriptDistillation,
  resolveAssistantTranscriptDistillationPath,
} from './assistant/transcript-distillation.js'

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
} from './assistant/conversation-ref.js'
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
} from './assistant/memory.js'
export {
  assertAssistantMemoryTurnContextVault,
  createAssistantMemoryTurnContextEnv,
  forgetAssistantMemory,
  getAssistantMemory,
  loadAssistantMemoryPromptBlock,
  resolveAssistantMemoryTurnContext,
  searchAssistantMemory,
  upsertAssistantMemory,
} from './assistant/memory.js'
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
} from './assistant-cli-contracts.js'
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
} from './assistant/state.js'
export {
  buildDefaultAssistantCronStateDocId,
  deleteAssistantStateDocument,
  getAssistantStateDocument,
  listAssistantStateDocuments,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  resolveAssistantStateDocumentPath,
} from './assistant/state.js'

export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('./assistant-cli-contracts.js').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}

export {
  runAssistantDoctor,
} from './assistant/doctor.js'
