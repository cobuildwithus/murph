import { z } from 'zod'
import {
  buildHostedComputerRunOperationPath,
  HOSTED_COMPUTER_FINISH_OUTCOMES,
  HOSTED_COMPUTER_PROFILE_KEYS,
  HOSTED_COMPUTER_RUNS_PATH,
  hostedComputerActRequestSchema,
  hostedComputerDeliveryContextSchema,
  hostedComputerPauseForUserRequestSchema,
  isHostedComputerNavigationUrl,
  type HostedComputerActRequest,
  type HostedComputerDeliveryContext,
  type HostedComputerFinishRunRequest,
  type HostedComputerPauseForUserRequest,
} from '@murphai/hosted-execution/computer-use'
import {
  assistantMessageReactionSchema,
  type AssistantMessageReaction,
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
  type GenerateVoiceMemoToolArgs,
  type VoiceMemoToolRuntime,
} from './generate-voice-memo-tool.js'
import {
  executeGenerateVoiceMemoDynamicTool,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  parseGenerateVoiceMemoArguments,
} from './dynamic-tools/generate-voice-memo.js'

const HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT =
  'computer API outcome is unknown after a transport or browser execution failure; observe the computer run state before retrying a browser action or taking another step'
const HOSTED_COMPUTER_CLEANUP_TIMEOUT_MS = 5_000

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

export const MURPH_FINISH_WITHOUT_REPLY_TOOL = {
  namespace: 'murph',
  name: 'finish_without_reply',
  description:
    'Finish the turn without sending a text reply.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const

export const MURPH_REACT_TO_MESSAGE_TOOL = {
  namespace: 'murph',
  name: 'react_to_message',
  description:
    'React to the current inbound Telegram message. This does not send text and does not finish the turn.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reaction: {
        type: 'string',
        enum: ['heart', 'thumbs_up', 'laugh'],
      },
    },
    required: ['reaction'],
  },
} as const

export const MURPH_COMPUTER_START_RUN_TOOL = {
  namespace: 'murph',
  name: 'computer_start_run',
  description:
    'Start or reuse a Kernel-backed browser run for website tasks such as checkout, appointment booking, login, payment, health/insurance forms, or general web automation.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      profileKey: {
        type: 'string',
        enum: ['commerce', 'appointments', 'default'],
        default: 'default',
      },
      resumeRunId: {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
        default: null,
      },
      startUrl: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        default: null,
      },
    },
  },
} as const

export const MURPH_COMPUTER_OBSERVE_TOOL = {
  namespace: 'murph',
  name: 'computer_observe',
  description:
    'Read the current browser state for a computer run, including URL, title, and visible page text. Use before acting on a resumed run.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      runId: { type: 'string', minLength: 1 },
    },
    required: ['runId'],
  },
} as const

type JsonSchemaObject = Record<string, unknown>

const MURPH_COMPUTER_ACT_INPUT_SCHEMA = buildComputerActInputSchema()

function buildComputerActInputSchema(): JsonSchemaObject {
  const generated = z.toJSONSchema(hostedComputerActRequestSchema, { io: 'input' }) as JsonSchemaObject
  const actionSchemas = Array.isArray(generated.oneOf) ? generated.oneOf : []

  return {
    oneOf: actionSchemas.map(addRunIdToActionSchema),
    type: 'object',
  }
}

function addRunIdToActionSchema(schema: unknown): JsonSchemaObject {
  const record = asRecord(schema) ?? {}
  const properties = asRecord(record.properties) ?? {}
  const required = Array.isArray(record.required)
    ? record.required.filter((item): item is string => typeof item === 'string')
    : []

  return {
    ...record,
    properties: {
      runId: { type: 'string', minLength: 1 },
      ...properties,
    },
    required: ['runId', ...required],
  }
}

