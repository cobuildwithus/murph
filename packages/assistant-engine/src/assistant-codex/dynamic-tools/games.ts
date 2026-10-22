import * as z from '@murphai/contracts/zod-runtime'
import { hostedGameUpdateSchema, hostedGamePhotoSchema, type HostedGameUpdate, type HostedGamePhoto } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games linked to this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. The shared view includes daily check-in status and frozen settled results, but excludes private labels, photos, captions and excuses. Answer from returned progress and result; a missing post today is not a miss, and any-days targets are a total rather than daily obligations. Never infer why someone did not post.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'For a photo offer or save, select the current accepted message from that player so photoCheckIn reflects their introduction status.' } }, required: [] },
} as const
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Edits affect future unstarted days and preserve existing results. The app sends its own proposal announcement; avoid repeating it unnecessarily.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      lengthDays: { type: 'integer', minimum: 1, maximum: 28 }, startsOn: { type: 'string', description: 'YYYY-MM-DD' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 28, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId', 'proposalId'] },
} as const
export const GAME_PHOTO_CHAT_GUIDANCE = 'In iMessage game groups, a clear current photo relevant to the sender’s own challenge can introduce saving a check-in once per person. Read_game first with that sender’s current messageRef; only when photoCheckIn.introductionAvailable and that player has no current post, call game_photo operation=offer for that exact photo. Only an offer result permits one brief question, such as “Want me to use this as your check-in photo?” A suppressed offer stays quiet. Ordinary unrelated photos and conversation clearly between people stay quiet. This is permission for this photo only, never automatic future saving. After introduction, later unsolicited photos stay quiet. An explicit save request acts without redundant consent; a contextual yes to the pending offer saves that selected photo only. A no dismisses it. Never save another person’s photo, backdate, or claim the image verifies task completion. If today already has a post, replacing consumes the one retake: ask first unless replacement was explicitly requested, then pass its exact currentEntryId. Heart-rate games still require the app graph.'
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
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown(), proposalId: z.unknown(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
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
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'proposalId', 'expectedTermsVersion', 'change'], toolName: 'murph.update_game' })
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
