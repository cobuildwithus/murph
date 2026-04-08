import assert from 'node:assert/strict'

import { Cli, z } from 'incur'
import { test } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import * as packageSurface from '../src/index.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { createSetupCli } from '../src/setup-cli.js'
import {
  createSetupAgentmailSelectionResolver,
} from '../src/setup-agentmail.js'
import {
  detectSetupProgramName,
  isSetupInvocation,
} from '../src/setup-services.js'

async function runJsonCli(args: string[]): Promise<{
  envelope: {
    ok: boolean
    data?: unknown
    error?: {
      code?: string
      message?: string
      retryable?: boolean
    }
  }
  exitCode: number | null
}> {
  const cli = Cli.create('setup-bridge-test', {
    description: 'setup bridge test',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  cli.command('fail', {
    args: z.object({}),
    async run() {
      throw new VaultCliError('SETUP_BRIDGE', 'setup bridge preserved the error', {
        exitCode: 9,
        retryable: true,
      })
    },
  })

  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args, '--format', 'json', '--verbose'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    envelope: JSON.parse(output.join('').trim()) as {
      ok: boolean
      data?: unknown
      error?: {
        code?: string
        message?: string
        retryable?: boolean
      }
    },
    exitCode,
  }
}

test('package surface re-exports the setup entrypoints', () => {
  assert.equal(packageSurface.createSetupCli, createSetupCli)
  assert.equal(
    packageSurface.createSetupAgentmailSelectionResolver,
    createSetupAgentmailSelectionResolver,
  )
  assert.equal(
    packageSurface.detectSetupProgramName,
    detectSetupProgramName,
  )
})

test('detectSetupProgramName prefers the shim program name when set to murph', () => {
  assert.equal(detectSetupProgramName('/tmp/vault-cli', 'murph'), 'murph')
  assert.equal(detectSetupProgramName('/tmp/murph', undefined), 'murph')
  assert.equal(detectSetupProgramName('/tmp/anything-else', undefined), 'vault-cli')
})

test('isSetupInvocation treats onboard and murph root help as setup entrypoints', () => {
  assert.equal(isSetupInvocation(['onboard']), true)
  assert.equal(isSetupInvocation([], 'murph'), true)
  assert.equal(isSetupInvocation(['help'], 'murph'), true)
  assert.equal(isSetupInvocation(['status'], 'murph'), false)
  assert.equal(isSetupInvocation([], 'vault-cli'), false)
})

test('VaultCliError remains a typed incur envelope through the setup bridge', async () => {
  const result = await runJsonCli(['fail'])

  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'SETUP_BRIDGE')
  assert.equal(
    result.envelope.error?.message,
    'setup bridge preserved the error',
  )
  assert.equal(result.envelope.error?.retryable, true)
  assert.equal(result.exitCode, 9)
})
