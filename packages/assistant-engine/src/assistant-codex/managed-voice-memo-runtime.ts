import type {
  VoiceMemoDeliveryChannel,
  VoiceMemoToolRuntime,
} from './generate-voice-memo-tool.js'

export const PUBLIC_MURPH_MANAGED_VOICE_MEMO_RUNTIME_FALLBACK =
  'public-murph-managed-voice-memo-runtime-fallback-v1'

/**
 * Public Murph intentionally ships no Murph-operated voice provider adapter.
 * Murph Cloud replaces this exact file as a validated build asset for managed
 * hosted builds. The generic tool contract and all effect handling remain in
 * public assistant-engine code.
 */
export function createVoiceMemoToolRuntimeFromEnv(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  preferredVoiceId?: string | null
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryChannel?: VoiceMemoDeliveryChannel | null
}): VoiceMemoToolRuntime | null {
  void input
  return null
}