export const MURPH_COMPUTER_ACT_TOOL = {
  namespace: 'murph',
  name: 'computer_act',
  description:
    'Run one bounded browser action against the current Kernel browser page for a computer run. Use it for navigation, clicks, form entry, selection, keyboard input, scrolling, and waits. Use computer_observe before the next action when page state is needed.',
  inputSchema: MURPH_COMPUTER_ACT_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_PAUSE_FOR_USER_TOOL = {
  namespace: 'murph',
  name: 'computer_pause_for_user',
  description:
    'Pause a computer run for missing user input or direct user takeover, store a durable checkpoint, optionally create a secure browser handoff link, send the message through the current Murph channel, and return control so the turn can end.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      handoffPurpose: {
        anyOf: [
          {
            type: 'string',
            enum: ['login', 'payment', 'card', 'captcha', 'manual_browser_help'],
          },
          { type: 'null' },
        ],
        default: null,
      },
      message: { type: 'string', minLength: 1, maxLength: 1000 },
      reason: {
        type: 'string',
        enum: ['login_needed', 'payment_needed', 'final_confirmation', 'stuck', 'other'],
      },
      runId: { type: 'string', minLength: 1 },
      suggestedReply: {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
        default: null,
      },
    },
    required: ['runId', 'reason', 'message'],
  },
} as const

export const MURPH_COMPUTER_FINISH_RUN_TOOL = {
  namespace: 'murph',
  name: 'computer_finish_run',
  description:
    'Finish a computer run and close the Kernel browser, persisting profile changes when configured.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outcome: { type: 'string', enum: ['completed', 'failed', 'canceled'] },
      runId: { type: 'string', minLength: 1 },
    },
    required: ['runId', 'outcome'],
  },
} as const

const MURPH_BASE_DYNAMIC_TOOLS = [
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  MURPH_FINISH_WITHOUT_REPLY_TOOL,
  MURPH_REACT_TO_MESSAGE_TOOL,
] as const

const MURPH_COMPUTER_DYNAMIC_TOOLS = [
  MURPH_COMPUTER_START_RUN_TOOL,
  MURPH_COMPUTER_OBSERVE_TOOL,
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_COMPUTER_PAUSE_FOR_USER_TOOL,
  MURPH_COMPUTER_FINISH_RUN_TOOL,
] as const

export const MURPH_DYNAMIC_TOOLS = [
  ...MURPH_BASE_DYNAMIC_TOOLS,
  ...MURPH_COMPUTER_DYNAMIC_TOOLS,
] as const

export type MurphDynamicTool = (typeof MURPH_DYNAMIC_TOOLS)[number]

export function resolveMurphDynamicTools(input: {
  allowFinishWithoutReply?: boolean | null
  allowMessageReactions?: boolean | null
  computerToolsAvailable?: boolean | null
}): readonly MurphDynamicTool[] {
  return MURPH_DYNAMIC_TOOLS.filter((tool) => {
    if (tool === MURPH_FINISH_WITHOUT_REPLY_TOOL) {
      return input.allowFinishWithoutReply !== false
    }

    if (tool === MURPH_REACT_TO_MESSAGE_TOOL) {
      return input.allowMessageReactions === true
    }

    if (
      MURPH_COMPUTER_DYNAMIC_TOOLS.some((computerTool) => computerTool === tool)
    ) {
      return input.computerToolsAvailable === true
    }

    return true
  })
}

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

const finishWithoutReplyArgumentsSchema = z.object({}).strict()

const computerRunIdSchema = z.string().trim().min(1)

const computerNavigationUrlSchema = z
  .string()
  .url()
  .refine(isHostedComputerNavigationUrl, {
    message: 'Hosted computer navigation URLs must use http or https.',
  })

const computerStartRunArgumentsSchema = z
  .object({
    profileKey: z.enum(HOSTED_COMPUTER_PROFILE_KEYS).default('default'),
    resumeAfterMailboxItemId: z.string().trim().min(1).max(200).nullable().default(null),
    resumeDeliveryContext: hostedComputerDeliveryContextSchema.nullable().default(null),
    resumeRunId: z.string().trim().min(1).max(200).nullable().default(null),
    startUrl: computerNavigationUrlSchema.nullable().default(null),
  })
  .strict()

