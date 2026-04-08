import type { Cli } from 'incur'
import {
  applyDefaultVaultToArgs,
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
} from '@murphai/operator-config/operator-config'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'
import { createCliServeOptions, loadCliEnvFiles } from './cli-entry.js'
import { registerRunnerVaultCliCommandDescriptors } from './runner-vault-cli-command-manifest.js'
import {
  createDefaultVaultServices,
  createVaultCliShell,
} from './vault-cli-bootstrap.js'

export interface RunnerVaultCliRunOptions {
  argv0?: string
  exit?: ((code?: number) => void) | undefined
}

export function createRunnerVaultCli(
  services: VaultServices = createDefaultVaultServices(),
  inboxServices: InboxServices = createIntegratedInboxServices(),
): Cli.Cli {
  const cli = createVaultCliShell()

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

  await cli.serve(
    applyDefaultVaultToArgs(argv, defaultVault),
    createCliServeOptions(options.exit),
  )
}
