import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it } from 'vitest'

import {
  executeGenerateVoiceMemoTool,
  type VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.ts'
import {
} from '../src/assistant-codex/dynamic-tools.ts'

const countryElevenLabsVoiceId = 'Bj9UqZbhQsanLzgalpEG'

function createTelegramRuntime(): VoiceMemoToolRuntime {
  return {
    elevenLabs: {
      apiKeyAvailable: true,
      defaultVoiceId: 'voice_classic_default',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice_current_turn',
    },
    kind: 'telegram',
  }
}

describe('voice memo roster overrides', () => {
  it('exposes product voice ids instead of raw ElevenLabs ids', () => {
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties).toHaveProperty(
      'voice',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties).not.toHaveProperty(
      'voiceId',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'voice is a roster id, never an ElevenLabs voice id',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'pass that same roster voice here',
    )
  })

  it('parses a named Murph voice and rejects the legacy raw voiceId field', () => {
    const parsed = readTestMurphDynamicToolRequest({
      id: 1,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'A stern country reminder.',
          voice: 'country',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const legacy = readTestMurphDynamicToolRequest({
      id: 2,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'A stern country reminder.',
          voiceId: 'country',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })

    expect(parsed).toMatchObject({
      args: {
        text: 'A stern country reminder.',
        voiceId: null,
        voiceOptionId: 'country',
      },
      kind: 'generate-voice-memo',
    })
    expect(legacy).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })
  })

  it('resolves a one-off country override to its provider voice id', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'A stern country reminder.',
        voiceId: null,
        voiceOptionId: 'country',
      },
      runtime: createTelegramRuntime(),
    })

    expect(result).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: countryElevenLabsVoiceId,
            },
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('uses the environment default for the classic roster voice', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Use the New York voice.',
        voiceId: null,
        voiceOptionId: 'classic',
      },
      runtime: createTelegramRuntime(),
    })

    expect(result).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'voice_classic_default',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
  })
})
