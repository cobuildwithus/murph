import { z } from 'zod'

import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import type { GenerateImageToolArgs } from '../generate-image-tool.js'
import type {
  GenerateSongToolArgs,
  GenerateVoiceMemoToolArgs,
} from '../generate-voice-memo-tool.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const scheduledImageArgumentsSchema = z.object({
  alt: z.string().trim().min(1).max(300),
  outputFormat: z.enum(['webp', 'png', 'jpeg']).default('webp'),
  prompt: z.string().trim().min(1).max(3000),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024'),
}).strict()

const scheduledVoiceMemoArgumentsSchema = z.object({
  text: z.string().trim().min(1).max(2000),
}).strict()

const scheduledSongArgumentsSchema = z.object({
  durationSeconds: z.number().int().min(3).max(60).default(30),
  instrumental: z.boolean().default(false),
  prompt: z.string().trim().min(1).max(3000),
}).strict()

export const MURPH_GENERATE_SCHEDULED_IMAGE_TOOL = {
  namespace: 'murph',
  name: 'generate_scheduled_image',
  description:
    'Generate one task-bound image for the exact current scheduled group challenge. Supply only a bounded prompt, alt text, output format, quality, and size. References, URLs, paths, IDs, selectors, commands, tokens, and credentials are not accepted. Participant and Murph likeness references are intentionally unavailable. This attaches media to the current response and does not send directly.',
  inputSchema: z.toJSONSchema(scheduledImageArgumentsSchema, { io: 'input' }),
} as const

export const MURPH_GENERATE_SCHEDULED_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_scheduled_voice_memo',
  description:
    'Generate one task-bound voice memo for the exact current scheduled group challenge. Supply only the exact bounded text to speak. The configured Murph voice is fixed by the trusted runtime; voice IDs, targets, paths, URLs, commands, tokens, and credentials are not accepted. This attaches media to the current response and does not send directly.',
  inputSchema: z.toJSONSchema(scheduledVoiceMemoArgumentsSchema, { io: 'input' }),
} as const

export const MURPH_GENERATE_SCHEDULED_SONG_TOOL = {
  namespace: 'murph',
  name: 'generate_scheduled_song',
  description:
    'Generate one short task-bound original song or instrumental for the exact current scheduled group challenge. Supply only a bounded prompt, duration, and instrumental choice. Targets, paths, URLs, IDs, commands, tokens, and credentials are not accepted. This attaches media to the current response and does not send directly.',
  inputSchema: z.toJSONSchema(scheduledSongArgumentsSchema, { io: 'input' }),
} as const

export interface ScheduledMediaGenerationClaimState {
  audioGenerationClaimed: boolean
  imageGenerationClaims: number
}

export type ScheduledMediaGenerationClaimResult =
  | 'claimed'
  | 'limit_reached'
  | 'occurrence_reserved'

export async function claimScheduledMediaGeneration(
  state: ScheduledMediaGenerationClaimState,
  kind: 'audio' | 'image',
  reserve: (
    kind: 'audio' | 'image',
  ) => Promise<'already_reserved' | 'reserved'>,
): Promise<ScheduledMediaGenerationClaimResult> {
  if (kind === 'image') {
    if (state.audioGenerationClaimed || state.imageGenerationClaims >= 4) {
      return 'limit_reached'
    }
    if (
      state.imageGenerationClaims === 0 &&
      await reserve('image') !== 'reserved'
    ) {
      return 'occurrence_reserved'
    }
    state.imageGenerationClaims += 1
    return 'claimed'
  }
  if (state.audioGenerationClaimed || state.imageGenerationClaims > 0) {
    return 'limit_reached'
  }
  if (await reserve('audio') !== 'reserved') {
    return 'occurrence_reserved'
  }
  state.audioGenerationClaimed = true
  return 'claimed'
}

export type ScheduledMediaDynamicToolRequest =
  | {
      args: GenerateImageToolArgs
      kind: 'generate-scheduled-image'
      toolCallId?: string
    }
  | {
      args: GenerateVoiceMemoToolArgs
      kind: 'generate-scheduled-voice-memo'
    }
  | {
      args: GenerateSongToolArgs
      kind: 'generate-scheduled-song'
    }
  | {
      kind:
        | 'invalid-generate-scheduled-image-arguments'
        | 'invalid-generate-scheduled-voice-memo-arguments'
        | 'invalid-generate-scheduled-song-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledMediaDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
  toolCallId?: string | null
}): ScheduledMediaDynamicToolRequest | null {
  switch (input.tool) {
    case MURPH_GENERATE_SCHEDULED_IMAGE_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: scheduledImageArgumentsSchema,
        schemaRootKeys: ['alt', 'outputFormat', 'prompt', 'quality', 'size'],
        toolName: 'murph.generate_scheduled_image',
        value: input.arguments,
      })
      return parsed.ok
        ? {
            args: {
              ...parsed.args,
              referenceImageRefs: [],
            },
            kind: 'generate-scheduled-image',
            ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          }
        : {
            kind: 'invalid-generate-scheduled-image-arguments',
            validationDigest: parsed.validationDigest,
          }
    }
    case MURPH_GENERATE_SCHEDULED_VOICE_MEMO_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: scheduledVoiceMemoArgumentsSchema,
        schemaRootKeys: ['text'],
        toolName: 'murph.generate_scheduled_voice_memo',
        value: input.arguments,
      })
      return parsed.ok
        ? {
            args: {
              text: parsed.args.text,
              voiceId: null,
            },
            kind: 'generate-scheduled-voice-memo',
          }
        : {
            kind: 'invalid-generate-scheduled-voice-memo-arguments',
            validationDigest: parsed.validationDigest,
          }
    }
    case MURPH_GENERATE_SCHEDULED_SONG_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: scheduledSongArgumentsSchema,
        schemaRootKeys: ['durationSeconds', 'instrumental', 'prompt'],
        toolName: 'murph.generate_scheduled_song',
        value: input.arguments,
      })
      return parsed.ok
        ? {
            args: parsed.args,
            kind: 'generate-scheduled-song',
          }
        : {
            kind: 'invalid-generate-scheduled-song-arguments',
            validationDigest: parsed.validationDigest,
          }
    }
    default:
      return null
  }
}
