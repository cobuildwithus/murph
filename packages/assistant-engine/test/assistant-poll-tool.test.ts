import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_POLL_TOOL } from '../src/assistant-codex/dynamic-tools/conversation-polls.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.js'

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
  it.each(['direct', 'group'] as const)('gates tasteful proactive guidance on tool availability in %s conversations', (conversationScope) => {
    for (const available of [false, true]) {
      const layers = buildAssistantSystemPromptLayers({
        assistantCliContract: null, assistantPollsAvailable: available,
        channel: 'telegram', cliAccess: { rawCommand: 'vault-cli' },
        conversationScope, currentLocalDate: '2026-09-21', currentTimeZone: 'UTC',
        hostedRuntime: true,onboardingGuidance: false,
      })
      expect(layers.blocks.some((block) => block.id === 'route.native-polls')).toBe(available)
      expect(resolveMurphDynamicTools({ pollsAvailable: available }).includes(MURPH_POLL_TOOL)).toBe(available)
    }
  })
  it('offers a current conversation tool only when its port is authorized', () => {
    expect(resolveMurphDynamicTools({ pollsAvailable: true })).toContain(MURPH_POLL_TOOL)
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_POLL_TOOL)
  })
  it.each([
    { action: 'create', question: 'Day?', options: ['A', 'a'] },
    { action: 'create', question: 'Day?', options: ['A'] },
    { action: 'create', question: 'Day?', options: ['A', 'B'], chatId: 'other' },
    { action: 'read', pollRef: 'invented' },
    { action: 'list', origin: { kind: 'automation_occurrence', automationId: 'automation_poll', occurrenceAt: '2026-11-02T14:00:00.000Z' } },
    { action: 'list', route: { channel: 'telegram', target: 'other-chat' } },
    { action: 'list', assistantInputId: inputId },
    { action: 'vote', pollRef, optionIndex: -1, operation: 'add' },
    { action: 'vote', pollRef, optionIndex: 100, operation: 'add' },
    { action: 'vote', pollRef, optionIndex: 0.5, operation: 'add' },
    { action: 'vote', pollRef, optionIndex: 0, operation: 'toggle' },
    { action: 'vote', pollRef, optionIndex: 0 },
    { action: 'vote', pollRef, optionIndex: 0, operation: 'add', voterId: 'someone-else' },
  ])('rejects invalid or route-selecting input %j', (args) => {
    expect(parse(args)?.kind).toBe('invalid-poll-arguments')
  })
  it.each([true, false])('preserves the requested anonymity choice %s', (anonymous) => {
    expect(parse({ action: 'create', question: 'Day?', options: ['A', 'B'], anonymous })).toMatchObject({ kind: 'poll', request: { anonymous } })
  })
  it.each(['add', 'remove'] as const)('binds a %s vote to accepted input with no voter or destination selector', async (operation) => {
    port.mockClear()
    const args = { action: 'vote', pollRef, optionIndex: 1, operation }
    const request = parse(args)
    expect(request).toMatchObject({ kind: 'poll', request: args })
    if (!request) throw new Error('Expected vote request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(true)
    expect(port).toHaveBeenCalledExactlyOnceWith({ assistantInputId: inputId, request: args })
    port.mockClear()
    const denied = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), currentInvocationScope: () => null }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(denied.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it('keeps ambiguous voting uncertain without inviting an automatic resubmission', async () => {
    port.mockRejectedValueOnce(new Error('Synthetic lost acknowledgement'))
    const request = parse({ action: 'vote', pollRef, optionIndex: 0, operation: 'add' })
    if (!request) throw new Error('Expected vote request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain('may have applied')
    expect(result.rpcResult.contentItems[0]?.text).toContain('Read the poll to check before voting again')
  })
  it('accepts a returned voter cursor on read only', () => {
    expect(parse({ action: 'read', pollRef, voterCursor: '50' })).toMatchObject({ kind: 'poll', request: { voterCursor: '50' } })
    expect(parse({ action: 'close', pollRef, voterCursor: '50' })?.kind).toBe('invalid-poll-arguments')
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
  it.each([
    ['linq', 'imessage_handle', 'imessage_handle'],
    ['telegram', 'telegram_user', 'telegram_chat'],
  ] as const)('omits per-voter repeats on %s and keeps an unusual voter kind', async (channel, ordinary, unusual) => {
    const voters = [
      { kind: ordinary, id: '1001', displayName: 'Synthetic A', optionIndexes: [0], observedAt: '2026-09-21T11:00:00.000Z' },
      { kind: unusual, id: '1002', optionIndexes: [0, 1], observedAt: '2026-09-21T11:30:00.000Z' },
    ]
    const named = { ...snapshot, channel, anonymous: false, voters, voterSource: 'provider_read' as const, nextVoterCursor: '50' }
    const request = parse({ action: 'read', pollRef })
    if (!request) throw new Error('Expected poll request')
    const result = await executeMurphDynamicToolRequest({ request, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null,
      hostedToolContext: { ...context(), pollTool: { request: async () => ({ status: 'results' as const, polls: [named] }) } } })
    const { voters: _voters, ...pollFields } = named
    expect(JSON.parse(result.rpcResult.contentItems[0]?.text ?? '')).toEqual({ status: 'results', polls: [{
      ...pollFields,
      // The poll keeps its observedAt; each voter's copy and the channel's ordinary kind are dropped.
      voters: [
        { id: '1001', displayName: 'Synthetic A', optionIndexes: [0] },
        unusual === ordinary ? { id: '1002', optionIndexes: [0, 1] } : { kind: unusual, id: '1002', optionIndexes: [0, 1] },
      ],
    }] })
  })
  it('denies detached requests without invocation authority', async () => {
    port.mockClear()
    const request = parse({ action: 'list' })
    if (!request) throw new Error('Expected poll request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), currentInvocationScope: () => null }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it.each(['linq', 'telegram'] as const)('sends host-bound scheduled %s requests and requires a route', async (channel) => {
    port.mockClear()
    const origin = { kind: 'automation_occurrence' as const, automationId: 'automation_poll', occurrenceAt: '2026-11-02T14:00:00.000Z' }
    const route = { channel, target: 'synthetic-chat' }
    const request = parse({ action: 'create', question: 'Day?', options: ['Saturday', 'Sunday'] })!
    const hostedToolContext: AssistantHostedToolContext = { ...context(),
      currentInvocationScope: () => ({ origin, conversationScope: 'group' }),
      currentConversationPollRoute: () => route,
    }
    const execute = () => executeMurphDynamicToolRequest({ request, hostedToolContext, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect((await execute()).rpcResult.success).toBe(true)
    expect(port).toHaveBeenCalledExactlyOnceWith({ origin, route, request: { action: 'create', question: 'Day?', options: ['Saturday', 'Sunday'] } })
    port.mockClear()
    hostedToolContext.currentConversationPollRoute = () => null
    expect((await execute()).rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it.each(['HOSTED_POLL_UNSUPPORTED_SERVICE', 'PROVIDER_FAILURE'])("maps only the pre-dispatch service error: %s", async (code) => {
    port.mockRejectedValueOnce(Object.assign(new Error('Untrusted upstream text'), { code }))
    const request = parse({ action: 'create', question: 'Day?', options: ['Saturday', 'Sunday'] })!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    const text = result.rpcResult.contentItems[0]?.text
    expect(text).toContain(code === 'HOSTED_POLL_UNSUPPORTED_SERVICE' ? 'no poll action was sent' : 'it may have been sent. List polls to check before creating another one')
    expect(text).not.toContain('Untrusted upstream text')
  })
})
