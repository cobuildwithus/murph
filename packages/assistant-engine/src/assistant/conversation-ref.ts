import type { AssistantSessionBinding } from '@murphai/operator-config/assistant-cli-contracts'
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

export interface ConversationRefLocatorInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface ConversationBindingFields {
  actorId: string | null
  threadIsDirect: boolean | null
}

export interface ConversationLocatorBindingPatch {
  actorId?: string | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface ConversationLocatorResolution {
  bindingFields: ConversationBindingFields
  bindingPatch: ConversationLocatorBindingPatch
  conversation: ConversationRef
  explicitAlias: string | null
}

export interface AssistantInputConversationRef {
  accountId: string | null
  actorId: string | null
  actorIsSelf: boolean
  source: string | null
  sessionId?: string | null
  threadId: string | null
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

export function conversationRefFromLocator(
  input: ConversationRefLocatorInput,
): ConversationRef {
  return resolveConversationLocator(input).conversation
}

export function resolveConversationLocator(
  input: ConversationRefLocatorInput,
): ConversationLocatorResolution {
  const nestedConversation = asConversationRef(input.conversation)
  const conversation = mergeConversationRefs(nestedConversation, {
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    participantId: input.actorId ?? input.participantId,
    threadId: input.threadId,
    directness: conversationDirectnessFromThreadIsDirect(input.threadIsDirect),
  })
  const bindingFields = conversationRefToBindingFields(conversation)
  const bindingPatch: ConversationLocatorBindingPatch = {}

  if (
    'actorId' in input ||
    'participantId' in input ||
    hasConversationRefField(nestedConversation, 'participantId')
  ) {
    bindingPatch.actorId = bindingFields.actorId
  }
  if ('channel' in input || hasConversationRefField(nestedConversation, 'channel')) {
    bindingPatch.channel = conversation.channel ?? null
  }
  if (
    'identityId' in input ||
    hasConversationRefField(nestedConversation, 'identityId')
  ) {
    bindingPatch.identityId = conversation.identityId ?? null
  }
  if (
    'threadId' in input ||
    hasConversationRefField(nestedConversation, 'threadId')
  ) {
    bindingPatch.threadId = conversation.threadId ?? null
  }
  if (
    'threadIsDirect' in input ||
    hasConversationRefField(nestedConversation, 'directness')
  ) {
    bindingPatch.threadIsDirect = bindingFields.threadIsDirect
  }

  return {
    bindingFields,
    bindingPatch,
    conversation,
    explicitAlias:
      normalizeNullableString(nestedConversation?.alias) ??
      normalizeNullableString(input.alias),
  }
}

function asConversationRef(
  input: ConversationRef | null | undefined,
): ConversationRef | null {
  return typeof input === 'object' && input !== null ? input : null
}

function hasConversationRefField(
  input: ConversationRef | null,
  field: keyof ConversationRef,
): boolean {
  return input !== null && field in input
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
  return conversationRefFromAssistantInputConversation(
    assistantInputConversationRefFromCapture(input),
  )
}

export function conversationRefFromAssistantInputConversation(
  input: AssistantInputConversationRef,
): ConversationRef {
  return normalizeConversationRef({
    sessionId: input.sessionId,
    channel: input.source,
    identityId:
      input.source === 'email' || input.source === 'linq'
        ? input.accountId
        : null,
    participantId: input.actorId,
    threadId: input.threadId,
    directness: conversationDirectnessFromThreadIsDirect(input.threadIsDirect),
  })
}

export function assistantInputConversationRefFromCapture(input: {
  accountId?: string | null
  actorId?: string | null
  actorIsSelf?: boolean | null
  source?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): AssistantInputConversationRef {
  return {
    accountId: normalizeNullableString(input.accountId),
    actorId: normalizeNullableString(input.actorId),
    actorIsSelf: input.actorIsSelf === true,
    source: normalizeNullableString(input.source),
    threadId: normalizeNullableString(input.threadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
  }
}

export function isSameAssistantConversationRef(
  left: AssistantInputConversationRef | null | undefined,
  right: AssistantInputConversationRef | null | undefined,
): boolean {
  if (!left || !right) {
    return false
  }

  return (
    left.accountId === right.accountId &&
    left.actorId === right.actorId &&
    left.actorIsSelf === right.actorIsSelf &&
    left.source === right.source &&
    (left.sessionId ?? null) === (right.sessionId ?? null) &&
    left.threadId === right.threadId &&
    left.threadIsDirect === right.threadIsDirect
  )
}

export function isSameAssistantConversationCapture(
  left: {
    accountId?: string | null
    actorId?: string | null
    actorIsSelf?: boolean | null
    source?: string | null
    threadId?: string | null
    threadIsDirect?: boolean | null
  },
  right: {
    accountId?: string | null
    actorId?: string | null
    actorIsSelf?: boolean | null
    source?: string | null
    threadId?: string | null
    threadIsDirect?: boolean | null
  },
): boolean {
  return isSameAssistantConversationRef(
    assistantInputConversationRefFromCapture(left),
    assistantInputConversationRefFromCapture(right),
  )
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
