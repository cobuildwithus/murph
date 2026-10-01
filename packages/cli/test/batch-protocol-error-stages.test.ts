import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { test, vi } from 'vitest'

import {
  vaultCliBatchCommandErrorSchema,
  vaultCliBatchResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'

import { registerBatchCommands } from '../src/commands/batch.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { requireData, runInProcessJsonCli } from './cli-test-helpers.js'

interface ChildRunOptions {
  exit?: ((code?: number) => void) | undefined
  stdout?: ((output: string) => void) | undefined
}

vi.mock('../src/cli-entry.js', () => ({
  async runMurphCliAction(argv: string[], options: ChildRunOptions = {}) {
    const operation = argv[2]
    const stage =
      operation === 'list'
        ? 'protocol_index'
        : operation === 'show'
          ? 'protocol_run_specs'
          : 'protocol_family_graph'
    const error = {
      code: 'commons_protocol_artifact_unavailable',
      message: 'Health Commons protocol artifacts are unavailable.',
      retryable: false,
      hint: 'Restore the packaged protocol artifacts, then rerun the command.',
      stage,
    }

    options.stdout?.(`${JSON.stringify(error)}\n`)
    options.exit?.(1)
    throw new Error('The controlled child command did not exit.')
  },
}))

function createBatchCli() {
  const cli = Cli.create('vault-cli', {
    description: 'batch protocol error-stage test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerBatchCommands(cli)

  return cli
}

const scenarios = [
  {
    argv: ['commons', 'protocol', 'list'],
    stage: 'protocol_index',
  },
  {
    argv: ['commons', 'protocol', 'show', 'protocol-slug'],
    stage: 'protocol_run_specs',
  },
  {
    argv: ['commons', 'protocol', 'explore', 'protocol-family'],
    stage: 'protocol_family_graph',
  },
] as const

test('batch preserves every protocol artifact error stage in compact and noncompact output', async () => {
  for (const compact of [false, true]) {
    const result = await runInProcessJsonCli(createBatchCli(), [
      'batch',
      ...(compact ? ['--compact'] : []),
      '--vault',
      './vault',
      ...scenarios.flatMap((scenario) => [
        '--command',
        JSON.stringify(scenario.argv),
      ]),
    ])
    const batch = vaultCliBatchResultSchema.parse(requireData(result.envelope))

    assert.equal(batch.failed, scenarios.length)
    assert.equal(batch.commands.length, scenarios.length)
    for (const [index, scenario] of scenarios.entries()) {
      const command = batch.commands[index]

      assert.equal(command?.ok, false)
      assert.equal(command?.error?.code, 'commons_protocol_artifact_unavailable')
      assert.equal(command?.error?.stage, scenario.stage)
      assert.ok((command?.outputBytes ?? 0) > 0)

      if (compact) {
        assert.equal(command?.stdout, '')
        continue
      }

      const childOutput = JSON.parse(command?.stdout ?? '') as Record<string, unknown>
      const childError = vaultCliBatchCommandErrorSchema.parse(
        childOutput.error ?? childOutput,
      )
      assert.equal(childError.stage, scenario.stage)
    }
  }
})
