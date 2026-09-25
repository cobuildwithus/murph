import {
  runAssistantAutomation as runAssistantAutomationLocal,
  type RunAssistantAutomationInput,
} from '@murphai/assistant-engine/assistant-automation'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '@murphai/assistant-engine/assistant-store'

export * from '@murphai/assistant-engine/assistant-automation'

async function dropLegacyLocalLinqAutoReplyState(vault: string): Promise<void> {
  const state = await readAssistantAutomationState(vault)
  const nextAutoReply = state.autoReply.filter((entry) => entry.channel !== 'linq')

  if (nextAutoReply.length === state.autoReply.length) {
    return
  }

  await saveAssistantAutomationState(vault, {
    ...state,
    autoReply: nextAutoReply,
    updatedAt: new Date().toISOString(),
  })
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
) {
  await dropLegacyLocalLinqAutoReplyState(input.vault)
  return runAssistantAutomationLocal(input)
}
