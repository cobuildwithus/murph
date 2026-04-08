import { createRequire } from 'node:module'
import { Cli } from 'incur'
import {
  applyDefaultVaultToArgs,
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
} from '@murphai/operator-config/operator-config'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'
import { createAssistantFoodAutoLogHooks } from '@murphai/assistant-engine/assistant-cron'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'
import { loadCliEnvFiles } from './cli-entry.js'
import { incurErrorBridge } from './incur-error-bridge.js'
import { registerRunnerVaultCliCommandDescriptors } from './runner-vault-cli-command-manifest.js'

export interface RunnerVaultCliRunOptions {
  argv0?: string
  exit?: ((code?: number) => void) | undefined
}

const RUNNER_CLI_DESCRIPTION =
  'Typed operator surface for the Murph vault baseline'
const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export function createRunnerVaultCli(
  services: VaultServices = createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  }),
  inboxServices: InboxServices = createIntegratedInboxServices(),
): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: RUNNER_CLI_DESCRIPTION,
    config: {
      flag: 'config',
      files: [
        '~/.config/murph/config.json',
        '~/.config/vault-cli/config.json',
      ],
    },
    sync: {
      depth: 1,
      suggestions: [
        'initialize a new Murph vault',
        'search recent notes in a Murph vault',
        'bootstrap the Murph inbox runtime',
      ],
    },
    version: packageJson.version,
  })
  cli.use(incurErrorBridge)

  registerRunnerVaultCliCommandDescriptors({
    cli,
    services,
    inboxServices,
  })

  return cli
}

export async function runRunnerVaultCliEntrypoint(
  argv: string[] = process.argv.slice(2),
  options: RunnerVaultCliRunOptions = {},
): Promise<void> {
  loadCliEnvFiles()
  const cli = createRunnerVaultCli()
  const homeDirectory = resolveOperatorHomeDirectory()
  const defaultVault = await resolveDefaultVault(homeDirectory)

  await cli.serve(applyDefaultVaultToArgs(argv, defaultVault), {
    env: process.env,
    ...(options.exit ? { exit: (code: number) => options.exit?.(code) } : {}),
  })
}
