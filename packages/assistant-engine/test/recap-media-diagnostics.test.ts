import { expect, test } from 'vitest'
import { executeMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'

const privateValue = 'SYNTHETIC_PRIVATE_PROVIDER_CONTENT'
function context(): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false, vaultFileSendAvailable: false,
    currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
    sendVaultFile: async () => { throw new Error('Unavailable') },
    prepareRecapMedia: async () => ({ elevenLabsApiKey: 'synthetic-host-key',
      resolveReferences: async () => [], save: async () => { throw new Error('Unexpected save') },
      fetchImpl: async () => Response.json({ error: { message: privateValue, code: privateValue } }, { status: 429 }),
    }),
  }
}

test.each(['image', 'song'] as const)('recap %s failures preserve typed provider details through the dynamic tool issue without private content', async kind => {
  const result = await executeMurphDynamicToolRequest({
    request: kind === 'song' ? { kind: 'generate-song', args: { output: 'file', operationId: 'song', durationSeconds: 20, instrumental: false, prompt: 'A synthetic purple moon song.' } } : { kind: 'generate-image', args: { output: 'file', operationId: 'cover', outputFormat: 'jpeg',
      prompt: 'A synthetic purple moon.', quality: 'high', size: '1024x1536', alt: null } },
    env: { OPENAI_API_KEY: 'synthetic-image-key' }, fetchImpl: fetch, hostedToolContext: context(),
    nextUsageOrdinal: () => 1, progressDelivery: null,
  })
  expect(result.rpcResult.success).toBe(false)
  expect(result.failureDiagnostic).toMatchObject({ mediaFailureReason: 'provider_http', mediaHttpStatusClass: '4xx' })
  expect(result.runtimeIssueInputs?.[0]?.details).toMatchObject({ mediaFailureReason: 'provider_http', mediaHttpStatusClass: '4xx' })
  expect(JSON.stringify(result)).not.toContain(privateValue)
  expect(result.rpcResult.contentItems[0]?.text).toContain('photo/text')
})


test('validation diagnostics expose only the failed rule and closed media classes', async () => {
  const { mediaValidationError, generatedMediaFailureDiagnostic } = await import('../src/assistant-codex/generated-media-failure.js')
  expect(generatedMediaFailureDiagnostic(mediaValidationError('image_format', new Uint8Array([0x89, 0x50])))).toMatchObject({
    failureStage: 'validation', mediaFailureReason: 'image_format', mediaTypeClass: 'png', mediaSizeClass: 'le_1mib',
  })
  expect(generatedMediaFailureDiagnostic(mediaValidationError('audio_duration', new Uint8Array([0x49, 0x44, 0x33])))).toMatchObject({
    mediaFailureReason: 'audio_duration', mediaTypeClass: 'mp3', mediaSizeClass: 'le_1mib',
  })
  const malicious = Object.defineProperty({}, 'context', { get() { throw new Error(privateValue) } })
  expect(generatedMediaFailureDiagnostic(malicious)).toMatchObject({ mediaFailureReason: 'unknown' })
  expect(generatedMediaFailureDiagnostic(new Proxy({}, { get() { throw new Error(privateValue) } }))).toMatchObject({ mediaFailureReason: 'unknown' })
})

test('file runtime preparation failures are captured as redacted typed tool issues', async () => {
  const { mediaValidationError } = await import('../src/assistant-codex/generated-media-failure.js')
  const hosted = context()
  hosted.prepareRecapMedia = async () => { throw mediaValidationError('audio_duration') }
  const result = await executeMurphDynamicToolRequest({ request: { kind: 'generate-song', args: { output: 'file', operationId: 'song', durationSeconds: 30, instrumental: false, prompt: 'Synthetic song.' } },
    env: {}, fetchImpl: fetch, hostedToolContext: hosted, nextUsageOrdinal: () => 1, progressDelivery: null })
  expect(result.rpcResult.success).toBe(false)
  expect(result.runtimeIssueInputs?.[0]?.details).toMatchObject({ mediaFailureReason: 'audio_duration', failureStage: 'validation' })
})
