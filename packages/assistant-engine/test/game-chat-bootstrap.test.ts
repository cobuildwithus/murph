import { expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { createHostedAssistantConversationIdentifierBlind, hashHostedAssistantConversationIdentifier } from '@murphai/hosted-execution/assistant-identifiers'
import { buildAssistantGameBootstrapAcceptedRoute, deliverAssistantGameBootstrapMessage, recoverAssistantGameBootstrapResult } from '../src/assistant/game-chat-bootstrap.ts'
import { appendAssistantTranscriptEntries, listAssistantTranscriptEntries, resolveAssistantSession } from '../src/assistant/store.ts'
import { createAssistantAutoReplyHistoryReader } from '../src/assistant/automation/reply.ts'
import { dispatchAssistantOutboxIntent, listAssistantOutboxIntentsLocal } from '../src/assistant/outbox.ts'

test('accepted bootstrap adopts the exact first inbound Linq room and preserves contextual yes history', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-bootstrap-continuity-'))
  try {
    const target = createAssistantModelTarget({ provider: 'codex-cli', model: 'gpt-6.1-sol', approvalPolicy: 'never', sandbox: 'read-only' })
    if (!target) throw new Error('Expected synthetic model target.')
    const memberId = 'synthetic-group'
    const bootstrap = await resolveAssistantSession({ vault, target, channel: 'linq', identityId: memberId, threadIsDirect: false })
    const receipt = { status: 'sent' as const, message: 'Your walking challenge is on. Want reminders here for the first few days?', chatId: 'real-provider-chat', accountLookupKey: 'synthetic-account', deliveryId: 'synthetic-delivery', providerMessageId: 'synthetic-message', acceptedAt: '2030-03-04T12:00:00.000Z' }
    const send = vi.fn(async () => receipt)
    const delivered = await deliverAssistantGameBootstrapMessage({ bootstrap: { send, recover: async () => receipt },
      message: receipt.message, memberId, session: bootstrap.session, turnId: 'turn-bootstrap', vault })
    const [intent] = await listAssistantOutboxIntentsLocal(vault)
    expect(intent).toMatchObject({ status: 'sent', nextAttemptAt: null, message: receipt.message,
      turnId: 'turn-bootstrap', delivery: { providerMessageId: receipt.providerMessageId } })
    expect(delivered).toMatchObject({ kind: 'sent', intentId: intent!.intentId })
    await appendAssistantTranscriptEntries(vault, bootstrap.session.sessionId, [{ kind: 'assistant', text: receipt.message, standaloneAssistantContext: true, createdAt: receipt.acceptedAt }])
    // Same transformation used by the ordinary hosted Linq mailbox importer.
    const blind = createHostedAssistantConversationIdentifierBlind({ secret: receipt.accountLookupKey, userId: memberId })
    const incoming = await resolveAssistantSession({ vault, target, channel: 'linq',
      identityId: hashHostedAssistantConversationIdentifier(blind, receipt.accountLookupKey),
      threadId: hashHostedAssistantConversationIdentifier(blind, receipt.chatId),
      actorId: hashHostedAssistantConversationIdentifier(blind, 'synthetic-sender'), threadIsDirect: false,
      deliveryKind: 'thread', bindingDeliveryTarget: receipt.chatId,
    })
    expect(incoming.created).toBe(false)
    expect(incoming.session.sessionId).toBe(bootstrap.session.sessionId)
    expect(incoming.session.binding.delivery).toMatchObject({ kind: 'thread', target: receipt.chatId })
    // Reaction attestation reads candidates from this route/provider-ID index,
    // when a different player reacts to the first message in the new room.
    const history = createAssistantAutoReplyHistoryReader({ vault })
    const query = { source: 'linq', deliveryTarget: receipt.chatId, providerMessageIds: [receipt.providerMessageId],
      conversation: { source: 'linq', accountId: incoming.session.binding.identityId,
        actorId: 'other-player', actorIsSelf: false, threadId: incoming.session.binding.threadId, threadIsDirect: false } }
    expect(await history.readOutboxIntents(query)).toEqual([expect.objectContaining({ intentId: intent!.intentId, status: 'sent' })])
    expect(await history.readOutboxIntents({ ...query, deliveryTarget: 'other-chat' })).toEqual([])
    const recovered = await recoverAssistantGameBootstrapResult({ recovery: receipt, session: incoming.session,
      notification: { vault, instructions: 'Announce the game.', executionContext: { hosted: { memberId, userEnvKeys: [] } } } })
    expect(recovered?.deliveryOutcome).toMatchObject({ kind: 'sent', intentId: intent!.intentId })
    const redeliver = vi.fn()
    await dispatchAssistantOutboxIntent({ vault, intentId: intent!.intentId, dependencies: { sendLinq: redeliver } })
    expect(redeliver).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledOnce()
    expect(await listAssistantOutboxIntentsLocal(vault)).toHaveLength(1)
    await appendAssistantTranscriptEntries(vault, incoming.session.sessionId, [{ kind: 'user', text: 'Yes please', createdAt: '2030-03-04T12:01:00.000Z' }])
    expect((await listAssistantTranscriptEntries(vault, incoming.session.sessionId)).map((entry) => entry.text)).toEqual([receipt.message, 'Yes please'])
    const recovery = await resolveAssistantSession({ vault, target, ...buildAssistantGameBootstrapAcceptedRoute(receipt, memberId) })
    expect(recovery.session.sessionId).toBe(incoming.session.sessionId)
    const other = await resolveAssistantSession({ vault, target, ...buildAssistantGameBootstrapAcceptedRoute({ ...receipt, chatId: 'different-provider-chat' }, memberId) })
    expect(other.session.sessionId).not.toBe(incoming.session.sessionId)
    expect(await listAssistantTranscriptEntries(vault, other.session.sessionId)).toEqual([])
  } finally { await rm(vault, { recursive: true, force: true }) }
})
