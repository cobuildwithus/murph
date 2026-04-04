import { createHash } from 'node:crypto'
import type { AssistantSessionBinding } from '../assistant-cli-contracts.js'
import type { AssistantConversationAudience } from './conversation-policy.js'
import { getAssistantStateDocument, putAssistantStateDocument } from './state.js'
import { normalizeNullableString } from './shared.js'

export function resolveAssistantFirstContactStateDocId(input: {
  audience: Pick<
    AssistantConversationAudience,
    'actorId' | 'channel' | 'identityId' | 'threadId' | 'threadIsDirect'
  >
  binding: Pick<
    AssistantSessionBinding,
    'actorId' | 'channel' | 'identityId' | 'threadId' | 'threadIsDirect'
  >
}): string | null {
  const channel =
    normalizeNullableString(input.audience.channel) ??
    normalizeNullableString(input.binding.channel)
  const identityId =
    normalizeNullableString(input.audience.identityId) ??
    normalizeNullableString(input.binding.identityId)
  const actorId =
    normalizeNullableString(input.audience.actorId) ??
    normalizeNullableString(input.binding.actorId)
  const threadId =
    normalizeNullableString(input.audience.threadId) ??
    normalizeNullableString(input.binding.threadId)
  const threadIsDirect =
    typeof input.audience.threadIsDirect === 'boolean'
      ? input.audience.threadIsDirect
      : input.binding.threadIsDirect

  if (!channel) {
    return null
  }

  const scope = actorId && threadIsDirect !== false
    ? `actor:${encodeURIComponent(actorId)}`
    : threadId
      ? `thread:${encodeURIComponent(threadId)}`
      : null
  if (!scope) {
    return null
  }

  const key = [
    `channel:${encodeURIComponent(channel)}`,
    identityId ? `identity:${encodeURIComponent(identityId)}` : null,
    scope,
  ]
    .filter((value): value is string => value !== null)
    .join('|')

  return `onboarding/first-contact/${createHash('sha256').update(key).digest('hex')}`
}

export async function hasAssistantSeenFirstContact(input: {
  docId: string | null
  vault: string
}): Promise<boolean> {
  if (!input.docId) {
    return false
  }

  const snapshot = await getAssistantStateDocument({
    docId: input.docId,
    vault: input.vault,
  })
  return snapshot.exists
}

export async function markAssistantFirstContactSeen(input: {
  docId: string | null
  seenAt: string
  vault: string
}): Promise<void> {
  if (!input.docId) {
    return
  }

  await putAssistantStateDocument({
    docId: input.docId,
    vault: input.vault,
    value: {
      schemaVersion: 'murph.assistant-first-contact.v1',
      seenAt: input.seenAt,
    },
  })
}
