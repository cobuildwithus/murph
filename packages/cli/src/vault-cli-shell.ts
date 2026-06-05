import { Cli } from 'incur'

import {
  CLI_CONFIG_FILES,
  CLI_DESCRIPTION,
  getVaultCliPackageVersion,
} from './vault-cli-package.js'
import { incurErrorBridge } from './incur-error-bridge.js'

const CLI_SYNC_SUGGESTIONS = [
  'initialize a new Murph vault',
  'search recent notes in a Murph vault',
  'bootstrap the Murph inbox runtime',
]

export function createVaultCliShell(
  commandName = 'vault-cli',
): Cli.Cli {
  const cli = Cli.create(commandName, {
    description: CLI_DESCRIPTION,
    config: {
      flag: 'config',
      files: [...CLI_CONFIG_FILES],
    },
    sync: {
      depth: 3,
      suggestions: CLI_SYNC_SUGGESTIONS,
    },
    version: getVaultCliPackageVersion(),
  })
  cli.use(incurErrorBridge)

  return cli
}
