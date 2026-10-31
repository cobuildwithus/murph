import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_READ_GAME_TOOL, MURPH_READ_GAME_RECAP_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL } from '../src/assistant-codex/dynamic-tools/games.js'
import { resolveAssistantGameHostDynamicTools } from '../src/assistant/codex-turn/planning.js'
import { MURPH_FINISH_WITHOUT_REPLY_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.js'
import { createAssistantHostedToolContext, type AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from '@murphai/hosted-execution/parsers'
import type { HostedGameRecap } from '@murphai/hosted-execution/runtime-control'
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
    expect(resolveMurphDynamicTools({ gamesAvailable: true })).not.toContain(MURPH_WRITE_RECAP_TOOL)
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('ordinary conversational agreement')
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('do not demand special words')
    expect(MURPH_READ_GAME_TOOL.description).toContain('call what the loser owes a prize')
    expect(MURPH_READ_GAME_TOOL.description).toContain('Never call it a ticket, bet, wager, stake or winnings')
  })
  it('advertises v1 limits and stakes without suggesting a legacy graph for every game', () => {
    const change = MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties
    expect(change.lengthDays).toMatchObject({ minimum: 3, maximum: 365 })
    expect(change.schedule.properties.count.maximum).toBe(365)
    expect(change.stakes.items.properties.kind.enum).toEqual(['prize', 'dare'])
    expect(MURPH_GAME_PHOTO_TOOL.description).not.toContain('Heart-rate games still require the app graph')
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
  it('round-trips negotiated task and whole-game stake scope without identity selectors', () => {
    const change = { kind: 'edit', tasks: [{seat:0,text:'Read'},{seat:1,text:'Stretch'}], stakes:[{kind:'per_miss',item:'Make tea'}], stakesApplyToWholeGame:true, startsOn:null }
    const request = {action:'update_game',origin,update:{operation:'propose',gameId:approval.gameId,proposalId:approval.proposalId,expectedTermsVersion:1,change}}
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('Stakes and tasks are locked once the game has started')
    expect(MURPH_UPDATE_GAME_TOOL.description).not.toContain('including earlier misses')
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('Negotiating games have no active obligations')
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change})?.kind).toBe('game')
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change:{...change,stakesApplyToWholeGame:false}})?.kind).toBe('invalid-game-arguments')
  })

})