const computerObserveArgumentsSchema = z
  .object({
    runId: computerRunIdSchema,
  })
  .strict()

const computerActArgumentsSchema = z.unknown().transform((value, ctx) => {
  const withRunId = z
    .object({
      runId: computerRunIdSchema,
    })
    .passthrough()
    .safeParse(value)
  if (!withRunId.success) {
    for (const issue of withRunId.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  const { runId, ...body } = withRunId.data
  const parsedBody = hostedComputerActRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    for (const issue of parsedBody.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  return {
    ...parsedBody.data,
    runId,
  }
})

const computerPauseForUserArgumentsSchema = hostedComputerPauseForUserRequestSchema
  .extend({
    runId: computerRunIdSchema,
  })
  .strict()

const computerFinishRunArgumentsSchema = z
  .object({
    outcome: z.enum(HOSTED_COMPUTER_FINISH_OUTCOMES),
    runId: computerRunIdSchema,
  })
  .strict()

const reactToMessageArgumentsSchema = z
  .object({
    reaction: assistantMessageReactionSchema,
  })
  .strict()

export type MurphDynamicToolResponseMediaPatch = {
  media: AssistantResponseMedia[]
  op: 'append' | 'replace'
}

export type MurphDynamicToolFinalActionPatch = {
  kind: 'none'
}

export type MurphDynamicToolReactionPatch = {
  reaction: AssistantMessageReaction
}

type MurphDynamicToolRpcResult = {
  success: boolean
  contentItems: Array<{
    type: 'inputText'
    text: string
  }>
}

type ComputerObserveToolArgs = {
  runId: string
}

type ComputerStartRunToolArgs = z.infer<typeof computerStartRunArgumentsSchema>

type HostedComputerToolPayloadSanitizer =
  | 'act'
  | 'finish'
  | 'observe'
  | 'start'

export interface MurphDynamicToolExecutionResult {
  computerRunPausedForUser?: boolean
  finalActionPatch?: MurphDynamicToolFinalActionPatch
  reactionPatch?: MurphDynamicToolReactionPatch
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
      kind: 'computer-start-run'
      args: ComputerStartRunToolArgs
    }
  | {
      kind: 'computer-observe'
      args: ComputerObserveToolArgs
    }
  | {
      kind: 'computer-act'
      args: HostedComputerActRequest & { runId: string }
    }
  | {
      kind: 'computer-pause-for-user'
      args: HostedComputerPauseForUserRequest & { runId: string }
    }
  | {
      kind: 'computer-finish-run'
      args: HostedComputerFinishRunRequest & { runId: string }
    }
  | {
      kind: 'invalid-computer-arguments'
      validationDigest: SafeToolCallValidationDigest
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
      kind: 'invalid-finish-without-reply-arguments'
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
      kind: 'invalid-reaction-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'send-progress-update'
      text: string
    }
  | {
      kind: 'react-to-message'
      reaction: AssistantMessageReaction
    }
  | {
      kind: 'finish-without-reply'
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
    case MURPH_FINISH_WITHOUT_REPLY_TOOL.name: {
      const parsed = parseFinishWithoutReplyArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-finish-without-reply-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'finish-without-reply',
      }
    }
    case MURPH_REACT_TO_MESSAGE_TOOL.name: {
      const parsed = parseReactToMessageArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-reaction-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'react-to-message',
        reaction: parsed.reaction,
      }
    }
    case MURPH_COMPUTER_START_RUN_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerStartRunArgumentsSchema,
        schemaName: 'murph.computer_start_run.input',
        toolName: 'murph.computer_start_run',
      })
      return parsed.ok
        ? { kind: 'computer-start-run', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_OBSERVE_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerObserveArgumentsSchema,
        schemaName: 'murph.computer_observe.input',
        toolName: 'murph.computer_observe',
      })
      return parsed.ok
        ? { kind: 'computer-observe', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_ACT_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerActArgumentsSchema,
        schemaName: 'murph.computer_act.input',
        schemaRootKeys: [
          'runId',
          'action',
          'url',
          'locator',
          'value',
          'text',
          'key',
          'deltaX',
          'deltaY',
          'delayMs',
          'ms',
          'state',
          'timeoutMs',
        ],
        toolName: 'murph.computer_act',
      })
      return parsed.ok
        ? { kind: 'computer-act', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_PAUSE_FOR_USER_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerPauseForUserArgumentsSchema,
        schemaName: 'murph.computer_pause_for_user.input',
        toolName: 'murph.computer_pause_for_user',
      })
      return parsed.ok
        ? { kind: 'computer-pause-for-user', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_FINISH_RUN_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerFinishRunArgumentsSchema,
        schemaName: 'murph.computer_finish_run.input',
        toolName: 'murph.computer_finish_run',
      })
      return parsed.ok
        ? { kind: 'computer-finish-run', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
  }

  return {
    kind: 'unsupported-dynamic-tool',
    namespace: request.namespace,
    tool: request.tool,
  }
}

