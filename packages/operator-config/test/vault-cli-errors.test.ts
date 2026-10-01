import { describe, expect, test } from 'vitest'

import {
  describeVaultCliFailure,
  VaultCliError,
} from '../src/vault-cli-errors.ts'
import { projectVaultCliError } from '../src/vault-cli-error-projection.ts'

describe('projectVaultCliError', () => {
  test('keeps context as the sole VaultCliError metadata channel', () => {
    const context = { retryable: true }
    const error = new VaultCliError('temporary_failure', 'Retry later.', context)

    expect(error.context).toBe(context)
    expect(Object.hasOwn(error, 'repair')).toBe(false)
    expect(projectVaultCliError(error)).toEqual({
      code: 'temporary_failure',
      message: 'Retry later.',
      retryable: true,
    })
  })

  test('preserves a bounded owner hint and infers validation from owner issues', () => {
    const projection = projectVaultCliError(
      new VaultCliError('invalid_payload', 'Payload is invalid.', {
        hint: 'Correct the named field and submit a new attempt.',
        issues: [{
          code: 'invalid_type',
          expected: 'string',
          path: ['schedule', 'timeZone'],
        }],
      }),
    )

    expect(projection).toMatchObject({
      hint: 'Correct the named field and submit a new attempt.',
      stage: 'validation',
      fieldErrors: [{
        code: 'invalid_type',
        path: 'schedule.timeZone',
        expected: 'string',
      }],
    })
  })

  test('projects Zod-like VaultCliError details without raw issue text', () => {
    const submittedValue = 'private-submitted-value'
    const providerBody = 'private-provider-response'
    const projection = projectVaultCliError(
      new VaultCliError(
        'invalid_payload',
        'Schedule failed validation.',
        {
          retryable: false,
          issues: [
            {
              code: 'too_small',
              path: ['exercises', 0, 'sets'],
              publicPath: ['workoutSet'],
              message: `Missing set details for ${submittedValue}.`,
            },
            {
              code: 'custom',
              expected: 'string/../../private',
              path: ['results', 'private submitted path'],
              publicPath: ['result'],
              message: providerBody,
              received: submittedValue,
              submitted: providerBody,
            },
          ],
          providerBody,
          stage: 'validation',
        },
      ),
    )

    expect(projection).toMatchObject({
      code: 'invalid_payload',
      stage: 'validation',
      retryable: false,
      fieldErrors: [
        {
          code: 'too_small',
          path: 'workoutSet',
          expected: '',
          received: 'invalid',
          message: 'This field is invalid.',
        },
        {
          code: 'custom',
          path: 'result',
          expected: '',
          received: 'invalid',
          message: 'This field is invalid.',
        },
      ],
    })
    expect(JSON.stringify(projection)).not.toContain(submittedValue)
    expect(JSON.stringify(projection)).not.toContain(providerBody)
  })

  test('ignores repair-shaped arbitrary context beside established Zod issues', () => {
    const projection = projectVaultCliError(
      new VaultCliError(
        'invalid_payload',
        'Payload is invalid.',
        {
          issues: [{
            code: 'invalid_type',
            expected: 'number',
            path: ['private-dynamic-key'],
            publicPath: ['explicit'],
            message: 'private inferred issue',
          }],
          repair: {
            stage: 'owner-validation',
            hint: 'private owner hint',
            fields: [{
              code: 'owner_rule',
              path: ['explicit'],
              message: 'private owner message',
            }],
          },
          stage: 'write',
        },
      ),
    )

    expect(projection).toMatchObject({
      stage: 'write',
      fieldErrors: [{
        code: 'invalid_type',
        path: 'explicit',
        message: 'This field is invalid.',
      }],
    })
    expect(projection.hint).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('private-dynamic-key')
    expect(JSON.stringify(projection)).not.toContain('private owner')
    expect(JSON.stringify(projection)).not.toContain('private inferred issue')
  })

  test('caps validation details with one omitted-count field', () => {
    const projection = projectVaultCliError(
      new VaultCliError('invalid_payload', 'Payload is invalid.', {
        issues: Array.from({ length: 14 }, (_, index) => ({
          code: 'invalid_type',
          expected: 'string',
          path: ['items', index, 'name'],
          publicPath: ['items', index, 'name'],
          message: `private raw issue ${index}`,
        })),
      }),
    )

    expect(projection.fieldErrors).toHaveLength(13)
    expect(projection.fieldErrors?.at(0)).toMatchObject({
      code: 'invalid_type',
      expected: 'string',
      message: 'This field is invalid.',
      path: 'items.0.name',
    })
    expect(projection.fieldErrors?.at(-1)).toEqual({
      path: '$',
      code: 'issues_omitted',
      expected: '',
      received: 'invalid',
      message: '2 additional validation issues were omitted.',
    })
    expect(JSON.stringify(projection)).not.toContain('private raw issue')
  })

  test('does not inspect non-Zod issue context as field guidance', () => {
    const projection = projectVaultCliError(
      new VaultCliError('invalid_payload', 'Payload is invalid.', {
        issues: [{ message: 'private-submitted-value' }],
      }),
    )

    expect(projection.fieldErrors).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('private-submitted-value')
  })

  test('classifies raw Zod-like errors without projecting unowned paths', () => {
    const projection = projectVaultCliError({
      name: 'ZodError',
      issues: [
        {
          code: 'invalid_value',
          expected: 'number',
          path: ['schedule', 'timeZone'],
          message: 'private invalid value',
        },
      ],
    })

    expect(projection).toEqual({
      code: 'invalid_payload',
      message: 'Input failed validation.',
      retryable: false,
      stage: 'validation',
    })
    expect(projection.fieldErrors).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('private invalid value')
    expect(JSON.stringify(projection)).not.toContain('schedule')
  })

  test('uses ordinary owner issue paths while public paths remain authoritative', () => {
    const projection = projectVaultCliError(
      new VaultCliError('invalid_payload', 'Payload is invalid.', {
        issues: [
          { code: 'invalid_type', path: ['rawOnly'] },
          {
            code: 'invalid_type',
            path: ['private'],
            publicPath: ['unsafe submitted key'],
          },
          {
            code: 'invalid_type',
            path: ['private'],
            publicPath: ['safeOption', 2],
          },
        ],
      }),
    )

    expect(projection.fieldErrors).toEqual([
      {
        code: 'invalid_type',
        path: 'rawOnly',
        expected: '',
        received: 'invalid',
        message: 'This field is invalid.',
      },
      {
        code: 'invalid_type',
        path: 'safeOption.2',
        expected: '',
        received: 'invalid',
        message: 'This field is invalid.',
      },
    ])
    expect(projection.stage).toBe('validation')
    expect(JSON.stringify(projection)).not.toContain('unsafe submitted key')
  })

  test.each([
    'authorization',
    'configuration',
    'conflict',
    'filesystem',
    'integrity',
    'persistence',
    'read',
    'render',
    'response',
    'transport',
    'validation',
    'write',
  ])('preserves the fixed known-error stage %s', (stage) => {
    expect(
      projectVaultCliError(
        new VaultCliError('safe_failure', 'Safe failure.', { stage }),
      ),
    ).toMatchObject({ stage })
  })

  test('drops arbitrary known-error stages', () => {
    const projection = projectVaultCliError(
      new VaultCliError('safe_failure', 'Safe failure.', {
        stage: 'private-owner-phase',
      }),
    )

    expect(projection.stage).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('private-owner-phase')
  })

  test.each([
    ['EACCES', 'permission_denied', 'Check the file permissions before retrying.'],
    ['EPERM', 'permission_denied', 'Check the file permissions before retrying.'],
    ['ENOENT', 'not_found', 'Check the input path and retry the command.'],
    ['EISDIR', 'invalid_path', 'Check whether the option expects a file or a directory.'],
    ['ENOTDIR', 'invalid_path', 'Check whether the option expects a file or a directory.'],
    ['ENOSPC', 'storage_unavailable', 'Free storage space before retrying.'],
  ] as const)(
    'classifies %s with a concrete prerequisite but no unchanged retry',
    (nodeCode, expectedCode, expectedHint) => {
      const privatePath = '/private/workspace/member-vault/config.json'
      const projection = projectVaultCliError(
        Object.assign(
          new Error(`${nodeCode}: filesystem failure at '${privatePath}'`),
          {
            code: nodeCode,
            path: privatePath,
          },
        ),
      )

      expect(projection).toMatchObject({
        code: expectedCode,
        message: `${nodeCode}: filesystem failure at '${privatePath}'`,
        hint: expectedHint,
        stage: 'filesystem',
        retryable: false,
      })
      expect(JSON.stringify(projection)).toContain(privatePath)
      expect(JSON.stringify(projection)).toContain('filesystem failure at')
    },
  )

  test('preserves bounded diagnostic text for unhandled failures', () => {
    const submittedValue = 'private-submitted-value'
    const providerBody = 'private-provider-response'
    for (const message of [
      `Unexpected parser failure for ${submittedValue}`,
      `Mapbox address resolution request failed (HTTP 400: ${providerBody} echoed ${submittedValue}).`,
    ]) {
      const projection = projectVaultCliError(new Error(message))

      expect(projection).toMatchObject({
        code: 'UNKNOWN',
        message,
        retryable: false,
        stage: 'command',
      })
      expect(projection.hint).toBeUndefined()
    }
  })

  test('keeps stable error codes and validation messages from core errors', () => {
    const projection = projectVaultCliError(
      Object.assign(
        new Error('targetAt must be on or after startAt.'),
        { code: 'VAULT_INVALID_INPUT' },
      ),
    )

    expect(projection).toEqual({
      code: 'VAULT_INVALID_INPUT',
      message: 'targetAt must be on or after startAt.',
      retryable: false,
      stage: 'validation',
    })
  })

  test('bounds diagnostics while masking home directories and credential shapes', () => {
    const projection = projectVaultCliError(
      Object.assign(
        new Error(`/Users/example/vault failed with Bearer secret-credential ${'x'.repeat(800)}`),
        { code: 'CUSTOM_FAILURE' },
      ),
    )

    expect(projection.code).toBe('CUSTOM_FAILURE')
    expect(projection.message).toContain('<HOME_DIR>/vault')
    expect(projection.message).toContain('Bearer <REDACTED_CREDENTIAL>')
    expect(projection.message).not.toContain('secret-credential')
    expect(Array.from(projection.message)).toHaveLength(640)
    expect(projection.message.endsWith('…')).toBe(true)
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
