import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeAssistantExecutionContext } from '../src/assistant/execution-context.js'
import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { GAME_GROUP_CHAT_GUIDANCE, GAME_SETUP_CHAT_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_PAIR_CHAT_GUIDANCE, GAME_GROUP_MODE_GUIDANCE, GAME_REMINDER_GUIDANCE, GAME_READ_FACTS_GUIDANCE, GAME_PLAY_AGAIN_GUIDANCE, GAME_PAIR_AGREE_GUIDANCE, GAME_GROUP_JOIN_GUIDANCE, GAME_DAY_CORRECTION_GUIDANCE, GAME_UPDATE_RESULT_GUIDANCE, GAME_DAY_OUTCOME_GUIDANCE, GAME_REMINDER_OUTCOME_GUIDANCE, GAME_PHOTO_OUTCOME_GUIDANCE, GAME_REFUSAL_GUIDANCE, MURPH_READ_GAME_TOOL, MURPH_READ_GAME_RECAP_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL, GAME_SELECTION_GUIDANCE } from '../src/assistant-codex/dynamic-tools/games.js'
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
  it('offers a member-only reminder tool on direct accepted input and rejects group scope', async () => {
    const requestPort = vi.fn(async () => ({ action: 'my_game_reminders' as const, result: { status: 'ok' as const, reaches: 'none' as const } }))
    const direct = { ...context(), myGameRemindersTool: { request: requestPort }, currentUserActionScope: () => ({
      conversationId: 'synthetic-direct', inboundMailboxItemIds: [], recipientKey: 'synthetic-member',
      acceptedInputIds: [inputId], originSessionId: 'synthetic-session', conversationScope: 'direct' as const,
    }) }
    const request = parse('my_game_reminders', { operation: 'set', minutes: 1080 })!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: direct, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.contentItems[0]?.text).toContain('"reaches":"none"')
    expect(requestPort).toHaveBeenCalledExactlyOnceWith({ action: 'my_game_reminders', operation: 'set', minutes: 1080, origin })
    const group = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), myGameRemindersTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(group.rpcResult.contentItems[0]?.text).toContain('current direct message')
    expect(requestPort).toHaveBeenCalledOnce()
  })
  it.each([
    { label: 'no game', games: [], carries: ['poll'] },
    { label: 'finished pair game', games: [{ status: 'settled', terms: { stakes: [{ kind: 'both_get', item: 'Dinner out together' }] } }], carries: ['poll', 'again'] },
    { label: 'waiting pair game', games: [{ status: 'negotiating' }], carries: ['poll', 'pairAgree', 'pair', 'reminder'] },
    { label: 'live pair game', games: [{ status: 'live' }], carries: ['pair', 'day', 'reminder'] },
    { label: 'invited group game', games: [{ status: 'invited', maxPlayers: 10 }], carries: ['poll', 'groupJoin', 'group', 'reminder'] },
    { label: 'live group game people can still join', games: [{ status: 'live', maxPlayers: 10, pendingInviteeCount: 2 }], carries: ['groupJoin', 'group', 'day', 'reminder'] },
    { label: 'live group game with everyone in', games: [{ status: 'live', maxPlayers: 10, pendingInviteeCount: 0 }], carries: ['group', 'day', 'reminder'] },
    { label: 'live pair and invited group', games: [{ status: 'live' }, { status: 'invited', maxPlayers: 10 }], carries: ['poll', 'pair', 'groupJoin', 'group', 'day', 'reminder'] },
    { label: 'settled both-win pair beside a live group', games: [{ status: 'settled', terms: { stakes: [{ kind: 'both_get', item: 'Dinner out together' }] } }, { status: 'live', maxPlayers: 10 }], carries: ['again', 'group', 'day', 'reminder'] },
    { label: 'live pair and settled group', games: [{ status: 'live' }, { status: 'settled', maxPlayers: 10 }], carries: ['again', 'pair', 'day', 'reminder'] },
  ])('carries each rule block once, and only for what the room holds: $label', async ({ games, carries }) => {
    const requestPort = vi.fn().mockResolvedValue({ action: 'read_game', result: { status: 'ok', state: { games } } })
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: { ...context(), groupTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text ?? ''
    for (const guidance of [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE]) expect(text.split(guidance)).toHaveLength(2)
    const blocks = { poll: GAME_SHARED_CHOICE_POLL_GUIDANCE, again: GAME_PLAY_AGAIN_GUIDANCE, pairAgree: GAME_PAIR_AGREE_GUIDANCE, pair: GAME_PAIR_CHAT_GUIDANCE,
      groupJoin: GAME_GROUP_JOIN_GUIDANCE, group: GAME_GROUP_MODE_GUIDANCE, day: GAME_DAY_CORRECTION_GUIDANCE, reminder: GAME_REMINDER_GUIDANCE }
    for (const [name, guidance] of Object.entries(blocks)) expect(text.split(guidance), name).toHaveLength(carries.includes(name) ? 2 : 1)
  })

  it.each([
    { label: 'an accepted invitation', args: { operation: 'approve', gameId: 'game_synthetic', expectedTermsVersion: 1 }, result: { status: 'ok', state: { games: [{ id: 'game_synthetic', status: 'live', pendingChange: null }] } }, says: GAME_UPDATE_RESULT_GUIDANCE.joined },
    { label: 'a yes that applies an ask', args: approval, result: { status: 'ok', state: { games: [{ id: 'game_synthetic', status: 'live', pendingChange: null }] } }, says: GAME_UPDATE_RESULT_GUIDANCE.applied },
    { label: 'a yes that still needs more', args: approval, result: { status: 'ok', state: { games: [{ id: 'game_synthetic', status: 'live', pendingChange: { id: 'proposal_synthetic' } }] } }, says: GAME_UPDATE_RESULT_GUIDANCE.counted },
    { label: 'the yes that ends a game', args: approval, result: { status: 'ok', state: { games: [{ id: 'game_synthetic', status: 'void', pendingChange: null }] } }, says: GAME_UPDATE_RESULT_GUIDANCE.ended },
    { label: 'a no', args: { ...approval, operation: 'decline' }, result: { status: 'ok', state: { games: [{ id: 'game_synthetic', status: 'live', pendingChange: null }] } }, says: GAME_UPDATE_RESULT_GUIDANCE.declined },
    { label: 'a cancelled game', args: { operation: 'cancel_game', gameId: 'game_synthetic' }, result: { status: 'ok', state: { games: [] } }, says: GAME_UPDATE_RESULT_GUIDANCE.ended },
    { label: 'a day marked not done', args: { operation: 'mark_incomplete', gameId: 'game_synthetic', date: '2030-03-04' }, result: { status: 'ok', dayOutcome: { date: '2030-03-04', status: 'marked_incomplete' } }, says: GAME_DAY_OUTCOME_GUIDANCE.marked_incomplete },
    { label: 'a reminder that cannot arrive', args: { operation: 'set_reminder', minutes: 1080 }, result: { status: 'ok', reaches: 'none' }, says: GAME_REMINDER_OUTCOME_GUIDANCE.none },
    { label: 'a missing first name', args: approval, result: { status: 'rejected', error: 'PROFILE_REQUIRED: player_sam needs a first name and time zone in the Murph app.' }, says: GAME_REFUSAL_GUIDANCE.PROFILE_REQUIRED },
    { label: 'a yes with no returned state', args: approval, result: { status: 'ok' }, says: '' },
    { label: 'an unexplained refusal', args: approval, result: { status: 'rejected', error: 'TERMS_CHANGED: The terms changed.' }, says: '' },
  ])('ends an update result with what to say about $label', async ({ args, result, says }) => {
    const response = { action: 'update_game', result }
    const output = await execute({ messageRef: inputId, ...args }, { ...context(), groupTool: { request: vi.fn().mockResolvedValue(response) } })
    expect(output.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + (says ? '\n' + says : ''))
  })
  it.each([
    { label: 'an offer', result: { status: 'ok', photoOutcome: 'offer' }, says: GAME_PHOTO_OUTCOME_GUIDANCE.offer },
    { label: 'a suppressed offer', result: { status: 'ok', photoOutcome: 'suppressed' }, says: GAME_PHOTO_OUTCOME_GUIDANCE.suppressed },
    { label: 'a day off', result: { status: 'rejected', error: 'DAY_CLOSED: Today is a day off. Next game day is Monday.' }, says: GAME_REFUSAL_GUIDANCE.DAY_CLOSED },
  ])('ends a photo result with what to say about $label', async ({ result, says }) => {
    const response = { action: 'game_photo', result }
    const request = parse('game_photo', { messageRef: inputId, operation: 'offer', gameId: 'game_synthetic', sourceMessageRef: inputId, attachmentOrdinal: 1 })!
    const output = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), groupTool: { request: vi.fn().mockResolvedValue(response) } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(output.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + '\n' + says)
  })

  it('uses group-only guidance for two-person group games and accepts starter edit_terms', async () => {
    const response = { action: 'read_game', result: { status: 'ok', state: { games: [
      { id: 'game_group_one', maxPlayers: 10, status: 'invited' }, { id: 'game_group_two', maxPlayers: 10, status: 'invited' },
    ] } } }
    const requestPort = vi.fn().mockResolvedValue(response)
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', { messageRef: inputId })!, hostedToolContext: { ...context(), groupTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text
    expect(text).toContain(GAME_GROUP_CHAT_GUIDANCE)
    expect(text).toContain(GAME_SELECTION_GUIDANCE)
    expect(text).not.toContain(GAME_PAIR_CHAT_GUIDANCE)
    const tasks = Array.from({ length: 10 }, (_, index) => ({ memberId: `player_${index}`, text: 'Walk' }))
    expect(parse('update_game', { messageRef: inputId, operation: 'edit_terms', gameId: 'game_group_one', expectedTermsVersion: 1,
      terms: { defaultTask: 'Walk', tasks, schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] } })).toMatchObject({ kind: 'game' })
  })

  it('reads a scheduled group occurrence without a message selector or write guidance', async () => {
    const scheduledOrigin = { kind: 'automation_occurrence' as const, automationId: 'automation_game_read', occurrenceAt: '2030-04-01T20:00:00Z' }
    const response = { action: 'read_game' as const, result: { status: 'ok' as const, state: { games: [{ status: 'live' }, { status: 'live' }] } } }
    const requestPort = vi.fn().mockResolvedValue(response)
    const ctx: AssistantHostedToolContext = { ...context(), groupTool: { request: requestPort }, currentUserActionScope: () => null,
      currentInvocationScope: () => ({ conversationScope: 'group', origin: scheduledOrigin }) }
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', { messageRef: 'ignored-stale-ref' })!, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(true)
    expect(requestPort).toHaveBeenCalledExactlyOnceWith({ action: 'read_game', origin: scheduledOrigin, includePlayers: true })
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + '\n' + GAME_READ_FACTS_GUIDANCE)
    expect((await execute(approval, ctx)).rpcResult.success).toBe(false)
    const photo = await executeMurphDynamicToolRequest({ request: parse('game_photo', { messageRef: inputId, operation: 'save', gameId: 'game_synthetic' })!, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(photo.rpcResult.success).toBe(false)
    expect(requestPort).toHaveBeenCalledTimes(1)
  })
  it.each(['direct', 'missing', 'accepted_input'] as const)('rejects a read without group occurrence authority: %s', async (kind) => {
    port.mockClear()
    const ctx: AssistantHostedToolContext = { ...context(), currentUserActionScope: () => null,
      currentInvocationScope: () => kind === 'missing' ? null : kind === 'accepted_input'
        ? { conversationScope: 'group', origin: { kind: 'accepted_input', assistantInputId: inputId, sessionId: 'session_synthetic' } }
        : { conversationScope: 'direct', origin: { kind: 'automation_occurrence', automationId: 'automation_game_read', occurrenceAt: '2030-04-01T20:00:00Z' } } }
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
  it('advertises only when the group game capability is available', () => {
    expect(resolveMurphDynamicTools({ gameReadAvailable: true , gamesAvailable: true })).toEqual(expect.arrayContaining([MURPH_READ_GAME_TOOL, MURPH_UPDATE_GAME_TOOL]))
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_UPDATE_GAME_TOOL)
    expect(resolveMurphDynamicTools({ gameReadAvailable: true , gamesAvailable: true })).not.toContain(MURPH_GAME_PHOTO_TOOL)
    expect(resolveMurphDynamicTools({ gameReadAvailable: true, gamesAvailable: true, gamePhotosAvailable: true })).toContain(MURPH_GAME_PHOTO_TOOL)
    expect(resolveMurphDynamicTools({ gameReadAvailable: true , gamesAvailable: true })).not.toContain(MURPH_WRITE_RECAP_TOOL)
  })
  it('advertises v1 limits and stakes without suggesting a legacy graph for every game', () => {
    const change = MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties
    expect(change.lengthDays).toMatchObject({ minimum: 3, maximum: 365 })
    expect(change.schedule.properties.count.maximum).toBe(365)
    expect(change.stakes.items.properties.kind.enum).toEqual(['prize', 'dare', 'both_get'])
  })
  it('round-trips create and initial agreement without accepting an actor selector', async () => {
    const terms = { tasks: [{ memberId: 'player_sam', text: 'Read' }, { memberId: 'player_ava', text: 'Walk' }], schedule: { count: 3 }, stakes: [{ kind: 'dare', item: 'Sing' }], lengthDays: 7 }
    for (const update of [{ operation: 'create', gameId: 'game_setup', terms }, { operation: 'approve', gameId: 'game_setup', expectedTermsVersion: 1 }]) {
      port.mockClear()
      expect((await execute({ messageRef: inputId, ...update })).rpcResult.success).toBe(true)
      expect(port).toHaveBeenCalledExactlyOnceWith(parseHostedRuntimeGroupToolRequest({ action: 'update_game', origin, update }))
      expect(parse('update_game', { messageRef: inputId, ...update, actorMemberId: 'player_sam' })?.kind).toBe('invalid-tool-arguments')
    }
    expect(parse('update_game', { messageRef: inputId, operation: 'create', gameId: 'game_setup', terms: { ...terms, stakes: [{ kind: 'per_miss', item: 'Lunch' }] } })?.kind).toBe('invalid-tool-arguments')
    expect(MURPH_UPDATE_GAME_TOOL.description).not.toContain(GAME_SETUP_CHAT_GUIDANCE)
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
    expect(parse('update_game', args)?.kind).toBe('invalid-tool-arguments')
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
  it('refuses a missing game selector without forwarding a mutation', async () => {
    port.mockClear()
    const ambiguous = { messageRef: inputId, operation: approval.operation, proposalId: approval.proposalId }
    const result = await execute(ambiguous)
    expect(result.rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
    expect(JSON.stringify(result.rpcResult)).toMatch(/gameId|which task/)
  })
  it.each([
    { statuses: ['live'] as const, guided: false },
    { statuses: ['live', 'settled'] as const, guided: false },
    { statuses: ['live', 'live'] as const, guided: true },
    { statuses: ['live', 'negotiating'] as const, guided: true },
  ])('adds selection guidance only when several games are active: $statuses', async ({ statuses, guided }) => {
    const games = statuses.map((status, index) => ({
      id: `game_synthetic_${index}`, status, lengthDays: 7, startsOn: null,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: index ? 'Read' : 'Walk' }], schedule: { days: [0, 1] }, stakes: [] },
      players: [], pendingChange: null, changeControls: { canStartNow: false, canEdit: true, canEditSchedule: true, canEditStartDate: false, editableFromDay: 1 },
    }))
    const response = { action: 'read_game' as const, result: { status: 'ok' as const, state: { games } } }
    const request = parse('read_game', {})!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), groupTool: { request: async () => response } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text
    expect(text).toContain(GAME_SHARED_SETUP_GUIDANCE)
    if (!guided) expect(text).toBe(JSON.stringify(response) + '\n' + [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, ...(statuses.some(status => status === 'settled') ? [GAME_PLAY_AGAIN_GUIDANCE] : []), GAME_PAIR_CHAT_GUIDANCE, GAME_DAY_CORRECTION_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n'))
    else {
      expect(text).toContain(GAME_SELECTION_GUIDANCE)
      expect(text).toContain('game_synthetic_0')
      expect(text).toContain('game_synthetic_1')
      expect(text).toContain('Read')
      expect(text).toContain('Walk')
    }
  })
  it.each(['ok', 'unavailable', 'rejected'] as const)('returns setup guidance on every successful ordinary read, status=%s', async status => {
    const response = { action: 'read_game' as const, result: status === 'ok'
      ? { status, state: { games: [] } } : { status, error: 'Use a chat with just the two players and Murph.' } }
    const ctx = { ...context(), groupTool: { request: async () => response } }
    for (let i = 0; i < 2; i++) {
      const result = await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
      expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + (status === 'ok' ? '\n' + GAME_SETUP_CHAT_GUIDANCE : ''))
    }
    const update = await execute(approval)
    expect(update.rpcResult.contentItems[0]?.text).not.toContain(GAME_SETUP_CHAT_GUIDANCE)
  })
  it('makes uncertainty truthful and does not retry a mutation', async () => {
    port.mockClear(); port.mockRejectedValueOnce(new Error('Synthetic interrupted response'))
    const result = await execute(approval)
    expect(result.rpcResult.success).toBe(false)
    expect(port).toHaveBeenCalledTimes(1)
    expect(result.rpcResult.contentItems[0]?.text).toContain('Read the game')
  })
  it('names a missing expectedTermsVersion instead of blaming the gameId', async () => {
    const args = { messageRef: inputId, operation: 'propose', gameId: 'game_synthetic', proposalId: 'proposal_synthetic', change: { kind: 'edit', stakes: [{ kind: 'prize', item: 'Breakfast in bed' }] } }
    expect(parse('update_game', args)?.kind).toBe('invalid-tool-arguments')
    const result = await execute(args)
    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain('(check: expectedTermsVersion)')
    expect(result.rpcResult.contentItems[0]?.text).not.toContain('Breakfast')
  })
  it('round-trips negotiated task and whole-game stake scope without identity selectors', () => {
    const change = { kind: 'edit', tasks: [{seat:0,text:'Read'},{seat:1,text:'Stretch'}], stakes:[{kind:'per_miss',item:'Make tea'}], stakesApplyToWholeGame:true, startsOn:null }
    const request = {action:'update_game',origin,update:{operation:'propose',gameId:approval.gameId,proposalId:approval.proposalId,expectedTermsVersion:1,change}}
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change})?.kind).toBe('game')
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change:{...change,stakesApplyToWholeGame:false}})?.kind).toBe('invalid-tool-arguments')
  })
})

