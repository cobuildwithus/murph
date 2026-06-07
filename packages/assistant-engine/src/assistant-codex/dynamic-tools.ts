import { z } from 'zod'
import {
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import { normalizeAssistantResponseMediaList } from '../assistant/response-media.js'
import type {
  CodexRpcMessage,
} from './app-server-rpc.js'

export const MURPH_SEND_PROGRESS_UPDATE_TOOL = {
  namespace: 'murph',
  name: 'send_progress_update',
  description:
    'Send a brief, natural user-visible progress update to the current conversation before longer, tool-heavy, or substantial user-content-inspection work. Use immediately as the first assistant action when the task may take more than a few seconds, require multiple tool steps, involve research or long vault scans, or recover substantial data from PDFs, lab reports, images, screenshots, CSVs, large pasted text, meal/product/supplement labels, workout exports, wearable exports, or health documents. If the turn remains long-running after substantial tool work, you may send another brief update so the user is not left hanging, up to three total progress updates in the turn. Skip automatically transcribed voice memo or audio content unless manual media tools or broader long-running work are needed. Do not use for skill-file reads alone, setup checks, routine single-command vault reads, quick single-step replies, one-shot logging/capture/memory saves that only need a straightforward write, or final conclusions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        description:
          'One to three short conversational first-person sentences about the immediate next step, like a quick note to the user. Use contractions when natural. Avoid stiff plan-recitation wording like "I\'m going to..." when a shorter "I\'ll..." or "Taking a look..." works. No markdown links, final answers, lab interpretations, abnormalities, diagnoses, treatment recommendations, or claims not yet verified.',
      },
    },
    required: ['text'],
  },
} as const

export const MURPH_ATTACH_RESPONSE_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'attach_response_media',
  description:
    'Attach image media to the current final assistant response. Replaces the current response media batch for this turn only. It does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      media: {
        type: 'array',
        maxItems: 40,
        description:
          'The complete image batch for the final assistant reply. Passing an empty array clears the current reply media batch.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: ['image'],
              description: 'Only image response media is supported.',
            },
            url: {
              type: 'string',
              description:
                'Public HTTPS image-file URL. URLs with credentials, query strings, fragments, localhost hosts, IP literals, or non-image extensions are rejected.',
            },
            alt: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 500 },
                { type: 'null' },
              ],
              description: 'Optional alt text for the image.',
            },
            source: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 200 },
                { type: 'null' },
              ],
              description: 'Optional catalog item id or source label.',
            },
          },
          required: ['url'],
        },
      },
    },
    required: ['media'],
  },
} as const

export const MURPH_DYNAMIC_TOOLS = [
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
] as const

const CODEX_DYNAMIC_TOOL_CALL_METHOD = 'item/tool/call'

const attachResponseMediaArgumentsSchema = z
  .object({
    media: z.array(z.unknown()).max(40),
  })
  .strict()

interface ParsedDynamicToolCallRequest {
  arguments: unknown
  namespace: string | null
  tool: string | null
}

export type MurphDynamicToolRequest =
  | {
      kind: 'attach-response-media'
      media: AssistantResponseMedia[]
    }
  | {
      kind: 'invalid-response-media-arguments'
    }
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

function isMurphDynamicToolNamespace(namespace: string | null): boolean {
  return namespace === MURPH_SEND_PROGRESS_UPDATE_TOOL.namespace
}

export function readMurphDynamicToolRequest(
  message: CodexRpcMessage,
): MurphDynamicToolRequest | null {
  const request = parseDynamicToolCallRequest(message)
  if (!request) {
    return null
  }

  if (!isMurphDynamicToolNamespace(request.namespace)) {
    return {
      kind: 'unsupported-dynamic-tool',
      namespace: request.namespace,
      tool: request.tool,
    }
  }

  switch (request.tool) {
    case MURPH_SEND_PROGRESS_UPDATE_TOOL.name: {
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
    case MURPH_ATTACH_RESPONSE_MEDIA_TOOL.name: {
      const parsed = parseAttachResponseMediaArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-response-media-arguments',
        }
      }

      return {
        kind: 'attach-response-media',
        media: parsed.media,
      }
    }
  }

  return {
    kind: 'unsupported-dynamic-tool',
    namespace: request.namespace,
    tool: request.tool,
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
  if (!text) {
    return { ok: false }
  }

  return {
    ok: true,
    text,
  }
}

function parseAttachResponseMediaArguments(
  value: unknown,
): { ok: true; media: AssistantResponseMedia[] } | { ok: false } {
  try {
    const parsed = attachResponseMediaArgumentsSchema.safeParse(value)
    if (!parsed.success) {
      return { ok: false }
    }

    return {
      ok: true,
      media: normalizeAssistantResponseMediaList(parsed.data.media),
    }
  } catch {
    return { ok: false }
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