export function isComputerDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  switch (request.kind) {
    case 'computer-start-run':
    case 'computer-observe':
    case 'computer-act':
    case 'computer-pause-for-user':
    case 'computer-finish-run':
    case 'invalid-computer-arguments':
      return true
    default:
      return false
  }
}

function isExecutableComputerDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  switch (request.kind) {
    case 'computer-start-run':
    case 'computer-observe':
    case 'computer-act':
    case 'computer-pause-for-user':
    case 'computer-finish-run':
      return true
    default:
      return false
  }
}

function canExecuteComputerDynamicTools(
  progressDelivery: AssistantProgressDelivery | null,
): boolean {
  return progressDelivery?.hostedComputerToolsAvailable === true
}

function currentHostedMailboxItemId(
  progressDelivery: AssistantProgressDelivery | null,
): string | null {
  const itemIds = progressDelivery?.currentHostedMailboxItemIds?.() ?? []
  return itemIds[itemIds.length - 1] ?? null
}

function currentHostedDeliveryContext(
  progressDelivery: AssistantProgressDelivery | null,
): HostedComputerDeliveryContext | null {
  return progressDelivery?.currentHostedDeliveryContext?.() ?? null
}

export async function executeMurphDynamicToolRequest(input: {
  abortSignal?: AbortSignal | null
  codexHome?: string | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  nextUsageOrdinal: () => number
  progressDelivery: AssistantProgressDelivery | null
  publicFetchImpl?: typeof fetch | null
  request: MurphDynamicToolRequest
  requireHostedGeneratedImageUploader?: boolean | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<MurphDynamicToolExecutionResult> {
  if (
    isExecutableComputerDynamicToolRequest(input.request) &&
    !canExecuteComputerDynamicTools(input.progressDelivery)
  ) {
    return toolTextResult(
      false,
      'computer tools are unavailable without hosted computer-use transport',
    )
  }

  switch (input.request.kind) {
    case 'invalid-generate-image-arguments':
      return toolTextResult(false, 'invalid image generation arguments')
    case 'invalid-computer-arguments':
      return toolTextResult(false, 'invalid computer tool arguments')
    case 'invalid-generate-voice-memo-arguments':
      return toolTextResult(false, 'invalid voice memo generation arguments')
    case 'invalid-progress-arguments':
      return toolTextResult(false, 'invalid progress update arguments')
    case 'invalid-reaction-arguments':
      return toolTextResult(false, 'invalid reaction arguments')
    case 'invalid-finish-without-reply-arguments':
      return toolTextResult(false, 'invalid no-reply arguments')
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
    case 'finish-without-reply':
      return {
        ...toolTextResult(true, 'finished without reply'),
        finalActionPatch: {
          kind: 'none',
        },
      }
    case 'react-to-message':
      return {
        ...toolTextResult(true, 'reaction queued'),
        reactionPatch: {
          reaction: input.request.reaction,
        },
      }
    case 'generate-image': {
      if (hasVoiceMemoResponseMedia(input.currentResponseMedia ?? [])) {
        return toolTextResult(false, 'image generation cannot be combined with a voice memo')
      }

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
      return await executeGenerateVoiceMemoDynamicTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        currentResponseMedia: input.currentResponseMedia ?? [],
        voiceMemoRuntime: input.voiceMemoRuntime ?? null,
      })
    }
    case 'computer-start-run':
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body: {
          goal: 'Hosted computer task.',
          ...input.request.args,
          resumeAfterMailboxItemId: input.request.args.resumeRunId
            ? currentHostedMailboxItemId(input.progressDelivery)
            : null,
          resumeDeliveryContext: input.request.args.resumeRunId
            ? currentHostedDeliveryContext(input.progressDelivery)
            : null,
        },
        fetchImpl: input.fetchImpl,
        path: HOSTED_COMPUTER_RUNS_PATH,
        sanitizer: 'start',
        unknownOutcomeOnTransportError: true,
      })
    case 'computer-observe':
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body: {},
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'observe',
          runId: input.request.args.runId,
        }),
        sanitizer: 'observe',
        unknownOutcomeOnTransportError: false,
      })
    case 'computer-act': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body,
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'act',
          runId,
        }),
        sanitizer: 'act',
        unknownOutcomeOnTransportError: true,
      })
    }
    case 'computer-pause-for-user': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerPauseForUserTool({
        abortSignal: input.abortSignal ?? null,
        body: {
          ...body,
          pauseDeliveryContext: currentHostedDeliveryContext(input.progressDelivery),
        } satisfies HostedComputerPauseForUserRequest,
        fetchImpl: input.fetchImpl,
        finishPath: buildHostedComputerRunOperationPath({
          operation: 'finish',
          runId,
        }),
        path: buildHostedComputerRunOperationPath({
          operation: 'pause-for-user',
          runId,
        }),
        progressDelivery: input.progressDelivery,
      })
    }
    case 'computer-finish-run': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body: {
          ...body,
          summary: null,
        },
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'finish',
          runId,
        }),
        sanitizer: 'finish',
        unknownOutcomeOnTransportError: true,
      })
    }
  }
}

function hasVoiceMemoResponseMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some((item) => item.kind === 'voice_memo')
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

async function executeHostedComputerPauseForUserTool(input: {
  abortSignal: AbortSignal | null
  body: HostedComputerPauseForUserRequest
  fetchImpl: typeof fetch
  finishPath: string
  path: string
  progressDelivery: AssistantProgressDelivery | null
}): Promise<MurphDynamicToolExecutionResult> {
  const apiResult = await callHostedComputerApi({
    ...input,
    unknownOutcomeOnTransportError: true,
  })
  if (!apiResult.ok) {
    if (apiResult.unknownOutcome) {
      return await cancelComputerRunAfterPauseDeliveryFailure({
        ...input,
        reason: apiResult.errorText,
      })
    }
    return toolTextResult(false, apiResult.errorText)
  }

  const message = readComputerPauseMessage(apiResult.payload)
  if (!message) {
    return savedComputerPauseDeliveryFailureResult({
      payload: apiResult.payload,
      reason: 'computer pause saved but no channel message was returned',
    })
  }

  if (!input.progressDelivery) {
    return savedComputerPauseDeliveryFailureResult({
      payload: apiResult.payload,
      reason: 'computer pause saved but channel delivery is not available',
    })
  }

  try {
    const delivery = await input.progressDelivery.send(message, {
      required: true,
      source: 'model',
    })
    if (delivery.kind !== 'sent') {
      return savedComputerPauseDeliveryFailureResult({
        payload: apiResult.payload,
        reason: 'computer pause saved but channel delivery failed',
      })
    }
  } catch {
    return savedComputerPauseDeliveryFailureResult({
      payload: apiResult.payload,
      reason: 'computer pause saved but channel delivery failed',
    })
  }

  return toolTextResult(
    true,
    safeToolPayloadText({
      ...readSanitizedComputerPausePayload(apiResult.payload),
      channelMessageSent: true,
    }),
    { computerRunPausedForUser: true },
  )
}