describe('game recap dynamic contract', () => {
  it('keeps the production pair missed-day policy, which also carries kind, on the pair path', () => {
    // The runtime hands the whole parsed response policy to the engine; a kind field alone must not select the group schema.
    const pair = { kind: 'game_missed_check_in' as const, gameId: 'pair-game', eventId: 'game-missed:pair-game:member-a:2030-03-04',
      memberId: 'member-a', firstMissedDate: '2030-03-04', pairFingerprint: 'f'.repeat(32) }
    const hosted = normalizeAssistantExecutionContext({ hosted: { memberId: 'pair-room', userEnvKeys: [], gameMissedCheckInScope: pair as never } }).hosted
    const { kind: _kind, ...fields } = pair
    expect(hosted?.gameMissedCheckInScope).toEqual(fields)
    const ctx = createAssistantHostedToolContext({ executionContext: hosted,
      messageInput: { channel: 'linq', vault: '/synthetic' } as never, session: { binding: { channel: 'linq' }, sessionId: 'synthetic-pair-missed' } as never })
    expect(resolveAssistantGameHostDynamicTools(ctx)).toEqual([MURPH_GAME_LORE_TOOL, MURPH_FINISH_WITHOUT_REPLY_TOOL])
  })
  it('normalizes the room batch and permits only its scoped lore and quiet tools', async () => {
    const scope = { kind: 'game_group_missed_check_in' as const, roomId: 'synthetic-room', eventId: 'game-missed:synthetic-room:group:2030-03-04',
      firstMissedDate: '2030-03-04', pairFingerprint: 'e'.repeat(32), conversationLaneSeq: '7',
      batch: [{ gameId: 'group', termsVersion: 1, remainingMemberIds: ['one', 'two'], misses: [{ memberId: 'one', missedDates: ['2030-03-04'] }] }] }
    const hosted = normalizeAssistantExecutionContext({ hosted: { memberId: scope.roomId, userEnvKeys: [], gameMissedCheckInScope: scope } }).hosted
    expect(hosted?.gameMissedCheckInScope).toEqual(scope)
    expect(() => normalizeAssistantExecutionContext({ hosted: { memberId: scope.roomId, userEnvKeys: [], gameMissedCheckInScope: { ...scope, eventId: 'wrong' } } })).toThrow()
    const vault = await mkdtemp(path.join(tmpdir(), 'group-missed-lore-'))
    try {
      const ctx = createAssistantHostedToolContext({ executionContext: hosted,
        messageInput: { channel: 'linq', vault } as never, session: { binding: { channel: 'linq' }, sessionId: 'synthetic-missed-session' } as never })
      expect(resolveAssistantGameHostDynamicTools(ctx)).toEqual([MURPH_GAME_LORE_TOOL, MURPH_FINISH_WITHOUT_REPLY_TOOL])
      await ctx.replaceGameLore?.('one (Alex): used bit about the missing chapter.')
      expect(await ctx.readGameLore?.()).toBe('one (Alex): used bit about the missing chapter.')
      await expect(ctx.replaceGameLore?.('a'.repeat(64 * 1024 + 1))).rejects.toThrow('too large')
      expect(await readFile(path.join(vault, 'games', `lore-${scope.pairFingerprint}.md`), 'utf8')).toContain('one (Alex)')
    } finally { await rm(vault, { recursive: true, force: true }) }
  });
  const recap: HostedGameRecap = { pages: [
    { background: 'paper', blocks: [{ kind: 'headline', text: 'A very specific week' }] },
    { background: 'slate', blocks: [{ kind: 'stat', statValue: '5', text: 'days posted' }] },
    { background: 'sage', blocks: [{ kind: 'quote', quote: { who: 'Ava', text: 'verbatim words' } }] },
  ], scoreLine: 'Leo owes Ava breakfast.', chatLine: 'Sauna citizenship survived. Open the week for the paperwork.' }
  it.each([false, true])('parses optional and legacy scoreLine unchanged; legacy=%s', (legacy) => {
    const candidate = legacy ? recap : { pages: recap.pages, chatLine: recap.chatLine }
    expect(MURPH_WRITE_RECAP_TOOL.inputSchema.required).toEqual(['pages', 'chatLine'])
    const parsed = parse('write_recap', candidate)
    expect(parsed).toMatchObject({ kind: 'game', request: { action: 'write_recap', recap: candidate } })
    if (parsed?.kind !== 'game' || parsed.request.action !== 'write_recap') throw new Error('Expected recap request')
    expect(parsed.request.recap).toEqual(candidate)
  })
  it('gives isolated recap and check-in turns only their host-owned tools', () => {
    expect(resolveAssistantGameHostDynamicTools({ currentGameRecapScope: () => ({ gameId: 'game', eventId: 'game-recap:game', pairFingerprint: 'a'.repeat(32) }) }))
      .toEqual([MURPH_READ_GAME_RECAP_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL])
    expect(resolveAssistantGameHostDynamicTools({ currentGameMissedCheckInScope: () => ({ gameId: 'game', eventId: 'game-missed:game:a:2030-01-01', memberId: 'a', firstMissedDate: '2030-01-01', pairFingerprint: 'a'.repeat(32) }) }))
      .toEqual([MURPH_GAME_LORE_TOOL, MURPH_FINISH_WITHOUT_REPLY_TOOL])
    expect(MURPH_READ_GAME_TOOL.description).not.toContain('loreGuidance')
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
      const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: recapContext, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
      expect(result.rpcResult.success).toBe(true)
      expect(result.rpcResult.contentItems[0]?.text).not.toContain(GAME_SETUP_CHAT_GUIDANCE)
    }
    const requests = recapPort.mock.calls.map(([request]) => request)
    expect(requests).toEqual([
      { action: 'read_game', origin: { kind: 'game_recap', gameId: 'game_bound', eventId: 'game-recap:game_bound' } },
      { action: 'write_recap', origin: { kind: 'game_recap', gameId: 'game_bound', eventId: 'game-recap:game_bound' }, recap, priorChatLines: ['An earlier line lived here.'] },
    ])
    for (const request of requests) expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(savedChatLines).toEqual([`${recap.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_bound`])
  })
  it('records accepted delivery even when trusted lore append fails', async () => {
    const delivery = 'The game ended.\nWatch the recap: https://www.withmurph.ai/recap/game_bound'
    const saved = vi.fn()
    const append = vi.fn().mockRejectedValue(new Error('Synthetic file failure'))
    const parsed = parse('write_recap', recap)
    if (!parsed) throw new Error('Expected recap request')
    const result = await executeMurphDynamicToolRequest({ request: parsed, hostedToolContext: { ...context(),
      groupTool: { request: async () => ({ action: 'write_recap', result: { status: 'ok', recap, chatLine: delivery, recapOutcome: 'ok' } }) },
      currentGameRecapScope: () => ({ gameId: 'game_bound', eventId: 'game-recap:game_bound', pairFingerprint: 'a'.repeat(32), loreAccess: 'read' }),
      readGameLore: async () => '', recordSavedGameRecapChatLine: saved, appendGameRecapChatLine: append,
    }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(true)
    expect(saved).toHaveBeenCalledExactlyOnceWith(delivery)
    expect(append).toHaveBeenCalledExactlyOnceWith(recap.chatLine)
    expect(saved.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]!)
  })
  it.each([undefined, 'read' as const])('preserves recap lore authority and records only the canonical bare line; access=%s', async loreAccess => {
    const vault = await mkdtemp(path.join(tmpdir(), 'game-lore-'))
    try {
      const fingerprint = 'b'.repeat(32)
      const target = path.join(vault, 'games', `lore-${fingerprint}.md`)
      const delivery = `${recap.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_bound`
      const request = vi.fn<NonNullable<AssistantHostedToolContext['groupTool']>['request']>()
      request.mockResolvedValue({ action: 'write_recap', result: { status: 'ok', recapOutcome: 'ok', recap, chatLine: delivery } })
      const savedChatLines: string[] = []
      const executionContext = normalizeAssistantExecutionContext({ hosted: { memberId: 'synthetic-room', userEnvKeys: [], groupTool: { request },
        gameRecapScope: { gameId: 'game_bound', eventId: 'game-recap:game_bound', pairFingerprint: fingerprint, ...(loreAccess ? { loreAccess } : {}) } } }).hosted
      const ctx = createAssistantHostedToolContext({ executionContext,
        messageInput: { channel: 'linq', vault } as never, session: { binding: { channel: 'linq' }, sessionId: 'synthetic-lore-session' } as never,
        recordSavedGameRecapChatLine: line => savedChatLines.push(line),
      })
      const call = async (tool: string, args: unknown) => {
        const parsed = parse(tool, args)
        if (!parsed) throw new Error('Expected game request')
        return executeMurphDynamicToolRequest({ request: parsed, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
      }
      expect(ctx.currentGameRecapScope?.()).toEqual(executionContext?.gameRecapScope)
      expect((await call('game_lore', { operation: 'read' })).rpcResult.success).toBe(true)
      expect(await ctx.readGameLore?.()).toBe('')
      if (loreAccess) {
        await expect(ctx.replaceGameLore?.('Private recap caption')).rejects.toThrow('read-only')
        const denied = await call('game_lore', { operation: 'replace', content: 'Private recap caption' })
        expect(denied.rpcResult.success).toBe(false)
        expect(denied.rpcResult.contentItems[0]?.text).toContain('read-only')
      } else {
        expect((await call('game_lore', { operation: 'replace', content: 'Existing pair lore.' })).rpcResult.success).toBe(true)
      }
      request.mockResolvedValueOnce({ action: 'write_recap', result: { status: 'rejected', recapOutcome: 'Try again.' } })
      await call('write_recap', recap)
      expect(await ctx.readGameLore?.()).toBe(loreAccess ? '' : 'Existing pair lore.')
      expect(savedChatLines).toEqual([])
      for (const chatLine of ['A submitted candidate.', 'A different replay candidate.']) {
        expect((await call('write_recap', { ...recap, chatLine })).rpcResult.success).toBe(true)
      }
      expect(savedChatLines).toEqual([delivery, delivery])
      const stored = await readFile(target, 'utf8')
      if (loreAccess) {
        expect(stored.split('Chat line used:').length - 1).toBe(1)
        expect(stored).toContain(`Chat line used: ${recap.chatLine}`)
        expect(stored).not.toMatch(/candidate|https:|Private recap caption/u)
        expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ priorChatLines: [recap.chatLine] })
      } else expect(stored).toBe('Existing pair lore.')
    } finally { await rm(vault, { recursive: true, force: true }) }
  })
  it('trims oldest whole lines to keep the trusted lore append within 64 KiB of UTF-8', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'game-lore-bound-'))
    try {
      const target = path.join(vault, 'games', `lore-${'c'.repeat(32)}.md`)
      await mkdir(path.dirname(target))
      const recent = 'Recent room callback.\n'
      const oldest = 'é'.repeat(Math.floor((64 * 1024 - Buffer.byteLength(recent) - 1) / 2)) + '\n'
      await writeFile(target, oldest + recent)
      const ctx = createAssistantHostedToolContext({ executionContext: { memberId: 'synthetic-room', userEnvKeys: [], gameRecapScope: { gameId: 'game_bound', eventId: 'game-recap:game_bound', pairFingerprint: 'c'.repeat(32), loreAccess: 'read' } },
        messageInput: { channel: 'linq', vault } as never, session: { binding: { channel: 'linq' }, sessionId: 'synthetic-lore-session' } as never,
      })
      await ctx.appendGameRecapChatLine?.(recap.chatLine)
      const stored = await readFile(target, 'utf8')
      expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(64 * 1024)
      expect(stored.startsWith(recent)).toBe(true)
      expect(stored).not.toContain('é')
      expect(stored).toContain(`Chat line used: ${recap.chatLine}`)
    } finally { await rm(vault, { recursive: true, force: true }) }
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
    for (const extra of [{ url: 'https://example.test/a.jpg' }, { memberId: 'other' }, { captureAgeMs: 10 }, { mediaKeys: ['arbitrary'] }]) expect(parse('game_photo', { ...args, ...extra })?.kind).toBe('invalid-tool-arguments')
  })
  it('reads introduction state for the selected sender in a compound group turn', async () => {
    port.mockClear()
    const request = parse('read_game', { messageRef: inputId })
    if (!request) throw new Error('Expected game read')
    await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'read_game', origin, includePlayers: true })
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

