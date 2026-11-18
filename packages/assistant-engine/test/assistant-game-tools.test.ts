import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeAssistantExecutionContext } from '../src/assistant/execution-context.js'
import { describe, expect, it, vi } from 'vitest'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { describeMyGameReminders, MURPH_MY_GAME_REMINDERS_TOOL, GAME_GROUP_CHAT_GUIDANCE, GAME_SETUP_CHAT_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_PAIR_CHAT_GUIDANCE, GAME_GROUP_MODE_GUIDANCE, GAME_REMINDER_GUIDANCE, GAME_READ_FACTS_GUIDANCE, GAME_PLAY_AGAIN_GUIDANCE, GAME_PAIR_AGREE_GUIDANCE, GAME_GROUP_JOIN_GUIDANCE, GAME_DAY_CORRECTION_GUIDANCE, GAME_UPDATE_RESULT_GUIDANCE, GAME_DAY_OUTCOME_GUIDANCE, GAME_RESULT_CORRECTED_GUIDANCE, GAME_REMINDER_OUTCOME_GUIDANCE, GAME_PHOTO_OUTCOME_GUIDANCE, GAME_REFUSAL_GUIDANCE, MURPH_READ_GAME_TOOL, MURPH_READ_GAME_RECAP_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL, GAME_SELECTION_GUIDANCE, GAME_RULES_REPEAT_POINTER } from '../src/assistant-codex/dynamic-tools/games.js'
import { resolveAssistantGameHostDynamicTools } from '../src/assistant/codex-turn/planning.js'
import { MURPH_FINISH_WITHOUT_REPLY_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.js'
import { createAssistantHostedToolContext, type AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from '@murphai/hosted-execution/parsers'
import { hostedGameToolResponseSchema, type HostedGameRecap } from '@murphai/hosted-execution/runtime-control'
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
/** A complete pair game as the hosted schema returns it; overrides replace fields and merge into terms. */
function chatGame({ terms, ...overrides }: Record<string, unknown> & { terms?: Record<string, unknown> } = {}) {
  return { id: 'game_synthetic', status: 'live', lengthDays: 7, startsOn: '2030-03-04',
    terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: 'Walk' }, { seat: 1, text: 'Read' }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: 'prize', item: 'Pick dinner' }], ...terms },
    players: [{ memberId: 'player_maya', seat: 0, firstName: 'Maya', dayOne: '2030-03-04', timeZone: 'America/New_York' }, { memberId: 'player_sam', seat: 1, firstName: 'Sam', dayOne: '2030-03-04', timeZone: 'America/New_York' }],
    pendingChange: null, changeControls: { canStartNow: false, canEdit: true, canEditSchedule: true, canEditStartDate: false, editableFromDay: 1 }, ...overrides }
}
/** Both players' days from 2030-03-04, as the hosted progress block lists them. */
function chatProgress(currentDayIndex: number | null, statuses: readonly string[]) {
  return { checkedAt: '2030-03-06T16:00:00.000Z', players: ['player_maya', 'player_sam'].map(memberId => ({ memberId, score: 1, target: 7, currentDayIndex,
    currentEntryId: null, attemptsRemaining: currentDayIndex === null ? 0 : 2, days: statuses.map((status, dayIndex) => ({ dayIndex, date: `2030-03-0${dayIndex + 4}`, status })) })) }
}
/** The JSON a result shows the model, and the guidance after it. */
function splitResult(text: string | undefined) {
  const value = text ?? ''
  const end = value.indexOf('\n')
  return { shown: JSON.parse(end < 0 ? value : value.slice(0, end)), guidance: end < 0 ? '' : value.slice(end + 1) }
}
const sharedReadTurn = () => ({ invalid: false, readProjectionScopeKeyBatches: [], roster: null })
describe('game dynamic tools', () => {
  it('offers and executes Not for me through the private game port only', async () => {
    const requestPort = vi.fn(async () => ({ action: 'my_game_not_for_me' as const, result: { status: 'ok' as const, activities: ['yoga' as const, 'dance' as const] } }))
    const direct = { ...context(), myGameRemindersTool: { request: requestPort }, currentUserActionScope: () => ({
      conversationId: 'synthetic-direct', inboundMailboxItemIds: [], recipientKey: 'synthetic-member', acceptedInputIds: [inputId], originSessionId: 'synthetic-session', conversationScope: 'direct' as const,
    }) }
    const tools = resolveMurphDynamicTools({ myGameRemindersAvailable: true })
    const definition = tools.find(tool => tool.name === 'my_game_not_for_me')!
    expect(definition).toBeDefined()
    expect(definition.description).toContain('read first')
    expect(definition.description).toContain('surfing, kayaking, a beach day')
    expect(resolveMurphDynamicTools({ myGameRemindersAvailable: false }).some(tool => tool.name === 'my_game_not_for_me')).toBe(false)
    const request = parse('my_game_not_for_me', { operation: 'set', activities: ['dance', 'yoga', 'dance'] })!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: direct, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.contentItems[0]?.text).toContain('"activities":["yoga","dance"]')
    expect(requestPort).toHaveBeenCalledExactlyOnceWith({ action: 'my_game_not_for_me', operation: 'set', activities: ['yoga', 'dance'], origin })
    for (const ctx of [{ ...context(), myGameRemindersTool: { request: requestPort } }, { ...direct, currentUserActionScope: () => ({ ...direct.currentUserActionScope(), acceptedInputIds: [] }) }]) {
      const denied = await executeMurphDynamicToolRequest({ request, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
      expect(denied.rpcResult.contentItems[0]?.text).toContain('current direct message')
    }
    expect(requestPort).toHaveBeenCalledOnce()
    for (const args of [{ operation: 'set' }, { operation: 'set', activities: ['water'] }, { operation: 'set', activities: [1] }]) {
      expect(parse('my_game_not_for_me', args)).toMatchObject({ kind: 'invalid-tool-arguments' })
    }
  })
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
  it('reads reminders back in words: one time, named weekdays, and everyDay only where it changes anything', async () => {
    const reminders = { minutes: 720, push: true, text: true, canText: true, games: [
      { id: 'game_weekdays', task: '20 pullups', schedule: { days: [0, 1, 2, 3, 4] }, today: 'upcoming' as const, otherFirstNames: ['Sam'], on: true, everyDay: false },
      { id: 'game_daily', task: '50 pushups', schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, today: 'posted' as const, otherFirstNames: ['Ava'], on: false, everyDay: true },
      { id: 'game_count', task: '3 lifts', schedule: { count: 3 }, today: 'open' as const, otherFirstNames: ['Leo'], on: true, everyDay: false },
    ] }
    const response = hostedGameToolResponseSchema.parse({ action: 'my_game_reminders', result: { status: 'ok', reminders, reaches: 'push' } })
    const requestPort = vi.fn(async () => response)
    const direct = { ...context(), myGameRemindersTool: { request: requestPort }, currentUserActionScope: () => ({
      conversationId: 'synthetic-direct', inboundMailboxItemIds: [], recipientKey: 'synthetic-member',
      acceptedInputIds: [inputId], originSessionId: 'synthetic-session', conversationScope: 'direct' as const,
    }) }
    const result = await executeMurphDynamicToolRequest({ request: parse('my_game_reminders', { operation: 'read' })!, hostedToolContext: direct, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual({ action: 'my_game_reminders', result: { status: 'ok', reaches: 'push', reminders: {
      minutes: 720, time: '12:00 PM', push: true, text: true, canText: true, games: [
        { id: 'game_weekdays', task: '20 pullups', today: 'upcoming', otherFirstNames: ['Sam'], on: true, days: 'Mon, Tue, Wed, Thu, Fri', reminds: 'each of these days not posted yet' },
        { id: 'game_daily', task: '50 pushups', today: 'posted', otherFirstNames: ['Ava'], on: false, days: 'every day', reminds: 'off' },
        { id: 'game_count', task: '3 lifts', today: 'open', otherFirstNames: ['Leo'], on: true, days: 'any 3 days', everyDay: false, reminds: 'only once every remaining day is needed to reach 3' },
      ] } } })
    expect(describeMyGameReminders(hostedGameToolResponseSchema.parse({ action: 'my_game_reminders', result: { status: 'ok', reaches: 'none', reminders: {
      ...reminders, minutes: 0, games: [{ ...reminders.games[2]!, everyDay: true }] } } }))).toMatchObject({ result: { reminders: { time: '12:00 AM',
      games: [{ everyDay: true, reminds: 'every day not posted yet' }] } } })
    // A game's own time, once Web sends one, shows beside that game.
    expect(describeMyGameReminders(hostedGameToolResponseSchema.parse({ action: 'my_game_reminders', result: { status: 'ok', reaches: 'push', reminders: {
      ...reminders, games: [{ ...reminders.games[0]!, minutes: 1260 }] } } }))).toMatchObject({ result: { reminders: { time: '12:00 PM',
      games: [{ minutes: 1260, time: '9:00 PM', days: 'Mon, Tue, Wed, Thu, Fri' }] } } })
    const refused = hostedGameToolResponseSchema.parse({ action: 'my_game_reminders', result: { status: 'unavailable', error: 'Private game reminders are unavailable.' } })
    expect(describeMyGameReminders(refused)).toBe(refused)
  })
  it('states the reminder facts the replies rely on, without the every-evening wording', () => {
    expect(MURPH_MY_GAME_REMINDERS_TOOL.description).toContain('Each game has its own time')
    expect(MURPH_MY_GAME_REMINDERS_TOOL.description).toContain('with gameId for that game only or without for all games')
    expect(MURPH_MY_GAME_REMINDERS_TOOL.description).toContain('for an any-N-days game everyDay')
    expect(MURPH_MY_GAME_REMINDERS_TOOL.description).toContain("A game in a group chat gets that chat's evening check-in instead")
    expect(MURPH_MY_GAME_REMINDERS_TOOL.description).not.toMatch(/every evening/u)
    expect(GAME_REMINDER_GUIDANCE).toContain("The time is for this chat's game only")
    expect(GAME_REMINDER_GUIDANCE).toContain("this chat gets Murph's evening check-in on game days")
  })
  it.each([
    { label: 'no game', games: [], carries: ['poll'] },
    { label: 'finished pair game', games: [{ status: 'settled', terms: { stakes: [{ kind: 'both_get', item: 'Dinner out together' }] } }], carries: ['poll', 'again'] },
    // The app sends a finished pair game's days only while its players can still correct them.
    { label: 'finished pair game that still lists its days', games: [{ status: 'settled', progress: chatProgress(null, ['posted', 'missed', 'posted']) }], carries: ['poll', 'again', 'day'] },
    { label: 'finished group game that lists days', games: [{ status: 'settled', maxPlayers: 10, progress: chatProgress(null, ['posted', 'missed', 'posted']) }], carries: ['poll', 'again'] },
    { label: 'waiting pair game', games: [{ status: 'negotiating' }], carries: ['poll', 'pairAgree', 'pair', 'reminder'] },
    { label: 'live pair game', games: [{ status: 'live' }], carries: ['pair', 'day', 'reminder'] },
    { label: 'invited group game', games: [{ status: 'invited', maxPlayers: 10 }], carries: ['poll', 'groupJoin', 'group', 'reminder'] },
    { label: 'live group game people can still join', games: [{ status: 'live', maxPlayers: 10, pendingInviteeCount: 2 }], carries: ['groupJoin', 'group', 'day', 'reminder'] },
    { label: 'live group game with everyone in', games: [{ status: 'live', maxPlayers: 10, pendingInviteeCount: 0 }], carries: ['group', 'day', 'reminder'] },
    { label: 'live pair and invited group', games: [{ status: 'live' }, { status: 'invited', maxPlayers: 10 }], carries: ['poll', 'pair', 'groupJoin', 'group', 'day', 'reminder'] },
    { label: 'settled both-win pair beside a live group', games: [{ status: 'settled', terms: { stakes: [{ kind: 'both_get', item: 'Dinner out together' }] } }, { status: 'live', maxPlayers: 10 }], carries: ['again', 'group', 'day', 'reminder'] },
    { label: 'live pair and settled group', games: [{ status: 'live' }, { status: 'settled', maxPlayers: 10 }], carries: ['again', 'pair', 'day', 'reminder'] },
  ])('carries each rule block once, and only for what the room holds: $label', async ({ games, carries }) => {
    const requestPort = vi.fn().mockResolvedValue({ action: 'read_game', result: { status: 'ok', state: { games: games.map(game => chatGame(game)) } } })
    const result = await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: { ...context(), groupTool: { request: requestPort } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text ?? ''
    for (const guidance of [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE]) expect(text.split(guidance)).toHaveLength(2)
    const blocks = { poll: GAME_SHARED_CHOICE_POLL_GUIDANCE, again: GAME_PLAY_AGAIN_GUIDANCE, pairAgree: GAME_PAIR_AGREE_GUIDANCE, pair: GAME_PAIR_CHAT_GUIDANCE,
      groupJoin: GAME_GROUP_JOIN_GUIDANCE, group: GAME_GROUP_MODE_GUIDANCE, day: GAME_DAY_CORRECTION_GUIDANCE, reminder: GAME_REMINDER_GUIDANCE }
    for (const [name, guidance] of Object.entries(blocks)) expect(text.split(guidance), name).toHaveLength(carries.includes(name) ? 2 : 1)
  })

  it('returns recent own-message consent guidance without current-turn-only rules', async () => {
    const request = parse('read_game', { messageRef: inputId })!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), groupTool: { request: async () => parseHostedRuntimeGroupToolResponse({ action: 'read_game', result: { status: 'ok', state: { games: [chatGame({ status: 'negotiating' }), chatGame({ id: 'game_group', maxPlayers: 10, pendingInviteeCount: 1 })] } } }) } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const guidance = result.rpcResult.contentItems[0]?.text ?? ''
    expect(GAME_UPDATE_RESULT_GUIDANCE.created).toContain('last 24 hours')
    expect(GAME_UPDATE_RESULT_GUIDANCE.created).not.toContain('message in this turn')
    expect(guidance).toContain('last 24 hours')
    expect(guidance).toContain("a like or heart from the player being asked")
    expect(guidance).toContain("approve with gameId and the reaction's own messageRef")
    expect(guidance).toContain('one propose for a pair game or one edit_terms for a group game')
    expect(guidance).toContain('combining its earlier changes with the new ones')
    expect(guidance).toContain('propose only the requested parts that can still change')
    expect(guidance).not.toContain("or cancel it when it is the speaker's own")
    expect(guidance).toContain('even though it came before the ask')
    expect(guidance).toContain("Another player's account")
    expect(guidance).not.toMatch(/act only for the player whose message you are answering|requests from earlier messages/)
    for (const tool of [MURPH_READ_GAME_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL]) {
      expect(tool.inputSchema.properties.messageRef.description).toContain('last 24 hours')
      expect(tool.inputSchema.properties.messageRef.description).not.toContain('current message')
    }
  })

  it.each([
    { label: 'an accepted invitation', args: { operation: 'approve', gameId: 'game_synthetic', expectedTermsVersion: 1 }, result: { status: 'ok', state: { games: [chatGame()] } }, says: GAME_UPDATE_RESULT_GUIDANCE.joined },
    { label: 'a yes that applies an ask', args: approval, result: { status: 'ok', state: { games: [chatGame()] } }, says: GAME_UPDATE_RESULT_GUIDANCE.applied },
    { label: 'a yes that still needs more', args: approval, result: { status: 'ok', state: { games: [chatGame({ pendingChange: { id: 'proposal_synthetic' } })] } }, says: GAME_UPDATE_RESULT_GUIDANCE.counted },
    { label: 'the yes that ends a game', args: approval, result: { status: 'ok', state: { games: [chatGame({ status: 'void' })] } }, says: GAME_UPDATE_RESULT_GUIDANCE.ended },
    { label: 'a no', args: { ...approval, operation: 'decline' }, result: { status: 'ok', state: { games: [chatGame()] } }, says: GAME_UPDATE_RESULT_GUIDANCE.declined },
    { label: 'a cancelled game', args: { operation: 'cancel_game', gameId: 'game_synthetic' }, result: { status: 'ok', state: { games: [] } }, says: GAME_UPDATE_RESULT_GUIDANCE.ended },
    { label: 'a day marked not done', args: { operation: 'mark_incomplete', gameId: 'game_synthetic', date: '2030-03-04' }, result: { status: 'ok', dayOutcome: { date: '2030-03-04', status: 'marked_incomplete' } }, says: GAME_DAY_OUTCOME_GUIDANCE.marked_incomplete },
    { label: 'a counted day that changed a finished game\'s result', args: { operation: 'mark_complete', gameId: 'game_synthetic', date: '2030-03-05', text: 'Read a chapter' },
      result: { status: 'ok', dayOutcome: { date: '2030-03-05', status: 'credited' }, chatLine: 'Maya\'s check-in for Tuesday, March 5 now counts. That changes the result. The game ended in a 6–6 tie.' }, says: GAME_RESULT_CORRECTED_GUIDANCE },
    { label: 'a counted day in a finished game that left the result alone', args: { operation: 'mark_complete', gameId: 'game_synthetic', date: '2030-03-05', text: 'Read a chapter' },
      result: { status: 'ok', state: { games: [chatGame({ status: 'settled' })] }, dayOutcome: { date: '2030-03-05', status: 'credited' } }, says: GAME_DAY_OUTCOME_GUIDANCE.credited },
    { label: 'a reminder that cannot arrive', args: { operation: 'set_reminder', minutes: 1080 }, result: { status: 'ok', reaches: 'none' }, says: GAME_REMINDER_OUTCOME_GUIDANCE.none },
    { label: 'a reminder switched off', args: { operation: 'set_reminder', gameId: 'game_synthetic', on: false }, result: { status: 'ok' }, says: GAME_REMINDER_OUTCOME_GUIDANCE.off },
    { label: 'a missing first name', args: approval, result: { status: 'rejected', error: 'PROFILE_REQUIRED: player_sam needs a first name and time zone in the Murph app.' }, says: GAME_REFUSAL_GUIDANCE.PROFILE_REQUIRED },
    { label: 'a yes with no returned state', args: approval, result: { status: 'ok' }, says: '' },
    { label: 'an unexplained refusal', args: approval, result: { status: 'rejected', error: 'TERMS_CHANGED: The terms changed.' }, says: '' },
  ])('ends an update result with what to say about $label', async ({ args, result, says }) => {
    const response = { action: 'update_game', result }
    const output = await execute({ messageRef: inputId, ...args }, { ...context(), groupTool: { request: vi.fn().mockResolvedValue(response) } })
    const { shown, guidance } = splitResult(output.rpcResult.contentItems[0]?.text)
    expect(shown).toMatchObject({ action: 'update_game', result: { status: result.status } })
    expect(guidance).toBe(says)
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
      chatGame({ id: 'game_group_one', maxPlayers: 10, status: 'invited' }), chatGame({ id: 'game_group_two', maxPlayers: 10, status: 'invited' }),
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
    const response = { action: 'read_game' as const, result: { status: 'ok' as const, state: { games: [chatGame({ id: 'game_synthetic_0' }), chatGame({ id: 'game_synthetic_1' })] } } }
    const requestPort = vi.fn().mockResolvedValue(response)
    const ctx: AssistantHostedToolContext = { ...context(), groupTool: { request: requestPort }, currentUserActionScope: () => null,
      currentInvocationScope: () => ({ conversationScope: 'group', origin: scheduledOrigin }) }
    const turn = sharedReadTurn()
    const read = () => executeMurphDynamicToolRequest({ request: parse('read_game', { messageRef: 'ignored-stale-ref' })!, hostedToolContext: ctx, groupSharedReadTurnState: turn, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const result = await read()
    expect(result.rpcResult.success).toBe(true)
    expect(requestPort).toHaveBeenCalledExactlyOnceWith({ action: 'read_game', origin: scheduledOrigin, includePlayers: true })
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + '\n' + GAME_READ_FACTS_GUIDANCE)
    expect((await read()).rpcResult.contentItems[0]?.text).toBe(JSON.stringify(response) + '\n' + GAME_RULES_REPEAT_POINTER)
    requestPort.mockClear()
    expect((await execute(approval, ctx)).rpcResult.success).toBe(false)
    const photo = await executeMurphDynamicToolRequest({ request: parse('game_photo', { messageRef: inputId, operation: 'save', gameId: 'game_synthetic' })!, hostedToolContext: ctx, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(photo.rpcResult.success).toBe(false)
    expect(requestPort).not.toHaveBeenCalled()
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
  it.each(['read_game', 'update_game'] as const)('forwards an earlier same-chat message for %s', async tool => {
    port.mockClear()
    const earlierRef = 'ain_' + 'c'.repeat(32)
    const request = parse(tool, tool === 'read_game' ? { messageRef: earlierRef } : { ...approval, messageRef: earlierRef })!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(true)
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: tool, origin: { kind: 'accepted_input', assistantInputId: earlierRef },
      ...(tool === 'read_game' ? { includePlayers: true } : { update: { operation: 'approve', gameId: approval.gameId, proposalId: approval.proposalId } }) })
  })
  it.each([
    { ...approval, actorMemberId: 'other' }, { ...approval, chatId: 'other' },
    { ...approval, operation: 'apply' }, { ...approval, change: { kind: 'start_now' } },
    { ...approval, operation: 'propose', expectedTermsVersion: 1, change: { kind: 'edit', schedule: { days: [7] } } },
  ])('rejects selectors or invalid operations %j', (args) => {
    expect(parse('update_game', args)?.kind).toBe('invalid-tool-arguments')
  })
  it('requires current group input even when selecting an earlier message', async () => {
    port.mockClear()
    expect((await execute(approval, { ...context(), currentUserActionScope: () => ({ ...context().currentUserActionScope!()!, acceptedInputIds: [] }) })).rpcResult.success).toBe(false)
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
    // A finished game that still lists its days can take a day correction, so a date can mean either game.
    { statuses: ['live', 'settled'] as const, guided: true, correctable: true },
    { statuses: ['settled', 'settled'] as const, guided: true, correctable: true },
  ])('adds selection guidance only when a message could mean several games: $statuses', async ({ statuses, guided, ...finished }) => {
    const games = statuses.map((status, index) => ({
      id: `game_synthetic_${index}`, status, lengthDays: 7, startsOn: null,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: index ? 'Read' : 'Walk' }], schedule: { days: [0, 1] }, stakes: [] },
      players: [], pendingChange: null, changeControls: { canStartNow: false, canEdit: true, canEditSchedule: true, canEditStartDate: false, editableFromDay: 1 },
      ...('correctable' in finished && status === 'settled' ? { progress: chatProgress(null, ['posted', 'missed']) } : {}),
    }))
    const response = hostedGameToolResponseSchema.parse({ action: 'read_game', result: { status: 'ok', state: { games } } })
    const request = parse('read_game', {})!
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: { ...context(), groupTool: { request: async () => response } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = result.rpcResult.contentItems[0]?.text
    expect(text).toContain(GAME_SHARED_SETUP_GUIDANCE)
    if (!guided) expect(splitResult(text).guidance).toBe([GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, ...(statuses.some(status => status === 'settled') ? [GAME_PLAY_AGAIN_GUIDANCE] : []), GAME_PAIR_CHAT_GUIDANCE, GAME_DAY_CORRECTION_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n'))
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
  it('shows an open game whole with its started days, and a finished game without asks or controls, with days only while it still lists them', async () => {
    const pendingChange = { id: 'proposal_synthetic', proposedByMemberId: 'player_maya', expectedTermsVersion: 1, change: { kind: 'edit', lengthDays: 10 }, effectiveFromDay: 3, deliveryStatus: 'sent', startsOn: null }
    // Day 3 is a day off ahead of today and day 4 has not started; neither is shown.
    const live = chatGame({ id: 'game_live', terms: { stakes: [{ kind: 'prize', item: 'Pick dinner', key: 'stake_live' }] }, pendingChange })
    const result = { scores: [{ memberId: 'player_maya', seat: 0, score: 3, misses: 0 }, { memberId: 'player_sam', seat: 1, score: 2, misses: 1 }],
      tickets: [{ owedByMemberId: 'player_sam', owedToMemberId: 'player_maya', what: 'Pick dinner', status: 'open', count: 1 }] }
    const closed = { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null }
    const { pendingChange: _none, changeControls: _closed, ...settled } = chatGame({ id: 'game_done', status: 'settled', terms: { stakes: [{ kind: 'dare', item: 'Sing', key: 'stake_done' }] }, result })
    const players = [{ memberId: 'player_maya', firstName: 'Maya', timeZone: 'America/New_York', isSender: true }, { memberId: 'player_sam', firstName: 'Sam', timeZone: 'America/New_York', isSender: false }]
    const photoCheckIn = { introductionAvailable: false, hasPendingOffer: false }
    const response = hostedGameToolResponseSchema.parse({ action: 'read_game', result: { status: 'ok', loreGuidance: 'Keep the lore.', loreFingerprint: 'a'.repeat(32), state: { players, photoCheckIn, games: [
      { ...live, progress: chatProgress(2, ['posted', 'missed', 'due', 'off', 'upcoming']) },
      { ...settled, pendingChange: null, changeControls: closed, progress: chatProgress(null, ['posted', 'missed', 'posted']) },
      { ...settled, id: 'game_final', pendingChange: null, changeControls: closed },
      { ...settled, id: 'game_group_done', maxPlayers: 10, pendingChange: null, changeControls: closed, progress: chatProgress(null, ['posted', 'missed', 'posted']) },
    ] } } })
    const output = await executeMurphDynamicToolRequest({ request: parse('read_game', { messageRef: inputId })!, hostedToolContext: { ...context(), groupTool: { request: async () => response } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    const text = output.rpcResult.contentItems[0]?.text
    expect(text).not.toMatch(/lore|checkedAt|stake_live|stake_done|"key"|upcoming|dayIndex/u)
    const days = { '2030-03-04': 'posted', '2030-03-05': 'missed', '2030-03-06': 'due' }
    expect(splitResult(text).shown).toEqual({ action: 'read_game', result: { status: 'ok', state: { players, photoCheckIn, games: [
      { ...live, terms: { ...live.terms, stakes: [{ kind: 'prize', item: 'Pick dinner' }] }, progress: { players: ['player_maya', 'player_sam'].map(memberId => ({ memberId, score: 1, target: 7, currentDayIndex: 2, currentEntryId: null, attemptsRemaining: 2, days })) } },
      // Still correctable: every day of the finished game, so a player's "count Tuesday" has a date and a game to land on.
      { ...settled, terms: { ...settled.terms, stakes: [{ kind: 'dare', item: 'Sing' }] }, progress: { players: ['player_maya', 'player_sam'].map(memberId => ({ memberId, score: 1, target: 7, currentDayIndex: null, currentEntryId: null, attemptsRemaining: 0,
        days: { '2030-03-04': 'posted', '2030-03-05': 'missed', '2030-03-06': 'posted' } })) } },
      { ...settled, id: 'game_final', terms: { ...settled.terms, stakes: [{ kind: 'dare', item: 'Sing' }] } },
      { ...settled, id: 'game_group_done', maxPlayers: 10, terms: { ...settled.terms, stakes: [{ kind: 'dare', item: 'Sing' }] } },
    ] } } })
    expect(splitResult(text).guidance.split(GAME_DAY_CORRECTION_GUIDANCE)).toHaveLength(2)
    expect(GAME_DAY_CORRECTION_GUIDANCE).toContain('a finished one that still lists its days')
    expect(GAME_DAY_CORRECTION_GUIDANCE).toContain('for 7 days after it ends')
    // One open game and one finished game that still lists its days: a date can mean either, so the several-games rule is sent.
    expect(splitResult(text).guidance.split(GAME_SELECTION_GUIDANCE)).toHaveLength(2)
  })
  it('shows a write only the game it acted on, without its days or the several-games rule', async () => {
    const pendingChange = { id: 'proposal_group', proposedByMemberId: 'player_maya', expectedTermsVersion: 3, change: { kind: 'call_off' }, effectiveFromDay: 3,
      votes: [{ memberId: 'player_maya', vote: 'yes' }], yesNeeded: 1, deliveryStatus: 'conversation', startsOn: null }
    const group = chatGame({ id: 'game_group', maxPlayers: 10, pendingInviteeCount: 0, terms: { defaultTask: 'Walk', n: 3 }, pendingChange })
    const games = [chatGame({ id: 'game_other', terms: { tasks: [{ seat: 0, text: 'Plank' }, { seat: 1, text: 'Plank' }] } }), { ...group, progress: chatProgress(2, ['posted', 'posted', 'due']) }]
    const state = { games, photoCheckIn: { introductionAvailable: true, hasPendingOffer: true } }
    const writes = [
      { args: { ...approval, gameId: 'game_group', proposalId: 'proposal_group' }, result: { status: 'ok', state }, says: GAME_UPDATE_RESULT_GUIDANCE.counted },
      { args: { operation: 'mark_complete', gameId: 'game_group', date: '2030-03-05' }, result: { status: 'ok', state, dayOutcome: { date: '2030-03-05', status: 'credited' } }, says: GAME_DAY_OUTCOME_GUIDANCE.credited },
    ]
    for (const { args, result, says } of writes) {
      const response = hostedGameToolResponseSchema.parse({ action: 'update_game', result })
      const output = await execute({ messageRef: inputId, ...args }, { ...context(), groupTool: { request: async () => response } })
      const { shown, guidance } = splitResult(output.rpcResult.contentItems[0]?.text)
      expect(shown).toEqual({ action: 'update_game', result: { ...result, state: { games: [group] } } })
      expect(guidance).toBe(says)
    }
    const reminder = hostedGameToolResponseSchema.parse({ action: 'update_game', result: { status: 'ok', state, reaches: 'push' } })
    const reminded = await execute({ messageRef: inputId, operation: 'set_reminder', on: true }, { ...context(), groupTool: { request: async () => reminder } })
    expect(splitResult(reminded.rpcResult.contentItems[0]?.text)).toEqual({
      shown: { action: 'update_game', result: { status: 'ok', state: { games: [games[0], group] }, reaches: 'push' } },
      guidance: GAME_REMINDER_OUTCOME_GUIDANCE.push,
    })
    const photo = hostedGameToolResponseSchema.parse({ action: 'game_photo', result: { status: 'ok', state, photoOutcome: 'saved' } })
    const saved = await executeMurphDynamicToolRequest({ request: parse('game_photo', { messageRef: inputId, operation: 'save', gameId: 'game_group' })!, hostedToolContext: { ...context(), groupTool: { request: async () => photo } }, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(splitResult(saved.rpcResult.contentItems[0]?.text)).toEqual({ shown: { action: 'game_photo', result: { status: 'ok', state: { games: [group] }, photoOutcome: 'saved' } }, guidance: GAME_PHOTO_OUTCOME_GUIDANCE.saved })
  })
  it('returns each rule block once per provider turn and points back to it on a later read', async () => {
    const live = { action: 'read_game', result: { status: 'ok', state: { games: [chatGame()] } } }
    const withFinished = { action: 'read_game', result: { status: 'ok', state: { games: [chatGame(), chatGame({ id: 'game_done', status: 'settled', result: null })] } } }
    const requestPort = vi.fn().mockResolvedValue(live)
    const read = async (turn: ReturnType<typeof sharedReadTurn>) => splitResult((await executeMurphDynamicToolRequest({ request: parse('read_game', {})!, hostedToolContext: { ...context(), groupTool: { request: requestPort } },
      groupSharedReadTurnState: turn, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })).rpcResult.contentItems[0]?.text)
    const rules = [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, GAME_PAIR_CHAT_GUIDANCE, GAME_DAY_CORRECTION_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n')
    const turn = sharedReadTurn()
    expect((await read(turn)).guidance).toBe(rules)
    const again = await read(turn)
    expect(again.guidance).toBe(GAME_RULES_REPEAT_POINTER)
    expect(again.shown.result.state.games).toHaveLength(1)
    // A finished game adds only the rule that was not returned yet.
    requestPort.mockResolvedValueOnce(withFinished)
    expect((await read(turn)).guidance).toBe([GAME_RULES_REPEAT_POINTER, GAME_PLAY_AGAIN_GUIDANCE].join('\n'))
    // A write in the same turn carries only what to say about it, never the rules or the pointer.
    const write = await executeMurphDynamicToolRequest({ request: parse('update_game', approval)!, hostedToolContext: context(), groupSharedReadTurnState: turn, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(splitResult(write.rpcResult.contentItems[0]?.text).guidance).toBe(GAME_UPDATE_RESULT_GUIDANCE.ended)
    // The next provider turn starts again with every rule.
    expect((await read(sharedReadTurn())).guidance).toBe(rules)
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
  it('forwards an earlier same-chat consent message for server authorization', async () => {
    port.mockClear()
    const request = parse('game_photo', { messageRef: 'ain_' + 'c'.repeat(32), operation: 'save', gameId: 'game_synthetic' })
    if (!request) throw new Error('Expected photo request')
    const result = await executeMurphDynamicToolRequest({ request, hostedToolContext: context(), env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })
    expect(result.rpcResult.success).toBe(true)
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'game_photo', origin: { kind: 'accepted_input', assistantInputId: 'ain_' + 'c'.repeat(32) }, photo: { operation: 'save', gameId: 'game_synthetic' } })
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

it('reads a result that names the accepted recap video, or none, and completes the write exactly as without one', async () => {
  const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
  const story = { pages: [{ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text: 'The curtain' }] }], chatLine: 'The week ended.' }
  const outcomes: unknown[] = []
  for (const recapVideo of [undefined, null, { generationId: 'a'.repeat(32), hash: 'b'.repeat(64), byteLength: 5_200_000 }]) {
    // The runtime's own result reader takes the field; a runtime that predates it would refuse the whole result.
    const result = parseHostedRuntimeGroupToolResponse({ action: 'write_recap', result: { status: 'ok', chatLine: 'Accepted line and link', recapOutcome: 'Saved.', ...(recapVideo === undefined ? {} : { recapVideo }) } })
    const record = vi.fn(), request = vi.fn().mockResolvedValue(result)
    const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ gameId: 'synthetic', eventId: 'game-recap:synthetic', pairFingerprint: 'a'.repeat(32), show: true, video: true }),
      readGameRecapDraft: async () => ({ story, files: [] }), readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
      recordSavedGameRecapChatLine: record, groupTool: { request } }
    outcomes.push((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })).rpcResult)
    expect(record).toHaveBeenCalledExactlyOnceWith('Accepted line and link')
    // A context that cannot render (no renderer wired) makes no video even on a wake that asks for one.
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: 'write_recap', origin: { kind: 'game_recap', gameId: 'synthetic', eventId: 'game-recap:synthetic' }, recap: story, assets: [] })
  }
  expect(outcomes[1]).toEqual(outcomes[0])
  expect(outcomes[2]).toEqual(outcomes[0])
  expect(outcomes[0]).toMatchObject({ success: true })
})

describe('a recap wake that asks for a video', () => {
  const story = { pages: [{ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text: 'The curtain' }] }], chatLine: 'The week ended.' }
  const scope = { gameId: 'synthetic', eventId: 'game-recap:synthetic', pairFingerprint: 'a'.repeat(32), show: true as const }
  const origin = { kind: 'game_recap', gameId: 'synthetic', eventId: 'game-recap:synthetic' }
  const write = { action: 'write_recap', result: { status: 'ok', chatLine: 'Accepted line and link', recapOutcome: 'Saved.' } }
  const part = (index: number, byteLength: number) => ({ storageKey: `recap/${'c'.repeat(32)}/${String(index).repeat(64)}.mp4`, hash: String(index).repeat(64), byteLength })
  const setup = async (input: { video?: true; render?: 'rendered' | 'refused'; parts?: unknown[]; bytes?: number }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'recap-video-candidate-'))
    const file = path.join(directory, 'recap.mp4')
    const bytes = Buffer.alloc(input.bytes ?? 4_500_000, 1)
    await writeFile(file, bytes)
    const dispose = vi.fn(async () => { await rm(directory, { recursive: true, force: true }) })
    const renderGameRecapVideo = vi.fn(async () => input.render === 'refused' ? { kind: 'refused' as const, reason: 'does_not_fit' }
      : { kind: 'rendered' as const, file, hash: 'f'.repeat(64), byteLength: bytes.length, referenceIds: ['1'.repeat(64)], dispose })
    const request = vi.fn()
    for (const value of input.parts ?? []) {
      if (value instanceof Error) request.mockRejectedValueOnce(value)
      else request.mockResolvedValueOnce(value)
    }
    request.mockResolvedValueOnce(write)
    const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ ...scope, ...(input.video ? { video: true as const } : {}) }),
      readGameRecapDraft: async () => ({ story, files: [] }), readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
      renderGameRecapVideo, recordSavedGameRecapChatLine: vi.fn(), groupTool: { request } }
    const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
    const result = await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })
    return { result: result.rpcResult, request, renderGameRecapVideo, dispose, directory }
  }
  const todaysWrite = { action: 'write_recap', origin, recap: story, assets: [] }

  it('stages the file as ordered parts and offers it to Web with the write', async () => {
    const { result, request, dispose, directory } = await setup({ video: true, parts: [0, 1, 2].map(index => ({ action: 'read_game', result: { status: 'ok', recapGame: part(index, index < 2 ? 2_000_000 : 500_000) } })) })
    expect(result).toMatchObject({ success: true })
    expect(request.mock.calls.slice(0, 3).map(([call]) => [call.recapRead.slot, call.recapRead.mediaType, call.recapRead.referenceIds, Buffer.from(call.recapRead.bytes, 'base64').length]))
      .toEqual([['video-0', 'video/mp4', [], 2_000_000], ['video-1', 'video/mp4', [], 2_000_000], ['video-2', 'video/mp4', [], 500_000]])
    expect(request.mock.calls[3]?.[0]).toEqual({ ...todaysWrite, video: { hash: 'f'.repeat(64), byteLength: 4_500_000, referenceIds: ['1'.repeat(64)], parts: [part(0, 2_000_000), part(1, 2_000_000), part(2, 500_000)] } })
    // The candidate is gone once the write has its answer.
    expect(dispose).toHaveBeenCalled()
    await expect(readFile(path.join(directory, 'recap.mp4'))).rejects.toThrow()
  })

  it('sends exactly today\'s write, and draws nothing, on a wake that did not ask', async () => {
    const { result, request, renderGameRecapVideo } = await setup({})
    expect(result).toMatchObject({ success: true })
    expect(renderGameRecapVideo).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledExactlyOnceWith(todaysWrite)
  })

  it.each([
    ['the renderer refuses', { render: 'refused' as const }, 0],
    ['Web refuses a part (the flag is off there)', { parts: [{ action: 'read_game', result: { status: 'unavailable', error: 'recap_video_unavailable' } }] }, 1],
    ['a part comes back as something else', { parts: [{ action: 'read_game', result: { status: 'ok', recapGame: { storageKey: 'x' } } }] }, 1],
    ['a later part fails (a seventeenth staged part)', { parts: [{ action: 'read_game', result: { status: 'ok', recapGame: part(0, 2_000_000) } }, new Error('Too many staged parts')] }, 2],
  ])('writes the recap as today when %s', async (_name, input: { render?: 'refused'; parts?: unknown[] }, uploads) => {
    const { result, request, dispose } = await setup({ video: true, ...input })
    expect(result).toMatchObject({ success: true })
    expect(request).toHaveBeenCalledTimes(uploads + 1)
    expect(request.mock.lastCall?.[0]).toEqual(todaysWrite)
    if (input.render !== 'refused') expect(dispose).toHaveBeenCalled()
  })

  it('writes the recap as today when the render step itself throws', async () => {
    const request = vi.fn().mockResolvedValueOnce(write)
    const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ ...scope, video: true }),
      readGameRecapDraft: async () => ({ story, files: [] }), readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
      renderGameRecapVideo: async () => { throw new Error('Synthetic setup failure') }, groupTool: { request } }
    const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
    expect((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })).rpcResult.success).toBe(true)
    expect(request).toHaveBeenCalledExactlyOnceWith(todaysWrite)
  })

  it('writes nothing when the turn is cancelled while a part uploads', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'recap-video-candidate-'))
    const file = path.join(directory, 'recap.mp4')
    await writeFile(file, Buffer.alloc(10))
    const dispose = vi.fn(async () => { await rm(directory, { recursive: true, force: true }) })
    const controller = new AbortController()
    const request = vi.fn(async (_call: unknown, options?: { signal?: AbortSignal | null }) => {
      controller.abort(new Error('Synthetic cancel'))
      expect(options?.signal?.aborted).toBe(true)
      return { action: 'read_game' as const, result: { status: 'ok' as const, recapGame: part(0, 10) } }
    })
    const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ ...scope, video: true }),
      readGameRecapDraft: async () => ({ story, files: [] }), readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
      renderGameRecapVideo: async () => ({ kind: 'rendered', file, hash: 'f'.repeat(64), byteLength: 10, referenceIds: [], dispose }), groupTool: { request } }
    const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
    expect((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' }, signal: controller.signal })).rpcResult.success).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalled()
  })

  it('throws the candidate away when the write itself fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'recap-video-candidate-'))
    const file = path.join(directory, 'recap.mp4')
    await writeFile(file, Buffer.alloc(10))
    const dispose = vi.fn(async () => { await rm(directory, { recursive: true, force: true }) })
    const request = vi.fn().mockResolvedValueOnce({ action: 'read_game', result: { status: 'ok', recapGame: part(0, 10) } }).mockRejectedValueOnce(new Error('Synthetic write failure'))
    const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ ...scope, video: true }),
      readGameRecapDraft: async () => ({ story, files: [] }), readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'image/jpeg', referenceIds: [] }),
      renderGameRecapVideo: async () => ({ kind: 'rendered', file, hash: 'f'.repeat(64), byteLength: 10, referenceIds: [], dispose }), groupTool: { request } }
    const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
    expect((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })).rpcResult.success).toBe(false)
    expect(dispose).toHaveBeenCalled()
  })
})

