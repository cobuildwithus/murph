export type {
  AssistantChatInput,
  AssistantMessageInput,
} from './assistant/service.js'
export { sendAssistantMessage } from './assistant/service.js'
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

export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('./assistant-cli-contracts.js').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}