it.each(['mark_incomplete', 'mark_complete', 'restore_day'])('binds %s to the current speaker without a target or proposal', async (operation) => {
  port.mockClear()
  const args = { messageRef: inputId, operation, gameId: 'game_synthetic', date: '2030-04-01' }
  expect((await execute(args)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation, gameId: 'game_synthetic', date: '2030-04-01' } })
  expect(parse('update_game', { ...args, memberId: 'another-player' })?.kind).toBe('invalid-tool-arguments')
})

it('offers Murph one way to count a day as done, on the player’s word', () => {
  // restore_day still parses for a turn already in flight, but Murph is only offered mark_complete.
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.operation.enum).toContain('mark_complete')
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.operation.enum).not.toContain('restore_day')
  expect(MURPH_UPDATE_GAME_TOOL.description).not.toContain('restore_day')
})

it('passes the speaker’s own words for a counted day only on mark_complete', async () => {
  port.mockClear()
  const args = { messageRef: inputId, operation: 'mark_complete', gameId: 'game_synthetic', date: '2030-04-01', text: 'Read a chapter' }
  expect((await execute(args)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation: 'mark_complete', gameId: 'game_synthetic', date: '2030-04-01', text: 'Read a chapter' } })
  expect(parse('update_game', { ...args, operation: 'mark_incomplete' })?.kind).toBe('invalid-tool-arguments')
  expect(parse('update_game', { ...args, text: 'x'.repeat(141) })?.kind).toBe('invalid-tool-arguments')
})