it('submits host-owned song timings without asking the draft to carry them', async () => {
  const { executeGameTool } = await import('../src/assistant-codex/dynamic-tools/games.js')
  const story = { pages: [{ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text: 'The train' }] }], chatLine: 'The train arrived.',
    song: { title: 'Train', style: 'Folk', lyrics: ['Leo goes', 'Ava stays'] } }
  const wordsTimestamps = [{ word: 'Leo', startMs: 5000, endMs: 5300 }], songStartMs = 4800
  const asset = { slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: 'synthetic', references: [], hash: 'a'.repeat(64), mediaType: 'audio/mpeg', byteLength: 3, durationMs: 25_000, songStartMs, wordsTimestamps }
  const request = vi.fn().mockResolvedValueOnce({ action: 'read_game', result: { status: 'ok', recapGame: asset } })
    .mockResolvedValueOnce({ action: 'write_recap', result: { status: 'ok', chatLine: 'Accepted line and link', recapOutcome: 'Saved.' } })
  const ctx: AssistantHostedToolContext = { ...context(), currentGameRecapScope: () => ({ gameId: 'synthetic', eventId: 'game-recap:synthetic', pairFingerprint: 'a'.repeat(32), show: true }),
    readGameRecapDraft: async () => ({ story, files: [{ slot: 'song', path: 'media/song.mp3' }] }),
    readGameRecapMedia: async () => ({ bytes: 'YWJj', mediaType: 'audio/mpeg', referenceIds: [], wordsTimestamps, songStartMs }), groupTool: { request } }
  expect((await executeGameTool({ context: ctx, request: { action: 'write_recap_file', draftPath: 'drafts/show.json' } })).rpcResult.success).toBe(true)
  expect(request.mock.calls[0]?.[0]).toMatchObject({ action: 'read_game', recapRead: { kind: 'upload', slot: 'song', wordsTimestamps, songStartMs } })
  expect(request.mock.calls[1]?.[0]).toMatchObject({ action: 'write_recap', recap: story, assets: [asset] })
})


it('both-win settled meaning is present in every read-facts block', () => {
  expect(GAME_READ_FACTS_GUIDANCE).toContain('A both_get stake is a prize both players get if both do every scheduled day. After such a game the result lists it once each way: say they both earned it, never that one owes the other. If either missed a day it lapsed; leave it out.');
});


it('both-win writer exposes the new change kind and exact pair guidance', () => {
  expect(MURPH_UPDATE_GAME_TOOL.inputSchema.properties.change.properties.stakes.items.properties.kind.enum).toEqual(['prize', 'dare', 'both_get']);
  expect(GAME_PAIR_CHAT_GUIDANCE).toContain("Never propose one from your own idea or from a bare yes to your offer: ask what it should be.");
});
