import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeAssistantExecutionContext } from '../src/assistant/execution-context.js'
import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { GAME_GROUP_CHAT_GUIDANCE, GAME_SETUP_CHAT_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_PAIR_CHAT_GUIDANCE, GAME_GROUP_MODE_GUIDANCE, GAME_REMINDER_GUIDANCE, MURPH_READ_GAME_TOOL, MURPH_READ_GAME_RECAP_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL, GAME_SELECTION_GUIDANCE } from '../src/assistant-codex/dynamic-tools/games.js'
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
    { label: 'pair only', games: [{ status: 'live' }], group: false, pair: true },
    { label: 'pair history in a larger room', games: [{ status: 'settled' }], group: true, pair: true, roster: 3 },
    { label: 'group only', games: [{ status: 'live', maxPlayers: 10 }], group: true, pair: false },
    { label: 'two-person group', games: [{ status: 'invited', maxPlayers: 10 }], group: true, pair: true, roster: 2 },
    { label: 'live pair and invited group', games: [{ status: 'live' }, { status: 'invited', maxPlayers: 10 }], group: true, pair: true },
    { label: 'live pair and settled group', games: [{ status: 'live' }, { status: 'settled', maxPlayers: 10 }], group: true, pair: true },
  ])('composes shared guidance once with selected-game mode rules: $label', async ({ games, group, pair, roster }) => {
    const requestPort = vi.fn().mockResolvedValue({ action: 'read_game', result: { status: 'ok', state: { games, ...(roster ? { players: Array.from({ length: roster }, () => ({})) } : {}) } } })
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: { ...context(), groupTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text ?? ''
    for (const guidance of [GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_REMINDER_GUIDANCE]) expect(text.split(guidance)).toHaveLength(2)
    expect(text.includes(GAME_PAIR_CHAT_GUIDANCE)).toBe(pair)
    expect(text.includes(GAME_GROUP_MODE_GUIDANCE)).toBe(group)
    for (const rule of ['A consented Talk note may name its author; it accepts no invitation and changes no terms.', 'In Prove it, only the accused may concede their own day; never judge evidence or ask for a group verdict.']) {
      expect(text.split(rule)).toHaveLength(group ? 2 : 1)
    }
    expect(text).not.toMatch(/before 20:00|short first day|person-to-person nudges/u)
  })

  it('binds consent and recurring reminder execution to fresh exact game state', () => {
    expect(GAME_SHARED_SETUP_GUIDANCE).toContain('bare yes to an older offer')
    expect(GAME_SHARED_SETUP_GUIDANCE).toContain('private invitation in the app')
    expect(GAME_GROUP_MODE_GUIDANCE).toContain('ignoring supplied replacement terms at create')
    expect(GAME_GROUP_MODE_GUIDANCE).toContain('never create another game as recovery')
    for (const phrase of ['set_reminder', 'never a new room automation', 'reaches', 'turn on notifications in the app', 'Never set another player']) expect(GAME_REMINDER_GUIDANCE).toContain(phrase)
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
    expect(text).not.toContain(GAME_SETUP_CHAT_GUIDANCE)
    const tasks = Array.from({ length: 10 }, (_, index) => ({ memberId: `player_${index}`, text: 'Walk' }))
    expect(parse('update_game', { messageRef: inputId, operation: 'edit_terms', gameId: 'game_group_one', expectedTermsVersion: 1,
      terms: { defaultTask: 'Walk', tasks, schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] } })).toMatchObject({ kind: 'game' })
    expect(GAME_GROUP_CHAT_GUIDANCE).toContain('Any seated player')
    expect(GAME_GROUP_CHAT_GUIDANCE).toContain('yesNeeded')
    expect(GAME_GROUP_CHAT_GUIDANCE).toContain('a yes or no is final for that ask')
    expect(GAME_GROUP_CHAT_GUIDANCE).not.toMatch(/Groups have no change requests|Only the starter can edit/u)
    expect(MURPH_UPDATE_GAME_TOOL.description).not.toMatch(/only the starter can edit_terms|no proposals/u)
    expect(GAME_GROUP_CHAT_GUIDANCE).toContain('Never nudge')
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
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response))
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
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('ordinary conversational agreement')
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('do not demand special words')
    expect(MURPH_READ_GAME_TOOL.description).toContain('Call the reward a prize')
    expect(MURPH_READ_GAME_TOOL.description).toContain('a two-player game is a game, as the players and the app call it, never a challenge.')
    expect(MURPH_READ_GAME_TOOL.description).toContain('Never call it a ticket, bet, wager, stake or winnings')
  })
  it('advertises v1 limits and stakes without suggesting a legacy graph for every game', () => {
    const change = MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties
    expect(change.lengthDays).toMatchObject({ minimum: 3, maximum: 365 })
    expect(change.schedule.properties.count.maximum).toBe(365)
    expect(change.stakes.items.properties.kind.enum).toEqual(['prize', 'dare'])
    expect(MURPH_GAME_PHOTO_TOOL.description).not.toContain('Heart-rate games still require the app graph')
  })
  it('round-trips create and initial agreement without accepting an actor selector', async () => {
    const terms = { tasks: [{ memberId: 'player_sam', text: 'Read' }, { memberId: 'player_ava', text: 'Walk' }], schedule: { count: 3 }, stakes: [{ kind: 'dare', item: 'Sing' }], lengthDays: 7 }
    for (const update of [{ operation: 'create', gameId: 'game_setup', terms }, { operation: 'approve', gameId: 'game_setup', expectedTermsVersion: 1 }]) {
      port.mockClear()
      expect((await execute({ messageRef: inputId, ...update })).rpcResult.success).toBe(true)
      expect(port).toHaveBeenCalledExactlyOnceWith(parseHostedRuntimeGroupToolRequest({ action: 'update_game', origin, update }))
      expect(parse('update_game', { messageRef: inputId, ...update, actorMemberId: 'player_sam' })?.kind).toBe('invalid-game-arguments')
    }
    expect(parse('update_game', { messageRef: inputId, operation: 'create', gameId: 'game_setup', terms: { ...terms, stakes: [{ kind: 'per_miss', item: 'Lunch' }] } })?.kind).toBe('invalid-game-arguments')
    expect(GAME_SETUP_CHAT_GUIDANCE).toContain('never the other person’s')
    expect(GAME_SETUP_CHAT_GUIDANCE).toContain('Never approve for the requester or from a poll vote')
    expect(GAME_SETUP_CHAT_GUIDANCE).toContain('read its results')
    expect(MURPH_UPDATE_GAME_TOOL.description).not.toContain(GAME_SETUP_CHAT_GUIDANCE)
    expect(MURPH_UPDATE_GAME_TOOL.description).toContain('follow its setup guidance')
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
    expect(text).toContain(GAME_SETUP_CHAT_GUIDANCE)
    if (!guided) expect(text).toBe(JSON.stringify(response) + '\n' + GAME_SETUP_CHAT_GUIDANCE)
    else {
      expect(text).toContain(GAME_SELECTION_GUIDANCE)
      // A move names its game only from the speaker's own words or the one game it can apply to; otherwise one question and no write.
      expect(GAME_SELECTION_GUIDANCE).toContain('for marking a day not done, games where the speaker has a post that date; for restoring a day, games where that date does not show as posted, since a day marked not done reads as unposted')
      // Photo silence and consent rules outrank the selection question.
      expect(GAME_SELECTION_GUIDANCE).toContain('The photo rules still decide whether a photo gets any reply or save: a photo they keep quiet stays quiet.')
      // What a photo shows narrows only unsolicited offers; an explicit save goes to the game the player names.
      expect(GAME_SELECTION_GUIDANCE).toContain('for an unsolicited photo offer, the speaker’s games whose task it shows; for an explicit save, the game they name or the photo offer waiting on them.')
      expect(GAME_SELECTION_GUIDANCE).toContain('for a change, games it would actually change')
      expect(GAME_SELECTION_GUIDANCE).toContain('Never pick by which game came up last, a recent notice, another player’s messages, or the newest or first game.')
      expect(GAME_SELECTION_GUIDANCE).toContain('If exactly one game fits, act on it. If several fit, make no update_game or game_photo call: ask once, in one short question naming only those games by their tasks')
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
    expect(parse('update_game', args)?.kind).toBe('invalid-game-arguments')
    const result = await execute(args)
    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain('(check: expectedTermsVersion)')
    expect(result.rpcResult.contentItems[0]?.text).not.toContain('Breakfast')
    expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.expectedTermsVersion.description).toContain('Required for propose')
  })
  it('round-trips negotiated task and whole-game stake scope without identity selectors', () => {
    const change = { kind: 'edit', tasks: [{seat:0,text:'Read'},{seat:1,text:'Stretch'}], stakes:[{kind:'per_miss',item:'Make tea'}], stakesApplyToWholeGame:true, startsOn:null }
    const request = {action:'update_game',origin,update:{operation:'propose',gameId:approval.gameId,proposalId:approval.proposalId,expectedTermsVersion:1,change}}
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request)
    expect(GAME_PAIR_CHAT_GUIDANCE).toContain('Tasks lock at either player’s Day 1')
    expect(GAME_PAIR_CHAT_GUIDANCE).toContain('Prize/dare changes need the other player’s yes until game end')
    expect(MURPH_UPDATE_GAME_TOOL.description).not.toContain('including earlier misses')
    expect(GAME_SETUP_CHAT_GUIDANCE).toContain('Negotiating games have no active obligations')
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change})?.kind).toBe('game')
    expect(parse('update_game',{...approval,operation:'propose',expectedTermsVersion:1,change:{...change,stakesApplyToWholeGame:false}})?.kind).toBe('invalid-game-arguments')
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
    for (const extra of [{ url: 'https://example.test/a.jpg' }, { memberId: 'other' }, { captureAgeMs: 10 }, { mediaKeys: ['arbitrary'] }]) expect(parse('game_photo', { ...args, ...extra })?.kind).toBe('invalid-game-arguments')
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
  expect(GAME_PAIR_CHAT_GUIDANCE).toContain('A live pair game cannot be called off: it settles on schedule')
  expect(GAME_SHARED_SETUP_GUIDANCE).toContain('cancel_game stays quiet: the lifecycle owns its one announcement')
})