it('cancels a not-yet-started game for the current speaker with no proposal or extra selector', async () => {
  port.mockClear()
  const args = { messageRef: inputId, operation: 'cancel_game', gameId: 'game_synthetic' }
  expect((await execute(args)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation: 'cancel_game', gameId: 'game_synthetic' } })
  expect(parse('update_game', { ...args, proposalId: 'proposal_synthetic' })?.kind).toBe('invalid-tool-arguments')
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.operation.enum).toContain('cancel_game')
})

it('calls off a live game only as an ask every remaining player agrees to, then stays quiet', async () => {
  const callOff = { messageRef: inputId, operation: 'propose', gameId: 'game_synthetic', proposalId: 'proposal_synthetic', expectedTermsVersion: 3, change: { kind: 'call_off' } }
  port.mockClear()
  expect((await execute(callOff)).rpcResult.success).toBe(true)
  expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update: { operation: 'propose', gameId: 'game_synthetic', proposalId: 'proposal_synthetic', expectedTermsVersion: 3, change: { kind: 'call_off' } } })
  expect(parse('update_game', { ...callOff, change: { kind: 'call_off', lengthDays: 5 } })?.kind).toBe('invalid-tool-arguments')
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties.kind.enum).toEqual(['start_now', 'edit', 'call_off'])
})

