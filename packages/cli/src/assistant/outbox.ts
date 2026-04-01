import {
  maybeDrainAssistantOutboxViaDaemon,
  maybeGetAssistantOutboxIntentViaDaemon,
  maybeListAssistantOutboxIntentsViaDaemon,
} from '../assistant-daemon-client.js'
import {
  drainAssistantOutboxLocal,
  listAssistantOutboxIntentsLocal,
  readAssistantOutboxIntent as readAssistantOutboxIntentLocal,
} from '@murphai/assistant-core/assistant/outbox'
import type { AssistantOutboxIntent } from '@murphai/assistant-core/assistant-cli-contracts'

export * from '@murphai/assistant-core/assistant/outbox'
export type { AssistantOutboxIntent } from '@murphai/assistant-core/assistant-cli-contracts'

export async function readAssistantOutboxIntent(
  vault: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  const remote = await maybeGetAssistantOutboxIntentViaDaemon({
    intentId,
    vault,
  })
  if (remote !== undefined) {
    return remote
  }

  return readAssistantOutboxIntentLocal(vault, intentId)
}

export async function listAssistantOutboxIntents(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  const remote = await maybeListAssistantOutboxIntentsViaDaemon({ vault })
  if (remote !== null) {
    return remote
  }

  return listAssistantOutboxIntentsLocal(vault)
}

export async function drainAssistantOutbox(input: {
  dependencies?: Parameters<typeof drainAssistantOutboxLocal>[0]['dependencies']
  dispatchHooks?: Parameters<typeof drainAssistantOutboxLocal>[0]['dispatchHooks']
  limit?: number
  now?: Date
  vault: string
}): Promise<{
  attempted: number
  failed: number
  queued: number
  sent: number
}> {
  const remote = await maybeDrainAssistantOutboxViaDaemon(input)
  if (remote) {
    return remote
  }

  return drainAssistantOutboxLocal(input)
}
