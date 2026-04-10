import { maybeRunAssistantAutomationViaDaemon } from '../../assistant-daemon-client.js'
import {
  runAssistantAutomation as runAssistantAutomationLocal,
  type RunAssistantAutomationInput,
} from '@murphai/assistant-engine/assistant-automation'

export * from '@murphai/assistant-engine/assistant-automation'

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
) {
  const canUseDaemonClient =
    input.executionContext === undefined &&
    input.inboxServices === undefined &&
    input.onEvent === undefined &&
    input.onInboxEvent === undefined &&
    input.signal === undefined &&
    input.vaultServices === undefined
  if (canUseDaemonClient) {
    const remote = await maybeRunAssistantAutomationViaDaemon(
      {
        allowSelfAuthored: input.allowSelfAuthored,
        deliveryDispatchMode: input.deliveryDispatchMode,
        drainOutbox: input.drainOutbox,
        maxPerScan: input.maxPerScan,
        modelSpec: input.modelSpec,
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

  return runAssistantAutomationLocal(input)
}
