import { Cli } from 'incur'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases'
import { registerAuditCommands } from './commands/audit.js'
import { registerAutomationCommands } from './commands/automation.js'
import { registerDeviceCommands } from './commands/device.js'
import { registerDocumentCommands } from './commands/document.js'
import { registerEventCommands } from './commands/event.js'
import { registerExperimentCommands } from './commands/experiment.js'
import { registerExportCommands } from './commands/export.js'
import { registerFoodCommands } from './commands/food.js'
import {
  registerHealthEntityCrudGroup,
} from './commands/health-entity-command-registry.js'
import { registerInboxCommands } from './commands/inbox.js'
import { registerIntakeCommands } from './commands/intake.js'
import { registerInterventionCommands } from './commands/intervention.js'
import { registerJournalCommands } from './commands/journal.js'
import { registerKnowledgeCommands } from './commands/knowledge.js'
import { registerMemoryCommands } from './commands/memory.js'
import { registerMealCommands } from './commands/meal.js'
import { registerProtocolCommands } from './commands/protocol.js'
import { registerProviderCommands } from './commands/provider.js'
import { registerReadCommands } from './commands/read.js'
import { registerRecipeCommands } from './commands/recipe.js'
import { registerResearchCommands } from './commands/research.js'
import { registerRouteCommands } from './commands/route.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerSearchCommands } from './commands/search.js'
import { registerSupplementCommands } from './commands/supplement.js'
import { registerVaultCommands } from './commands/vault.js'
import { registerWearablesCommands } from './commands/wearables.js'
import { registerWorkoutCommands } from './commands/workout.js'

const GENERIC_HEALTH_COMMAND_NAMES = [
  'goal',
  'condition',
  'allergy',
  'blood-test',
  'family',
  'genetics',
] as const

export function registerRunnerVaultCliCommandDescriptors(input: {
  cli: Cli.Cli
  services: VaultServices
  inboxServices: InboxServices
}) {
  const { cli, inboxServices, services } = input

  registerVaultCommands(cli, services)
  registerAutomationCommands(cli)
  registerAuditCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerDeviceCommands(cli, services)
  registerMemoryCommands(cli)
  registerMealCommands(cli, services)
  registerWorkoutCommands(cli, services)
  registerInterventionCommands(cli, services)
  registerProviderCommands(cli, services)
  registerRecipeCommands(cli, services)
  registerFoodCommands(cli, services)
  registerEventCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerJournalCommands(cli, services)
  registerReadCommands(cli, services)
  registerSamplesCommands(cli, services)
  registerSearchCommands(cli, services)
  registerKnowledgeCommands(cli)
  registerResearchCommands(cli)
  registerRouteCommands(cli)
  registerExportCommands(cli, services)
  registerIntakeCommands(cli, services)
  registerInboxCommands(cli, inboxServices, services)

  for (const commandName of GENERIC_HEALTH_COMMAND_NAMES) {
    registerHealthEntityCrudGroup(cli, services, commandName)
  }

  registerSupplementCommands(cli, services)
  registerProtocolCommands(cli, services)
  registerWearablesCommands(cli, services)
}
