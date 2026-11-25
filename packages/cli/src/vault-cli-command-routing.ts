import type { Cli } from 'incur'
import type { VaultServices } from '@murphai/vault-usecases'

import type { KnownLazyRootCommand } from './vault-cli-routing.js'

// Roots whose commands need only the CLI instance. Roots that need other
// services or arguments stay in the switch below.
const cliOnlyScopedRegistrars = {
  assertion: async () => (await import('./commands/clinical-imports.js')).registerAssertionCommands,
  automation: async () => (await import('./commands/automation.js')).registerAutomationCommands,
  batch: async () => (await import('./commands/batch.js')).registerBatchCommands,
  'clinical-note': async () => (await import('./commands/clinical-imports.js')).registerClinicalNoteCommands,
  commons: async () => (await import('./commands/commons.js')).registerCommonsCommands,
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

// Roots whose commands need the CLI instance and the integrated vault services.
const vaultServiceScopedRegistrars = {
  allergy: async () => (await import('./commands/health-allergy-save.js')).registerAllergyCommands,
  'blood-test': async () => (await import('./commands/health-blood-test-save.js')).registerBloodTestCommands,
  capture: async () => (await import('./commands/capture.js')).registerCaptureCommands,
  condition: async () => (await import('./commands/health-condition-save.js')).registerConditionCommands,
  'diagnostic-test': async () => (await import('./commands/clinical-imports.js')).registerDiagnosticTestCommands,
  event: async () => (await import('./commands/event.js')).registerEventCommands,
  food: async () => (await import('./commands/food.js')).registerFoodCommands,
  goal: async () => (await import('./commands/health-goal-save.js')).registerGoalCommands,
  immunization: async () => (await import('./commands/health-immunization-save.js')).registerImmunizationCommands,
  journal: async () => (await import('./commands/journal.js')).registerJournalCommands,
  list: async () => (await import('./commands/read.js')).registerReadCommands,
  meal: async () => (await import('./commands/meal.js')).registerMealCommands,
  medication: async () => (await import('./commands/medication.js')).registerMedicationCommands,
  protocol: async () => (await import('./commands/protocol.js')).registerProtocolCommands,
  regimen: async () => (await import('./commands/protocol.js')).registerProtocolCommands,
  show: async () => (await import('./commands/read.js')).registerReadCommands,
  supplement: async () => (await import('./commands/supplement.js')).registerSupplementCommands,
  wearables: async () => (await import('./commands/wearables.js')).registerWearablesCommands,
  workout: async () => (await import('./commands/workout.js')).registerWorkoutCommands,
} satisfies Partial<Record<KnownLazyRootCommand, () => Promise<(cli: Cli.Cli, services: VaultServices) => void>>>

type VaultServiceScopedRoot = keyof typeof vaultServiceScopedRegistrars

function isVaultServiceScopedRoot(root: KnownLazyRootCommand): root is VaultServiceScopedRoot {
  return Object.hasOwn(vaultServiceScopedRegistrars, root)
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
  if (isVaultServiceScopedRoot(input.root)) {
    const [register, services] = await Promise.all([
      vaultServiceScopedRegistrars[input.root](),
      createScopedVaultServices(),
    ])
    register(input.cli, services)
    return
  }

  switch (input.root) {
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
        { createCliVaultUsecaseServices },
      ] = await Promise.all([
        import('./commands/experiment.js'),
        import('./vault-cli-services.js'),
      ])
      registerExperimentCommands(input.cli, createCliVaultUsecaseServices())
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
