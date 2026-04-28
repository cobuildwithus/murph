import { maybeRunAssistantAutomationViaDaemon } from '../../assistant-daemon-client.js'
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
  const canUseDaemonClient =
    input.executionContext === undefined &&
    input.inboxServices === undefined &&
    input.onEvent === undefined &&
    input.onInboxEvent === undefined &&
    input.signal === undefined &&
    input.turnInputPort === undefined &&
    input.vaultServices === undefined
  if (canUseDaemonClient) {
    const remote = await maybeRunAssistantAutomationViaDaemon(
      {
        allowSelfAuthored: input.allowSelfAuthored,
        deliveryDispatchMode: input.deliveryDispatchMode,
        drainOutbox: input.drainOutbox,
        maxPerScan: input.maxPerScan,
        once: input.once,
        requestId: input.requestId ?? null,
        sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
        startDaemon: input.startDaemon,
        vault: input.vault,
      },
    )
    if (remote) {
      return remote
    }
  }

  await dropLegacyLocalLinqAutoReplyState(input.vault)
  return runAssistantAutomationLocal(input)
}
