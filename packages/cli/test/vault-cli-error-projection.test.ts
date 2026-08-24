import assert from 'node:assert/strict'

import {
  createVaultCliRepair,
  VaultCliError,
} from '@murphai/operator-config/vault-cli-errors'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { projectVaultCliError } from '../src/vault-cli-error-projection.js'

test('projects only the explicit VaultCliError repair contract', () => {
  const submittedValue = 'private-submitted-value'
  const providerBody = 'private-provider-response'
  const projection = projectVaultCliError(
    new VaultCliError(
      'invalid_payload',
      'Schedule failed validation.',
      {
        retryable: false,
        issues: [{ message: submittedValue }],
        providerBody,
      },
      createVaultCliRepair({
        stage: 'validation',
        hint: 'Use a valid IANA time zone.',
        fields: [
          {
            path: ['schedule', 'timeZone'],
            code: 'invalid_value',
            message: 'Use an IANA time-zone identifier.',
          },
        ],
      }),
    ),
  )

  assert.equal(projection.code, 'invalid_payload')
  assert.equal(projection.stage, 'validation')
  assert.equal(projection.retryable, false)
  assert.deepEqual(projection.fieldErrors, [
    {
      code: 'invalid_value',
      path: 'schedule.timeZone',
      expected: '',
      received: 'invalid',
      message: 'Use an IANA time-zone identifier.',
    },
  ])
  assert.equal(JSON.stringify(projection).includes(submittedValue), false)
  assert.equal(JSON.stringify(projection).includes(providerBody), false)
})

test('classifies filesystem errors without returning the absolute path or cause', () => {
  const privatePath = '/private/workspace/member-vault/config.json'
  const projection = projectVaultCliError(
    Object.assign(new Error(`EACCES: permission denied, open '${privatePath}'`), {
      code: 'EACCES',
      path: privatePath,
    }),
  )

  assert.equal(projection.code, 'permission_denied')
  assert.equal(projection.stage, 'filesystem')
  assert.equal(projection.retryable, false)
  assert.equal(JSON.stringify(projection).includes(privatePath), false)
  assert.equal(JSON.stringify(projection).includes('permission denied, open'), false)
})

test('classifies escaped validation issues without echoing raw issue messages', () => {
  const privateValue = 'secret-invalid-value'
  const projection = projectVaultCliError({
    issues: [
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['schedule', 'expression'],
        message: `Expected string, received ${privateValue}`,
      },
    ],
  })

  assert.equal(projection.code, 'invalid_payload')
  assert.equal(projection.fieldErrors?.[0]?.path, 'schedule.expression')
  assert.equal(projection.fieldErrors?.[0]?.expected, 'string')
  assert.equal(JSON.stringify(projection).includes(privateValue), false)
})

test('redacts unexpected exception paths while retaining bounded repair text', () => {
  const privatePath = '/private/workspace/member-vault/data.json'
  const projection = projectVaultCliError(
    new Error(`Unexpected parser failure in ${privatePath}`),
  )

  assert.equal(projection.code, 'UNKNOWN')
  assert.equal(projection.stage, 'command')
  assert.equal(projection.retryable, false)
  assert.equal(JSON.stringify(projection).includes(privatePath), false)
  assert.match(projection.message, /Unexpected parser failure in <PATH>/u)
})

test('does not return provider-shaped or credential-bearing unknown messages', () => {
  for (const message of [
    '{"error":{"message":"private-provider-response"}}',
    'Authorization: Bearer private-token',
  ]) {
    const projection = projectVaultCliError(new Error(message))

    assert.equal(projection.code, 'UNKNOWN')
    assert.equal(
      projection.message,
      'The command failed without a safe recoverable detail.',
    )
    assert.equal(JSON.stringify(projection).includes('private-provider-response'), false)
    assert.equal(JSON.stringify(projection).includes('private-token'), false)
  }
})
