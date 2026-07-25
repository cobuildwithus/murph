import { describe, expect, test } from 'vitest'

import { describeVaultCliFailure, VaultCliError } from '../src/vault-cli-errors.ts'

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
