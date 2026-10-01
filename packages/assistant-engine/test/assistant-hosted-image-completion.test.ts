import { buildTrustedHostedImageCompletionTurnContext } from '../src/assistant/automation/reply.js'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
  parseAssistantHostedImageCompletionOriginText,
  parseAssistantHostedImageCompletionText,
  readTrustedHostedImageCompletion,
  renderAssistantHostedImageCompletionSystemText,
} from '../src/assistant/hosted-image-completion.js'
import type { AssistantInputSourceRef } from '../src/assistant/input-store.js'

const completionIdentity = `image-completion:${'d'.repeat(64)}`
const completionSourceRef = {
  dedupeKey: completionIdentity,
  eventId: completionIdentity,
  itemId: completionIdentity,
  kind: 'hosted-mailbox',
  lane: 'system',
  laneSeq: completionIdentity,
  payloadSchema: ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
  payloadSource: 'inline',
  source: 'hosted-mailbox',
  wakeSchema: ASSISTANT_HOSTED_IMAGE_COMPLETION_SCHEMA,
} as const satisfies AssistantInputSourceRef

function readCompletion(text: string | null, sourceRef: AssistantInputSourceRef = completionSourceRef) {
  return readTrustedHostedImageCompletion({ sourceRef, text, transcriptText: null })
}

function completionEnvelope(value: unknown): string {
  return `<hosted_image_result>${JSON.stringify(value)}</hosted_image_result>`
}