it('teaches one pending change, current-ask-only proposals, plain refusals and open days', () => {
  const description = GAME_PAIR_CHAT_GUIDANCE + MURPH_UPDATE_GAME_TOOL.description
  expect(description).not.toMatch(/unposted/u)
})

it('exposes optional member-addressed superlatives with shared grounding', () => {
  const superlatives = [
    { memberId: 'player_first', title: 'Give the mat tenure', line: 'That mat earned a regular shift.' },
    { memberId: 'player_second', title: 'Recruit the laundry basket', line: 'The basket supervised every set.' },
  ]
  const recap = { pages: [], chatLine: 'Game over, tied 5 to 5.', superlatives }
  expect(parse('write_recap', recap)).toMatchObject({ kind: 'game', request: { recap } })
  expect(MURPH_WRITE_RECAP_TOOL.inputSchema.properties).toHaveProperty('superlatives')
})

it('offers one seated task for a group starter edit', () => {
  expect(parse('update_game', { messageRef: inputId, operation: 'edit_terms', gameId: 'game_group_one', expectedTermsVersion: 1,
    terms: { defaultTask: 'Walk', tasks: [{ memberId: 'player_0', text: 'Walk' }], schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] } })).toMatchObject({ kind: 'game' })
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('canStartNow')
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('start_now')
})

