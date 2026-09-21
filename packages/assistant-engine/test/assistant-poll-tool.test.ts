import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_POLL_TOOL } from '../src/assistant-codex/dynamic-tools/conversation-polls.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'

const inputId = 'ain_' + 'a'.repeat(32)
const pollRef = 'poll_' + 'b'.repeat(32)
const snapshot = { pollRef, channel: 'telegram' as const, question: 'Which day?', options: [{ text: 'Saturday', votes: 2 }, { text: 'Sunday', votes: 1 }], totalVoters: 3, anonymous: true, multipleAnswers: false, closed: false, observedAt: '2026-09-21T12:00:00.000Z', freshness: 'provider_update' as const }
const port = vi.fn(async () => ({ status: 'results' as const, polls: [snapshot] }))
function context(): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false, vaultFileSendAvailable: false,
    pollTool: { request: port },
    currentInvocationScope: () => ({ origin: { kind: 'accepted_input', sessionId: 'synthetic-poll-session', assistantInputId: inputId }, conversationScope: 'group' }),
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: async () => { throw new Error('Not authorized') },
  }
}
function parse(args: unknown) {
  return readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: { namespace: 'murph', tool: 'poll', arguments: args } })
}
describe('native poll dynamic tool', () => {
  it('offers a current conversation tool only when its port is authorized', () => {
    expect(resolveMurphDynamicTools({ pollsAvailable: true })).toContain(MURPH_POLL_TOOL)
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_POLL_TOOL)
  })
  it.each([
    { action: 'create', question: 'Day?', options: ['A', 'a'] },
    { action: 'create', question: 'Day?', options: ['A'] },
    { action: 'create', question: 'Day?', options: ['A', 'B'], chatId: 'other' },
    { action: 'read', pollRef: 'invented' },
  ])('rejects invalid or route-selecting input %j', (args) => {
    expect(parse(args)?.kind).toBe('invalid-poll-arguments')
  })
  it('binds reads to the accepted input and preserves tally freshness', async () => {
    port.mockClear()
    const request = parse({ action: 'read', pollRef })
    if (!request) throw new Error('Expected poll request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(port).toHaveBeenCalledExactlyOnceWith({ assistantInputId: inputId, request: { action: 'read', pollRef } })
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems[0]?.text).toContain('provider_update')
  })
  it('denies scheduled or detached requests without accepted input authority', async () => {
    port.mockClear()
    const request = parse({ action: 'list' })
    if (!request) throw new Error('Expected poll request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), currentInvocationScope: () => null }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
})

