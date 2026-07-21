import {
  parseTelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'
import {
  looksLikePrivateAssistantRoutePlaceholder,
} from '@murphai/operator-config/assistant/current-delivery-route'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { getAssistantChannelAdapter } from './channel-adapters.js'
import {
  readAssistantInputEvent,
  type AssistantInputConversationRef,
  type AssistantInputReplyTarget,
  type AssistantInputSourceMetadata,
} from './input-store.js'
import { normalizeNullableString } from './shared.js'

export type AssistantAcceptedMessageTargetAuthorizer = (input: {
  action: 'native-reply' | 'reaction'
  deliveryContextOrdinal: number
  messageRef: string
}) => Promise<{ targetInputId: string } | null>

export function readAssistantTargetProviderScalar(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }
  if (looksLikePrivateAssistantRoutePlaceholder(normalized)) {
    return null
  }
  return normalized
}

export function readAssistantInputMessageRef(input: {
  conversation: AssistantInputConversationRef | null
  inputId: string
  replyTarget: AssistantInputReplyTarget | null
  source: string
  sourceMetadata: AssistantInputSourceMetadata | null
}): string | null {
  const inputId = normalizeNullableString(input.inputId)
  const source = normalizeNullableString(input.source)?.toLowerCase() ?? null
  const conversation = input.conversation
  const replyTarget = input.replyTarget
  if (
    !inputId ||
    !/^ain_[0-9a-f]{32}$/u.test(inputId) ||
    (source !== 'linq' && source !== 'telegram') ||
    normalizeNullableString(conversation?.source)?.toLowerCase() !== source ||
    normalizeNullableString(conversation?.threadId) === null ||
    typeof conversation?.threadIsDirect !== 'boolean' ||
    normalizeNullableString(replyTarget?.channel)?.toLowerCase() !== source ||
    readAssistantTargetProviderScalar(replyTarget?.threadId) === null
  ) {
    return null
  }

  const messageId = readAssistantTargetProviderScalar(replyTarget?.messageId)
  if (!messageId || (source === 'telegram' && !/^\d+$/u.test(messageId))) {
    return null
  }

  if (source === 'linq') {
    const metadata = input.sourceMetadata
    if (
      metadata?.kind !== 'linq' ||
      normalizeNullableString(metadata.service)?.toLowerCase() !== 'imessage' ||
      (conversation.threadIsDirect === false &&
        metadata.externalThreadRouteAuthorityPresent !== true)
    ) {
      return null
    }
  }

  if (
    source === 'telegram' &&
    conversation.threadIsDirect === false &&
    (
      input.sourceMetadata?.kind !== 'telegram' ||
      input.sourceMetadata.externalThreadRouteAuthorityPresent !== true
    )
  ) {
    return null
  }

  return inputId
}

export function supportsAssistantAcceptedMessageTargetingRoute(input: {
  channel?: string | null
  explicitTarget?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): boolean {
  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null
  return (
    (channel === 'linq' || channel === 'telegram') &&
    normalizeNullableString(input.threadId) !== null &&
    typeof input.threadIsDirect === 'boolean' &&
    readAssistantTargetProviderScalar(input.explicitTarget) !== null
  )
}

export async function resolveAssistantAcceptedMessageTarget(input: {
  acceptedInputIds: readonly string[]
  action: 'native-reply' | 'reaction'
  messageRef: string
  route: {
    actorId?: string | null
    channel?: string | null
    explicitTarget?: string | null
    identityId?: string | null
    threadId?: string | null
    threadIsDirect?: boolean | null
  }
  vault: string
}): Promise<{
  deliveryMessageReactionsAvailable?: true
  deliveryReplyToMessageId: string
  targetInputId: string
}> {
  if (!input.acceptedInputIds.includes(input.messageRef)) {
    throw createAssistantMessageTargetUnavailableError()
  }

  const event = await readAssistantInputEvent({
    inputId: input.messageRef,
    vault: input.vault,
  })
  if (
    !event ||
    event.inputId !== input.messageRef ||
    readAssistantInputMessageRef({
      conversation: event.conversation,
      inputId: event.inputId,
      replyTarget: event.replyTarget,
      source: event.conversation?.source ?? '',
      sourceMetadata: event.sourceMetadata,
    }) !== input.messageRef
  ) {
    throw createAssistantMessageTargetUnavailableError()
  }

  const channel = normalizeNullableString(input.route.channel)?.toLowerCase() ?? null
  const conversation = event.conversation
  const replyTarget = event.replyTarget
  if (
    !supportsAssistantAcceptedMessageTargetingRoute(input.route) ||
    !conversation ||
    normalizeNullableString(conversation.source)?.toLowerCase() !== channel ||
    (channel === 'linq' &&
      normalizeNullableString(conversation.accountId) !==
        normalizeNullableString(input.route.identityId)) ||
    normalizeNullableString(conversation.threadId) !==
      normalizeNullableString(input.route.threadId) ||
    conversation.threadIsDirect !== input.route.threadIsDirect ||
    (conversation.threadIsDirect === true &&
      normalizeNullableString(conversation.actorId) !==
        normalizeNullableString(input.route.actorId)) ||
    !replyTarget ||
    normalizeNullableString(replyTarget.channel)?.toLowerCase() !== channel ||
    readAssistantTargetProviderScalar(replyTarget.threadId) !==
      readAssistantTargetProviderScalar(input.route.explicitTarget)
  ) {
    throw createAssistantMessageTargetUnavailableError()
  }

  const providerMessageId = readAssistantTargetProviderScalar(
    replyTarget.messageId,
  )
  if (!providerMessageId) {
    throw createAssistantMessageTargetUnavailableError()
  }

  const sourceMetadata = event.sourceMetadata
  if (input.action === 'native-reply') {
    return {
      deliveryReplyToMessageId: providerMessageId,
      targetInputId: event.inputId,
    }
  }

  if (!getAssistantChannelAdapter(channel)?.setMessageReaction) {
    throw createAssistantMessageTargetUnavailableError()
  }
  if (
    channel === 'linq' &&
    !(
      sourceMetadata?.kind === 'linq' &&
      sourceMetadata.reactionEligible === true
    )
  ) {
    throw createAssistantMessageTargetUnavailableError()
  }
  if (
    channel === 'telegram' &&
    parseTelegramThreadTarget(
      readAssistantTargetProviderScalar(input.route.explicitTarget) ?? '',
    )?.businessConnectionId
  ) {
    throw createAssistantMessageTargetUnavailableError()
  }

  return {
    ...(channel === 'linq'
      ? { deliveryMessageReactionsAvailable: true as const }
      : {}),
    deliveryReplyToMessageId: providerMessageId,
    targetInputId: event.inputId,
  }
}

function createAssistantMessageTargetUnavailableError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    'The selected message is not available for this action.',
  )
}
