import * as z from '@murphai/contracts/zod-runtime'
import { GAME_PRIZE_WORDS, hostedGameUpdateSchema, hostedGamePhotoSchema, hostedGameRecapSchema, type HostedGameUpdate, type HostedGamePhoto, type HostedGameRecap } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: `Read the games shared by the exact 2 to 10 players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before game questions or actions, with the acting player’s messageRef. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. The shared view includes daily check-in status and frozen settled results, but excludes private labels, photos, captions and excuses. Answer from returned progress and result; a missing post today is not a miss, and any-days targets are a total rather than daily obligations. Never infer why someone did not post. Unaddressed link invites stay app-only. Addressed Play again requests and chat-created games can be agreed here; follow the returned guidance. ${GAME_PRIZE_WORDS}`,
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'Acting player’s current accepted message; controls isSender and photoCheckIn.' } }, required: [] },
} as const
export const MURPH_READ_GAME_RECAP_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the finished game bound to this recap turn. Returns its players, terms, result, and each day’s posts or misses with entry IDs and post details; call it first.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const
export const MURPH_WRITE_RECAP_TOOL = {
  namespace: 'murph', name: 'write_recap',
  description: 'Save the recap for this finished game. Include superlatives only when read_game supplies eligible player memberIds: exactly one {memberId, title, line} each. Titles finish “Most likely to…” but omit those heading words from title; use 2–6 words, at most 80 characters, no trailing period, and differ between players. Each line is one short warm teasing sentence, at most 160 characters. Ground each only in this game’s entries and text all players can see: their posts, words, timing, streaks, shared excuses and tasks. Never invent details, use private information, be mean, or joke about bodies or weight. Groups require exactly one kind superlative per eligible person, with no missed-person shaming. Returns ok, or a list of problems to fix (unknown entries, a quote that is not verbatim, text over its limit, banned words). Fix every problem and call it again; the last accepted call is what the players see.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['pages', 'chatLine'], properties: {
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['background', 'blocks'], properties: {
      background: { type: 'string', enum: ['night', 'paper', 'sage', 'sienna', 'slate'] },
      blocks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
        kind: { type: 'string', enum: ['contactSheet', 'headline', 'kicker', 'photo', 'photoPair', 'quote', 'stat'] },
        entryIds: { type: 'array', items: { type: 'string' } }, style: { type: 'string', enum: ['print', 'fullBleed'] },
        text: { type: 'string' }, statValue: { type: 'string' },
        quote: { type: 'object', additionalProperties: false, required: ['who', 'text'], properties: { who: { type: 'string' }, text: { type: 'string' }, date: { type: 'string' } } },
      } } },
    } } }, superlatives: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['memberId', 'title', 'line'], properties: {
      memberId: { type: 'string' }, title: { type: 'string', maxLength: 80 }, line: { type: 'string', maxLength: 160 },
    } } }, scoreLine: { type: 'string' }, chatLine: { type: 'string' },
  } },
} as const
export const MURPH_GAME_LORE_TOOL = {
  namespace: 'murph', name: 'game_lore',
  description: 'Read or replace game lore when instructed. Returns current lore or save confirmation.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { enum: ['read', 'replace'] }, content: { type: 'string' },
  } },
} as const
export const GAME_GROUP_CHAT_GUIDANCE = 'Groups have 2 to 10 people and one shared winner prize. Read the exact room first, using the current accepted messageRef, including when that message carries an app invite link. Use returned memberIds and disambiguated names; never private contact names or invented references. On explicit request, create with one task per addressed person, one prize, a random gameId and defaults of 7 days and every day. Only game.players are seated. Unjoined people appear as pendingInviteeCount except a consented Talk note naming its author; that note accepts nothing. Never invent names or status. Edit only returned tasks; the server preserves hidden overrides. Only the starter is accepted at create. An addressed invitee can approve with expectedTermsVersion=terms.n and no proposalId; each person agrees for themselves, never through another person or a poll. The second acceptance activates the challenge; later joins keep its calendar. Any seated player can ask for a change with edit_terms: full terms, including defaultTask, keyed by returned seated memberIds, the current expectedTermsVersion and a new proposalId. Before anyone joins, the starter’s edit applies at once; otherwise it waits until more than half of the remaining players say yes, counting the asker. Each other player answers only for themselves with approve or decline and the pending proposalId, never through another person or a poll; a yes or no is final for that ask. Only the asker can cancel, and one ask waits at a time. Report the yeses still needed from read_game pendingChange.yesNeeded and votes, and say it is done only when the result shows the new terms. Name the asker and actual delta; call it an ask. Same locks as pairs: tasks lock once Day 1 begins, the start date at the first check-in, the prize when the game is done; length and weekday schedule change from the next unstarted day, and an any-days target locks once play starts. When changeControls.canStartNow is true, a remaining player may ask to start earlier with propose and start_now. This counts only as their yes; ask the others for votes. Never say everyone agreed or unjoined invitees joined. Respect unavailable/refused results; for legal or profile prerequisites, give one brief app next step. Unaddressed bearer invites stay app-only. In Prove it, only the accused may concede their own day; never judge evidence or ask for a group verdict. Never nudge through another person, shame missing posts, joke about bodies or weight, or use vs. With several games, use the speaker’s task words to select one; ask once if ambiguous. Never claim a notice was delivered from a successful mutation alone.'

