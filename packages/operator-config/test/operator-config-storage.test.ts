import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  resolveOperatorConfigPath,
  saveDefaultVaultConfig,
} from '../src/operator-config.ts'
import {
  expandConfiguredVaultPath,
  normalizeVaultForConfig,
  pathExists,
  readOperatorConfigFile,
  resolveOperatorHomeDirectory,
  writeOperatorConfigFile,
} from '../src/operator-config/storage.ts'

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

test('operator config storage normalizes vault paths and home-directory fallbacks', () => {
  const homeDirectory = path.resolve('/tmp/operator-config-home')
  const nestedVault = path.join(homeDirectory, 'vaults', 'primary')
  const outsideVault = path.resolve('/tmp/operator-config-other')

  assert.equal(resolveOperatorHomeDirectory({ HOME: '   ' }), path.resolve(os.homedir()))
  assert.equal(normalizeVaultForConfig(homeDirectory, homeDirectory), '~')
  assert.equal(normalizeVaultForConfig(nestedVault, homeDirectory), '~/vaults/primary')
  assert.equal(normalizeVaultForConfig(outsideVault, homeDirectory), outsideVault)

  assert.equal(expandConfiguredVaultPath('~', homeDirectory), homeDirectory)
  assert.equal(expandConfiguredVaultPath('~/vaults/primary', homeDirectory), nestedVault)
  assert.equal(
    expandConfiguredVaultPath('relative-vault', homeDirectory),
    path.resolve('relative-vault'),
  )
})

test('operator config storage handles missing files, writes content, and rethrows non-ENOENT fs errors', async () => {
  const homeDirectory = await createTempHome('operator-config-storage-errors-')
  const configPath = resolveOperatorConfigPath(homeDirectory)
  const blockingFilePath = path.join(homeDirectory, 'plain-file')

  assert.equal(await readOperatorConfigFile(configPath), null)
  assert.equal(await pathExists(configPath), false)

  await writeOperatorConfigFile(configPath, '{"schema":"murph.operator-config.v1"}\n')

  assert.equal(await readOperatorConfigFile(configPath), '{"schema":"murph.operator-config.v1"}\n')
  assert.equal(await pathExists(configPath), true)

  await writeFile(blockingFilePath, 'not-a-directory', 'utf8')

  await assert.rejects(
    () => readOperatorConfigFile(homeDirectory),
    (error: unknown) => {
      assert.equal(typeof error, 'object')
      assert.notEqual(error, null)
      assert.equal((error as NodeJS.ErrnoException).code, 'EISDIR')
      return true
    },
  )

  await assert.rejects(
    () => pathExists(path.join(blockingFilePath, 'child')),
    (error: unknown) => {
      assert.equal(typeof error, 'object')
      assert.notEqual(error, null)
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOTDIR')
      return true
    },
  )
})