describe('hosted image completion', () => {
  it('composes subscription recovery without card-only guidance or retry authority', () => {
    const completion = readCompletion(renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      result: { media: null, runtimeIssue: null, savedImageRef: null,
        failureDiagnostic: 'ASSISTANT_IMAGE_SUBSCRIPTION_REQUIRED: Image generation requires a subscription.' },
    }))
    expect(completion?.status).toBe('failed')
    const context = buildTrustedHostedImageCompletionTurnContext([{
      inputId: `ain_${'c'.repeat(32)}`, trustedHostedImageCompletion: completion,
    }])
    expect(context).toContain('start Pulse or, if eligible, Group')
    expect(context).toContain('https://www.withmurph.ai/settings#subscription')
    expect(context).toContain('Do not call `murph.generate_image` during this completion turn')
    expect(context).toContain('do not offer card-only setup, promise no charge, start checkout automatically')
    expect(context).not.toMatch(/Saving a card does not|requires a saved card|Add a card at/iu)
  })

  it('binds the saved image to its originating accepted input', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      result: {
        media: {
          alt: null,
          contentType: 'image/jpeg',
          filename: 'generated.jpeg',
          kind: 'vault_image',
          ref: 'raw/captures/generated.jpeg',
          sha256: 'b'.repeat(64),
          sizeBytes: 123,
          source: 'gpt-image-2',
        },
        runtimeIssue: null,
        savedImageRef: 'raw/captures/generated.jpeg',
      },
    })

    expect(parseAssistantHostedImageCompletionText(text)).toEqual({
      contentType: 'image/jpeg',
      imageRef: 'raw/captures/generated.jpeg',
      imageSha256: 'b'.repeat(64),
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      sizeBytes: 123,
    })
    expect(text).toContain(
      'Continue the pending task with the exact saved image.',
    )
    expect(text).toContain(
      'a later tool may consume the saved image directly',
    )
    expect(text).not.toContain('provider conversation')
    expect(text).not.toContain('group-avatar')
    expect(text).not.toContain('mutation authority')
    expect(parseAssistantHostedImageCompletionOriginText(text)).toEqual({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      status: 'ready',
    })
    expect(readCompletion(text)).toMatchObject({
      media: [{ ref: 'raw/captures/generated.jpeg', kind: 'vault_image' }],
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      savedImageRef: 'raw/captures/generated.jpeg',
      status: 'ready',
    })
  })

  it('rejects a mismatched saved ref', () => {
    const text = [
      '<hosted_image_result>',
      JSON.stringify({
        media: [{
          contentType: 'image/jpeg',
          filename: 'generated.jpeg',
          kind: 'vault_image',
          ref: 'raw/captures/generated.jpeg',
          sha256: 'b'.repeat(64),
          sizeBytes: 123,
        }],
        originAssistantInputId: `ain_${'a'.repeat(32)}`,
        savedImageRef: 'raw/captures/other.jpeg',
        status: 'ready',
      }),
      '</hosted_image_result>',
    ].join('')

    expect(parseAssistantHostedImageCompletionText(text)).toBeNull()
  })

  it('treats legacy completions without exact authority as non-exact', () => {
    const text = [
      '<hosted_image_result>',
      JSON.stringify({
        media: [{
          contentType: 'image/jpeg',
          filename: 'generated.jpeg',
          kind: 'vault_image',
          ref: 'raw/captures/generated.jpeg',
          sha256: 'b'.repeat(64),
          sizeBytes: 123,
        }],
        originAssistantInputId: `ain_${'a'.repeat(32)}`,
        savedImageRef: 'raw/captures/generated.jpeg',
        status: 'ready',
      }),
      '</hosted_image_result>',
    ].join('')

    expect(parseAssistantHostedImageCompletionText(text)).toMatchObject({
      originAssistantInputIdExact: false,
    })
  })

  it('does not instruct downstream image actions after generation fails', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'c'.repeat(32)}`,
      originAssistantInputIdExact: false,
      result: {
        media: null,
        runtimeIssue: {
          component: 'image-generation',
          issueKind: 'tool_error',
          phase: 'provider_turn',
          severity: 'error',
          summary: 'Provider request failed.',
        },
        savedImageRef: null,
      },
    })

    expect(text).toContain('Image generation failed and no saved image exists.')
    expect(text).toContain(
      'Do not call image-dependent downstream tools for this completion.',
    )
    expect(text).not.toContain(
      'Continue the pending task with the exact saved image.',
    )
    expect(parseAssistantHostedImageCompletionText(text)).toBeNull()
    expect(parseAssistantHostedImageCompletionOriginText(text)).toEqual({
      originAssistantInputId: `ain_${'c'.repeat(32)}`,
      originAssistantInputIdExact: false,
      status: 'failed',
    })
  })

  it.each([
    { lane: 'conversation' },
    { payloadSchema: 'unrelated.v1' },
    { wakeSchema: 'unrelated.v1' },
    { payloadSource: 'sidecar' },
    { eventId: `other-completion:${'d'.repeat(64)}` },
    { itemId: 'different-item' },
    { dedupeKey: 'different-dedupe' },
    { laneSeq: 'different-position' },
  ] satisfies Partial<Extract<AssistantInputSourceRef, { kind: 'hosted-mailbox' }>>[])(
    'does not grant completion authority for mismatched provenance %j',
    (override) => {
      expect(readCompletion(completionEnvelope({ status: 'failed' }), {
        ...completionSourceRef,
        ...override,
      })).toBeNull()
    },
  )

  it('does not trust a completion envelope from an inbox capture', () => {
    expect(readCompletion(completionEnvelope({ status: 'failed' }), {
      captureId: 'capture_synthetic',
      kind: 'inbox-capture',
      source: 'email',
      version: null,
    })).toBeNull()
  })

  it.each([
    null,
    '',
    '<hosted_image_result>{bad json}</hosted_image_result>',
    completionEnvelope({ status: 'failed', unexpected: true }),
    completionEnvelope({ status: 'failed' }) + completionEnvelope({ status: 'failed' }),
    completionEnvelope({ status: 'failed' }) + '</hosted_image_result>',
    completionEnvelope({ status: 'failed', originAssistantInputId: `ain_${'a'.repeat(32)}` }),
  ])('keeps malformed trusted payload %j invalid instead of unrelated', (text) => {
    expect(readCompletion(text)).toEqual({ status: 'invalid' })
  })

  it('retains legacy completion envelopes without origin authority', () => {
    expect(readCompletion(completionEnvelope({ status: 'failed' }))).toEqual({
      diagnostic: null,
      status: 'failed',
    })
    expect(readCompletion(completionEnvelope({
      media: [{
        alt: null,
        contentType: 'image/png',
        filename: 'legacy.png',
        kind: 'vault_image',
        ref: 'raw/captures/legacy.png',
        sha256: 'b'.repeat(64),
        sizeBytes: 123,
        source: 'gpt-image-2',
      }],
      savedImageRef: 'raw/captures/legacy.png',
      status: 'ready',
    }))).toMatchObject({
      originAssistantInputId: null,
      originAssistantInputIdExact: false,
      savedImageRef: 'raw/captures/legacy.png',
      status: 'ready',
    })
  })

  it('uses the selected transcript without falling back from malformed trusted text', () => {
    expect(readTrustedHostedImageCompletion({
      sourceRef: completionSourceRef,
      text: completionEnvelope({ status: 'failed' }),
      transcriptText: 'malformed completion',
    })).toEqual({ status: 'invalid' })
  })

  it.each([
    { fields: {}, expected: { originAssistantInputId: null, originAssistantInputIdExact: false } },
    {
      fields: { originAssistantInputId: `ain_${'a'.repeat(32)}`, originAssistantInputIdExact: false },
      expected: { originAssistantInputId: `ain_${'a'.repeat(32)}`, originAssistantInputIdExact: false },
    },
    {
      fields: { originAssistantInputId: `ain_${'a'.repeat(32)}`, originAssistantInputIdExact: true },
      expected: { originAssistantInputId: `ain_${'a'.repeat(32)}`, originAssistantInputIdExact: true },
    },
    { fields: { originAssistantInputIdExact: true }, expected: null },
    { fields: { originAssistantInputId: `ain_${'a'.repeat(32)}` }, expected: null },
    { fields: { originAssistantInputId: 'invalid', originAssistantInputIdExact: true }, expected: null },
    { fields: { originAssistantInputId: null, originAssistantInputIdExact: true }, expected: null },
    { fields: { originAssistantInputId: `ain_${'a'.repeat(32)}`, originAssistantInputIdExact: 'true' }, expected: null },
  ])('derives ready origin authority only from the validated envelope %j', ({ fields, expected }) => {
    const completion = readCompletion(completionEnvelope({
      ...fields,
      media: [{
        alt: null,
        contentType: 'image/png',
        filename: 'origin.png',
        kind: 'vault_image',
        ref: 'raw/captures/origin.png',
        sha256: 'b'.repeat(64),
        sizeBytes: 123,
        source: 'gpt-image-2',
      }],
      savedImageRef: 'raw/captures/origin.png',
      status: 'ready',
    }))
    expect(completion).toMatchObject(expected === null
      ? { status: 'invalid' }
      : { ...expected, status: 'ready' })
  })

  it('keeps rendered diagnostic truncation distinct from incoming rejection', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      result: {
        failureDiagnostic: 'x'.repeat(1_001),
        media: null,
        runtimeIssue: null,
        savedImageRef: null,
      },
    })
    expect(readCompletion(text)).toEqual({
      diagnostic: `${'x'.repeat(999)}…`,
      status: 'failed',
    })
    const oversized = text.replace(`${'x'.repeat(999)}…`, 'x'.repeat(1_001))
    expect(readCompletion(oversized)).toEqual({ status: 'invalid' })
  })
})