export const GAME_SETUP_CHAT_GUIDANCE = 'Set up a game only on an explicit request in a chat with exactly two people and Murph; otherwise explain games are one-on-one and suggest that chat or the app. Read_game first. Key create tasks by stable memberId from read_game’s players (isSender identifies the current speaker); never invent references or swap task ownership; preserve who said each task, including the other person. Preserve task and stake words as actions (use base verbs: reads → Read, chooses → Choose; drop named subjects); stake item contains only the prize/dare words, without winner/loser framing. Ask only for missing tasks and prize/dare; state defaults of 7 days and every day. New games: 3–365 days, one prize for the winner or dare for the loser, task/prize/dare words up to 200 characters, any check-in kind. Schedule is weekdays (Monday 0) or any N days total. startsOn is tomorrow through 60 days out; compare the current date in the creator’s zone and ask for an earlier date without writing if outside that window; omit for acceptance default, which can start today before 20:00 (not before 03:00), otherwise next game date, aligned to the schedule. Never promise today before acceptance; existing start_now is available only when read_game offers it. Create with complete terms and a new random gameId: game_ followed by at least 20 random lowercase letters and digits, never built from names, dates or terms; reuse it only to retry that same create, and if the same ask is already waiting, say so without creating again or repeating the terms or question. Rematches use the settled same-pair previousGameId. New games never edit existing games. When an ask could mean a new game or a change to an existing one, ask which before gathering tasks or stakes or making any write; do not assume it means new. Resolve that intent before using the game-selection guidance. Describe a daily schedule as “every day”, not “everyday” (which means ordinary). In one short warm reply name both tasks (say “both” when they match), schedule, length, prize/dare and start day (or “starts when the other person agrees”), then ask the other person to agree. Creation is the requester’s yes, never the other person’s. Each game’s seat 0 is its creator and has already agreed; seat 1 is the other player. Match isSender’s memberId to that game’s seats. With negotiating and no pendingChange, only seat 1’s explicit agreement uses approve with expectedTermsVersion=terms.n and no proposalId; their refusal or the requester calling it off uses cancel_game. An invited game shown here is an addressed Play again: its one seated player is the creator, and the other read_game roster member is its invitee. Only that invitee may approve with expectedTermsVersion=terms.n and no proposalId, or use propose for changes (the server claims their seat without accepting). They cannot decline or cancel that unclaimed rematch: explain it stays open and its creator can call it off with cancel_game. The creator cannot agree to their own rematch. Unaddressed bearer-link invites stay app-only. Stakes is a full replacement with one prize for the winner or dare for the loser. The other player still approves the exact proposal. Negotiating games have no active obligations; approving their proposal starts the game. Counters on negotiating games use the ordinary propose/approve/decline/cancel moves. Never approve for the requester or from a poll vote. After a rejected create, relay the rule without retrying or rereading. For profile/access/content/cap errors, give one short line with the rule and next step; do not repeat the terms or invent names. For a content refusal, say those task or prize/dare words cannot be used and ask for different words. PROFILE_REQUIRED identifies the person by name or memberId: tell that person by their conversational name or “you” to add their first name in the Murph app; never print the reference. When debating a shared choice, create one native murph.poll (2–4 concrete options, keeping the chosen labels verbatim), then read its results before proposing terms from the winner; a tie needs a choice. Do not stack polls, poll one person’s own task or a simple yes/no, or repeat options after creating the poll. Never call an ask a proposal or use internal IDs, negotiating, or tool in replies. If approval starts a previously negotiating game, say it has started, without repeating its tasks, stakes or reminder offer: the separate kickoff owns that introduction. Do not say the kickoff was sent merely because the game started.'
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Group policy when immutable maxPlayers=10: any seated player asks for a change with edit_terms and a new proposalId, and each other player answers only for themselves with approve or decline and that proposalId, following read_game’s group guidance; propose with start_now only when canStartNow is true, counting only the asker’s yes. No nudges through another person or shaming. approve with expectedTermsVersion accepts the acting addressed invitee only. Pair change instructions below apply only to pair games. create sets up a game on explicit request in an exact 2 to 10 person chat with Murph: read_game first and follow its setup guidance. For shared debates (task, prize/dare, length, start, schedule), read_game first for poll guidance. Correct your own posted day or propose/respond to a change in this group. For a player reporting they did not finish, read_game then mark_incomplete with their explicit YYYY-MM-DD date. A day before its 3 AM close with no post is still open, not missed: nothing needs marking, so say there is no post yet and they have until 3 AM. For their explicit correction that they did finish, restore_day only clears their self-reported flag; it never completes a day with no post. Use the current speaker’s messageRef, never act for the other player. Only reached days in the live game bound to this room are eligible. Resolve today/yesterday from the acting message’s Occurred at timestamp in the speaker’s game timeZone with its 3 AM boundary, never from progress.checkedAt or processing time. First convert Occurred at to that timeZone. Before 3 AM, today is the previous calendar date; yesterday is one further day back. At or after 3 AM, today is that calendar date and yesterday is the previous date. If the timestamp is missing or a grouped time range makes the day ambiguous, ask once for the date. These two operations need date, not proposalId or partner approval. Read dayOutcome: marked_incomplete/already_incomplete confirms not done; restored confirms restored; no_artifact means that date has no post, so nothing changed; already_complete means no flag was removed. Reply with one plain line naming the date or weekday, never a day index, score change or claim about the other player. Artifacts stay visible under normal unlock rules. For proposals and responses: Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. One change waits at a time. When a player answers a pending proposal with a different one, decline it (cancel it if it is their own), then propose theirs, and say plainly in that reply that it replaces the earlier ask, such as “That replaces Ava’s 10-day ask.” Only read_game’s pendingChange is open; never imply a declined, cancelled or replaced proposal is still waiting. When a player comes round to the other player’s change they just declined, propose exactly that change: it counts as agreement and applies at once, so when the result shows no pendingChange and the new terms, confirm it is done and never ask the other player again. Propose only what the acting message asks for now; never fold in an earlier, deferred or other player’s request. Name each change against the current terms, such as “10 days instead of 7”. Word a player’s yes or no as theirs, such as “Ava said no to weekdays only”, never as your own act, and call a waiting change an ask, never a proposal. Say a player asked for or wants a change, as in “Ava wants 14 days instead of 7”, never that they proposed it. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. A rejected result’s error gives a code, then the rule or next step: explain it plainly and offer the nearest valid option, such as the latest allowed start date. Schedule and length edits affect future unstarted days and preserve existing check-ins. Tasks lock once either player’s Day 1 begins (read_game changeControls.canEditTasks). The prize or dare can change until the game is over (changeControls.canEditStakes), always with the other player’s yes, and the new one counts for the whole game. When a player asks to change tasks after Day 1 has begun, say once and plainly that they stay as agreed for this game, then offer what can still change: the prize or dare, its length or schedule from the next unstarted day, marking their own day not done, or new tasks in their next game. Do not repeat their request back or ask it again. Tasks is a full replacement for both seats: preserve an unchanged task from read_game. When you propose from this conversation, ask the other player naturally in your reply; the backend does not send a second announcement. Reply here even if app-originated announcements use another chat. When a player asks to call off a negotiating game that has not started, cancel_game ends it for both, and the backend posts the one cancellation notice in this chat: do not announce it yourself, so finish without a reply unless something else needs an answer. A live game cannot be called off: it settles on schedule. Say so plainly and offer what is possible: shorten it from the next unstarted day, change the schedule or the prize, or mark their own days incomplete.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['create', 'propose', 'approve', 'decline', 'cancel', 'mark_incomplete', 'restore_day', 'cancel_game', 'edit_terms'] },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'mark_incomplete/restore_day only: the speaker’s game-local YYYY-MM-DD.' },
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
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 365, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId'] },
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
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown(), terms: z.unknown().optional(), groupWord: z.unknown().optional(), previousGameId: z.unknown().optional(), proposalId: z.unknown().optional(), date: z.unknown().optional(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
  const { messageRef, ...update } = value
  const parsed = hostedGameUpdateSchema.safeParse(update)
  if (!parsed.success) {
    // Name the fields to fix (never their values), so a missing expectedTermsVersion is not mistaken for a bad gameId.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.length ? issue.path.join('.') : issue.message))].slice(0, 4).join('; ')
    ctx.addIssue({ code: 'custom', message: `Name the gameId from read_game and supply the fields for this operation (check: ${fields}). If the game is unclear, ask which task.` }); return z.NEVER
  }
  return { messageRef, update: parsed.data }
})
export type GameDynamicRequest = { action: 'read_game'; messageRef?: string } | { action: 'update_game'; messageRef: string; update: HostedGameUpdate } | { action: 'game_photo'; messageRef: string; photo: HostedGamePhoto } | { action: 'write_recap'; recap: HostedGameRecap } | { action: 'game_lore'; operation: 'read' | 'replace'; content?: string }
export function readGameDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool === 'game_lore') {
    const schema = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('read') }).strict(),
      z.object({ operation: z.literal('replace'), content: z.string().max(40000) }).strict(),
    ])
    const parsed = parseDynamicToolArguments({ schema, value: input.arguments, schemaRootKeys: ['operation', 'content'], toolName: 'murph.game_lore' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'game_lore' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'write_recap') {
    const parsed = parseDynamicToolArguments({ schema: hostedGameRecapSchema, value: input.arguments, schemaRootKeys: ['pages', 'scoreLine', 'chatLine', 'superlatives'], toolName: 'murph.write_recap' })
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
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'proposalId', 'expectedTermsVersion', 'change', 'date', 'terms', 'previousGameId'], toolName: 'murph.update_game' })
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
      ? await executeTrustedGameRecapRead({ origin, tool })
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
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const result = await input.tool.request({ action: 'read_game', origin: input.origin })
  return toolTextResult(true, JSON.stringify('recapGame' in result.result ? result.result.recapGame : result))
}

