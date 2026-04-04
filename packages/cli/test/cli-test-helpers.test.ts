import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { resolveCliProcessExecutionMode, runCli, runRawCli } from './cli-test-helpers.js'
import { resolveLocalCliSuiteConcurrency } from './local-parallel-test.js'

test('cli test helpers route non-stdin commands through the persistent harness by default', () => {
  assert.equal(resolveCliProcessExecutionMode(), 'harness')
  assert.equal(
    resolveCliProcessExecutionMode({
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
      },
    }),
    'isolated',
  )
  assert.equal(
    resolveCliProcessExecutionMode({
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '1',
      },
      stdin: '{}',
    }),
    'isolated',
  )
})

test('cli test helpers reset env-backed vault selection across persistent harness commands', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-harness-'))
  const firstVaultRoot = path.join(parentRoot, 'vault-a')
  const secondVaultRoot = path.join(parentRoot, 'vault-b')

  try {
    const firstResult = await runCli(['init'], {
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '1',
        VAULT: firstVaultRoot,
      },
    })
    assert.equal(firstResult.ok, true)

    const secondResult = await runCli(['init'], {
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '1',
        VAULT: secondVaultRoot,
      },
    })
    assert.equal(secondResult.ok, true)

    await access(path.join(firstVaultRoot, 'vault.json'))
    await access(path.join(secondVaultRoot, 'vault.json'))
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('cli test helpers preserve non-zero exit behavior through the persistent harness', async () => {
  const output = await runRawCli(['--wat'], {
    env: {
      MURPH_CLI_TEST_PERSISTENT_HARNESS: '1',
    },
  })

  assert.match(output, /command_not_found/iu)
  assert.match(output, /--wat/u)
})

test('local parallel CLI test helper keeps suite concurrency opt-in by default', () => {
  assert.equal(resolveLocalCliSuiteConcurrency({}), false)
})

test('local parallel CLI test helper honors explicit suite-concurrency overrides', () => {
  assert.equal(
    resolveLocalCliSuiteConcurrency({
      MURPH_VITEST_SUITE_CONCURRENCY: 'true',
    }),
    true,
  )
  assert.equal(
    resolveLocalCliSuiteConcurrency({
      MURPH_VITEST_SUITE_CONCURRENCY: 'false',
    }),
    false,
  )
})
