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
import {
  collectSafeJsonSchemaValidationPaths,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  executeGenerateVoiceMemoTool,
  type GenerateVoiceMemoToolArgs,
  type VoiceMemoPhaseTimingRecorder,
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
const voiceMemoTextLimitGuidance =
  `Keep it to at most ${ELEVENLABS_TTS_MAX_TEXT_LENGTH.toLocaleString('en-US')} characters, shortening it before you call. Write it in the language the reply would use.`

export const MURPH_GENERATE_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_voice_memo',
  deferLoading: true,
  description: [
    'Generate one short voice memo and attach it to your final response. It is delivered with the reply.',
    'Use it when the user asks for voice, a saved preference supports voice, or a loaded skill or product flow asks for a voice memo. Otherwise reply in text.',
    'The memo uses the voice configured for this turn.',
    'Set userRequestedVoice only when the current user names a Murph voice for this memo or asks to test it. A voice named for one memo is not a saved preference.',
    'A murph.personalization voice change starts on a later turn, so when the user asks to save a voice and hear it now, save it and also pass it here.',
    'Final text is optional. Leave it empty when the memo carries the whole reply, and add text only for information the memo lacks or when the user asked for both.',
    'For a voice-only reply, end with an empty final message and do not call murph.finish_without_reply.',
    'On iMessage, also skip murph.select_reply_target for a voice-only reply, because reply targeting needs text.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: ELEVENLABS_TTS_MAX_TEXT_LENGTH,
        description: `Exact words to speak. ${voiceMemoTextLimitGuidance} Use plain spoken words with no bracketed audio directions or SSML.`,
      },
      userRequestedVoice: {
        anyOf: [
          { type: 'string', enum: [...assistantVoiceOptionIdValues] },
          { type: 'null' },
        ],
        default: null,
        description:
          `Roster id of the voice the current user named for this one memo or test. Omit it otherwise, and the memo uses the voice configured for this turn. Voices: ${voiceRosterDescription}.`,
      },
    },
    required: ['text'],
  },
} as const

export const MURPH_EXPRESSIVE_VOICE_MEMO_TOOL = {
  ...MURPH_GENERATE_VOICE_MEMO_TOOL,
  inputSchema: {
    ...MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema,
    properties: {
      ...MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties,
      text: {
        ...MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties.text,
        description: `Exact words to speak. ${voiceMemoTextLimitGuidance} This turn uses Eleven v4, so you may add occasional square-bracket cues such as [yawning], [sighs], [whispering], or [excited] beside the words they affect, when the user asks for them or they fit the moment. Cues count toward the character limit. Keep ordinary memos natural and restrained, with no gratuitous sounds or laughing at your own jokes, and keep serious health guidance clear and literal. Do not use SSML, and keep cues out of any accompanying text.`,
      },
    },
  },
} as const

const GENERATE_VOICE_MEMO_VALIDATION_PATHS =
  collectSafeJsonSchemaValidationPaths(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema)

const generateVoiceMemoArgumentsSchema = z
  .object({
    text: z.string().trim().min(1).max(ELEVENLABS_TTS_MAX_TEXT_LENGTH),
    userRequestedVoice: assistantVoiceOptionIdSchema.nullable().default(null),
  })
  .strict()

export function parseGenerateVoiceMemoArguments(
  value: unknown,
):
  | { ok: true; args: GenerateVoiceMemoToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = parseDynamicToolArguments({
    schema: generateVoiceMemoArgumentsSchema,
    schemaPaths: GENERATE_VOICE_MEMO_VALIDATION_PATHS,
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
      userRequestedVoiceOptionId: parsed.args.userRequestedVoice,
    },
  }
}

export async function executeGenerateVoiceMemoDynamicTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  recordPhaseTiming?: VoiceMemoPhaseTimingRecorder | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<DynamicToolResult> {
  return wrapVoiceMemoToolResult(
    await executeGenerateVoiceMemoTool({
      abortSignal: input.abortSignal ?? null,
      args: input.args,
      currentResponseMedia: input.currentResponseMedia ?? [],
      recordPhaseTiming: input.recordPhaseTiming ?? null,
      runtime: input.voiceMemoRuntime ?? null,
    }),
  )
}