describe('game recap dynamic contract', () => {
  const recap: HostedGameRecap = { pages: [
    { background: 'paper', blocks: [{ kind: 'headline', text: 'A very specific week' }] },
    { background: 'slate', blocks: [{ kind: 'stat', statValue: '5', text: 'days posted' }] },
    { background: 'sage', blocks: [{ kind: 'quote', quote: { who: 'Ava', text: 'verbatim words' } }] },
  ], scoreLine: 'Leo owes Ava breakfast.', chatLine: 'Sauna citizenship survived. Open the week for the paperwork.' }
  it('gives isolated recap and check-in turns only their host-owned tools', () => {
    expect(resolveAssistantGameHostDynamicTools({ currentGameRecapScope: () => ({ gameId: 'game', eventId: 'game-recap:game', pairFingerprint: 'a'.repeat(32) }) }))
      .toEqual([MURPH_READ_GAME_RECAP_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL])
    expect(resolveAssistantGameHostDynamicTools({ currentGameMissedCheckInScope: () => ({ gameId: 'game', eventId: 'game-missed:game:a:2030-01-01', memberId: 'a', firstMissedDate: '2030-01-01', pairFingerprint: 'a'.repeat(32) }) }))
      .toEqual([MURPH_GAME_LORE_TOOL, MURPH_FINISH_WITHOUT_REPLY_TOOL])
    expect(MURPH_READ_GAME_TOOL.description).not.toContain('recap turn')
    expect(MURPH_READ_GAME_TOOL.description).not.toContain('loreGuidance')
    expect(MURPH_READ_GAME_RECAP_TOOL.description).toContain('recap turn')
    expect(MURPH_GAME_LORE_TOOL.description).toContain('when instructed')
    expect(MURPH_GAME_LORE_TOOL.description).toContain('Returns')
    expect(MURPH_GAME_LORE_TOOL.inputSchema).toEqual({
      type: 'object', additionalProperties: false, required: ['operation'],
      properties: { operation: { enum: ['read', 'replace'] }, content: { type: 'string' } },
    })
  })
  it('shows no model game selector and binds reads and writes to the trusted recap scope', async () => {
    expect(MURPH_WRITE_RECAP_TOOL.inputSchema.properties).not.toHaveProperty('gameId')
    const recapPort = vi.fn(async (request) => request.action === 'read_game'
      ? { action: 'read_game' as const, result: { status: 'ok' as const, recapGame: { id: 'game_bound' } } }
      : { action: 'write_recap' as const, result: { status: 'ok' as const, recapOutcome: 'ok: saved. The players will see this recap.', recap, chatLine: `${recap.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_bound` } })
    const savedChatLines: string[] = []
    const recapContext = { ...context(), groupTool: { request: recapPort }, currentUserActionScope: () => null,
      readGameLore: async () => 'Chat line used: An earlier line lived here.',
      replaceGameLore: async () => {},
      recordSavedGameRecapChatLine: (chatLine: string) => savedChatLines.push(chatLine),
      currentGameRecapScope: () => ({ gameId: 'game_bound', eventId: 'game-recap:game_bound', pairFingerprint: '0123456789abcdef0123456789abcdef' }) }
    for (const [tool, args] of [['read_game', {}], ['write_recap', recap]] as const) {
      const request = parse(tool, args)
      if (!request) throw new Error('Expected recap request')
      expect((await executeMurphDynamicToolRequest({ request, hostedToolContext: recapContext, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })).rpcResult.success).toBe(true)
    }
    const requests = recapPort.mock.calls.map(([request]) => request)
    expect(requests).toEqual([
      { action: 'read_game', origin: { kind: 'game_recap', gameId: 'game_bound', eventId: 'game-recap:game_bound' } },
      { action: 'write_recap', origin: { kind: 'game_recap', gameId: 'game_bound', eventId: 'game-recap:game_bound' }, recap, priorChatLines: ['An earlier line lived here.'] },
    ])
    for (const request of requests) expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(savedChatLines).toEqual([`${recap.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_bound`])
  })
  it('prepares lore only in Linq group rooms and never fails the turn', async () => {
    const lore = { action: 'read_game' as const, result: { status: 'ok' as const, state: { games: [] }, loreFingerprint: 'a'.repeat(32), loreGuidance: 'Keep the lore.' } }
    const prepare = (channel: string, request: unknown) => createAssistantHostedToolContext({
      executionContext: { groupTool: { request } } as never, getConversationScope: () => 'group', getUserActionAcceptedInputIds: () => [inputId],
      messageInput: { channel, vault: '/synthetic-vault' } as never, session: { binding: { channel }, sessionId: 'synthetic-lore-session' } as never,
    }).prepareGameLore?.()
    const telegram = vi.fn(async () => lore)
    expect(await prepare('telegram', telegram)).toBeNull()
    expect(telegram).not.toHaveBeenCalled()
    expect(await prepare('linq', vi.fn(async () => { throw new Error('Exact game chat unavailable') }))).toBeNull()
    expect(await prepare('linq', vi.fn(async () => lore))).toBe('Keep the lore.')
  })
  it('rejects write_recap outside a trusted recap notification', async () => {
    port.mockClear()
    const request = parse('write_recap', recap)
    if (!request) throw new Error('Expected recap request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
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


it.each(['mark_incomplete', 'restore_day'])('binds %s to the current speaker without a target or proposal', async (operation) => {
  port.mockClear()
  const args = { messageRef: inputId, operation, gameId: 'game_synthetic', date: '2030-04-01' }
  expect((await execute(args)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation, gameId: 'game_synthetic', date: '2030-04-01' } })
  expect(parse('update_game', { ...args, memberId: 'another-player' })?.kind).toBe('invalid-game-arguments')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('ask once for the date')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('one plain line naming the date or weekday')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('never from progress.checkedAt or processing time')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('Before 3 AM, today is the previous calendar date; yesterday is one further day back')
})

it('cancels a not-yet-started game for the current speaker with no proposal or extra selector', async () => {
  port.mockClear()
  const args = { messageRef: inputId, operation: 'cancel_game', gameId: 'game_synthetic' }
  expect((await execute(args)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation: 'cancel_game', gameId: 'game_synthetic' } })
  expect(parse('update_game', { ...args, proposalId: 'proposal_synthetic' })?.kind).toBe('invalid-game-arguments')
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.operation.enum).toContain('cancel_game')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('A live game cannot be called off: its stakes are locked')
  expect(MURPH_UPDATE_GAME_TOOL.description).toContain('the backend posts the one cancellation notice in this chat: do not announce it yourself')
})

it('teaches one pending change, current-ask-only proposals, plain refusals and open days', () => {
  const description = MURPH_UPDATE_GAME_TOOL.description
  expect(description).toContain('One change waits at a time.')
  expect(description).toContain('say plainly in that reply that it replaces the earlier ask')
  expect(description).toContain('never imply a declined, cancelled or replaced proposal is still waiting')
  expect(description).toContain('never fold in an earlier, deferred or other player’s request')
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.description).toContain('Only the fields the acting message asks to change now')
  expect(description).toContain('error gives a code, then the rule or next step')
  expect(description).toContain('is still open, not missed')
  expect(description).not.toMatch(/unposted/u)
})