it('passes a seated player’s group edit proposal and individual vote through the real contracts', async () => {
  const update = { operation: 'edit_terms', gameId: 'game_group_one', expectedTermsVersion: 2, proposalId: 'proposal_group_new',
    terms: { defaultTask: 'Walk', tasks: ['player_0', 'player_1', 'player_2'].map(memberId => ({ memberId, text: 'Walk' })), schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] } }
  const request = parse('update_game', { messageRef: inputId, ...update })!
  expect(request).toMatchObject({ kind: 'game', request: { update } })
  const requestPort = vi.fn().mockResolvedValue({ action: 'update_game', result: { status: 'ok', state: { games: [] } } })
  await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), groupTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
  expect(requestPort).toHaveBeenCalledExactlyOnceWith({ action: 'update_game', origin, update })
  for (const operation of ['approve', 'decline']) {
    expect(parse('update_game', { messageRef: secondInput, operation, gameId: update.gameId, proposalId: update.proposalId })).toMatchObject({ kind: 'game', request: { messageRef: secondInput, update: { operation, proposalId: update.proposalId } } })
    expect(parse('update_game', { messageRef: inputId, operation, gameId: update.gameId, proposalId: update.proposalId, memberId: 'someone_else' })).not.toMatchObject({ kind: 'game' })
  }
});

