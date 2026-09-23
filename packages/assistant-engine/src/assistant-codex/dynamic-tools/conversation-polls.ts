import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import {
  conversationPollActionSchema,
  type ConversationPollAction,
} from '@murphai/hosted-execution/conversation-polls'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

export const MURPH_POLL_TOOL = {
  namespace: 'murph',
  name: 'poll',
  description: 'Create, list, read, vote in or close native polls in this conversation. Create takes a question and 2–12 distinct options (100 characters each); it sends immediately. iMessage sends the question followed by a poll; votes are public and multiple choices are allowed. Telegram uses one choice: anonymous defaults to true; set anonymous=false for named voting, or true when anonymity is requested. iMessage cannot be anonymous. Read uses pollRef from create/list and returns counts plus up to 50 voters with their optionIndexes. Pass nextVoterCursor as voterCursor to read more. iMessage exposes voter handles; named Telegram exposes received user or chat identities. Telegram tallies and voter updates may lag independently, even after close: never claim the received voter list is exhaustive or infer people behind chat voters or missing identities. Anonymous polls expose counts only. Vote is iMessage-only and adds or removes your own line’s vote: use pollRef, zero-based optionIndex from read, and operation=add or remove. Multiple choices are independent; adding another does not remove a previous choice. vote_submitted means the provider accepted the request, not confirmed device delivery; read to verify the tally. After an uncertain vote, read before retrying. Telegram bots cannot vote: state your pick in text when useful, without claiming a ballot or adding to its count. Only Telegram supports close; close stops voting and returns final results. Do not recreate after an unknown send outcome. After creation, avoid repeating the question and options in a second message.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'read', 'close', 'vote'] },
      optionIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'Vote only. Zero-based index in the poll’s options from read.' },
      operation: { type: 'string', enum: ['add', 'remove'], description: 'Vote only. Add or remove Murph’s own selection; never toggles another voter’s choice.' },
      question: { type: 'string', minLength: 1, maxLength: 300 },
      anonymous: { type: 'boolean', description: 'Create only. Telegram defaults to true; false makes votes identifiable. iMessage supports false only.' },
      voterCursor: { type: 'string', description: 'Read only. Exact nextVoterCursor from the previous read page.' },
      options: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 100 } },
      pollRef: { type: 'string', description: 'Exact pollRef returned by create or list.' },
    },
    required: ['action'],
  },
} as const

export function readConversationPollDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool !== MURPH_POLL_TOOL.name) return null
  const parsed = parseDynamicToolArguments({ schema: conversationPollActionSchema, value: input.arguments, schemaRootKeys: ['action', 'question', 'options', 'pollRef', 'anonymous', 'voterCursor', 'optionIndex', 'operation'], toolName: 'murph.poll' })
  return parsed.ok ? { kind: 'poll' as const, request: parsed.args } : { kind: 'invalid-poll-arguments' as const, validationDigest: parsed.validationDigest }
}

export async function executeConversationPollTool(input: {
  request: ConversationPollAction
  context: AssistantHostedToolContext | null
}) {
  const tool = input.context?.pollTool
  const scope = input.context?.currentInvocationScope?.()
  if (!tool || scope?.origin.kind !== 'accepted_input') {
    return toolTextResult(false, 'Poll actions require current conversation input.', 'authority_rejected')
  }
  try {
    const result = await tool.request({
      assistantInputId: scope.origin.assistantInputId,
      request: input.request,
    })
    return toolTextResult(true, JSON.stringify(result))
  } catch (error) {
    return toolTextResult(false, 'Poll action could not be confirmed. Do not invent results or claim it succeeded; an interrupted create may have sent, so do not recreate automatically.', 'handler_exception', error)
  }
}
