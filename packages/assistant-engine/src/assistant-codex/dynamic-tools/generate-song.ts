import * as z from '@murphai/contracts/zod-runtime'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantGenerateSongTurnPolicy,
} from '../../assistant/providers/types.js'
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
  description: [
    'Generate one original song or instrumental track and attach it as a native voice memo to the final response.',
    'Use only when the current user explicitly requests generated music or an admitted loaded skill or owning flow explicitly authorizes a song for this turn.',
    'On ordinary conversation turns, read `$MURPH_ASSISTANT_SKILLS_ROOT/music-generation/SKILL.md` before calling. In an isolated owning flow that forbids other tools or supplies its complete song contract, follow that owning prompt directly instead of attempting a skill read.',
    'The active skill owns song eligibility, selection, and prompt-craft policy. This public tool contract does not create consent, grant access to private context, or widen route or delivery authority.',
    'Ground every prompt only in current authorized context and admitted tool results.',
    'Translate requests to sound like a real artist, song, show, or franchise into generic musical traits; never pass the protected name or copied lyrics to the generator.',
    'Never include sensitive or potentially embarrassing personal details.',
    'If the user asks only for the song, attach it and leave final response text empty unless an owning flow requires accompanying text.',
    'This does not send directly.',
  ].join(' '),
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

export interface GenerateSongTurnState {
  attemptCount: number
  policy: AssistantGenerateSongTurnPolicy
}

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
  turnState?: GenerateSongTurnState | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<DynamicToolResult> {
  const turnState = input.turnState ?? null
  if (turnState) {
    if (turnState.attemptCount >= turnState.policy.maxAttempts) {
      return wrapVoiceMemoToolResult({
        rpcSuccess: false,
        rpcText:
          'song generation attempt limit reached for this turn; no song ran',
      })
    }
    turnState.attemptCount += 1
  }

  return wrapVoiceMemoToolResult(
    await executeGenerateSongTool({
      abortSignal: input.abortSignal ?? null,
      args: turnState
        ? {
            ...input.args,
            durationSeconds: turnState.policy.requiredDurationSeconds,
          }
        : input.args,
      currentResponseMedia: input.currentResponseMedia ?? [],
      runtime: input.voiceMemoRuntime ?? null,
    }),
  )
}
