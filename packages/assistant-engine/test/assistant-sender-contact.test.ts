import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createTempVaultContext } from './test-helpers.js'
import { upsertAssistantInputEvent, retireAssistantInputEventContent } from '../src/assistant/input-store.js'
import type { AssistantHostedUserActionScope } from '../src/assistant/hosted-tool-context.js'
import { executeMurphDynamicToolRequest, readMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_GET_SENDER_CONTACT_TOOL, executeGetSenderContactDynamicTool } from '../src/assistant-codex/dynamic-tools/sender-contact.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(senderHandle: string | null = '+12125550123', direct = true) {
  const { parentRoot, vaultRoot } = await createTempVaultContext('sender-contact-')
  roots.push(parentRoot)
  const event = await upsertAssistantInputEvent({ vault: vaultRoot, event: {
    occurredAt: '2030-04-01T16:00:00.000Z',
    sourceRef: { kind: 'inbox-capture', source: 'linq', captureId: 'synthetic-contact', version: null },
    conversation: { source: 'linq', accountId: null, actorId: 'synthetic-sender', actorIsSelf: false,
      threadId: 'synthetic-chat', threadIsDirect: direct },
    sourceMetadata: { kind: 'linq', externalThreadRouteAuthorityPresent: !direct, partCount: 1,
      reactionEligible: false, replyToMessageId: null, senderHandle, service: 'iMessage' },
    content: { text: 'Synthetic request.' },
  } })
  const scope: AssistantHostedUserActionScope = { acceptedInputIds: [event.inputId], conversationScope: 'direct',
    conversationId: 'synthetic-chat', inboundMailboxItemIds: [], recipientKey: 'synthetic-recipient', originSessionId: 'synthetic-session' }
  return { event, vaultRoot, scope }
}

describe('on-demand sender contact', () => {
  it('is deferred, opt-in and accepts no model-selected identity', () => {
    expect(MURPH_GET_SENDER_CONTACT_TOOL.deferLoading).toBe(true)
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_GET_SENDER_CONTACT_TOOL)
    expect(resolveMurphDynamicTools({ senderContactAvailable: true })).toContain(MURPH_GET_SENDER_CONTACT_TOOL)
    for (const args of [{ inputId: 'other-input' }, { senderHandle: '+12125550124' }]) {
      expect(readMurphDynamicToolRequest({ id: 'synthetic-request', method: 'item/tool/call', params: {
        callId: 'synthetic-call', threadId: 'synthetic-thread', turnId: 'synthetic-turn',
        namespace: 'murph', tool: 'get_sender_contact', arguments: args,
      } })).toMatchObject({ kind: 'invalid-sender-contact-arguments' })
    }
  })

  it.each(['+12125550123', 'member@example.invalid', null])('reads only the accepted private sender: %s', async (handle) => {
    const { scope, vaultRoot } = await fixture(handle)
    const result = await executeMurphDynamicToolRequest({ env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 1,
      progressDelivery: null, vaultRoot, request: { kind: 'get-sender-contact' }, hostedToolContext: {
        computerToolsAvailable: false, vaultFileSendAvailable: false, currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [], currentUserActionScope: () => scope,
        sendVaultFile: async () => { throw new Error('Unexpected write') },
      } })
    expect(result.rpcResult.success).toBe(true)
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual(handle
      ? { status: 'available', senderHandle: handle } : { status: 'unavailable' })
  })

  it('denies group, scheduled, missing and retired input without scanning other messages', async () => {
    const { scope, vaultRoot, event } = await fixture()
    for (const userActionScope of [null, { ...scope, conversationScope: 'group' as const }, { ...scope, acceptedInputIds: [] }]) {
      expect((await executeGetSenderContactDynamicTool({ userActionScope, vaultRoot })).rpcResult.success).toBe(false)
    }
    for (const inputId of ['ain_' + '0'.repeat(32), event.inputId]) {
      if (inputId === event.inputId) await retireAssistantInputEventContent({ inputId, vault: vaultRoot })
      const result = await executeGetSenderContactDynamicTool({ userActionScope: { ...scope, acceptedInputIds: [inputId] }, vaultRoot })
      expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({ status: 'unavailable' })
    }
    const group = await fixture('+12125550124', false)
    const result = await executeGetSenderContactDynamicTool({ userActionScope: group.scope, vaultRoot: group.vaultRoot })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({ status: 'unavailable' })
  })
})
