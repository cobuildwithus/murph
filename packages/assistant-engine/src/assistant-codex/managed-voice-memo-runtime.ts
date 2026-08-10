import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from '@murphai/hosted-execution/runtime-control'
import {
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '@murphai/operator-config/elevenlabs-runtime'

import { normalizeNullableString } from '../assistant/shared.js'
import type {
  VoiceMemoDeliveryChannel,
  VoiceMemoToolRuntime,
} from './generate-voice-memo-tool.js'

export const PUBLIC_MURPH_MANAGED_VOICE_MEMO_RUNTIME_FALLBACK =
  'public-murph-managed-voice-memo-runtime-fallback-v1'

/**
 * Public Murph keeps the provider-I/O-free local Telegram descriptor runtime.
 * Murph Cloud replaces this exact file as a validated build asset for managed
 * Linq builds. The generic tool contract and all effect handling remain in
 * public assistant-engine code.
 */
export function createVoiceMemoToolRuntimeFromEnv(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  preferredVoiceId?: string | null
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryChannel?: VoiceMemoDeliveryChannel | null
}): VoiceMemoToolRuntime | null {
  if (input.voiceMemoDeliveryChannel !== 'telegram') {
    return null
  }

  const defaultVoiceId = resolveElevenLabsVoiceId(input.env)
  return {
    elevenLabs: {
      apiKeyAvailable: resolveElevenLabsApiKey(input.env) !== null,
      defaultVoiceId,
      modelId: normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
        resolveElevenLabsModelId(input.env),
      ),
      voiceId:
        normalizeNullableString(input.preferredVoiceId) ?? defaultVoiceId,
    },
    kind: 'telegram',
  }
}
