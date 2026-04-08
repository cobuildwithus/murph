import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  resolveOperatorConfigPath,
  saveDefaultVaultConfig,
} from '../src/operator-config.ts'

const tempDirectories = new Set<string>()

afterEach(async () => {
  for (const directory of tempDirectories) {
    await rm(directory, { force: true, recursive: true })
  }

  tempDirectories.clear()
})

async function createTempHome(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirectories.add(directory)
  return directory
}

test('operator config writes private directory and file modes on non-windows hosts', async () => {
  const homeDirectory = await createTempHome('operator-config-storage-')
  const vaultDirectory = path.join(homeDirectory, 'vaults', 'primary')
  await mkdir(vaultDirectory, { recursive: true })

  await saveDefaultVaultConfig(vaultDirectory, homeDirectory)

  if (process.platform === 'win32') {
    return
  }

  const configPath = resolveOperatorConfigPath(homeDirectory)
  const directoryStats = await stat(path.dirname(configPath))
  const fileStats = await stat(configPath)

  assert.equal(directoryStats.mode & 0o777, 0o700)
  assert.equal(fileStats.mode & 0o777, 0o600)
})