it('can correct an unaccepted draft after an upload error', async () => {
  const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
  const story = { pages: [{ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text: 'The curtain' }] }], chatLine: 'The week ended.' }
  const draft = { story, files: [{ slot: 'scene-0', path: 'media/cover.jpg' }] }
  const record = vi.fn(), request = vi.fn().mockRejectedValueOnce(new Error('Synthetic upload failed')).mockResolvedValue({ action: 'write_recap', result: { status: 'ok', recap: story, chatLine: 'Accepted line and link', recapOutcome: 'Saved.' } })
  const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ gameId: 'synthetic', eventId: 'game-recap:synthetic', pairFingerprint: 'a'.repeat(32), show: true }),
    readGameRecapDraft: async () => draft, readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
    recordSavedGameRecapChatLine: record, groupTool: { request } }
  const call = () => executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })
  expect((await call()).rpcResult.success).toBe(false)
  expect(record).not.toHaveBeenCalled()
  draft.files = []; draft.story.pages[0]!.blocks[0]!.text = 'A better curtain'
  expect((await call()).rpcResult.success).toBe(true)
  expect(record).toHaveBeenCalledWith('Accepted line and link')
  expect(request.mock.calls[1]?.[0]).toMatchObject({ action: 'write_recap', recap: draft.story, assets: [] })
})

