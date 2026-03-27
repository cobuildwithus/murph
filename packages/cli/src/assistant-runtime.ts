export type {
  AddAssistantCronJobInput,
  AssistantCronProcessDueResult,
  InstallAssistantCronPresetInput,
  InstallAssistantCronPresetResult,
  AssistantCronRunExecutionResult,
  AssistantCronStatusSnapshot,
  ProcessDueAssistantCronJobsInput,
  RunAssistantCronJobInput,
} from './assistant/cron.js'
export {
  addAssistantCronJob,
  buildAssistantCronSchedule,
  getAssistantCronPreset,
  getAssistantCronJob,
  getAssistantCronStatus,
  installAssistantCronPreset,
  listAssistantCronPresets,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  removeAssistantCronJob,
  runAssistantCronJobNow,
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
  AssistantInboxScanResult,
  AssistantRunEvent,
  RunAssistantAutomationInput,
} from './assistant/automation.js'
export {
  runAssistantAutomation,
  scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce,
} from './assistant/automation.js'
export type {
  AssistantOutboxDispatchHooks,
  AssistantOutboxDispatchMode,
} from './assistant/outbox.js'
export {
  drainAssistantOutbox,
  listAssistantOutboxIntents,
} from './assistant/outbox.js'

export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('./assistant-cli-contracts.js').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}

export {
  runAssistantDoctor,
} from './assistant/doctor.js'
