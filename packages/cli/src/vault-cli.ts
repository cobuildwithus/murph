import { createRequire } from 'node:module'
import { Cli } from 'incur'
import { registerDocumentCommands } from './commands/document.js'
import { registerExperimentCommands } from './commands/experiment.js'
import { registerExportCommands } from './commands/export.js'
import { registerFamilyCommands } from './commands/family.js'
import { registerGeneticsCommands } from './commands/genetics.js'
import { registerGoalCommands } from './commands/goal.js'
import { registerHistoryCommands } from './commands/history.js'
import { registerIntakeCommands } from './commands/intake.js'
import { registerJournalCommands } from './commands/journal.js'
import { registerMealCommands } from './commands/meal.js'
import { registerProfileCommands } from './commands/profile.js'
import { registerReadCommands } from './commands/read.js'
import { registerAllergyCommands } from './commands/allergy.js'
import { registerConditionCommands } from './commands/condition.js'
import { registerRegimenCommands } from './commands/regimen.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerVaultCommands } from './commands/vault.js'
import {
  createIntegratedVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Healthy Bob vault baseline'

export function createVaultCli(
  services: VaultCliServices = createIntegratedVaultCliServices(),
): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: CLI_DESCRIPTION,
    version: packageJson.version,
  })

  registerVaultCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerMealCommands(cli, services)
  registerSamplesCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerJournalCommands(cli, services)
  registerReadCommands(cli, services)
  registerExportCommands(cli, services)
  registerIntakeCommands(cli, services)
  registerProfileCommands(cli, services)
  registerGoalCommands(cli, services)
  registerConditionCommands(cli, services)
  registerAllergyCommands(cli, services)
  registerRegimenCommands(cli, services)
  registerHistoryCommands(cli, services)
  registerFamilyCommands(cli, services)
  registerGeneticsCommands(cli, services)

  return cli
}
