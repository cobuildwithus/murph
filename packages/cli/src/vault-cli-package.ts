import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Murph vault baseline'

export const CLI_CONFIG_FILES = ['~/.config/murph/config.json'] as const

export function getVaultCliPackageVersion(): string {
  return packageJson.version ?? '0.0.0'
}
