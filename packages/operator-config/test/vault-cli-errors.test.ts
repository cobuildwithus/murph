import { describe, expect, test } from 'vitest'

import {
  createVaultCliRepair,
  describeVaultCliFailure,
  VaultCliError,
} from '../src/vault-cli-errors.ts'
import { projectVaultCliError } from '../src/vault-cli-error-projection.ts'

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

describe('projectVaultCliError', () => {
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
              message: `Missing set details for ${submittedValue}.`,
            },
            {
              code: 'custom',
              expected: 'string/../../private',
              path: ['results', 'private submitted path'],
              message: providerBody,
              received: submittedValue,
              submitted: providerBody,
            },
          ],
          providerBody,
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
          path: 'exercises.0.sets',
          expected: '',
          received: 'invalid',
          message: 'This field is invalid.',
        },
        {
          code: 'custom',
          path: 'results.<field>',
          expected: '',
          received: 'invalid',
          message: 'This field is invalid.',
        },
      ],
    })
    expect(JSON.stringify(projection)).not.toContain(submittedValue)
    expect(JSON.stringify(projection)).not.toContain(providerBody)
  })

  test('prefers explicit repair guidance over inferred Zod issue guidance', () => {
    const projection = projectVaultCliError(
      new VaultCliError(
        'invalid_payload',
        'Payload is invalid.',
        {
          issues: [{
            code: 'invalid_type',
            expected: 'number',
            path: ['inferred'],
            message: 'private inferred issue',
          }],
        },
        {
          stage: 'owner-validation',
          hint: 'Use the documented owner field.',
          fields: [{
            code: 'owner_rule',
            path: ['explicit'],
            message: 'Use the supported value.',
          }],
        },
      ),
    )

    expect(projection).toMatchObject({
      stage: 'owner-validation',
      hint: 'Use the documented owner field.',
      fieldErrors: [{
        code: 'owner_rule',
        path: 'explicit',
        message: 'Use the supported value.',
      }],
    })
    expect(JSON.stringify(projection)).not.toContain('inferred')
    expect(JSON.stringify(projection)).not.toContain('private inferred issue')
  })

  test('caps validation details with one omitted-count field', () => {
    const projection = projectVaultCliError(
      new VaultCliError('invalid_payload', 'Payload is invalid.', {
        issues: Array.from({ length: 14 }, (_, index) => ({
          code: 'invalid_type',
          expected: 'string',
          path: ['items', index, 'name'],
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

  test('classifies raw Zod-like errors through the same validation mapper', () => {
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

    expect(projection).toMatchObject({
      code: 'invalid_payload',
      message: 'Input failed validation.',
      retryable: false,
      stage: 'validation',
      fieldErrors: [
        {
          code: 'invalid_value',
          expected: 'number',
          message: 'This field is invalid.',
          path: 'schedule.timeZone',
          received: 'invalid',
        },
      ],
    })
    expect(JSON.stringify(projection)).not.toContain('private invalid value')
  })

  test.each([
    ['EACCES', 'permission_denied'],
    ['EPERM', 'permission_denied'],
    ['ENOENT', 'not_found'],
    ['EISDIR', 'invalid_path'],
    ['ENOTDIR', 'invalid_path'],
    ['ENOSPC', 'storage_unavailable'],
  ] as const)(
    'classifies %s without returning paths or causes',
    (nodeCode, expectedCode) => {
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
        stage: 'filesystem',
        retryable: false,
      })
      expect(JSON.stringify(projection)).not.toContain(privatePath)
      expect(JSON.stringify(projection)).not.toContain('filesystem failure at')
    },
  )

  test('redacts unexpected exception paths while retaining bounded repair text', () => {
    const privatePath = '/private/workspace/member-vault/data.json'
    const projection = projectVaultCliError(
      new Error(`Unexpected parser failure in ${privatePath}`),
    )

    expect(projection).toMatchObject({
      code: 'UNKNOWN',
      stage: 'command',
      retryable: false,
    })
    expect(JSON.stringify(projection)).not.toContain(privatePath)
    expect(projection.message).toMatch(/Unexpected parser failure in <PATH>/u)
  })

  test('does not return provider-shaped or credential-bearing unknown messages', () => {
    for (const message of [
      '{"error":{"message":"private-provider-response"}}',
      'Authorization: Bearer private-token',
    ]) {
      const projection = projectVaultCliError(new Error(message))

      expect(projection.code).toBe('UNKNOWN')
      expect(projection.message).toBe(
        'The command failed without a safe recoverable detail.',
      )
      expect(JSON.stringify(projection)).not.toContain('private-provider-response')
      expect(JSON.stringify(projection)).not.toContain('private-token')
    }
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
