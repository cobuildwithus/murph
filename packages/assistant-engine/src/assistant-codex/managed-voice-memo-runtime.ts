import type { VoiceMemoToolRuntime } from './generate-voice-memo-tool.js'

export const PUBLIC_MURPH_MANAGED_VOICE_MEMO_RUNTIME_FALLBACK =
  'public-murph-managed-voice-memo-runtime-fallback-v1'

/**
 * Public Murph intentionally ships no Murph-operated Linq voice provider
 * adapter. Murph Cloud replaces this exact file as a validated build asset for
 * managed Linq builds. Channel dispatch, Telegram descriptors, the generic
 * tool contract, and effect handling remain in public assistant-engine code.
 */
export function createManagedLinqVoiceMemoRuntimeFromEnv(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  preferredVoiceId?: string | null
  publicFetchImpl?: typeof fetch | null
}): Extract<VoiceMemoToolRuntime, { kind: 'linq' }> | null {
  void input
  return null
}
