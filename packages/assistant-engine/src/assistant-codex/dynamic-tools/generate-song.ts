import { z } from 'zod'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateSongTool,
  type GenerateSongToolArgs,
  type VoiceMemoToolRuntime,
} from '../generate-voice-memo-tool.js'
import {
  parseDynamicToolArguments,
  wrapVoiceMemoToolResult,
  type DynamicToolResult,
} from './dynamic-tool-wrapper.js'

export const MURPH_GENERATE_SONG_TOOL = {
  namespace: 'murph',
  name: 'generate_song',
  description:
    'Generate one original song or instrumental track using ElevenLabs and attach it as a native voice memo to the final response. Use when the user explicitly asks for generated music or a song, or as a brief personalized musical nudge for an eligible reminder, habit, or behavior-change experiment when a playful musical intervention may increase follow-through on a low-stakes action; it is not intended for every reminder. Default to an upbeat reggae groove when the user has no known genre preference and no other genre is a clearly better contextual fit. Keep the song short, state the requested action unmistakably, explain its personal benefit, and incorporate at most two supplied non-sensitive personal details. Do not invent personal details, shame the user, or expose information that could be embarrassing if the audio were overheard. Put requested lyrics, subject, style, instrumentation, mood, and vocal direction in prompt. If the user asks only for the song, attach it and leave final response text empty. This does not send directly.',
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
  return parseDynamicToolArguments({
    schema: generateSongArgumentsSchema,
    toolName: 'murph.generate_song',
    value,
  })
}

export async function executeGenerateSongDynamicTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateSongToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<DynamicToolResult> {
  return wrapVoiceMemoToolResult(
    await executeGenerateSongTool({
      abortSignal: input.abortSignal ?? null,
      args: input.args,
      currentResponseMedia: input.currentResponseMedia ?? [],
      runtime: input.voiceMemoRuntime ?? null,
    }),
  )
}
