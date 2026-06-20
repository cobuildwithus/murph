import { z } from 'zod'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateVoiceMemoTool,
  type AssistantDynamicToolRuntime,
  type GenerateVoiceMemoToolArgs,
} from '../generate-voice-memo-tool.js'

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
    },
    required: ['text'],
  },
} as const

const generateVoiceMemoArgumentsSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    voiceId: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

export function parseGenerateVoiceMemoArguments(
  value: unknown,
):
  | { ok: true; args: GenerateVoiceMemoToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = generateVoiceMemoArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildSafeToolCallValidationDigest({
        error: parsed.error,
        rawInput: value,
        requestedToolName: 'murph.generate_voice_memo',
        schemaName: 'murph.generate_voice_memo.input',
        schemaRootKeys: Object.keys(generateVoiceMemoArgumentsSchema.shape),
        toolName: 'murph.generate_voice_memo',
      }),
    }
  }
  return {
    args: parsed.data,
    ok: true,
  }
}

export async function executeGenerateVoiceMemoDynamicTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  dynamicToolRuntime?: AssistantDynamicToolRuntime | null
}): Promise<{
  responseMediaPatch?: {
    media: AssistantResponseMedia[]
    op: 'append'
  }
  rpcResult: {
    contentItems: { text: string; type: 'inputText' }[]
    success: boolean
  }
  usageDraft: null
}> {
  if (hasVoiceMemoResponseMedia(input.currentResponseMedia ?? [])) {
    return voiceMemoTextResult(false, 'voice memo already attached')
  }
  if ((input.currentResponseMedia ?? []).length > 0) {
    return voiceMemoTextResult(
      false,
      'voice memo generation cannot be combined with other response media',
    )
  }

  const result = await executeGenerateVoiceMemoTool({
    abortSignal: input.abortSignal ?? null,
    args: input.args,
    currentResponseMedia: input.currentResponseMedia ?? [],
    runtime: input.dynamicToolRuntime?.voiceMemo ?? null,
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
    usageDraft: null,
  }
}

function voiceMemoTextResult(
  success: boolean,
  text: string,
): {
  rpcResult: {
    contentItems: { text: string; type: 'inputText' }[]
    success: boolean
  }
  usageDraft: null
} {
  return {
    rpcResult: {
      success,
      contentItems: [{ type: 'inputText', text }],
    },
    usageDraft: null,
  }
}

function hasVoiceMemoResponseMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some((item) => item.kind === 'voice_memo')
}
