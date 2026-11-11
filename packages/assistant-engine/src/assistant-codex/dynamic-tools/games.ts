import { readRecapUsages, recapUsageSchema } from '../../assistant/game-recap-lore.js'
import * as z from '@murphai/contracts/zod-runtime'
import { GAME_PRIZE_WORDS, hostedGameUpdateSchema, hostedGamePhotoSchema, hostedGameRecapWriterSchema, type HostedGameUpdate, type HostedGamePhoto, type HostedGameRecap, type HostedGameToolResponse } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: `Read the games shared by the exact 2 to 10 players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before game questions or actions, with the acting player’s messageRef. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Acceptance starts today only from 03:00 inclusive to 15:00 exclusive, otherwise the next game date, aligned to the schedule. The shared view includes daily check-in status and frozen settled results, but excludes private labels, photos, captions and excuses. Answer from returned progress and result; a missing post today is not a miss, and any-days targets are a total rather than daily obligations. Never infer why someone did not post. Unaddressed link invites stay app-only. Addressed Play again requests and chat-created games can be agreed here; follow the returned guidance. ${GAME_PRIZE_WORDS}`,
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'Acting player’s current accepted message; controls isSender and photoCheckIn.' } }, required: [] },
} as const
export const MURPH_MY_GAME_REMINDERS_TOOL = {
  deferLoading: true,
  namespace: 'murph', name: 'my_game_reminders',
  description: 'Read or set the current person’s private game reminder settings and live games. Use only in this direct conversation. Read before coaching a game reminder or choosing a task. If they want help, use behavior-followthrough: one question at a time, a real time, a small first step and a bad-day plan. Set a local time, optional text/push preference, or this person’s own game on/off and every-evening choice. Every evening means open game days without their post, not every calendar evening. The result says whether it reaches them; confirm delivery only from that, and when none, ask them to turn on notifications in the app. Never infer another player’s status or private words.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { type: 'string', enum: ['read', 'set'] }, messageRef: { type: 'string' },
    minutes: { type: 'integer', minimum: 0, maximum: 1439 }, gameId: { type: 'string' },
    on: { type: 'boolean' }, everyDay: { type: 'boolean' }, text: { type: 'boolean' }, push: { type: 'boolean' },
  } },
} as const
export const GAME_PRIVATE_REMINDER_DIRECT_GUIDANCE = 'For game reminders, use murph.my_game_reminders.'
export const MURPH_READ_GAME_RECAP_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the finished game bound to this recap turn. Returns its players, terms, result, and each day’s posts or misses with entry IDs and post details; call it first.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const
export const MURPH_WRITE_RECAP_TOOL = {
  namespace: 'murph', name: 'write_recap',
  description: 'Save the recap for this finished game. Include superlatives only when read_game supplies eligible player memberIds: {memberId, title, line}, at most one per player. Titles finish “Most likely to…” but omit those heading words from title; use 2–6 words, at most 80 characters, no trailing period, and differ between players. Each line is one short warm teasing sentence, at most 160 characters. Ground each only in this game’s entries and text all players can see: their posts, words, timing, streaks, shared excuses and tasks. Never invent details, use private information, be mean, or joke about bodies or weight. Groups require exactly one kind superlative per eligible person, with no missed-person shaming. Returns ok, or a list of problems to fix (unknown entries, a quote that is not verbatim, text over its limit, banned words). Fix every problem and call it again; the first accepted story is final; only explicit regeneration replaces it.',
  inputSchema: z.toJSONSchema(hostedGameRecapWriterSchema),
} as const
export const MURPH_GAME_LORE_TOOL = {
  namespace: 'murph', name: 'game_lore',
  description: 'Read or replace game lore when instructed. Returns current lore or save confirmation.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { enum: ['read', 'replace'] }, content: { type: 'string' },
  } },
} as const
export const GAME_SHARED_SETUP_GUIDANCE = "Read_game first with the current messageRef, including invite links. Use returned memberIds and names, never private labels or invented references. Create only on explicit request: a fresh two-person room makes a pair, a larger exact room a group; previousGameId may select a two-person group. Apply rules by the selected game’s maxPlayers, 10 means group, otherwise pair.\nPreserve task ownership and action/prize words (reads → Read; drop named subjects and winner/loser framing). Ask only for missing tasks or prize/dare. Defaults: 7 days, every day, any check-in kind. Limits: 3–365 days, words up to 200 characters, weekdays (Monday 0) or any N days total. Picked startsOn: tomorrow through 60 days out in the creator’s zone; outside it, ask for an earlier date without writing. Omit for acceptance default: today from 03:00 inclusive to 15:00 exclusive, otherwise next game date, schedule-aligned. Never promise today before acceptance. Say “every day”, not “everyday”.\nCreate complete terms with a random gameId: game_ plus at least 20 random lowercase letters/digits, never names, dates or terms. Reuse only for that create retry. Never duplicate a waiting ask. Clarify new game versus existing change before gathering terms or writing, then select the game. Give one short invitation with visible tasks, prize/dare, schedule, length and requested date or acceptance default; ask eligible invitees to agree for themselves.\nAgreement must match the answered offer. Read fresh terms: explain changed visible terms and get agreement before approving a bare yes to an older offer. Hidden task changes stay generic; use the private invitation in the app to review one’s own task before agreeing. Presence and poll votes accept nothing. Never expose unjoined overrides, private labels, captions or media.\nRefused create: explain the rule and next step, no retry or reread. Content refusal asks for different words; PROFILE_REQUIRED names the person conversationally and asks for a first name in the app. Call it an ask, omit internal IDs. Successful bound-chat cancel_game stays quiet: the lifecycle owns its one announcement. Starting approval gets brief confirmation; kickoff owns the introduction. Never claim delivery from mutation success. Never nudge someone through another person, shame missing posts, joke about bodies/weight or infer missing evidence."
export const GAME_SHARED_CHOICE_POLL_GUIDANCE = "For a shared choice, create one native murph.poll with 2–4 concrete options, preserving chosen labels verbatim, then read its results before proposing terms from the winner. Resolve a tie explicitly. Never stack polls, poll one person’s task or a simple yes/no, repeat options after creating the poll, or use poll votes as consent."
export const GAME_PAIR_CHAT_GUIDANCE = "For pairs only: one winner prize or loser dare. Creation is the requester’s yes, never the other person’s. Seat 0 is creator, seat 1 the other player; match sender memberId to seats. Negotiating games have no active obligations. With no pendingChange, only seat 1 approves terms.n without proposalId; their refusal or creator cancellation uses cancel_game. An invited pair is addressed Play again: only its invitee approves or uses propose to claim a seat without accepting. An unclaimed invitee cannot decline/cancel; the creator can cancel, never self-approve. Rematches use settled same-pair previousGameId and supplied terms; bearer invites stay app-only. Never approve for the requester or from a poll vote.\nFor changes, propose counts as the asker’s yes; the other player approves/declines, the asker cancels. One change waits at a time. A counter first declines the pending ask (cancels their own), then proposes only the current request; say it replaces the earlier ask. Only returned pendingChange remains open. Coming round to a just-declined ask: propose that exact change; if returned state applies it, confirm without asking again. Attribute yes/no to its player, name changes against current terms, ask the other player naturally, and confirm only returned application. A rejected result gives the rule/nearest valid option. Reply here; chat proposals have no second notice.\nTasks lock at either player’s Day 1; tasks replace both seats, preserving unchanged words. Prize/dare changes need the other player’s yes until game end and cover the whole game. Length/schedule affect future unstarted days, preserving posts. Locked-task requests get one clear refusal and options: prize/dare, future length/schedule, own incomplete days or next-game tasks. Start now only when read_game offers it. A live pair game ends early only by call_off: on an explicit request to stop the whole game, never from a joke, a missed day or venting, propose change kind call_off. The other player’s yes ends it with no winner and nothing owed; their no keeps it going. After the yes that ends it, stay quiet: the lifecycle owns its one announcement."
export const GAME_GROUP_MODE_GUIDANCE = "For maxPlayers=10, including two-person groups: one shared winner prize; create one task per addressee. Only starter accepts at create. Only game.players are seated; pendingInviteeCount names nobody. A consented Talk note may name its author; it accepts no invitation and changes no terms. Edit seated tasks only; server preserves hidden overrides for unjoined invitees. An addressed invitee approves terms.n without proposalId for themselves. Second acceptance activates play; later joins keep its calendar. Bearer invites stay app-only.\nAny seated player asks via edit_terms with full terms/defaultTask, seated memberIds, expectedTermsVersion and new proposalId. Starter edits apply immediately while invited; otherwise more than half of remaining players must agree, counting asker. Others approve/decline that proposalId for themselves; a yes or no is final for that ask. Only asker cancels the ask; one waits at a time. State pendingChange.yesNeeded unchanged as the further yeses still needed; it already counts every vote in votes, including the asker's, so never subtract again. Use votes to attribute responses, name the asker and actual delta, call it an ask, and confirm only returned application. Respect unavailable/refused results; legal or profile prerequisites get one brief app next step. With several games, select by the speaker’s task words; ask once if ambiguous. Tasks lock at Day 1, start at first post, prize at end; length/weekdays affect next unstarted day, any-days target locks at start. When changeControls.canStartNow is true, a remaining player may ask for an earlier start with propose and start_now. This counts only as their yes; ask the others for votes. Never claim everyone agreed or unjoined invitees joined.\nSame again copies previous final rules with acceptance-default start, ignoring supplied replacement terms at create. Create once, then starter edit_terms for requested changes while invited; confirm returned state. A join between copy and edit requires fresh state and the majority path; never create another game as recovery. Only remaining starter may cancel_game before any check-in and while not due, including live groups. Otherwise a live group ends early only by call_off: on an explicit request to stop the whole game, never from a joke, a missed day or venting, a remaining player uses propose with change kind call_off. Every remaining player must say yes, so yesNeeded counts everyone left; one no closes the ask. After the yes that ends it, stay quiet: the lifecycle owns its one announcement. In Prove it, only the accused may concede their own day; never judge evidence or ask for a group verdict. Never use vs. in group copy."
export const GAME_REMINDER_GUIDANCE = "A player's own reminder request uses update_game set_reminder, never a new room automation. Time is local to that player's profile; on changes only that player's game setting. For a time-only request omit on; include on and gameId together only when they ask to switch that game on or off. Ask which task only when several games could fit. Read reaches from the result: say a reminder is set only for push or text; for none, say it is saved and ask them to turn on notifications in the app. Confirm in a few words, as in \"Done, Leo. 6pm your time, just to you, on days you haven't posted.\" Say \"your time\", never a city or time zone. Never set another player's reminder from anyone else's words or a group vote. Existing scheduled room automations may finish on their own."
export const GAME_SETUP_CHAT_GUIDANCE = [GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_PAIR_CHAT_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n')
export const GAME_GROUP_CHAT_GUIDANCE = [GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE, GAME_GROUP_MODE_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n')
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: "Read_game first and follow its setup guidance for create, consent, changes, cancellation and reminders, scoped by the selected game’s maxPlayers. Use the current speaker’s messageRef; ordinary conversational agreement counts, do not demand special words. For a player reporting they did not finish, read_game then mark_incomplete with their explicit YYYY-MM-DD date. A day before its 3 AM close with no post is still open, not missed: nothing needs marking, so say there is no post yet and they have until 3 AM. For a player saying they did finish a day, or asking to count it, mark_complete with that date: it clears their own not-done flag, or counts a closed game day they never posted on as a post in their own words. Take their word; never ask for proof or put it to the other players, and never offer it unasked. Use the current speaker’s messageRef, never act for another player. Only reached days in the live game bound to this room are eligible. Resolve today/yesterday from the acting message’s Occurred at timestamp in the speaker’s game timeZone with its 3 AM boundary, never from progress.checkedAt or processing time. First convert Occurred at to that timeZone. Before 3 AM, today is the previous calendar date; yesterday is one further day back. At or after 3 AM, today is that calendar date and yesterday is the previous date. If the timestamp is missing or a grouped time range makes the day ambiguous, ask once for the date. These two operations need date, not proposalId or another player’s approval. Read dayOutcome: marked_incomplete/already_incomplete confirms not done; restored confirms their post counts again; words_needed means nothing changed yet: ask once what they want that day’s post to say, then mark_complete the same date with text set to their answer; credited confirms the missed day now counts, posted in their words; no_artifact means that date has no post, so nothing changed; already_complete means the day already counted. A refusal names the rule: an open day is still theirs to post, and a day off or a game that requires a photo or heart rate cannot be counted this way. Reply with one plain line naming the date or weekday, never a day index, score change or claim about another player. Artifacts stay visible under normal unlock rules. ",
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['create', 'propose', 'approve', 'decline', 'cancel', 'mark_incomplete', 'mark_complete', 'cancel_game', 'edit_terms', 'set_reminder'] },
    minutes: { type: 'integer', minimum: 0, maximum: 1439, description: 'set_reminder only: requester’s local minutes after midnight.' },
    on: { type: 'boolean', description: 'set_reminder only: include with gameId only when the speaker explicitly asks to switch their selected game on or off. Omit for time changes.' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'mark_incomplete/mark_complete only: the speaker’s game-local YYYY-MM-DD.' },
    text: { type: 'string', minLength: 1, maxLength: 140, description: 'mark_complete only: the speaker’s own words for a counted day’s post, verbatim on one line. Never write or edit them; omit until they give them.' },
    gameId: { type: 'string', minLength: 8, maxLength: 64, description: 'Create: game_ + at least 20 random lowercase letters/digits; never names, dates or terms. Reuse only for the same create retry.' }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing or for a group edit_terms ask.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Current terms.n. Required for propose and edit_terms, and for approve without proposalId.' },
    groupWord: { type: 'string', maxLength: 40, description: 'Group create only: their shared group word; defaults to group.' },
    previousGameId: { type: 'string' },
    terms: { type: 'object', additionalProperties: false, properties: {
      defaultTask: { type: 'string', minLength: 1, maxLength: 200, description: 'Group only; required for edit_terms. Preserve the returned default task unless asked to change it.' },
      tasks: { type: 'array', minItems: 1, maxItems: 10, description: 'Create requires 2 to 10 addressed people; edit_terms requires one task per returned seated player.', items: { type: 'object', additionalProperties: false, properties: { memberId: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['memberId', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365 }, startsOn: { type: 'string' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } }, count: { type: 'integer', minimum: 1, maximum: 365 } } },
    }, required: ['tasks', 'stakes', 'schedule'] },
    change: { type: 'object', additionalProperties: false, description: 'Only the fields the acting message asks to change now; omit every other field, including requests from earlier messages.', properties: {
      kind: { type: 'string', enum: ['start_now', 'edit', 'call_off'], description: 'call_off asks to end a live game early with no winner; it needs every remaining player’s yes.' },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 365, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation'] },
} as const
export const GAME_PHOTO_CHAT_GUIDANCE = 'In iMessage game groups, a clear current photo relevant to the sender’s own challenge can introduce saving a check-in once per person. Read_game first with that sender’s current messageRef; only when photoCheckIn.introductionAvailable and that player has no current post, call game_photo operation=offer for that exact photo. Only an offer result permits one brief question, such as “Want me to use this as your check-in photo?” A suppressed offer stays quiet. Ordinary unrelated photos and conversation clearly between people stay quiet. This is permission for this photo only, never automatic future saving. After introduction, later unsolicited photos stay quiet. An explicit save request acts without redundant consent; a contextual yes to the pending offer saves that selected photo only. A no dismisses it. Never save another person’s photo, backdate, or claim the image verifies task completion. If today already has a post, replacing consumes the one retake: ask first unless replacement was explicitly requested, then pass its exact currentEntryId. On DAY_CLOSED for a day off, credit the effort in one brief, kind reply, name the day off and the next game day from the refusal (or say no game days remain). Do not retry, offer an app workaround, or claim the post counted or was saved. Respect the current check-in kind returned by read_game; games with any allow photo artifacts. If a legacy game requires another kind, explain the server restriction.'
export const MURPH_GAME_PHOTO_TOOL = {
  namespace: 'murph', name: 'game_photo',
  description: `${GAME_PHOTO_CHAT_GUIDANCE} This tool supports iMessage/Linq only. Read_game before acting. messageRef identifies the current requesting sender. For a new photo, sourceMessageRef and attachmentOrdinal identify one exact accepted attachment from that sender in this room today. For yes/no to a pending offer, omit those selectors so the server uses the stored selection. Offer records an introduction attempt, not delivery or a saved photo; write the question only when photoOutcome=offer. Only photoOutcome=saved confirms a check-in. If bytes are unavailable, ask them to resend a JPEG/HEIC photo or use the app. Do not mention internal IDs, flags, transport, or stored source references.`,
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string' }, operation: { type: 'string', enum: ['offer', 'save', 'dismiss'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 },
    sourceMessageRef: { type: 'string' }, attachmentOrdinal: { type: 'integer', minimum: 1, maximum: 32 },
    replaceEntryId: { type: 'string', description: 'Exact currentEntryId from read_game, only after explicit replacement consent.' },
  }, required: ['messageRef', 'operation', 'gameId'] },
} as const
const rawPhotoArguments = hostedGamePhotoSchema.extend({ messageRef: z.string().min(1).max(128) }).strict()
// Validate the action and message selector separately so strict action parsing
// cannot accidentally accept identity or destination selectors.
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown().optional(), minutes: z.unknown().optional(), on: z.unknown().optional(), terms: z.unknown().optional(), groupWord: z.unknown().optional(), previousGameId: z.unknown().optional(), proposalId: z.unknown().optional(), date: z.unknown().optional(), text: z.unknown().optional(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
  const { messageRef, ...update } = value
  const parsed = hostedGameUpdateSchema.safeParse(update)
  if (!parsed.success) {
    // Name the fields to fix (never their values), so a missing expectedTermsVersion is not mistaken for a bad gameId.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.length ? issue.path.join('.') : issue.message))].slice(0, 4).join('; ')
    ctx.addIssue({ code: 'custom', message: `Name the gameId from read_game and supply the fields for this operation (check: ${fields}). If the game is unclear, ask which task.` }); return z.NEVER
  }
  return { messageRef, update: parsed.data }
})
export type GameDynamicRequest = { action: 'my_game_reminders'; operation: 'read' | 'set'; messageRef?: string; minutes?: number; gameId?: string; on?: boolean; everyDay?: boolean; text?: boolean; push?: boolean } | { action: 'read_game'; messageRef?: string } | { action: 'update_game'; messageRef: string; update: HostedGameUpdate } | { action: 'game_photo'; messageRef: string; photo: HostedGamePhoto } | { action: 'write_recap'; recap: HostedGameRecap } | { action: 'game_lore'; operation: 'read' | 'replace'; content?: string }
export function readGameDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool === 'my_game_reminders') {
    const schema = z.object({ operation: z.enum(['read', 'set']), messageRef: z.string().min(1).max(128).optional(),
      minutes: z.number().int().min(0).max(1439).optional(), gameId: z.string().min(8).max(64).optional(),
      on: z.boolean().optional(), everyDay: z.boolean().optional(), text: z.boolean().optional(), push: z.boolean().optional() }).strict()
    const parsed = parseDynamicToolArguments({ schema, value: input.arguments, schemaRootKeys: ['operation', 'messageRef', 'minutes', 'gameId', 'on', 'everyDay', 'text', 'push'], toolName: 'murph.my_game_reminders' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'my_game_reminders' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'game_lore') {
    const schema = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('read') }).strict(),
      z.object({ operation: z.literal('replace'), content: z.string().max(40000) }).strict(),
    ])
    const parsed = parseDynamicToolArguments({ schema, value: input.arguments, schemaRootKeys: ['operation', 'content'], toolName: 'murph.game_lore' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'game_lore' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'write_recap') {
    const parsed = parseDynamicToolArguments({ schema: hostedGameRecapWriterSchema, value: input.arguments, schemaRootKeys: ['pages', 'scoreLine', 'chatLine', 'superlatives', 'treatment', 'song'], toolName: 'murph.write_recap' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'write_recap' as const, recap: parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'read_game') {
    const parsed = parseDynamicToolArguments({ schema: z.object({ messageRef: z.string().min(1).max(128).optional() }).strict(), value: input.arguments, schemaRootKeys: ['messageRef'], toolName: 'murph.read_game' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'read_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'game_photo') {
    const parsed = parseDynamicToolArguments({ schema: rawPhotoArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'sourceMessageRef', 'attachmentOrdinal', 'replaceEntryId'], toolName: 'murph.game_photo' })
    if (!parsed.ok) return { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
    const { messageRef, ...photo } = parsed.args
    return { kind: 'game' as const, request: { action: 'game_photo' as const, messageRef, photo } }
  }
  if (input.tool !== 'update_game') return null
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'minutes', 'on', 'proposalId', 'expectedTermsVersion', 'change', 'date', 'text', 'terms', 'previousGameId'], toolName: 'murph.update_game' })
  return parsed.ok ? { kind: 'game' as const, request: { action: 'update_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
}

async function executeTrustedGameRecapTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }): Promise<ReturnType<typeof toolTextResult> | null> {
  if (input.request.action !== 'read_game' && input.request.action !== 'write_recap') return null
  const tool = input.context?.groupTool
  const recapScope = input.context?.currentGameRecapScope?.()
  if (!tool || !recapScope) return unavailableGameRecapToolResult(input.request.action)
  const origin = { kind: 'game_recap' as const, gameId: recapScope.gameId, eventId: recapScope.eventId }
  try {
    return input.request.action === 'read_game'
      ? await executeTrustedGameRecapRead({ origin, tool, context: input.context })
      : await executeTrustedGameRecapWrite({ context: input.context, origin, recap: input.request.recap, tool })
  } catch (error) {
    return toolTextResult(false, 'The recap action could not be confirmed. Read the game and fix every reported problem before trying again.', 'handler_exception', error)
  }
}

function unavailableGameRecapToolResult(action: 'read_game' | 'write_recap'): ReturnType<typeof toolTextResult> | null {
  return action === 'write_recap'
    ? toolTextResult(false, 'write_recap is available only in the bound game recap turn.', 'authority_rejected')
    : null
}

async function executeTrustedGameRecapRead(input: {
  context: AssistantHostedToolContext | null
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const result = await input.tool.request({ action: 'read_game', origin: input.origin })
  if (input.context?.currentGameRecapScope?.()?.show && result.result.status === 'ok') {
    const game = 'recapGame' in result.result ? result.result.recapGame : null
    const pending = typeof game === 'object' && game !== null && 'pendingRecapUsages' in game ? z.array(recapUsageSchema).max(20).parse(game.pendingRecapUsages) : []
    for (const usage of pending) {
      if (!input.context.appendGameRecapUsage) throw new Error('Trusted recap lore is unavailable.')
      await input.context.appendGameRecapUsage(usage)
    }
    if (typeof game === 'object' && game !== null && 'material' in game && input.context.prepareGameRecapInputs) {
      return toolTextResult(true, JSON.stringify(await input.context.prepareGameRecapInputs(game.material)))
    }
  }
  return toolTextResult(true, JSON.stringify('recapGame' in result.result ? result.result.recapGame : result))
}

async function executeTrustedGameRecapWrite(input: {
  context: AssistantHostedToolContext | null
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  recap: HostedGameRecap
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const lore = await input.context?.readGameLore?.() ?? ''
  const show = input.context?.currentGameRecapScope?.()?.show === true
  const priorChatLines = lore
    .split(/\r?\n/u)
    .flatMap((line) => {
      const marker = line.indexOf('Chat line used:')
      if (marker < 0) return []
      const chatLine = line.slice(marker + 'Chat line used:'.length).trim()
      return chatLine && chatLine.length <= 160 ? [chatLine] : []
    })
    .concat(show ? readRecapUsages(lore).map(usage => usage.chatLine) : [])
    .slice(-100)
  const result = await input.tool.request({ action: 'write_recap', origin: input.origin, recap: input.recap, priorChatLines, ...(show ? { usedTreatments: readRecapUsages(lore).map(usage => usage.treatment) } : {}) })
  const payload = result.result
  if ('recapOutcome' in payload) await recordAcceptedRecap(input, payload, show)
  const output = 'recapOutcome' in payload && typeof payload.recapOutcome === 'string'
    ? payload.recapOutcome
    : JSON.stringify(result)
  return toolTextResult(true, output)
}

async function recordAcceptedRecap(input: { context: AssistantHostedToolContext | null; origin: { gameId: string; eventId: string } }, payload: HostedGameToolResponse['result'], show: boolean): Promise<void> {
  if (payload.status === 'ok' && 'chatLine' in payload && typeof payload.chatLine === 'string') input.context?.recordSavedGameRecapChatLine?.(payload.chatLine)
  if (payload.status === 'ok' && 'recap' in payload && payload.recap) {
    try {
      if (show && payload.recap.treatment) {
        if (!input.context?.appendGameRecapUsage) throw new Error('Trusted recap lore is unavailable.')
        await input.context.appendGameRecapUsage({ generationId: input.origin.eventId, treatment: payload.recap.treatment, chatLine: payload.recap.chatLine })
      } else if (input.context?.currentGameRecapScope?.()?.loreAccess === 'read') await input.context.appendGameRecapChatLine?.(payload.recap.chatLine)
    } catch {
      // Acceptance and its delivery intent already succeeded. The durable asset task
      // and the next trusted read repair the missing canonical usage stamp.
    }
  }
}

async function executeGameLoreTool(input: {
  request: Extract<GameDynamicRequest, { action: 'game_lore' }>
  context: AssistantHostedToolContext | null
}) {
  if (!input.context?.readGameLore || !input.context?.replaceGameLore) return toolTextResult(false, 'Game lore is unavailable for this turn.', 'authority_rejected')
  if (input.request.operation === 'replace' && input.context.currentGameRecapScope?.()?.loreAccess === 'read') {
    return toolTextResult(false, 'Game lore is read-only for this recap.', 'authority_rejected')
  }
  try {
    if (input.request.operation === 'read') return toolTextResult(true, await input.context.readGameLore())
    await input.context.replaceGameLore(input.request.content ?? '')
    return toolTextResult(true, 'ok: game lore replaced')
  } catch (error) {
    return toolTextResult(false, 'Game lore could not be accessed.', 'handler_exception', error)
  }
}

/** With several games in one room, a move acts on the one game it can mean, or asks once. */
export const GAME_SELECTION_GUIDANCE = '\nSeveral games share this chat. A day correction, change, answer to an ask, or photo offer or save acts on exactly one gameId. First keep only the games it can apply to: for marking a day not done, games where the speaker has a post that date; for counting a day as done, games where that date does not show as posted, since a missed day and a day marked not done both read as unposted; for a change, games it would actually change; for a yes or no, the asks waiting on the speaker; for an unsolicited photo offer, the speaker’s games whose task it shows; for an explicit save, the game they name or the photo offer waiting on them. Only the speaker’s own words pick among those: task words in this message or the one they just sent, or their answer to your question. Never pick by which game came up last, a recent notice, another player’s messages, or the newest or first game. If exactly one game fits, act on it. If several fit, make no update_game or game_photo call: ask once, in one short question naming only those games by their tasks, as in “Which game, steps or plank?”, then act on the answer. The photo rules still decide whether a photo gets any reply or save: a photo they keep quiet stays quiet. Discuss progress per named task; lore belongs to the game audience.'

async function executeOrdinaryGameTool(input: {
  request: Extract<GameDynamicRequest, { action: 'read_game' | 'update_game' | 'game_photo' }>
  context: AssistantHostedToolContext | null
}) {
  const tool = input.context?.groupTool
  const scope = input.context?.currentUserActionScope?.()
  if (!tool || scope?.conversationScope !== 'group' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Game tools require current player input in the game group chat.', 'authority_rejected')
  const assistantInputId = input.request.messageRef ?? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
  if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use a Message ref from this group turn.', 'authority_rejected')
  const origin = { kind: 'accepted_input' as const, assistantInputId }
  try {
    const result = await tool.request(input.request.action === 'read_game' ? { action: 'read_game', origin, includePlayers: true } : input.request.action === 'game_photo' ? { action: 'game_photo', origin, photo: input.request.photo } : { action: 'update_game', origin, update: input.request.update })
    return toolTextResult(true, JSON.stringify(result) + gameReadGuidance(result, input.request.action === 'read_game'))
  } catch (error) {
    return toolTextResult(false, 'The game action could not be confirmed. Read the game to check its current state before claiming a change applied.', 'handler_exception', error)
  }
}

function gameReadGuidance(result: Awaited<ReturnType<NonNullable<AssistantHostedToolContext["groupTool"]>["request"]>>, reading: boolean): string {
  const state = 'state' in result.result ? result.result.state : undefined
  const games = state?.games ?? []
  const selection = games.filter(game => ['live', 'negotiating', 'invited'].includes(game.status)).length > 1 ? GAME_SELECTION_GUIDANCE : ''
  if (!reading || result.result.status !== 'ok') return selection
  const group = games.some(game => game.maxPlayers === 10) || (state?.players?.length ?? 0) > 2
  const pair = games.some(game => game.maxPlayers !== 10) || state?.players?.length === 2 || !group
  return selection + '\n' + [GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE,
    ...(pair ? [GAME_PAIR_CHAT_GUIDANCE] : []), ...(group ? [GAME_GROUP_MODE_GUIDANCE] : []), GAME_REMINDER_GUIDANCE].join('\n')
}

export async function executeGameTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }) {
  if (input.request.action === 'my_game_reminders') {
    const scope = input.context?.currentUserActionScope?.()
    const tool = input.context?.myGameRemindersTool
    if (!tool || scope?.conversationScope !== 'direct' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Private game reminders require your current direct message.', 'authority_rejected')
    const assistantInputId = input.request.messageRef ?? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
    if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use this direct message to change reminders.', 'authority_rejected')
    try {
      const { messageRef: _messageRef, ...request } = input.request
      return toolTextResult(true, JSON.stringify(await tool.request({ ...request, origin: { kind: 'accepted_input', assistantInputId } })))
    } catch (error) { return toolTextResult(false, 'Game reminders could not be confirmed.', 'handler_exception', error) }
  }
  if (input.request.action === 'game_lore') return executeGameLoreTool({ ...input, request: input.request })
  const recapResult = await executeTrustedGameRecapTool(input)
  if (recapResult) return recapResult
  if (input.request.action === 'write_recap') return toolTextResult(false, 'write_recap is available only in the bound game recap turn.', 'authority_rejected')
  if (input.request.action === 'read_game') {
    const scheduledRead = await executeScheduledGameRead(input.context)
    if (scheduledRead) return scheduledRead
  }
  return executeOrdinaryGameTool({ ...input, request: input.request })
}

/** A verified scheduled occurrence reads the bound room's shared game state; it never acts for a player. */
async function executeScheduledGameRead(context: AssistantHostedToolContext | null) {
  const tool = context?.groupTool
  if (!tool || context?.currentUserActionScope?.()?.acceptedInputIds.length) return null
  const invocation = context?.currentInvocationScope?.()
  if (invocation?.origin.kind !== 'automation_occurrence' || invocation.conversationScope !== 'group') return null
  const { automationId, occurrenceAt } = invocation.origin
  try {
    const result = await tool.request({ action: 'read_game', origin: { kind: 'automation_occurrence', automationId, occurrenceAt }, includePlayers: true })
    return toolTextResult(true, JSON.stringify(result))
  } catch (error) {
    return toolTextResult(false, 'The game state could not be read.', 'handler_exception', error)
  }
}
