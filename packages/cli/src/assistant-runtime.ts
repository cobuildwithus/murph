export type {
  AssistantChatInput,
  AssistantMessageInput,
} from './assistant/service.js'
export { sendAssistantMessage } from './assistant/service.js'
export type {
  AssistantMemoryGetInput,
  AssistantMemoryPromptInput,
  AssistantMemorySearchInput,
  AssistantMemorySearchResponse,
  AssistantMemoryUpsertInput,
  AssistantMemoryUpsertWriteResult,
} from './assistant/memory.js'
export {
  getAssistantMemory,
  loadAssistantMemoryPromptBlock,
  searchAssistantMemory,
  upsertAssistantMemory,
} from './assistant/memory.js'
export type {
  AssistantInboxScanResult,
  AssistantRunEvent,
  RunAssistantAutomationInput,
} from './assistant/automation.js'
export {
  runAssistantAutomation,
  scanAssistantInboxOnce,
} from './assistant/automation.js'

export async function runAssistantChat(
  input: import('./assistant/service.js').AssistantChatInput,
): Promise<import('./assistant-cli-contracts.js').AssistantChatResult> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}
