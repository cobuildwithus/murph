import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import { readEnvValue } from '../env-values.js'
import { VaultCliError } from '../vault-cli-errors.js'

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

const OPERATOR_CONFIG_SCHEMA = 'murph.operator-config.v1'
export const VAULT_ENV = 'VAULT'
export const VAULT_ENV_KEYS = [VAULT_ENV] as const

export const operatorConfigSchema = z.object({
  schema: z.literal(OPERATOR_CONFIG_SCHEMA),
  defaultVault: z.string().min(1).nullable(),
  assistant: z.unknown().nullable().default(null),
  hostedAssistant: z.unknown().nullable().optional(),
  updatedAt: z.isoDateTime({ offset: true }),
})

export type RawOperatorConfig = z.infer<typeof operatorConfigSchema>

export async function readStrictRawOperatorConfig(
  homeDirectory: string,
): Promise<RawOperatorConfig | null> {
  const raw = await readOperatorConfigFile(resolveOperatorConfigPath(homeDirectory))
  if (raw === null) {
    return null
  }

  try {
    return operatorConfigSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw invalidOperatorConfigError()
    }
    throw error
  }
}

export function invalidOperatorConfigError(): VaultCliError {
  return new VaultCliError(
    'operator_config_invalid',
    'Operator config is malformed. Repair or restore it before retrying.',
    {
      retryable: false,
      stage: 'configuration',
    },
  )
}

export async function resolveDefaultVault(
  homeDirectory = resolveOperatorHomeDirectory(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const envVault = readEnvValue(env, VAULT_ENV_KEYS)
  if (envVault) {
    return expandConfiguredVaultPath(envVault, homeDirectory)
  }

  const config = await readStrictRawOperatorConfig(homeDirectory)
  if (config?.defaultVault) {
    const configuredDefaultVault = expandConfiguredVaultPath(
      config.defaultVault,
      homeDirectory,
    )
    if (await pathExists(configuredDefaultVault)) {
      return configuredDefaultVault
    }
  }

  const cwdVault = path.resolve(process.cwd(), 'vault')
  if (await pathExists(cwdVault)) {
    return cwdVault
  }

  return null
}
