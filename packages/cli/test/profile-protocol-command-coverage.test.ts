import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { test } from 'vitest'

import { createUnwiredVaultServices } from '@murphai/vault-usecases'

import { registerProfileCommands } from '../src/commands/profile.js'
import { registerProtocolCommands } from '../src/commands/protocol.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

type VaultServices = ReturnType<typeof createUnwiredVaultServices>

const vaultRoot = '/tmp/murph-cli-profile-protocol-coverage'

function createSliceCli(configureServices?: (services: VaultServices) => void) {
  const cli = Cli.create('vault-cli', {
    description: 'profile/protocol coverage slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createUnwiredVaultServices()

  configureServices?.(services)
  registerProfileCommands(cli, services)
  registerProtocolCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
  configureServices?: (services: VaultServices) => void,
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli(configureServices)
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runSliceCliRaw(
  args: string[],
  configureServices?: (services: VaultServices) => void,
) {
  const cli = createSliceCli(configureServices)
  const output: string[] = []

  await cli.serve([...args, '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('profile current rebuild and protocol stop schemas expose the focused owner commands', async () => {
  const rebuildSchema = JSON.parse(
    await runSliceCliRaw(['profile', 'current', 'rebuild', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const stopSchema = JSON.parse(
    await runSliceCliRaw(['protocol', 'stop', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('requestId' in rebuildSchema.options.properties, true)
  assert.deepEqual(rebuildSchema.options.required, ['vault'])

  assert.equal('stoppedOn' in stopSchema.options.properties, true)
  assert.equal('requestId' in stopSchema.options.properties, true)
  assert.deepEqual(stopSchema.options.required, ['vault'])
})

test('protocol stop help keeps the canonical protocol id as a positional arg', async () => {
  const help = await runSliceCliRaw(['protocol', 'stop', '--help'])

  assert.match(help, /Usage: vault-cli protocol stop <protocolId> \[options\]/u)
  assert.match(help, /Stop one protocol while preserving its canonical id\./u)
})

test('profile current rebuild returns the generated profile result with suggested follow-up commands', async () => {
  const rebuildCalls: Array<{
    requestId: string | null
    vault: string
  }> = []

  const result = await runSliceCli<{
    vault: string
    profilePath: string
    snapshotId: string | null
    updated: boolean
  }>([
    'profile',
    'current',
    'rebuild',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-profile-rebuild-01',
  ], (services) => {
    services.core.rebuildCurrentProfile = async (input) => {
      rebuildCalls.push({
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        profilePath: 'bank/profile/current.md',
        snapshotId: 'prof_01JNV422Y2M5ZBV64ZP4N1DRB1',
        updated: true,
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.meta?.command, 'profile current rebuild')
  assert.deepEqual(rebuildCalls, [
    {
      vault: vaultRoot,
      requestId: 'req-profile-rebuild-01',
    },
  ])
  assert.deepEqual(requireData(result), {
    vault: vaultRoot,
    profilePath: 'bank/profile/current.md',
    snapshotId: 'prof_01JNV422Y2M5ZBV64ZP4N1DRB1',
    updated: true,
  })
  assert.deepEqual(result.meta?.cta?.commands, [
    {
      command: 'vault-cli profile show current --vault <vault>',
      description: 'Show the rebuilt generated current profile.',
    },
    {
      command: 'vault-cli profile list --vault <vault>',
      description: 'List saved profile snapshots.',
    },
  ])
})

test('protocol stop forwards request metadata and returns the stop result with follow-up commands', async () => {
  const stopCalls: Array<{
    protocolId: string
    requestId: string | null
    stoppedOn: string | undefined
    vault: string
  }> = []

  const result = await runSliceCli<{
    vault: string
    protocolId: string
    lookupId: string
    stoppedOn: string | null
    status: string
  }>([
    'protocol',
    'stop',
    'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
    '--stopped-on',
    '2026-03-12',
    '--vault',
    vaultRoot,
    '--request-id',
    'req-protocol-stop-01',
  ], (services) => {
    services.core.stopProtocol = async (input) => {
      stopCalls.push({
        protocolId: input.protocolId,
        stoppedOn: input.stoppedOn,
        vault: input.vault,
        requestId: input.requestId,
      })

      return {
        vault: input.vault,
        protocolId: input.protocolId,
        lookupId: input.protocolId,
        stoppedOn: input.stoppedOn ?? null,
        status: 'stopped',
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.meta?.command, 'protocol stop')
  assert.deepEqual(stopCalls, [
    {
      protocolId: 'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
      stoppedOn: '2026-03-12',
      vault: vaultRoot,
      requestId: 'req-protocol-stop-01',
    },
  ])
  assert.deepEqual(requireData(result), {
    vault: vaultRoot,
    protocolId: 'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
    lookupId: 'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
    stoppedOn: '2026-03-12',
    status: 'stopped',
  })
  assert.deepEqual(result.meta?.cta?.commands, [
    {
      command: 'vault-cli protocol show prot_01JNV422Y2M5ZBV64ZP4N1DRB1 --vault <vault>',
      description: 'Show the stopped protocol record.',
    },
    {
      command: 'vault-cli protocol list --status stopped --vault <vault>',
      description: 'List stopped protocols.',
    },
  ])
})
