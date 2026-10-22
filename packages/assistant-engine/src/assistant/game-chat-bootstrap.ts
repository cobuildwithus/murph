import { listAssistantTranscriptTailEntries } from './store.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantDeliveryOutcome } from './service-contracts.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { createHostedAssistantConversationIdentifierBlind, hashHostedAssistantConversationIdentifier } from '@murphai/hosted-execution/assistant-identifiers'
import type { HostedGameChatBootstrapResult } from '@murphai/hosted-execution/runtime-control'

/** Match the ordinary Linq mailbox import locator, using only an accepted Web receipt. */
export function buildAssistantGameBootstrapAcceptedRoute(
  receipt: Extract<HostedGameChatBootstrapResult, { status: 'sent' }>,
  memberId: string | null | undefined,
) {
  if (!memberId) throw new TypeError('Game bootstrap requires its bound group runtime.')
  const blind = createHostedAssistantConversationIdentifierBlind({ secret: receipt.accountLookupKey, userId: memberId })
  return {
    actorId: null,
    channel: 'linq' as const,
    identityId: hashHostedAssistantConversationIdentifier(blind, receipt.accountLookupKey),
    threadId: hashHostedAssistantConversationIdentifier(blind, receipt.chatId),
    threadIsDirect: false,
    deliveryKind: 'thread' as const,
    bindingDeliveryTarget: receipt.chatId,
  }
}

/** Reuse the same group transcript through the ordinary binding/index owner. */
export async function adoptAssistantGameBootstrapSession(input: {
  receipt: Extract<HostedGameChatBootstrapResult, { status: 'sent' }>
  memberId: string | null | undefined
  session: AssistantSession
  vault: string
}): Promise<AssistantSession> {
  const route = buildAssistantGameBootstrapAcceptedRoute(input.receipt, input.memberId)
  const rebound = await createAssistantRuntimeStateService(input.vault).sessions.resolve({
    ...route, sessionId: input.session.sessionId, allowBindingRebind: true, createIfMissing: false,
  })
  return { ...input.session, binding: rebound.session.binding }
}


type BootstrapReceipt = Extract<HostedGameChatBootstrapResult, { status: 'sent' }>
type NotificationInput = import('./notification-turn.js').AssistantNotificationInput
type NotificationResult = import('./notification-turn.js').AssistantNotificationResult

export async function prepareAssistantGameBootstrap(input: NotificationInput): Promise<{
  input: NotificationInput
  recovery: HostedGameChatBootstrapResult | null
}> {
  const bootstrap = input.gameChatBootstrap
  if (!bootstrap) return { input, recovery: null }
  if (input.threadIsDirect !== false || input.channel !== 'linq'
    || input.threadId != null || input.deliveryTarget != null || input.bindingDeliveryTarget != null) {
    throw new TypeError('Game bootstrap requires a route-less group notification.')
  }
  const recovery = await bootstrap.recover()
  const prepared = { ...input, deferCommitUntilDeliveryAccepted: true }
  if (recovery.status !== 'sent') return { input: prepared, recovery }
  return { recovery, input: {
    ...prepared,
    ...buildAssistantGameBootstrapAcceptedRoute(recovery, input.executionContext?.hosted?.memberId),
    responsePolicy: { kind: 'require_send_exact_text', text: recovery.message },
    gameChatBootstrap: { ...bootstrap, send: async () => recovery },
  } }
}

export async function recoverAssistantGameBootstrapResult(input: {
  notification: NotificationInput
  recovery: HostedGameChatBootstrapResult | null
  session: AssistantSession
}): Promise<NotificationResult | null> {
  const { recovery, notification, session } = input
  if (!recovery || recovery.status === 'needs_message') return null
  if (recovery.status === 'unavailable') {
    return { decision: { kind: 'skip', privateSummary: 'Game announcement is no longer available.' }, response: null, session }
  }
  // A receipt proves delivery; repair a missing transcript commit with the frozen
  // text, but never append the same standalone context again after a full commit.
  const tail = await listAssistantTranscriptTailEntries(notification.vault, session.sessionId, { maxBytes: 64 * 1024 })
  if (!tail.some((entry) => entry.kind === 'assistant' && entry.standaloneAssistantContext === true && entry.text === recovery.message)) return null
  return {
    decision: { kind: 'send_message', privateSummary: 'Previously accepted game announcement.', text: recovery.message },
    response: recovery.message,
    session,
    deliveryOutcome: await acceptAssistantGameBootstrapReceipt({ receipt: recovery, memberId: notification.executionContext?.hosted?.memberId, session, vault: notification.vault }),
  }
}

async function acceptAssistantGameBootstrapReceipt(input: {
  receipt: BootstrapReceipt
  memberId: string | null | undefined
  session: AssistantSession
  vault: string
}): Promise<AssistantDeliveryOutcome> {
  const { receipt } = input
  const session = await adoptAssistantGameBootstrapSession(input)
  return {
    kind: 'sent', intentId: null, media: [], session,
    delivery: { channel: 'linq', target: receipt.chatId, targetKind: 'thread',
      sentAt: receipt.acceptedAt, messageLength: receipt.message.length,
      idempotencyKey: receipt.deliveryId, providerMessageId: receipt.providerMessageId,
      providerThreadId: receipt.chatId },
  }
}

export async function deliverAssistantGameBootstrapMessage(input: {
  bootstrap: NonNullable<NotificationInput['gameChatBootstrap']>
  followUpRequest?: import('@murphai/contracts').AutomationFollowUpRequest | null
  card?: import('@murphai/operator-config/assistant-response-cards').AssistantResponseCard | null
  media?: readonly import('@murphai/operator-config/assistant-cli-contracts').AssistantResponseMedia[] | null
  message: string
  session: AssistantSession
  memberId: string | null | undefined
  vault: string
}): Promise<AssistantDeliveryOutcome> {
  if ((input.media?.length ?? 0) > 0 || input.card || input.followUpRequest) {
    throw new TypeError('Game bootstrap supports one text announcement only.')
  }
  const receipt = await input.bootstrap.send(input.message)
  if (receipt.status === 'unavailable') {
    throw new VaultCliError('GAME_CHAT_BOOTSTRAP_UNAVAILABLE', 'Game announcement is no longer available.', { retryable: false })
  }
  if (receipt.status !== 'sent' || receipt.message !== input.message) {
    throw new VaultCliError('GAME_CHAT_BOOTSTRAP_RECEIPT_INVALID', 'Game announcement receipt did not match its frozen message.')
  }
  return acceptAssistantGameBootstrapReceipt({ ...input, receipt })
}