it('submits host-owned song timings without asking the draft to carry them', async () => {
  const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
  const story = { pages: [{ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text: 'The train' }] }], chatLine: 'The train arrived.',
    song: { title: 'Train', style: 'Folk', lyrics: ['Leo goes', 'Ava stays'] } }
  const wordsTimestamps = [{ word: 'Leo', startMs: 100, endMs: 300 }]
  const asset = { slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: 'synthetic', references: [], hash: 'a'.repeat(64), mediaType: 'audio/mpeg', byteLength: 3, durationMs: 20_000, wordsTimestamps }
  const request = vi.fn().mockResolvedValueOnce({ action: 'read_game', result: { status: 'ok', recapGame: asset } })
    .mockResolvedValueOnce({ action: 'write_recap', result: { status: 'ok', chatLine: 'Accepted line and link', recapOutcome: 'Saved.' } })
  const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ gameId: 'synthetic', eventId: 'game-recap:synthetic', pairFingerprint: 'a'.repeat(32), show: true }),
    readGameRecapDraft: async () => ({ story, files: [{ slot: 'song', path: 'media/song.mp3' }] }),
    readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'audio/mpeg', referenceIds: [], wordsTimestamps }), groupTool: { request } }
  expect((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })).rpcResult.success).toBe(true)
  expect(request.mock.calls[0]?.[0]).toMatchObject({ action: 'read_game', recapRead: { kind: 'upload', slot: 'song', wordsTimestamps } })
  expect(request.mock.calls[1]?.[0]).toMatchObject({ action: 'write_recap', recap: story, assets: [asset] })
})


it('both-win settled meaning is present in every read-facts block', () => {
  expect(GAME_READ_FACTS_GUIDANCE).toContain('A both_get stake is a prize both players get if both do every scheduled day. After such a game the result lists it once each way: say they both earned it, never that one owes the other. If either missed a day it lapsed; leave it out.');
});


it('both-win writer exposes the new change kind and exact pair guidance', () => {
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties.stakes.items.properties.kind.enum).toEqual(['prize', 'dare', 'both_get']);
  expect(GAME_PAIR_CHAT_GUIDANCE).toContain("Never propose one from your own idea or from a bare yes to your offer: ask what it should be.");
});
