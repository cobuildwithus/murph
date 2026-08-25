import assert from 'node:assert/strict'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { projectVaultCliError } from '../src/vault-cli-error-projection.js'

test('projects stable VaultCliError issues without echoing issue messages', () => {
  const submittedValue = 'private-submitted-value'
  const providerBody = 'private-provider-response'
  const projection = projectVaultCliError(
    new VaultCliError('invalid_payload', 'Schedule failed validation.', {
      retryable: false,
      issues: [
        {
          path: ['schedule', 'timeZone'],
          publicPath: ['schedule', 'timeZone'],
          code: 'invalid_value',
          message: submittedValue,
        },
      ],
      providerBody,
      stage: 'validation',
    }),
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
      message: 'This field is invalid.',
    },
  ])
  assert.equal(projection.hint, undefined)
  assert.equal(JSON.stringify(projection).includes(submittedValue), false)
  assert.equal(JSON.stringify(projection).includes(providerBody), false)
})

test('projects raw Query source failures with safe repair detail', () => {
  const projection = projectVaultCliError(
    Object.assign(new Error('private-query-parser-detail'), {
      code: 'QUERY_SOURCE_INVALID',
      details: {
        querySource: true,
        relativePath: 'journal/2026/invalid.md',
        issue: 'missing_field',
        lineNumber: 4,
        field: 'title',
        privateValue: 'private-query-source-marker',
      },
    }),
  )

  assert.deepEqual(projection, {
    code: 'query_source_invalid',
    message: 'Canonical vault source journal/2026/invalid.md:4 could not be read.',
    retryable: false,
    fieldErrors: [
      {
        code: 'missing_field',
        path: 'title',
        expected: '',
        received: 'missing',
        message: 'This canonical source field is invalid or missing.',
        missing: true,
      },
    ],
    hint:
      'Repair journal/2026/invalid.md:4, then rerun the command. Vault validation can identify additional source issues.',
    stage: 'query_source',
  })
  assert.doesNotMatch(JSON.stringify(projection), /private-query/u)
})

test('projects unsupported Query formats as terminal compatibility work', () => {
  const projection = projectVaultCliError(
    Object.assign(new Error('private-format-detail'), {
      code: 'QUERY_SOURCE_INVALID',
      details: {
        querySource: true,
        relativePath: 'vault.json',
        issue: 'unsupported_format',
      },
    }),
  )

  assert.deepEqual(projection, {
    code: 'unsupported_format',
    message: 'Canonical vault source vault.json uses an unsupported format.',
    retryable: false,
    hint:
      'Use a compatible Murph runtime or a supported Murph migration path, then rerun the command. Do not edit vault.json manually.',
    stage: 'query_source',
  })
})

test('does not trust unsafe or unknown Query source detail', () => {
  for (const details of [
    {
      querySource: true,
      relativePath: '../private-vault.json',
      issue: 'malformed_json',
    },
    {
      querySource: true,
      relativePath: 'vault.json',
      issue: 'private_internal_failure',
    },
  ]) {
    const projection = projectVaultCliError(
      Object.assign(new Error('safe fallback'), {
        code: 'QUERY_SOURCE_INVALID',
        details,
      }),
    )

    assert.equal(projection.code, 'QUERY_SOURCE_INVALID')
    assert.doesNotMatch(JSON.stringify(projection), /private-vault|private_internal/u)
  }
})

test('recognizes only the fixed safe Health Commons artifact error shape', () => {
  const projection = projectVaultCliError(
    Object.assign(new Error('private-artifact-detail'), {
      code: 'HEALTH_COMMONS_PROTOCOL_ARTIFACT_FAILURE',
      artifact: 'protocol_run_specs',
      category: 'unavailable',
    }),
  )

  assert.deepEqual(projection, {
    code: 'commons_protocol_artifact_unavailable',
    message: 'Health Commons protocol artifacts are unavailable.',
    retryable: false,
    hint:
      'Stop protocol discovery, onboarding, planning, and starting a protocol until the packaged artifacts are restored or regenerated; then rerun the command. No protocol-backed run was created.',
    stage: 'protocol_run_specs',
  })

  const unknownArtifactProjection = projectVaultCliError(
    Object.assign(new Error('safe fallback'), {
      code: 'HEALTH_COMMONS_PROTOCOL_ARTIFACT_FAILURE',
      artifact: 'private-artifact',
      category: 'unavailable',
    }),
  )
  assert.equal(
    unknownArtifactProjection.code,
    'HEALTH_COMMONS_PROTOCOL_ARTIFACT_FAILURE',
  )
  assert.doesNotMatch(JSON.stringify(unknownArtifactProjection), /private-artifact/u)
})
