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
    'Generate one original song or instrumental track using ElevenLabs and attach it as a native voice memo to the final response. Use when the user explicitly asks for generated music or a song, when a loaded skill or product flow explicitly calls for a song (for example a group-chat intro or challenge dispatch), or as a brief personalized musical nudge only when a known preference or the automation instructions mark music welcome and privacy-safe. It is not intended for every reminder, and onboarding never triggers music automatically. Default to an upbeat reggae groove when the user has no known genre preference and no other genre is a clearly better contextual fit. Keep the song short, state the requested action unmistakably, explain its personal benefit, and incorporate at most two supplied non-sensitive personal details. Do not invent personal details, shame the user, or expose information that could be embarrassing if the audio were overheard. Put requested lyrics, subject, style, instrumentation, mood, and vocal direction in prompt. If the user asks only for the song, attach it and leave final response text empty unless an owning flow requires accompanying text. This does not send directly.',
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

export const MURPH_RESPONSE_AUDIO_GENERATE_SONG_TOOL = {
  namespace: 'murph',
  name: 'generate_song',
  description:
    'Generate one original, copyright-safe 5–15-second song or instrumental for this existing group conversation and attach it as a native voice memo to the final response. Set durationSeconds explicitly between 5 and 15. Keep lyrics to at most four short lines. Never imitate or name a real artist, band, or song, and never copy lyrics. Use only group-safe details from the supplied recent history; do not expose private health, account, payment, or contributor identity. Do not ask anyone to take an action, spend money, or follow a link. This does not send directly.',
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
        minimum: 5,
        maximum: 15,
      },
      instrumental: {
        type: 'boolean',
        default: false,
      },
    },
    required: ['prompt', 'durationSeconds'],
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
