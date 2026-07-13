import type { Cli } from 'incur'

import type { KnownLazyRootCommand } from './vault-cli-routing.js'

export async function registerScopedVaultCliCommand(input: {
  cli: Cli.Cli
  root: KnownLazyRootCommand
}): Promise<void> {
  switch (input.root) {
    case 'allergy': {
      const [
        { registerAllergyCommands },
        services,
      ] = await Promise.all([
        import('./commands/health-allergy-save.js'),
        createScopedVaultServices(),
      ])
      registerAllergyCommands(input.cli, services)
      return
    }
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
    case 'assertion': {
      const { registerAssertionCommands } = await import('./commands/clinical-imports.js')
      registerAssertionCommands(input.cli)
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
    case 'capture': {
      const [
        { registerCaptureCommands },
        services,
      ] = await Promise.all([
        import('./commands/capture.js'),
        createScopedVaultServices(),
      ])
      registerCaptureCommands(input.cli, services)
      return
    }
    case 'commons': {
      const { registerCommonsCommands } = await import('./commands/commons.js')
      registerCommonsCommands(input.cli)
      return
    }
    case 'condition': {
      const [
        { registerConditionCommands },
        services,
      ] = await Promise.all([
        import('./commands/health-condition-save.js'),
        createScopedVaultServices(),
      ])
      registerConditionCommands(input.cli, services)
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
    case 'clinical-note': {
      const { registerClinicalNoteCommands } = await import('./commands/clinical-imports.js')
      registerClinicalNoteCommands(input.cli)
      return
    }
    case 'diagnostic-test': {
      const { registerDiagnosticTestCommands } = await import('./commands/clinical-imports.js')
      registerDiagnosticTestCommands(input.cli)
      return
    }
    case 'encounter': {
      const { registerEncounterCommands } = await import('./commands/encounter.js')
      registerEncounterCommands(input.cli)
      return
    }
    case 'event': {
      const [
        { registerEventCommands },
        services,
      ] = await Promise.all([
        import('./commands/event.js'),
        createScopedVaultServices(),
      ])
      registerEventCommands(input.cli, services)
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
    case 'food': {
      const [
        { registerFoodCommands },
        services,
      ] = await Promise.all([
        import('./commands/food.js'),
        createScopedVaultServices(),
      ])
      registerFoodCommands(input.cli, services)
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
    case 'group': {
      const { registerGroupCommands } = await import('./commands/group.js')
      registerGroupCommands(input.cli)
      return
    }
    case 'immunization': {
      const [
        { registerImmunizationCommands },
        services,
      ] = await Promise.all([
        import('./commands/health-immunization-save.js'),
        createScopedVaultServices(),
      ])
      registerImmunizationCommands(input.cli, services)
      return
    }
    case 'init':
    case 'validate':
    case 'vault': {
      const [
        { registerVaultCommands },
        services,
        { createDefaultInboxServices },
      ] = await Promise.all([
        import('./commands/vault.js'),
        createScopedVaultServices(),
        import('./vault-cli-inbox-services.js'),
      ])
      registerVaultCommands(input.cli, services, createDefaultInboxServices())
      return
    }
    case 'journal': {
      const [
        { registerJournalCommands },
        services,
      ] = await Promise.all([
        import('./commands/journal.js'),
        createScopedVaultServices(),
      ])
      registerJournalCommands(input.cli, services)
      return
    }
    case 'knowledge': {
      const { registerKnowledgeCommands } = await import('./commands/knowledge.js')
      registerKnowledgeCommands(input.cli)
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
    case 'medication': {
      const [
        { registerMedicationCommands },
        services,
      ] = await Promise.all([
        import('./commands/medication.js'),
        createScopedVaultServices(),
      ])
      registerMedicationCommands(input.cli, services)
      return
    }
    case 'measurement': {
      const { registerMeasurementCommands } = await import('./commands/measurement.js')
      registerMeasurementCommands(input.cli)
      return
    }
    case 'habitat': {
      const { registerHabitatCommands } = await import('./commands/habitat.js')
      registerHabitatCommands(input.cli)
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
    case 'research': {
      const { registerResearchCommands } = await import('./commands/research.js')
      registerResearchCommands(input.cli)
      return
    }
    case 'route': {
      const { registerRouteCommands } = await import('./commands/route.js')
      registerRouteCommands(input.cli)
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
    case 'social-history': {
      const { registerSocialHistoryCommands } = await import('./commands/clinical-imports.js')
      registerSocialHistoryCommands(input.cli)
      return
    }
    case 'vitals': {
      const { registerVitalsCommands } = await import('./commands/clinical-imports.js')
      registerVitalsCommands(input.cli)
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
    case 'workout': {
      const [
        { registerWorkoutCommands },
        services,
      ] = await Promise.all([
        import('./commands/workout.js'),
        createScopedVaultServices(),
      ])
      registerWorkoutCommands(input.cli, services)
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
