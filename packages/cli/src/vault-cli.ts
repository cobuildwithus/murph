import { createRequire } from 'node:module'
import { Cli } from 'incur'
import { registerHealthEntityCrudGroup } from './commands/health-entity-command-registry.js'
import { registerDocumentCommands } from './commands/document.js'
import { registerEventCommands } from './commands/event.js'
import { registerExperimentCommands } from './commands/experiment.js'
import { registerExportCommands } from './commands/export.js'
import { registerIntakeCommands } from './commands/intake.js'
import { registerInboxCommands } from './commands/inbox.js'
import { registerJournalCommands } from './commands/journal.js'
import { registerMealCommands } from './commands/meal.js'
import { registerProfileCommands } from './commands/profile.js'
import { registerProviderCommands } from './commands/provider.js'
import { registerReadCommands } from './commands/read.js'
import { registerSearchCommands } from './commands/search.js'
import { registerAuditCommands } from './commands/audit.js'
import { registerAssistantCommands } from './commands/assistant.js'
import { registerRegimenCommands } from './commands/regimen.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerVaultCommands } from './commands/vault.js'
import {
  createIntegratedVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'
import {
  createIntegratedInboxCliServices,
  type InboxCliServices,
} from './inbox-services.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Healthy Bob vault baseline'

const CLI_SYNC_SUGGESTIONS = [
  'initialize a new Healthy Bob vault',
  'search recent notes in a Healthy Bob vault',
  'bootstrap the Healthy Bob inbox runtime',
]

export function createVaultCli(
  services: VaultCliServices = createIntegratedVaultCliServices(),
  inboxServices: InboxCliServices = createIntegratedInboxCliServices(),
): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: CLI_DESCRIPTION,
    sync: {
      depth: 1,
      suggestions: CLI_SYNC_SUGGESTIONS,
    },
    version: packageJson.version,
  })

  registerVaultCommands(cli, services)
  registerAssistantCommands(cli, inboxServices, services)
  registerAuditCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerMealCommands(cli, services)
  registerProviderCommands(cli, services)
  registerEventCommands(cli, services)
  registerSamplesCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerJournalCommands(cli, services)
  registerReadCommands(cli, services)
  registerSearchCommands(cli, services)
  registerExportCommands(cli, services)
  registerIntakeCommands(cli, services)
  registerInboxCommands(cli, inboxServices, services)
  registerProfileCommands(cli, services)
  registerHealthEntityCrudGroup(cli, services, 'goal')
  registerHealthEntityCrudGroup(cli, services, 'condition')
  registerHealthEntityCrudGroup(cli, services, 'allergy')
  registerRegimenCommands(cli, services)
  registerHealthEntityCrudGroup(cli, services, 'history')
  registerHealthEntityCrudGroup(cli, services, 'family')
  registerHealthEntityCrudGroup(cli, services, 'genetics')

  return cli
}
