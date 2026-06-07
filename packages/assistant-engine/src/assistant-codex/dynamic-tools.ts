import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import { MAX_PROGRESS_CHARS } from '../assistant/progress-constants.js'
import type {
  CodexRpcMessage,
} from './app-server-rpc.js'

export const MURPH_SEND_PROGRESS_UPDATE_TOOL = {
  namespace: 'murph',
  name: 'send_progress_update',
  description:
    'Send a brief, natural user-visible progress update to the current conversation before longer, tool-heavy, or user-content-inspection work. Use immediately as the first assistant action when the task may take more than a few seconds, require multiple tool steps, involve research or long vault scans, inspect/parse/render/import/save user-provided content, or recover data from PDFs, lab reports, images, screenshots, CSVs, large pasted text, meal/product/supplement labels, workout exports, wearable exports, or health documents. If the turn remains long-running after substantial tool work, you may send another brief update so the user is not left hanging, up to three total progress updates in the turn. Skip automatically transcribed voice memo or audio content unless manual media tools or broader long-running work are needed. Do not use for skill-file reads alone, setup checks, routine single-command vault reads, quick single-step replies, or final conclusions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PROGRESS_CHARS,
        description:
          'One short conversational first-person sentence about the immediate next step, like a quick note to the user. Use contractions when natural. Avoid stiff plan-recitation wording like "I\'m going to..." when a shorter "I\'ll..." or "Taking a look..." works. No markdown links, final answers, lab interpretations, abnormalities, diagnoses, treatment recommendations, or claims not yet verified.',
      },
    },
    required: ['text'],
  },
} as const

const CODEX_DYNAMIC_TOOL_CALL_METHOD = 'item/tool/call'

interface ParsedDynamicToolCallRequest {
  arguments: unknown
  namespace: string | null
  tool: string | null
}

export type MurphDynamicToolRequest =
  | {
      kind: 'invalid-progress-arguments'
    }
  | {
      kind: 'send-progress-update'
      text: string
    }
  | {
      kind: 'unsupported-dynamic-tool'
      namespace: string | null
      tool: string | null
    }

export function readMurphDynamicToolRequest(
  message: CodexRpcMessage,
): MurphDynamicToolRequest | null {
  const request = parseDynamicToolCallRequest(message)
  if (!request) {
    return null
  }

  if (
    request.namespace !== MURPH_SEND_PROGRESS_UPDATE_TOOL.namespace ||
    request.tool !== MURPH_SEND_PROGRESS_UPDATE_TOOL.name
  ) {
    return {
      kind: 'unsupported-dynamic-tool',
      namespace: request.namespace,
      tool: request.tool,
    }
  }

  const parsed = parseSendProgressUpdateArguments(request.arguments)
  if (!parsed.ok) {
    return {
      kind: 'invalid-progress-arguments',
    }
  }

  return {
    kind: 'send-progress-update',
    text: parsed.text,
  }
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
