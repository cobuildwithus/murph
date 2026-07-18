import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'

import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { SCHEDULED_NOTIFICATION_TURN_PROCESS_ENV } from '@murphai/hosted-execution/env'
import { registerDeviceCommands } from '../src/commands/device.js'
import type { DeviceSyncServices } from '../src/device-services.js'
import { createTempVaultContext, runInProcessJsonCli } from './cli-test-helpers.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

// A stub whose every method throws proves the mutation guard rejects before any
// device service is reached: if the guard did not fire, the assertion on the
// scheduled-turn message would fail loudly instead of silently passing.
function throwingDeviceServices(): DeviceSyncServices {
  const fail = (): never => {
    throw new Error('device service must not run under the scheduled-turn guard')
  }
  return {
    listProviders: fail,
    connect: fail,
    listAccounts: fail,
    showAccount: fail,
    reconcileAccount: fail,
    disconnectAccount: fail,
    daemonStatus: fail,
    daemonStart: fail,
    daemonStop: fail,
  }
}

test('scheduled notification device CLI mutations fail closed on the local runtime', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-device-scheduled-turn-',
  )

  try {
    const cli = Cli.create('vault-cli', {
      description: 'device test cli',
      version: '0.0.0-test',
    })
    registerDeviceCommands(cli, throwingDeviceServices())

    // Local runtime (no hosted marker), scheduled notification turn.
    vi.stubEnv(SCHEDULED_NOTIFICATION_TURN_PROCESS_ENV, '1')
    const mutations = [
      ['device', 'connect', 'whoop', '--vault', vaultRoot],
      ['device', 'account', 'reconcile', 'acct_whoop_01', '--vault', vaultRoot],
      ['device', 'account', 'disconnect', 'acct_whoop_01', '--vault', vaultRoot],
      ['device', 'daemon', 'start', '--vault', vaultRoot],
      ['device', 'daemon', 'stop', '--vault', vaultRoot],
    ] as const

    for (const args of mutations) {
      const result = await runInProcessJsonCli(cli, [...args])
      assert.equal(result.exitCode, 1)
      assert.equal(result.envelope.ok, false)
      if (!result.envelope.ok) {
        assert.match(
          result.envelope.error.message ?? '',
          /Scheduled notification turns cannot mutate device connections/u,
        )
      }
    }
  } finally {
    await rm(parentRoot, { recursive: true, force: true })
  }
})
