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
  description: 'Create, list, read or close native polls in this conversation. Create takes a question and 2–12 distinct options (100 characters each); it sends immediately. iMessage sends the question followed by a poll; votes are public and multiple choices are allowed. Telegram polls are anonymous with one choice. Read uses pollRef from create/list and reports observed results: Telegram updates may lag, so never claim a cached tally is live or infer voter identities. Only Telegram supports close; close stops voting and returns final results. Do not recreate after an unknown send outcome. After creation, avoid repeating the question and options in a second message.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'read', 'close'] },
      question: { type: 'string', minLength: 1, maxLength: 300 },
      options: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 100 } },
      pollRef: { type: 'string', description: 'Exact pollRef returned by create or list.' },
    },
    required: ['action'],
  },
} as const

export function readConversationPollDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool !== MURPH_POLL_TOOL.name) return null
  const parsed = parseDynamicToolArguments({ schema: conversationPollActionSchema, value: input.arguments, schemaRootKeys: ['action', 'question', 'options', 'pollRef'], toolName: 'murph.poll' })
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

