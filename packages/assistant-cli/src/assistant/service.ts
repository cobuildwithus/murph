// Thin daemon-aware wrapper around the assistant-engine local assistant orchestration.
import {
  maybeOpenAssistantConversationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../assistant-daemon-client.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  openAssistantConversationLocal,
  sendAssistantMessageLocal,
  updateAssistantSessionOptionsLocal,
  type AssistantMessageInput,
  type AssistantSessionResolutionFields,
} from '@murphai/assistant-engine/assistant-service'
import {
  getAssistantSessionLocal,
} from '@murphai/assistant-engine/assistant-store'

export * from '@murphai/assistant-engine/assistant-service'

type AssistantSessionOptionsPatch = Pick<
  AssistantSession['providerOptions'],
  'provider'
> &
  Partial<Omit<AssistantSession['providerOptions'], 'provider'>>

const LOCAL_ASSISTANT_LINQ_ERROR =
  'Local assistant Linq routes are no longer supported. Hosted/shared assistant-engine Linq support remains available.'

function normalizeAssistantChannel(channel?: string | null): string | null {
  if (typeof channel !== 'string') {
    return null
  }
  const normalized = channel.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function isAssistantSessionNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ASSISTANT_SESSION_NOT_FOUND',
  )
}

function throwLocalAssistantLinqUnsupported(): never {
  throw new VaultCliError('invalid_option', LOCAL_ASSISTANT_LINQ_ERROR)
}

async function assertLocalAssistantLinqRouteAllowed(input: {
  channel?: string | null
  conversation?: { channel?: string | null } | null
  sessionId?: string | null
  vault: string
}): Promise<void> {
  if (
    normalizeAssistantChannel(input.channel) === 'linq' ||
    normalizeAssistantChannel(input.conversation?.channel) === 'linq'
  ) {
    throwLocalAssistantLinqUnsupported()
  }

  if (!input.sessionId) {
    return
  }

  try {
    const session = await getAssistantSessionLocal(input.vault, input.sessionId)
    if (normalizeAssistantChannel(session.binding.channel) === 'linq') {
      throwLocalAssistantLinqUnsupported()
    }
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) {
      throw error
    }
  }
}

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  await assertLocalAssistantLinqRouteAllowed({
    channel: input.channel,
    conversation: input.conversation,
    sessionId: input.sessionId,
    vault: input.vault,
  })

  const remote = await maybeOpenAssistantConversationViaDaemon(input)
  if (remote) {
    return remote
  }

  return openAssistantConversationLocal(input)
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
) {
  const messageInput = {
    ...input,
    operatorAuthority: input.operatorAuthority ?? 'direct-operator',
  } satisfies AssistantMessageInput

  await assertLocalAssistantLinqRouteAllowed({
    channel: messageInput.channel,
    conversation: messageInput.conversation,
    sessionId: messageInput.sessionId,
    vault: messageInput.vault,
  })

  const remote = await maybeSendAssistantMessageViaDaemon(messageInput)
  if (remote) {
    return remote
  }

  return sendAssistantMessageLocal(messageInput)
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: AssistantSessionOptionsPatch
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const remote = await maybeUpdateAssistantSessionOptionsViaDaemon(input)
  if (remote) {
    return remote
  }

  return updateAssistantSessionOptionsLocal(input)
}
