import * as z from '@murphai/contracts/zod-runtime'
import { hostedGameUpdateSchema, hostedGamePhotoSchema, type HostedGameUpdate, type HostedGamePhoto } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games shared by the two players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. The shared view includes daily check-in status and frozen settled results, but excludes private labels, photos, captions and excuses. Answer from returned progress and result; a missing post today is not a miss, and any-days targets are a total rather than daily obligations. Never infer why someone did not post.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'For a photo offer or save, select the current accepted message from that player so photoCheckIn reflects their introduction status.' } }, required: [] },
} as const
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Correct your own posted day or propose/respond to a change in this group. For a player reporting they did not finish, read_game then mark_incomplete with their explicit YYYY-MM-DD date. For their explicit correction that they did finish, restore_day only clears their self-reported flag; it never completes an unposted day. Use the current speaker’s messageRef, never act for the other player. Only reached days in the live game bound to this room are eligible. Resolve today/yesterday in the speaker’s game timeZone using progress.checkedAt and the 3 AM boundary; ask once when the day is ambiguous. These two operations need date, not proposalId or partner approval. Read dayOutcome: marked_incomplete/already_incomplete confirms not done; restored confirms restored; no_artifact means already unposted, nothing changed; already_complete means no flag was removed. Reply with one plain line naming the date or weekday, never a day index, score change or claim about the other player. Artifacts stay visible under normal unlock rules. For proposals and responses: Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Schedule and length edits affect future unstarted days and preserve existing check-ins. Stakes and tasks are locked once the game has started; do not propose changing them on a live game. Tasks is a full replacement for both seats: preserve an unchanged task from read_game. Before kickoff, stakes is a full replacement with one prize for the winner or dare for the loser. The other player still approves the exact proposal. Negotiating games have no active obligations; approving their proposal starts the game. When you propose from this conversation, ask the other player naturally in your reply; the backend does not send a second announcement. Reply here even if app-originated announcements use another chat. If approval starts a previously negotiating challenge, acknowledge briefly without repeating its tasks, stakes or reminder offer: the separate kickoff owns that introduction. Do not say the kickoff was sent merely because the game started.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel', 'mark_incomplete', 'restore_day'] },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'mark_incomplete/restore_day only: the speaker’s game-local YYYY-MM-DD.' },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 365, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId'] },
} as const
export const GAME_PHOTO_CHAT_GUIDANCE = 'In iMessage game groups, a clear current photo relevant to the sender’s own challenge can introduce saving a check-in once per person. Read_game first with that sender’s current messageRef; only when photoCheckIn.introductionAvailable and that player has no current post, call game_photo operation=offer for that exact photo. Only an offer result permits one brief question, such as “Want me to use this as your check-in photo?” A suppressed offer stays quiet. Ordinary unrelated photos and conversation clearly between people stay quiet. This is permission for this photo only, never automatic future saving. After introduction, later unsolicited photos stay quiet. An explicit save request acts without redundant consent; a contextual yes to the pending offer saves that selected photo only. A no dismisses it. Never save another person’s photo, backdate, or claim the image verifies task completion. If today already has a post, replacing consumes the one retake: ask first unless replacement was explicitly requested, then pass its exact currentEntryId. Respect the current check-in kind returned by read_game; games with any allow photo artifacts. If a legacy game requires another kind, explain the server restriction.'
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
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown(), proposalId: z.unknown().optional(), date: z.unknown().optional(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
  const { messageRef, ...update } = value
  const parsed = hostedGameUpdateSchema.safeParse(update)
  if (!parsed.success) { ctx.addIssue({ code: 'custom', message: 'Invalid game change operation' }); return z.NEVER }
  return { messageRef, update: parsed.data }
})
export type GameDynamicRequest = { action: 'read_game'; messageRef?: string } | { action: 'update_game'; messageRef: string; update: HostedGameUpdate } | { action: 'game_photo'; messageRef: string; photo: HostedGamePhoto }
export function readGameDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
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
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'proposalId', 'expectedTermsVersion', 'change', 'date'], toolName: 'murph.update_game' })
  return parsed.ok ? { kind: 'game' as const, request: { action: 'update_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
}
export async function executeGameTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }) {
  const tool = input.context?.groupTool
  const scope = input.context?.currentUserActionScope?.()
  if (!tool || scope?.conversationScope !== 'group' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Game tools require current player input in the game group chat.', 'authority_rejected')
  const assistantInputId = input.request.messageRef ?? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
  if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use a Message ref from this group turn.', 'authority_rejected')
  const origin = { kind: 'accepted_input' as const, assistantInputId }
  try {
    const result = await tool.request(input.request.action === 'read_game' ? { action: 'read_game', origin } : input.request.action === 'game_photo' ? { action: 'game_photo', origin, photo: input.request.photo } : { action: 'update_game', origin, update: input.request.update })
    return toolTextResult(true, JSON.stringify(result))
  } catch (error) {
    return toolTextResult(false, 'The game action could not be confirmed. Read the game to check its current state before claiming a change applied.', 'handler_exception', error)
  }
}
