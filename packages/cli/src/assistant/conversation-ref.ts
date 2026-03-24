import type { AssistantSessionBinding } from '../assistant-cli-contracts.js'
import { normalizeNullableString } from './shared.js'

export const assistantConversationDirectnessValues = [
  'direct',
  'group',
  'unknown',
] as const

export type AssistantConversationDirectness =
  (typeof assistantConversationDirectnessValues)[number]

export interface ConversationRef {
  alias?: string | null
  channel?: string | null
  directness?: AssistantConversationDirectness | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  threadId?: string | null
}

export interface ConversationBindingFields {
  actorId: string | null
  threadIsDirect: boolean | null
}

export function normalizeConversationRef(
  input: ConversationRef | null | undefined,
): ConversationRef {
  if (!input) {
    return {}
  }

  return {
    sessionId: normalizeNullableString(input.sessionId),
    alias: normalizeNullableString(input.alias),
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    threadId: normalizeNullableString(input.threadId),
    directness: normalizeConversationDirectness(input.directness),
  }
}

export function conversationRefToBindingFields(
  input: ConversationRef | null | undefined,
): ConversationBindingFields {
  const normalized = normalizeConversationRef(input)
  return {
    actorId: normalized.participantId ?? null,
    threadIsDirect: threadIsDirectFromConversationDirectness(
      normalized.directness,
    ),
  }
}

export function conversationRefFromBinding(
  binding: Pick<
    AssistantSessionBinding,
    'channel' | 'identityId' | 'actorId' | 'threadId' | 'threadIsDirect'
  >,
): ConversationRef {
  return normalizeConversationRef({
    channel: binding.channel,
    identityId: binding.identityId,
    participantId: binding.actorId,
    threadId: binding.threadId,
    directness: conversationDirectnessFromThreadIsDirect(binding.threadIsDirect),
  })
}

export function conversationRefFromCapture(input: {
  accountId?: string | null
  actorId?: string | null
  source?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): ConversationRef {
  return normalizeConversationRef({
    channel: input.source,
    identityId:
      input.source === 'email' || input.source === 'linq' ? input.accountId : null,
    participantId: input.actorId,
    threadId: input.threadId,
    directness: conversationDirectnessFromThreadIsDirect(input.threadIsDirect),
  })
}

export function mergeConversationRefs(
  base: ConversationRef | null | undefined,
  patch: ConversationRef | null | undefined,
): ConversationRef {
  const normalizedBase = normalizeConversationRef(base)
  const normalizedPatch = normalizeConversationRef(patch)

  return {
    sessionId: normalizedPatch.sessionId ?? normalizedBase.sessionId,
    alias: normalizedPatch.alias ?? normalizedBase.alias,
    channel: normalizedPatch.channel ?? normalizedBase.channel,
    identityId: normalizedPatch.identityId ?? normalizedBase.identityId,
    participantId: normalizedPatch.participantId ?? normalizedBase.participantId,
    threadId: normalizedPatch.threadId ?? normalizedBase.threadId,
    directness: normalizedPatch.directness ?? normalizedBase.directness,
  }
}

export function conversationDirectnessFromThreadIsDirect(
  threadIsDirect: boolean | null | undefined,
): AssistantConversationDirectness | null {
  if (threadIsDirect === true) {
    return 'direct'
  }
  if (threadIsDirect === false) {
    return 'group'
  }
  return null
}

export function threadIsDirectFromConversationDirectness(
  directness: AssistantConversationDirectness | null | undefined,
): boolean | null {
  switch (normalizeConversationDirectness(directness)) {
    case 'direct':
      return true
    case 'group':
      return false
    default:
      return null
  }
}

function normalizeConversationDirectness(
  value: AssistantConversationDirectness | string | null | undefined,
): AssistantConversationDirectness | null {
  switch (normalizeNullableString(value)) {
    case 'direct':
      return 'direct'
    case 'group':
      return 'group'
    case 'unknown':
      return 'unknown'
    default:
      return null
  }
}