function savedComputerPauseDeliveryFailureResult(input: {
  payload: unknown
  reason: string
}): MurphDynamicToolExecutionResult {
  return toolTextResult(
    false,
    safeToolPayloadText({
      ...readSanitizedComputerPausePayload(input.payload),
      channelMessageSent: false,
      deliveryError: input.reason,
    }),
    { computerRunPausedForUser: true },
  )
}

async function executeHostedComputerApiTool(input: {
  abortSignal: AbortSignal | null
  body: unknown
  fetchImpl: typeof fetch
  path: string
  sanitizer: HostedComputerToolPayloadSanitizer
  unknownOutcomeOnTransportError: boolean
}): Promise<MurphDynamicToolExecutionResult> {
  const apiResult = await callHostedComputerApi(input)
  return apiResult.ok
    ? toolTextResult(true, safeToolPayloadText(sanitizeHostedComputerPayload(
        input.sanitizer,
        apiResult.payload,
      )))
    : toolTextResult(false, apiResult.errorText)
}

async function cancelComputerRunAfterPauseDeliveryFailure(input: {
  abortSignal: AbortSignal | null
  fetchImpl: typeof fetch
  finishPath: string
  reason: string
}): Promise<MurphDynamicToolExecutionResult> {
  const cancelResult = await callHostedComputerApi({
    abortSignal: createHostedComputerCleanupAbortSignal(),
    body: {
      outcome: 'failed',
      summary: null,
    },
    fetchImpl: input.fetchImpl,
    path: input.finishPath,
    unknownOutcomeOnTransportError: true,
  })

  return toolTextResult(
    false,
    cancelResult.ok
      ? `${input.reason}; computer run was canceled`
      : `${input.reason}; computer run cancellation failed: ${cancelResult.errorText}`,
  )
}

function createHostedComputerCleanupAbortSignal(): AbortSignal | null {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(HOSTED_COMPUTER_CLEANUP_TIMEOUT_MS)
    : null
}

async function callHostedComputerApi(input: {
  abortSignal: AbortSignal | null
  body: unknown
  fetchImpl: typeof fetch
  path: string
  unknownOutcomeOnTransportError?: boolean
}): Promise<
  | { ok: true; payload: unknown }
  | { ok: false; errorText: string; unknownOutcome: boolean }
> {
  const payload = JSON.stringify(input.body ?? {})

  try {
    const response = await input.fetchImpl(
      new URL(input.path, 'http://web-control.worker').toString(),
      {
        body: payload,
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: input.abortSignal ?? undefined,
      },
    )

    if (!response.ok) {
      const error = await readHostedComputerApiError({
        response,
        unknownOutcomeOnFailure: input.unknownOutcomeOnTransportError ?? false,
      })
      return {
        errorText: error.text,
        ok: false,
        unknownOutcome: error.unknownOutcome,
      }
    }

    return {
      ok: true,
      payload: await response.json(),
    }
  } catch {
    return {
      errorText: input.unknownOutcomeOnTransportError
        ? HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT
        : 'computer API is unavailable',
      ok: false,
      unknownOutcome: input.unknownOutcomeOnTransportError === true,
    }
  }
}

