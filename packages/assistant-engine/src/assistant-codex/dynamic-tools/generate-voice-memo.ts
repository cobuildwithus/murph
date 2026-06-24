import { z } from 'zod'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateVoiceMemoTool,
  type GenerateVoiceMemoToolArgs,
  type VoiceMemoToolRuntime,
} from '../generate-voice-memo-tool.js'
import {
  parseDynamicToolArguments,
  wrapVoiceMemoToolResult,
  type DynamicToolResult,
} from './voice-memo-tool-wrapper.js'

export const MURPH_GENERATE_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_voice_memo',
  description:
    'Generate one short voice memo using ElevenLabs and attach it to the final assistant response. Use it when the user clearly prefers voice, when a loaded Murph skill or product flow explicitly asks for a voice memo, or when voice itself adds useful tone, pacing, or presence. Otherwise prefer text. Defaults to Murph’s configured voice. Use voiceId only when the user explicitly asks for a different voice. If the user asks for voice memos only, attach the voice memo and leave the final response text empty. This does not send directly.',
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
  return parseDynamicToolArguments({
    schema: generateVoiceMemoArgumentsSchema,
    toolName: 'murph.generate_voice_memo',
    value,
  })
}

export async function executeGenerateVoiceMemoDynamicTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<DynamicToolResult> {
  return wrapVoiceMemoToolResult(
    await executeGenerateVoiceMemoTool({
      abortSignal: input.abortSignal ?? null,
      args: input.args,
      currentResponseMedia: input.currentResponseMedia ?? [],
      runtime: input.voiceMemoRuntime ?? null,
    }),
  )
}