async function executeTrustedGameRecapWrite(input: {
  context: AssistantHostedToolContext | null
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  recap: HostedGameRecap
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const priorChatLines = (await input.context?.readGameLore?.() ?? '')
    .split(/\r?\n/u)
    .flatMap((line) => {
      const marker = line.indexOf('Chat line used:')
      if (marker < 0) return []
      const chatLine = line.slice(marker + 'Chat line used:'.length).trim()
      return chatLine && chatLine.length <= 160 ? [chatLine] : []
    })
    .slice(-100)
  const result = await input.tool.request({ action: 'write_recap', origin: input.origin, recap: input.recap, priorChatLines })
  const payload = result.result
  if (payload.status === 'ok' && input.context?.currentGameRecapScope?.()?.loreAccess === 'read'
    && 'recap' in payload && payload.recap) {
    await input.context.appendGameRecapChatLine?.(payload.recap.chatLine)
  }
  if (payload.status === 'ok' && 'chatLine' in payload && typeof payload.chatLine === 'string') {
    input.context?.recordSavedGameRecapChatLine?.(payload.chatLine)
  }
  const output = 'recapOutcome' in payload && typeof payload.recapOutcome === 'string'
    ? payload.recapOutcome
    : JSON.stringify(result)
  return toolTextResult(true, output)
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
export const GAME_SELECTION_GUIDANCE = '\nSeveral games share this chat. A day correction, change, answer to an ask, or photo offer or save acts on exactly one gameId. First keep only the games it can apply to: for marking a day not done, games where the speaker has a post that date; for restoring a day, games where that date does not show as posted, since a day marked not done reads as unposted; for a change, games it would actually change; for a yes or no, the asks waiting on the speaker; for an unsolicited photo offer, the speaker’s games whose task it shows; for an explicit save, the game they name or the photo offer waiting on them. Only the speaker’s own words pick among those: task words in this message or the one they just sent, or their answer to your question. Never pick by which game came up last, a recent notice, the other player’s messages, or the newest or first game. If exactly one game fits, act on it. If several fit, make no update_game or game_photo call: ask once, in one short question naming only those games by their tasks, as in “Which game, steps or plank?”, then act on the answer. The photo rules still decide whether a photo gets any reply or save: a photo they keep quiet stays quiet. Discuss progress per named task; lore belongs to the game audience.'

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
  const group = games.some(game => game.maxPlayers === 10) || (!games.length && (state?.players?.length ?? 0) > 2)
  return selection + '\n' + (group ? GAME_GROUP_CHAT_GUIDANCE : GAME_SETUP_CHAT_GUIDANCE)
}

export async function executeGameTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }) {
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
