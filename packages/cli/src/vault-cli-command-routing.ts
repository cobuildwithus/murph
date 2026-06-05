import type { Cli } from 'incur'

import type { KnownLazyRootCommand } from './vault-cli-routing.js'

export async function registerScopedVaultCliCommand(input: {
  cli: Cli.Cli
  root: KnownLazyRootCommand
}): Promise<void> {
  switch (input.root) {
    case 'commons': {
      const { registerCommonsCommands } = await import('./commands/commons.js')
      registerCommonsCommands(input.cli)
      return
    }
    case 'device': {
      const [
        { registerDeviceCommands },
        { createIntegratedDeviceSyncServices },
      ] = await Promise.all([
        import('./commands/device.js'),
        import('./device-services.js'),
      ])
      registerDeviceCommands(input.cli, createIntegratedDeviceSyncServices())
      return
    }
    case 'experiment': {
      const [
        { registerExperimentCommands },
        services,
      ] = await Promise.all([
        import('./commands/experiment.js'),
        createDefaultVaultServices(),
      ])
      registerExperimentCommands(input.cli, services)
      return
    }
    case 'init':
    case 'validate':
    case 'vault': {
      const [
        { registerVaultCommands },
        services,
      ] = await Promise.all([
        import('./commands/vault.js'),
        createDefaultVaultServices(),
      ])
      registerVaultCommands(input.cli, services)
      return
    }
  }
}

async function createDefaultVaultServices() {
  const { createDefaultVaultServices: createServices } = await import(
    './vault-cli-bootstrap.js'
  )
  return createServices()
}