it('teaches one pending change, current-ask-only proposals, plain refusals and open days', () => {
  const description = GAME_PAIR_CHAT_GUIDANCE + MURPH_UPDATE_GAME_TOOL.description
  expect(description).toContain('One change waits at a time.')
  for (const phrase of ['say it replaces the earlier ask', 'Only returned pendingChange remains open', 'only the current request', 'nearest valid option', 'Locked-task requests get one clear refusal', 'Attribute yes/no to its player']) expect(description).toContain(phrase)
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.description).toContain('Only the fields the acting message asks to change now')
  expect(description).toContain('is still open, not missed')
  expect(description).not.toMatch(/unposted/u)
})


it('gives game photo refusals a brief truthful reply without another attempt', () => {
  for (const phrase of ['DAY_CLOSED', 'credit the effort', 'next game day', 'Do not retry', 'claim the post counted or was saved']) expect(MURPH_GAME_PHOTO_TOOL.description).toContain(phrase)
})
it('exposes optional member-addressed superlatives with shared grounding', () => {
  const superlatives = [
    { memberId: 'player_first', title: 'Give the mat tenure', line: 'That mat earned a regular shift.' },
    { memberId: 'player_second', title: 'Recruit the laundry basket', line: 'The basket supervised every set.' },
  ]
  const recap = { pages: [], chatLine: 'Game over, tied 5 to 5.', superlatives }
  expect(parse('write_recap', recap)).toMatchObject({ kind: 'game', request: { recap } })
  expect(MURPH_WRITE_RECAP_TOOL.inputSchema.properties).toHaveProperty('superlatives')
  for (const phrase of ['eligible player memberIds', 'text all players can see', '2–6 words', 'differ between players', 'bodies or weight']) expect(MURPH_WRITE_RECAP_TOOL.description).toContain(phrase)
})

it('offers one seated task for a group starter edit', () => {
  expect(parse('update_game', { messageRef: inputId, operation: 'edit_terms', gameId: 'game_group_one', expectedTermsVersion: 1,
    terms: { defaultTask: 'Walk', tasks: [{ memberId: 'player_0', text: 'Walk' }], schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] } })).toMatchObject({ kind: 'game' })
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('pendingInviteeCount')
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('server preserves hidden overrides')
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('canStartNow')
  expect(GAME_GROUP_CHAT_GUIDANCE).toContain('start_now')
  expect(GAME_GROUP_CHAT_GUIDANCE).not.toContain('Never offer Start now')
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
