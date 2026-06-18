import { z } from 'zod'
import {
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import type {
  AssistantHostedGeneratedImageUploader,
} from '../assistant/execution-context.js'
import type {
  AssistantProviderUsageDraft,
} from '../assistant/providers/types.js'
import { normalizeAssistantResponseMediaList } from '../assistant/response-media.js'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../assistant/tool-validation-digest.js'
import type {
  AssistantProgressDelivery,
} from '../assistant/turn-progress.js'
import type {
  CodexRpcMessage,
} from './app-server-rpc.js'
import {
  executeGenerateImageTool,
  type GenerateImageToolArgs,
} from './generate-image-tool.js'
import {
  executeGenerateVoiceMemoTool,
  type GenerateVoiceMemoToolArgs,
} from './generate-voice-memo-tool.js'

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

export const MURPH_GENERATE_IMAGE_TOOL = {
  namespace: 'murph',
  name: 'generate_image',
  description:
    'Generate one image with GPT Image 2. Hosted runs attach the generated image to the final response; local runs save it under CODEX_HOME/generated_images.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
      },
      size: {
        type: 'string',
        enum: ['1024x1024', '1024x1536', '1536x1024'],
        default: '1024x1024',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      outputFormat: {
        type: 'string',
        enum: ['webp', 'png', 'jpeg'],
        default: 'webp',
      },
      alt: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 500 },
          { type: 'null' },
        ],
        default: null,
      },
    },
    required: ['prompt'],
  },
} as const

export const MURPH_GENERATE_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_voice_memo',
  description:
    'Generate one short voice memo using ElevenLabs and attach it to the final assistant response. Defaults to Murph’s configured voice. Use voiceId only when the user explicitly asks for a different voice. This does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description: 'The exact text to speak in the voice memo.',
      },
      voiceId: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 200 },
          { type: 'null' },
        ],
        default: null,
        description: 'Optional ElevenLabs voice id. Defaults to Murph voice.',
      },
      modelId: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 200 },
          { type: 'null' },
        ],
        default: null,
        description:
          'Optional ElevenLabs model id. Defaults to Murph configured model or eleven_multilingual_v2.',
      },
    },
    required: ['text'],
  },
} as const

export const MURPH_DYNAMIC_TOOLS = [
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
] as const

export function listMurphDynamicToolNames(): string[] {
  return MURPH_DYNAMIC_TOOLS.map((tool) => `${tool.namespace}.${tool.name}`)
}

const CODEX_DYNAMIC_TOOL_CALL_METHOD = 'item/tool/call'

const attachResponseMediaArgumentsSchema = z
  .object({
    media: z.array(z.unknown()).max(40),
  })
  .strict()

const sendProgressUpdateArgumentsSchema = z
  .object({
    text: z.string().trim().min(1),
  })
  .strict()

const generateImageArgumentsSchema = z
  .object({
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    outputFormat: z.enum(['webp', 'png', 'jpeg']).default('webp'),
    prompt: z.string().trim().min(1).max(4000),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024'),
  })
  .strict()

const generateVoiceMemoArgumentsSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200).nullable().default(null),
    text: z.string().trim().min(1).max(4000),
    voiceId: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

export type MurphDynamicToolResponseMediaPatch = {
  media: AssistantResponseMedia[]
  op: 'append' | 'replace'
}

type MurphDynamicToolRpcResult = {
  success: boolean
  contentItems: Array<{
    type: 'inputText'
    text: string
  }>
}

export interface MurphDynamicToolExecutionResult {
  responseMediaPatch?: MurphDynamicToolResponseMediaPatch
  rpcResult: MurphDynamicToolRpcResult
  usageDraft?: AssistantProviderUsageDraft | null
}

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
      kind: 'generate-image'
      args: GenerateImageToolArgs
    }
  | {
      kind: 'generate-voice-memo'
      args: GenerateVoiceMemoToolArgs
    }
  | {
      kind: 'invalid-generate-image-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-generate-voice-memo-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-response-media-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-progress-arguments'
      validationDigest: SafeToolCallValidationDigest
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
          validationDigest: parsed.validationDigest,
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
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'attach-response-media',
        media: parsed.media,
      }
    }
    case MURPH_GENERATE_IMAGE_TOOL.name: {
      const parsed = parseGenerateImageArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-generate-image-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'generate-image',
        args: parsed.args,
      }
    }
    case MURPH_GENERATE_VOICE_MEMO_TOOL.name: {
      const parsed = parseGenerateVoiceMemoArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-generate-voice-memo-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'generate-voice-memo',
        args: parsed.args,
      }
    }
  }

  return {
    kind: 'unsupported-dynamic-tool',
    namespace: request.namespace,
    tool: request.tool,
  }
}

