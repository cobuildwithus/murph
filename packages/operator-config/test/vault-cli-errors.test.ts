import { describe, expect, test } from 'vitest'

import {
  createVaultCliRepair,
  describeVaultCliFailure,
  VaultCliError,
} from '../src/vault-cli-errors.ts'

describe('createVaultCliRepair', () => {
  test('bounds and normalizes the explicit model-facing repair contract', () => {
    const repair = createVaultCliRepair({
      stage: 'validation',
      hint: ` Remove the unsupported field. ${'x'.repeat(400)} `,
      fields: Array.from({ length: 14 }, (_, index) => ({
        path: ['items', index, index === 0 ? 'private value' : 'name'],
        code: index === 0 ? 'invalid type with spaces' : 'invalid_type',
        message: ` Invalid field ${index}. `,
        expected: 'string',
      })),
    })

    expect(repair.stage).toBe('validation')
    expect(repair.hint?.length).toBeLessThanOrEqual(320)
    expect(repair.fields).toHaveLength(13)
    expect(repair.fields[0]).toEqual({
      path: 'items.0.<field>',
      message: 'Invalid field 0.',
      expected: 'string',
    })
    expect(repair.fields.at(-1)).toEqual({
      path: '$',
      code: 'issues_omitted',
      message: '2 additional validation issues were omitted.',
    })
  })

  test('does not inspect ordinary error context as repair guidance', () => {
    const error = new VaultCliError('invalid_payload', 'Payload is invalid.', {
      issues: [{ path: ['secret'], message: 'submitted-private-value' }],
    })

    expect(error.repair).toBeUndefined()
  })

  test('normalizes repair input at the error boundary', () => {
    const error = new VaultCliError('invalid_payload', 'Payload is invalid.', undefined, {
      fields: Array.from({ length: 14 }, (_, index) => ({
        path: index === 0 ? 'private submitted path' : ['items', index],
        message: ` Invalid field ${index}. `,
      })),
    })

    expect(error.repair?.fields).toHaveLength(13)
    expect(error.repair?.fields[0]?.path).toBe('<field>')
    expect(error.repair?.fields.at(-1)?.code).toBe('issues_omitted')
  })
})

describe('describeVaultCliFailure', () => {
  test('names the HTTP status a provider rejected the request with', () => {
    const failure = describeVaultCliFailure(
      new VaultCliError('ELEVENLABS_API_REQUEST_FAILED', 'rejected', {
        elapsedMs: 812,
        failureStage: 'http',
        provider: 'elevenlabs',
        status: 429,
      }),
    )

    expect(failure).toBe('ELEVENLABS_API_REQUEST_FAILED (http 429, 812ms)')
  })

  test('names the stage and timeout when no response ever arrived', () => {
    const failure = describeVaultCliFailure(
      new VaultCliError('ELEVENLABS_API_REQUEST_FAILED', 'timed out', {
        elapsedMs: 90_004,
        failureStage: 'transport',
        timedOut: true,
        transportErrorName: 'AbortError',
      }),
    )

    expect(failure).toBe(
      'ELEVENLABS_API_REQUEST_FAILED (stage=transport, timed out, AbortError, 90004ms)',
    )
  })

  test('falls back to the bare code when no diagnostic context was attached', () => {
    expect(
      describeVaultCliFailure(new VaultCliError('ELEVENLABS_UNAVAILABLE', 'no fetch')),
    ).toBe('ELEVENLABS_UNAVAILABLE')
  })

  test('summarizes Linq failures through the same shared context convention', () => {
    expect(
      describeVaultCliFailure(
        new VaultCliError('LINQ_API_REQUEST_FAILED', 'rejected', {
          failureStage: 'http',
          status: 404,
        }),
      ),
    ).toBe('LINQ_API_REQUEST_FAILED (http 404)')
  })

  test('carries the provider code, request id, and message for debugging', () => {
    const failure = describeVaultCliFailure(
      new VaultCliError('ELEVENLABS_API_REQUEST_FAILED', 'rejected', {
        elapsedMs: 41,
        failureStage: 'http',
        providerErrorCode: 'voice_not_found',
        providerErrorMessage:
          "A voice with voice_id 'voice_probe' was not found.",
        providerRequestId: 'c080176137ecfe',
        status: 404,
      }),
    )

    expect(failure).toBe(
      'ELEVENLABS_API_REQUEST_FAILED (http 404, 41ms, voice_not_found, request c080176137ecfe): ' +
        "A voice with voice_id 'voice_probe' was not found.",
    )
  })

  test('returns null for errors that carry no provider diagnosis', () => {
    expect(describeVaultCliFailure(new Error('boom'))).toBeNull()
    expect(describeVaultCliFailure('boom')).toBeNull()
  })

  test('ignores context fields of the wrong shape rather than leaking them', () => {
    const failure = describeVaultCliFailure(
      new VaultCliError('LINQ_API_REQUEST_FAILED', 'rejected', {
        elapsedMs: Number.NaN,
        failureStage: '   ',
        status: 'not-a-status',
      }),
    )

    expect(failure).toBe('LINQ_API_REQUEST_FAILED')
  })
})