async function readHostedComputerApiError(input: {
  response: Response
  unknownOutcomeOnFailure: boolean
}): Promise<{ text: string; unknownOutcome: boolean }> {
  const { response } = input
  const fallback = `computer API failed with status ${response.status}`
  try {
    const payload = await response.json()
    const record = asRecord(payload)
    const error = asRecord(record?.error)
    const code = typeof error?.code === 'string' ? error.code : null
    const message = typeof error?.message === 'string' ? error.message : null
    if (isUnknownComputerOutcomeError({
      code,
      status: response.status,
      unknownOutcomeOnFailure: input.unknownOutcomeOnFailure,
    })) {
      return { text: HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT, unknownOutcome: true }
    }
    if (code && message) {
      return { text: `${fallback}: ${code}: ${message}`, unknownOutcome: false }
    }
    if (code) {
      return { text: `${fallback}: ${code}`, unknownOutcome: false }
    }
  } catch {
    // Ignore non-JSON error bodies; hosted web route helpers keep safe details in JSON.
  }

  if (isUnknownComputerOutcomeError({
    code: null,
    status: response.status,
    unknownOutcomeOnFailure: input.unknownOutcomeOnFailure,
  })) {
    return { text: HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT, unknownOutcome: true }
  }

  return { text: fallback, unknownOutcome: false }
}

function isUnknownComputerOutcomeError(input: {
  code: string | null
  status: number
  unknownOutcomeOnFailure: boolean
}): boolean {
  return input.unknownOutcomeOnFailure
    && (input.status >= 500 || input.code === 'HOSTED_COMPUTER_EVAL_FAILED')
}

function readComputerPauseMessage(payload: unknown): string | null {
  const record = asRecord(payload)
  const message = record && typeof record.message === 'string'
    ? normalizeNullableString(record.message)
    : null
  return message
}

function readSanitizedComputerPausePayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload)
  if (!record) {
    return {}
  }

  const runId = typeof record.runId === 'string' ? record.runId : null
  const status = typeof record.status === 'string' ? record.status : null
  const awaitingReason = typeof record.awaitingReason === 'string'
    ? record.awaitingReason
    : null
  const handoffCreated = typeof record.handoffUrl === 'string' && record.handoffUrl.length > 0

  return {
    ...(awaitingReason ? { awaitingReason } : {}),
    handoffCreated,
    ...(runId ? { runId } : {}),
    ...(status ? { status } : {}),
  }
}

function sanitizeHostedComputerPayload(
  sanitizer: HostedComputerToolPayloadSanitizer,
  payload: unknown,
): Record<string, unknown> {
  const record = asRecord(payload)
  if (!record) {
    return {}
  }

  switch (sanitizer) {
    case 'start':
      return {
        ...readStringField(record, 'awaitingReason'),
        ...readStringField(record, 'expiresAt'),
        ...readRedactedTextField(record, 'lastTitle'),
        ...readSanitizedUrlField(record, 'lastUrl'),
        ...readBooleanField(record, 'reused'),
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
      }
    case 'observe':
      return {
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
        ...readRedactedTextField(record, 'title'),
        ...readSanitizedUrlField(record, 'url'),
        visibleText: redactSensitiveToolText(
          typeof record.visibleText === 'string' ? record.visibleText : '',
        ),
        visibleTextRedacted: true,
      }
    case 'act':
      return {
        ...readRedactedTextField(record, 'title'),
        ...readSanitizedUrlField(record, 'url'),
      }
    case 'finish':
      return {
        ...readBooleanField(record, 'ok'),
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
      }
  }
}

function readStringField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = record[field]
  return typeof value === 'string' ? { [field]: value } : {}
}

function readRedactedTextField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = record[field]
  return typeof value === 'string' ? { [field]: redactSensitiveToolText(value) } : {}
}

function readBooleanField(
  record: Record<string, unknown>,
  field: string,
): Record<string, boolean> {
  const value = record[field]
  return typeof value === 'boolean' ? { [field]: value } : {}
}

