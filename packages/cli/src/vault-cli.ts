import { createRequire } from 'node:module'
import { Cli } from 'incur'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'
import { loadRuntimeModule } from '@murphai/vault-usecases/runtime'
import { createAssistantFoodAutoLogHooks } from '@murphai/assistant-engine/assistant-cron'
import {
  createIntegratedInboxServices,
  type InboxImessageRuntimeModule,
  type InboxServices,
} from '@murphai/inbox-services'
import { incurErrorBridge } from './incur-error-bridge.js'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Murph vault baseline'

const CLI_SYNC_SUGGESTIONS = [
  'initialize a new Murph vault',
  'search recent notes in a Murph vault',
  'bootstrap the Murph inbox runtime',
]

const CLI_CONFIG_FILES = [
  '~/.config/murph/config.json',
  '~/.config/vault-cli/config.json',
] as const

export function createVaultCli(
  services: VaultServices = createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  }),
  inboxServices: InboxServices = createIntegratedInboxServices({
    loadInboxImessageModule: () =>
      loadRuntimeModule<InboxImessageRuntimeModule>('@murphai/inboxd-imessage'),
  }),
): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: CLI_DESCRIPTION,
    config: {
      flag: 'config',
      files: [...CLI_CONFIG_FILES],
    },
    sync: {
      depth: 1,
      suggestions: CLI_SYNC_SUGGESTIONS,
    },
    version: packageJson.version,
  })
  cli.use(incurErrorBridge)

  registerVaultCliCommandDescriptors({
    cli,
    services,
    inboxServices,
  })

  return cli
}
