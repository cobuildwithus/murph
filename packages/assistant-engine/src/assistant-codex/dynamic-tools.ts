import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import type { AssistantTurnProgress } from '../assistant/turn-progress.js'
import { MAX_PROGRESS_CHARS } from '../assistant/turn-progress.js'
import type {
  CodexRpcId,
  CodexRpcMessage,
} from './app-server-rpc.js'

export const MURPH_SEND_PROGRESS_UPDATE_TOOL = {
  namespace: 'murph',
  name: 'send_progress_update',
  description:
    'Send one brief progress update to the user in the current conversation when the current task will take noticeable time. The update must be user-facing, factual, and not include final conclusions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PROGRESS_CHARS,
        description:
          'Brief model-authored progress update. No markdown links, no final answer, no medical interpretation, no claims that have not been checked yet.',
      },
    },
    required: ['text'],
  },
} as const

const CODEX_DYNAMIC_TOOL_CALL_METHOD = 'item/tool/call'
const SEND_PROGRESS_UPDATE_TOOL_NAMESPACE = 'murph'
const SEND_PROGRESS_UPDATE_TOOL_NAME = 'send_progress_update'

interface ParsedDynamicToolCallRequest {
  arguments: unknown
  namespace: string | null
  tool: string | null
}

export async function maybeHandleMurphDynamicToolRequest(input: {
  message: CodexRpcMessage
  requestId: CodexRpcId
  turnProgress: AssistantTurnProgress
  writeRpcMessage: (payload: Record<string, unknown>) => void
}): Promise<boolean> {
  const request = parseDynamicToolCallRequest(input.message)
  if (!request) {
    return false
  }

  if (
    request.namespace !== SEND_PROGRESS_UPDATE_TOOL_NAMESPACE ||
    request.tool !== SEND_PROGRESS_UPDATE_TOOL_NAME
  ) {
    input.writeRpcMessage({
      id: input.requestId,
      error: {
        code: -32000,
        message: `Unsupported dynamic tool ${request.namespace ?? ''}.${request.tool ?? 'unknown'}`,
      },
    })
    return true
  }

  const parsed = parseSendProgressUpdateArguments(request.arguments)
  if (!parsed.ok) {
    input.writeRpcMessage({
      id: input.requestId,
      result: {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: 'invalid progress update arguments',
          },
        ],
      },
    })
    return true
  }

  await input.turnProgress.send(parsed.text)

  input.writeRpcMessage({
    id: input.requestId,
    result: {
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: 'progress update sent',
        },
      ],
    },
  })
  return true
}

function parseDynamicToolCallRequest(
  message: CodexRpcMessage,
): ParsedDynamicToolCallRequest | null {
  if (message.method !== CODEX_DYNAMIC_TOOL_CALL_METHOD) {
    return null
  }

  const params = asRecord(message.params)
  if (!params) {
    return {
      arguments: null,
      namespace: null,
      tool: null,
    }
  }

  return {
    arguments: params.arguments,
    namespace: normalizeNullableStringValue(params.namespace),
    tool: normalizeNullableStringValue(params.tool),
  }
}

function parseSendProgressUpdateArguments(
  value: unknown,
): { ok: true; text: string } | { ok: false } {
  const record = asRecord(value)
  if (!record) {
    return { ok: false }
  }
  if (Object.keys(record).some((key) => key !== 'text')) {
    return { ok: false }
  }
  if (typeof record.text !== 'string') {
    return { ok: false }
  }

  const text = normalizeNullableString(record.text)
  if (!text || text.length > MAX_PROGRESS_CHARS) {
    return { ok: false }
  }

  return {
    ok: true,
    text,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeNullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
