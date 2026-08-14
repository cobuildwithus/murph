import { describe, expect, it } from 'vitest'

import {
  executeGenerateVoiceMemoTool,
  type VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.ts'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'

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

describe('voice memo voice request policy', () => {
  it('exposes an explicit-user roster field instead of a general voice selector', () => {
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties).toHaveProperty(
      'userRequestedVoice',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties).not.toHaveProperty(
      'voice',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties).not.toHaveProperty(
      'voiceId',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'The voice configured for the running turn is authoritative for every normal memo.',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'Never set it because another voice seems to fit the content, mood, persona, or delivery better.',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'pass that same roster voice as userRequestedVoice',
    )
  })

  it('parses an explicitly user-requested Murph voice and rejects legacy selector fields', () => {
    const parsed = readTestMurphDynamicToolRequest({
      id: 1,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'Use the Country voice for this memo.',
          userRequestedVoice: 'country',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const legacyVoice = readTestMurphDynamicToolRequest({
      id: 2,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'Use the Country voice for this memo.',
          voice: 'country',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const legacyVoiceId = readTestMurphDynamicToolRequest({
      id: 3,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'Use the Country voice for this memo.',
          voiceId: 'country',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })

    expect(parsed).toMatchObject({
      args: {
        text: 'Use the Country voice for this memo.',
        userRequestedVoiceOptionId: 'country',
      },
      kind: 'generate-voice-memo',
    })
    expect(legacyVoice).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })
    expect(legacyVoiceId).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })
  })

  it('uses the configured running-turn voice for a normal memo', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'A normal voice memo.',
      },
      runtime: createTelegramRuntime(),
    })

    expect(result).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'voice_current_turn',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('uses the exact roster voice explicitly requested by the user', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Use the Country voice for this memo.',
        userRequestedVoiceOptionId: 'country',
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

  it('uses the environment default for an explicitly requested New York voice', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Use the New York voice for this memo.',
        userRequestedVoiceOptionId: 'classic',
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
