import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_READ_GAME_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL } from '../src/assistant-codex/dynamic-tools/games.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from '@murphai/hosted-execution/parsers'
const inputId = 'ain_' + 'a'.repeat(32)
const secondInput = 'ain_' + 'b'.repeat(32)
const origin = { kind: 'accepted_input' as const, assistantInputId: inputId }
const port = vi.fn(async () => ({ action: 'update_game' as const, result: { status: 'ok' as const, state: { games: [] } } }))
function context(): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false, vaultFileSendAvailable: false, groupTool: { request: port },
    currentUserActionScope: () => ({ conversationId: 'synthetic-game-chat', inboundMailboxItemIds: [], recipientKey: 'synthetic-game-recipient', acceptedInputIds: [inputId, secondInput], originSessionId: 'synthetic-game-session', conversationScope: 'group' }),
    currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [], sendVaultFile: async () => { throw new Error('Unavailable') },
  }
}
function parse(tool: string, args: unknown) {
  return readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: { namespace: 'murph', tool, arguments: args } })
}
const approval = { messageRef: inputId, operation: 'approve', gameId: 'game_synthetic', proposalId: 'proposal_synthetic' }
async function execute(args: unknown, ctx = context()) {
  const request = parse('update_game', args)
  if (!request) throw new Error('Expected request')
  return executeMurphDynamicToolRequest({ request, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
}
describe('game dynamic tools', () => {
  it('advertises only when the group game capability is available', () => {
    expect(resolveMurphDynamicTools({ gamesAvailable: true })).toEqual(expect.arrayContaining([MURPH_READ_GAME_TOOL, MURPH_UPDATE_GAME_TOOL]))
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_UPDATE_GAME_TOOL)
    expect(resolveMurphDynamicTools({ gamesAvailable: true })).not.toContain(MURPH_GAME_PHOTO_TOOL)
    expect(resolveMurphDynamicTools({ gamesAvailable: true, gamePhotosAvailable: true })).toContain(MURPH_GAME_PHOTO_TOOL)
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('ordinary conversational agreement')
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('do not demand special words')
  })
  it('binds the selected accepted message instead of using a model actor or last speaker', async () => {
    port.mockClear()
    expect((await execute(approval)).rpcResult.success).toBe(true)
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation: 'approve', gameId: approval.gameId, proposalId: approval.proposalId } })
  })
  it.each([
    { ...approval, actorMemberId: 'other' }, { ...approval, chatId: 'other' },
    { ...approval, operation: 'apply' }, { ...approval, change: { kind: 'start_now' } },
    { ...approval, operation: 'propose', expectedTermsVersion: 1, change: { kind: 'edit', schedule: { days: [7] } } },
  ])('rejects selectors or invalid operations %j', (args) => {
    expect(parse('update_game', args)?.kind).toBe('invalid-game-arguments')
  })
  it('rejects stale messages and direct contexts without forwarding', async () => {
    port.mockClear()
    expect((await execute({ ...approval, messageRef: 'old-input' })).rpcResult.success).toBe(false)
    expect((await execute(approval, { ...context(), currentUserActionScope: () => ({ conversationScope: 'direct', conversationId: 'synthetic-game-chat', inboundMailboxItemIds: [], recipientKey: 'synthetic-game-recipient', acceptedInputIds: [inputId], originSessionId: 'synthetic-game-session' }) })).rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it('round-trips the signed transport and rejects extra private fields', () => {
    const request = { action: 'update_game', origin, update: { operation: 'approve', gameId: approval.gameId, proposalId: approval.proposalId } }
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(() => parseHostedRuntimeGroupToolRequest({ ...request, actorMemberId: 'other' })).toThrow()
    expect(parseHostedRuntimeGroupToolResponse({ action: 'read_game', result: { status: 'ok', state: { games: [] } } })).toMatchObject({ action: 'read_game' })
    expect(() => parseHostedRuntimeGroupToolResponse({ action: 'read_game', result: { status: 'ok', state: { games: [], photos: [] } } })).toThrow()
  })
  it('makes uncertainty truthful and does not retry a mutation', async () => {
    port.mockClear(); port.mockRejectedValueOnce(new Error('Synthetic interrupted response'))
    const result = await execute(approval)
    expect(result.rpcResult.success).toBe(false)
    expect(port).toHaveBeenCalledTimes(1)
    expect(result.rpcResult.contentItems[0]?.text).toContain('Read the game')
  })
})

describe('game photo dynamic contract', () => {
  it('accepts current approval with a prior same-conversation photo selector but no arbitrary identity or URL', async () => {
    port.mockClear()
    const args = { messageRef: inputId, operation: 'save', gameId: 'game_synthetic', sourceMessageRef: 'ain_' + 'c'.repeat(32), attachmentOrdinal: 1 }
    const request = parse('game_photo', args)
    expect(request?.kind).toBe('game')
    if (!request) throw new Error('Expected photo request')
    await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'game_photo', origin, photo: { operation: 'save', gameId: 'game_synthetic', sourceMessageRef: args.sourceMessageRef, attachmentOrdinal: 1 } })
    for (const extra of [{ url: 'https://example.test/a.jpg' }, { memberId: 'other' }, { captureAgeMs: 10 }, { mediaKeys: ['arbitrary'] }]) expect(parse('game_photo', { ...args, ...extra })?.kind).toBe('invalid-game-arguments')
  })
  it('reads introduction state for the selected sender in a compound group turn', async () => {
    port.mockClear()
    const request = parse('read_game', { messageRef: inputId })
    if (!request) throw new Error('Expected game read')
    await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'read_game', origin })
  })
  it('rejects a stale consent message without forwarding', async () => {
    port.mockClear()
    const request = parse('game_photo', { messageRef: 'old', operation: 'save', gameId: 'game_synthetic' })
    if (!request) throw new Error('Expected photo request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it('round-trips photo outcomes through the shared transport', () => {
    const request = { action: 'game_photo', origin, photo: { operation: 'offer', gameId: 'game_synthetic', sourceMessageRef: inputId, attachmentOrdinal: 1 } }
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(parseHostedRuntimeGroupToolResponse({ action: 'game_photo', result: { status: 'ok', photoOutcome: 'suppressed' } })).toEqual({ action: 'game_photo', result: { status: 'ok', photoOutcome: 'suppressed' } })
  })
})