function readSanitizedUrlField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string | null> {
  const value = record[field]
  if (value === null) {
    return { [field]: null }
  }
  return typeof value === 'string'
    ? { [field]: sanitizeToolUrl(value) }
    : {}
}

function sanitizeToolUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname
      .split('/')
      .map((segment) => isTokenLikeUrlSegment(segment) ? '[redacted]' : segment)
      .join('/')
    return url.toString()
  } catch {
    return '[invalid-url]'
  }
}

function isTokenLikeUrlSegment(segment: string): boolean {
  return segment.length >= 32 && /^[A-Za-z0-9._~-]+$/u.test(segment)
}

function redactSensitiveToolText(value: string): string {
  const bounded = sanitizeToolTextUrls(value.slice(0, 6000))
  const sensitiveLinePattern =
    /authorization|bearer|card|cookie|cvv|password|secret|ssn|token|api[-_\s]*key|access[-_\s]*key|private[-_\s]*key|client[-_\s]*secret|one[-_\s]*time[-_\s]*(?:code|password|passcode)|verification[-_\s]*(?:code|token)|recovery[-_\s]*(?:code|key|phrase)|authenticator|security[-_\s]*(?:code|token)|\botp\b|\b2fa\b|\bmfa\b/iu
  return bounded
    .split(/\r?\n/u)
    .map((line) => sensitiveLinePattern.test(line)
      ? '[redacted-sensitive-line]'
      : line)
    .join('\n')
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]{6,}\b/giu, '[redacted-secret]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/giu, '[redacted-secret]')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/giu, '[redacted-secret]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, '[redacted-secret]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/\b(?:\d[ -]?){13,19}\b/gu, '[redacted-number]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/gu, '[redacted-number]')
}

function sanitizeToolTextUrls(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s"'<>\\]+/giu, (url) => sanitizeToolUrl(url))
}

function safeToolPayloadText(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null'
  if (text.length <= 60_000) {
    return text
  }
  return `${text.slice(0, 60_000)}...`
}

function toolTextResult(
  success: boolean,
  text: string,
  extra?: Pick<MurphDynamicToolExecutionResult, 'computerRunPausedForUser'>,
): MurphDynamicToolExecutionResult {
  return {
    ...extra,
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

function parseFinishWithoutReplyArguments(
  value: unknown,
):
  | { ok: true }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = finishWithoutReplyArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.finish_without_reply.input',
        schemaRootKeys: readZodObjectRootKeys(finishWithoutReplyArgumentsSchema),
        toolName: 'murph.finish_without_reply',
      }),
    }
  }

  return { ok: true }
}

function parseReactToMessageArguments(
  value: unknown,
):
  | { ok: true; reaction: AssistantMessageReaction }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = reactToMessageArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.react_to_message.input',
        schemaRootKeys: readZodObjectRootKeys(reactToMessageArgumentsSchema),
        toolName: 'murph.react_to_message',
      }),
    }
  }

  return {
    ok: true,
    reaction: parsed.data.reaction,
  }
}

function parseComputerArguments<TArgs>(input: {
  argumentsValue: unknown
  schema: z.ZodType<TArgs> & { shape?: Record<string, unknown> }
  schemaName: string
  schemaRootKeys?: readonly string[]
  toolName: string
}):
  | { ok: true; args: TArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = input.schema.safeParse(input.argumentsValue)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: input.argumentsValue,
        schemaName: input.schemaName,
        schemaRootKeys: input.schemaRootKeys ?? readZodObjectRootKeys(input.schema),
        toolName: input.toolName,
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

    const media = normalizeAssistantResponseMediaList(parsed.data.media)
    const unsupportedMedia = media.find((item) => item.kind !== 'image')
    if (unsupportedMedia) {
      throw new Error(
        `murph.attach_response_media only supports image media, received ${unsupportedMedia.kind}.`,
      )
    }

    return {
      ok: true,
      media,
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

function readZodObjectRootKeys(schema: { shape?: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape ?? {})
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeNullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
