import type { Cli } from 'incur'

import type { KnownLazyRootCommand } from './vault-cli-routing.js'

export async function registerScopedVaultCliCommand(input: {
  cli: Cli.Cli
  root: KnownLazyRootCommand
}): Promise<void> {
  switch (input.root) {
    case 'assistant':
    case 'chat':
    case 'doctor':
    case 'run':
    case 'status':
    case 'stop': {
      const [
        { registerAssistantCommands },
        services,
        { createDefaultInboxServices },
        { createIntegratedDeviceSyncServices, ensureCliVaultServices },
      ] = await Promise.all([
        import('@murphai/assistant-cli/commands/assistant'),
        createScopedVaultServices(),
        import('./vault-cli-inbox-services.js'),
        import('./device-services.js'),
      ])
      registerAssistantCommands(
        input.cli,
        createDefaultInboxServices(),
        ensureCliVaultServices(services, {
          devices: createIntegratedDeviceSyncServices(),
        }),
      )
      return
    }
    case 'automation': {
      const { registerAutomationCommands } = await import('./commands/automation.js')
      registerAutomationCommands(input.cli)
      return
    }
    case 'batch': {
      const { registerBatchCommands } = await import('./commands/batch.js')
      registerBatchCommands(input.cli)
      return
    }
    case 'blood-test': {
      const [
        { registerBloodTestCommands },
        services,
      ] = await Promise.all([
        import('./commands/health-blood-test-save.js'),
        createScopedVaultServices(),
      ])
      registerBloodTestCommands(input.cli, services)
      return
    }
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
    case 'encounter': {
      const { registerEncounterCommands } = await import('./commands/encounter.js')
      registerEncounterCommands(input.cli)
      return
    }
    case 'experiment': {
      const [
        { registerExperimentCommands },
        services,
      ] = await Promise.all([
        import('./commands/experiment.js'),
        createScopedVaultServices(),
      ])
      registerExperimentCommands(input.cli, services)
      return
    }
    case 'exercise': {
      const { registerExerciseCommands } = await import('./commands/exercise.js')
      registerExerciseCommands(input.cli)
      return
    }
    case 'goal': {
      const [
        { registerGoalCommands },
        services,
      ] = await Promise.all([
        import('./commands/health-goal-save.js'),
        createScopedVaultServices(),
      ])
      registerGoalCommands(input.cli, services)
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
        createScopedVaultServices(),
      ])
      registerVaultCommands(input.cli, services)
      return
    }
    case 'list':
    case 'show': {
      const [
        { registerReadCommands },
        services,
      ] = await Promise.all([
        import('./commands/read.js'),
        createScopedVaultServices(),
      ])
      registerReadCommands(input.cli, services)
      return
    }
    case 'meal': {
      const [
        { registerMealCommands },
        services,
      ] = await Promise.all([
        import('./commands/meal.js'),
        createScopedVaultServices(),
      ])
      registerMealCommands(input.cli, services)
      return
    }
    case 'measurement': {
      const { registerMeasurementCommands } = await import('./commands/measurement.js')
      registerMeasurementCommands(input.cli)
      return
    }
    case 'memory': {
      const { registerMemoryCommands } = await import('./commands/memory.js')
      registerMemoryCommands(input.cli)
      return
    }
    case 'protocol':
    case 'regimen': {
      const [
        { registerProtocolCommands },
        services,
      ] = await Promise.all([
        import('./commands/protocol.js'),
        createScopedVaultServices(),
      ])
      registerProtocolCommands(input.cli, services)
      return
    }
    case 'query':
    case 'search':
    case 'timeline': {
      const { registerSearchCommands } = await import('./commands/search.js')
      registerSearchCommands(input.cli)
      return
    }
    case 'supplement': {
      const [
        { registerSupplementCommands },
        services,
      ] = await Promise.all([
        import('./commands/supplement.js'),
        createScopedVaultServices(),
      ])
      registerSupplementCommands(input.cli, services)
      return
    }
    case 'wearables': {
      const [
        { registerWearablesCommands },
        services,
      ] = await Promise.all([
        import('./commands/wearables.js'),
        createScopedVaultServices(),
      ])
      registerWearablesCommands(input.cli, services)
      return
    }
  }

  const unhandledRoot: never = input.root
  throw new Error(`No scoped vault CLI command route exists for "${unhandledRoot}".`)
}

async function createScopedVaultServices() {
  const { createIntegratedVaultServices } = await import(
    '@murphai/vault-usecases/vault-services'
  )
  return createIntegratedVaultServices()
}
