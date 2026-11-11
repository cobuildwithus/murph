import type { GeneratedMediaFileRuntime } from '../generated-media-file.js'
import * as z from '@murphai/contracts/zod-runtime'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateSongTool,
  type GenerateSongToolArgs,
  type VoiceMemoPhaseTimingRecorder,
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
  deferLoading: true,
  description: [
    'Generate one original song or instrumental and attach it to your final response as a voice memo. It is delivered with the reply.',
    'Call it when the current user asks for music, or when the flow that owns this turn calls for a song. Reading the music skill is never a reason by itself to make a song.',
    'On an ordinary conversation turn, read `$MURPH_ASSISTANT_SKILLS_ROOT/music-generation/SKILL.md` before calling. A flow that supplies its own complete song instructions, or forbids other tools, needs no skill read.',
    'Keep the subject, lyrics, style, instrumentation, mood, vocal direction, and instrumental choice the user asked for.',
    'Build the prompt only from what the user supplied or asked you to use, with no unrelated private context and no sensitive or embarrassing personal details.',
    'Describe a real artist, song, show, or franchise as generic musical traits, and never pass the name or copied lyrics.',
    'The result is a text receipt and the audio is already attached, so an error while displaying the receipt does not undo the attachment and is no reason to generate again.',
    'When the user asked only for the song, leave the final text empty unless the owning flow needs text with it.',
    'In an authorized recap, output=file writes the song to an MP3 file and returns its path; nothing is attached. Use durationSeconds=20.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      output: { type: 'string', enum: ['chat', 'file'] },
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
    output: z.enum(['chat', 'file']).optional(),
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
  env?: NodeJS.ProcessEnv
  fileRuntime?: GeneratedMediaFileRuntime | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  recordPhaseTiming?: VoiceMemoPhaseTimingRecorder | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<DynamicToolResult> {
  return wrapVoiceMemoToolResult(
    await executeGenerateSongTool({
      abortSignal: input.abortSignal ?? null,
      args: input.args,
      env: input.env,
      fileRuntime: input.fileRuntime,
      currentResponseMedia: input.currentResponseMedia ?? [],
      recordPhaseTiming: input.recordPhaseTiming ?? null,
      runtime: input.voiceMemoRuntime ?? null,
    }),
  )
}
