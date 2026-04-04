import { createHash } from 'node:crypto'
import { getAssistantStateDocument, putAssistantStateDocument } from './state.js'
import { normalizeNullableString } from './shared.js'

export interface AssistantFirstContactLocator {
  actorId?: string | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export async function hasAssistantSeenFirstContact(input: {
  docIds: readonly string[]
  vault: string
}): Promise<boolean> {
  for (const docId of uniqueAssistantFirstContactDocIds(input.docIds)) {
    const snapshot = await getAssistantStateDocument({
      docId,
      vault: input.vault,
    })
    if (snapshot.exists) {
      return true
    }
  }

  return false
}

export async function markAssistantFirstContactSeen(input: {
  docIds: readonly string[]
  seenAt: string
  vault: string
}): Promise<void> {
  for (const docId of uniqueAssistantFirstContactDocIds(input.docIds)) {
    await putAssistantStateDocument({
      docId,
      vault: input.vault,
      value: {
        schemaVersion: 'murph.assistant-first-contact.v1',
        seenAt: input.seenAt,
      },
    })
  }
}

export function resolveAssistantFirstContactStateDocIds(
  input: AssistantFirstContactLocator,
): string[] {
  const channel = normalizeNullableString(input.channel)
  const identityId = normalizeNullableString(input.identityId)
  const actorId = normalizeNullableString(input.actorId)
  const threadId = normalizeNullableString(input.threadId)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null

  if (!channel) {
    return []
  }

  return uniqueAssistantFirstContactDocIds([
    actorId && threadIsDirect !== false
      ? buildAssistantFirstContactStateDocId({
          channel,
          identityId,
          scope: ['actor', actorId],
        })
      : null,
    threadId
      ? buildAssistantFirstContactStateDocId({
          channel,
          identityId,
          scope: ['thread', threadId],
        })
      : null,
  ])
}

function buildAssistantFirstContactStateDocId(input: {
  channel: string
  identityId: string | null
  scope: ['actor' | 'thread', string]
}): string {
  const key = [
    `channel:${encodeURIComponent(input.channel)}`,
    input.identityId ? `identity:${encodeURIComponent(input.identityId)}` : null,
    `${input.scope[0]}:${encodeURIComponent(input.scope[1])}`,
  ]
    .filter((value): value is string => value !== null)
    .join('|')

  return `onboarding/first-contact/${createHash('sha256').update(key).digest('hex')}`
}

function uniqueAssistantFirstContactDocIds(
  docIds: ReadonlyArray<string | null>,
): string[] {
  return [...new Set(
    docIds
      .map((docId) => normalizeNullableString(docId))
      .filter((docId): docId is string => docId !== null),
  )]
}
