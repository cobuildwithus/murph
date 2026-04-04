import { Cli } from 'incur'
import { createVaultCli } from './vault-cli.js'

const cli: Cli.Cli = createVaultCli()

export default cli
export { createVaultCli, CLI_DESCRIPTION } from './vault-cli.js'
export * from './assistant/store.js'
export * from './assistant-runtime.js'
export * from './assistant/cron.js'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './assistant/automation.js'
export {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from './assistant/outbox.js'
export { refreshAssistantStatusSnapshot } from './assistant/status.js'
export * from './research-runtime.js'
export * from './research-cli-contracts.js'
export * from './knowledge-cli-contracts.js'
