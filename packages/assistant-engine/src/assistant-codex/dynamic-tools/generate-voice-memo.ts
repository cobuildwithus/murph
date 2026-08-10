import * as z from '@murphai/contracts/zod-runtime'

import {
  assistantVoiceOptionIdSchema,
  assistantVoiceOptionIdValues,
  assistantVoiceOptions,
} from '@murphai/contracts'
import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { ELEVENLABS_TTS_MAX_TEXT_LENGTH } from '@murphai/operator-config/elevenlabs-runtime'
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
} from './dynamic-tool-wrapper.js'

const voiceRosterDescription = assistantVoiceOptions
  .map((option) => `${option.label}=${option.id}`)
  .join(', ')

export const MURPH_GENERATE_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_voice_memo',
  description:
    'Generate one short voice memo using ElevenLabs and attach it to the final assistant response. Use it only when the user requests voice, a known preference supports voice, or when a loaded Murph skill or product flow explicitly asks for a voice memo and marks voice welcome and privacy-safe. Otherwise prefer text. Defaults to Murph’s voice configured for the running turn. Use voice only for a one-off override from the Murph voice roster when the user explicitly asks for a named voice; voice is a roster id, never an ElevenLabs voice id. Do not persist a one-off voice request. A murph.personalization voice update starts on a later turn, so when the user asks to save a voice and hear it immediately, save it and pass that same roster voice here. Final response text is optional. Leave it empty when the memo fully carries the reply, the user asked for voice only, or the owning skill or product flow marks the response voice-only. When leaving it empty, finish with an empty final assistant message and do not call murph.finish_without_reply after attaching the memo. Add accompanying text only when it contributes distinct necessary information, the owning flow explicitly requires it, or the user explicitly asks for both audio and text; otherwise do not duplicate the memo transcript in text. For a voice-only Linq/iMessage response, do not call murph.select_reply_target because native reply targeting requires accompanying text. This does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: ELEVENLABS_TTS_MAX_TEXT_LENGTH,
        description: 'The exact text to speak in the voice memo.',
      },
      voice: {
        anyOf: [
          { type: 'string', enum: [...assistantVoiceOptionIdValues] },
          { type: 'null' },
        ],
        default: null,
        description:
          `Optional one-off Murph voice roster id. Omit it to use the voice configured for the running turn. Available voices: ${voiceRosterDescription}.`,
      },
    },
    required: ['text'],
  },
} as const

const generateVoiceMemoArgumentsSchema = z
  .object({
    text: z.string().trim().min(1).max(ELEVENLABS_TTS_MAX_TEXT_LENGTH),
    voice: assistantVoiceOptionIdSchema.nullable().default(null),
  })
  .strict()

export function parseGenerateVoiceMemoArguments(
  value: unknown,
):
  | { ok: true; args: GenerateVoiceMemoToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = parseDynamicToolArguments({
    schema: generateVoiceMemoArgumentsSchema,
    toolName: 'murph.generate_voice_memo',
    value,
  })
  if (!parsed.ok) {
    return parsed
  }

  return {
    ok: true,
    args: {
      text: parsed.args.text,
      voiceId: null,
      voiceOptionId: parsed.args.voice,
    },
  }
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
