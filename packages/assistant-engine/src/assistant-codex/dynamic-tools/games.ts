import * as z from '@murphai/contracts/zod-runtime'
import { hostedGameUpdateSchema, type HostedGameUpdate } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games shared by the two players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. This shared view excludes private labels, photos and check-ins.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Edits affect future unstarted days and preserve existing results. When you propose from this conversation, ask the other player naturally in your reply; the backend does not send a second announcement. Reply here even if app-originated announcements use another chat. If approval starts a previously negotiating challenge, acknowledge briefly without repeating its tasks, stakes or reminder offer: the separate kickoff owns that introduction. Do not say the kickoff was sent merely because the game started.',
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
// Validate the action and message selector separately so strict action parsing
// cannot accidentally accept identity or destination selectors.
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown(), proposalId: z.unknown(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
  const { messageRef, ...update } = value
  const parsed = hostedGameUpdateSchema.safeParse(update)
  if (!parsed.success) { ctx.addIssue({ code: 'custom', message: 'Invalid game change operation' }); return z.NEVER }
  return { messageRef, update: parsed.data }
})
export type GameDynamicRequest = { action: 'read_game' } | { action: 'update_game'; messageRef: string; update: HostedGameUpdate }
export function readGameDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool === 'read_game') {
    const parsed = parseDynamicToolArguments({ schema: z.object({}).strict(), value: input.arguments, schemaRootKeys: [], toolName: 'murph.read_game' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'read_game' as const } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool !== 'update_game') return null
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'proposalId', 'expectedTermsVersion', 'change'], toolName: 'murph.update_game' })
  return parsed.ok ? { kind: 'game' as const, request: { action: 'update_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
}
export async function executeGameTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }) {
  const tool = input.context?.groupTool
  const scope = input.context?.currentUserActionScope?.()
  if (!tool || scope?.conversationScope !== 'group' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Game tools require current player input in the game group chat.', 'authority_rejected')
  const assistantInputId = input.request.action === 'update_game' ? input.request.messageRef : scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
  if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use a Message ref from this group turn.', 'authority_rejected')
  const origin = { kind: 'accepted_input' as const, assistantInputId }
  try {
    const result = await tool.request(input.request.action === 'read_game' ? { action: 'read_game', origin } : { action: 'update_game', origin, update: input.request.update })
    return toolTextResult(true, JSON.stringify(result))
  } catch (error) {
    return toolTextResult(false, 'The game action could not be confirmed. Read the game to check its current state before claiming a change applied.', 'handler_exception', error)
  }
}
