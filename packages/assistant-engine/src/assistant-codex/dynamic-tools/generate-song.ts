import { z } from 'zod'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateSongTool,
  type GenerateSongToolArgs,
  type VoiceMemoToolRuntime,
} from '../generate-voice-memo-tool.js'

export const MURPH_GENERATE_SONG_TOOL = {
  namespace: 'murph',
  name: 'generate_song',
  description:
    'Generate one original song or instrumental track using ElevenLabs and attach it as a native voice memo to the final response. Use only when the user explicitly asks for generated music or a song. Put requested lyrics, subject, style, instrumentation, mood, and vocal direction in prompt. If the user asks only for the song, attach it and leave final response text empty. This does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4100,
      },
      durationSeconds: {
        type: 'integer',
        minimum: 3,
        maximum: 300,
        default: 30,
      },
      instrumental: {
        type: 'boolean',
        default: false,
      },
    },
    required: ['prompt'],
  },
} as const

const generateSongArgumentsSchema = z
  .object({
    durationSeconds: z.number().int().min(3).max(300).default(30),
    instrumental: z.boolean().default(false),
    prompt: z.string().trim().min(1).max(4100),
  })
  .strict()

export function parseGenerateSongArguments(
  value: unknown,
):
  | { ok: true; args: GenerateSongToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = generateSongArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildSafeToolCallValidationDigest({
        error: parsed.error,
        rawInput: value,
        requestedToolName: 'murph.generate_song',
        schemaName: 'murph.generate_song.input',
        schemaRootKeys: Object.keys(generateSongArgumentsSchema.shape),
        toolName: 'murph.generate_song',
      }),
    }
  }

  return {
    args: parsed.data,
    ok: true,
  }
}

export async function executeGenerateSongDynamicTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateSongToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
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
  const result = await executeGenerateSongTool({
    abortSignal: input.abortSignal ?? null,
    args: input.args,
    currentResponseMedia: input.currentResponseMedia ?? [],
    runtime: input.voiceMemoRuntime ?? null,
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