export async function executeMurphDynamicToolRequest(input: {
  abortSignal?: AbortSignal | null
  codexHome?: string | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  nextUsageOrdinal: () => number
  progressDelivery: AssistantProgressDelivery | null
  publicFetchImpl?: typeof fetch | null
  request: MurphDynamicToolRequest
  requireHostedGeneratedImageUploader?: boolean | null
}): Promise<MurphDynamicToolExecutionResult> {
  switch (input.request.kind) {
    case 'invalid-generate-image-arguments':
      return toolTextResult(false, 'invalid image generation arguments')
    case 'invalid-generate-voice-memo-arguments':
      return toolTextResult(false, 'invalid voice memo generation arguments')
    case 'invalid-progress-arguments':
      return toolTextResult(false, 'invalid progress update arguments')
    case 'invalid-response-media-arguments':
      return toolTextResult(false, 'invalid response media arguments')
    case 'unsupported-dynamic-tool':
      return toolTextResult(false, 'unsupported dynamic tool')
    case 'attach-response-media':
      return {
        ...toolTextResult(
          true,
          input.request.media.length === 0
            ? 'response media cleared'
            : `${input.request.media.length} response image${input.request.media.length === 1 ? '' : 's'} attached`,
        ),
        responseMediaPatch: {
          media: input.request.media,
          op: 'replace',
        },
      }
    case 'send-progress-update':
      return await executeProgressUpdateTool({
        progressDelivery: input.progressDelivery,
        text: input.request.text,
      })
    case 'generate-image': {
      const result = await executeGenerateImageTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        codexHome: input.codexHome ?? null,
        env: input.env,
        fetchImpl: input.fetchImpl,
        hostedGeneratedImageUploader: input.hostedGeneratedImageUploader ?? null,
        providerRequestOrdinal: input.nextUsageOrdinal(),
        requireHostedGeneratedImageUploader:
          input.requireHostedGeneratedImageUploader ?? false,
      })
      return {
        ...(result.responseMedia && result.responseMedia.length > 0
          ? {
              responseMediaPatch: {
                media: result.responseMedia,
                op: 'append' as const,
              },
            }
          : {}),
        rpcResult: {
          success: result.rpcSuccess,
          contentItems: [
            {
              type: 'inputText',
              text: result.rpcText,
            },
          ],
        },
        usageDraft: result.usageDraft ?? null,
      }
    }
    case 'generate-voice-memo': {
      const result = await executeGenerateVoiceMemoTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        env: input.env,
        fetchImpl: input.fetchImpl,
        publicFetchImpl: input.publicFetchImpl ?? null,
      })
      return {
        ...(result.responseMedia && result.responseMedia.length > 0
          ? {
              responseMediaPatch: {
                media: result.responseMedia,
                op: 'append' as const,
              },
            }
          : {}),
        rpcResult: {
          success: result.rpcSuccess,
          contentItems: [
            {
              type: 'inputText',
              text: result.rpcText,
            },
          ],
        },
      }
    }
  }
}

async function executeProgressUpdateTool(input: {
  progressDelivery: AssistantProgressDelivery | null
  text: string
}): Promise<MurphDynamicToolExecutionResult> {
  if (!input.progressDelivery) {
    return toolTextResult(false, 'progress updates are not available for this turn')
  }
  try {
    const result = await input.progressDelivery.send(input.text, { source: 'model' })
    if (result.kind === 'sent') {
      return toolTextResult(true, 'progress update sent')
    }
    if (result.kind === 'failed') {
      return toolTextResult(false, 'progress update failed during best-effort delivery')
    }
    if (result.reason === 'limit') {
      return toolTextResult(false, 'progress update skipped: progress update limit reached')
    }
    if (result.reason === 'duplicate') {
      return toolTextResult(false, 'progress update skipped: duplicate progress update')
    }
    return toolTextResult(false, 'progress update skipped: empty progress update')
  } catch {
    return toolTextResult(false, 'progress update failed during best-effort delivery')
  }
}

function toolTextResult(
  success: boolean,
  text: string,
): MurphDynamicToolExecutionResult {
  return {
    rpcResult: {
      success,
      contentItems: [{ type: 'inputText', text }],
    },
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
):
  | { ok: true; text: string }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = sendProgressUpdateArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.send_progress_update.input',
        schemaRootKeys: readZodObjectRootKeys(sendProgressUpdateArgumentsSchema),
        toolName: 'murph.send_progress_update',
      }),
    }
  }

  return {
    ok: true,
    text: parsed.data.text,
  }
}

function parseGenerateImageArguments(
  value: unknown,
):
  | { ok: true; args: GenerateImageToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = generateImageArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.generate_image.input',
        schemaRootKeys: readZodObjectRootKeys(generateImageArgumentsSchema),
        toolName: 'murph.generate_image',
      }),
    }
  }
  return {
    args: parsed.data,
    ok: true,
  }
}

function parseGenerateVoiceMemoArguments(
  value: unknown,
):
  | { ok: true; args: GenerateVoiceMemoToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = generateVoiceMemoArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.generate_voice_memo.input',
        schemaRootKeys: readZodObjectRootKeys(generateVoiceMemoArgumentsSchema),
        toolName: 'murph.generate_voice_memo',
      }),
    }
  }
  return {
    args: parsed.data,
    ok: true,
  }
}

function parseAttachResponseMediaArguments(
  value: unknown,
):
  | { ok: true; media: AssistantResponseMedia[] }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const schemaName = 'murph.attach_response_media.input'
  const toolName = 'murph.attach_response_media'
  try {
    const parsed = attachResponseMediaArgumentsSchema.safeParse(value)
    if (!parsed.success) {
      return {
        ok: false,
        validationDigest: buildDynamicToolValidationDigest({
          error: parsed.error,
          rawInput: value,
          schemaName,
          schemaRootKeys: readZodObjectRootKeys(attachResponseMediaArgumentsSchema),
          toolName,
        }),
      }
    }

    return {
      ok: true,
      media: normalizeAssistantResponseMediaList(parsed.data.media),
    }
  } catch (error) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error,
        rawInput: value,
        schemaName,
        schemaRootKeys: readZodObjectRootKeys(attachResponseMediaArgumentsSchema),
        toolName,
      }),
    }
  }
}

function buildDynamicToolValidationDigest(input: {
  error: unknown
  rawInput: unknown
  schemaName: string
  schemaRootKeys: readonly string[]
  toolName: string
}): SafeToolCallValidationDigest {
  return buildSafeToolCallValidationDigest({
    error: input.error,
    rawInput: input.rawInput,
    requestedToolName: input.toolName,
    schemaName: input.schemaName,
    schemaRootKeys: input.schemaRootKeys,
    toolName: input.toolName,
  })
}

function readZodObjectRootKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeNullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
