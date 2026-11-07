import type { Cli } from 'incur'

import type { KnownLazyRootCommand } from './vault-cli-routing.js'

// Roots whose commands need only the CLI instance. Roots that need vault or
// inbox services stay in the switch below.
const cliOnlyScopedRegistrars = {
  assertion: async () => (await import('./commands/clinical-imports.js')).registerAssertionCommands,
  automation: async () => (await import('./commands/automation.js')).registerAutomationCommands,
  batch: async () => (await import('./commands/batch.js')).registerBatchCommands,
  'clinical-note': async () => (await import('./commands/clinical-imports.js')).registerClinicalNoteCommands,
  commons: async () => (await import('./commands/commons.js')).registerCommonsCommands,
  'diagnostic-test': async () => (await import('./commands/clinical-imports.js')).registerDiagnosticTestCommands,
  encounter: async () => (await import('./commands/encounter.js')).registerEncounterCommands,
  exercise: async () => (await import('./commands/exercise.js')).registerExerciseCommands,
  habitat: async () => (await import('./commands/habitat.js')).registerHabitatCommands,
  knowledge: async () => (await import('./commands/knowledge.js')).registerKnowledgeCommands,
  measurement: async () => (await import('./commands/measurement.js')).registerMeasurementCommands,
  memory: async () => (await import('./commands/memory.js')).registerMemoryCommands,
  profile: async () => (await import('./commands/profile.js')).registerProfileCommands,
  query: async () => (await import('./commands/search.js')).registerSearchCommands,
  route: async () => (await import('./commands/route.js')).registerRouteCommands,
  search: async () => (await import('./commands/search.js')).registerSearchCommands,
  'social-history': async () => (await import('./commands/clinical-imports.js')).registerSocialHistoryCommands,
  timeline: async () => (await import('./commands/search.js')).registerSearchCommands,
  vitals: async () => (await import('./commands/clinical-imports.js')).registerVitalsCommands,
} satisfies Partial<Record<KnownLazyRootCommand, () => Promise<(cli: Cli.Cli) => void>>>

type CliOnlyScopedRoot = keyof typeof cliOnlyScopedRegistrars

function isCliOnlyScopedRoot(root: KnownLazyRootCommand): root is CliOnlyScopedRoot {
  return Object.hasOwn(cliOnlyScopedRegistrars, root)
}

export async function registerScopedVaultCliCommand(input: {
  cli: Cli.Cli
  root: KnownLazyRootCommand
}): Promise<void> {
  if (isCliOnlyScopedRoot(input.root)) {
    const register = await cliOnlyScopedRegistrars[input.root]()
    register(input.cli)
    return
  }

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
    case 'assistant': {
      const [
        { registerAssistantOnboardingCommands },
        services,
        { createIntegratedDeviceSyncServices, ensureCliVaultServices },
      ] = await Promise.all([
        import('./commands/assistant-onboarding.js'),
        createScopedVaultServices(),
        import('./device-services.js'),
      ])
      registerAssistantOnboardingCommands(
        input.cli,
        ensureCliVaultServices(services, {
          devices: createIntegratedDeviceSyncServices(),
        }),
      )
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
        { createCliVaultUsecaseServices },
      ] = await Promise.all([
        import('./commands/experiment.js'),
        import('./vault-cli-services.js'),
      ])
      registerExperimentCommands(input.cli, createCliVaultUsecaseServices())
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
