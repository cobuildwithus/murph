import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const OPERATOR_CONFIG_DIRECTORY = '.murph'
const OPERATOR_CONFIG_PATH = path.join(OPERATOR_CONFIG_DIRECTORY, 'config.json')
const OPERATOR_CONFIG_DIRECTORY_MODE = 0o700
const OPERATOR_CONFIG_FILE_MODE = 0o600

export function resolveOperatorHomeDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredHome = env.HOME?.trim()
  return path.resolve(configuredHome && configuredHome.length > 0 ? configuredHome : os.homedir())
}

export function resolveOperatorConfigPath(
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  return path.join(homeDirectory, OPERATOR_CONFIG_PATH)
}

export function normalizeVaultForConfig(
  vault: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  const absoluteVault = path.resolve(vault)
  const normalizedHome = path.resolve(homeDirectory)

  if (absoluteVault === normalizedHome) {
    return '~'
  }

  if (absoluteVault.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${absoluteVault.slice(normalizedHome.length)}`
  }

  return absoluteVault
}

export function expandConfiguredVaultPath(
  configuredPath: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  if (configuredPath === '~') {
    return homeDirectory
  }

  if (configuredPath.startsWith('~/')) {
    return path.join(homeDirectory, configuredPath.slice(2))
  }

  return path.resolve(configuredPath)
}

export async function readOperatorConfigFile(
  configPath: string,
): Promise<string | null> {
  try {
    return await readFile(configPath, 'utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }

    throw error
  }
}

export async function writeOperatorConfigFile(
  configPath: string,
  contents: string,
): Promise<void> {
  const directoryPath = path.dirname(configPath)

  await mkdir(directoryPath, {
    recursive: true,
    mode: OPERATOR_CONFIG_DIRECTORY_MODE,
  })
  await applyOperatorConfigMode(directoryPath, OPERATOR_CONFIG_DIRECTORY_MODE)
  await writeFile(configPath, contents, {
    encoding: 'utf8',
    mode: OPERATOR_CONFIG_FILE_MODE,
  })
  await applyOperatorConfigMode(configPath, OPERATOR_CONFIG_FILE_MODE)
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }

    throw error
  }
}

async function applyOperatorConfigMode(
  targetPath: string,
  mode: number,
): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  await chmod(targetPath, mode)
}
