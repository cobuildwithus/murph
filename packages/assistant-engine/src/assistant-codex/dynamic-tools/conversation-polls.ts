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
  deferLoading: true,
  description: [
    'Create, list, read, vote in, or close native polls in this conversation.',
    'create needs a question and 2 to 12 distinct options of up to 100 characters each, and it sends at once. Do not repeat the question and options in a message afterward.',
    'On iMessage, votes are public, several choices are allowed, and a poll cannot be anonymous.',
    'On Telegram, each voter picks one choice. anonymous defaults to true, and anonymous=false makes votes named. Only Telegram supports close, which ends voting and returns final results.',
    'read takes pollRef from create or list and returns counts plus up to 50 voters with their optionIndexes. Pass nextVoterCursor as voterCursor to read more.',
    'Anonymous polls return counts only. iMessage shows voter handles, and named Telegram polls show the user or chat identities received.',
    'Telegram tallies and voter lists can lag, even after close, so never call a voter list complete or guess who is behind a chat-level vote or a missing identity.',
    "vote works on iMessage only and changes Murph's own vote: pass pollRef, a zero-based optionIndex from read, and operation add or remove. Each choice is independent, so adding one does not remove another.",
    'vote_submitted means the provider accepted the request. Read the poll to confirm the tally.',
    'On Telegram, Murph cannot vote, so state a pick in text when useful without claiming a ballot or adding to the count.',
    'After an uncertain create or vote, read or list to check, and never repeat it automatically.',
  ].join(' '),
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
  const route = scope?.origin.kind === 'automation_occurrence'
    ? input.context?.currentConversationPollRoute?.()
    : null
  if (!tool || !scope || (scope.origin.kind === 'automation_occurrence' && !route)) {
    return toolTextResult(false, 'Poll actions require current conversation input or an authorized scheduled occurrence.', 'authority_rejected')
  }
  try {
    const result = await tool.request(scope.origin.kind === 'accepted_input' ? {
      assistantInputId: scope.origin.assistantInputId,
      request: input.request,
    } : {
      origin: scope.origin,
      route: route!,
      request: input.request,
    })
    return toolTextResult(true, JSON.stringify(result))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'HOSTED_POLL_UNSUPPORTED_SERVICE') {
      return toolTextResult(false, 'Native polls require a confirmed iMessage conversation. This conversation’s service is unknown or unsupported; no poll action was sent.', 'authority_rejected', error)
    }
    return toolTextResult(false, pollFailureText(input.request.action), 'handler_exception', error)
  }
}

function pollFailureText(action: ConversationPollAction['action']): string {
  switch (action) {
    case 'vote':
      return 'The vote could not be confirmed and may have applied. Read the poll to check before voting again.'
    case 'create':
      return 'Creating the poll could not be confirmed, and it may have been sent. List polls to check before creating another one.'
    case 'close':
      return 'Closing the poll could not be confirmed, so it may still be open. Read the poll to check.'
    case 'list':
    case 'read':
      return 'The poll could not be read, so its results are unknown.'
  }
}
